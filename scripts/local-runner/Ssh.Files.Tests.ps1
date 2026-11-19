# New SSH files only: in-memory ACLs, native read/identity/share guards and
# disposable sentinel files. No key generation, ACL writes, SSH or host provider.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$script:checks=0
function Check([bool]$Value){$script:checks++;if(-not $Value){throw "SSH_FILE_CHECK_$script:checks"}}
function Refuse([scriptblock]$Work){$rejected=$false;try{& $Work|Out-Null}catch{$rejected=$true};Check $rejected}
$base=Join-Path $env:TEMP ('ITIR-ssh-files-'+[guid]::NewGuid().ToString('N'))
# Resolve only after creating this one owned root, before deriving any instance
# or key path. TEMP's long/8.3 provider aliases must not create a false escape.
if(Test-Path -LiteralPath $base){throw 'SSH fixture root already exists; retain files.'}
[void][IO.Directory]::CreateDirectory($base)
$base=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $base).ProviderPath)
$sshCanonicalRoot=[IO.Path]::GetFullPath($base)
$sshCanonicalTemp=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).ProviderPath).TrimEnd('\')
$sshFixtureFailure=$null;$sshCleanupFailure=$null
function Assert-SshFixtureCleanupIdentity([string]$Candidate,[string]$Resolved,[IO.FileAttributes]$Attributes){
    if([IO.Path]::GetFullPath($Candidate) -cne $sshCanonicalRoot -or [IO.Path]::GetFullPath($Resolved) -cne $sshCanonicalRoot -or
        [IO.Path]::GetDirectoryName($sshCanonicalRoot) -cne $sshCanonicalTemp -or
        [IO.Path]::GetFileName($sshCanonicalRoot) -cnotmatch '^ITIR-ssh-files-[a-f0-9]{32}$' -or
        ($Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'SSH fixture cleanup identity differs; retain files.'}
}
$script:RunnerRoot=$base
$instance=Join-Path (Join-Path $base 'instances') ('ITIR-'+('a'*32))
[void][IO.Directory]::CreateDirectory($instance)
$script:creator=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function New-FixtureAcl([string]$Owner=$script:creator,[string]$Extra='', [switch]$ReadOnly) {
    $acl=[Security.AccessControl.FileSecurity]::new();$acl.SetOwner([Security.Principal.SecurityIdentifier]::new($Owner))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($script:creator),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
    if($Extra){$rights=if($ReadOnly){[Security.AccessControl.FileSystemRights]::Read}else{[Security.AccessControl.FileSystemRights]::FullControl};$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($Extra),$rights,[Security.AccessControl.AccessControlType]::Allow))}
    return $acl
}
try{
    Check ([IO.Path]::GetFullPath((Resolve-Path -LiteralPath $base).ProviderPath) -ceq $base)
    Assert-SshFixtureCleanupIdentity $base $base ([IO.FileAttributes]::Directory);Check $true
    $foreignBase=Join-Path $sshCanonicalTemp ('ITIR-ssh-files-'+('b'*32))
    Refuse {Assert-SshFixtureCleanupIdentity $foreignBase $foreignBase ([IO.FileAttributes]::Directory)}
    Refuse {Assert-SshFixtureCleanupIdentity $base $foreignBase ([IO.FileAttributes]::Directory)}
    Refuse {Assert-SshFixtureCleanupIdentity $base $base ([IO.FileAttributes]::ReparsePoint)}
    Initialize-RunnerSshFileSecurity
    $directory=Open-RunnerSshFile $instance -Directory
    try{
        $directory.AssertPath($instance)
        Refuse {[IO.Directory]::Move($instance,$instance+'-prekey-moved')}
        Refuse {[IO.Directory]::Delete($instance)}
        $child=Join-Path $instance 'prekey-child';[IO.File]::WriteAllText($child,'nonsecret fixture');Check ([IO.File]::Exists($child));[IO.File]::Delete($child)
        $directory.AssertPath($instance)
    }finally{$directory.Dispose()}
    [IO.Directory]::Move($instance,$instance+'-released');[IO.Directory]::Move($instance+'-released',$instance);Check ([IO.Directory]::Exists($instance))
    $native=Join-Path $instance 'native-sentinel';[IO.File]::WriteAllText($native,'nonsecret fixture')
    $directory=Open-RunnerSshFile $instance -Directory
    $file=Open-RunnerSshFile $native
    try{
        $directory.AssertPath($instance);$file.AssertPath($native)
        Check ($file.Identity -cmatch '^[A-F0-9]{8}:[A-F0-9]{16}$' -and $file.Length -gt 0)
        Check ($null -ne $file.ReadSecurity())
        Refuse {[IO.File]::Open($native,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)}
        Refuse {[IO.File]::Move($native,$native+'.moved')}
        Refuse {[IO.Directory]::Move($instance,$instance+'-moved')}
    }finally{$file.Dispose();$directory.Dispose()}
    [IO.File]::Delete($native)

    $exact=New-RunnerSshFileAcl;Assert-RunnerExactSshAcl $exact;Check $true
    $private=New-FixtureAcl;Assert-RunnerGeneratedSshAcl $private $script:creator;Check $true
    $readonly=New-FixtureAcl -Extra 'S-1-1-0' -ReadOnly
    Assert-RunnerGeneratedSshAcl $readonly $script:creator -Public;Check $true
    Refuse {Assert-RunnerGeneratedSshAcl $readonly $script:creator}
    Refuse {Assert-RunnerGeneratedSshAcl (New-FixtureAcl -Extra 'S-1-1-0') $script:creator -Public}
    Refuse {Assert-RunnerGeneratedSshAcl (New-FixtureAcl -Owner 'S-1-1-0') $script:creator}
    foreach($rights in @('WriteData','AppendData','WriteExtendedAttributes','WriteAttributes','DeleteSubdirectoriesAndFiles','Delete','ChangePermissions','TakeOwnership')){
        $acl=New-FixtureAcl;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::$rights,[Security.AccessControl.AccessControlType]::Allow))
        Refuse {Assert-RunnerGeneratedSshAcl $acl $script:creator -Public}
    }
    Refuse {Assert-RunnerExactSshAcl $private}
    $bad=New-RunnerSshFileAcl;$bad.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow));Refuse {Assert-RunnerExactSshAcl $bad}
    $bad=New-RunnerSshFileAcl;$bad.SetAccessRuleProtection($false,$true);Refuse {Assert-RunnerExactSshAcl $bad}
    $bad=New-RunnerSshFileAcl;$bad.SetOwner([Security.Principal.SecurityIdentifier]::new($script:creator));if($script:creator -cne 'S-1-5-32-544'){Refuse {Assert-RunnerExactSshAcl $bad}}

    # Runtime orchestration over fake held handles; only nonsensitive fixture
    # files are created/deleted. Real ACL predicates above remain authoritative.
    function Assert-SecureRoot {}
    $script:strictCalls=0
    function Assert-RunnerProtectedPath {param($Path,$FailureStage=$null);$script:strictCalls++}
    $script:files=@{};$script:case='';$script:nativeCalls=0;$script:normalized=0;$script:disposed=0;$script:opened=0;$script:deleted=0
    function New-FixtureLease([string]$Path,[switch]$Directory,$Acl=$null) {
        $value=[pscustomobject]@{Path=$Path;Directory=$Directory.IsPresent;Identity=('12345678:'+$(if($Directory){'0000000000000000'}elseif($Path.EndsWith('.pub')){'0000000000000002'}else{'0000000000000001'}));Security=$Acl;Length=0}
        $value|Add-Member ScriptMethod AssertPath {param($Path);if($Path -cne $this.Path -or ($script:case -ceq 'replacement' -and -not $this.Directory)){throw 'FIXTURE_IDENTITY'}}
        $value|Add-Member ScriptMethod ReadSecurity {return $this.Security}
        $value|Add-Member ScriptMethod ReplaceSecurity {param($Acl);$script:normalized++;if($script:case -cne 'readback'){$this.Security=$Acl}}
        $value|Add-Member ScriptMethod DeleteExact {param($Path);$this.AssertPath($Path);[IO.File]::Delete($Path);$script:deleted++}
        $value|Add-Member ScriptMethod Dispose {$script:disposed++}
        return $value
    }
    function Open-RunnerSshFile([string]$Path,[switch]$Directory,[switch]$Normalize) {
        if($Directory){$script:opened++;return New-FixtureLease $Path -Directory}
        if($script:case -cin @('reparse','hardlink')){throw 'FIXTURE_FILE_TYPE'}
        $script:opened++
        return $script:files[$Path]
    }
    function Invoke-RunnerNative($Executable,$Arguments,$TimeoutSeconds) {
        $script:nativeCalls++
        Check ($Executable -ceq 'fixture' -and $TimeoutSeconds -eq 15 -and $Arguments.Count -eq 7)
        $expected=@('-q','-t','ed25519','-N','','-f',$script:expectedKeyPath)
        for($i=0;$i -lt 7;$i++){Check ($Arguments[$i] -ceq $expected[$i])}
        $path=$Arguments[6]
        Check (-not (Test-Path -LiteralPath $path) -and -not (Test-Path -LiteralPath ($path+'.pub')))
        foreach($target in @($path,($path+'.pub'))){
            if($script:case -ceq 'missing' -and $target.EndsWith('.pub')){continue}
            if($script:case -ceq 'public-only' -and -not $target.EndsWith('.pub')){continue}
            if($script:case -ceq 'no-output'){continue}
            [IO.File]::WriteAllText($target,'nonsecret fixture')
            $acl=if($script:case -ceq 'owner'){New-FixtureAcl -Owner 'S-1-1-0'}elseif($script:case -ceq 'writer'){New-FixtureAcl -Extra 'S-1-1-0'}elseif($script:case -ceq 'private-reader' -or ($script:case -ceq 'public-reader' -and $target.EndsWith('.pub'))){New-FixtureAcl -Extra 'S-1-1-0' -ReadOnly}else{New-FixtureAcl}
            $script:files[$target]=New-FixtureLease $target -Acl $acl
            if($script:case -ceq 'same-identity'){$script:files[$target].Identity='12345678:0000000000000001'}
        }
        if($script:case -ceq 'native-throw'){throw 'FIXTURE_NATIVE'}
        if($script:case -ceq 'native-malformed'){return '0'}
        if($script:case -ceq 'native-failed'){return 9};return 0
    }
    $path=Join-Path $instance 'id_ed25519'
    $script:expectedKeyPath=$path
    foreach($case in @('existing-private','existing-public','wrong-parent','missing','public-only','no-output','same-identity','native-failed','native-throw','native-malformed','owner','writer','private-reader','reparse','hardlink','replacement','readback','public-reader','success')){
        $script:case=$case;$script:nativeCalls=0;$script:normalized=0;$script:files=@{};$script:deleted=0;$script:disposed=0;$script:opened=0
        foreach($target in @($path,($path+'.pub'))){if(Test-Path -LiteralPath $target){[IO.File]::Delete($target)}}
        if($case -ceq 'existing-private'){[IO.File]::WriteAllText($path,'existing')}
        if($case -ceq 'existing-public'){[IO.File]::WriteAllText(($path+'.pub'),'existing')}
        $target=if($case -ceq 'wrong-parent'){Join-Path $base 'id_ed25519'}else{$path}
        $consumed=$false
        if($case -cin @('success','public-reader')){New-RunnerSshKey $target 'fixture';$consumed=$true}else{Refuse {New-RunnerSshKey $target 'fixture';$consumed=$true}}
        Check ($consumed -eq ($case -cin @('success','public-reader')))
        Check ($script:nativeCalls -eq $(if($case -cin @('existing-private','existing-public','wrong-parent')){0}else{1}))
        Check ($script:disposed -eq $script:opened)
        if($case -cin @('success','public-reader')){Check ($script:normalized -eq 2 -and $script:deleted -eq 0)}
        if($case -cin @('missing','public-only','no-output','same-identity','native-failed','native-throw','native-malformed','readback')){Check (-not (Test-Path -LiteralPath $path) -and -not (Test-Path -LiteralPath ($path+'.pub')))}
        if($case -cin @('owner','writer','private-reader','reparse','hardlink','replacement')){Check ($script:normalized -eq 0 -and $script:deleted -eq 0)}
    }
    foreach($mutation in @('executable','type','switch','path')){
        $arguments=@('-q','-t','ed25519','-N','','-f',$path);$executable='fixture'
        switch($mutation){executable{$executable='unexpected'};type{$arguments[2]='rsa'};switch{$arguments[5]='--file'};path{$arguments[6]=$path+'.pub'}}
        Refuse {Invoke-RunnerNative $executable $arguments 15}
    }
    $hosts=Join-Path $instance 'known_hosts';$script:case='success'
    function New-RunnerSshControlFile($Path,$Acl){
        if($script:case -ceq 'known-create-failed'){throw 'FIXTURE_CREATE'}
        [IO.File]::WriteAllText($Path,'')
        if($script:case -ceq 'known-readback'){$Acl=New-FixtureAcl}
        $script:files[$Path]=New-FixtureLease $Path -Acl $Acl;$script:opened++;return $script:files[$Path]
    }
    foreach($case in @('known-create-failed','known-readback')){
        $script:case=$case;$script:disposed=0;$script:opened=0;$script:knownConsumed=0
        Refuse {New-RunnerKnownHosts $hosts;$script:knownConsumed++}
        Check (-not (Test-Path -LiteralPath $hosts) -and $script:disposed -eq $script:opened -and $script:knownConsumed -eq 0)
    }
    $script:case='success'
    $evidence=New-RunnerKnownHosts $hosts;Check ($evidence.identity -ceq $script:files[$hosts].Identity)
    Refuse {New-RunnerKnownHosts $hosts}
    Refuse {Assert-RunnerKnownHosts $hosts $evidence -RequireContent}
    $script:files[$hosts].Length=1;Assert-RunnerKnownHosts $hosts $evidence -RequireContent;Check $true
    Refuse {Assert-RunnerKnownHosts $hosts ([pscustomobject]@{identity='12345678:0000000000000003'}) -RequireContent}
    $script:files[$hosts].Security=New-FixtureAcl;Refuse {Assert-RunnerKnownHosts $hosts $evidence -RequireContent}
    $runner=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'),[ref]$null,[ref]$null)
    $session=$runner.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-RunnerSession'},$false).Extent.Text
    Check ($session.IndexOf('New-RunnerKnownHosts') -gt $session.IndexOf('New-RunnerSshKey') -and $session.IndexOf('New-RunnerKnownHosts') -lt $session.IndexOf('Start-SessionGuardian') -and $session.IndexOf('Assert-RunnerKnownHosts') -gt $session.IndexOf('Wait-Guest'))
    $sshArgs=$runner.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-SshArgs'},$false).Extent.Text
    Check ($sshArgs.Contains('Assert-RunnerSessionTrustedPaths $State -RequireKnownHosts'))
    Check ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Network.Recovery.Probe.ps1')).Contains('}) -RequireKnownHosts'))
    Write-Output ('SSH_FILES_PASS '+$script:checks+' NATIVE_IDENTITY_SHARE=PASS HARDLINK_REPARSE=SEPARATE_NATIVE_SUITE NORMALIZATION_NATIVE=OWNER_INTEGRATION_REQUIRED')
}catch{$sshFixtureFailure=$_}
finally{
    try{
        $sshCurrent=(Microsoft.PowerShell.Management\Resolve-Path -LiteralPath $base -ErrorAction Stop).ProviderPath
        $sshAttributes=(Microsoft.PowerShell.Management\Get-Item -LiteralPath $base -Force -ErrorAction Stop).Attributes
        Assert-SshFixtureCleanupIdentity $base $sshCurrent $sshAttributes
        Remove-Item -LiteralPath $sshCanonicalRoot -Recurse -Force -ErrorAction Stop
    }catch{$sshCleanupFailure=$_}
}
if($null -ne $sshFixtureFailure){
    if($null -ne $sshCleanupFailure){$sshFixtureFailure.Exception.Data['fixtureCleanupRefused']=$true;Write-Warning 'SSH fixture cleanup refused; initiating failure preserved and fixture retained.'}
    throw $sshFixtureFailure
}
if($null -ne $sshCleanupFailure){throw $sshCleanupFailure}
