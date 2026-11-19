# Test providers only. Never bundled or loaded by the installed runtime.
param([Parameter(Mandatory)][string] $FixtureRoot)
$script:RunnerRoot=[IO.Path]::GetFullPath($FixtureRoot)
$script:RunnerConfigPath=Join-Path $script:RunnerRoot 'config.json'
$script:RunnerStatePath=Join-Path $script:RunnerRoot 'state.json'
$script:fixtureTaskState='Ready';$script:fixtureStarts=0;$script:fixtureInventoryUnavailable=$false
$script:fixtureVms=@();$script:fixtureStartFailure=$false;$script:fixtureAfterStart=$null
$script:fixtureTaskReadHook=$null
$script:fixtureInvalidTaskIdentity=$false
function Assert-Administrator {} # OS authorization provider; production remains unchanged.
function Get-Acl {
    $sid=[pscustomobject]@{};$sid|Add-Member ScriptMethod Translate {param($Type);[pscustomobject]@{Value='S-1-5-18'}}
    $acl=[pscustomobject]@{AreAccessRulesProtected=$true;Access=@([pscustomobject]@{IdentityReference=$sid;AccessControlType='Allow';FileSystemRights=[Security.AccessControl.FileSystemRights]::FullControl;IsInherited=$false;InheritanceFlags=[Security.AccessControl.InheritanceFlags]::None;PropagationFlags=[Security.AccessControl.PropagationFlags]::None})}
    $acl|Add-Member ScriptMethod GetOwner {param($Type);[pscustomobject]@{Value='S-1-5-18'}}
    return $acl
}
function Get-ScheduledTask([string]$TaskName) {
    if($TaskName -ceq $script:RunnerSupervisorTask -and $script:fixtureTaskState -ceq 'Running' -and $null -ne $script:fixtureTaskReadHook){& $script:fixtureTaskReadHook}
    $action=if($TaskName -ceq $script:RunnerSupervisorTask){'Supervise'}elseif($TaskName -ceq $script:RunnerTask){'Watchdog'}else{throw 'FIXTURE_TASK_NAME'}
    $runner=Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1'
    $user=if($script:fixtureInvalidTaskIdentity){'UNRELATED_ACCOUNT'}else{'SYSTEM'}
    [pscustomobject]@{TaskName=$TaskName;TaskPath='\';State=$script:fixtureTaskState;Principal=[pscustomobject]@{UserId=$user;LogonType='ServiceAccount';RunLevel='Highest'};Actions=@([pscustomobject]@{Execute='powershell.exe';Arguments="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -Action $action";WorkingDirectory=''})}
}
function Start-ScheduledTask([string]$TaskName) {
    if($TaskName -cne $script:RunnerSupervisorTask){throw 'FIXTURE_TASK_NAME'}
    $script:fixtureStarts++
    if($script:fixtureStartFailure){throw 'SECRET_PROVIDER_ERROR'}
    $script:fixtureTaskState='Running'
    if($null -ne $script:fixtureAfterStart){& $script:fixtureAfterStart}
}
function Get-RunnerVmInventory {if($script:fixtureInventoryUnavailable){throw 'SECRET_INVENTORY_ERROR'};return $script:fixtureVms}
function Get-VHD { [pscustomobject]@{Attached=$false;VhdType='Dynamic';ParentPath=''} }
function Get-VMHardDiskDrive { @() }
function Get-RunnerMemoryAdmission { [pscustomobject]@{ready=$true} }
function Get-RunnerNetworkObservation { [pscustomobject]@{fingerprint=('a'*64);rules=@();observedUtc=[DateTime]::UtcNow.ToString('o')} }
function Get-OwnerToken {throw 'SECRET_TOKEN_PROVIDER_MUST_NOT_RUN'}
