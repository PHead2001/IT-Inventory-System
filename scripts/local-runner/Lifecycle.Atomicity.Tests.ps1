# Real-process owner/claim races and exact initial-publication recovery. TEMP only.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
foreach ($name in @('Runner.ps1', 'Update.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$null, [ref]$null)
    foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
}
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-atomicity-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    & $script:realEnter ('Local\' + [IO.Path]::GetFileName($script:RunnerRoot) + '-' + $Name.Replace('\', '-')) -FailFast:$FailFast
}
function Assert-Administrator {}
function Assert-SecureRoot {}
function Assert-InstalledHost { param($Config) }
function Assert-RunnerProtectedPath { param($Path) [void](Assert-OwnedPath $Path) }
function Get-OwnerToken { 'dummy' }
function Get-VM {}
function Get-ScheduledTask { [pscustomobject]@{ State = 'Ready' } }
function Write-Host {}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Atomicity accepted $Case." }
}
function New-Fixture([string] $Name) {
    $script:RunnerRoot = Join-Path $base ('ITIR-' + $Name + '-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory((Join-Path $script:RunnerRoot 'bin'))
    $script:RunnerConfigPath = Join-Path $script:RunnerRoot 'config.json'
    $script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
    Write-RunnerJson $script:RunnerConfigPath ([ordered]@{
        schema = 1; tag = $script:RunnerTag; repo = 'example/fixture'; maxMinutes = 120; activation = 'pilot'; label = 'it-inventory-ephemeral'
        pilotExpectedSha = ('a' * 40); pilotWorkflowPath = '.github/workflows/local-runner-pilot.yml'; pilotLabel = ('it-inventory-pilot-' + ('a' * 40))
    })
}
function Wait-Signal([string] $Name) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot $Name))) {
        $refusal = @(Get-ChildItem -LiteralPath $script:RunnerRoot -Filter 'refused-*')
        if ($refusal.Count -gt 0) { throw ('Fixture refused before signal: ' + [IO.File]::ReadAllText($refusal[0].FullName)) }
        if ([DateTime]::UtcNow -ge $deadline) { throw "Fixture failed to signal $Name." }
        [Threading.Thread]::Sleep(20)
    }
}
function Start-Child([string] $Mode, [string] $Point = '', [string] $Source = '') {
    $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $childPath,
        '-Scripts', $PSScriptRoot, '-Root', $script:RunnerRoot, '-Mode', $Mode, '-Point', $Point, '-Source', $Source)
    $encoded = @($args | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    Start-Process powershell.exe -ArgumentList $encoded -WindowStyle Hidden -PassThru
}
function Finish-Child($Child, [int] $Expected) {
    if (-not $Child.WaitForExit(15000)) { throw 'Fixture process failed to terminate.' }
    if ($Child.ExitCode -ne $Expected) { throw "Fixture exit $($Child.ExitCode), expected $Expected." }
    $Child.Dispose()
}
$childPath = Join-Path $base 'child.ps1'
[IO.File]::WriteAllText($childPath, @'
param($Scripts, $Root, $Mode, $Point, $Source)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $Scripts 'Common.ps1')
foreach ($name in @('Runner.ps1', 'Update.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Scripts $name), [ref]$null, [ref]$null)
    foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
}
$script:RunnerRoot = $Root; $script:RunnerConfigPath = Join-Path $Root 'config.json'; $script:RunnerStatePath = Join-Path $Root 'state.json'
$script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    & $script:realEnter ('Local\' + [IO.Path]::GetFileName($Root) + '-' + $Name.Replace('\', '-')) -FailFast:$FailFast
}
function Assert-Administrator {}
function Assert-SecureRoot {}
function Assert-RunnerProtectedPath { param($Path) [void](Assert-OwnedPath $Path) }
function Assert-InstalledHost { param($Config) }
function Get-OwnerToken { 'dummy' }
function Get-VM {}
function Get-ScheduledTask { [pscustomobject]@{ State = 'Ready' } }
function Start-ScheduledTask { [IO.File]::WriteAllText((Join-Path $Root 'unexpected-task'), 'started') }
function Stop-ScheduledTask { throw 'Unexpected destructive task stop.' }
function Read-Host { throw 'Concurrent credential control reached the secret prompt.' }
function Copy-Item { throw 'Claim reached disk copy before the fixture boundary.' }
function Write-Host {}
function Invoke-RunnerTransitionCheckpoint {
    param($Name)
    if ($Name -ceq $Point) {
        [IO.File]::WriteAllText((Join-Path $Root 'paused'), $Name)
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while (-not (Test-Path -LiteralPath (Join-Path $Root 'release'))) {
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Fixture pause timed out.' }
            [Threading.Thread]::Sleep(20)
        }
    }
    if ($Name -ceq 'claim-receipt') { throw 'Fixture ends after the complete claim, before disk/VM/JIT.' }
}
[IO.File]::WriteAllText((Join-Path $Root ('entered-' + $Mode)), 'entered')
try {
    switch ($Mode) {
        'claim' {
            $attempt = [pscustomobject]@{ tag = $script:RunnerTag; jobId = 56; runId = 1; workflowId = 2; runAttempt = 1; workflowPath = '.github/workflows/local-runner-pilot.yml'; headSha = ('a' * 40); pilotLabel = ('it-inventory-pilot-' + ('a' * 40)); consumedUtc = [DateTime]::UtcNow.ToString('o') }
            Invoke-RunnerSession (Get-RunnerConfig) $attempt
        }
        'marker' { Wait-RunnerUpdateIdle }
        'update' { Install-RunnerBundle $Source }
        default {
            $Action = $Mode; $ExpectedPilotSha = 'b' * 40; $RetryReason = 'fixture'; $SessionName = 'ITIR-' + ('a' * 32)
            $text = [IO.File]::ReadAllText((Join-Path $Scripts 'Runner.ps1'))
            Invoke-Expression $text.Substring($text.IndexOf('$actionControl = $null'))
        }
    }
    exit 0
} catch { [IO.File]::WriteAllText((Join-Path $Root ('refused-' + $Mode)), $_.Exception.Message); exit 3 }
'@, [Text.UTF8Encoding]::new($false))
try {
    # Claim wins: updater must wait for both claim writes, then refuse without a marker.
    New-Fixture 'claim-first'
    $claim = Start-Child 'claim' 'claim-state'
    Wait-Signal 'paused'
    $marker = Start-Child 'marker'
    Wait-Signal 'entered-marker'
    if ($marker.WaitForExit(300) -or (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) { throw 'Updater crossed an in-progress state/receipt claim.' }
    [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'release'), 'release')
    Finish-Child $claim 3; Finish-Child $marker 3
    if (-not (Get-RunnerState) -or -not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) -or
        (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) { throw 'Committed claim was consumed/suspended incorrectly.' }
    # Suspension wins: claim waits for publication and then refuses without either write.
    New-Fixture 'marker-first'
    $marker = Start-Child 'marker' 'update-marker'
    Wait-Signal 'paused'
    $claim = Start-Child 'claim'
    Wait-Signal 'entered-claim'
    if ($claim.WaitForExit(300)) { throw 'Claim did not serialize behind marker publication.' }
    [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'release'), 'release')
    Finish-Child $marker 0; Finish-Child $claim 3
    if ((Get-RunnerState) -or (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json'))) { throw 'Suspended claim wrote state or consumed pilot.' }
    # Abrupt process loss in the write gap. Cleanup completes exact receipt first.
    New-Fixture 'claim-crash'
    $claim = Start-Child 'claim' 'claim-state'
    Wait-Signal 'paused'
    $claim.Kill(); [void]$claim.WaitForExit(10000); $claim.Dispose()
    $state = Get-RunnerState
    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) { throw 'Crash fixture did not hit receipt gap.' }
    $receiptPath = Join-Path $script:RunnerRoot 'pilot-attempt.json'
    Write-RunnerJson $receiptPath ([ordered]@{ tampered = $true })
    Assert-Rejected { Remove-RunnerInstance $state } 'mismatched claim cleanup'
    if (-not (Get-RunnerState)) { throw 'Receipt mismatch erased committed state.' }
    Remove-Item -LiteralPath $receiptPath
    $state.pilotClaim.hash = '0' * 64
    Assert-Rejected { Remove-RunnerInstance $state } 'invalid committed claim'
    if (-not (Get-RunnerState)) { throw 'Invalid claim erased committed state.' }
    $state = Get-RunnerState
    $incomplete = Get-RunnerState
    $incomplete.PSObject.Properties.Remove('pilotClaim')
    Assert-Rejected { Remove-RunnerInstance $incomplete } 'missing committed pilot claim'
    if (-not (Get-RunnerState)) { throw 'Missing claim evidence erased state.' }
    $lock = Enter-RunnerLock
    try { Remove-RunnerInstance $state } finally { Exit-RunnerLock $lock }
    if ((Get-RunnerState) -or -not (Test-RunnerEvidence $receiptPath $state.pilotClaim)) { throw 'Crash recovery did not complete exact receipt before state deletion.' }
    function Get-QueuedRunnerJob { throw 'Recovered pilot attempted another actual job.' }
    Invoke-SupervisorLoop
    New-Fixture 'receipt-write-failure'
    $attempt = Get-RunnerEvidenceValue $state.pilotClaim
    $script:realWrite = (Get-Command Write-RunnerBytes).ScriptBlock
    function Write-RunnerBytes { param($Path, $Bytes) if ($Path.EndsWith('pilot-attempt.json')) { throw 'Synthetic receipt write failure.' }; & $script:realWrite $Path $Bytes }
    Assert-Rejected { Invoke-RunnerSession (Get-RunnerConfig) $attempt } 'receipt write failure'
    Set-Item Function:Write-RunnerBytes $script:realWrite
    $failedClaim = Get-RunnerState
    if ($null -eq $failedClaim -or (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) -or
        (Test-Path -LiteralPath $failedClaim.instancePath)) { throw 'Receipt failure erased state or began VM preparation.' }
    Invoke-SupervisorLoop # Must return before selecting another job while failed state remains.
    $lock = Enter-RunnerLock
    try { Remove-RunnerInstance $failedClaim } finally { Exit-RunnerLock $lock }
    New-Fixture 'state-write-failure'
    $script:realJsonWrite = (Get-Command Write-RunnerJson).ScriptBlock
    function Write-RunnerJson { param($Path, $Value) if ($Path -ceq $script:RunnerStatePath) { throw 'Synthetic initial state write failure.' }; & $script:realJsonWrite $Path $Value }
    Assert-Rejected { Invoke-RunnerSession (Get-RunnerConfig) $attempt } 'initial state write failure'
    Set-Item Function:Write-RunnerJson $script:realJsonWrite
    if ((Get-RunnerState) -or (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) -or
        (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'instances'))) { throw 'Failed initial state write consumed pilot or began VM preparation.' }
    # Real updater owns control mutex through replacement. Every sibling action
    # refuses immediately, with no prompt/task and no queued post-update execution.
    New-Fixture 'owner-controls'
    $bin = Join-Path $script:RunnerRoot 'bin'; $source = Join-Path $base 'source'
    [void][IO.Directory]::CreateDirectory($source)
    foreach ($file in @(Get-RunnerBundleNames) + @('Bundle.json')) { [IO.File]::Copy((Join-Path $PSScriptRoot $file), (Join-Path $bin $file)); [IO.File]::Copy((Join-Path $PSScriptRoot $file), (Join-Path $source $file)) }
    $bundle = Get-RunnerBundle $bin
    Write-RunnerJson (Join-Path $script:RunnerRoot 'installed-bundle.json') ([ordered]@{ tag = $script:RunnerTag; version = $bundle.manifest.version; manifestHash = $bundle.hash })
    $manifest = Get-Content -LiteralPath (Join-Path $source 'Bundle.json') -Raw | ConvertFrom-Json
    $manifest.version = '2099-01-01.1'
    [IO.File]::WriteAllText((Join-Path $source 'Bundle.json'), (ConvertTo-Json $manifest -Depth 5), [Text.UTF8Encoding]::new($false))
    $update = Start-Child 'update' 'update-pending' $source
    Wait-Signal 'paused'
    foreach ($action in @('Start', 'Restart', 'Stop', 'EnablePilot', 'RetryPilot', 'EnableActive', 'StoreCredential', 'update')) {
        $contender = Start-Child $action '' $source
        Finish-Child $contender 3
        $message = [IO.File]::ReadAllText((Join-Path $script:RunnerRoot ('refused-' + $action)))
        if ($message -notlike 'Runner state is busy*') { throw "Concurrent $action reached state/prompt instead of fail-fast control refusal." }
    }
    [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'release'), 'release'); Finish-Child $update 0
    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'unexpected-task')) { throw 'A refused owner action ran after update.' }
    # Start while lifetime mutex is held must succeed (idle persistent supervisor).
    $lifetime = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1'
    try { $start = Start-Child 'Start'; Finish-Child $start 0 } finally { Exit-RunnerLock $lifetime }
    if (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'unexpected-task'))) { throw 'Start acquired supervisor lifetime lock.' }
    [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop')
    $owner = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Control-v1'
    try {
        foreach ($action in @('Watchdog', 'Guard', 'Supervise')) { $background = Start-Child $action; Finish-Child $background 0 }
    } finally { Exit-RunnerLock $owner }
    $restart = Start-Child 'Restart'; Finish-Child $restart 0
    $stop = Start-Child 'Stop'; Finish-Child $stop 0
    # Initial publication interruption after every final write and completion.
    $points = @('setup-pending') + @((Get-RunnerBundleNames) | ForEach-Object { 'setup-file-' + $_ }) + @('setup-file-Bundle.json', 'setup-receipt', 'setup-config', 'setup-complete', 'setup-stage-removed')
    foreach ($point in $points) {
        New-Fixture $point
        Remove-Item -LiteralPath $script:RunnerConfigPath
        $stagePath = Join-Path $script:RunnerRoot 'setup-stage.json'
        Write-RunnerJson $stagePath ([ordered]@{ tag = $script:RunnerTag; repo = 'example/fixture'; group = 1; helperName = 'ITInventoryImageConverter-' + ('a' * 32) })
        $bundle = Get-RunnerBundle $PSScriptRoot
        $files = foreach ($name in @(Get-RunnerBundleNames) + @('Bundle.json')) { [pscustomobject]@{ name = $name; evidence = Get-RunnerBytesEvidence ([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name))) } }
        $plan = [pscustomobject]@{
            schema = 1; tag = $script:RunnerTag; phase = 'pending'; files = @($files); stage = Get-RunnerFileEvidence $stagePath
            config = Get-RunnerJsonEvidence ([ordered]@{ schema = 1; tag = $script:RunnerTag; repo = 'example/fixture'; runnerGroupId = 1; activation = 'disabled' })
            receipt = Get-RunnerJsonEvidence ([ordered]@{ tag = $script:RunnerTag; version = $bundle.manifest.version; manifestHash = $bundle.hash })
        }
        Write-RunnerJson (Join-Path $script:RunnerRoot 'setup-publication.json') $plan
        $script:fault = $point
        function Invoke-RunnerTransitionCheckpoint { param($Name) if ($Name -ceq $script:fault) { throw 'Publication interruption.' } }
        Assert-Rejected { Invoke-RunnerTransitionCheckpoint 'setup-pending'; Complete-RunnerSetupPublication $plan } $point
        $script:fault = ''
        $plan = Read-RunnerJson (Join-Path $script:RunnerRoot 'setup-publication.json')
        if ($plan.phase -ceq 'pending') { Assert-Rejected { Assert-RunnerTransitionClear } 'pending setup activation' }
        $tamperPath = Join-Path (Join-Path $script:RunnerRoot 'bin') 'Common.ps1'
        $before = Get-RunnerFileEvidence $tamperPath
        [IO.File]::WriteAllText($tamperPath, '# unrelated checkout bytes')
        Assert-Rejected { Resume-RunnerSetupPublication } 'tampered existing publication file'
        if ($before.exists) { Write-RunnerBytes $tamperPath ([Convert]::FromBase64String($before.content)) } else { Remove-Item -LiteralPath $tamperPath }
        # Actual option 2 chooses retained publication before updater/new checkout.
        $menu = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'SetupMenu.ps1'), [ref]$null, [ref]$null)
        $switch = $menu.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true)
        $clause = @($switch.Clauses | Where-Object { $_.Item1.Value -eq '2' })[0].Item2
        $control = [scriptblock]::Create($clause.Extent.Text.Substring(1, $clause.Extent.Text.Length - 2).Replace('$PSScriptRoot', '$laterCheckout'))
        $laterCheckout = Join-Path $base 'nonexistent-later-checkout'
        function Install-ControlLinks {}
        if ($plan.phase -ceq 'pending' -or (Test-Path -LiteralPath $stagePath)) { & $control } else { Resume-RunnerSetupPublication }
        $completed = Read-RunnerJson (Join-Path $script:RunnerRoot 'setup-publication.json')
        if ($completed.phase -cne 'complete' -or (Test-Path -LiteralPath $stagePath) -or -not (Test-RunnerEvidence $script:RunnerConfigPath $plan.config)) { throw 'Setup publication did not finish exact recorded config once.' }
        [void](Get-CoherentInstalledRunnerBundle)
        Resume-RunnerSetupPublication
        Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'installed-bundle.json')
        Assert-Rejected { Resume-RunnerSetupPublication } 'arbitrary missing receipt after completed setup'
    }
    Microsoft.PowerShell.Utility\Write-Host "Lifecycle atomicity passed: two real-process claim/marker orderings, abrupt claim crash/recovery, eight concurrent fail-fast controls, held-lifetime Start, $($points.Count) exact setup publication interruption points."
} finally {
    $resolved = [IO.Path]::GetFullPath($base)
    if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^ITIR-atomicity-[0-9a-f]{32}$') { throw 'Test cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
