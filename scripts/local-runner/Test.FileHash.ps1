# Offline fixtures only. Restricted PS5 hosts may not expose Get-FileHash.
# Read the actual fixture bytes; never substitute a canned digest or change
# module search paths. The production command remains used when available.
if ($null -eq (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
    function Get-FileHash {
        param([Parameter(Mandatory,Position=0)][Alias('Path')][string]$LiteralPath,
            [ValidateSet('SHA256')][string]$Algorithm = 'SHA256')
        $stream=[IO.File]::OpenRead($LiteralPath);$sha=[Security.Cryptography.SHA256]::Create()
        try { return [pscustomobject]@{Algorithm=$Algorithm;Hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','');Path=[IO.Path]::GetFullPath($LiteralPath)} }
        finally {$sha.Dispose();$stream.Dispose()}
    }
}
