# Offline actual queue ordering; no credentials, network, scheduler or VM operations.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Runner source does not parse.' }
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$config = [pscustomobject]@{ activation = 'active'; label = 'it-inventory-ephemeral'; repo = 'example/fixture' }
function New-Run([string] $Id, [string] $CreatedAt = '') {
    $run = [pscustomobject]@{ id = $Id }
    if ($CreatedAt) { $run | Add-Member -NotePropertyName created_at -NotePropertyValue $CreatedAt }
    return $run
}
function New-Job([int] $Id, [string] $Label) { return [pscustomobject]@{ id = $Id; status = 'queued'; runner_id = 0; labels = @('self-hosted', $Label) } }
function Reset-Fixture {
    $script:queued = @(); $script:inProgress = @(); $script:jobs = @{}
    $script:runRequests = 0; $script:inspected = [Collections.Generic.List[string]]::new()
    $script:overflowStatus = ''; $script:extraRuns = $false; $script:jobOverflow = $false
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
    Reset-Fixture; $script:queued = @((New-Run '12')); $script:jobs['12'] = @(); $script:jobOverflow = $true
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
    Reset-Fixture; $script:queued = @((New-Run '12')); $script:jobs['12'] = @(1..101 | ForEach-Object { New-Job $_ 'it-inventory-light' })
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' }
    Write-Host 'Queue fairness passed: older cross-status continuation, capacity/labels/profile, UTC/numeric order, undated compatibility, deduplication and bounded overflow refusal.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -notmatch '^ITIR-queue-[0-9a-f]{32}$') { throw 'Unexpected queue fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
