# Offline interruption matrix. Uses only TEMP files, private locks and mocked host controls.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
foreach ($name in @('Runner.ps1', 'Update.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$null, [ref]$null)
    foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
}
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-lifecycle-tests-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:lockPrefix = 'Local\ITIR-lifecycle-' + [guid]::NewGuid().ToString('N')
$script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
$script:locks = [Collections.Generic.List[string]]::new()
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    $script:locks.Add($Name)
    return & $script:realEnter ($script:lockPrefix + '-' + $Name.Replace('\', '-')) -FailFast:$FailFast
}
function Assert-Administrator {}
function Write-Host {}
function Assert-SecureRoot {}
function Get-OwnerToken { return 'dummy' }
function Assert-RunnerProtectedPath { param($Path) if ($script:rejectAcl -and $Path.EndsWith($script:rejectAcl)) { throw 'Synthetic unexpected ACL.' }; [void](Assert-OwnedPath $Path) }
function Get-ScheduledTask { param($TaskName) return [pscustomobject]@{ State = $(if ($script:taskRunning) { 'Running' } else { 'Ready' }) } }
function Get-VM { if ($script:vmPresent) { return [pscustomobject]@{ Name = 'ITIR-' + ('c' * 32) } } }
$script:realWaitUpdate = (Get-Command Wait-RunnerUpdateIdle).ScriptBlock
function Wait-RunnerUpdateIdle { & $script:realWaitUpdate -TimeoutSeconds 0 }
function Invoke-InstalledRunnerStop { throw 'Updater invoked destructive Stop.' }
function Invoke-RunnerTransitionCheckpoint {
    param($Name)
    if ($Name -ceq $script:fault) { throw "Synthetic interruption at $Name" }
}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Lifecycle accepted $Case." }
}
function New-Fixture([string] $Name) {
    $script:RunnerRoot = Join-Path $base $Name
    [void][IO.Directory]::CreateDirectory((Join-Path $script:RunnerRoot 'bin'))
    $script:RunnerConfigPath = Join-Path $script:RunnerRoot 'config.json'
    $script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
    $script:taskRunning = $false; $script:vmPresent = $false; $script:rejectAcl = ''; $script:fault = ''
    $script:locks.Clear()
    Write-RunnerJson $script:RunnerConfigPath ([ordered]@{
        schema = 1; tag = $script:RunnerTag; repo = 'example/fixture'; maxMinutes = 120; activation = 'pilot'; label = 'it-inventory-ephemeral'
        pilotExpectedSha = ('a' * 40); pilotWorkflowPath = '.github/workflows/local-runner-pilot.yml'; pilotLabel = ('it-inventory-pilot-' + ('a' * 40))
    })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json') ([ordered]@{ tag = $script:RunnerTag; jobId = 56 })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json') ([ordered]@{ tag = $script:RunnerTag; verified = $false; jobId = 56 })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json') ([ordered]@{ stage = 'network-isolation'; code = 'STAGE_FAILED' })
}
try {
    $retryPoints = @('retry-pending', 'retry-archive', 'retry-disabled', 'retry-remove-pilot-attempt.json', 'retry-remove-pilot-result.json', 'retry-target', 'retry-before-complete', 'retry-complete')
    foreach ($point in $retryPoints) {
        New-Fixture $point
        $script:fault = $point
        Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'reviewed diagnosis' -Retry } $point
        $plan = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json')
        if ($null -eq $plan) { throw 'Interrupted retry lost its durable plan.' }
        if ($plan.phase -eq 'pending') {
            Assert-Rejected { Assert-RunnerTransitionClear } 'pending retry pickup'
            Assert-Rejected { Enable-RunnerPilot ('b' * 40) } 'initial retry bypass'
            Assert-Rejected { Enable-RunnerPilot ('c' * 40) 'reviewed diagnosis' -Retry } 'changed retry SHA'
            Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'different reason' -Retry } 'changed retry reason'
        }
        $script:fault = ''
        Enable-RunnerPilot ('b' * 40) 'reviewed diagnosis' -Retry
        $plan = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json')
        if ($plan.phase -cne 'complete' -or (Get-RunnerConfig).pilotExpectedSha -cne ('b' * 40) -or
            -not (Test-RunnerEvidence (Join-Path (Join-Path $script:RunnerRoot 'pilot-history') ($plan.retryId + '.json')) $plan.archive)) {
            throw "Retry $point did not converge with exact retained evidence."
        }
        $before = Get-RunnerFileEvidence $script:RunnerConfigPath
        Enable-RunnerPilot ('b' * 40) 'reviewed diagnosis' -Retry
        if (-not (Test-RunnerEvidence $script:RunnerConfigPath $before)) { throw 'Completed retry replay changed its target.' }
        Assert-Rejected { Enable-RunnerPilot ('c' * 40) } 'completed journal initial bypass'
        if ($script:locks[0] -cne 'Global\ITInventoryLocalRunner-Control-v1' -or $script:locks[1] -cne 'Global\ITInventoryLocalRunner-Supervisor-v1' -or $script:locks[2] -cne 'Global\ITInventoryLocalRunner-v1') { throw 'Retry lock order changed.' }
    }
    foreach ($changed in @('config', 'receipt', 'archive')) {
        New-Fixture ('retry-changed-' + $changed)
        $script:fault = 'retry-disabled'
        Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'reviewed diagnosis' -Retry } 'injected retry disable interruption'
        $script:fault = ''
        $plan = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json')
        $path = switch ($changed) {
            'config' { $script:RunnerConfigPath }
            'receipt' { Join-Path $script:RunnerRoot 'pilot-attempt.json' }
            'archive' { Join-Path (Join-Path $script:RunnerRoot 'pilot-history') ($plan.retryId + '.json') }
        }
        [IO.File]::AppendAllText($path, ' ')
        $changedEvidence = Get-RunnerFileEvidence $path
        Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'reviewed diagnosis' -Retry } ('unexpected retry ' + $changed)
        if (-not (Test-RunnerEvidence $path $changedEvidence)) { throw 'Retry overwrote changed evidence.' }
    }
    New-Fixture 'retry-sequential'
    Enable-RunnerPilot ('b' * 40) 'first diagnosis' -Retry
    $firstPlan = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json')
    $firstJournal = Get-RunnerFileEvidence (Join-Path $script:RunnerRoot 'pilot-retry.json')
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json') ([ordered]@{ tag = $script:RunnerTag; jobId = 57 })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json') ([ordered]@{ tag = $script:RunnerTag; verified = $false; jobId = 57 })
    Enable-RunnerPilot ('c' * 40) 'second diagnosis' -Retry
    if (-not (Test-RunnerEvidence (Join-Path (Join-Path $script:RunnerRoot 'pilot-history') ($firstPlan.retryId + '.journal.json')) $firstJournal)) {
        throw 'Subsequent retry lost the completed prior journal.'
    }
    $laterReceipt = Join-Path $script:RunnerRoot 'pilot-attempt.json'
    Write-RunnerJson $laterReceipt ([ordered]@{ tag = $script:RunnerTag; jobId = 58 })
    $laterEvidence = Get-RunnerFileEvidence $laterReceipt
    Enable-RunnerPilot ('c' * 40) 'second diagnosis' -Retry
    if (-not (Test-RunnerEvidence $laterReceipt $laterEvidence)) { throw 'Completed replay removed a newly consumed receipt.' }
    $disabled = Get-RunnerConfig; $disabled.activation = 'disabled'; Write-RunnerJson $script:RunnerConfigPath $disabled
    Remove-Item -LiteralPath $laterReceipt
    Assert-Rejected { Enable-RunnerPilot ('d' * 40) } 'initial activation after absent current receipts/history'
    $sourceBundle = Get-RunnerBundle $PSScriptRoot
    $source = Join-Path $base 'source'
    [void][IO.Directory]::CreateDirectory($source)
    foreach ($name in @($sourceBundle.manifest.files.name) + @('Bundle.json')) { [IO.File]::Copy((Join-Path $PSScriptRoot $name), (Join-Path $source $name)) }
    $updatePoints = @('update-pending', 'update-disabled') + @($sourceBundle.manifest.files.name | ForEach-Object { 'update-file-' + $_ }) +
        @('update-file-Bundle.json', 'update-receipt', 'update-restored-config', 'update-before-complete', 'update-complete')
    foreach ($point in $updatePoints) {
        New-Fixture $point
        foreach ($file in $sourceBundle.manifest.files) { [IO.File]::WriteAllText((Join-Path (Join-Path $script:RunnerRoot 'bin') $file.name), 'old fixture ' + $file.name) }
        $old = Get-RunnerFileEvidence $script:RunnerConfigPath
        $preserved = Get-UpdatePreservedHashes
        $script:fault = $point
        Assert-Rejected { Install-RunnerBundle $source } $point
        $plan = Read-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json')
        if ($null -eq $plan) { throw 'Interrupted update lost its durable plan.' }
        if ($plan.phase -eq 'pending') {
            Assert-Rejected { Assert-RunnerTransitionClear } 'pending update pickup'
            Assert-Rejected { Install-RunnerBundle $source } 'implicit update resume'
        }
        $script:fault = ''
        if ($plan.phase -eq 'pending') { Install-RunnerBundle $source -Resume } else { Install-RunnerBundle $source }
        if (-not (Test-InstalledRunnerBundle $source) -or -not (Test-RunnerEvidence $script:RunnerConfigPath $old) -or
            (Read-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json')).phase -cne 'complete') {
            throw "Update $point failed to restore exact old config and coherent bundle."
        }
        Assert-UpdatePreservedHashes $preserved
        if ($script:locks[0] -cne 'Global\ITInventoryLocalRunner-Control-v1' -or $script:locks[1] -cne 'Global\ITInventoryLocalRunner-v1' -or $script:locks[2] -cne 'Global\ITInventoryLocalRunner-Supervisor-v1' -or $script:locks[3] -cne 'Global\ITInventoryLocalRunner-v1') { throw 'Update lock order changed.' }
    }
    foreach ($changed in @('source', 'missing-dependency', 'acl', 'config', 'receipt', 'running-task', 'vm', 'state', 'staged-source')) {
        New-Fixture ('update-invalid-' + $changed)
        foreach ($file in $sourceBundle.manifest.files) { [IO.File]::WriteAllText((Join-Path (Join-Path $script:RunnerRoot 'bin') $file.name), 'old fixture ' + $file.name) }
        $pending = $changed -in @('config', 'receipt', 'staged-source')
        if ($pending) {
            $script:fault = 'update-disabled'; Assert-Rejected { Install-RunnerBundle $source } 'injected update disable interruption'; $script:fault = ''
        }
        switch ($changed) {
            'source' { [IO.File]::AppendAllText((Join-Path $source 'Runner.ps1'), 'changed') }
            'missing-dependency' { Remove-Item -LiteralPath (Join-Path $source 'Runner.ps1') }
            'acl' { $script:rejectAcl = 'bin' }
            'config' { [IO.File]::AppendAllText($script:RunnerConfigPath, ' ') }
            'receipt' { [IO.File]::AppendAllText((Join-Path $script:RunnerRoot 'pilot-attempt.json'), ' ') }
            'running-task' { $script:taskRunning = $true }
            'vm' { $script:vmPresent = $true }
            'state' { Write-RunnerJson $script:RunnerStatePath ([ordered]@{ tag = $script:RunnerTag }) }
            'staged-source' {
                $plan = Read-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json')
                [IO.File]::AppendAllText((Join-Path (Join-Path (Join-Path (Join-Path $script:RunnerRoot 'bin') 'updates') $plan.updateId) 'Runner.ps1'), 'changed')
            }
        }
        $before = Get-RunnerFileEvidence $script:RunnerConfigPath
        Assert-Rejected { Install-RunnerBundle $source -Resume:$pending } ('unexpected update ' + $changed)
        if (-not (Test-RunnerEvidence $script:RunnerConfigPath $before)) { throw 'Refused update changed config.' }
        if ($changed -in @('source', 'missing-dependency')) { [IO.File]::Copy((Join-Path $PSScriptRoot 'Runner.ps1'), (Join-Path $source 'Runner.ps1'), $true) }
    }
    New-Fixture 'update-source-changed-after-pending'
    foreach ($file in $sourceBundle.manifest.files) { [IO.File]::WriteAllText((Join-Path (Join-Path $script:RunnerRoot 'bin') $file.name), 'old fixture ' + $file.name) }
    $script:fault = 'update-pending'; Assert-Rejected { Install-RunnerBundle $source } 'injected pending update'
    $script:fault = ''; [IO.File]::AppendAllText((Join-Path $source 'Runner.ps1'), 'later checkout changed')
    Install-RunnerBundle $source -Resume
    [IO.File]::Copy((Join-Path $PSScriptRoot 'Runner.ps1'), (Join-Path $source 'Runner.ps1'), $true)
    if (-not (Test-InstalledRunnerBundle $source)) { throw 'Explicit resume silently adopted later checkout rather than retained bundle.' }
    # Existing-config option 2 must perform the versioned update/resume path.
    $menu = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'SetupMenu.ps1'), [ref]$null, [ref]$null)
    $menuSwitch = $menu.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true)
    $clause = @($menuSwitch.Clauses | Where-Object { $_.Item1.Value -eq '2' })[0].Item2
    $control = [scriptblock]::Create($clause.Extent.Text.Substring(1, $clause.Extent.Text.Length - 2))
    $script:menuUpdates = [Collections.Generic.List[bool]]::new()
    function Install-ControlLinks {}
    function Install-RunnerBundle { param($SourceRoot, [switch]$Resume) $script:menuUpdates.Add([bool]$Resume) }
    & $control
    Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') ([ordered]@{ tag = $script:RunnerTag; phase = 'pending' })
    & $control
    if ($script:menuUpdates.Count -ne 2 -or $script:menuUpdates[0] -or -not $script:menuUpdates[1]) { throw 'Repository menu skipped installed bundle update/resume.' }
    # The actual menu retry clause may pass a pending retry, but not an update.
    Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') ([ordered]@{ tag = $script:RunnerTag; phase = 'complete' })
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json') ([ordered]@{
        tag = $script:RunnerTag; phase = 'pending'; schema = 1; retryId = ('a' * 32); nextSha = ('b' * 40); reason = 'recorded fixture value'
    })
    function Test-InstalledRunnerBundle { return $true }
    function Get-CoherentInstalledRunnerBundle { return [pscustomobject]@{ verified = $true } }
    function Read-Host { return 'recorded fixture value' }
    $sink = Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1'
    [IO.File]::WriteAllText($sink, @'
param($Action, $ExpectedPilotSha, $RetryReason)
if ($Action -ne 'RetryPilot' -or $ExpectedPilotSha -ne ('b' * 40) -or $RetryReason -ne 'recorded fixture value') { throw 'Menu retry parameters changed.' }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'menu-resumed'), 'called')
'@)
    $clause = @($menuSwitch.Clauses | Where-Object { $_.Item1.Value -eq '9' })[0].Item2
    $control = [scriptblock]::Create($clause.Extent.Text.Substring(1, $clause.Extent.Text.Length - 2))
    & $control
    if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $sink -Parent) 'menu-resumed'))) { throw 'Menu retry guard blocked legitimate pending retry resume.' }
    Remove-Item -LiteralPath (Join-Path (Split-Path $sink -Parent) 'menu-resumed')
    Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') ([ordered]@{ tag = $script:RunnerTag; phase = 'pending' })
    Assert-Rejected { & $control } 'menu retry during pending update'
    if (Test-Path -LiteralPath (Join-Path (Split-Path $sink -Parent) 'menu-resumed')) { throw 'Menu retried while update was pending.' }
    Microsoft.PowerShell.Utility\Write-Host "Lifecycle recovery checks passed: $($retryPoints.Count) retry interruption points; $($updatePoints.Count) update interruption points; mismatch/idle/lock checks."
} finally {
    $resolved = [IO.Path]::GetFullPath($base)
    if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
