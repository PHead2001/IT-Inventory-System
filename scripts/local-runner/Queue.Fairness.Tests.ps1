# Offline actual queue ordering; no credentials, network, scheduler or VM operations.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Runner source does not parse.' }
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$config = [pscustomobject]@{ activation = 'active'; label = 'it-inventory-ephemeral'; repo = 'PHead2001/IT-Inventory-System' }
function New-Run([string] $Id, [string] $CreatedAt = '') {
    $run = [pscustomobject]@{ id = $Id }
    if ($CreatedAt) { $run | Add-Member -NotePropertyName created_at -NotePropertyValue $CreatedAt }
    return $run
}
function New-Job([int] $Id, [string] $Label) { return [pscustomobject]@{ id = $Id; status = 'queued'; runner_id = 0; labels = @('self-hosted', $Label) } }
function New-ReleaseRun([string] $Id, [string] $CreatedAt, [string] $WorkflowId = '64') {
    $run = New-Run $Id $CreatedAt
    foreach ($field in @{
        event = 'push'; head_branch = 'main'; workflow_id = $WorkflowId; path = '.github/workflows/ci.yml'; name = 'Foundation CI'
        repository = [pscustomobject]@{ full_name = 'PHead2001/IT-Inventory-System' }
        head_repository = [pscustomobject]@{ full_name = 'PHead2001/IT-Inventory-System' }
    }.GetEnumerator()) { $run | Add-Member -NotePropertyName $field.Key -NotePropertyValue $field.Value }
    return $run
}
function Reset-Fixture {
    $script:queued = @(); $script:inProgress = @(); $script:jobs = @{}
    $script:runRequests = 0; $script:inspected = [Collections.Generic.List[string]]::new()
    $script:overflowStatus = ''; $script:extraRuns = $false; $script:jobOverflow = $false
    $script:workflowRequests = [Collections.Generic.List[string]]::new()
    $script:workflows = @{ '64' = [pscustomobject]@{ id = 64; path = '.github/workflows/ci.yml' } }
    $script:workflowFailure = $false; $script:workflowStop = $false
    Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested') -Force -ErrorAction SilentlyContinue
}
function Invoke-GitHub($Uri, $Method, $Body, $Token) {
    if ($Method -cne 'GET' -or $null -ne $Body) { throw 'Queue fixture attempted a mutation.' }
    if ($Uri -match '/runs\?status=(queued|in_progress)&per_page=100$') {
        $script:runRequests++
        $status = $Matches[1]
        $runs = @(if ($status -ceq 'queued') { $script:queued } else { $script:inProgress })
        $count = if ($script:overflowStatus -ceq $status) { 101 } else { $runs.Count }
        if ($script:extraRuns) { $runs = @(1..101 | ForEach-Object { New-Run ([string]$_) }) }
        return [pscustomobject]@{ total_count = $count; workflow_runs = $runs }
    }
    if ($Uri -match '/runs/([1-9][0-9]*)/jobs\?filter=latest&per_page=100$') {
        $id = $Matches[1]; $script:inspected.Add($id)
        $jobs = @($script:jobs[$id])
        $count = if ($script:jobOverflow) { 101 } else { $jobs.Count }
        return [pscustomobject]@{ total_count = $count; jobs = $jobs }
    }
    if ($Uri -match '/workflows/([1-9][0-9]*)$') {
        $id = $Matches[1]; $script:workflowRequests.Add($id)
        if ($script:workflowFailure) { throw 'Synthetic metadata transport failure.' }
        if ($script:workflowStop) { [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop') }
        return $script:workflows[$id]
    }
    throw 'Unexpected or unbounded queue endpoint.'
}
function Assert-Rejected([scriptblock] $Work) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw 'Queue accepted invalid identity or incomplete bounded view.' }
}
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-queue-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base
try {
    # Main Foundation pushes can pass recent PR demand, but the preference is
    # capped at 30 minutes and never preempts an already executing session.
    foreach ($case in @(
        @{ pr = '2026-10-10T08:45:00Z'; expected = 200 },
        @{ pr = '2026-10-10T08:00:00Z'; expected = 100 },
        @{ pr = '2026-10-10T08:30:00Z'; expected = 100 },
        @{ pr = '2026-10-10T08:30:01Z'; expected = 200 }
    )) {
        Reset-Fixture
        $script:queued = @((New-Run '10' $case.pr), (New-ReleaseRun '20' '2026-10-10T09:00:00Z'))
        $script:jobs = @{ '10' = @((New-Job 100 'it-inventory-light')); '20' = @((New-Job 200 'it-inventory-light')) }
        if ((Get-QueuedRunnerJob $config 'fixture' 4GB).id -ne $case.expected -or $script:workflowRequests.Count) { throw 'Bounded main preference or original-age tie changed.' }
    }
    # Names/branch labels alone cannot manufacture canonical release identity.
    foreach ($case in @('branch', 'pr-event', 'target-event', 'dispatch-event', 'path', 'repo', 'fork', 'missing-repo', 'missing-event', 'missing-branch', 'missing-workflow', 'invalid-workflow', 'overflow-workflow', 'array-event', 'array-branch', 'array-path', 'array-repo', 'array-workflow', 'display-only', 'config-repo')) {
        Reset-Fixture
        $release = New-ReleaseRun '20' '2026-10-10T09:00:00Z'
        switch ($case) {
            'branch' { $release.head_branch = 'release' }
            'pr-event' { $release.event = 'pull_request' }
            'target-event' { $release.event = 'pull_request_target' }
            'dispatch-event' { $release.event = 'workflow_dispatch' }
            'path' { $release.path = '.github/workflows/other.yml' }
            'repo' { $release.repository.full_name = 'other/fixture' }
            'fork' { $release.head_repository.full_name = 'other/fixture' }
            'missing-repo' { $release.PSObject.Properties.Remove('head_repository') }
            'missing-event' { $release.PSObject.Properties.Remove('event') }
            'missing-branch' { $release.PSObject.Properties.Remove('head_branch') }
            'missing-workflow' { $release.PSObject.Properties.Remove('workflow_id') }
            'invalid-workflow' { $release.workflow_id = '../64' }
            'overflow-workflow' { $release.workflow_id = '18446744073709551616' }
            'array-event' { $release.event = @('push') }
            'array-branch' { $release.head_branch = @('main') }
            'array-path' { $release.path = @('.github/workflows/ci.yml') }
            'array-repo' { $release.repository.full_name = @('PHead2001/IT-Inventory-System') }
            'array-workflow' { $release.workflow_id = @('64') }
            'display-only' { $release = New-Run '20' '2026-10-10T09:00:00Z'; $release | Add-Member name 'Foundation CI'; $release | Add-Member head_branch 'main' }
            'config-repo' { $config.repo = 'other/fixture' }
        }
        $script:queued = @($release, (New-Run '10' '2026-10-10T08:45:00Z'))
        $script:jobs = @{ '10' = @((New-Job 100 'it-inventory-light')); '20' = @((New-Job 200 'it-inventory-light')) }
        if ((Get-QueuedRunnerJob $config 'fixture' 4GB).id -ne 100 -or $script:workflowRequests.Count) { throw "Unverified release identity gained preference: $case." }
        $config.repo = 'PHead2001/IT-Inventory-System'
    }
    # Missing run paths use one bounded cached metadata read per workflow ID;
    # malformed/unknown identity only loses preference, never ordinary eligibility.
    foreach ($case in @('valid', 'wrong-id', 'wrong-path', 'null', 'missing-fields')) {
        Reset-Fixture
        $first = New-ReleaseRun '20' '2026-10-10T09:00:00Z'; $first.PSObject.Properties.Remove('path')
        $second = New-ReleaseRun '30' '2026-10-10T09:01:00Z'; $second.PSObject.Properties.Remove('path')
        switch ($case) {
            'wrong-id' { $script:workflows['64'].id = 65 }
            'wrong-path' { $script:workflows['64'].path = '.github/workflows/other.yml' }
            'null' { $script:workflows['64'] = $null }
            'missing-fields' { $script:workflows['64'] = [pscustomobject]@{ name = 'Foundation CI' } }
        }
        $script:queued = @((New-Run '10' '2026-10-10T08:45:00Z'), $first, $second)
        $script:jobs = @{ '10' = @((New-Job 100 'it-inventory-light')); '20' = @((New-Job 200 'it-inventory-light')); '30' = @((New-Job 300 'it-inventory-light')) }
        $expected = if ($case -ceq 'valid') { 200 } else { 100 }
        if ((Get-QueuedRunnerJob $config 'fixture' 4GB).id -ne $expected -or ($script:workflowRequests -join ',') -cne '64') { throw 'Workflow identity verification/cache changed.' }
        $script:jobs['10'] = @()
        if ((Get-QueuedRunnerJob $config 'fixture' 4GB).id -ne 200 -or $script:workflowRequests.Count -ne 2) { throw 'Unverified workflow lost ordinary eligibility or cache escaped its inspection.' }
    }
    foreach ($case in @('failure', 'stop')) {
        Reset-Fixture
        $release = New-ReleaseRun '20' '2026-10-10T09:00:00Z'; $release.PSObject.Properties.Remove('path')
        $script:queued = @($release); $script:jobs['20'] = @((New-Job 200 'it-inventory-light'))
        if ($case -ceq 'failure') { $script:workflowFailure = $true } else { $script:workflowStop = $true }
        Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' 4GB }
        if ($script:workflowRequests.Count -ne 1 -or $script:inspected.Count) { throw 'Metadata failure/Stop chained job lookup.' }
    }
    # Priority never changes strict resource fitting or exact-session filtering.
    Reset-Fixture
    $script:queued = @((New-ReleaseRun '20' '2026-10-10T09:00:00Z'), (New-Run '10' '2026-10-10T08:45:00Z'))
    $script:jobs = @{ '10' = @((New-Job 100 'it-inventory-light')); '20' = @((New-Job 201 'it-inventory-unsupported'), (New-Job 200 'it-inventory-heavy')) }
    if ((Get-QueuedRunnerJob $config 'fixture' 4GB).id -ne 100 -or $script:RunnerQueueObservation['it-inventory-heavy'] -ne 1) { throw 'Priority bypassed capacity/label admission.' }
    if ((Get-QueuedRunnerJob $config 'fixture' 10GB -SessionProfileLabel 'it-inventory-light').id -ne 100) { throw 'Priority bypassed exact session profile.' }

    # Equal UTC instants use numeric IDs; minimum dates clamp without underflow.
    Reset-Fixture
    $script:queued = @((New-ReleaseRun '20' '2026-10-10T10:00:00+01:00'), (New-ReleaseRun '9' '2026-10-10T09:00:00Z'), (New-ReleaseRun '30' 'invalid'), (New-ReleaseRun '40' '9999-12-31T23:59:59Z'), (New-ReleaseRun '50' '0001-01-01T00:10:00Z'), (New-Run '60' '0001-01-01T00:00:00Z'))
    foreach ($id in @('9','20','30','40','50','60')) { $script:jobs[$id] = @() }
    [void](Get-QueuedRunnerJob $config 'fixture')
    if (($script:inspected -join ',') -cne '60,50,9,20,40,30') { throw 'Priority UTC/numeric/date-clamp/invalid ordering changed.' }

    # Conflicting duplicate identity does not inherit a trusted first observation.
    Reset-Fixture
    $release = New-ReleaseRun '20' '2026-10-10T09:00:00Z'
    $script:queued = @($release, (New-Run '10' '2026-10-10T08:45:00Z'))
    $script:inProgress = @((New-Run '20' '2026-10-10T09:00:00Z'))
    $script:jobs = @{ '10' = @((New-Job 100 'it-inventory-light')); '20' = @((New-Job 200 'it-inventory-light')) }
    if ((Get-QueuedRunnerJob $config 'fixture' 4GB).id -ne 100) { throw 'Duplicate unknown identity acquired priority.' }

    # Provider newest-first queued runs cannot starve an older main continuation.
    Reset-Fixture
    $script:queued = @((New-Run '30' '2026-10-10T10:00:00Z'), (New-Run '20' '2026-10-10T09:00:00Z'))
    $script:inProgress = @((New-Run '10' '2026-10-10T08:00:00Z'))
    $script:jobs = @{ '30' = @((New-Job 300 'it-inventory-light')); '20' = @((New-Job 200 'it-inventory-light')); '10' = @((New-Job 100 'it-inventory-light')) }
    $selected = Get-QueuedRunnerJob $config 'fixture' 4GB
    if ($selected.id -ne 100 -or $script:runRequests -ne 2 -or ($script:inspected -join ',') -cne '10') { throw 'New queued preview starved older in-progress continuation.' }

    # Old demand remains subject to strict labels, available memory and session profile.
    $script:jobs['10'] = @((New-Job 101 'it-inventory-unsupported'), (New-Job 102 'it-inventory-heavy'))
    $selected = Get-QueuedRunnerJob $config 'fixture' 4GB
    if ($selected.id -ne 200 -or $script:RunnerQueueObservation['it-inventory-heavy'] -ne 1) { throw 'Older unsupported/nonfitting demand blocked a fitting run.' }
    $script:jobs['20'] = @((New-Job 201 'it-inventory-mid'))
    $selected = Get-QueuedRunnerJob $config 'fixture' 10GB -SessionProfileLabel 'it-inventory-light'
    if ($selected.id -ne 300) { throw 'Fair ordering bypassed exact session profile.' }

    # Duplicate status snapshots inspect each run once. UTC instants, then numeric IDs,
    # determine ties; missing/invalid timestamps follow all dated runs.
    Reset-Fixture
    $script:queued = @((New-Run '3'), (New-Run '2' 'invalid'), (New-Run '10' '2026-10-10T09:00:00+01:00'))
    $script:inProgress = @((New-Run '10' '2026-10-10T09:00:00+01:00'), (New-Run '9' '2026-10-10T08:00:00Z'))
    foreach ($id in @('2','3','9','10')) { $script:jobs[$id] = @() }
    if ($null -ne (Get-QueuedRunnerJob $config 'fixture') -or ($script:inspected -join ',') -cne '9,10,2,3' -or $script:runRequests -ne 2) { throw 'Duplicate/timestamp/numeric run ordering changed.' }
    # Compatibility fallback does not invent age or drop otherwise eligible legacy runs.
    $script:jobs['2'] = @((New-Job 202 'it-inventory-light'))
    if ((Get-QueuedRunnerJob $config 'fixture' 4GB).id -ne 202) { throw 'Undated legacy run lost eligibility.' }

    Reset-Fixture
    $script:queued = @((New-Run '10'), (New-Run '9' '2026-10-10T09:00:00Z'))
    $script:inProgress = @((New-Run '10' '2026-10-10T08:00:00Z'), (New-Run '9' '2026-10-10T10:00:00Z'))
    $script:jobs = @{ '9' = @(); '10' = @() }
    [void](Get-QueuedRunnerJob $config 'fixture')
    if (($script:inspected -join ',') -cne '10,9') { throw 'Duplicate lost oldest valid timestamp across status transition.' }

    Reset-Fixture
    $script:queued = @(1..100 | ForEach-Object { New-Run ([string]$_) })
    $script:inProgress = @(101..200 | ForEach-Object { New-Run ([string]$_) })
    foreach ($id in 1..200) { $script:jobs[[string]$id] = @() }
    [void](Get-QueuedRunnerJob $config 'fixture')
    if ($script:runRequests -ne 2 -or $script:inspected.Count -ne 200 -or $script:inspected[199] -cne '200') { throw 'Two full bounded views changed their limit or paginated.' }

    Reset-Fixture
    $releases = @(1..200 | ForEach-Object {
        $run = New-ReleaseRun ([string]$_) '2026-10-10T09:00:00Z' ([string]$_)
        $run.PSObject.Properties.Remove('path')
        $script:workflows[[string]$_] = [pscustomobject]@{ id = $_; path = '.github/workflows/ci.yml' }
        $script:jobs[[string]$_] = @()
        $run
    })
    $script:queued = @($releases[0..99]); $script:inProgress = @($releases[100..199])
    [void](Get-QueuedRunnerJob $config 'fixture')
    if ($script:runRequests -ne 2 -or $script:workflowRequests.Count -ne 200 -or $script:inspected.Count -ne 200) { throw 'Release metadata exceeded the bounded snapshot/workflow view.' }

    foreach ($status in @('queued','in_progress')) {
        Reset-Fixture; $script:overflowStatus = $status
        Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
        if ($script:runRequests -gt 2 -or $script:inspected.Count) { throw 'Overflow performed job work or pagination.' }
    }
    Reset-Fixture; $script:extraRuns = $true
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
    Reset-Fixture; $script:queued = @((New-Run '../12'))
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
    if ($script:inspected.Count) { throw 'Invalid run identity reached jobs API.' }
    Reset-Fixture; $script:queued = @((New-Run '18446744073709551616'))
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
    Reset-Fixture; $script:queued = @((New-Run '12')); $script:jobs['12'] = @(); $script:jobOverflow = $true
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
    Reset-Fixture; $script:queued = @((New-Run '12')); $script:jobs['12'] = @(1..101 | ForEach-Object { New-Job $_ 'it-inventory-light' })
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
    Write-Host 'Queue fairness passed: verified bounded main preference, workflow identity/cache, legacy eligibility, capacity/profile, UTC/numeric/date bounds, duplicate evidence, Stop/API refusal and bounded overflow.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -notmatch '^ITIR-queue-[0-9a-f]{32}$') { throw 'Unexpected queue fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
