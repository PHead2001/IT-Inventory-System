# Offline actual queue/loop/status behavior. TEMP only; no credentials, API or VM operations.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-observation-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
$script:freeBytes = [decimal]6.5 * 1GB
$script:messages = [Collections.Generic.List[string]]::new()
$script:sleeps = 0; $script:sessions = 0; $script:blocked = $null
# Reconciliation must not acquire the installed runner's Global state mutex.
$script:stateLocked = $false
$script:fixtureStateDepth = 0
function Enter-RunnerLock { $script:fixtureStateDepth++; $script:stateLocked = $true; return 'fixture' }
function Exit-RunnerLock {
    if ($script:fixtureStateDepth -le 0) { throw 'Unbalanced fixture state release.' }
    $script:fixtureStateDepth--; $script:stateLocked = $script:fixtureStateDepth -gt 0
}
$fixtureOuter = Enter-RunnerLock; $fixtureInner = Enter-RunnerLock
Exit-RunnerLock $fixtureInner
if (-not $script:stateLocked) { throw 'Nested state release exposed memory IO.' }
Exit-RunnerLock $fixtureOuter
if ($script:stateLocked -or $script:fixtureStateDepth -ne 0) { throw 'State fixture did not balance.' }
$config = [pscustomobject]@{activation='active';label='it-inventory-ephemeral';repo='example/fixture';memoryBytes=99GB;hostReserveBytes=0}
function Assert-RunnerTransitionClear {}
function Get-RunnerConfig { return $config }
function Get-RunnerState { return $null }
function Get-OwnerToken { return 'dummy' }
function Get-CimInstance { if ($script:stateLocked) { throw 'Capacity inspection held the reconciliation state mutex.' }; return [pscustomobject]@{FreePhysicalMemory=[uint64]($script:freeBytes/1KB);TotalVisibleMemorySize=[uint64](32GB/1KB)} }
function Invoke-GitHub {
    param($Uri,$Method,$Body,$Token)
    if ($Uri -match '/runs\?status=queued') { return [pscustomobject]@{total_count=1;workflow_runs=@([pscustomobject]@{id=12})} }
    if ($Uri -match '/runs\?status=in_progress') { return [pscustomobject]@{total_count=0;workflow_runs=@()} }
    if ($Uri -match '/runs/12/jobs\?') { return [pscustomobject]@{total_count=1;jobs=@([pscustomobject]@{id=42;status='queued';runner_id=0;labels=@('self-hosted','it-inventory-heavy')})} }
    throw 'Unexpected API fixture request.'
}
function Start-Sleep {
    param($Seconds)
    if ($Seconds -ne 1 -or $script:sleeps -ge 30) { throw 'Capacity recovery lost its stop-aware bounded backoff.' }
    $script:sleeps++
    if ($script:sleeps -eq 30) {
        $script:blocked = Read-RunnerJson (Join-Path $base 'controller-observation.json')
        $script:freeBytes = 7GB
    }
}
function Invoke-RunnerSession {
    param($Config,$PilotAttempt,$ProfileLabel)
    if ($ProfileLabel -cne 'it-inventory-heavy' -or $null -ne $PilotAttempt -or (Get-RunnerSessionProfile $Config $ProfileLabel).memoryBytes -ne 6GB) { throw 'Heavy selection lost its fixed candidate allocation.' }
    $script:sessions++
    [IO.File]::WriteAllText((Join-Path $base 'stop.requested'),'stop')
    return [pscustomobject]@{name='fixture';id=1;outcome='runner-exited'}
}
function Write-Host { param($Object) $script:messages.Add([string]$Object) }
function Write-EventLog { throw 'Capacity waiting fabricated a failure.' }
try {
    Invoke-SupervisorLoop
    if ($script:sleeps -ne 30 -or $script:sessions -ne 1 -or (Test-Path -LiteralPath (Join-Path $base 'last-error.json'))) { throw 'Heavy capacity did not resume automatically after a complete poll budget without failure/duplicate allocation.' }
    if ($script:blocked.outcome -cne 'waiting-capacity' -or $script:blocked.availableBytes -ne ([decimal]6.5*1GB)) { throw 'A blocked heavy queue was misreported as idle.' }
    $heavy = @($script:blocked.profiles | Where-Object label -CEQ 'it-inventory-heavy')[0]
    if ($heavy.observedQueued -ne 1 -or $heavy.ready -or $heavy.requiredBytes -ne 7GB -or $heavy.hostReserveBytes -ne 1GB) { throw 'Blocked queue observation lost its profile count/capacity.' }
    $ready = Read-RunnerJson (Join-Path $base 'controller-observation.json')
    if ($ready.outcome -cne 'session-starting' -or $ready.availableBytes -ne 7GB -or [DateTime]::Parse($ready.observedUtc).ToUniversalTime() -lt [DateTime]::UtcNow.AddMinutes(-1)) { throw 'Successful retry lost a fresh bounded poll observation.' }
    # Current capacity and historical queue observations remain explicitly separate.
    Write-RunnerJson (Join-Path $base 'controller-observation.json') $script:blocked
    $script:freeBytes = [decimal]7.76*1GB
    Show-RunnerCapacityStatus $config
    $output = $script:messages -join "`n"
    foreach ($expected in @('it-inventory-light: 2 GiB guest + 2 GiB host reserve = 4 GiB admission; fits',
        'it-inventory-mid: 4 GiB guest + 2 GiB host reserve = 6 GiB admission; fits',
        'it-inventory-heavy: 6 GiB guest + 1 GiB host reserve = 7 GiB admission; fits',
        'it-inventory-ephemeral: 8 GiB guest + 2 GiB host reserve = 10 GiB admission; waiting for capacity',
        'waiting-capacity','Observed queued it-inventory-heavy: 1; capacity at that poll: blocked')) {
        if (-not $output.Contains($expected)) { throw "Capacity status omitted $expected." }
    }
    if (($output + (Get-Content -LiteralPath (Join-Path $base 'controller-observation.json') -Raw)).Contains('dummy')) { throw 'Observation leaked the credential fixture.' }
    [IO.File]::WriteAllText((Join-Path $base 'controller-observation.json'),'{broken')
    $script:messages.Clear(); Show-RunnerCapacityStatus $config
    if (-not ($script:messages -join "`n").Contains('observation unavailable or invalid')) { throw 'Corrupt observation hid its limitation.' }
    $sessionName = 'ITIR-' + ('c' * 32)
    $session = [pscustomobject]@{tag=$script:RunnerTag;vmName=$sessionName;instancePath=(Join-Path (Join-Path $base 'instances') $sessionName);resourceLabel='it-inventory-heavy'}
    $vm = [pscustomobject]@{Name=$sessionName;Notes=$script:RunnerTag;Path=(Join-Path $session.instancePath $sessionName)}
    $script:memoryReads=0
    function Get-VMMemory { $script:memoryReads++; return [pscustomobject]@{Startup=6GB;DynamicMemoryEnabled=$false} }
    $script:messages.Clear(); Show-RunnerSessionResources $session $vm
    if ($script:memoryReads -ne 1 -or -not ($script:messages -join "`n").Contains('startup memory 6.00 GiB; dynamic memory False; expected fixed guest 6 GiB')) { throw 'Verified active VM status lost actual candidate memory readback.' }
    $vm.Notes='unowned'; $script:messages.Clear(); Show-RunnerSessionResources $session $vm
    if ($script:memoryReads -ne 1 -or -not ($script:messages -join "`n").Contains('ownership is unverified')) { throw 'Status read memory from an unverified VM.' }
if ($script:fixtureStateDepth -ne 0 -or $script:stateLocked) { throw 'Fixture leaked state recursion.' }
    Microsoft.PowerShell.Utility\Write-Host 'Capacity observation passed: heavy waiting/resume at 7 GiB, no config overrides, bounded poll counts/timestamps, complete per-profile status and malformed observation fallback.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -notmatch '^ITIR-observation-[0-9a-f]{32}$') { throw 'Unexpected observation fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
