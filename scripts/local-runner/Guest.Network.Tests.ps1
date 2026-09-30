# Offline regression checks. Hyper-V access/mutation is mocked before any helper call.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Guest.Network.ps1')
$script:guestVmName = 'ITIR-00000000000000000000000000000001'
$script:realGuestMacGenerator = (Get-Command New-RunnerGuestMac).ScriptBlock
$randomMac = & $script:realGuestMacGenerator
if ($randomMac -cnotmatch '^02[0-9A-F]{10}$') { throw 'Cryptographic generator did not return a local unicast MAC.' }
function Reset-GuestNetworkFixture {
    $script:guestAdapter = [pscustomobject]@{
        VMName = $script:guestVmName; SwitchName = 'ITIR-Isolated'
        MacAddress = '000000000000'; DynamicMacAddressEnabled = $true
    }
    $script:guestVm = [pscustomobject]@{ Name = $script:guestVmName; State = 'Off' }
    $script:guestAdapterCount = 1; $script:guestSetCalls = 0; $script:guestRandomCalls = 0
    $script:guestCandidates = @('021122334455'); $script:guestExistingMacs = @('000000000000')
    $script:guestInspectionFails = $false; $script:guestSetFails = $false; $script:guestReadbackMode = 'normal'
}
function Get-VM {
    param($Name, $ErrorAction)
    if ($Name -cne $script:guestVmName) { throw 'Unexpected mocked VM inspection.' }
    return $script:guestVm
}
function Get-VMNetworkAdapter {
    param($VMName, [switch]$All, $ErrorAction)
    if ($All) {
        if ($script:guestInspectionFails) { throw 'Sensitive inspection detail must not escape.' }
        foreach ($mac in $script:guestExistingMacs) { [pscustomobject]@{ MacAddress = $mac } }
        return
    }
    if ($VMName -cne $script:guestVmName) { throw 'Unexpected mocked adapter inspection.' }
    for ($index = 0; $index -lt $script:guestAdapterCount; $index++) { $script:guestAdapter }
}
function Set-VMNetworkAdapter {
    param($VMNetworkAdapter, $StaticMacAddress, $ErrorAction)
    if (-not [object]::ReferenceEquals($VMNetworkAdapter, $script:guestAdapter)) { throw 'Mutated a different adapter.' }
    $script:guestSetCalls++
    if ($script:guestSetFails) { throw 'Sensitive assignment detail must not escape.' }
    switch ($script:guestReadbackMode) {
        'normal' { $script:guestAdapter.MacAddress = $StaticMacAddress; $script:guestAdapter.DynamicMacAddressEnabled = $false }
        'wrong-mac' { $script:guestAdapter.MacAddress = '02FFFFFFFFFF'; $script:guestAdapter.DynamicMacAddressEnabled = $false }
        'dynamic' { $script:guestAdapter.MacAddress = $StaticMacAddress }
        'zero' { $script:guestAdapter.DynamicMacAddressEnabled = $false }
    }
}
function New-RunnerGuestMac {
    $index = [Math]::Min($script:guestRandomCalls, $script:guestCandidates.Count - 1)
    $script:guestRandomCalls++
    return $script:guestCandidates[$index]
}
function Assert-GuestNetworkRejected([scriptblock] $Work, [string] $ExpectedError) {
    $actual = $null
    try { & $Work | Out-Null } catch { $actual = $_.Exception.Message }
    if ($actual -cne $ExpectedError) { throw "Guest network rejection mismatch: expected fixed error '$ExpectedError'." }
}

Reset-GuestNetworkFixture
if ($script:guestAdapter.MacAddress -cne '000000000000' -or -not $script:guestAdapter.DynamicMacAddressEnabled) {
    throw 'Fixture must reproduce the observed preboot zero dynamic MAC.'
}
$assigned = Set-RunnerGuestMac $script:guestVmName
if ($assigned.rawMac -cne '021122334455' -or $assigned.seedMac -cne '02:11:22:33:44:55' -or
    $script:guestSetCalls -ne 1 -or $script:guestAdapter.DynamicMacAddressEnabled) {
    throw 'Assignment did not replace the zero dynamic MAC with the matching static seed MAC.'
}
Assert-RunnerGuestMac $script:guestVmName $assigned.rawMac
$script:guestVm.State = 'Running'
Assert-RunnerGuestMac $script:guestVmName $assigned.rawMac
$script:guestAdapter.MacAddress = '02AAAAAAAAAA'
Assert-GuestNetworkRejected { Assert-RunnerGuestMac $script:guestVmName $assigned.rawMac } 'Guest static MAC readback failed.'

Reset-GuestNetworkFixture
$script:guestCandidates = @('02AABBCCDDEE', '021122334455')
$script:guestExistingMacs = @('02aabbccddee', '000000000000')
$assigned = Set-RunnerGuestMac $script:guestVmName
if ($script:guestRandomCalls -ne 2 -or $script:guestSetCalls -ne 1 -or $assigned.rawMac -cne '021122334455') {
    throw 'Existing MAC collision was not retried before assignment.'
}
Reset-GuestNetworkFixture
$script:guestExistingMacs = @('021122334455')
Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName -MaxAttempts 3 } 'Guest MAC collision retry limit reached.'
if ($script:guestRandomCalls -ne 3 -or $script:guestSetCalls -ne 0) { throw 'Collision retries were not bounded without mutation.' }

foreach ($mode in @('wrong-mac', 'dynamic', 'zero')) {
    Reset-GuestNetworkFixture
    $script:guestReadbackMode = $mode
    Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Guest static MAC readback failed.'
}
foreach ($count in @(0, 2)) {
    Reset-GuestNetworkFixture
    $script:guestAdapterCount = $count
    Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Guest must have exactly one adapter on the intended switch.'
    if ($script:guestSetCalls -ne 0) { throw 'Wrong adapter count allowed mutation.' }
}
foreach ($field in @('VMName', 'SwitchName')) {
    Reset-GuestNetworkFixture
    $script:guestAdapter.$field = 'unexpected'
    Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Guest must have exactly one adapter on the intended switch.'
    if ($script:guestSetCalls -ne 0) { throw 'Unexpected adapter identity allowed mutation.' }
}
Reset-GuestNetworkFixture
$script:guestVm.State = 'Running'
Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Guest MAC assignment requires the intended VM to be off.'
if ($script:guestSetCalls -ne 0) { throw 'Running VM allowed assignment.' }
Reset-GuestNetworkFixture
$script:guestInspectionFails = $true
Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Existing adapter MAC inspection failed.'
Reset-GuestNetworkFixture
$script:guestExistingMacs = @('invalid')
Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Existing adapter MAC inspection failed.'
Reset-GuestNetworkFixture
$script:guestSetFails = $true
Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Guest static MAC assignment failed.'
Reset-GuestNetworkFixture
$script:guestCandidates = @('000000000000')
Assert-GuestNetworkRejected { Set-RunnerGuestMac $script:guestVmName } 'Generated guest MAC is invalid.'
Assert-GuestNetworkRejected { Assert-RunnerGuestMac $script:guestVmName '000000000000' } 'Expected guest MAC is invalid.'
Assert-GuestNetworkRejected { Set-RunnerGuestMac 'unowned-vm' } 'Guest VM name is invalid.'
Write-Host 'Offline guest MAC assignment/stability/collision/failure regressions passed.'
