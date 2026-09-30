# Offline real-process claim races and installed-control/version behavior. No host controls run.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
foreach ($name in @('Runner.ps1', 'Update.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$null, [ref]$null)
    foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
}
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-update-controls-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
$script:lockPrefix = 'Local\ITIR-update-controls-' + [guid]::NewGuid().ToString('N')
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) { & $script:realEnter ($script:lockPrefix + '-' + $Name.Replace('\', '-')) -FailFast:$FailFast }
# Capacity behavior has its own mocked-CIM suite; claim races must not depend on host load.
function Get-RunnerMemoryAdmission { return [pscustomobject]@{ ready = $true; availableBytes = 32GB } }
function Assert-Administrator {}
function Assert-SecureRoot {}
function Assert-RunnerProtectedPath { param($Path) [void](Assert-OwnedPath $Path); if ($script:badAcl -and $Path.EndsWith($script:badAcl)) { throw 'Unexpected ACL fixture.' } }
function Get-OwnerToken { 'dummy' }
function Get-ScheduledTask { param($TaskName) [pscustomobject]@{ State = $(if ($script:taskRunning) { 'Running' } else { 'Ready' }) } }
function Get-VM { if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'vm.marker')) { [pscustomobject]@{ Name = 'ITIR-' + ('c' * 32) } } }
function Stop-ScheduledTask { throw 'Update attempted destructive task stop.' }
function Remove-RunnerInstance { throw 'Update attempted destructive session removal.' }
function Invoke-InstalledRunnerStop { throw 'Update attempted destructive Stop.' }
function Write-Host {}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Update controls accepted $Case." }
}
function Publish-Bundle([string] $Root, [string] $Version) {
    $names = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Bundle.json') -Raw | ConvertFrom-Json).files.name
    $files = foreach ($name in $names) { [ordered]@{ name = $name; hash = (Get-FileHash -LiteralPath (Join-Path $Root $name) -Algorithm SHA256).Hash } }
    $manifest = [ordered]@{ schema = 1; tag = $script:RunnerTag; version = $Version; files = @($files) }
    [IO.File]::WriteAllText((Join-Path $Root 'Bundle.json'), (ConvertTo-Json -InputObject $manifest -Depth 5), [Text.UTF8Encoding]::new($false))
}
function New-Fixture([string] $Name, [string] $OldVersion = '2026-09-29.9', [string] $NewVersion = '2026-09-29.10') {
    $script:RunnerRoot = Join-Path $base $Name
    $script:RunnerConfigPath = Join-Path $script:RunnerRoot 'config.json'
    $script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
    $script:taskRunning = $false; $script:badAcl = ''; $script:fault = ''; $script:racePoint = ''; $script:claim = ''
    $bin = Join-Path $script:RunnerRoot 'bin'; $source = Join-Path $base ($Name + '-source')
    foreach ($root in @($bin, $source)) {
        [void][IO.Directory]::CreateDirectory($root)
        foreach ($file in (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Bundle.json') -Raw | ConvertFrom-Json).files) {
            [IO.File]::Copy((Join-Path $PSScriptRoot $file.name), (Join-Path $root $file.name))
        }
    }
    [IO.File]::AppendAllText((Join-Path $source 'Common.ps1'), "`n# newer fixture bundle`n")
    Publish-Bundle $bin $OldVersion; Publish-Bundle $source $NewVersion
    $installed = Get-RunnerBundle $bin
    Write-RunnerJson (Join-Path $script:RunnerRoot 'installed-bundle.json') ([ordered]@{ tag = $script:RunnerTag; version = $OldVersion; manifestHash = $installed.hash })
    Write-RunnerJson $script:RunnerConfigPath ([ordered]@{
        schema = 1; tag = $script:RunnerTag; repo = 'example/fixture'; maxMinutes = 120; activation = 'pilot'; label = 'it-inventory-ephemeral'
        pilotExpectedSha = ('a' * 40); pilotWorkflowPath = '.github/workflows/local-runner-pilot.yml'; pilotLabel = ('it-inventory-pilot-' + ('a' * 40))
    })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json') ([ordered]@{ tag = $script:RunnerTag; jobId = 56 })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json') ([ordered]@{ tag = $script:RunnerTag; verified = $false; jobId = 56 })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json') ([ordered]@{ stage = 'network-isolation'; code = 'STAGE_FAILED' })
    return $source
}
function Get-Snapshot {
    $records = [ordered]@{}
    foreach ($path in @(Get-ChildItem -LiteralPath (Join-Path $script:RunnerRoot 'bin') -File).FullName +
        @($script:RunnerConfigPath, (Join-Path $script:RunnerRoot 'installed-bundle.json'), (Join-Path $script:RunnerRoot 'pilot-attempt.json'), (Join-Path $script:RunnerRoot 'pilot-result.json'))) {
        $records[$path] = Get-RunnerFileEvidence $path
    }
    return $records
}
function Assert-Snapshot($Snapshot) {
    foreach ($path in $Snapshot.Keys) { if (-not (Test-RunnerEvidence $path $Snapshot[$path])) { throw 'Refused update mutated bundle/config/pilot evidence.' } }
    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'update-journal.json')) { throw 'Refused update created a replacement plan.' }
    if (Test-Path -LiteralPath (Join-Path (Join-Path $script:RunnerRoot 'bin') 'updates')) { throw 'Refused update staged replacement files.' }
}
function Invoke-RunnerTransitionCheckpoint {
    param($Name)
    if ($Name -ceq $script:fault) { throw 'Injected interruption.' }
    if ($Name -ceq $script:racePoint) {
        [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'claim.signal'), 'claim')
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while (-not (Test-Path -LiteralPath $script:RunnerStatePath)) {
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Race fixture child did not publish a session.' }
            [Threading.Thread]::Sleep(10)
        }
    }
}
try {
    # A separate process models a legacy supervisor claiming after the precheck.
    $childPath = Join-Path $base 'claim.ps1'
    [IO.File]::WriteAllText($childPath, @'
param($Root)
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while (-not (Test-Path -LiteralPath (Join-Path $Root 'claim.signal'))) {
    if ([DateTime]::UtcNow -ge $deadline) { exit 2 }
    [Threading.Thread]::Sleep(10)
}
[IO.File]::WriteAllText((Join-Path $Root 'state.json'), '{"tag":"it-inventory-local-runner-v1","vmName":"ITIR-cccccccccccccccccccccccccccccccc"}')
exit 0
'@)
    foreach ($point in @('update-wait', 'update-acknowledged')) {
        $source = New-Fixture $point
        $snapshot = Get-Snapshot; $script:racePoint = $point
        $child = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $childPath + '"'), '-Root', ('"' + $script:RunnerRoot + '"')) -WindowStyle Hidden -PassThru
        try {
            Assert-Rejected { Install-RunnerBundle $source } ('raced claim at ' + $point)
            if (-not $child.WaitForExit(10000) -or $child.ExitCode -ne 0) { throw 'Legacy claim fixture failed.' }
            if (-not (Get-RunnerState)) { throw 'Updater removed the raced session.' }
            Assert-Snapshot $snapshot
        } finally { $child.Dispose() }
    }
    $source = New-Fixture 'timeout'
    $snapshot = Get-Snapshot; $script:taskRunning = $true
    Assert-Rejected { Wait-RunnerUpdateIdle -TimeoutSeconds 0 } 'graceful timeout'
    Assert-Snapshot $snapshot
    if (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) { throw 'Timeout lost the suspension marker.' }
    $source = New-Fixture 'marker-removed'
    $snapshot = Get-Snapshot
    $savedCheckpoint = (Get-Command Invoke-RunnerTransitionCheckpoint).ScriptBlock
    function Invoke-RunnerTransitionCheckpoint { param($Name) if ($Name -eq 'update-acknowledged') { Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested') } }
    Assert-Rejected { Install-RunnerBundle $source } 'concurrent Start removed marker'
    Assert-Snapshot $snapshot
    Set-Item Function:Invoke-RunnerTransitionCheckpoint $savedCheckpoint
    foreach ($versions in @(@('2026-09-29.10', '2026-09-29.9'), @('2026-09-29.9', '2026-09-29.9'), @('2026-09-30.1', '2026-09-29.99'))) {
        $source = New-Fixture ('version-' + $versions[0] + '-' + $versions[1]) $versions[0] $versions[1]
        $snapshot = Get-Snapshot
        Assert-Rejected { Install-RunnerBundle $source } 'older/equal changed version'
        Assert-Snapshot $snapshot
        if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { throw 'Rejected version suspended pickup.' }
    }
    foreach ($invalid in @('receipt', 'manifest', 'dependency', 'acl')) {
        $source = New-Fixture ('installed-invalid-' + $invalid)
        switch ($invalid) {
            'receipt' { Write-RunnerJson (Join-Path $script:RunnerRoot 'installed-bundle.json') ([ordered]@{ tag = $script:RunnerTag; version = 'bad'; manifestHash = ('A' * 64) }) }
            'manifest' { Publish-Bundle (Join-Path $script:RunnerRoot 'bin') '2026-02-30.1' }
            'dependency' { Remove-Item -LiteralPath (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Guest.Network.ps1') }
            'acl' { $script:badAcl = 'Bundle.json' }
        }
        Assert-Rejected { Install-RunnerBundle $source } ('invalid installed ' + $invalid)
        if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { throw 'Invalid installed bundle suspended pickup.' }
    }
    $source = New-Fixture 'numeric-upgrade'
    Install-RunnerBundle $source # .10 must exceed .9 numerically.
    if (-not (Test-InstalledRunnerBundle $source)) { throw 'Numeric revision upgrade failed.' }
    Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')
    Install-RunnerBundle $source
    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { throw 'Exact bundle no-op suspended pickup.' }
    # Real pending retry, a newer checkout, real installed-manifest checks and actual option9.
    $source = New-Fixture 'menu-new-checkout'
    $bin = Join-Path $script:RunnerRoot 'bin'
    [IO.File]::WriteAllText((Join-Path $bin 'Runner.ps1'), @'
param($Action, $ExpectedPilotSha, $RetryReason)
if ($Action -ne 'RetryPilot') { throw 'Unexpected installed menu action.' }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'retry-invocation.json'), (ConvertTo-Json @{ sha = $ExpectedPilotSha; reason = $RetryReason }))
'@)
    Publish-Bundle $bin '2026-09-29.9'
    $bundle = Get-RunnerBundle $bin
    Write-RunnerJson (Join-Path $script:RunnerRoot 'installed-bundle.json') ([ordered]@{ tag = $script:RunnerTag; version = $bundle.manifest.version; manifestHash = $bundle.hash })
    $script:fault = 'retry-disabled'
    Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'retained reason' -Retry } 'interrupted retry'
    $script:fault = ''
    Assert-Rejected { Assert-RunnerBundleCurrent $source } 'new checkout fresh control mismatch'
    $menu = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'SetupMenu.ps1'), [ref]$null, [ref]$null)
    $menuSwitch = $menu.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true)
    $clause = @($menuSwitch.Clauses | Where-Object { $_.Item1.Value -eq '9' })[0].Item2
    # Supply the newer checkout in the actual extracted clause, whose PSScriptRoot would otherwise be this test file.
    $control = [scriptblock]::Create($clause.Extent.Text.Substring(1, $clause.Extent.Text.Length - 2).Replace('$PSScriptRoot', '$source'))
    function Read-Host { throw 'Pending menu recovery requested new parameters instead of recorded intent.' }
    $runnerEvidence = Get-RunnerFileEvidence (Join-Path $bin 'Runner.ps1')
    [IO.File]::AppendAllText((Join-Path $bin 'Runner.ps1'), '# tampered')
    Assert-Rejected { & $control } 'tampered installed retry bundle'
    Write-RunnerBytes (Join-Path $bin 'Runner.ps1') ([Convert]::FromBase64String($runnerEvidence.content))
    Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') ([ordered]@{ tag = $script:RunnerTag; phase = 'pending' })
    Assert-Rejected { & $control } 'pending update retry control'
    Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'update-journal.json')
    & $control
    $invocation = Get-Content -LiteralPath (Join-Path $bin 'retry-invocation.json') -Raw | ConvertFrom-Json
    if ($invocation.sha -cne ('b' * 40) -or $invocation.reason -cne 'retained reason') { throw 'Menu changed recorded retry intent.' }
    Enable-RunnerPilot $invocation.sha $invocation.reason -Retry
    if ((Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json')).phase -cne 'complete' -or (Get-RunnerConfig).pilotExpectedSha -cne ('b' * 40)) { throw 'Menu did not resume exact installed retry.' }
    Install-RunnerBundle $source
    if (-not (Test-InstalledRunnerBundle $source)) { throw 'Completed retry could not subsequently update.' }
    # Execute claim boundaries, rather than only checking source text.
    $source = New-Fixture 'claim-gates'
    Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')
    function Assert-InstalledHost { param($Config) }
    [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop')
    Assert-Rejected { Invoke-RunnerSession (Get-RunnerConfig) } 'session creation after suspension'
    if (Get-RunnerState) { throw 'Suspended session gate created state.' }
    Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')
    function Get-QueuedRunnerJob { param($Config, $Token) [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop'); [pscustomobject]@{ id = 56 } }
    Invoke-SupervisorLoop
    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) { throw 'Queue inspection race consumed pilot.' }
    Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')
    function Get-QueuedRunnerJob { param($Config, $Token) [pscustomobject]@{ id = 56; labels = @('self-hosted', $Config.pilotLabel); pilotBinding = [pscustomobject]@{ runId = 1 } } }
    function Get-PilotEvidence { param($Config, $Binding, $Token) [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop'); [pscustomobject]@{ job = [pscustomobject]@{ status = 'queued'; labels = @('self-hosted', $Config.pilotLabel); runner_id = 0 } } }
    function Write-EventLog {}
    function Start-Sleep {}
    Invoke-SupervisorLoop
    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) { throw 'Fresh metadata race consumed pilot.' }
    # Status explains completed history without incorrectly claiming pickup is blocked.
    foreach ($name in @('last-error.json', 'pilot-result.json')) { Remove-Item -LiteralPath (Join-Path $script:RunnerRoot $name) }
    $runnerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
    $actionSwitch = $runnerAst.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] -and $node.Condition.Extent.Text -eq '$Action' }, $true)
    $statusClause = @($actionSwitch.Clauses | Where-Object { $_.Item1.Value -eq 'Status' })[0].Item2
    $statusControl = [scriptblock]::Create($statusClause.Extent.Text.Substring(1, $statusClause.Extent.Text.Length - 2))
    $script:messages = [Collections.Generic.List[string]]::new()
    function Write-Host { param($Object) $script:messages.Add([string]$Object) }
    foreach ($phase in @('complete', 'pending', 'invalid')) {
        Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json') ([ordered]@{ tag = $script:RunnerTag; phase = $phase })
        $script:messages.Clear(); & $statusControl
        $journalLine = @($script:messages | Where-Object { $_ -like 'Lifecycle journal*' })[0]
        if ($phase -eq 'complete') {
            if ($journalLine -notlike '*does not block pickup*') { throw 'Completed status still claims pickup is blocked.' }
            Assert-RunnerTransitionClear
        } else {
            if ($journalLine -notlike '*pickup is blocked*') { throw 'Pending/invalid status omitted pickup refusal.' }
            Assert-Rejected { Assert-RunnerTransitionClear } 'pending/invalid status journal'
        }
    }
    Microsoft.PowerShell.Utility\Write-Host 'Update controls passed: two real-process claim races, graceful timeout/marker refusal, installed retry across checkout change, version ordering/coherence and claim gates.'
} finally {
    $resolved = [IO.Path]::GetFullPath($base)
    if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
