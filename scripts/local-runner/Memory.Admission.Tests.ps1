# Offline capacity admission behavior. TEMP only; no CIM/VM/GitHub calls run.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-memory-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base
$script:RunnerStatePath = Join-Path $base 'state.json'
$script:probeFails = $false
$script:probeResult = $null
# Reconciliation now precedes capacity admission. Keep its state lock inside
# this offline fixture, never the installed runner's protected Global mutex.
$script:stateLocked = $false
function Enter-RunnerLock { if ($script:stateLocked) { throw 'Nested fixture state mutex.' }; $script:stateLocked = $true; return 'fixture' }
function Exit-RunnerLock { $script:stateLocked = $false }
function Get-CimInstance {
    param($ClassName, $OperationTimeoutSec, $ErrorAction)
    if ($script:stateLocked) { throw 'Memory inspection held the reconciliation state mutex.' }
    if ($ClassName -cne 'Win32_OperatingSystem' -or $ErrorAction -cne 'Stop' -or $OperationTimeoutSec -ne 10) { throw 'Wrong memory probe.' }
    if ($script:probeFails) { throw 'SENTINEL_PRIVATE_DETAIL' }
    return $script:probeResult
}
function Assert-Rejected([scriptblock] $Work) {
    $rejected = $false
    try { & $Work } catch {
        if ($_.Exception.Message.Contains('SENTINEL_PRIVATE_DETAIL')) { throw 'Probe leaked error details.' }
        $rejected = $true
    }
    if (-not $rejected) { throw 'Invalid memory probe was accepted.' }
}
try {
    foreach ($case in @(
        @{ free = (10GB / 1KB - 1); ready = $false },
        @{ free = (10GB / 1KB); ready = $true },
        @{ free = (10GB / 1KB + 1); ready = $true },
        @{ free = 0; ready = $false }
    )) {
        $script:probeResult = [pscustomobject]@{ FreePhysicalMemory = [uint64]$case.free; TotalVisibleMemorySize = [uint64](32GB / 1KB) }
        $result = Get-RunnerMemoryAdmission
        if ($result.ready -ne $case.ready -or $result.requiredBytes -ne 10GB) { throw 'Memory boundary admission mismatch.' }
    }
    foreach ($bad in @(
        $null,
        [pscustomobject]@{ FreePhysicalMemory = '1.5'; TotalVisibleMemorySize = 100 },
        [pscustomobject]@{ FreePhysicalMemory = -1; TotalVisibleMemorySize = 100 },
        [pscustomobject]@{ FreePhysicalMemory = 101; TotalVisibleMemorySize = 100 },
        [pscustomobject]@{ FreePhysicalMemory = 0; TotalVisibleMemorySize = 0 },
        [pscustomobject]@{ TotalVisibleMemorySize = 100 },
        @([pscustomobject]@{ FreePhysicalMemory = 1; TotalVisibleMemorySize = 100 }, [pscustomobject]@{ FreePhysicalMemory = 1; TotalVisibleMemorySize = 100 })
    )) {
        $script:probeResult = $bad
        Assert-Rejected { Get-RunnerMemoryAdmission }
    }
    $script:probeFails = $true
    Assert-Rejected { Get-RunnerMemoryAdmission }

    function Assert-RunnerTransitionClear {}
    function Get-RunnerState { return $null }
    function Get-RunnerConfig { return [pscustomobject]@{ activation = $script:mode; label = 'it-inventory-ephemeral'; pilotExpectedSha = ('a' * 40); pilotWorkflowPath = '.github/workflows/local-runner-pilot.yml'; pilotLabel = ('it-inventory-pilot-' + ('a' * 40)) } }
    function Get-OwnerToken { throw 'Capacity refusal reached credential/queue work.' }
    function Get-QueuedRunnerJob { throw 'Capacity refusal inspected queued jobs.' }
    function Get-PilotEvidence { throw 'Capacity refusal inspected pilot evidence.' }
    function Invoke-RunnerSession { throw 'Capacity refusal allocated a session/VM.' }
    function Write-EventLog {}
    function Start-Sleep {
        param($Seconds)
        if ($Seconds -ne 30) { throw 'Capacity refusal did not use bounded loop.' }
        $script:sleeps++
        [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop')
    }
    foreach ($script:mode in @('pilot', 'active')) {
        foreach ($script:probeFails in @($false, $true)) {
            $script:probeResult = [pscustomobject]@{ FreePhysicalMemory = [uint64](3GB / 1KB); TotalVisibleMemorySize = [uint64](32GB / 1KB) }
            $script:sleeps = 0
            Invoke-SupervisorLoop
            if ($script:sleeps -ne 1) { throw 'Capacity refusal did not wait exactly once.' }
            foreach ($name in @('state.json', 'pilot-attempt.json', 'pilot-result.json', 'instances')) {
                if (Test-Path -LiteralPath (Join-Path $base $name)) { throw 'Capacity refusal published a claim or allocated a VM.' }
            }
            $failurePath = Join-Path $base 'last-error.json'
            if ($script:probeFails) {
                $failure = Read-RunnerJson $failurePath
                if ($failure.stage -cne 'memory-admission' -or $failure.code -cne 'STAGE_FAILED') { throw 'Failed probe lost its safe stage.' }
                Remove-Item -LiteralPath $failurePath -Force
            } elseif (Test-Path -LiteralPath $failurePath) { throw 'Low capacity fabricated a failure.' }
            Remove-Item -LiteralPath (Join-Path $base 'stop.requested') -Force
        }
    }
    # Queue pickup becomes eligible at the exact boundary and above it, including
    # after one low-capacity wait. No real credentials or jobs are involved.
    $script:probeFails = $false
    $script:mode = 'pilot'
    function Get-OwnerToken { $script:queueCalls++; return 'dummy' }
    function Get-QueuedRunnerJob { return $null }
    function Start-Sleep {
        param($Seconds)
        if ($Seconds -ne 30) { throw 'Capacity retry changed its bounded interval.' }
        $script:sleeps++
        if ($script:recoverCapacity -and $script:sleeps -eq 1) {
            $script:probeResult.FreePhysicalMemory = [uint64](10GB / 1KB)
        } else { [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop') }
    }
    foreach ($case in @(
        @{ free = (10GB / 1KB); recover = $false; sleeps = 1 },
        @{ free = (10GB / 1KB + 1); recover = $false; sleeps = 1 },
        @{ free = (9GB / 1KB); recover = $true; sleeps = 2 }
    )) {
        $script:probeResult = [pscustomobject]@{ FreePhysicalMemory = [uint64]$case.free; TotalVisibleMemorySize = [uint64](32GB / 1KB) }
        $script:recoverCapacity = $case.recover
        $script:sleeps = 0; $script:queueCalls = 0
        Invoke-SupervisorLoop
        if ($script:queueCalls -ne 1 -or $script:sleeps -ne $case.sleeps -or (Test-Path -LiteralPath (Join-Path $base 'last-error.json'))) { throw 'Admitted capacity failed bounded pickup/resume.' }
        Remove-Item -LiteralPath (Join-Path $base 'stop.requested') -Force
    }
    # Capacity may disappear during queue inspection; recheck before pilot work.
    $script:mode = 'pilot'; $script:recoverCapacity = $false
    $script:probeResult.FreePhysicalMemory = [uint64](10GB / 1KB)
    $script:sleeps = 0; $script:queueCalls = 0
    function Get-QueuedRunnerJob {
        $script:probeResult.FreePhysicalMemory = [uint64](9GB / 1KB)
        return [pscustomobject]@{ id = 42; labels = @('self-hosted', ('it-inventory-pilot-' + ('a' * 40))) }
    }
    Invoke-SupervisorLoop
    if ($script:queueCalls -ne 1 -or $script:sleeps -ne 1) { throw 'Post-queue capacity loss did not defer pickup.' }
    foreach ($name in @('state.json', 'pilot-attempt.json', 'instances', 'last-error.json')) {
        if (Test-Path -LiteralPath (Join-Path $base $name)) { throw 'Post-queue capacity loss consumed a pilot or fabricated failure.' }
    }
    Remove-Item -LiteralPath (Join-Path $base 'stop.requested') -Force
    # The real guarded boot retains its lifecycle checks, and the caller sets the
    # boot stage immediately before that call, rather than retaining isolation.
    $session = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-RunnerSession' }, $false)
    if ($session.Extent.Text -notmatch "RunnerOperationStage = 'vm-boot'\s+Start-GuardedVm") { throw 'Guarded boot lacks its own failure stage.' }
    Write-Host 'Memory admission regressions passed: boundaries, invalid/failed inspection, no pilot/session allocation, bounded waits and boot stage.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -notmatch '^ITIR-memory-[0-9a-f]{32}$') { throw 'Unexpected memory fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
