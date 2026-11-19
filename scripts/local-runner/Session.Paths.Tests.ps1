# Canonical v2 storage and legacy observation/cleanup only. No host providers.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
# Resolve the existing TEMP provider location once, then create and resolve the
# root before constructing state. Windows may expose long/8.3 aliases differently
# before and after creation; the fixture must not manufacture identity drift.
$fixtureTemporary = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).ProviderPath).TrimEnd('\')
$root = Join-Path $fixtureTemporary ('ITIR-paths-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $root) { throw 'Fixture root already exists; retain files.' }
[void][IO.Directory]::CreateDirectory($root)
$root = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $root).ProviderPath)
$fixtureCanonicalRoot = [IO.Path]::GetFullPath($root)
$fixtureCanonicalTemporary = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).ProviderPath).TrimEnd('\')
$fixtureFailure = $null; $fixtureCleanupFailure = $null
$script:RunnerRoot = $root; $script:checks = 0
function Check([bool] $Value) { $script:checks++; if (-not $Value) { throw 'Session layout assertion failed.' } }
function Refuse([scriptblock] $Work) { $refused=$false; try { & $Work | Out-Null } catch { $refused=$true }; Check $refused }
function Copy-State($State) { $State | ConvertTo-Json -Depth 10 -Compress | ConvertFrom-Json }
function Assert-FixtureCleanupIdentity([string] $Candidate, [string] $Resolved, [IO.FileAttributes] $Attributes) {
    if ([IO.Path]::GetFullPath($Candidate) -cne $fixtureCanonicalRoot -or [IO.Path]::GetFullPath($Resolved) -cne $fixtureCanonicalRoot -or
        [IO.Path]::GetDirectoryName($fixtureCanonicalRoot) -cne $fixtureCanonicalTemporary -or
        [IO.Path]::GetFileName($fixtureCanonicalRoot) -cnotmatch '^ITIR-paths-[0-9a-f]{32}$' -or
        ($Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Fixture cleanup identity differs; retain files.' }
}
$name='ITIR-'+('a'*32)
$state=[pscustomobject]@{tag=$script:RunnerTag;vmName=$name;instancePath=(Join-Path (Join-Path $root 'instances') $name);layoutVersion=2}
try {
    Check ([IO.Path]::GetDirectoryName($root) -ieq $fixtureTemporary)
    Check ([IO.Path]::GetFullPath((Resolve-Path -LiteralPath $root).ProviderPath) -ceq $root)
    Assert-FixtureCleanupIdentity $root $root ([IO.FileAttributes]::Directory); Check $true
    $foreignFixture = Join-Path $fixtureCanonicalTemporary ('ITIR-paths-' + ('b' * 32))
    Refuse { Assert-FixtureCleanupIdentity $foreignFixture $foreignFixture ([IO.FileAttributes]::Directory) }
    Refuse { Assert-FixtureCleanupIdentity $root $foreignFixture ([IO.FileAttributes]::Directory) }
    Refuse { Assert-FixtureCleanupIdentity (Join-Path $fixtureCanonicalTemporary 'foreign\ITIR-paths-other') $root ([IO.FileAttributes]::Directory) }
    Refuse { Assert-FixtureCleanupIdentity $root $root ([IO.FileAttributes]::ReparsePoint) }
    [void][IO.Directory]::CreateDirectory($state.instancePath)
    foreach($purpose in @('job','prepare','verify-image')) {
        $fresh=Copy-State $state; $fresh|Add-Member purpose $purpose
        if($purpose -ceq 'verify-image'){$fresh|Add-Member imageCandidate ([pscustomobject]@{id=('a'*32);diskHash=('A'*64);bindingHash=('B'*64);recipeId=('C'*64)})}
        Assert-StateIdentity $fresh; $paths=Get-RunnerSessionPaths $fresh
        Check ($paths.layoutVersion -eq 2 -and -not $paths.legacy -and $paths.vmData -ceq (Join-Path $state.instancePath 'vm-data'))
        Check ($paths.guestDisk -ceq (Join-Path $paths.vmData 'guest.vhdx') -and $paths.seedDisk -ceq (Join-Path $paths.vmData 'cidata.vhdx') -and $paths.vmPath -ceq (Join-Path $paths.vmData $name))
        Check ($paths.privateKey -ceq (Join-Path $state.instancePath 'id_ed25519') -and $paths.publicKey -ceq (Join-Path $state.instancePath 'id_ed25519.pub') -and $paths.knownHosts -ceq (Join-Path $state.instancePath 'known_hosts') -and $paths.probeRoot -ceq $state.instancePath)
    }
    $ordered=[ordered]@{tag=$script:RunnerTag;vmName=$name;instancePath=$state.instancePath;layoutVersion=2}
    Assert-StateIdentity $ordered; Check ((Get-RunnerSessionPaths $ordered).layoutVersion -eq 2)
    foreach($version in @($null,'2',1,3,[long]2,2.0,$true,@(2))) {
        $bad=Copy-State $state; $bad.layoutVersion=$version
        Refuse {Get-RunnerSessionPaths $bad}; Refuse {Get-RunnerSessionPaths $bad -AllowLegacy}
    }
    foreach($property in @('instancePath','expectedVmPath','expectedBootDisk')) {
        $bad=Copy-State $state
        if($property -ceq 'instancePath'){$bad.instancePath=Join-Path $root $name}else{$bad|Add-Member $property (Join-Path $root 'alternate')}
        Refuse {Assert-StateIdentity $bad}; Refuse {Assert-StateIdentity $bad -AllowLegacy}
    }
    $bad=Copy-State $state; $bad.instancePath=$state.instancePath+'\..\'+$name; Refuse {Get-RunnerSessionPaths $bad}
    $legacy=Copy-State $state; $legacy.PSObject.Properties.Remove('layoutVersion')
    Refuse {Assert-StateIdentity $legacy}; Refuse {Get-RunnerSessionPaths $legacy}; Refuse {Assert-RunnerSessionTrustedPaths $legacy}
    Assert-StateIdentity $legacy -AllowLegacy; $old=Get-RunnerSessionPaths $legacy -AllowLegacy
    Check ($old.legacy -and $old.guestDisk -ceq (Join-Path $state.instancePath 'guest.vhdx') -and $old.vmPath -ceq (Join-Path $state.instancePath $name))
    # Use the real strict ACL validator over descriptors, including native VM
    # grants solely on vm-data. There is no Set-Acl or live descriptor read.
    $script:badRoot=$false; $script:badKey=$false
    function Get-Acl([string]$LiteralPath) {
        $sid=if([IO.Path]::GetFileName($LiteralPath) -ceq 'vm-data' -or ($script:badRoot -and $LiteralPath -ceq $state.instancePath) -or ($script:badKey -and $LiteralPath -ceq $paths.privateKey)){'S-1-5-83-0'}else{'S-1-5-18'}
        $identity=[pscustomobject]@{sid=$sid};$identity|Add-Member ScriptMethod Translate {param($Type);return [pscustomobject]@{Value=$this.sid}}
        $acl=[pscustomobject]@{Access=@([pscustomobject]@{IdentityReference=$identity;AccessControlType='Allow'})}
        $acl|Add-Member ScriptMethod GetOwner {param($Type);return [pscustomobject]@{Value='S-1-5-18'}};return $acl
    }
    $paths=Get-RunnerSessionPaths $state;[void][IO.Directory]::CreateDirectory($paths.vmData);[IO.File]::WriteAllText($paths.privateKey,'PUBLIC FIXTURE')
    Assert-RunnerSessionTrustedPaths $state; Check $true
    Refuse {Assert-RunnerSessionTrustedPaths $state -RequireKnownHosts}
    [IO.File]::WriteAllText($paths.knownHosts,'PUBLIC FIXTURE')
    Assert-RunnerSessionTrustedPaths $state -RequireKnownHosts; Check $true
    Refuse {Assert-RunnerProtectedPath $paths.vmData}
    $script:badRoot=$true; Refuse {Assert-RunnerSessionTrustedPaths $state};$script:badRoot=$false
    $script:badKey=$true; Refuse {Assert-RunnerSessionTrustedPaths $state};$script:badKey=$false
    # Provider descriptor fixture: the restricted test host refuses creating
    # junctions. Exercise the real no-reparse walk without changing permissions.
    $script:reparseTarget=$paths.vmData
    function Test-Path { param([string]$LiteralPath); if($LiteralPath -ceq $script:reparseTarget){return $true}; return Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath }
    function Get-Item {
        param([string]$LiteralPath,[switch]$Force)
        if($LiteralPath -ceq $script:reparseTarget){return [pscustomobject]@{Attributes=[IO.FileAttributes]::ReparsePoint}}
        return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force
    }
    try {
        foreach($field in @('instance','vmData','vmPath','guestDisk','seedDisk','privateKey','publicKey','knownHosts','stopRequest')){
            $script:reparseTarget=$paths.$field;Refuse {Get-RunnerSessionPaths $state};Refuse {Get-RunnerSessionPaths $state -AllowLegacy}
        }
    } finally {Remove-Item Function:\Get-Item;Remove-Item Function:\Test-Path}
    # Recovery bindings must include the layout version; legacy is refused.
    $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Network.Recovery.ps1'),[ref]$null,[ref]$null)
    foreach($node in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -cin @('Get-RunnerRecoveryHash','Get-RunnerRecoveryClaimHash')},$false)){Invoke-Expression $node.Extent.Text}
    Refuse {Get-RunnerRecoveryClaimHash $legacy}
    Check ((Get-RunnerRecoveryClaimHash $state) -cmatch '^[A-Fa-f0-9]{64}$')
    Write-Host ('Session paths passed: '+$script:checks+' canonical layout, strict root/key ACL, reparse descriptor, malformed-version and legacy-denial assertions.')
} catch { $fixtureFailure = $_ }
finally {
    try {
        $fixtureCurrent = (Microsoft.PowerShell.Management\Resolve-Path -LiteralPath $root -ErrorAction Stop).ProviderPath
        $fixtureAttributes = (Microsoft.PowerShell.Management\Get-Item -LiteralPath $root -Force -ErrorAction Stop).Attributes
        Assert-FixtureCleanupIdentity $root $fixtureCurrent $fixtureAttributes
        Remove-Item -LiteralPath $fixtureCanonicalRoot -Recurse -Force -ErrorAction Stop
    } catch { $fixtureCleanupFailure = $_ }
}
if ($null -ne $fixtureFailure) {
    if ($null -ne $fixtureCleanupFailure) {
        $fixtureFailure.Exception.Data['fixtureCleanupRefused'] = $true
        Write-Warning 'Fixture cleanup refused; initiating failure preserved and fixture retained.'
    }
    throw $fixtureFailure
}
if ($null -ne $fixtureCleanupFailure) { throw $fixtureCleanupFailure }
