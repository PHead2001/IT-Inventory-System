# Real Windows file-sharing/identity and offline child/reference regressions.
# Hyper-V calls below are fixtures; no installed root, VM or credential is used.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($d in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $d.Extent.Text }
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-lease-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
$script:checks = 0
function Check([bool] $Value, [string] $Message) { if (-not $Value) { throw $Message }; $script:checks++ }
function Refuse([scriptblock] $Work, [string] $Case) { $failed = $false; try { & $Work | Out-Null } catch { $failed = $true }; Check $failed "Accepted $Case." }
$parent = Join-Path $base 'parent.vhdx'
[IO.File]::WriteAllBytes($parent, (New-Object byte[] (5MB)))
$hash = (Get-FileHash -LiteralPath $parent -Algorithm SHA256).Hash
Refuse { Get-RunnerVerifiedImageLease $parent $hash 'binding' } 'unprotected parent'
$script:blocked = ''
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path); if ($Path -ceq $script:blocked) { throw 'ACL changed.' } }
function Assert-RunnerPreparationAuthorized {}
function Get-RunnerState { return $null }
$script:hashes = 0
$script:actualHash = (Get-Command Get-RunnerImageStreamHash).ScriptBlock
function Get-RunnerImageStreamHash($Stream, $Phase = 'image-verification') { $script:hashes++; & $script:actualHash $Stream $Phase }
$script:disks = @{}
$script:newChildren = 0
function New-VHD($Path, $ParentPath, [switch] $Differencing) {
    Check $Differencing 'Child was not differencing.'
    Refuse { [IO.File]::WriteAllText($ParentPath, 'mutated') } 'parent write during Hyper-V child creation'
    [IO.File]::WriteAllText($Path, 'disposable child')
    $script:disks[$Path] = [pscustomobject]@{ VhdType = 'Differencing'; ParentPath = $ParentPath; Attached = $false }
    $script:newChildren++
}
function Get-VHD($Path) {
    if ($script:disks.ContainsKey($Path)) { return $script:disks[$Path] }
    return [pscustomobject]@{ VhdType = 'Dynamic'; ParentPath = ''; Attached = $false }
}
function Get-RunnerVmInventory { return @() }
try {
    Start-RunnerImagePreflight 'prepare'
    $lease = Get-RunnerVerifiedImageLease $parent $hash 'binding'
    $warm = Get-RunnerVerifiedImageLease $parent $hash 'binding'
    Check ([object]::ReferenceEquals($lease, $warm) -and $script:hashes -eq 1) 'Warm claim rehashed or changed its live verified handle.'
    Refuse { [IO.File]::WriteAllText($parent, 'mutated') } 'write under lease'
    Refuse { Remove-Item -LiteralPath $parent -Force -ErrorAction Stop } 'same-path replacement/delete under lease'
    $replacement = Join-Path $base 'replacement.vhdx'; [IO.File]::WriteAllText($replacement, 'replacement')
    Refuse { [IO.File]::Replace($replacement, $parent, $null) } 'atomic same-path replacement under lease'
    $script:blocked = $parent
    Refuse { Get-RunnerVerifiedImageLease $parent $hash 'binding' } 'ACL change on warm claim'
    $script:blocked = ''
    [void](Get-RunnerVerifiedImageLease $parent $hash 'changed-binding')
    Check (-not $lease.stream.CanRead -and $script:hashes -eq 2) 'Binding change retained old lease or skipped content verification.'
    $lease = Get-RunnerVerifiedImageLease $parent $hash 'changed-binding'
    $instance = Join-Path (Join-Path $base 'instances') ('ITIR-' + ('a' * 32)); [void][IO.Directory]::CreateDirectory($instance)
    $child = Join-Path $instance 'guest.vhdx'
    [void](New-RunnerImageChild $child $lease)
    Check ($script:newChildren -eq 1 -and (Get-FileHash $parent).Hash -ceq $hash) 'Child creation changed parent content.'
    Refuse { Assert-RunnerImageDiskUnreferenced $parent } 'retained unregistered child ancestor reference'
    $grandchild = Join-Path $base 'grandchild.vhdx'
    $script:disks[$grandchild] = [pscustomobject]@{ VhdType = 'Differencing'; ParentPath = $child; Attached = $false }
    function Get-RunnerVmInventory { return @([pscustomobject]@{ Path = (Join-Path $base 'foreign'); disks = @($grandchild) }) }
    function Get-VMHardDiskDrive($VM) { @($VM.disks | ForEach-Object { [pscustomobject]@{ Path = $_ } }) }
    Refuse { Assert-RunnerDiskReferencesAbsent $instance -Directory -ExcludedInstance $instance } 'indirect registered ancestor reference'
    $script:disks[$child].ParentPath = $grandchild
    Refuse { Get-RunnerDiskChain $grandchild } 'parent cycle'
    $script:disks[$child].ParentPath = $parent
    $script:disks[$grandchild].ParentPath = ''
    Refuse { Get-RunnerDiskChain $grandchild } 'unknown parent'
    $script:disks[$grandchild].ParentPath = $parent
    for ($i = 0; $i -lt 33; $i++) { $script:disks[(Join-Path $base "depth$i.vhdx")] = [pscustomobject]@{ VhdType = 'Differencing'; ParentPath = (Join-Path $base "depth$($i+1).vhdx") } }
    Refuse { Get-RunnerDiskChain (Join-Path $base 'depth0.vhdx') } 'ancestry depth overflow'
    function Get-RunnerVmInventory { return @() }
    $unknown = Join-Path (Join-Path $base 'instances') 'unknown'; [void][IO.Directory]::CreateDirectory($unknown)
    Refuse { Get-RunnerManagedDiskRoots } 'unknown managed instance'
    Remove-Item -LiteralPath $unknown
    $quotaPaths = @()
    for ($i = 0; $i -lt 128; $i++) {
        $p = Join-Path (Join-Path $base 'instances') ('ITIR-' + [guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($p); $quotaPaths += $p
    }
    Refuse { Get-RunnerManagedDiskRoots } 'managed instance quota overflow'
    foreach ($p in $quotaPaths) { Remove-Item -LiteralPath $p }
    function Get-RunnerState { return [pscustomobject]@{ vmName = 'retained-child' } }
    Close-RunnerImageLeases
    Check $lease.stream.CanRead 'Failed child cleanup deliberately released its parent lease.'
    Refuse { [IO.File]::WriteAllText($parent, 'mutated') } 'parent write after failed cleanup'
    function Get-RunnerState { return $null }
    $script:RunnerImagePreflight.deadlineUtc = [DateTime]::UtcNow.AddSeconds(-1)
    Refuse { Get-RunnerVerifiedImageLease $parent $hash 'changed-binding' } 'warm deadline'
    Start-RunnerImagePreflight 'job'
    [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop')
    Refuse { Get-RunnerVerifiedImageLease $parent $hash 'changed-binding' } 'warm Stop'
    Remove-Item -LiteralPath (Join-Path $base 'stop.requested')
    $script:RunnerImagePreflight = $null
    Close-RunnerImageLeases
    [IO.File]::WriteAllText($parent, 'different same-path file after restart')
    Refuse { Get-RunnerVerifiedImageLease $parent $hash 'changed-binding' } 'restart corruption'
    [IO.File]::WriteAllBytes($parent, (New-Object byte[] (5MB)))
    $new = Get-RunnerVerifiedImageLease $parent $hash 'changed-binding'
    Check ($script:hashes -eq 4 -and -not [object]::ReferenceEquals($new, $lease)) 'Restart reused a persisted verification flag.'
    Close-RunnerImageLeases
    Start-RunnerImagePreflight 'job'
    $script:preflightChecks = 0
    $script:actualPreflight = (Get-Command Assert-RunnerImagePreflight).ScriptBlock
    function Assert-RunnerImagePreflight {
        $script:preflightChecks++
        if ($script:preflightChecks -eq 3) { [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop') }
        & $script:actualPreflight
    }
    Refuse { Get-RunnerVerifiedImageLease $parent $hash 'chunk-stop' } 'Stop during chunk hashing'
    Check ($script:RunnerImageLeases.Count -eq 0 -and $script:preflightChecks -eq 3) 'Interrupted chunk hash published a verified lease.'
    Remove-Item -LiteralPath (Join-Path $base 'stop.requested')
    $script:RunnerImagePreflight = $null
    Write-Host "Image lease regressions passed ($script:checks checks): real restrictive handles, binding/restart/tamper/Stop/deadline, child parent identity and indirect/cyclic/unknown references. Real Hyper-V compatibility remains untested."
} finally {
    Close-RunnerImageLeases
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -ine ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -cnotmatch '^ITIR-lease-[0-9a-f]{32}$') { throw 'Unsafe lease fixture cleanup.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
