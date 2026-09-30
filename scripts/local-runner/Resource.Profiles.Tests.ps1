# Offline resource selection/propagation. No host, credential or GitHub operations.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$config = [pscustomobject]@{ activation = 'active'; label = 'it-inventory-ephemeral'; repo = 'example/fixture'; memoryBytes = 1GB }
$pilot = [pscustomobject]@{ activation = 'pilot'; label = $config.label; pilotExpectedSha = ('a' * 40); pilotWorkflowPath = '.github/workflows/local-runner-pilot.yml'; pilotLabel = ('it-inventory-pilot-' + ('a' * 40)) }
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Resource profiles accepted $Case." }
}
$script:freeKiB = 0
function Get-CimInstance { return [pscustomobject]@{ FreePhysicalMemory = $script:freeKiB; TotalVisibleMemorySize = [uint64](32GB / 1KB) } }
function New-VM {
    param($Name, $Generation, $VHDPath, $Path, $MemoryStartupBytes, $SwitchName)
    $script:vmStartup = $MemoryStartupBytes
    if ($Generation -ne 2 -or $Name -cne 'fixture' -or $VHDPath -cne 'disk' -or $Path -cne 'instance' -or $SwitchName -cne $script:RunnerSwitch) { throw 'VM creation lost the fixed lifecycle inputs.' }
    return [pscustomobject]@{ Name = $Name }
}
function Get-VMMemory { return [pscustomobject]@{ Startup = $script:vmStartup; DynamicMemoryEnabled = $script:dynamic } }
$script:dynamic = $false
foreach ($case in @(
    @{ label = 'it-inventory-light'; guest = 2GB },
    @{ label = 'it-inventory-mid'; guest = 4GB },
    @{ label = 'it-inventory-heavy'; guest = 8GB },
    @{ label = 'it-inventory-ephemeral'; guest = 8GB },
    @{ label = $pilot.pilotLabel; guest = 8GB }
)) {
    $cfg = if ($case.label -ceq $pilot.pilotLabel) { $pilot } else { $config }
    $profile = Get-RunnerSessionProfile $cfg $case.label
    if ($profile.memoryBytes -ne $case.guest -or $profile.requiredBytes -ne ($case.guest + 2GB)) { throw 'Fixed profile mapping changed.' }
    foreach ($offset in @(-1, 0, 1)) {
        $script:freeKiB = [uint64]($profile.requiredBytes / 1KB + $offset)
        $admission = Get-RunnerMemoryAdmission $case.label
        if ($admission.ready -ne ($offset -ge 0) -or $admission.requiredBytes -ne $profile.requiredBytes) { throw 'Profile capacity boundary changed.' }
    }
    [void](New-RunnerProfileVm 'fixture' 'disk' 'instance' $case.label)
    if ($script:vmStartup -ne $case.guest) { throw 'VM did not receive its fixed resource profile.' }
    Assert-RunnerVmResources 'fixture' $case.label
    $script:vmStartup += 1GB
    Assert-Rejected { Assert-RunnerVmResources 'fixture' $case.label } 'wrong VM memory readback'
    $script:vmStartup = $case.guest; $script:dynamic = $true
    Assert-Rejected { Assert-RunnerVmResources 'fixture' $case.label } 'dynamic VM memory'
    $script:dynamic = $false
    $labels = @(Get-RunnerJitLabels $cfg $case.label)
    if (($labels -join ',') -cne "self-hosted,Linux,X64,$($case.label)") { throw 'JIT advertised extra or mismatched custom labels.' }
    $runner = [pscustomobject]@{ labels = @($labels | ForEach-Object { [pscustomobject]@{ name = $_ } }) }
    Assert-RunnerJitLabels $cfg $runner $case.label
    $runner.labels += [pscustomobject]@{ name = 'it-inventory-ephemeral' }
    Assert-Rejected { Assert-RunnerJitLabels $cfg $runner $case.label } 'extra generic JIT label'
}
if ((Get-RunnerSessionProfile $config).memoryBytes -ne 8GB) { throw 'Legacy caller resource compatibility changed.' }
Assert-Rejected { Get-RunnerResourceProfile 'it-inventory-tiny' } 'unsupported profile'
Assert-Rejected { Get-RunnerSessionProfile $pilot 'it-inventory-light' } 'small pilot profile'
Assert-Rejected { Get-RunnerSessionProfile $config $pilot.pilotLabel } 'active pilot profile'
foreach ($labels in @(
    @('self-hosted'),
    @('self-hosted', 'it-inventory-light', 'it-inventory-heavy'),
    @('self-hosted', 'it-inventory-light', 'it-inventory-ephemeral'),
    @('self-hosted', 'it-inventory-light', 'Windows'),
    @('self-hosted', 'it-inventory-light', 'it-inventory-light'),
    @('self-hosted', 'IT-INVENTORY-LIGHT'),
    @('self-hosted', 'it-inventory-tiny')
)) {
    if ($null -ne (Get-RunnerJobProfile $config ([pscustomobject]@{ labels = $labels }))) { throw 'Unsupported/mixed labels were eligible.' }
}
if ($null -ne (Get-RunnerJobProfile $pilot ([pscustomobject]@{ labels = @('self-hosted', $pilot.pilotLabel, 'it-inventory-light') }))) { throw 'Pilot accepted a mixed resource request.' }
function New-Job([int] $Id, [string] $Label) { return [pscustomobject]@{ id = $Id; status = 'queued'; runner_id = 0; labels = @('self-hosted', $Label) } }
$script:jobs = @((New-Job 1 'it-inventory-heavy'), (New-Job 2 'it-inventory-mid'), (New-Job 3 'it-inventory-light'))
function Invoke-GitHub {
    param($Uri, $Method, $Body, $Token)
    if ($Uri -match '/runs\?') { return [pscustomobject]@{ total_count = 1; workflow_runs = @([pscustomobject]@{ id = 12 }) } }
    if ($Uri -match '/runs/12/jobs\?') { return [pscustomobject]@{ total_count = $script:jobs.Count; jobs = $script:jobs } }
    throw 'Unexpected profile API probe.'
}
foreach ($case in @(@{ free = 4GB; id = 3 }, @{ free = 6GB; id = 2 }, @{ free = 10GB; id = 1 })) {
    $selected = Get-QueuedRunnerJob $config 'dummy' $case.free
    if ($selected.id -ne $case.id -or $selected.resourceLabel -cne $selected.labels[1]) { throw 'Capacity traversal failed to skip a nonfitting job.' }
}
if ($null -ne (Get-QueuedRunnerJob $config 'dummy' (4GB - 1KB))) { throw 'Queue admitted insufficient host headroom.' }
$script:jobs = @((New-Job 4 'it-inventory-ephemeral'), (New-Job 3 'it-inventory-light'))
if ((Get-QueuedRunnerJob $config 'dummy' 4GB).id -ne 3 -or (Get-QueuedRunnerJob $config 'dummy' 10GB).id -ne 4) { throw 'Legacy generic capacity changed.' }
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-profiles-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
try {
    $legacy = [pscustomobject]@{ tag = $script:RunnerTag; vmName = ('ITIR-' + ('c' * 32)); instancePath = (Join-Path $base ('ITIR-' + ('c' * 32))) }
    Assert-StateIdentity $legacy # Recovery must not require newly introduced profile fields.
    Complete-RunnerPilotClaim $legacy
    function Assert-RunnerTransitionClear {}
    function Get-RunnerConfig { return $config }
    function Get-RunnerState { return $null }
    function Get-OwnerToken { return 'dummy' }
    function Write-EventLog {}
    function Start-Sleep { param($Seconds) if ($Seconds -ne 30) { throw 'Profile loop changed its wait interval.' }; [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop') }
    function Invoke-RunnerSession {
        param($Config, $PilotAttempt, $ProfileLabel)
        if ($ProfileLabel -cne 'it-inventory-light' -or $null -ne $PilotAttempt) { throw 'Selected profile was not propagated to its session.' }
        $script:sessions++
        [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop')
        return [pscustomobject]@{ name = 'fixture'; id = 1 }
    }
    $script:freeKiB = [uint64](4GB / 1KB); $script:sessions = 0
    Invoke-SupervisorLoop
    if ($script:sessions -ne 1 -or (Test-Path -LiteralPath (Join-Path $base 'last-error.json'))) { throw 'Active admission did not select a fitting light session.' }
    Remove-Item -LiteralPath (Join-Path $base 'stop.requested')
    $script:probes = 0
    function Get-CimInstance {
        $script:probes++
        return [pscustomobject]@{ FreePhysicalMemory = [uint64]($(if ($script:probes -eq 1) { 4GB } else { 3GB }) / 1KB); TotalVisibleMemorySize = [uint64](32GB / 1KB) }
    }
    $script:sessions = 0
    Invoke-SupervisorLoop
    if ($script:sessions -ne 0 -or $script:probes -ne 2 -or (Test-Path -LiteralPath (Join-Path $base 'last-error.json'))) { throw 'Selected profile capacity loss allocated a session or fabricated a failure.' }
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -notmatch '^ITIR-profiles-[0-9a-f]{32}$') { throw 'Unexpected profile fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
# Routing-only changes must preserve exact-SHA and trusted main/environment gates.
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$expected = @{ app = 'mid'; database = 'heavy'; required = 'light'; production_database = 'light'; discover = 'light'; provision = 'light' }
$seen = @{}
foreach ($name in @('ci.yml', 'preview-access.yml')) {
    $source = [IO.File]::ReadAllText((Join-Path $root ".github/workflows/$name"))
    foreach ($match in [regex]::Matches($source, '(?ms)^  (\w+):\r?\n(.*?)(?=^  \w+:|\z)')) {
        $id = $match.Groups[1].Value; $body = $match.Groups[2].Value
        if ($expected.ContainsKey($id)) {
            if ($body -notmatch ('runs-on: \[self-hosted, it-inventory-' + $expected[$id] + '\]')) { throw "Workflow routing mismatch: $id." }
            $seen[$id] = $true
        }
    }
    if ($source.Contains('it-inventory-ephemeral')) { throw 'Normal workflow retained a generic runner label.' }
}
if ($seen.Count -ne 6) { throw 'Profile tests did not verify all six workflow jobs.' }
$ci = [IO.File]::ReadAllText((Join-Path $root '.github/workflows/ci.yml'))
$preview = [IO.File]::ReadAllText((Join-Path $root '.github/workflows/preview-access.yml'))
foreach ($contract in @('github.event.pull_request.head.sha || github.sha', 'needs: [app, database]', 'test "$APP_RESULT" = success', 'test "$DATABASE_RESULT" = success', 'environment: production-database', "github.ref == 'refs/heads/main'", 'needs: [required]')) { if (-not $ci.Contains($contract)) { throw 'CI exact-SHA/required/production gate changed.' } }
foreach ($contract in @('pull_request_target:', 'ref: refs/heads/main', 'environment: preview-access', "github.ref == 'refs/heads/main'")) { if (-not $preview.Contains($contract)) { throw 'Trusted preview gate changed.' } }
Write-Host 'Resource profiles passed: fixed boundaries, strict labels, queue skipping, VM/JIT readback, session propagation, capacity loss, legacy recovery and six workflow gates.'
