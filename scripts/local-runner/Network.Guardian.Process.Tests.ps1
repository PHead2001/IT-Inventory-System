# Independent guardian while a native supervisor call is blocked. TEMP-backed
# provider only; no real VM, NIC, credential or network effects.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
. (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-guardprocess-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$script:fixtureStateLock = 'Local\' + [IO.Path]::GetFileName($root)
$script:realLock = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    if ($Name -cne 'Global\ITInventoryLocalRunner-v1' -and $Name -cne $script:fixtureStateLock) { throw 'Guardian fixture requested an unrelated mutex.' }
    & $script:realLock $script:fixtureStateLock -FailFast:$FailFast
}
$worker = $null; $blockedOwner = $null
try {
    $script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
    $name = 'ITIR-' + ('a' * 32); $instance = Join-Path (Join-Path $root 'instances') $name
    [void][IO.Directory]::CreateDirectory($instance)
    $now = [DateTime]::UtcNow
    $rule = [ordered]@{ Action = 'Deny'; Direction = 'Outbound'; Weight = 2; LocalIPAddress = ''; RemoteIPAddress = ''; LocalPort = ''; RemotePort = ''; Protocol = ''; Stateful = $false }
    $state = [ordered]@{ layoutVersion = 2; tag = $script:RunnerTag; vmName = $name; vmId = '00000000-0000-0000-0000-000000000001'; instancePath = $instance; purpose = 'job'; supervisorPid = $PID; supervisorStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'); deadlineUtc = $now.AddMinutes(1).ToString('o'); guestMac = '02AABBCCDDEE'; networkFingerprint = 'a' * 64; networkRules = @($rule) }
    Write-RunnerJson $script:RunnerStatePath $state
    Write-RunnerJson (Join-Path $root 'vm.json') ([ordered]@{ Id = $state.vmId; Name = $name; Notes = $script:RunnerTag; Path = (Get-RunnerSessionPaths $state).vmPath; State = 'Off' })
    Write-RunnerJson (Join-Path $root 'adapter.json') ([ordered]@{ Id = 'fixture'; VMId = $state.vmId; VMName = $name; MacAddress = $state.guestMac; DynamicMacAddressEnabled = $false; SwitchId = '00000000-0000-0000-0000-000000000002'; SwitchName = $script:RunnerSwitch })
    $child = Join-Path $root 'guardian.ps1'
    [IO.File]::WriteAllText($child, @'
param($Root, $Source)
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
. (Join-Path $Source 'Common.ps1')
. (Join-Path $Source 'Network.Recovery.ps1')
. (Join-Path $Source 'Test.Mutex.ps1')
$script:RunnerRoot = $Root; $script:RunnerStatePath = Join-Path $Root 'state.json'
$script:fixtureStateLock = 'Local\' + [IO.Path]::GetFileName($Root)
$script:realLock = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    if ($Name -cne 'Global\ITInventoryLocalRunner-v1' -and $Name -cne $script:fixtureStateLock) { throw 'Guardian child requested an unrelated mutex.' }
    & $script:realLock $script:fixtureStateLock -FailFast:$FailFast
}
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Source 'Runner.ps1'), [ref]$null, [ref]$null)
$definition = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-GuardCheck' }, $true)
Invoke-Expression $definition.Extent.Text
$script:RunnerGuardOutcome = $null; $script:drift = $false
function Get-RunnerConfig { [pscustomobject]@{guestIp='172.30.240.2';gatewayIp='172.30.240.1'} }
function Get-RunnerNetworkObservation { [pscustomobject]@{fingerprint=$(if ($script:drift) {'b'*64} else {'a'*64});rules=(Get-RunnerState).networkRules;observedUtc=[DateTime]::UtcNow.ToString('o')} }
function Get-VM { Read-RunnerJson (Join-Path $Root 'vm.json') }
function Get-VMNetworkAdapter { Read-RunnerJson (Join-Path $Root 'adapter.json') }
function Get-VMSwitch { [pscustomobject]@{Id=[guid]'00000000-0000-0000-0000-000000000002';Name=$script:RunnerSwitch;SwitchType='Internal'} }
function Get-VMNetworkAdapterExtendedAcl { (Get-RunnerState).networkRules }
function Suspend-VM { $vm=Get-VM; $vm.State='Paused'; Write-RunnerJson (Join-Path $Root 'vm.json') $vm }
function Disconnect-VMNetworkAdapter { $a=Get-VMNetworkAdapter; $a.SwitchName='';$a.SwitchId=[guid]::Empty.ToString(); Write-RunnerJson (Join-Path $Root 'adapter.json') $a }
$name=(Get-RunnerState).vmName
if (-not (Invoke-GuardCheck $name)) { throw 'Fixture initialization refused.' }
$vm=Get-VM;$vm.State='Running';Write-RunnerJson (Join-Path $Root 'vm.json') $vm
[IO.File]::WriteAllText((Join-Path $Root 'ready'), [string]$PID)
Start-Sleep -Milliseconds 500
$script:drift=$true
if (-not (Invoke-GuardCheck $name)) { throw 'Fixture guardian removed instead of quarantining.' }
[IO.File]::WriteAllText((Join-Path $Root 'quarantined'), [string]$PID)
'@)
    $exe = Join-Path $PSHOME 'powershell.exe'
    $arguments = @('-NoProfile', '-NonInteractive', '-File', $child, '-Root', $root, '-Source', $PSScriptRoot)
    $start = [Diagnostics.ProcessStartInfo]::new(); $start.FileName = $exe; $start.Arguments = ($arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $worker = [Diagnostics.Process]::Start($start)
    $limit = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath (Join-Path $root 'ready'))) { if ($worker.HasExited -or [DateTime]::UtcNow -ge $limit) { throw 'Fixture guardian failed readiness.' }; Start-Sleep -Milliseconds 50 }
    [void](Invoke-RunnerNative $exe @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 2') -TimeoutSeconds 5)
    if (-not $worker.WaitForExit(5000) -or $worker.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $root 'quarantined')) -or
        (Read-RunnerJson (Join-Path $root 'vm.json')).State -cne 'Paused' -or (Read-RunnerJson (Join-Path $root 'adapter.json')).SwitchName -cne '' -or
        (Get-RunnerState).networkRecovery.phase -cne 'quarantining') { throw 'Independent guardian did not quarantine while supervisor native work was blocked.' }
    Write-Host "Independent guardian process passed: guardian PID $($worker.Id) quarantined TEMP-backed VM while supervisor PID $PID blocked; session retained."
    # The real guardian has now exited in the nonhealthy/readiness=false state.
    # An independently blocked owner must not postpone watchdog cleanup until
    # its native call returns or the fresh progress lease expires.
    $ownerScript = Join-Path $root 'blocked-owner.ps1'
    [IO.File]::WriteAllText($ownerScript, 'param($Root); [IO.File]::WriteAllText((Join-Path $Root ''owner-blocked''), [string]$PID); Start-Sleep -Seconds 30')
    $ownerStart = [Diagnostics.ProcessStartInfo]::new(); $ownerStart.FileName = $exe
    $ownerStart.Arguments = (@('-NoProfile', '-NonInteractive', '-File', $ownerScript, '-Root', $root) | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $ownerStart.UseShellExecute = $false; $ownerStart.CreateNoWindow = $true
    $blockedOwner = [Diagnostics.Process]::Start($ownerStart)
    $limit = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath (Join-Path $root 'owner-blocked'))) { if ($blockedOwner.HasExited -or [DateTime]::UtcNow -ge $limit) { throw 'Fixture native owner did not block.' }; Start-Sleep -Milliseconds 50 }
    $current = Get-RunnerState
    $current.supervisorPid = $blockedOwner.Id; $current.supervisorStartUtc = $blockedOwner.StartTime.ToUniversalTime().ToString('o')
    $current.networkRecovery.binding.claimHash = Get-RunnerRecoveryClaimHash $current
    Write-RunnerJson $script:RunnerStatePath $current
    if ($current.guardianReady -or $current.networkRecovery.phase -cne 'quarantining' -or (Get-RunnerRecoveryExpiry $current.networkRecovery ([DateTime]::UtcNow))) { throw 'Guardian death fixture was not fresh nonhealthy recovery.' }
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
    $watchdog = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-Watchdog' }, $true)
    Invoke-Expression $watchdog.Extent.Text
    function Assert-Administrator {}
    function Assert-SecureRoot {}
    function Invoke-RunnerSupervisorRecovery {}
    function Remove-RunnerInstance($State) {
        $vm = Read-RunnerJson (Join-Path $root 'vm.json')
        if ($vm.Name -cne $State.vmName -or [guid]$vm.Id -ne [guid]$State.vmId -or $vm.State -cne 'Paused' -or
            (Read-RunnerJson (Join-Path $root 'adapter.json')).SwitchName -cne '') { throw 'Watchdog fixture escaped exact quarantined resources.' }
        Remove-Item -LiteralPath (Join-Path $root 'vm.json')
        Remove-Item -LiteralPath $script:RunnerStatePath
    }
    Invoke-Watchdog
    if ($blockedOwner.HasExited -or (Get-RunnerState) -or (Test-Path -LiteralPath (Join-Path $root 'vm.json'))) { throw 'Watchdog failed dead nonready guardian cleanup while native owner remained blocked.' }
    Write-Host "Independent watchdog passed: exited guardian PID $($worker.Id), readiness false, exact TEMP VM removed while native owner PID $($blockedOwner.Id) remained blocked; fresh recovery deadlines."
} finally {
    if ($null -ne $blockedOwner) { if (-not $blockedOwner.HasExited) { $blockedOwner.Kill(); if (-not $blockedOwner.WaitForExit(2000)) { throw 'Fixture native owner cleanup uncertain.' } }; $blockedOwner.Dispose() }
    if ($null -ne $worker) { if (-not $worker.HasExited) { $worker.Kill(); if (-not $worker.WaitForExit(2000)) { throw 'Fixture worker cleanup uncertain.' } }; $worker.Dispose() }
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -cnotmatch '^ITIR-guardprocess-[0-9a-f]{32}$') { throw 'Fixture cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
