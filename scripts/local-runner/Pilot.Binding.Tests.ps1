# Offline pilot assignment/proof/retry checks. All files are disposable TEMP fixtures.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    Invoke-Expression $definition.Extent.Text
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-pilot-binding-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$script:RunnerRoot = $testRoot
$script:RunnerConfigPath = Join-Path $testRoot 'config.json'
$script:RunnerStatePath = Join-Path $testRoot 'state.json'
$script:pilotLockPrefix = 'Local\ITIR-pilot-test-' + [guid]::NewGuid().ToString('N')
$script:realEnterLock = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1') {
    return & $script:realEnterLock ($script:pilotLockPrefix + '-' + $Name.Replace('\', '-'))
}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false
    try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Pilot binding accepted $Case." }
}
try {
    $sha = 'a' * 40
    $config = [pscustomobject]@{
        schema = 1; tag = $script:RunnerTag; repo = 'example/fixture'; maxMinutes = 120
        activation = 'pilot'; label = 'it-inventory-ephemeral'
        pilotExpectedSha = $sha; pilotWorkflowPath = '.github/workflows/local-runner-pilot.yml'; pilotLabel = Get-PilotLabel $sha
    }
    $run = [pscustomobject]@{ id = 12; workflow_id = 34; head_sha = $sha; run_attempt = 1 }
    $workflow = [pscustomobject]@{ id = 34; path = $config.pilotWorkflowPath }
    $job = [pscustomobject]@{ id = 56; run_id = 12; head_sha = $sha; labels = @('self-hosted', $config.pilotLabel); status = 'queued'; runner_id = 0; runner_name = '' ; conclusion = $null }
    $binding = [pscustomobject]@{
        tag = $script:RunnerTag; jobId = 56; runId = 12; workflowId = 34; workflowPath = $workflow.path
        headSha = $sha; runAttempt = 1; pilotLabel = $config.pilotLabel
    }
    if (-not (Test-PilotEvidence $config $run $workflow $job $binding)) { throw 'Matching pilot metadata rejected.' }
    foreach ($case in @('stale-sha', 'unrelated-workflow', 'wrong-job-run', 'missing-label', 'wrong-receipt-run', 'rerun')) {
        switch ($case) {
            'stale-sha' { $run.head_sha = 'b' * 40 }
            'unrelated-workflow' { $workflow.path = '.github/workflows/ci.yml' }
            'wrong-job-run' { $job.run_id = 99 }
            'missing-label' { $job.labels = @('self-hosted', 'it-inventory-ephemeral') }
            'wrong-receipt-run' { $binding.runId = 99 }
            'rerun' { $run.run_attempt = 2 }
        }
        if (Test-PilotEvidence $config $run $workflow $job $binding) { throw "Pilot proof accepted $case." }
        $run.head_sha = $sha; $run.run_attempt = 1; $workflow.path = $config.pilotWorkflowPath
        $job.run_id = 12; $job.labels = @('self-hosted', $config.pilotLabel); $binding.runId = 12
    }
    Assert-Rejected { Assert-PilotConfig ([pscustomobject]@{ activation = 'pilot' }) } 'unset SHA/workflow'
    $jitLabels = @(Get-RunnerJitLabels $config)
    if ($jitLabels.Count -ne 4 -or $jitLabels -contains $config.label -or $jitLabels -notcontains $config.pilotLabel) {
        throw 'Pilot JIT labels could accept an active/older generic-label job.'
    }
    $jitRunner = [pscustomobject]@{ labels = @($jitLabels | ForEach-Object { [pscustomobject]@{ name = $_ } }) }
    Assert-RunnerJitLabels $config $jitRunner
    $jitRunner.labels += [pscustomobject]@{ name = $config.label }
    Assert-Rejected { Assert-RunnerJitLabels $config $jitRunner } 'unexpected JIT assignment label'

    $script:queueJobCalls = 0
    $script:remoteRun = $run; $script:remoteWorkflow = $workflow; $script:remoteJob = $job
    $stale = [pscustomobject]@{ id = 11; workflow_id = 34; head_sha = ('b' * 40); run_attempt = 1 }
    $foreign = [pscustomobject]@{ id = 13; workflow_id = 35; head_sha = $sha; run_attempt = 1 }
    function Invoke-GitHub {
        param($Uri, $Method, $Body, $Token)
        if ($Uri -match '/runs\?') { return [pscustomobject]@{ total_count = 3; workflow_runs = @($stale, $foreign, $script:remoteRun) } }
        if ($Uri -match '/workflows/35$') { return [pscustomobject]@{ id = 35; path = '.github/workflows/ci.yml' } }
        if ($Uri -match '/workflows/34$') { return $script:remoteWorkflow }
        if ($Uri -match '/runs/12/jobs\?') { $script:queueJobCalls++; return [pscustomobject]@{ total_count = 1; jobs = @($script:remoteJob) } }
        if ($Uri -match '/runs/12$') { return $script:remoteRun }
        if ($Uri -match '/jobs/56$') { return $script:remoteJob }
        throw 'Unexpected synthetic API request (wrong workflow/run was inspected).'
    }
    $selected = Get-QueuedRunnerJob $config 'dummy'
    if ($selected.id -ne 56 -or $script:queueJobCalls -ne 1 -or $selected.pilotBinding.headSha -cne $sha) {
        throw 'Queue selection did not bind only the intended workflow and SHA.'
    }
    $script:remoteRun.head_sha = 'b' * 40
    Assert-Rejected { Get-PilotEvidence $config $binding 'dummy' } 'fresh metadata drift'
    $script:remoteRun.head_sha = $sha

    function Assert-Administrator {}
    function Assert-SecureRoot {}
    function Get-OwnerToken { return 'dummy' }
    $script:taskRunning = $false; $script:existingVm = $false; $script:existingState = $false
    function Get-ScheduledTask { param($TaskName) return [pscustomobject]@{ State = $(if ($script:taskRunning) { 'Running' } else { 'Ready' }) } }
    function Get-VM { if ($script:existingVm) { return [pscustomobject]@{ Name = 'ITIR-' + ('c' * 32) } } }
    function Get-RunnerState { if ($script:existingState) { return [pscustomobject]@{ tag = $script:RunnerTag } } }
    function Start-ScheduledTask { throw 'Activation/retry must never start a supervisor automatically.' }
    $config.activation = 'disabled'
    Write-RunnerJson $script:RunnerConfigPath $config
    Assert-Rejected { Enable-RunnerPilot '' } 'enable without SHA'
    Enable-RunnerPilot $sha
    if ((Get-RunnerConfig).pilotLabel -cne (Get-PilotLabel $sha)) { throw 'EnablePilot failed to persist derived SHA label.' }
    Write-RunnerJson (Join-Path $testRoot 'pilot-attempt.json') $binding
    Write-RunnerJson (Join-Path $testRoot 'last-error.json') ([ordered]@{ stage = 'network-isolation'; code = 'STAGE_FAILED' })
    $before = [IO.File]::ReadAllText((Join-Path $testRoot 'pilot-attempt.json'))
    Assert-Rejected { Enable-RunnerPilot ('b' * 40) } 'implicit reset'
    Assert-Rejected { Enable-RunnerPilot ('b' * 40) '' -Retry } 'retry without reason'
    Assert-Rejected { Enable-RunnerPilot $sha 'diagnosed ACL collision' -Retry } 'retry same SHA'
    foreach ($case in @('running-task', 'vm', 'state')) {
        $script:taskRunning = $case -eq 'running-task'; $script:existingVm = $case -eq 'vm'; $script:existingState = $case -eq 'state'
        Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'diagnosed ACL collision' -Retry } $case
        if ([IO.File]::ReadAllText((Join-Path $testRoot 'pilot-attempt.json')) -cne $before) { throw 'Refused retry changed the consumed receipt.' }
    }
    $script:taskRunning = $false; $script:existingVm = $false; $script:existingState = $false
    Write-RunnerJson (Join-Path $testRoot 'pilot-result.json') ([ordered]@{ verified = $true })
    Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'do not reset success' -Retry } 'successful proof reset'
    Remove-Item -LiteralPath (Join-Path $testRoot 'pilot-result.json')
    $realWrite = (Get-Command Write-RunnerBytes).ScriptBlock
    function Write-RunnerBytes {
        param($Path, $Bytes)
        if ($Path -like '*\pilot-history\*') { throw 'Synthetic evidence archive write failure.' }
        & $realWrite $Path $Bytes
    }
    Assert-Rejected { Enable-RunnerPilot ('b' * 40) 'diagnosed ACL collision' -Retry } 'archive failure'
    if ([IO.File]::ReadAllText((Join-Path $testRoot 'pilot-attempt.json')) -cne $before -or (Get-RunnerConfig).activation -ne 'pilot') {
        throw 'Failed archival altered current receipt or activation.'
    }
    Set-Item -Path Function:\Write-RunnerBytes -Value $realWrite
    Enable-RunnerPilot ('b' * 40) 'diagnosed ACL collision' -Retry
    $archives = @(Get-ChildItem -LiteralPath (Join-Path $testRoot 'pilot-history') -Filter '*.json')
    $archive = Read-RunnerJson $archives[0].FullName
    if ($archives.Count -ne 1 -or (Get-RunnerEvidenceValue $archive.sources.'pilot-attempt.json').jobId -ne 56 -or (Get-RunnerEvidenceValue $archive.sources.'last-error.json').stage -cne 'network-isolation' -or
        (Test-Path -LiteralPath (Join-Path $testRoot 'pilot-attempt.json')) -or (Get-RunnerConfig).pilotExpectedSha -cne ('b' * 40)) {
        throw 'Maintainer retry lost old evidence or failed to bind the new SHA.'
    }

    # Activation re-fetches proof; a successful old local record alone is insufficient.
    $config.activation = 'pilot'; Write-RunnerJson $script:RunnerConfigPath $config
    Write-RunnerJson (Join-Path $testRoot 'pilot-attempt.json') $binding
    $proof = [pscustomobject]@{
        tag = $script:RunnerTag; jobId = 56; runId = 12; workflowId = 34; workflowPath = $workflow.path; headSha = $sha; runAttempt = 1; pilotLabel = $config.pilotLabel
        verified = $true; status = 'completed'; conclusion = 'success'; runnerName = 'ITIR-fixture'; runnerId = 78; allocatedRunnerName = 'ITIR-fixture'; allocatedRunnerId = 78
    }
    Write-RunnerJson (Join-Path $testRoot 'pilot-result.json') $proof
    $job.status = 'completed'; $job.conclusion = 'success'; $job.runner_name = 'ITIR-fixture'; $job.runner_id = 78
    $run.head_sha = 'b' * 40
    Assert-Rejected { Enable-RunnerActive } 'fresh proof SHA mismatch'
    if ((Get-RunnerConfig).activation -ne 'pilot') { throw 'Rejected fresh proof enabled active pickup.' }
    $run.head_sha = $sha; $job.runner_id = 79
    Assert-Rejected { Enable-RunnerActive } 'fresh runner mismatch'
    $job.runner_id = 78
    Enable-RunnerActive
    if ((Get-RunnerConfig).activation -ne 'active') { throw 'Matching fresh proof did not enable active pickup.' }
    Write-Host 'Offline pilot binding/assignment/retry checks passed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
