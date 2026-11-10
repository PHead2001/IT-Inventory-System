# Offline cleanup regression: all VM/provider operations are mocked; only TEMP
# fixture files are created. Optional source path supports a committed-source red.
[CmdletBinding()]
param([string] $SourcePath = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrEmpty($SourcePath)) { $SourcePath = Join-Path $PSScriptRoot 'Common.ps1' }
. $SourcePath
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-cleanup-tests-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixtureRoot)
$fixtureRoot = [IO.Path]::GetFullPath($fixtureRoot)
$script:checks = 0
function Assert-Check([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
    $script:checks++
}
function New-CleanupFixture([string] $Mode, [int] $Layout = 1) {
    $script:mode = $Mode; $script:removed = $false; $script:removeCalls = 0; $script:stopCalls = 0
    $script:RunnerRoot = Join-Path $fixtureRoot $Mode
    [void][IO.Directory]::CreateDirectory($script:RunnerRoot)
    $script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
    $name = 'ITIR-' + ('a' * 32)
    $instance = Join-Path (Join-Path $script:RunnerRoot 'instances') $name
    [void][IO.Directory]::CreateDirectory($instance)
    $script:diskPath = Join-Path $instance 'guest.vhdx'
    [IO.File]::WriteAllText($script:diskPath, 'unchanged disk bytes')
    $script:fixtureState = [pscustomobject]@{ tag = $script:RunnerTag; vmName = $name; instancePath = $instance; vmId = '11111111-1111-1111-1111-111111111111' }
    if($Layout -eq 2){
        $script:fixtureState|Add-Member layoutVersion 2
        [void][IO.Directory]::CreateDirectory((Join-Path $instance 'vm-data'))
        $nested=Join-Path $instance 'vm-data\guest.vhdx';Move-Item -LiteralPath $script:diskPath -Destination $nested;$script:diskPath=$nested
    }
    if ($Mode -in @('rename-legacy','rename-disk-only','rename-nested-config','rename-root-config')) { $script:fixtureState.PSObject.Properties.Remove('vmId') }
    if ($Mode -eq 'wrong-recorded-guid') { $script:fixtureState.vmId = '22222222-2222-2222-2222-222222222222' }
    if ($Mode -eq 'invalid-recorded-guid') { $script:fixtureState.vmId = 'invalid' }
    Write-RunnerJson $script:RunnerStatePath $script:fixtureState
    $script:stateBefore = [IO.File]::ReadAllText($script:RunnerStatePath)
    $script:vmFixture = [pscustomobject]@{
        Id = [guid]'11111111-1111-1111-1111-111111111111'; Name = $name
        Notes = $script:RunnerTag; Path = Join-Path $instance $name; State = 'Off'
    }
    if($Layout -eq 2){$script:vmFixture.Path=(Get-RunnerSessionPaths $script:fixtureState).vmPath}
    if($Mode -ceq 'partial-creation'){$script:vmFixture.Notes='';$script:fixtureState|Add-Member phase 'creating';$script:fixtureState|Add-Member expectedBootDisk $script:diskPath;$script:fixtureState|Add-Member expectedVmPath $script:vmFixture.Path;Write-RunnerJson $script:RunnerStatePath $script:fixtureState}
    if ($Mode -eq 'stop-error') { $script:vmFixture.State = 'Running' }
    if ($Mode -in @('rename-guid','rename-legacy','rename-disk-only','rename-nested-config','rename-root-config')) { $script:vmFixture.Name = 'ITIR-' + ('b' * 32) }
    if ($Mode -eq 'rename-disk-only') { $script:vmFixture.Path = Join-Path $script:RunnerRoot 'unrelated-config' }
    if ($Mode -eq 'rename-nested-config') { $script:vmFixture.Path = Join-Path $instance 'alternate\configuration' }
    if ($Mode -eq 'rename-root-config') { $script:vmFixture.Path = $instance }
    if ($Mode -eq 'rename-missing-path') { $script:fixtureState.PSObject.Properties.Remove('vmId'); $script:vmFixture.Name = 'ITIR-' + ('b' * 32); $script:vmFixture.Path = $null; Write-RunnerJson $script:RunnerStatePath $script:fixtureState; $script:stateBefore = [IO.File]::ReadAllText($script:RunnerStatePath) }
}
function Get-VM {
    [CmdletBinding()]
    param([string] $Name)
    if ($script:mode -in @('lookup-error', 'lookup-partial') -or ($script:removed -and $script:mode -eq 'post-lookup-error')) {
        if ($script:mode -eq 'lookup-partial') { $script:vmFixture }
        Write-Error 'Synthetic VM object lookup failure.'
        return
    }
    if ($script:mode -in @('true-absence', 'hidden-registration')) { return }
    if ($script:mode -eq 'lookup-duplicate') { $script:vmFixture; $script:vmFixture; return }
    if (-not $script:removed -or $script:mode -eq 'post-present') { return $script:vmFixture }
    if ($script:mode -eq 'post-renamed') { $script:vmFixture.Name = 'ITIR-' + ('b' * 32); return $script:vmFixture }
}
function Get-CimInstance {
    [CmdletBinding()]
    param($Namespace, $ClassName, $OperationTimeoutSec)
    if ($Namespace -cne 'root/virtualization/v2' -or $ClassName -cne 'Msvm_ComputerSystem' -or $OperationTimeoutSec -ne 10) { throw 'Unexpected provider query.' }
    if ($script:mode -eq 'provider-error' -or ($script:removed -and $script:mode -eq 'post-provider-error')) { throw 'Synthetic provider unavailable.' }
    if ($script:mode -eq 'incomplete-provider') { return }
    [pscustomobject]@{ Caption = 'Hosting Computer System'; Name = 'fixture-host'; ElementName = 'fixture-host' }
    if ($script:mode -eq 'provider-partial' -or ($script:removed -and $script:mode -eq 'post-provider-partial')) { Write-Error 'Synthetic partial provider failure.'; return }
    if ($script:mode -ne 'true-absence' -and (-not $script:removed -or $script:mode -in @('post-present','post-renamed','post-hidden-registration'))) {
        $name = if ($script:mode -eq 'provider-name-mismatch') { 'renamed-provider-vm' } else { $script:vmFixture.Name }
        [pscustomobject]@{ Caption = 'Virtual Machine'; Name = $script:vmFixture.Id.ToString(); ElementName = $name }
        if ($script:mode -eq 'provider-duplicate') { [pscustomobject]@{ Caption = 'Virtual Machine'; Name = $script:vmFixture.Id.ToString(); ElementName = $name } }
    }
}
function Get-VMHardDiskDrive {
    [CmdletBinding()]
    param($VM, $VMName)
    if ($null -ne $VM -and -not [object]::ReferenceEquals($VM, $script:vmFixture)) { throw 'Disk lookup did not bind to the inspected VM.' }
    if ($script:mode -eq 'disk-error') { throw 'Synthetic disk inspection failure.' }
    if ($script:mode -in @('rename-nested-config','rename-root-config')) { [pscustomobject]@{ Path = Join-Path $script:RunnerRoot 'external-disk.vhdx' }; return }
    [pscustomobject]@{ Path = $script:diskPath }
}
function Get-VHD($Path) {
    if ($Path -ine $script:diskPath -and $Path -ine (Join-Path $script:RunnerRoot 'external-disk.vhdx')) { throw 'Disk lookup escaped the fixed cleanup fixture.' }
    return [pscustomobject]@{ VhdType = 'Dynamic'; ParentPath = '' }
}
function Stop-VM {
    [CmdletBinding()]
    param($VM, $Name, [switch] $TurnOff, [switch] $Force)
    if (-not [object]::ReferenceEquals($VM, $script:vmFixture)) { throw 'Stop did not bind to the inspected VM.' }
    $script:stopCalls++
    if ($script:mode -eq 'stop-error') { throw 'Synthetic VM stop failed.' }
}
function Remove-VM {
    [CmdletBinding()]
    param($VM, $Name, [switch] $Force)
    if (-not [object]::ReferenceEquals($VM, $script:vmFixture)) { throw 'Removal did not bind to the inspected VM.' }
    $script:removeCalls++
    if ($script:mode -eq 'remove-error') { throw 'Synthetic VM removal failed.' }
    $script:removed = $true
}
function Assert-FixtureRetained([string] $Mode) {
    $failed = $false
    try { Remove-RunnerInstance $script:fixtureState } catch { $failed = $true }
    Assert-Check $failed "Cleanup accepted uncertain $Mode."
    Assert-Check (Test-Path -LiteralPath $script:diskPath) "Cleanup deleted disk after $Mode."
    Assert-Check (Test-Path -LiteralPath $script:RunnerStatePath) "Cleanup deleted state after $Mode."
    Assert-Check ([IO.File]::ReadAllText($script:diskPath) -ceq 'unchanged disk bytes') "Disk bytes changed after $Mode."
    Assert-Check ([IO.File]::ReadAllText($script:RunnerStatePath) -ceq $script:stateBefore) "State bytes changed after $Mode."
}
try {
    foreach($layout in @(1,2)){
    foreach ($mode in @('lookup-error','lookup-partial','lookup-duplicate','provider-error','provider-partial','provider-name-mismatch','provider-duplicate','incomplete-provider','hidden-registration','rename-guid','rename-legacy','rename-disk-only','rename-nested-config','rename-root-config','rename-missing-path','wrong-recorded-guid','invalid-recorded-guid','disk-error','stop-error','remove-error','post-lookup-error','post-provider-error','post-provider-partial','post-present','post-renamed','post-hidden-registration')) {
        New-CleanupFixture $mode $layout
        Assert-FixtureRetained $mode
        if ($mode -in @('lookup-error','lookup-partial','lookup-duplicate','provider-error','provider-name-mismatch','provider-duplicate','incomplete-provider','hidden-registration','disk-error','stop-error')) {
            Assert-Check ($script:removeCalls -eq 0) "Cleanup removed a VM after $mode."
        }
    }
    foreach ($mode in @('true-absence','verified-removal','partial-creation')) {
        New-CleanupFixture $mode $layout
        Remove-RunnerInstance $script:fixtureState
        Assert-Check (-not (Test-Path -LiteralPath $script:fixtureState.instancePath)) "Verified $mode retained instance unexpectedly."
        Assert-Check (-not (Test-Path -LiteralPath $script:RunnerStatePath)) "Verified $mode retained state unexpectedly."
        $expectedRemovals = if ($mode -eq 'true-absence') { 0 } else { 1 }
        Assert-Check ($script:removeCalls -eq $expectedRemovals) "Verified $mode removed the wrong VM count."
    }
    }
    Write-Host "Cleanup integrity regression passed ($script:checks checks)."
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^ITIR-cleanup-tests-[0-9a-f]{32}$') { throw 'Unsafe cleanup fixture path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
