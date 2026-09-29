# Offline regression tests: no elevation, web requests or host provisioning.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Setup.Download.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "ITIR-download-$([guid]::NewGuid().ToString('N'))"
[void][IO.Directory]::CreateDirectory((Join-Path $testRoot 'image'))
$script:RunnerRoot = $testRoot
$path = Join-Path (Join-Path $testRoot 'image') 'ubuntu-24.04-server-cloudimg-amd64.img'
$temporary = "$path.downloading"
$payload = [Text.Encoding]::UTF8.GetBytes('complete offline Ubuntu artifact fixture')
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($sha.ComputeHash($payload))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
$script:downloadCalls = 0
$download = {
    param($source, $destination)
    if ($source -ne 'https://example.invalid/pinned') { throw 'Unexpected download source.' }
    if ($destination -ne $temporary -or (Test-Path -LiteralPath $path)) {
        throw 'A download was published before checksum verification.'
    }
    $script:downloadCalls++
    [IO.File]::WriteAllBytes($destination, $payload)
}
function Assert-DownloadRejected([scriptblock] $Action, [string] $Expected) {
    $caught = $false
    try { & $Action } catch {
        if ($_.Exception.Message -notlike "*$Expected*") { throw }
        $caught = $true
    }
    if (-not $caught) { throw "Expected rejection: $Expected" }
}
try {
    # The legacy code never redownloaded this final-name interrupted output.
    [IO.File]::WriteAllText($path, 'interrupted legacy download')
    $unrelated = Join-Path (Join-Path $testRoot 'image') 'unrelated.cache'
    [IO.File]::WriteAllText($unrelated, 'preserve unrelated artifact')
    Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash $download
    if ($script:downloadCalls -ne 1 -or (Get-FileHash -LiteralPath $path).Hash -ine $hash) {
        throw 'Legacy partial download was not recovered.'
    }
    Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash { throw 'Valid cache was downloaded again.' }
    if ([IO.File]::ReadAllText($unrelated) -ne 'preserve unrelated artifact') { throw 'Unrelated cache changed.' }

    Remove-Item -LiteralPath $path -Force
    $interrupted = {
        param($source, $destination)
        [IO.File]::WriteAllText($destination, 'partial')
        throw 'simulated interruption'
    }
    Assert-DownloadRejected { Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash $interrupted } 'simulated interruption'
    if ((Test-Path -LiteralPath $path) -or (Test-Path -LiteralPath $temporary)) { throw 'Failed download leaked a published or partial artifact.' }
    # An abruptly killed process bypasses finally; resume cleans its exact file.
    [IO.File]::WriteAllText($temporary, 'stale interrupted download')
    Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash $download
    if ($script:downloadCalls -ne 2 -or (Test-Path -LiteralPath $temporary)) { throw 'Resume did not recover the stale partial.' }

    Remove-Item -LiteralPath $path -Force
    Assert-DownloadRejected {
        Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash {
            param($source, $destination)
            [IO.File]::WriteAllText($destination, 'wrong content')
        }
    } 'checksum mismatch'
    if ((Test-Path -LiteralPath $path) -or (Test-Path -LiteralPath $temporary)) { throw 'Checksum mismatch was published or retained.' }
    Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash $download
    if ((Get-FileHash -LiteralPath $path).Hash -ine $hash) { throw 'Checksum failure could not be retried.' }

    Assert-DownloadRejected {
        Get-SetupUbuntuArtifact (Join-Path $testRoot 'ubuntu-24.04-server-cloudimg-amd64.img') 'https://example.invalid/pinned' $hash $download
    } 'exact runner image directory'
    Assert-DownloadRejected {
        Get-SetupUbuntuArtifact $unrelated 'https://example.invalid/pinned' $hash $download
    } 'exact pinned Ubuntu artifact name'

    # Junction creation needs no administrator or symbolic-link privilege.
    $external = Join-Path $testRoot 'external'
    [void][IO.Directory]::CreateDirectory($external)
    $marker = Join-Path $external 'preserved.txt'
    [IO.File]::WriteAllText($marker, 'external content')
    New-Item -ItemType Junction -Path $temporary -Target $external | Out-Null
    try {
        Assert-DownloadRejected { Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash $download } 'reparse point'
        if ([IO.File]::ReadAllText($marker) -ne 'external content') { throw 'Reparse target changed.' }
    } finally { [IO.Directory]::Delete($temporary) }
    [void][IO.Directory]::CreateDirectory($temporary)
    try {
        Assert-DownloadRejected { Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash $download } 'occupied by a directory'
    } finally { [IO.Directory]::Delete($temporary) }

    $imageDirectory = Join-Path $testRoot 'image'
    $savedImageDirectory = Join-Path $testRoot 'image-saved'
    [IO.Directory]::Move($imageDirectory, $savedImageDirectory)
    try {
        New-Item -ItemType Junction -Path $imageDirectory -Target $external | Out-Null
        try {
            Assert-DownloadRejected { Get-SetupUbuntuArtifact $path 'https://example.invalid/pinned' $hash $download } 'reparse point'
            if ([IO.File]::ReadAllText($marker) -ne 'external content') { throw 'Ancestor reparse target changed.' }
        } finally { [IO.Directory]::Delete($imageDirectory) }
    } finally { [IO.Directory]::Move($savedImageDirectory, $imageDirectory) }

    $wslPath = Join-Path $imageDirectory 'ubuntu-24.04.5-wsl-amd64.wsl'
    Get-SetupUbuntuArtifact $wslPath 'https://example.invalid/pinned' $hash {
        param($source, $destination)
        if ($destination -ne "$wslPath.downloading" -or (Test-Path -LiteralPath $wslPath)) { throw 'WSL download was published early.' }
        [IO.File]::WriteAllBytes($destination, $payload)
    }
    if ((Get-FileHash -LiteralPath $wslPath).Hash -ine $hash) { throw 'Pinned WSL artifact was not verified.' }
    Get-SetupUbuntuArtifact $wslPath 'https://example.invalid/pinned' $hash { throw 'Valid WSL cache was downloaded again.' }
    Write-Host "Setup download regressions passed; PowerShell $($PSVersionTable.PSVersion); fixture SHA256 $hash; fake successful downloads $script:downloadCalls."
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^ITIR-download-[0-9a-f]{32}$') {
        throw 'Refusing cleanup outside the exact disposable download test directory.'
    }
    $links = @(Get-ChildItem -LiteralPath $resolved -Recurse -Force |
        Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($links.Count -gt 0) { throw 'Download test cleanup contains a reparse point.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
