# Owner-invoked read-only host evidence. No credentials or runner state changes.
[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
Assert-SecureRoot
[void](Get-RunnerConfig)

$addresses = @(Get-NetIPAddress -ErrorAction Stop)
$routes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction Stop)
$nonDefault = @($routes | Where-Object DestinationPrefix -NE '0.0.0.0/0')
$switch = Get-VMSwitch -Name $script:RunnerSwitch -ErrorAction Stop
$nat = Get-NetNat -Name $script:RunnerNat -ErrorAction Stop
$add = Get-Command Add-VMNetworkAdapterExtendedAcl -ErrorAction Stop
$module = Get-Module -Name Hyper-V
$failure = Read-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json')
$attempt = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json')

$report = [ordered]@{
    kind = 'read-only-network-diagnostic'; powershell = $PSVersionTable.PSVersion.ToString()
    hyperVModule = [string]$module.Version; aclParameters = @($add.Parameters.Keys | Sort-Object)
    fingerprint = Get-HostNetworkFingerprint
    addressCount = $addresses.Count; routeCount = $routes.Count
    nonDefaultRouteCount = $nonDefault.Count
    duplicateRoutePrefixes = @($nonDefault | Group-Object DestinationPrefix | Where-Object Count -GT 1 | Select-Object Name, Count)
    addresses = @($addresses | Select-Object -First 128 AddressFamily, IPAddress, PrefixLength, InterfaceIndex)
    routes = @($routes | Select-Object -First 128 DestinationPrefix, NextHop, InterfaceIndex)
    truncated = $addresses.Count -gt 128 -or $routes.Count -gt 128
    switch = [ordered]@{ name = $switch.Name; id = [string]$switch.Id; type = [string]$switch.SwitchType }
    nat = [ordered]@{ name = $nat.Name; prefix = $nat.InternalIPInterfaceAddressPrefix }
    recordedVmPresent = $null -ne (Get-RunnerState)
    consumedJobId = $(if ($attempt) { $attempt.jobId } else { $null })
    lastFailureStage = $(if ($failure) { $failure.stage } else { $null })
    lastFailureCode = $(if ($failure) { $failure.code } else { $null })
}
ConvertTo-Json -InputObject $report -Depth 5 -Compress
