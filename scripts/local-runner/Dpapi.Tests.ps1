# Run in a fresh Windows PowerShell -NoProfile process. Dummy bytes only;
# no credential files, tokens, host configuration or elevation are used.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

Initialize-RunnerDpapi
$dummy = [Text.Encoding]::UTF8.GetBytes('ITIR disposable DPAPI regression bytes')
$cipher = $null
$roundTrip = $null
try {
    $cipher = [Security.Cryptography.ProtectedData]::Protect($dummy, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $roundTrip = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    if ($roundTrip.Length -ne $dummy.Length -or (Compare-Object $dummy $roundTrip -SyncWindow 0)) {
        throw 'Fresh-process LocalMachine DPAPI round trip failed.'
    }
    $cipher[$cipher.Length - 1] = $cipher[$cipher.Length - 1] -bxor 1
    $rejected = $false
    try { [void][Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine) }
    catch { $rejected = $true }
    if (-not $rejected) { throw 'DPAPI accepted modified ciphertext.' }
    Write-Host 'Fresh Windows PowerShell DPAPI dummy checks passed.'
} finally {
    [Array]::Clear($dummy, 0, $dummy.Length)
    if ($null -ne $cipher) { [Array]::Clear($cipher, 0, $cipher.Length) }
    if ($null -ne $roundTrip) { [Array]::Clear($roundTrip, 0, $roundTrip.Length) }
}
