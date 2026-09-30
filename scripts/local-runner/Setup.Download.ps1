# Setup-only artifact recovery. Call under the setup lock and protected stage.
function Assert-SetupDownloadPath([string] $Path) {
    $Path = Assert-OwnedPath $Path
    $root = Get-Item -LiteralPath $script:RunnerRoot -Force -ErrorAction Stop
    if ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Runner download root may not be a reparse point.'
    }
    if (Test-Path -LiteralPath $Path) {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            throw 'An Ubuntu download artifact path is occupied by a directory.'
        }
    }
    return $Path
}

function Get-SetupUbuntuArtifact(
    [string] $Path, [string] $Uri,
    [ValidatePattern('^[0-9a-fA-F]{64}$')][string] $Sha256,
    [scriptblock] $Download = {
        param($Source, $Destination)
        Invoke-WebRequest -Uri $Source -OutFile $Destination -UseBasicParsing -TimeoutSec 1800 -ErrorAction Stop
    }
) {
    $name = [IO.Path]::GetFileName($Path)
    if ($name -notin @('ubuntu-24.04.5-wsl-amd64.wsl', 'ubuntu-24.04-server-cloudimg-amd64.img')) {
        throw 'Download recovery requires an exact pinned Ubuntu artifact name.'
    }
    $expectedPath = [IO.Path]::GetFullPath((Join-Path (Join-Path $script:RunnerRoot 'image') $name))
    if (-not [IO.Path]::GetFullPath($Path).Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Download recovery requires the exact runner image directory.'
    }
    $Path = Assert-SetupDownloadPath $Path
    $temporary = Assert-SetupDownloadPath "$Path.downloading"
    if (Test-Path -LiteralPath $Path) {
        if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ieq $Sha256) { return }
        # Repair only this legacy final-name partial, never other cache entries.
        [void](Assert-SetupDownloadPath $Path)
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $temporary) {
        [void](Assert-SetupDownloadPath $temporary)
        Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop
    }
    try {
        & $Download $Uri $temporary | Out-Null
        [void](Assert-SetupDownloadPath $temporary)
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ine $Sha256) {
            throw "Downloaded Ubuntu artifact checksum mismatch: $name"
        }
        [void](Assert-SetupDownloadPath $Path)
        # Same-directory rename publishes only a verified complete download.
        [IO.File]::Move($temporary, $Path)
    } finally {
        if (Test-Path -LiteralPath $temporary) {
            [void](Assert-SetupDownloadPath $temporary)
            Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop
        }
    }
}
