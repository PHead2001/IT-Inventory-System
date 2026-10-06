# Real cross-process jobs/mutexes; Hyper-V registration is a file-backed provider.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Start-GuardedVm' }, $true)
Invoke-Expression $definition.Extent.Text
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-boot-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
$script:bootLock = 'Local\ITIR-boot-' + [guid]::NewGuid().ToString('N')
$script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock { return & $script:realEnter $script:bootLock }
function Assert-SessionAlive($State) {
    if ($null -eq (Get-RunnerState)) { throw 'Guardian removed the session.' }
    if ($script:dispatched -and $script:scenario -in @('owner-exit', 'guardian-exit', 'deadline')) { throw $script:scenario }
}
function Get-VM($Name, $Id) {
    $vm = Read-RunnerJson (Join-Path $root 'vm.json')
    if ($null -eq $vm -or ($Id -and [guid]$vm.Id -ne [guid]$Id)) { throw 'Exact VM no longer registered.' }
    return $vm
}
function Start-VM($VM, [switch] $AsJob) {
    if (-not $AsJob -or $VM -is [string]) { throw 'Boot was not dispatched against the inspected VM object.' }
    $script:dispatched = $true
    $job = Start-Job -ArgumentList $PSScriptRoot, $root, $script:bootLock, $VM.Id, $script:scenario -ScriptBlock {
        param($source, $root, $lockName, $id, $scenario)
        $ErrorActionPreference = 'Stop'
        . (Join-Path $source 'Common.ps1')
        . (Join-Path $source 'Test.Mutex.ps1')
        $script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
        function Get-RunnerVmInventory { $entry = Read-RunnerJson (Join-Path $root 'vm.json'); if ($null -ne $entry) { $entry } }
        function Get-VMHardDiskDrive($VM) { return [pscustomobject]@{ Path = Join-Path (Get-RunnerState).instancePath 'guest.vhdx' } }
        function Remove-VM($VM, [switch] $Force) { if ($scenario -ceq 'cleanup-race') { Remove-Item -LiteralPath (Join-Path $root 'vm.json') } }
        # This must succeed while the supervisor waits for boot completion.
        $mutex = Enter-RunnerLock $lockName -FailFast
        try {
            [IO.File]::WriteAllText((Join-Path $root 'guardian-acquired'), 'ready')
            if ($scenario -in @('cleanup-race', 'cleanup-unverified')) { Remove-RunnerInstance (Get-RunnerState) }
        } finally { Exit-RunnerLock $mutex }
        Start-Sleep -Milliseconds 400
        if ($scenario -ceq 'provider-failure') { throw 'Fixture provider failure.' }
        # Delayed effect operates on the dispatched GUID only. Removal cannot
        # cause a later name lookup to restore or boot a different registration.
        $vm = Read-RunnerJson (Join-Path $root 'vm.json')
        if ($null -eq $vm -or [guid]$vm.Id -ne [guid]$id) { throw 'Dispatched identity was removed.' }
        $vm.State = 'Running'
        Write-RunnerJson (Join-Path $root 'vm.json') $vm
    }
    $script:jobs += $job
    return $job
}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true; $script:lastBootError = $_.Exception.Message }
    if (-not $rejected) { throw "Boot accepted $Case." }
}
$script:jobs = @()
try {
    foreach ($scenario in @('success', 'cleanup-race', 'cleanup-unverified', 'provider-failure', 'owner-exit', 'guardian-exit', 'deadline', 'wrong-guid')) {
        $script:scenario = $scenario; $script:dispatched = $false
        $name = 'ITIR-' + [guid]::NewGuid().ToString('N')
        $instance = Join-Path (Join-Path $root 'instances') $name
        [void][IO.Directory]::CreateDirectory($instance)
        [IO.File]::WriteAllText((Join-Path $instance 'guest.vhdx'), 'owned fresh disk')
        $state = [pscustomobject]@{ tag = $script:RunnerTag; vmName = $name; vmId = [guid]::NewGuid().ToString(); instancePath = $instance; guardianReady = $true }
        $vm = [pscustomobject]@{ Id = $state.vmId; Name = $name; Notes = $script:RunnerTag; Path = Join-Path $instance $name
            State = 'Off'; AutomaticStartAction = 'Nothing'; AutomaticStopAction = 'TurnOff' }
        if ($scenario -ceq 'wrong-guid') { $vm.Id = [guid]::NewGuid().ToString() }
        Write-RunnerJson $script:RunnerStatePath $state; Write-RunnerJson (Join-Path $root 'vm.json') $vm
        if (Test-Path (Join-Path $root 'guardian-acquired')) { Remove-Item -LiteralPath (Join-Path $root 'guardian-acquired') }
        if ($scenario -ceq 'success') { Start-GuardedVm $state }
        else { Assert-Rejected { Start-GuardedVm $state } $scenario }
        if ($scenario -ceq 'wrong-guid' -and $script:dispatched) { throw 'Mismatched GUID reached boot dispatch.' }
        foreach ($job in $script:jobs) {
            if ($null -eq (Get-Job -Id $job.Id -ErrorAction SilentlyContinue)) { continue }
            [void](Wait-Job $job -Timeout 15)
            if ($job.State -notin @('Completed', 'Failed', 'Stopped')) { throw 'Fixture boot job remained pending.' }
            Remove-Job $job
        }
        $script:jobs = @()
        if ($scenario -ne 'wrong-guid' -and -not (Test-Path (Join-Path $root 'guardian-acquired'))) { throw 'Guardian could not acquire state mutex during pending boot.' }
        if ($scenario -ceq 'cleanup-race' -and ((Get-RunnerState) -or (Test-Path (Join-Path $root 'vm.json')))) { throw "Delayed boot restored a removed VM/session: $script:lastBootError" }
        if ($scenario -ceq 'cleanup-race' -and (Test-Path $instance)) { throw 'Verified canonical cleanup retained the old instance.' }
        if ($scenario -ceq 'cleanup-unverified' -and (-not (Get-RunnerState) -or -not (Test-Path (Join-Path $instance 'guest.vhdx')))) { throw 'Unverified provider removal lost state/disk.' }
    }
    Write-Host 'Guardian boot passed: real pending-job lock contention, delayed provider effect after cleanup, exact GUID, failed provider, owner/guardian exit and deadline refuse continuation.'
} finally {
    foreach ($job in $script:jobs) { if ($job.State -in @('Completed', 'Failed', 'Stopped')) { Remove-Job $job -ErrorAction SilentlyContinue } }
    Remove-Item -LiteralPath $root -Recurse -Force
}
