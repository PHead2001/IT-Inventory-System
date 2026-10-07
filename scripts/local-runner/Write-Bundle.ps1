# Source-authoring helper: writes only the versioned manifest in this checkout.
[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')][string] $Version)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $repository
try {
    & node (Join-Path $repository 'scripts/runner-image-inputs.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Trusted image snapshot generation failed; bundle was not published.' }
} finally { Pop-Location }
$names = @('Common.ps1', 'Runner.ps1', 'Guest.Network.ps1', 'PreparedImage.ps1', 'Image.Prepare.sh', 'Image.Inputs.json', 'Image.Package.json', 'Image.PackageLock.json', 'Image.Supabase.toml', 'SetupMenu.ps1', 'Setup.ps1', 'Setup.Download.ps1', 'Update.ps1',
    'Setup.cmd', 'Start.cmd', 'Restart.cmd', 'Stop.cmd', 'Status.cmd')
$files = foreach ($name in $names) {
    $path = Join-Path $PSScriptRoot $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Bundle dependency is missing or a reparse point.'
    }
    [ordered]@{ name = $name; hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
}
$manifest = [ordered]@{ schema = 1; tag = 'it-inventory-local-runner-v1'; version = $Version; files = @($files) }
$path = Join-Path $PSScriptRoot 'Bundle.json'
if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Manifest may not be a reparse point.' }
[IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $manifest -Depth 5) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "Source runner bundle manifest $Version written; review it with its scripts before host update."
