# Offline unattended controller recovery. Only a verified disposable TEMP fixture.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$script:realRecoveryLock = (Get-Command Enter-RunnerLock).ScriptBlock
if (-not (Get-Command Invoke-RunnerSupervisorRecovery -ErrorAction SilentlyContinue)) { throw 'The watchdog cannot recover an exited active controller.' }
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-unattended-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base
$script:RunnerStatePath = Join-Path $base 'state.json'
$script:RunnerConfigPath = Join-Path $base 'config.json'
$script:events = [Collections.Generic.List[string]]::new()
$script:starts = 0
$script:taskState = 'Ready'
$script:mode = 'active'
$script:failure = ''
$script:state = $null
$script:ownerAlive = $false
$script:unexpectedVm = $false
$script:stopDuringCheck = $false
$script:busyLifetime = $false
function Assert-Administrator {}
function Assert-SecureRoot { if ($script:failure -ceq 'root') { throw 'Unsafe root.' } }
function Assert-RunnerProtectedPath { param($Path) if ($script:failure -ceq 'credential-acl') { throw 'Unsafe credential path.' } }
function Get-RunnerConfig { if ($script:failure -ceq 'config') { throw 'Invalid config.' }; return [pscustomobject]@{ activation = $script:mode } }
function Get-CoherentInstalledRunnerBundle {
    $script:events.Add('bundle')
    if ($script:failure -ceq 'bundle') { throw 'Incoherent bundle.' }
    if ($script:stopDuringCheck) { [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop') }
}
function Get-RunnerState { return $script:state }
function Get-VM { if ($script:unexpectedVm) { return [pscustomobject]@{ Name = 'ITIR-unexpected' } } }
function Get-RunnerVmInventory { return @(Get-VM) }
function Get-ScheduledTask { return [pscustomobject]@{ State = $script:taskState } }
function Start-ScheduledTask { $script:events.Add('start'); $script:starts++; $script:taskState = 'Running' }
function Test-RunnerProcessIdentity { return $script:ownerAlive }
function Remove-RunnerInstance { param($State) $script:events.Add('cleanup'); if ($script:failure -ceq 'cleanup') { throw 'Cleanup refused.' }; $script:state = $null }
function Enter-RunnerLock {
    param($Name = 'Global\ITInventoryLocalRunner-v1', [switch]$FailFast)
    if ($Name -ceq 'Global\ITInventoryLocalRunner-Supervisor-v1') {
        if (-not $FailFast) { throw 'Automatic recovery waits behind a lifetime owner.' }
        $script:events.Add('lifetime')
        if ($script:busyLifetime) { throw 'Lifetime is busy.' }
        return 'lifetime'
    }
    $script:events.Add('state'); return 'state'
}
function Exit-RunnerLock { param($Mutex) $script:events.Add('release-' + $Mutex) }
function Reset-Case {
    $script:events.Clear(); $script:starts = 0; $script:taskState = 'Ready'; $script:mode = 'active'; $script:failure = ''
    $script:state = $null; $script:ownerAlive = $false; $script:unexpectedVm = $false; $script:stopDuringCheck = $false; $script:busyLifetime = $false
    foreach ($name in @('stop.requested','pilot-retry.json','update-journal.json','setup-publication.json','last-error.json','controller-observation.json')) {
        $path = Join-Path $base $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    Write-RunnerJson (Join-Path $base 'credential.dpapi') ([ordered]@{ tag=$script:RunnerTag; scope='LocalMachine'; ciphertext='ZmFrZQ==' })
}
function Assert-NoStart([string]$Case) {
    try { Invoke-RunnerSupervisorRecovery } catch {}
    if ($script:starts -ne 0) { throw "Unsafe automatic start: $Case." }
}
try {
    Reset-Case
    Invoke-RunnerSupervisorRecovery
    if ($script:starts -ne 1 -or ($script:events -join ',') -notmatch '^lifetime,state,.*bundle,.*start,release-state,release-lifetime$') { throw 'Active recovery failed or violated lifetime-before-state locking.' }
    Invoke-RunnerSupervisorRecovery
    if ($script:starts -ne 1) { throw 'A running controller was started twice.' }
    foreach ($caseMode in @('disabled','pilot')) { Reset-Case; $script:mode=$caseMode; Assert-NoStart $caseMode }
    foreach ($caseState in @('Running','Disabled')) { Reset-Case; $script:taskState=$caseState; Assert-NoStart $caseState }
    foreach ($caseFailure in @('root','config','bundle','credential-acl')) { Reset-Case; $script:failure=$caseFailure; Assert-NoStart $caseFailure }
    Reset-Case; Remove-Item -LiteralPath (Join-Path $base 'credential.dpapi'); Assert-NoStart 'missing credential'
    Reset-Case; Write-RunnerJson (Join-Path $base 'credential.dpapi') ([ordered]@{tag=$script:RunnerTag;scope='LocalMachine';ciphertext='not-base64'}); Assert-NoStart 'invalid credential'
    Reset-Case; $script:unexpectedVm=$true; Assert-NoStart 'unexpected owned-prefix VM'
    Reset-Case; $script:state=[pscustomobject]@{vmName='recorded'}; Assert-NoStart 'remaining recorded session'
    Reset-Case; $script:busyLifetime=$true; Assert-NoStart 'concurrent update/controller lifetime'
    if ($script:events.Contains('state')) { throw 'Busy lifetime recovery acquired the state lock.' }
    foreach ($journal in @('pilot-retry.json','update-journal.json','setup-publication.json')) {
        foreach ($phase in @('pending','invalid')) {
            Reset-Case; Write-RunnerJson (Join-Path $base $journal) ([ordered]@{tag=$script:RunnerTag;phase=$phase}); Assert-NoStart ($journal + ':' + $phase)
        }
    }
    Reset-Case; Write-RunnerJson (Join-Path $base 'update-journal.json') ([ordered]@{tag=$script:RunnerTag;phase='complete'}); Invoke-RunnerSupervisorRecovery
    if ($script:starts -ne 1) { throw 'Completed journal blocked recovery.' }
    Reset-Case; [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop'); Assert-NoStart 'explicit Stop'
    if (-not (Test-Path -LiteralPath (Join-Path $base 'stop.requested'))) { throw 'Recovery erased explicit Stop.' }
    Reset-Case; $script:stopDuringCheck=$true; Assert-NoStart 'Stop during validation'
    if (-not (Test-Path -LiteralPath (Join-Path $base 'stop.requested'))) { throw 'Recovery erased racing Stop.' }
    # Exact owned stale cleanup precedes restart, while live sessions remain intact.
    $realIdentity = (Get-Command Assert-StateIdentity).ScriptBlock
    function Assert-StateIdentity {}
    Reset-Case; $script:state=[pscustomobject]@{vmName='fixture';deadlineUtc=[DateTime]::UtcNow.AddMinutes(1).ToString('o');supervisorPid=1;supervisorStartUtc=[DateTime]::UtcNow.ToString('o')}
    Invoke-Watchdog
    if ($script:starts -ne 1 -or ($script:events -join ',') -notmatch 'cleanup,release-state,lifetime,state') { throw 'Watchdog failed cleanup-before-recovery ordering.' }
    Reset-Case; $script:failure='cleanup'; $script:state=[pscustomobject]@{vmName='fixture';deadlineUtc=[DateTime]::UtcNow.AddMinutes(1).ToString('o');supervisorPid=1;supervisorStartUtc=[DateTime]::UtcNow.ToString('o')}
    try { Invoke-Watchdog } catch {}
    if ($script:starts -ne 0 -or $null -eq $script:state) { throw 'Failed cleanup permitted restart.' }
    Reset-Case; $script:ownerAlive=$true; $script:taskState='Running'; $script:state=[pscustomobject]@{vmName='fixture';deadlineUtc=[DateTime]::UtcNow.AddMinutes(1).ToString('o');supervisorPid=1;supervisorStartUtc=[DateTime]::UtcNow.ToString('o')}
    Invoke-Watchdog
    if ($script:starts -ne 0 -or $script:events.Contains('cleanup')) { throw 'Live session was restarted or removed.' }
    # A separate real Windows process holds only a fixture-named lifetime mutex.
    # This proves fail-fast exclusion without touching installed/global runner locks.
    Reset-Case
    $stubLock = (Get-Command Enter-RunnerLock).ScriptBlock
    $script:fixtureLockName = 'Local\ITIR-recovery-' + [guid]::NewGuid().ToString('N')
    $readyName = $script:fixtureLockName + '-ready'; $releaseName = $script:fixtureLockName + '-release'
    $readyEvent = [Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,$readyName)
    $releaseEvent = [Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,$releaseName)
    $holderPath = Join-Path $base 'hold-lifetime.ps1'
    [IO.File]::WriteAllText($holderPath, @'
param($MutexName,$ReadyName,$ReleaseName)
$mutex=[Threading.Mutex]::new($false,$MutexName)
$ready=[Threading.EventWaitHandle]::OpenExisting($ReadyName)
$release=[Threading.EventWaitHandle]::OpenExisting($ReleaseName)
try { [void]$mutex.WaitOne(); [void]$ready.Set(); [void]$release.WaitOne(10000) }
finally { $mutex.ReleaseMutex(); $mutex.Dispose(); $ready.Dispose(); $release.Dispose() }
'@)
    $holder = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$holderPath+'"'),$script:fixtureLockName,$readyName,$releaseName)
    try {
        if (-not $readyEvent.WaitOne(5000)) { throw 'Fixture lifetime holder did not become ready.' }
        function Enter-RunnerLock { param($Name,[switch]$FailFast) & $script:realRecoveryLock -Name $script:fixtureLockName -FailFast:$FailFast }
        $watch=[Diagnostics.Stopwatch]::StartNew()
        Invoke-RunnerSupervisorRecovery
        if ($script:starts -ne 0 -or $watch.Elapsed.TotalSeconds -gt 2) { throw 'Recovery waited behind a real lifetime owner or requested duplicate startup.' }
    } finally {
        [void]$releaseEvent.Set()
        if (-not $holder.WaitForExit(15000)) { throw 'Fixture lifetime holder did not exit.' }
        $holder.Dispose(); $readyEvent.Dispose(); $releaseEvent.Dispose()
        Set-Item -Path Function:Enter-RunnerLock -Value $stubLock
    }
    Write-Host 'Unattended recovery passed: guarded active restart, lifetime/state order, duplicate refusal, Stop races, journal/bundle/credential/VM refusal and cleanup-before-recovery.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -notmatch '^ITIR-unattended-[0-9a-f]{32}$') { throw 'Unexpected unattended fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
