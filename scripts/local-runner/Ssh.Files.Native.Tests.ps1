# Mandatory native link/identity proof. No ACL writes, credentials, keygen,
# SSH, VM or provider. Restricted execution hosts may refuse link creation;
# that is an unresolved capability, not a skipped/passing native case.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Initialize-RunnerSshFileSecurity
$base=Join-Path $env:TEMP ('ITIR-ssh-native-'+[guid]::NewGuid().ToString('N'))
$script:checks=0
function Check([bool]$Value){$script:checks++;if(-not $Value){throw 'SSH_NATIVE_ASSERTION'}}
function Refuse([scriptblock]$Work){$rejected=$false;try{& $Work|Out-Null}catch{$rejected=$true};Check $rejected}
[void][IO.Directory]::CreateDirectory($base)
$target=Join-Path $base 'target';[void][IO.Directory]::CreateDirectory($target)
$junction=Join-Path $base 'junction';$file=Join-Path $target 'sentinel';$link=Join-Path $target 'hardlink'
try{
    # Isolate the pre-key-generation interval: no file exists or is open yet.
    $parent=Open-RunnerSshFile $target -Directory
    try{
        $parent.AssertPath($target)
        Refuse {[IO.Directory]::Move($target,$target+'-prekey-moved')}
        Refuse {[IO.Directory]::Delete($target)}
        $child=Join-Path $target 'prekey-child';[IO.File]::WriteAllText($child,'nonsecret fixture');Check ([IO.File]::Exists($child));[IO.File]::Delete($child)
        $parent.AssertPath($target)
    }finally{$parent.Dispose()}
    [IO.Directory]::Move($target,$target+'-released');[IO.Directory]::Move($target+'-released',$target);Check ([IO.Directory]::Exists($target))
    [IO.File]::WriteAllText($file,'nonsecret fixture')
    $parent=Open-RunnerSshFile $target -Directory;$held=Open-RunnerSshFile $file
    try{
        $parent.AssertPath($target);$held.AssertPath($file);Check ($held.Length -gt 0)
        Refuse {[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)}
        Refuse {[IO.File]::Move($file,$file+'.moved')}
        Refuse {[IO.Directory]::Move($target,$target+'-moved')}
    }finally{$held.Dispose();$parent.Dispose()}
    [void](New-Item -ItemType HardLink -Path $link -Target $file -ErrorAction Stop)
    Refuse {Open-RunnerSshFile $file};Refuse {Open-RunnerSshFile $link}
    [IO.File]::Delete($link)
    [void](New-Item -ItemType Junction -Path $junction -Target $target -ErrorAction Stop)
    Refuse {Open-RunnerSshFile $junction -Directory}
    $script:RunnerRoot=$base
    Refuse {Assert-OwnedPath (Join-Path $junction 'sentinel')}
    Write-Output ('SSH_FILES_NATIVE_PASS '+$script:checks)
}finally{
    if(Test-Path -LiteralPath $junction){[IO.Directory]::Delete($junction)}
    if([IO.Path]::GetFullPath($base).StartsWith([IO.Path]::GetFullPath($env:TEMP)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $base -Leaf) -match '^ITIR-ssh-native-[a-f0-9]{32}$'){Remove-Item -LiteralPath $base -Recurse -Force}
}
