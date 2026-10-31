# Actual validator/classifier definitions; ACL/provider data are in-memory fakes.
# No protected files, credentials, sockets, VM providers or installed code.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
class FixtureDerivedDenied : System.UnauthorizedAccessException {}
class FixtureAccessFailure : System.Collections.IEnumerable {
    [System.Collections.IEnumerator] GetEnumerator() { $script:events+='ace-enumeration';throw [InvalidOperationException]::new('PRIVATE_ENUMERATOR') }
}
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Common.ps1'),[ref]$null,[ref]$null)
foreach($node in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
    if($node.Name -cin @('Assert-RunnerProtectedPath','Get-RunnerProbeAclFailureExitCode')){. ([scriptblock]::Create($node.Extent.Text))}
}
$script:checks=0
trap {Write-Output ('PROTECTED_PATH_TEST_FAILURE checks='+$script:checks+' mode='+$script:mode+' lines='+(($_.ScriptStackTrace -split '\r?\n'|ForEach-Object{if($_ -match 'line (\d+)'){$Matches[1]}})-join ','));exit 1}
function Require-Path([bool]$Value){$script:checks++;if(-not $Value){throw 'PROTECTED_PATH_ASSERTION_FAILED'}}
function Get-PathFailure([scriptblock]$Work){try{& $Work}catch{return $_};throw 'EXPECTED_PATH_FAILURE'}
function Assert-OwnedPath([string]$Path){$script:events+='containment';if($script:mode -ceq 'containment'){throw $script:original};return $Path}
function Get-Acl([string]$LiteralPath){
    $script:events+='acl-read'
    if($null -ne $script:stageRef){Require-Path ($script:stageRef.Value -ceq 'acl-read')}
    if($script:mode -cin @('command','denied','security','read-other')){throw $script:original}
    $identity=[pscustomobject]@{}
    $identity|Add-Member ScriptMethod Translate {
        param($Type)
        $script:events+='sid-translation'
        if($null -ne $script:stageRef){Require-Path ($script:stageRef.Value -ceq 'sid-translation')}
        if($script:mode -ceq 'sid'){throw $script:original}
        return [pscustomobject]@{Value=$(if($script:mode -cin @('allow','deny')){'S-1-5-21-999'}else{'S-1-5-18'})}
    }
    $acl=[pscustomobject]@{}
    $acl|Add-Member ScriptMethod GetOwner {
        param($Type)
        $script:events+='owner-read'
        if($null -ne $script:stageRef){Require-Path ($script:stageRef.Value -ceq 'owner-read')}
        if($script:mode -ceq 'owner'){throw $script:original}
        return [pscustomobject]@{Value=$(if($script:mode -ceq 'owner-reject'){'S-1-5-21-999'}else{'S-1-5-32-544'})}
    }
    $script:identity=$identity
    if($script:mode -ceq 'enumeration'){$acl|Add-Member NoteProperty Access ([FixtureAccessFailure]::new())}
    else {$acl|Add-Member ScriptProperty Access {
        $script:events+='ace-enumeration'
        if($null -ne $script:stageRef){Require-Path ($script:stageRef.Value -ceq 'ace-enumeration')}
        return @([pscustomobject]@{IdentityReference=$script:identity;AccessControlType=$(if($script:mode -ceq 'deny'){'Deny'}else{'Allow'})})
    }}
    return $acl
}
$cases=@(
    @{mode='containment';stage='unknown';code=64},@{mode='command';stage='acl-read';code=67},
    @{mode='denied';stage='acl-read';code=68},@{mode='security';stage='acl-read';code=68},
    @{mode='read-other';stage='acl-read';code=69},@{mode='owner';stage='owner-read';code=70},
    @{mode='owner-reject';stage='owner-rejected';code=71},@{mode='enumeration';stage='ace-enumeration';code=72},
    @{mode='sid';stage='sid-translation';code=73},@{mode='allow';stage='allow-rejected';code=74}
)
foreach($case in $cases){
    $script:mode=$case.mode
    $script:original=switch($case.mode){'command'{[Management.Automation.CommandNotFoundException]::new('PRIVATE_COMMAND')};'denied'{[UnauthorizedAccessException]::new('PRIVATE_PATH')};'security'{[Security.SecurityException]::new('PRIVATE_PATH')};default{[InvalidOperationException]::new('PRIVATE_EXCEPTION')}}
    $script:events=@();$script:stageRef=$null
    $legacy=Get-PathFailure {Assert-RunnerProtectedPath 'synthetic-path'}
    $legacyEvents=$script:events -join ','
    $explicitNull=Get-PathFailure {Assert-RunnerProtectedPath 'synthetic-path' -FailureStage $null}
    Require-Path ($explicitNull.Exception.GetType().FullName -ceq $legacy.Exception.GetType().FullName -and $explicitNull.Exception.Message -ceq $legacy.Exception.Message)
    $stage='initial';$script:stageRef=[ref]$stage;$script:events=@()
    $observed=Get-PathFailure {Assert-RunnerProtectedPath 'synthetic-path' -FailureStage $script:stageRef}
    Require-Path ($stage -ceq $case.stage)
    Require-Path ((Get-RunnerProbeAclFailureExitCode $observed $stage) -eq $case.code)
    Require-Path (($script:events -join ',') -ceq $legacyEvents)
    Require-Path ($legacy.Exception.GetType().FullName -ceq $observed.Exception.GetType().FullName -and $legacy.Exception.Message -ceq $observed.Exception.Message -and $legacy.FullyQualifiedErrorId -ceq $observed.FullyQualifiedErrorId)
    if($case.mode -cin @('containment','command','denied','security','read-other')){Require-Path ([object]::ReferenceEquals($observed.Exception,$script:original))}
}
foreach($mode in @('pass','deny')){
    $script:mode=$mode;$script:events=@();$script:stageRef=$null
    Require-Path (@(Assert-RunnerProtectedPath 'synthetic-path').Count -eq 0)
    Require-Path (@(Assert-RunnerProtectedPath 'synthetic-path' -FailureStage $null).Count -eq 0)
    $stage='initial';$script:stageRef=[ref]$stage
    Require-Path (@(Assert-RunnerProtectedPath 'synthetic-path' -FailureStage $script:stageRef).Count -eq 0 -and $stage -ceq 'none')
}
foreach($bad in @('acl-read',@(),[pscustomobject]@{Value='unknown'},1,$false)){
    $script:events=@();$script:stageRef=$null
    [void](Get-PathFailure {Assert-RunnerProtectedPath 'synthetic-path' -FailureStage $bad})
    Require-Path ($script:events.Count -eq 0)
}
foreach($leaf in @([Management.Automation.CommandNotFoundException]::new('PRIVATE'),[UnauthorizedAccessException]::new('PRIVATE'),[Security.SecurityException]::new('PRIVATE'))){
    $expected=if($leaf -is [Management.Automation.CommandNotFoundException]){67}else{68}
    $wrapped=[Reflection.TargetInvocationException]::new([Management.Automation.RuntimeException]::new('PRIVATE_WRAPPER',$leaf))
    Require-Path ((Get-RunnerProbeAclFailureExitCode $wrapped 'acl-read') -eq $expected)
    $chain=$leaf
    for($i=0;$i -lt 7;$i++){$chain=[Reflection.TargetInvocationException]::new($chain)}
    Require-Path ((Get-RunnerProbeAclFailureExitCode $chain 'acl-read') -eq $expected)
    $chain=[Reflection.TargetInvocationException]::new($chain)
    Require-Path ((Get-RunnerProbeAclFailureExitCode $chain 'acl-read') -eq 69)
    Require-Path ((Get-RunnerProbeAclFailureExitCode $leaf 'unknown') -eq 64)
    Require-Path ((Get-RunnerProbeAclFailureExitCode $leaf 'owner-read') -eq 70)
}
Require-Path ((Get-RunnerProbeAclFailureExitCode ([IO.IOException]::new('PRIVATE',[UnauthorizedAccessException]::new('PRIVATE'))) 'acl-read') -eq 69)
Require-Path ((Get-RunnerProbeAclFailureExitCode ([Exception]::new('CommandNotFoundException access denied PRIVATE')) 'acl-read') -eq 69)
Require-Path ((Get-RunnerProbeAclFailureExitCode ([FixtureDerivedDenied]::new()) 'acl-read') -eq 69)
Require-Path ((Get-RunnerProbeAclFailureExitCode ([Runtime.InteropServices.COMException]::new('PRIVATE',-2147024891)) 'acl-read') -eq 69)
$getter=[pscustomobject]@{};$script:getterRead=$false;$getter|Add-Member ScriptProperty Exception {$script:getterRead=$true;throw 'PRIVATE_GETTER'}
Require-Path ((Get-RunnerProbeAclFailureExitCode $getter 'acl-read') -eq 69 -and -not $script:getterRead)
Write-Output ('PASS protected-path real validator/classifier: '+$script:checks+' assertions; legacy exceptions/checks, exact stages/types, bounded wrappers, unknown fallback and privacy; no host access.')
