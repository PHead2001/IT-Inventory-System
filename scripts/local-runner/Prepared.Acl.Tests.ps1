# Descriptor-only ACL fixtures and real Windows file leases. Never assigns ACLs
# or uses an installed root/VM; native parent ACE evidence is recorded separately.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-prepared-acl-' + [guid]::NewGuid().ToString('N'))
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
$directory = Join-Path $base 'prepared-images'
[void][IO.Directory]::CreateDirectory($directory)
$disk = Join-Path $directory (('a' * 32) + '.vhdx')
[IO.File]::WriteAllText($disk, 'sealed public prepared inputs')
$script:descriptors = @{}; $script:checks = 0
$nativeSids = @('S-1-5-83-0', 'S-1-15-3-1024-2268835264-3721307629-241982045-173645152-1490879176-104643441-2915960892-1612460704')
function Check([bool] $Value, [string] $Case) { if (-not $Value) { throw $Case }; $script:checks++ }
function Refuse([scriptblock] $Work, [string] $Case, [string] $Message = '') {
    $errorSeen = $null; try { & $Work | Out-Null } catch { $errorSeen = $_ }
    Check ($null -ne $errorSeen) "Accepted $Case."
    if ($Message) { Check ($errorSeen.Exception.Message -like ('*' + $Message + '*')) "Wrong refusal for $Case." }
}
function New-Rule([string] $Sid, [long] $Rights = 1179785, [bool] $Inherited = $false, [int] $Inheritance = 0, [int] $Propagation = 0, [string] $Type = 'Allow') {
    return [pscustomobject]@{ IdentityReference = [Security.Principal.SecurityIdentifier]::new($Sid); FileSystemRights = $Rights
        IsInherited = $Inherited; InheritanceFlags = $Inheritance; PropagationFlags = $Propagation; AccessControlType = $Type }
}
function New-Descriptor($Rules = @(), [string] $Owner = 'S-1-5-18') {
    $acl = [pscustomobject]@{ Access = @((New-Rule 'S-1-5-18' 2032127 $true), (New-Rule 'S-1-5-32-544' 2032127 $true)) + @($Rules); OwnerSid = $Owner }
    $acl | Add-Member ScriptMethod GetOwner { param($type) return [Security.Principal.SecurityIdentifier]::new($this.OwnerSid) }
    return $acl
}
function Get-Acl([string] $LiteralPath) { if ($script:descriptors.ContainsKey($LiteralPath)) { return $script:descriptors[$LiteralPath] }; return New-Descriptor }
function Get-RunnerState { return $null }
function Assert-RunnerPreparationAuthorized {}
function Get-RunnerVmInventory { return @() }
$script:children = 0
function New-VHD($Path, $ParentPath, [switch] $Differencing) {
    Check $Differencing 'Child must be differencing.'
    Refuse { [IO.File]::WriteAllText($ParentPath, 'write') } 'parent write while creating child'
    [IO.File]::WriteAllText($Path, 'fresh child'); $script:children++
    $script:descriptors[$ParentPath] = New-Descriptor @((New-Rule $nativeSids[0]), (New-Rule $nativeSids[1]))
}
function Get-VHD($Path) {
    if ($Path -ne $disk -and (Test-Path -LiteralPath $Path)) { return [pscustomobject]@{ Attached = $false; VhdType = 'Differencing'; ParentPath = $disk } }
    return [pscustomobject]@{ Attached = $false; VhdType = 'Dynamic'; ParentPath = '' }
}
try {
    Assert-RunnerPreparedImagePath $disk
    $readers = @((New-Rule $nativeSids[0]), (New-Rule $nativeSids[1]))
    $script:descriptors[$disk] = New-Descriptor $readers
    Assert-RunnerPreparedImagePath $disk
    Check ($readers[0].FileSystemRights -eq ([long][Security.AccessControl.FileSystemRights]::Read -bor [long][Security.AccessControl.FileSystemRights]::Synchronize)) 'Observed native mask differs from Read|Synchronize.'
    foreach ($sid in $nativeSids) {
        $script:descriptors[$disk] = New-Descriptor @((New-Rule $sid 1))
        Assert-RunnerPreparedImagePath $disk
        foreach ($rights in @(0, -1, -2147483648, 2147483648, 268435456, 2032127, 1179787, 1179789, 1179801, 65536, 262144, 524288, 64, 16, 256)) {
            $script:descriptors[$disk] = New-Descriptor @((New-Rule $sid $rights))
            Refuse { Assert-RunnerPreparedImagePath $disk } "native forbidden rights $rights" 'unexpected access'
        }
        foreach ($rule in @((New-Rule $sid 1179785 $true), (New-Rule $sid 1179785 $false 1), (New-Rule $sid 1179785 $false 0 1))) {
            $script:descriptors[$disk] = New-Descriptor @($rule)
            Refuse { Assert-RunnerPreparedImagePath $disk } 'inherited/propagating native allow' 'unexpected access'
        }
    }
    foreach ($sid in @('S-1-1-0', 'S-1-5-32-545', 'S-1-5-83-1-1-1-1-1', 'S-1-15-3-1')) {
        $script:descriptors[$disk] = New-Descriptor @((New-Rule $sid))
        Refuse { Assert-RunnerPreparedImagePath $disk } 'arbitrary reader' 'unexpected access'
    }
    $script:descriptors[$disk] = New-Descriptor $readers 'S-1-5-32-545'
    Refuse { Assert-RunnerPreparedImagePath $disk } 'untrusted owner' 'owner is unexpected'
    $script:descriptors[$disk] = New-Descriptor (@($readers) + @((New-Rule 'S-1-1-0' 2032127 $false 0 0 'Deny'))) 'S-1-5-32-544'
    Assert-RunnerPreparedImagePath $disk # A deny grants nothing; admin ownership remains valid.
    $script:descriptors[$disk] = New-Descriptor $readers
    Refuse { Assert-RunnerProtectedPath $disk } 'generic path validation of prepared reader' 'unexpected access'
    $script:descriptors[$directory] = New-Descriptor @((New-Rule $nativeSids[0]))
    Refuse { Assert-RunnerPreparedImagePath $disk } 'native reader on parent directory' 'unexpected access'
    $script:descriptors.Remove($directory)
    foreach ($path in @((Join-Path $base 'base.vhdx'), (Join-Path $base (('a' * 32) + '.vhdx')), (Join-Path $directory 'other.vhdx'), (Join-Path $directory (('A' * 32) + '.vhdx')), (Join-Path $directory (('a' * 32) + '.json')), (Join-Path (Join-Path $directory 'nested') (('a' * 32) + '.vhdx')))) {
        Refuse { Assert-RunnerPreparedImagePath $path } 'namespace extension/location escape' 'fixed identity namespace'
    }
    foreach ($name in @('base.vhdx', 'config.json', 'token.dpapi', 'receipt.json', 'bin/Runner.ps1')) {
        $path = Join-Path $base $name; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)); [IO.File]::WriteAllText($path, 'fixture')
        $script:descriptors[$path] = New-Descriptor $readers
        Refuse { Assert-RunnerProtectedPath $path } "strict generic $name" 'unexpected access'
        if ($name -ceq 'base.vhdx') {
            Refuse { Get-RunnerVerifiedImageLease $path ((Get-FileHash $path).Hash) 'generic' } 'generic base lease native read' 'unexpected access'
            Refuse { Get-RunnerVerifiedImageLease $path ((Get-FileHash $path).Hash) 'generic' -Prepared } 'generic base prepared flag' 'fixed identity namespace'
        }
    }
    $asDirectory = Join-Path $directory (('b' * 32) + '.vhdx'); [void][IO.Directory]::CreateDirectory($asDirectory)
    Refuse { Assert-RunnerPreparedImagePath $asDirectory } 'image is directory' 'must be a file'
    Remove-Item -LiteralPath $asDirectory
    $reparse = Join-Path $directory (('c' * 32) + '.vhdx')
    & cmd.exe /c mklink /J $reparse $base | Out-Null
    Check ($LASTEXITCODE -eq 0) 'Failed to create disposable junction.'
    try { Refuse { Assert-RunnerPreparedImagePath $reparse } 'image reparse point' 'reparse point' }
    finally { & cmd.exe /c rmdir $reparse | Out-Null }
    $hash = (Get-FileHash $disk).Hash
    $script:descriptors[$disk] = New-Descriptor
    $lease = Get-RunnerVerifiedImageLease $disk $hash 'prepared' -Prepared
    $child = Join-Path $base 'child.vhdx'
    [void](New-RunnerImageChild $child $lease) # Model attachment adding the exact native READ ACEs.
    $warm = Get-RunnerVerifiedImageLease $disk $hash 'prepared' -Prepared
    Check ([object]::ReferenceEquals($lease, $warm)) 'Native ACL change discarded a valid held lease.'
    [void](New-RunnerImageChild (Join-Path $base 'next-child.vhdx') $warm)
    Check ($script:children -eq 2 -and (Get-FileHash $disk).Hash -ceq $hash) 'Successive child changed prepared parent bytes.'
    Refuse { Get-RunnerVerifiedImageLease $disk $hash 'prepared' } 'prepared native descriptor strict lease' 'unexpected access'
    foreach ($rule in @((New-Rule $nativeSids[0] 2032127 $true), (New-Rule 'S-1-1-0'))) {
        $script:descriptors[$disk] = New-Descriptor $readers
        $lease = Get-RunnerVerifiedImageLease $disk $hash 'prepared' -Prepared
        $script:descriptors[$disk] = New-Descriptor @($rule)
        Refuse { Get-RunnerVerifiedImageLease $disk $hash 'prepared' -Prepared } 'warm unsafe descriptor' 'unexpected access'
        Refuse { New-RunnerImageChild (Join-Path $base 'unsafe-child.vhdx') $lease } 'unsafe next child' 'unexpected access'
        Refuse { Remove-RunnerOldImages ([pscustomobject]@{ id = ('a' * 32); previous = '' }) } 'unsafe retained image' 'unexpected access'
        Refuse { Remove-RunnerImageCandidate ([pscustomobject]@{ id = ('a' * 32) }) } 'unsafe candidate cleanup' 'unexpected access'
        Check (Test-Path -LiteralPath $disk) 'Unsafe image was deleted.'
    }
    $script:descriptors[$disk] = New-Descriptor $readers
    Remove-Item -LiteralPath $child, (Join-Path $base 'next-child.vhdx')
    Remove-RunnerOldImages ([pscustomobject]@{ id = ('a' * 32); previous = '' })
    Check (Test-Path -LiteralPath $disk) 'Retention deleted selected native-readable parent.'
    Remove-RunnerImageCandidate ([pscustomobject]@{ id = ('a' * 32) })
    Check (-not (Test-Path -LiteralPath $disk)) 'Native-readable unreferenced candidate cleanup failed.'
    [IO.File]::WriteAllText($disk, 'old sealed image'); $script:descriptors[$disk] = New-Descriptor $readers
    Remove-RunnerOldImages ([pscustomobject]@{ id = ''; previous = '' })
    Check (-not (Test-Path -LiteralPath $disk)) 'Native-readable old-image retention failed.'
    Write-Host "Prepared image ACL regressions passed ($script:checks checks): exact native readers, narrow namespace, strict generic paths, forbidden/inherited rights, real leases and successive children, cleanup/retention. No native ACL mutation or Hyper-V activation."
} finally {
    Close-RunnerImageLeases
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -ine ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -cnotmatch '^ITIR-prepared-acl-[0-9a-f]{32}$') { throw 'Unsafe ACL fixture cleanup.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
