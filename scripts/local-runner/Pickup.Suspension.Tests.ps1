# Actual-source offline pickup cancellation. TEMP marker/state and API/provider
# fixtures only; no installed root, native locks, credentials, VM or GitHub IO.
param([string] $CandidateRoot = $PSScriptRoot, [ValidateSet('all','reconciliation-stop','poll-stop','queue-stop')][string] $Case = 'all')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $CandidateRoot 'Common.ps1')
. (Join-Path $CandidateRoot 'Network.Recovery.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $CandidateRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) { Invoke-Expression $definition.Extent.Text }
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-pickup-stop-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
$script:checks = 0; $script:locked = 0
$script:actualQueue = (Get-Command Get-QueuedRunnerJob).ScriptBlock
function Check([string] $Name, [scriptblock] $Work) {
    if ($Case -cne 'all' -and $Case -cne $Name) { return }
    & $Work
    if ($script:locked -ne 0) { throw 'Pickup fixture leaked state lock.' }
    $script:checks++; Write-Host "PASS $Name"
}
function Reset-Fixture {
    Remove-Item -LiteralPath (Join-Path $root 'stop.requested') -Force -ErrorAction SilentlyContinue
    $script:mode='idle'; $script:apiCalls=0; $script:stopAfter=0; $script:sleeps=0; $script:sleepSeconds=0; $script:reconcileCalls=0
    $script:memoryCalls=0; $script:tokens=0; $script:claims=0; $script:clockSeconds=0; $script:state=$null
    $script:config=[pscustomobject]@{activation='active';label='it-inventory-ephemeral';repo='example/fixture';maxMinutes=120}
}
function Stop-Fixture { [IO.File]::WriteAllText((Join-Path $root 'stop.requested'), 'stop') }
function Enter-RunnerLock { $script:locked++; return 'fixture' }
function Exit-RunnerLock($Mutex) { if($Mutex-cne'fixture'-or$script:locked-le0){throw 'Pickup lock balance differs.'}; $script:locked-- }
function Get-RunnerState { return $script:state }
function Get-RunnerConfig { return $script:config }
function Invoke-RunnerJitReconciliation {
    $script:reconcileCalls++
    if($script:mode-ceq'reconcile-stop'){ $script:clockSeconds+=20; Stop-Fixture; return $false }
    return $true
}
function Get-RunnerMemoryAdmission {
    if($script:locked){throw 'Memory inspection under state lock.'}; $script:memoryCalls++
    if($script:mode-ceq'memory-stop'){Stop-Fixture}
    return [pscustomobject]@{ready=$true;availableBytes=[decimal]32GB}
}
function Get-OwnerToken { if($script:locked){throw 'Token work under state lock.'}; $script:tokens++; return 'nonsecret-fixture' }
function Write-RunnerObservation { if(Test-Path -LiteralPath (Join-Path $root 'stop.requested')){throw 'Stopped poll wrote a fresh observation.'} }
function Write-RunnerFailure { throw 'Pickup cancellation fabricated a failure.' }
function Write-EventLog { throw 'Pickup cancellation logged a failure.' }
function Start-Sleep($Seconds) {
    if($script:locked){throw 'Idle wait held state mutex.'}; $script:sleeps++; $script:sleepSeconds += $Seconds
    if($script:mode-ceq'reconcile-stop'){throw 'Stopped reconciliation incurred idle backoff.'}
    if($script:mode-ceq'poll-stop') {
        Stop-Fixture
        if($Seconds-ne1){throw 'Idle suspension waited an uninterruptible 30-second interval.'}
    }
}
function Invoke-RunnerSession { $script:claims++; throw 'Stopped pickup claimed a session.' }
function Get-QueuedRunnerJob {
    param($Config,$Token,$AvailableBytes,$SessionProfileLabel)
    if($script:mode-ceq'queue-provider-stop'){Stop-Fixture;return $null}
    return & $script:actualQueue $Config $Token $AvailableBytes $SessionProfileLabel
}
function Invoke-GitHub {
    param($Uri,$Method,$Body,$Token)
    if($script:locked){throw 'API IO held state mutex.'}
    if($Method-cne'GET'){throw 'Read-only pickup fixture sent a mutation.'}
    $script:apiCalls++; $script:clockSeconds+=20
    if($script:stopAfter-eq$script:apiCalls){Stop-Fixture}
    if($Uri-match'/runs\?status=queued') {
        if($script:mode-ceq'pilot-queue'){return [pscustomobject]@{total_count=1;workflow_runs=@($script:pilotRun)}}
        return [pscustomobject]@{total_count=2;workflow_runs=@([pscustomobject]@{id=12},[pscustomobject]@{id=13})}
    }
    if($Uri-match'/runs\?status=in_progress') {return [pscustomobject]@{total_count=0;workflow_runs=@()}}
    if($Uri-match'/runs/(12|13)/jobs\?') {
        if($script:mode-ceq'pilot-queue'){return [pscustomobject]@{total_count=1;jobs=@($script:pilotJob)}}
        return [pscustomobject]@{total_count=0;jobs=@()}
    }
    if($Uri-match'/runs/12$'){return $script:pilotRun}
    if($Uri-match'/workflows/34$'){return $script:pilotWorkflow}
    if($Uri-match'/jobs/56$'){return $script:pilotJob}
    throw 'Unexpected pickup API endpoint.'
}
try {
    Check 'reconciliation-stop' {
        Reset-Fixture; $script:mode='reconcile-stop'
        Invoke-SupervisorLoop
        if($script:reconcileCalls-ne1-or$script:sleeps-ne0-or$script:memoryCalls-ne0-or$script:tokens-ne0-or$script:claims-ne0){throw 'Reconciliation suspension advanced demand or waited after Stop.'}
    }
    Check 'poll-stop' {
        Reset-Fixture; $script:mode='poll-stop'; $script:config.activation='disabled'
        Invoke-SupervisorLoop
        if($script:sleeps-ne1-or$script:sleepSeconds-ne1-or$script:reconcileCalls-ne0-or$script:claims-ne0){throw 'Idle Stop did not end the bounded poll at its next chunk.'}
    }
    Check 'queue-stop' {
        foreach($at in 1..4) {
            Reset-Fixture; $script:stopAfter=$at
            $refused=$false; try { [void](& $script:actualQueue $script:config 'fixture') } catch {
                if($_.Exception.Message-cne'Pickup suspension requested during read-only demand inspection.'){throw}; $refused=$true
            }
            if(-not$refused-or$script:apiCalls-ne$at-or$script:claims-ne0){throw 'Stopped queue inspection chained another API request.'}
        }
    }
    Check 'full-poll-budget' {
        Reset-Fixture; Wait-RunnerPickupPoll
        if($script:sleeps-ne30-or$script:sleepSeconds-ne30){throw 'Uncancelled idle poll budget changed.'}
    }
    Check 'provider-return-and-claim-refusal' {
        foreach($mode in @('memory-stop','queue-provider-stop')) {
            Reset-Fixture; $script:mode=$mode
            Invoke-SupervisorLoop
            if($script:sleeps-ne0-or$script:claims-ne0-or($mode-ceq'memory-stop'-and$script:tokens-ne0)){throw 'Stopped provider return continued demand or claim work.'}
        }
        Reset-Fixture; $script:state=[pscustomobject]@{purpose='job'}
        Invoke-SupervisorLoop
        if($script:reconcileCalls-ne0-or$script:apiCalls-ne0-or$script:claims-ne0){throw 'Existing session did not fence further pickup.'}
    }
    Check 'pilot-read-scope-and-durable-paths-unchanged' {
        Reset-Fixture
        $sha='a'*40
        $config=[pscustomobject]@{activation='pilot';repo='example/fixture';pilotExpectedSha=$sha;pilotWorkflowPath='.github/workflows/local-runner-pilot.yml';pilotLabel=Get-PilotLabel $sha}
        $script:pilotRun=[pscustomobject]@{id=12;workflow_id=34;head_sha=$sha;run_attempt=1}
        $script:pilotWorkflow=[pscustomobject]@{id=34;path=$config.pilotWorkflowPath}
        $script:pilotJob=[pscustomobject]@{id=56;run_id=12;head_sha=$sha;labels=@('self-hosted',$config.pilotLabel);status='completed';runner_id=17;runner_name='fixture';conclusion='success'}
        $binding=[pscustomobject]@{jobId=56;runId=12;workflowId=34;workflowPath=$config.pilotWorkflowPath;headSha=$sha;runAttempt=1;pilotLabel=$config.pilotLabel}
        $script:stopAfter=1
        $completed=Get-PilotEvidence $config $binding 'fixture'
        if($script:apiCalls-ne3-or$completed.job.status-cne'completed'){throw 'Stop cancelled authoritative post-job pilot verification.'}
        foreach($at in 1..3) {
            Reset-Fixture; $script:stopAfter=$at
            $refused=$false;try{[void](Get-PilotEvidence $config $binding 'fixture' -PickupInspection)}catch{if($_.Exception.Message-cne'Pickup suspension requested during read-only demand inspection.'){throw};$refused=$true}
            if(-not$refused-or$script:apiCalls-ne$at){throw 'Pickup pilot reads chained work after suspension.'}
        }
        $config|Add-Member -NotePropertyName label -NotePropertyValue 'it-inventory-ephemeral'
        $script:pilotJob.status='queued';$script:pilotJob.runner_id=0
        foreach($at in 1..6) {
            Reset-Fixture; $script:mode='pilot-queue';$script:stopAfter=$at
            $refused=$false;try{[void](& $script:actualQueue $config 'fixture')}catch{if($_.Exception.Message-cne'Pickup suspension requested during read-only demand inspection.'){throw};$refused=$true}
            if(-not$refused-or$script:apiCalls-ne$at-or$script:claims-ne0){throw 'Pilot queue traversal chained workflow/jobs/fresh binding work after Stop.'}
        }
        # Jit.Demand/Jit.Registration exercise the retained actual transaction
        # functions, including lost POST/DELETE and owner-cleanup ambiguity.
    }
    Write-Host "Pickup suspension offline checks passed: $($script:checks) groups; no live latency/provider/installed-host proof."
} finally {
    if([IO.Path]::GetDirectoryName($root).TrimEnd('\')-cne([IO.Path]::GetTempPath()).TrimEnd('\')-or[IO.Path]::GetFileName($root)-cnotmatch'^ITIR-pickup-stop-[0-9a-f]{32}$'){throw 'Pickup fixture cleanup refused.'}
    Remove-Item -LiteralPath $root -Recurse -Force
}
