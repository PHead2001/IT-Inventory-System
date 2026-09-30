# NoCloud matches a stable MAC. Hyper-V's dynamic MAC may be all-zero before first boot.
# Call assignment only inside the caller's owned, never-booted VM setup lifecycle.
function New-RunnerGuestMac {
    $random = $null
    try {
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        $bytes = [byte[]]::new(5)
        $random.GetBytes($bytes)
        # 02 marks a locally administered unicast address; five random bytes remain.
        return '02' + (($bytes | ForEach-Object { $_.ToString('X2') }) -join '')
    } catch { throw 'Guest MAC generation failed.' }
    finally { if ($null -ne $random) { $random.Dispose() } }
}

function Get-RunnerGuestAdapter([string] $VmName) {
    if ($VmName -cnotmatch '^ITIR-[0-9a-f]{32}$') { throw 'Guest VM name is invalid.' }
    try { $adapters = @(Get-VMNetworkAdapter -VMName $VmName -ErrorAction Stop) }
    catch { throw 'Guest adapter inspection failed.' }
    if ($adapters.Count -ne 1 -or $adapters[0].VMName -cne $VmName -or
        $adapters[0].SwitchName -cne 'ITIR-Isolated') {
        throw 'Guest must have exactly one adapter on the intended switch.'
    }
    return $adapters[0]
}

function Assert-RunnerGuestMac([string] $VmName, [string] $ExpectedMac) {
    if ($ExpectedMac -notmatch '^02[0-9a-fA-F]{10}$') { throw 'Expected guest MAC is invalid.' }
    $adapter = Get-RunnerGuestAdapter $VmName
    if ($adapter.DynamicMacAddressEnabled -ne $false -or
        [string]$adapter.MacAddress -ine $ExpectedMac) {
        throw 'Guest static MAC readback failed.'
    }
}

function Set-RunnerGuestMac([string] $VmName, [ValidateRange(1, 32)][int] $MaxAttempts = 8) {
    $adapter = Get-RunnerGuestAdapter $VmName
    try { $vm = Get-VM -Name $VmName -ErrorAction Stop }
    catch { throw 'Guest VM inspection failed.' }
    if ($vm.Name -cne $VmName -or $vm.State -ne 'Off') { throw 'Guest MAC assignment requires the intended VM to be off.' }
    for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
        $candidate = New-RunnerGuestMac
        if ($candidate -notmatch '^02[0-9a-fA-F]{10}$') { throw 'Generated guest MAC is invalid.' }
        try {
            # Include management adapters as well as all VM adapters; never alter any of them.
            $existing = @(Get-VMNetworkAdapter -All -ErrorAction Stop)
            $macs = @($existing | ForEach-Object {
                if ([string]$_.MacAddress -notmatch '^[0-9a-fA-F]{12}$') { throw 'Invalid inspected MAC.' }
                ([string]$_.MacAddress).ToUpperInvariant()
            })
        } catch { throw 'Existing adapter MAC inspection failed.' }
        if ($macs -icontains $candidate) { continue }
        try { Set-VMNetworkAdapter -VMNetworkAdapter $adapter -StaticMacAddress $candidate -ErrorAction Stop }
        catch { throw 'Guest static MAC assignment failed.' }
        Assert-RunnerGuestMac $VmName $candidate
        return [pscustomobject]@{
            rawMac = $candidate.ToUpperInvariant()
            seedMac = ($candidate.ToLowerInvariant() -replace '(..)(?!$)', '$1:')
        }
    }
    throw 'Guest MAC collision retry limit reached.'
}
