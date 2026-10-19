# Actual direct Supervise entry and canonical bundle validator in protected-path
# TEMP fixtures. ACL/locks/admin/cleanup/transport are inert; no host/API writes.
param([string] $CandidateRunner = (Join-Path $PSScriptRoot 'Runner.ps1'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Update.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile($CandidateRunner, [ref]$null, [ref]$null)
$entry = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-Supervisor' }, $false)
if ($null -eq $entry) { throw 'Actual supervisor entry missing.' }
Invoke-Expression $entry.Extent.Text
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-supervisor-coherence-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:realCoherence = (Get-Command Get-CoherentInstalledRunnerBundle).ScriptBlock
$script:realTransition = (Get-Command Assert-RunnerTransitionClear).ScriptBlock
$script:checks = 0
function Assert-Administrator {}
function Assert-SecureRoot {}
function Assert-RunnerProtectedPath($Path) {
    [void](Assert-OwnedPath $Path)
    if (-not (Test-Path -LiteralPath $Path) -or ($script:badAcl -and $Path.EndsWith($script:badAcl))) { throw 'TEMP protected path refused.' }
}
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1') {
    if ($Name -ceq 'Global\ITInventoryLocalRunner-Supervisor-v1') {
        if ($script:lifetime -or $script:depth -ne 0) { throw 'Invalid lifetime admission.' }
        $script:lifetime = $true; return 'lifetime'
    }
    if (-not $script:lifetime -or $script:depth -ne 0) { throw 'Invalid publication mutex admission.' }
    $script:depth = 1
    if ($script:pendingOnLock) { Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') ([ordered]@{tag=$script:RunnerTag;phase='pending'}) }
    return 'state'
}
function Exit-RunnerLock($Mutex) {
    if ($Mutex -ceq 'state') { if ($script:depth -ne 1) { throw 'State lock imbalance.' }; $script:depth = 0 }
    elseif ($Mutex -ceq 'lifetime') { if (-not $script:lifetime -or $script:depth -ne 0) { throw 'Lifetime lock imbalance.' }; $script:lifetime = $false }
    else { throw 'Unexpected lock identity.' }
}
function Assert-RunnerTransitionClear { & $script:realTransition }
function Get-CoherentInstalledRunnerBundle {
    if ($script:depth -ne 1 -or -not $script:lifetime) { throw 'Coherence outside publication/lifetime mutex.' }
    $script:coherence++; return & $script:realCoherence
}
function Get-RunnerState { $script:stateReads++; return Read-RunnerJson $script:RunnerStatePath }
function Remove-RunnerInstance($State) {
    $script:cleanup++
    if ($script:depth -ne 1 -or $script:coherence -ne 1) { throw 'Cleanup before live coherence.' }
    if ($script:cleanupFailure) { throw 'Exact cleanup refused.' }
    Remove-Item -LiteralPath $script:RunnerStatePath
}
function Get-OwnerToken { $script:tokens++; return 'synthetic-noncredential' }
function Invoke-GitHub { $script:api++ }
function Invoke-SupervisorLoop {
    if ($script:depth -ne 0 -or -not $script:lifetime) { throw 'Loop/network retained publication mutex or lost lifetime ownership.' }
    $script:loops++; [void](Get-OwnerToken); Invoke-GitHub
}
function New-Fixture([string] $Case) {
    $script:RunnerRoot = Join-Path $base $Case
    $script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
    $bin = Join-Path $script:RunnerRoot 'bin'; [void][IO.Directory]::CreateDirectory($bin)
    $source = Get-Content (Join-Path $PSScriptRoot 'Bundle.json') -Raw | ConvertFrom-Json
    $files = foreach ($file in $source.files) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file.name) -Destination (Join-Path $bin $file.name)
        [ordered]@{name=$file.name;hash=(Get-FileHash (Join-Path $bin $file.name)).Hash}
    }
    Write-RunnerJson (Join-Path $bin 'Bundle.json') ([ordered]@{schema=1;tag=$script:RunnerTag;version='2026-10-09.10';files=@($files)})
    Write-RunnerJson (Join-Path $script:RunnerRoot 'installed-bundle.json') ([ordered]@{tag=$script:RunnerTag;version='2026-10-09.10';manifestHash=(Get-FileHash (Join-Path $bin 'Bundle.json')).Hash})
    Write-RunnerJson $script:RunnerStatePath ([ordered]@{tag=$script:RunnerTag;vmName='ITIR-'+('a'*32)})
    $script:coherence=0;$script:cleanup=0;$script:tokens=0;$script:api=0;$script:loops=0;$script:stateReads=0
    $script:lifetime=$false;$script:depth=0;$script:badAcl='';$script:pendingOnLock=$false;$script:cleanupFailure=$false
    return $bin
}
try {
    foreach ($case in @('receipt-missing','receipt-malformed','receipt-mismatch','manifest-missing','manifest-malformed','manifest-identity','dependency-missing','dependency-tampered','protected-path','pending-transition','pending-on-lock')) {
        $bin=New-Fixture $case
        $receipt=Join-Path $script:RunnerRoot 'installed-bundle.json';$manifest=Join-Path $bin 'Bundle.json';$dependency=Join-Path $bin 'Common.ps1'
        switch($case) {
            'receipt-missing' {Remove-Item -LiteralPath $receipt}
            'receipt-malformed' {[IO.File]::WriteAllText($receipt,'not-json')}
            'receipt-mismatch' {Write-RunnerJson $receipt ([ordered]@{tag=$script:RunnerTag;version='2026-10-09.10';manifestHash=('0'*64)})}
            'manifest-missing' {Remove-Item -LiteralPath $manifest}
            'manifest-malformed' {[IO.File]::WriteAllText($manifest,'not-json')}
            'manifest-identity' {$bad=Read-RunnerJson $manifest;$bad.tag='wrong';Write-RunnerJson $manifest $bad}
            'dependency-missing' {Remove-Item -LiteralPath $dependency}
            'dependency-tampered' {[IO.File]::AppendAllText($dependency,'tampered')}
            'protected-path' {$script:badAcl='installed-bundle.json'}
            'pending-transition' {Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') ([ordered]@{tag=$script:RunnerTag;phase='pending'})}
            'pending-on-lock' {$script:pendingOnLock=$true}
        }
        $stateHash=(Get-FileHash $script:RunnerStatePath).Hash
        $rejected=$false;try {Invoke-Supervisor} catch {$rejected=$true}
        if (-not $rejected -or $script:cleanup -ne 0 -or $script:tokens -ne 0 -or $script:api -ne 0 -or $script:loops -ne 0 -or $script:stateReads -ne 0 -or
            $script:depth -ne 0 -or $script:lifetime -or (Get-FileHash $script:RunnerStatePath).Hash -cne $stateHash) { throw "Direct Supervise admitted $case before coherent installed provenance; cleanup/token/API/state must remain untouched." }
        $script:checks++;Write-Host "PASS direct Supervise refuses $case before cleanup/token/API/state"
    }
    [void](New-Fixture 'coherent')
    Invoke-Supervisor
    if ($script:coherence -ne 1 -or $script:cleanup -ne 1 -or $script:loops -ne 1 -or $script:tokens -ne 1 -or $script:api -ne 1 -or $script:depth -ne 0 -or $script:lifetime -or (Test-Path $script:RunnerStatePath)) {throw 'Coherent startup cleanup/loop ordering or lock release changed.'}
    $script:checks++;Write-Host 'PASS coherent direct Supervise recovers stale state then enters loop outside publication mutex'
    [void](New-Fixture 'cleanup-refused');$script:cleanupFailure=$true
    $rejected=$false;try {Invoke-Supervisor} catch {$rejected=$true}
    if (-not $rejected -or $script:coherence -ne 1 -or $script:cleanup -ne 1 -or $script:loops -ne 0 -or $script:tokens -ne 0 -or $script:api -ne 0 -or $script:depth -ne 0 -or $script:lifetime) {throw 'Cleanup failure entered reconciliation or leaked ownership.'}
    $script:checks++;Write-Host 'PASS exact cleanup refusal preserves no loop/API and releases startup locks'
    Write-Host "Supervisor coherence passed: $script:checks actual-entry/TEMP-canonical cases. No live ACL/provider/API proof."
} finally {
    $absolute=[IO.Path]::GetFullPath($base)
    if ([IO.Path]::GetDirectoryName($absolute).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($absolute) -cnotmatch '^ITIR-supervisor-coherence-[0-9a-f]{32}$') {throw 'Fixture cleanup escaped TEMP.'}
    Remove-Item -LiteralPath $absolute -Recurse -Force
}
