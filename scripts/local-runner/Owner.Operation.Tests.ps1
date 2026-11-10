# Real WinPS filesystem/atomic pause writer; only OS/task/VM/session providers are fixtures.
param([ValidateSet('all','pause','receipt','resume','status','entry')][string]$Cohort='all',[string]$CasePattern='*')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){throw 'OWNER_FIXTURE_REQUIRES_WINDOWS_POWERSHELL_5'}
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Guest.Network.ps1')
. (Join-Path $PSScriptRoot 'Update.ps1')
. (Join-Path $PSScriptRoot 'PreparedImage.ps1')
$sourceRoot=$PSScriptRoot
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'),[ref]$null,[ref]$null)
foreach($definition in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){Invoke-Expression $definition.Extent.Text}
. (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('ITIR-owner-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root);$root=[IO.Path]::GetFullPath($root)
$script:ownerTestRoot=$root;$script:fixtureIndex=0;$script:checks=0
$script:realEnterOwner=(Get-Command Enter-RunnerLock).ScriptBlock
$script:realExitOwner=(Get-Command Exit-RunnerLock).ScriptBlock
$script:realOwnerWrite=(Get-Command Write-RunnerJson).ScriptBlock
$script:realPrepareOwner=(Get-Command Invoke-RunnerPrepareImageCore).ScriptBlock
$script:realOwnerController=(Get-Command Assert-RunnerControllerOpen).ScriptBlock
$script:fixtureMutexNames=@{};$script:fixtureLifetimeDepth=0;$script:failLifetimeRelease=$false;$script:fixtureStateBusy=$false
function Enter-RunnerLock([string]$Name='Global\ITInventoryLocalRunner-v1',[switch]$FailFast){
    if($Name -ceq 'Global\ITInventoryLocalRunner-v1' -and $FailFast -and $script:fixtureStateBusy){throw 'FIXTURE_STATE_BUSY'}
    $mapped='Local\'+[IO.Path]::GetFileName($script:ownerTestRoot)+'-'+$Name.Replace('\','-')
    $mutex=& $script:realEnterOwner $mapped -FailFast:$FailFast
    $script:fixtureMutexNames[$mutex.GetHashCode()]=$Name
    if($Name -ceq 'Global\ITInventoryLocalRunner-Supervisor-v1'){$script:fixtureLifetimeDepth++}
    return $mutex
}
function Exit-RunnerLock($Mutex){
    $name=$script:fixtureMutexNames[$Mutex.GetHashCode()]
    if($name -ceq 'Global\ITInventoryLocalRunner-Supervisor-v1' -and $script:failLifetimeRelease){$script:failLifetimeRelease=$false;throw 'FIXTURE_RELEASE_REFUSED'}
    & $script:realExitOwner $Mutex
    [void]$script:fixtureMutexNames.Remove($Mutex.GetHashCode())
    if($name -ceq 'Global\ITInventoryLocalRunner-Supervisor-v1'){$script:fixtureLifetimeDepth--}
}
function Check([string]$Group,[string]$Name,[scriptblock]$Work){
    if(($Cohort -cne 'all' -and $Cohort -cne $Group) -or $Name -notlike $CasePattern){return}
    & $Work
    if($script:fixtureMutexNames.Count -ne 0 -or $script:fixtureLifetimeDepth -ne 0){throw 'OWNER_FIXTURE_LOCK_LEAK'}
    $script:checks++;Write-Host "PASS $Name"
}
function Equal($Actual,$Expected,[string]$Message){if(($Actual|ConvertTo-Json -Depth 20 -Compress) -cne ($Expected|ConvertTo-Json -Depth 20 -Compress)){throw $Message}}
function Refuse([scriptblock]$Work){$failed=$false;try{& $Work|Out-Null}catch{$failed=$true};if(-not $failed){throw 'OWNER_FIXTURE_UNSAFE_ACCEPTANCE'}}
function New-Fixture {
    $script:fixtureIndex++;$directory=Join-Path $script:ownerTestRoot ('case-'+$script:fixtureIndex)
    [void][IO.Directory]::CreateDirectory($directory)
    . (Join-Path $sourceRoot 'Owner.Operation.Fixtures.ps1') -FixtureRoot $directory
    # Dot-source providers into this script's scope as well as the factory call.
    $script:fixtureDirectory=$directory
    $script:RunnerRoot=[IO.Path]::GetFullPath($directory);$script:RunnerConfigPath=Join-Path $directory 'config.json';$script:RunnerStatePath=Join-Path $directory 'state.json'
    $script:fixtureTaskState='Ready';$script:fixtureStarts=0;$script:fixtureAfterStart=$null;$script:fixtureStartFailure=$false;$script:fixtureInventoryUnavailable=$false;$script:fixtureVms=@()
    $script:RunnerOwnerOperationContext=$null;$script:RunnerPreparationAuthorized=$false;$script:RunnerImageLeases=@{}
    $script:failOwnerStage='';$script:ownerWriteHook=$null;$script:prepareCalls=0;$script:verifyCalls=0;$script:sessionCalls=0;$script:prepareFailure=$false;$script:prepareObservedFailure=$false;$script:failAfterPauseClear=$false
    $bin=Join-Path $directory 'bin';[void][IO.Directory]::CreateDirectory($bin)
    $files=@(foreach($name in Get-RunnerBundleNames){Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination (Join-Path $bin $name);[ordered]@{name=$name;hash=(Get-FileHash -LiteralPath (Join-Path $bin $name)).Hash}})
    & $script:realOwnerWrite (Join-Path $bin 'Bundle.json') ([ordered]@{schema=1;tag=$script:RunnerTag;version='2026-11-09.3';files=$files})
    $script:expectedBundle=(Get-FileHash -LiteralPath (Join-Path $bin 'Bundle.json')).Hash
    & $script:realOwnerWrite (Join-Path $directory 'installed-bundle.json') ([ordered]@{tag=$script:RunnerTag;version='2026-11-09.3';manifestHash=$script:expectedBundle})
    $base=Join-Path $directory 'base.vhdx';[IO.File]::WriteAllText($base,'CREDENTIAL-FREE BASE FIXTURE')
    $script:config=[pscustomobject]@{schema=1;tag=$script:RunnerTag;repo='example/fixture';activation='active';maxMinutes=120;label='it-inventory-ephemeral';guestIp='172.30.240.2';gatewayIp='172.30.240.1';baseVhdx=$base;baseSha256=(Get-FileHash -LiteralPath $base).Hash;privateFixture='SECRET_CONFIG_SENTINEL'}
    & $script:realOwnerWrite $script:RunnerConfigPath $script:config
    Write-RunnerBytes (Join-Path $directory 'stop.requested') ([Text.Encoding]::UTF8.GetBytes('stop'))
}
# Provider functions must survive factory scope; their root is always this test's TEMP case.
. (Join-Path $PSScriptRoot 'Owner.Operation.Fixtures.ps1') -FixtureRoot $root
function Write-RunnerJson($Path,$Value){
    if($Path -ceq (Join-Path $script:RunnerRoot 'owner-operation.json')){
        if($Value.stage -ceq $script:failOwnerStage){throw 'FIXTURE_RECEIPT_IO'}
        & $script:realOwnerWrite $Path $Value
        if($null -ne $script:ownerWriteHook){& $script:ownerWriteHook $Value}
    }else{& $script:realOwnerWrite $Path $Value}
}
function Assert-RunnerControllerOpen {
    & $script:realOwnerController
    if($script:failAfterPauseClear){throw 'SECRET_CONTROLLER_AFTER_CLEAR_FAILURE'}
}
function New-Record {
    $now=[DateTime]::UtcNow.ToString('o')
    [pscustomobject][ordered]@{schema=1;tag=$script:RunnerTag;id=[guid]::NewGuid().ToString('N');action='ResumeAfterValidation';bundleSha256=$script:expectedBundle;ownerPid=$PID;ownerStartUtc=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');startedUtc=$now;completedUtc='';stage='intent';outcome='in-progress';expectedPause=Get-RunnerPauseEvidence;pauseWriteDispatched=$false;prepareDispatched=$false;pauseClearAttempted=$false;pauseCleared=$false;startDispatched=$false;imageVerified=$false;firstRefusal='none';latestSecondary='none';resumeAuthorized=$true;startOutcomeUncertain=$false;failureObservation=[pscustomobject]@{schema=1;capture='unavailable';atUtc=$now}}
}
function New-Verification($Receipt){
    [pscustomobject]@{schema=1;purpose='verify-image';candidateId=$Receipt.id;diskHash=$Receipt.diskHash;bindingHash=$Receipt.bindingHash;recipeId=$Receipt.recipeId;bundleHash=$Receipt.bundleHash;cleanupVerified=$true;vmName=('ITIR-'+[guid]::NewGuid().ToString('N'));vmId=[guid]::NewGuid().ToString();guestMac=('02'+[guid]::NewGuid().ToString('N').Substring(0,10).ToUpperInvariant());sshPublicKeyHash=([guid]::NewGuid().ToString('N')*2).ToUpperInvariant();readiness='cloud-init-and-runner-prerequisites';readyUtc=[DateTime]::UtcNow.ToString('o');readinessSeconds=1;guestMtu=(Get-RunnerGuestMtu);diskType='Differencing';parentLease='read-only-same-handle';parentIdentity='00000001:0000000000000001';markerProof='absent-then-written';sessionSeconds=1;networkFingerprint=('a'*64)}
}
function New-Image([switch]$CandidateOnly){
    $binding=Get-RunnerImageBinding $script:config;$id=[guid]::NewGuid().ToString('N');$directory=Join-Path $script:RunnerRoot 'prepared-images';[void][IO.Directory]::CreateDirectory($directory)
    $disk=Join-Path $directory ($id+'.vhdx');$receiptPath=Join-Path $directory ($id+'.json');[IO.File]::WriteAllText($disk,('SEALED FIXTURE '+$id))
    $inputs=Read-RunnerJson (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Image.Inputs.json')
    $images=@(foreach($entry in $inputs.images){
        $aliases=@(if($entry.PSObject.Properties.Name -contains 'aliases'){foreach($alias in $entry.aliases){[pscustomobject]@{reference=$alias;id=('sha256:'+('a'*64))}}})
        [pscustomobject]@{source=$entry.source;reference=$entry.candidates[0];id=('sha256:'+('a'*64));digests=@('fixture');aliases=$aliases}
    })
    $guest=[pscustomobject]@{schema=1;recipeId=$binding.recipeId;scrubbed=$true;capabilities=@('os-prerequisites','node-toolcache','npm-cache','playwright','supabase-images');images=$images}
    $receipt=[pscustomobject]@{schema=1;tag=$script:RunnerTag;id=$id;createdUtc=[DateTime]::UtcNow.ToString('o');diskHash=(Get-FileHash -LiteralPath $disk).Hash;baseHash=$script:config.baseSha256;bindingHash=$binding.hash;recipeId=$binding.recipeId;bundleHash=$binding.bundleHash;scrubbed=$true;capabilities=$guest.capabilities;guest=$guest;selectorBefore=Get-RunnerFileEvidence (Join-Path $script:RunnerRoot 'prepared-image.json');builder=[pscustomobject]@{vmName=('ITIR-'+[guid]::NewGuid().ToString('N'));vmId=[guid]::NewGuid().ToString();guestMac='020000000001';sshPublicKeyHash=('A'*64)}}
    if(-not $CandidateOnly){$verification=New-Verification $receipt;$verification|Add-Member successiveChild (New-Verification $receipt);$receipt|Add-Member cloneVerification $verification}
    & $script:realOwnerWrite $receiptPath $receipt
    $candidate=[pscustomobject]@{id=$id;path=$disk;receiptPath=$receiptPath;receiptHash=(Get-FileHash -LiteralPath $receiptPath).Hash}
    if(-not $CandidateOnly){& $script:realOwnerWrite (Join-Path $script:RunnerRoot 'prepared-image.json') ([ordered]@{schema=1;tag=$script:RunnerTag;id=$id;previous='';receiptHash=$candidate.receiptHash})}
    return $candidate
}
function Invoke-RunnerSession($Config,$PilotAttempt,$ProfileLabel,$Purpose,$Candidate){
    $script:sessionCalls++
    if($script:prepareFailure){
        if($script:prepareObservedFailure){throw (New-RunnerObservedFailure 'SECRET_VM_PROVIDER_FAILURE' (New-RunnerFailureObservation 'image-preparation' 'image-command' $null ([DateTime]::UtcNow) '' 'outage-deadline'))}
        throw 'SECRET_VM_PROVIDER_FAILURE'
    }
    if($Purpose -ceq 'prepare'){return New-Image -CandidateOnly}
    if($Purpose -cne 'verify-image'){throw 'FIXTURE_UNEXPECTED_SESSION'}
    $script:verifyCalls++
    Refuse {[IO.File]::AppendAllText($Candidate.path,'CORRUPTION')}
    return New-Verification (Read-RunnerJson $Candidate.receiptPath)
}
function Invoke-RunnerPrepareImageCore([switch]$DeferResume){$script:prepareCalls++;if(-not $DeferResume){throw 'OWNER_PREPARE_MUST_DEFER'};& $script:realPrepareOwner -DeferResume}
function Test-LifetimeAvailable {
    if(-not ('OwnerMutexFixtureProbe' -as [type])){
        Add-Type -TypeDefinition @'
using System;
using System.Threading;
public static class OwnerMutexFixtureProbe {
    public static bool Available(string name) {
        bool available=false;
        Thread thread=new Thread(()=>{
            try { using(Mutex mutex=Mutex.OpenExisting(name)) { available=mutex.WaitOne(0);if(available)mutex.ReleaseMutex(); } }
            catch(WaitHandleCannotBeOpenedException) { available=true; }
        });
        thread.IsBackground=true;thread.Start();
        if(!thread.Join(2000))throw new InvalidOperationException("Fixture mutex inspection did not close.");
        return available;
    }
}
'@
    }
    return [OwnerMutexFixtureProbe]::Available(('Local\'+[IO.Path]::GetFileName($script:ownerTestRoot)+'-Global-ITInventoryLocalRunner-Supervisor-v1'))
}
function Enable-EntryFixture {
    $common=Join-Path (Join-Path $script:RunnerRoot 'bin') 'Common.ps1'
    $provider=(Join-Path $sourceRoot 'Owner.Operation.Fixtures.ps1').Replace("'","''")
    $mutexFixture=(Join-Path $sourceRoot 'Test.Mutex.ps1').Replace("'","''")
    $literalRoot=$script:RunnerRoot.Replace("'","''")
    $append=@'

. '__PROVIDER__' -FixtureRoot '__ROOT__'
. '__MUTEX__'
$script:entryRealEnter=(Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string]$Name='Global\ITInventoryLocalRunner-v1',[switch]$FailFast){
    & $script:entryRealEnter ('Local\ITIR-owner-entry-__GUID__-'+$Name.Replace('\','-')) -FailFast:$FailFast
}
$script:entryRealController=(Get-Command Assert-RunnerControllerOpen).ScriptBlock
function Assert-RunnerControllerOpen {
    & $script:entryRealController
    if(Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'fixture-after-clear.fault')){throw 'SECRET_AFTER_CLEAR_ERROR'}
}
'@
    $append=$append.Replace('__PROVIDER__',$provider).Replace('__MUTEX__',$mutexFixture).Replace('__ROOT__',$literalRoot).Replace('__GUID__',[IO.Path]::GetFileName($script:ownerTestRoot).Substring(11))
    [IO.File]::AppendAllText($common,$append,[Text.UTF8Encoding]::new($false))
    $bin=Join-Path $script:RunnerRoot 'bin'
    $files=@(foreach($name in Get-RunnerBundleNames){[ordered]@{name=$name;hash=(Get-FileHash -LiteralPath (Join-Path $bin $name)).Hash}})
    & $script:realOwnerWrite (Join-Path $bin 'Bundle.json') ([ordered]@{schema=1;tag=$script:RunnerTag;version='2026-11-09.3';files=$files})
    $script:expectedBundle=(Get-FileHash -LiteralPath (Join-Path $bin 'Bundle.json')).Hash
    & $script:realOwnerWrite (Join-Path $script:RunnerRoot 'installed-bundle.json') ([ordered]@{tag=$script:RunnerTag;version='2026-11-09.3';manifestHash=$script:expectedBundle})
}
function Invoke-Entry([string]$Action,[string]$Path=(Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1')){
    $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$Path,'-Action',$Action)
    if($Action -ceq 'ResumeAfterValidation'){$arguments+=@('-ExpectedBundleSha256',$script:expectedBundle)}
    $info=[Diagnostics.ProcessStartInfo]::new((Join-Path $PSHOME 'powershell.exe'),(($arguments|ForEach-Object{ConvertTo-NativeArgument $_}) -join ' '))
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=[Diagnostics.Process]::Start($info)
    try{
        $stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(20000)){$process.Kill();$process.WaitForExit();throw 'OWNER_ENTRY_TIMEOUT'}
        $stdout=$stdoutTask.GetAwaiter().GetResult();$stderr=$stderrTask.GetAwaiter().GetResult()
        if([Text.Encoding]::UTF8.GetByteCount($stdout) -gt 4098 -or $stderr.Length -ne 0 -or @($stdout.Trim() -split '\r?\n').Count -ne 1){throw 'OWNER_ENTRY_NOT_ONE_BOUNDED_JSON_RESULT'}
        return [pscustomobject]@{exitCode=$process.ExitCode;result=($stdout|ConvertFrom-Json);text=$stdout}
    }finally{$process.Dispose()}
}
$fixtureFailure=$null;$fixtureCleanupFailure=$null
try {
    Check pause 'canonical replacement accepts old creation and captures two new native identities' {
        New-Fixture;$marker=Join-Path $script:RunnerRoot 'stop.requested';[IO.File]::SetCreationTimeUtc($marker,[DateTime]::UtcNow.AddYears(-2))
        $record=New-Record;Write-RunnerOwnerOperation $record;$script:RunnerOwnerOperationContext=[pscustomobject]@{record=$record;configHash=Get-RunnerOwnerConfigEvidence}
        $first=$record.expectedPause
        Wait-RunnerUpdateIdle;$second=Get-RunnerPauseEvidence
        Wait-RunnerUpdateIdle;$third=Get-RunnerPauseEvidence
        if($first.identity -ceq $second.identity -or $second.identity -ceq $third.identity){throw 'NATIVE_REPLACEMENT_IDENTITY_NOT_CAPTURED'}
        Equal $first.createdUtc $second.createdUtc 'Creation time was treated as replacement freshness.'
        Equal $record.expectedPause $third 'Canonical owned replacement did not advance expected evidence.'
        Equal (Get-RunnerOwnerOperation).expectedPause $third 'Receipt did not persist native pause evidence.'
        Assert-RunnerPauseUnchanged $third
    }
    Check pause 'pause handle denies mutation and identity serialization is lossless' {
        New-Fixture;$expected=Get-RunnerPauseEvidence;$held=Assert-RunnerPauseUnchanged $expected -KeepLease
        try{Refuse {[IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'),'stop')};Refuse {[IO.File]::Delete((Join-Path $script:RunnerRoot 'stop.requested'))}}finally{$held.lease.Dispose()}
        $copy=$expected|ConvertTo-Json -Compress|ConvertFrom-Json;$copy.identity='FFFFFFFF:FFFFFFFFFFFFFFFF';Assert-RunnerPauseEvidence $copy
        Equal ($copy|ConvertTo-Json -Compress|ConvertFrom-Json).identity 'FFFFFFFF:FFFFFFFFFFFFFFFF' 'High-bit identity lost JSON precision.'
    }
    Check receipt 'strict bounded receipt and interrupted dispatch projection are evidence only' {
        New-Fixture;$record=New-Record;$record.stage='start-dispatching';$record.imageVerified=$true;Write-RunnerOwnerOperation $record
        $projection=Get-RunnerOwnerOperationProjection (Get-RunnerOwnerOperation)
        Equal $projection.startDispatched $false 'Intent was represented as an actual call.'
        Equal $projection.possibleStartDispatch $true 'Crash dispatch possibility was lost.'
        Equal $projection.pauseClearAttempted $false 'Intent claimed native pause clear was called.'
        Equal $projection.pauseCleared $false 'Intent claimed native pause clear succeeded.'
        Equal $projection.possiblePauseClear $true 'Interrupted intent hid possible pause clearing.'
        Equal $projection.possiblePickup $true 'Interrupted intent hid possible system recovery pickup.'
        Equal $projection.startOutcomeUncertain $true 'Interrupted dispatch claimed a known outcome.'
        foreach($mutation in @('extra','private','shape','time','bool','clear-type','clear-without-attempt','start-without-clear','false-certainty','completed-without-clear')){
            $bad=$record|ConvertTo-Json -Depth 6 -Compress|ConvertFrom-Json
            switch($mutation){extra{$bad|Add-Member path 'SECRET_PATH'};private{$bad.firstRefusal='SECRET_PROVIDER'};shape{$bad.expectedPause.identity=42};time{$bad.startedUtc='yesterday'};bool{$bad.imageVerified='true'};'clear-type'{$bad.pauseClearAttempted='false'};'clear-without-attempt'{$bad.pauseCleared=$true};'start-without-clear'{$bad.startDispatched=$true};'false-certainty'{$bad.pauseClearAttempted=$true;$bad.outcome='failed';$bad.stage='failed';$bad.completedUtc=[DateTime]::UtcNow.ToString('o')};'completed-without-clear'{$bad.outcome='completed';$bad.stage='running';$bad.completedUtc=[DateTime]::UtcNow.ToString('o')}}
            Refuse {Assert-RunnerOwnerOperation $bad}
        }
        [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'owner-operation.json'),('x'*16385));Refuse {Get-RunnerOwnerOperation}
        Equal (Get-RunnerPauseEvidence).present $true 'Receipt validation cleared Stop.'
    }
    Check receipt 'first initiating attachment is bounded current and excludes private or malformed fields' {
        New-Fixture;$start=[DateTime]::UtcNow.AddSeconds(-1).ToString('o')
        $observation=New-RunnerFailureObservation 'image-preparation' 'image-command' $null ([DateTime]::UtcNow) '' 'outage-deadline'
        $failure=New-RunnerObservedFailure 'SECRET_PROVIDER_MESSAGE' $observation
        $errorRecord=[Management.Automation.ErrorRecord]::new($failure,'Fixture',[Management.Automation.ErrorCategory]::NotSpecified,$null)
        $safe=New-RunnerOwnerFailureObservation $errorRecord $start
        Equal $safe.capture 'complete' 'Current validated attachment was lost.';Equal $safe.expiry 'outage-deadline' 'Safe initiating classification was lost.'
        foreach($kind in @('stale','future','secret','malformed','oversized')){
            $bad=$observation|ConvertTo-Json -Depth 4 -Compress|ConvertFrom-Json
            switch($kind){stale{$bad.atUtc=[DateTime]::UtcNow.AddDays(-1).ToString('o')};future{$bad.atUtc=[DateTime]::UtcNow.AddDays(1).ToString('o')};secret{$bad|Add-Member path 'SECRET_PATH'};malformed{$bad.reason='SECRET_REASON'};oversized{$bad|Add-Member raw ('SECRET'*1000)}}
            $tagged=New-RunnerObservedFailure 'SECRET_MESSAGE' $bad
            $errorRecord=[Management.Automation.ErrorRecord]::new($tagged,'Fixture',[Management.Automation.ErrorCategory]::NotSpecified,$null)
            $projected=New-RunnerOwnerFailureObservation $errorRecord $start
            Equal $projected.capture 'unavailable' 'Invalid attachment acquired a safe classification.'
            if(($projected|ConvertTo-Json -Depth 4 -Compress) -cmatch 'SECRET'){throw 'OWNER_ATTACHMENT_PRIVATE_FALLBACK'}
        }
    }
    Check resume 'current verified image skips prepare and permits immediate legitimate job pickup' {
        New-Fixture;$image=New-Image
        [IO.File]::SetCreationTimeUtc((Join-Path $script:RunnerRoot 'stop.requested'),[DateTime]::UtcNow.AddYears(-2))
        $script:readbackProbes=0
        $script:fixtureAfterStart={if($script:fixtureLifetimeDepth -ne 0 -or -not (Test-LifetimeAvailable)){throw 'PARENT_LIFETIME_BLOCKS_NEW_SUPERVISOR'};& $script:realOwnerWrite $script:RunnerStatePath ([pscustomobject]@{job='legitimate-immediate-pickup'})}
        $script:fixtureTaskReadHook={if(-not (Test-LifetimeAvailable)){throw 'READBACK_REACQUIRED_PARENT_LIFETIME'};$script:readbackProbes++}
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.outcome 'completed' 'Valid image did not resume.';Equal $script:prepareCalls 0 'Valid image rebuilt.';Equal $script:fixtureStarts 1 'Start call count differs.'
        [IO.File]::AppendAllText($image.path,'LEASE_CLOSED_AFTER_HANDOFF')
        if($script:readbackProbes -lt 1){throw 'NO_RUNNING_READBACK'}
        Equal (Get-RunnerOwnerOperation).startDispatched $true 'Actual Start attempt was not recorded.'
    }
    Check resume 'absent image performs one canonical prepare two verifiers and one Start' {
        New-Fixture;$result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.outcome 'completed' 'Canonical prepare composition failed.';Equal $script:prepareCalls 1 'Prepare repeated.';Equal $script:verifyCalls 2 'Successive clone gates changed.';Equal $script:fixtureStarts 1 'Start repeated.'
        Equal (Get-RunnerOwnerOperation).pauseWriteDispatched $true 'Canonical pause writer was not composed.'
    }
    Check resume 'corrupt selected image fails without fallback prepare or Start' {
        New-Fixture;$image=New-Image;[IO.File]::AppendAllText($image.path,'CORRUPT')
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.outcome 'failed' 'Corrupt image accepted.';Equal $script:prepareCalls 0 'Corruption became missing-image fallback.';Equal $script:fixtureStarts 0 'Corrupt image started.'
    }
    Check resume 'publication and handoff failures before Start preserve actual attempt false' {
        foreach($stage in @('intent','image-validation','image-verified','start-dispatching','release')){
            New-Fixture;[void](New-Image)
            if($stage -ceq 'release'){$script:failLifetimeRelease=$true}else{$script:failOwnerStage=$stage}
            $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
            Equal $result.outcome 'failed' 'Injected publication/release failure accepted.';Equal $script:fixtureStarts 0 'Failure dispatched Start.';Equal $result.startDispatched $false 'Pre-call failure claimed actual dispatch.';Equal $result.startOutcomeUncertain $false 'Known zero dispatch was called uncertain.'
            Equal $result.pauseClearAttempted $false 'Pre-call failure fabricated native clear attempt.';Equal $result.pauseCleared $false 'Pre-call failure fabricated native clear success.';Equal $result.possiblePickup $false 'Known pre-clear failure invented pickup uncertainty.'
            Equal (Get-RunnerPauseEvidence).present $true 'Pre-call failure cleared Stop.'
        }
    }
    Check resume 'prepare failure and changed pause prevent subsequent Start' {
        New-Fixture;$script:prepareFailure=$true;$result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $script:fixtureStarts 0 'Failed prepare started.';Equal $result.outcome 'failed' 'Prepare failure accepted.'
        foreach($change in @('replace','remove','content')){
            New-Fixture;$script:pauseChange=$change
            $script:ownerWriteHook={param($Value)if($Value.stage -ceq 'prepare-dispatching'){$marker=Join-Path $script:RunnerRoot 'stop.requested';switch($script:pauseChange){replace{Write-RunnerBytes $marker ([Text.Encoding]::UTF8.GetBytes('stop'))};remove{[IO.File]::Delete($marker)};content{[IO.File]::WriteAllText($marker,'changed')}}}}
            $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
            Equal $script:prepareCalls 0 'External pause change reached Prepare.';Equal $script:fixtureStarts 0 'External pause change reached Start.';Equal $result.outcome 'failed' 'External pause change accepted.'
        }
    }
    Check resume 'called Start failure is uncertain and never retried or compensated' {
        New-Fixture;[void](New-Image);$script:fixtureStartFailure=$true
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $script:fixtureStarts 1 'Uncertain Start was retried.';Equal $result.startDispatched $true 'Actual API call hidden.';Equal $result.startOutcomeUncertain $true 'Called API failure claimed certainty.'
        Equal (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) $false 'Compensating Stop was written.'
    }
    Check resume 'selector and selected receipt replacements cannot cross Start intent publication' {
        foreach($target in @('selector','receipt')){
            New-Fixture;$image=New-Image
            $script:metadataTarget=if($target -ceq 'selector'){Join-Path $script:RunnerRoot 'prepared-image.json'}else{$image.receiptPath}
            $script:ownerWriteHook={param($Value)if($Value.stage -ceq 'start-dispatching'){Write-RunnerBytes $script:metadataTarget ([IO.File]::ReadAllBytes($script:metadataTarget))}}
            $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
            Equal $result.outcome 'failed' 'Metadata replacement crossed Start admission.';Equal $script:fixtureStarts 0 'Metadata replacement reached scheduler.'
            Equal $result.pauseClearAttempted $false 'Metadata publication failure reached native pause deletion.'
            Equal (Get-RunnerPauseEvidence).present $true 'Metadata replacement cleared Stop.'
            # Both identities are released after failure; no lease survives it.
            Write-RunnerBytes $script:metadataTarget ([IO.File]::ReadAllBytes($script:metadataTarget))
        }
    }
    Check resume 'metadata leases survive successful dispatch and running readback then close' {
        New-Fixture;$image=New-Image;$script:metadataPaths=@((Join-Path $script:RunnerRoot 'prepared-image.json'),$image.receiptPath);$script:metadataProbeCount=0
        $script:fixtureTaskReadHook={foreach($path in $script:metadataPaths){Refuse {Write-RunnerBytes $path ([IO.File]::ReadAllBytes($path))};$script:metadataProbeCount++}}
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.outcome 'completed' 'Held metadata blocked legitimate readback.'
        if($script:metadataProbeCount -lt 2){throw 'METADATA_READBACK_LEASE_NOT_TESTED'}
        foreach($path in $script:metadataPaths){Write-RunnerBytes $path ([IO.File]::ReadAllBytes($path))}
    }
    Check resume 'native pause clear success then controller failure is pickup uncertainty without scheduler dispatch' {
        New-Fixture;[void](New-Image);$script:failAfterPauseClear=$true
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.pauseClearAttempted $true 'Actual native delete attempt was hidden.';Equal $result.pauseCleared $true 'Successful native delete was hidden.'
        Equal $result.startDispatched $false 'Controller failure claimed scheduler dispatch.';Equal $script:fixtureStarts 0 'Controller failure called scheduler.'
        Equal $result.possiblePickup $true 'Cleared pause concealed possible system recovery.';Equal $result.startOutcomeUncertain $true 'Post-clear failure claimed no pickup uncertainty.'
        Equal (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) $false 'Native pause clear did not occur or was compensated.'
        Equal (Get-RunnerOwnerOperation).pauseCleared $true 'Persisted failure lost successful pause clearing.'
    }
    Check resume 'native deletion refusal records possible clearing but never claims success' {
        New-Fixture;[void](New-Image);$marker=Join-Path $script:RunnerRoot 'stop.requested';[IO.File]::SetAttributes($marker,[IO.FileAttributes]::ReadOnly)
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.pauseClearAttempted $true 'Native refusal hid the actual delete call.';Equal $result.pauseCleared $false 'Failed native delete claimed success.'
        Equal $result.possiblePauseClear $true 'Native failure claimed no possible clear.';Equal $result.possiblePickup $true 'Native failure claimed known paused outcome.'
        Equal $result.startOutcomeUncertain $true 'Native deletion failure hid uncertainty.';Equal $script:fixtureStarts 0 'Failed delete called scheduler.'
        Equal (Get-RunnerPauseEvidence).present $true 'Read-only native deletion unexpectedly succeeded.'
    }
    Check resume 'marker dispatch publication errors and final external pause changes remain paused' {
        foreach($stage in @('prepare-dispatching','pause-write-dispatching','paused')){
            New-Fixture;$script:failOwnerStage=$stage
            $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
            Equal $result.outcome 'failed' 'Marker/prepare publication failure accepted.';Equal $script:fixtureStarts 0 'Marker failure started supervisor.'
            Equal (Get-RunnerPauseEvidence).present $true 'Marker failure removed pause.'
            if($stage -ceq 'prepare-dispatching'){Equal $script:prepareCalls 0 'Unpublished prepare intent called Prepare.'}
            if($stage -ceq 'pause-write-dispatching'){Equal (Get-RunnerOwnerOperation).pauseWriteDispatched $false 'Unpublished marker intent claimed write.'}
        }
        foreach($change in @('replace','remove','content')){
            New-Fixture;[void](New-Image);$script:pauseChange=$change
            $script:ownerWriteHook={param($Value)if($Value.stage -ceq 'image-verified'){$marker=Join-Path $script:RunnerRoot 'stop.requested';switch($script:pauseChange){replace{Write-RunnerBytes $marker ([Text.Encoding]::UTF8.GetBytes('stop'))};remove{[IO.File]::Delete($marker)};content{[IO.File]::WriteAllText($marker,'changed')}}}}
            $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
            Equal $script:fixtureStarts 0 'Final external pause mutation reached Start.';Equal $result.outcome 'failed' 'Final pause mutation accepted.'
        }
    }
    Check resume 'native pause replacement failure preserves the old same-handle evidence' {
        New-Fixture;$expected=Get-RunnerPauseEvidence;$script:blockedPause=$null
        $script:ownerWriteHook={param($Value)if($Value.stage -ceq 'pause-write-dispatching'){$script:blockedPause=Assert-RunnerPauseUnchanged $Value.expectedPause -KeepLease}}
        try{$result=Invoke-RunnerResumeAfterValidation $script:expectedBundle}finally{if($null -ne $script:blockedPause){$script:blockedPause.lease.Dispose()}}
        Equal $result.outcome 'failed' 'Failed native replacement accepted.';Equal $script:fixtureStarts 0 'Failed marker writer dispatched Start.'
        Assert-RunnerPauseUnchanged $expected
    }
    Check resume 'initiating safe observation survives secondary receipt publication failure' {
        New-Fixture;$script:prepareFailure=$true;$script:prepareObservedFailure=$true;$script:failOwnerStage='failed'
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.failureObservation.capture 'complete' 'Initiating attachment was lost.'
        Equal $result.failureObservation.expiry 'outage-deadline' 'Secondary error replaced initiating observation.'
        Equal $result.latestSecondary 'receipt-publication' 'Secondary publication failure was hidden.'
        Equal $script:fixtureStarts 0 'Failed preparation dispatched Start.'
        if(($result|ConvertTo-Json -Depth 6 -Compress) -cmatch 'SECRET'){throw 'OWNER_FAILURE_PRIVATE_OUTPUT'}
    }
    Check resume 'fresh admission never replays a live or interrupted historical dispatch' {
        New-Fixture;[void](New-Image);$old=New-Record;$old.stage='start-dispatching';$old.imageVerified=$true;Write-RunnerOwnerOperation $old
        Refuse {Invoke-RunnerResumeAfterValidation $script:expectedBundle}
        Equal $script:fixtureStarts 0 'Live operation was replayed.'
        $old.ownerPid=2147483646;Write-RunnerOwnerOperation $old
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.outcome 'completed' 'Fresh admitted intent could not replace dead historical intent.'
        Equal $script:fixtureStarts 1 'Historical uncertain dispatch was replayed.'
    }
    Check resume 'active installed idle security and config gates refuse before command dispatch' {
        foreach($kind in @('inactive','installed','jit','state','inventory','transition','config-change')){
            New-Fixture;[void](New-Image)
            switch($kind){
                inactive{$script:config.activation='disabled';& $script:realOwnerWrite $script:RunnerConfigPath $script:config}
                installed{[IO.File]::AppendAllText((Join-Path (Join-Path $script:RunnerRoot 'bin') 'Guest.Network.ps1'),'tampered')}
                jit{& $script:realOwnerWrite (Join-Path $script:RunnerRoot 'jit-registration.json') ([pscustomobject]@{invalid=$true})}
                state{& $script:realOwnerWrite $script:RunnerStatePath ([pscustomobject]@{invalid=$true})}
                inventory{$script:fixtureInventoryUnavailable=$true}
                transition{& $script:realOwnerWrite (Join-Path $script:RunnerRoot 'update-journal.json') ([pscustomobject]@{invalid=$true})}
                config-change{$script:ownerWriteHook={param($Value)if($Value.stage -ceq 'image-verified'){[IO.File]::AppendAllText($script:RunnerConfigPath,' ')}}}
            }
            try{$result=Invoke-RunnerResumeAfterValidation $script:expectedBundle;if($result.outcome -cne 'failed'){throw 'UNSAFE_GATE_ACCEPTANCE'}}catch{if($_.Exception.Message -ceq 'UNSAFE_GATE_ACCEPTANCE'){throw}}
            Equal $script:fixtureStarts 0 'Failed admission dispatched Start.';Equal $script:prepareCalls 0 'Failed admission dispatched Prepare.'
            Equal (Get-RunnerPauseEvidence).present $true 'Admission failure removed pause.'
        }
    }
    Check resume 'stale intact image prepares once and pending update cannot be resumed by owner receipt' {
        New-Fixture;[void](New-Image)
        $config=Get-RunnerConfig;[IO.File]::AppendAllText($config.baseVhdx,'NEW TRUSTED BASE');$config.baseSha256=(Get-FileHash -LiteralPath $config.baseVhdx).Hash;& $script:realOwnerWrite $script:RunnerConfigPath $config;$script:config=$config
        $result=Invoke-RunnerResumeAfterValidation $script:expectedBundle
        Equal $result.outcome 'completed' 'Intact stale binding did not prepare.';Equal $script:prepareCalls 1 'Stale binding did not use exactly one prepare.';Equal $script:verifyCalls 2 'Stale binding bypassed verifiers.'
        New-Fixture;[void](New-Image)
        & $script:realOwnerWrite (Join-Path $script:RunnerRoot 'update-journal.json') ([pscustomobject]@{tag=$script:RunnerTag;phase='pending'})
        Refuse {Invoke-RunnerResumeAfterValidation $script:expectedBundle}
        Equal $script:fixtureStarts 0 'Owner receipt resumed a pending update.'
        Equal (Get-RunnerPauseEvidence).present $true 'Pending update cleared Stop.'
    }
    Check resume 'temporary preparation and preflight context restores values and absence on failure' {
        New-Fixture;$image=New-Image;$record=New-Record;Write-RunnerOwnerOperation $record
        $script:RunnerOwnerOperationContext=[pscustomobject]@{record=$record;configHash=Get-RunnerOwnerConfigEvidence}
        $old=[pscustomobject]@{purpose='fixture';deadlineUtc=[DateTime]::UtcNow.AddMinutes(1)};$script:RunnerImagePreflight=$old
        [void](Get-RunnerOwnerImageState $script:config)
        Equal $script:RunnerPreparationAuthorized $false 'Preparation flag leaked after return.'
        if(-not [object]::ReferenceEquals($script:RunnerImagePreflight,$old)){throw 'PREFLIGHT_CONTEXT_NOT_RESTORED'}
        $bytes=[IO.File]::ReadAllBytes($image.path);[IO.File]::AppendAllText($image.path,'CORRUPTION')
        Refuse {Get-RunnerOwnerImageState $script:config}
        Equal $script:RunnerPreparationAuthorized $false 'Preparation flag leaked after failure.'
        if(-not [object]::ReferenceEquals($script:RunnerImagePreflight,$old)){throw 'FAILED_PREFLIGHT_CONTEXT_NOT_RESTORED'}
        [IO.File]::WriteAllBytes($image.path,$bytes)
        Remove-Variable RunnerPreparationAuthorized -Scope Script;Remove-Variable RunnerImagePreflight -Scope Script
        [void](Get-RunnerOwnerImageState $script:config)
        Equal ($null -eq (Get-Variable RunnerPreparationAuthorized -Scope Script -ErrorAction SilentlyContinue)) $true 'Absent preparation flag was not restored.'
        Equal ($null -eq (Get-Variable RunnerImagePreflight -Scope Script -ErrorAction SilentlyContinue)) $true 'Absent preflight was not restored.'
        $script:RunnerOwnerOperationContext=$null;Refuse {Get-RunnerOwnerImageState $script:config}
        Equal ($null -eq (Get-Variable RunnerPreparationAuthorized -Scope Script -ErrorAction SilentlyContinue)) $true 'Unauthorized validation set the flag.'
    }
    Check entry 'installed public status and resume emit one JSON result and checkout execution is refused' {
        New-Fixture;Enable-EntryFixture;[void](New-Image)
        $status=Invoke-Entry 'OwnerStatus';Equal $status.exitCode 0 'Installed status failed.';Equal $status.result.execution 'installed' 'Installed execution not recognized.'
        Equal $status.result.supervisorState 'ready' 'Public task validity hid non-running supervisor.';Equal $status.result.watchdogState 'ready' 'Public watchdog state missing.'
        if($status.text -cmatch 'SECRET|baseVhdx|ciphertext'){throw 'PUBLIC_STATUS_PRIVATE_OUTPUT'}
        $checkout=Join-Path $script:RunnerRoot 'checkout';[void][IO.Directory]::CreateDirectory($checkout)
        foreach($file in Get-ChildItem -LiteralPath (Join-Path $script:RunnerRoot 'bin') -File){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $checkout $file.Name)}
        $refused=Invoke-Entry 'ResumeAfterValidation' (Join-Path $checkout 'Runner.ps1')
        Equal $refused.exitCode 3 'Checkout resume was accepted.';Equal $refused.result.operation.firstRefusal 'execution-mismatch' 'Wrong execution was not classified.'
        Equal (Get-RunnerPauseEvidence).present $true 'Checkout cleared Stop.'
        $resumed=Invoke-Entry 'ResumeAfterValidation';Equal $resumed.exitCode 0 'Installed resume failed.';Equal $resumed.result.success $true 'Installed resume did not report success.'
        Equal $resumed.result.operation.startDispatched $true 'Public actual Start attempt missing.'
        New-Fixture;Enable-EntryFixture;[void](New-Image);[IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'fixture-after-clear.fault'),'fixture')
        $uncertain=Invoke-Entry 'ResumeAfterValidation';Equal $uncertain.exitCode 3 'Post-clear refusal reported public success.'
        Equal $uncertain.result.operation.pauseCleared $true 'Public failure hid actual native deletion.';Equal $uncertain.result.operation.startDispatched $false 'Public failure fabricated scheduler dispatch.'
        Equal $uncertain.result.operation.possiblePickup $true 'Public failure hid possible pickup.';Equal $uncertain.result.operation.startOutcomeUncertain $true 'Public failure hid uncertainty.'
        if($uncertain.text -cmatch 'SECRET'){throw 'PUBLIC_POST_CLEAR_ERROR_LEAK'}
    }
    Check status 'read-only status does not certify historical image proof or invent idle inventory' {
        New-Fixture;$image=New-Image;$record=New-Record;$record.imageVerified=$true;$record.stage='failed';$record.outcome='failed';$record.completedUtc=[DateTime]::UtcNow.ToString('o');Write-RunnerOwnerOperation $record
        $script:fixtureInventoryUnavailable=$true
        $before=@(Get-ChildItem -LiteralPath $script:RunnerRoot -Recurse -File|ForEach-Object{$_.FullName+'|'+(Get-FileHash -LiteralPath $_.FullName).Hash})
        $diskLease=[IO.File]::Open($image.path,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$status=Get-RunnerOwnerStatus;$json=$status|ConvertTo-Json -Depth 5 -Compress}finally{$diskLease.Dispose()}
        Equal $status.imageSelection 'present' 'Status tried to open/hash the image disk.'
        Equal $status.session 'unknown' 'Unavailable inventory became idle.';Equal $status.imageNeedsValidation $true 'Historical receipt became current certification.'
        if($json -cmatch 'SECRET|baseVhdx|ciphertext|identity|hash'){throw 'STATUS_PRIVATE_PROJECTION'}
        $after=@(Get-ChildItem -LiteralPath $script:RunnerRoot -Recurse -File|ForEach-Object{$_.FullName+'|'+(Get-FileHash -LiteralPath $_.FullName).Hash})
        Equal $before $after 'Read-only status wrote files.'
        $script:fixtureStateBusy=$true
        try{$busy=Get-RunnerOwnerStatus}finally{$script:fixtureStateBusy=$false}
        Equal $busy.installed 'coherent' 'Busy state discarded independent installed evidence.'
        Equal $busy.session 'unknown' 'Busy state invented idle session evidence.'
        Equal $busy.ownerOperation.outcome 'unknown' 'Busy state invented owner receipt evidence.'
    }
    Check status 'identity-validated task definitions and operational task states are independent' {
        New-Fixture
        foreach($state in @('Ready','Running','Queued','Disabled','Unexpected')){
            $script:fixtureTaskState=$state;$status=Get-RunnerOwnerStatus
            $expected=if($state -ceq 'Unexpected'){'unknown'}else{$state.ToLowerInvariant()}
            Equal $status.tasks 'valid' 'Valid task definitions were conflated with runtime state.'
            Equal $status.supervisorState $expected 'Supervisor operational state was lost.';Equal $status.watchdogState $expected 'Watchdog operational state was lost.'
        }
        $script:fixtureTaskState='Running';$script:fixtureStateBusy=$true
        try{$busy=Get-RunnerOwnerStatus}finally{$script:fixtureStateBusy=$false}
        Equal $busy.supervisorState 'running' 'Busy state discarded validated supervisor state.';Equal $busy.watchdogState 'running' 'Busy state discarded validated watchdog state.'
        $script:fixtureInvalidTaskIdentity=$true;$invalid=Get-RunnerOwnerStatus
        Equal $invalid.tasks 'unknown' 'Invalid task identity was accepted.';Equal $invalid.supervisorState 'unknown' 'Unvalidated supervisor state was projected.';Equal $invalid.watchdogState 'unknown' 'Unvalidated watchdog state was projected.'
    }
    if($script:checks -eq 0){throw 'OWNER_FIXTURE_NO_CASES'}
    Write-Host "Owner operation focused checks passed: $script:checks cases; no live VM/task/credential/network proof."
}catch{$fixtureFailure=$_}finally{
    $script:RunnerOwnerOperationContext=$null
    try{
        $resolved=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $root -ErrorAction Stop).ProviderPath)
        if($resolved -ine $root -or [IO.Path]::GetDirectoryName($resolved) -ine [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -cnotmatch '^ITIR-owner-[0-9a-f]{32}$' -or (Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'OWNER_FIXTURE_CLEANUP_REFUSED'}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }catch{$fixtureCleanupFailure=$_}
}
if($null -ne $fixtureFailure){if($null -ne $fixtureCleanupFailure){Write-Warning 'Owned fixture cleanup refused; original initiating failure retained.'};throw $fixtureFailure}
if($null -ne $fixtureCleanupFailure){throw $fixtureCleanupFailure}
