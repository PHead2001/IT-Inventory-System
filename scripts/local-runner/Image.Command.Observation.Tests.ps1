# Offline metadata/ordering regressions. No real locks, protected files, VM,
# network, credentials, native commands or image operations are invoked.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$names = @('Get-RunnerState','Get-RunnerSessionPaths','Assert-StateIdentity','Get-RunnerRecoveryDiagnosticNumber','Get-RunnerProbeExitCode','Assert-RunnerRecoveryDiagnostic','New-RunnerRecoveryDiagnostic','New-RunnerFailureObservation','Get-RunnerImageCommandFailureObservation','Assert-RunnerFailureRecord','Assert-RunnerCleanupJournal','Write-RunnerCleanupObservation','Write-RunnerSessionFailureObservation','Get-RunnerRecoveryHash','Get-RunnerRecoveryClaimHash','New-RunnerRecoveryEpisodeDiagnostic','New-RunnerNetworkRecovery','ConvertTo-RunnerDiagnosticText','Invoke-RunnerImageBuild')
foreach ($file in @('Common.ps1','Network.Recovery.ps1','PreparedImage.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file),[ref]$null,[ref]$null)
    foreach ($definition in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
        if ($definition.Name -cin $names) { Invoke-Expression $definition.Extent.Text }
    }
}
$realCapture = (Get-Command Get-RunnerImageCommandFailureObservation).ScriptBlock
$runnerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'),[ref]$null,[ref]$null)
$ownerTry = @($runnerAst.FindAll({param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $n.CatchClauses.Count -gt 0 -and (($n.CatchClauses | ForEach-Object {$_.Extent.Text}) -join '') -match '\$sessionFailure = \$_'},$true))
if ($ownerTry.Count -ne 1) { throw 'Image observation owner catch/finally was not found.' }
# Execute the actual canonical catch/finally around the focused builder call.
$owner = [scriptblock]::Create('$sessionFailure=$null;$verificationReady=$false;$name=$script:state.vmName;$state=$script:passed;try { Invoke-RunnerImageBuild $state ([pscustomobject]@{guestIp="fixture"}) } '+(($ownerTry[0].CatchClauses | ForEach-Object {$_.Extent.Text}) -join ' ')+' finally '+$ownerTry[0].Finally.Extent.Text)
$script:RunnerRoot = 'C:\synthetic-image-observation'
$script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
$script:RunnerTag = 'it-inventory-local-runner-v1'; $script:RunnerSwitch = 'ITIR-Isolated'; $script:RunnerOperationStage = 'image-preparation'
$script:checks = 0
function Require([bool]$Value) { if (-not $Value) { throw 'Image command observation regression failed.' } }
function Check([string]$Name,[scriptblock]$Work) { & $Work; $script:checks++; Write-Host "PASS $Name" }
function Copy-Fixture($Value) { return $Value | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json }
function Reset-Fixture {
    $script:now = [DateTime]::UtcNow
    $script:state = [pscustomobject]@{tag=$script:RunnerTag;vmName=('ITIR-'+('1'*32));vmId='11111111-1111-1111-1111-111111111111';instancePath=(Join-Path (Join-Path $script:RunnerRoot 'instances') ('ITIR-'+('1'*32)));layoutVersion=2;purpose='prepare';phase='owned';resourceLabel='it-inventory-heavy';createdUtc=$script:now.AddMinutes(-1).ToString('o');deadlineUtc=$script:now.AddHours(1).ToString('o');supervisorPid=11;supervisorStartUtc=$script:now.AddMinutes(-2).ToString('o');guestMac='020000000001'}
    $script:passed = Copy-Fixture $script:state # Deliberately predates the guardian binding.
    $script:state | Add-Member guardianPid 22; $script:state | Add-Member guardianStartUtc $script:now.AddSeconds(-40).ToString('o')
    $binding = [pscustomobject]@{claimHash=(Get-RunnerRecoveryClaimHash $script:state);vmId=$script:state.vmId;vmName=$script:state.vmName;adapterId='fixture-adapter';mac=$script:state.guestMac;switchId='22222222-2222-2222-2222-222222222222';switchName=$script:RunnerSwitch}
    $script:state | Add-Member networkRecovery (New-RunnerNetworkRecovery $binding ('a'*64) ([DateTime]::Parse($script:state.deadlineUtc).ToUniversalTime()) $script:now)
    $r = $script:state.networkRecovery; $r.phase='quarantining'; $r.generation=1; $r.episodeStartedUtc=$script:now.AddSeconds(-25).ToString('o'); $r.episodeDeadlineUtc=$script:now.AddSeconds(95).ToString('o')
    $r.diagnostics.trigger='fingerprint-change'; $r.diagnostics.lastTransition='quarantining'; $r.diagnostics.fingerprintChangeCount=1; $r.diagnostics.preflightElapsedMs=26000; $r.diagnostics.staleAdmissionCount=2
    $script:depth=0; $script:fast=0; $script:reads=0; $script:events=@(); $script:busy=$false; $script:readFails=$false; $script:shapeFails=$false; $script:captureThrows=$false; $script:captureInProgress=$false; $script:writerThrows=$false; $script:recoverInWriter=$false; $script:busyInWriter=$false; $script:captureCalls=0; $script:nativeCalls=0; $script:siblingFailAt=0; $script:cleanupCalls=0; $script:persistFails=$false; $script:journal=$null; $script:warnings=@(); $script:lockExitFails=$false
}
function Get-RunnerRecoveryNow { return $script:now }
function Enter-RunnerLock { param([string]$Name,[switch]$FailFast); if($FailFast){$script:fast++;$script:events+='capture';if($script:busy){throw 'PRIVATE_LOCK'}};$script:depth++;return 'fixture-lock' }
function Exit-RunnerLock { param($Token);$script:depth--;if($script:lockExitFails -and $script:captureInProgress){throw 'PRIVATE_UNLOCK'} }
function Assert-SecureRoot { Require ($script:depth -gt 0) }
function Assert-OwnedPath([string]$Path) { Require ($Path.StartsWith($script:RunnerRoot+'\'));return $Path }
function Assert-RunnerProtectedPath { param($Path);Require ($script:depth -gt 0) }
function Get-Item { param($LiteralPath,[switch]$Force,$ErrorAction);Require ($script:depth -gt 0);return [pscustomobject]@{PSIsContainer=$false;Attributes=[IO.FileAttributes]::Normal;Length=$(if($script:shapeFails){65537}else{1024})} }
function Get-RunnerResourceProfile { param($Label);Require ($Label -ceq 'it-inventory-heavy') }
function Read-RunnerJson { param($Path);Require ($script:depth -gt 0);if($Path -ceq $script:RunnerStatePath){$script:reads++;if($script:readFails){throw 'PRIVATE_READ'};return $script:state};return $script:journal }
function Test-Path { param($LiteralPath);return $null -ne $script:journal }
function Write-RunnerJson { param($Path,$Value);if($script:persistFails){throw 'PRIVATE_PERSIST'};Require ($Path -ceq (Join-Path $script:RunnerRoot 'failure-cleanup.json'));$script:journal=Copy-Fixture $Value }
function Write-Warning { param($Message,$WarningAction);$script:warnings+=$Message }
function Get-RunnerImageCommandFailureObservation { param($State);$script:captureCalls++;if($script:captureThrows){throw 'PRIVATE_CAPTURE'};$script:captureInProgress=$true;try{return & $realCapture $State}finally{$script:captureInProgress=$false} }
function Assert-RunnerPreparationAuthorized {}
function Get-RunnerImageBinding { param($Config);return [pscustomobject]@{bundleHash=('A'*64)} }
function Get-SshArgs { param($State);return @() }
function Get-RunnerImageInputNames { return @() }
function Assert-SessionAlive { param($State);$script:events+='initial-liveness' }
function Invoke-RunnerNative { param($Executable,$Arguments,[switch]$CaptureOutput,[switch]$CaptureError,$TimeoutSeconds);$script:nativeCalls++;if($script:nativeCalls -eq $script:siblingFailAt){return 255};if($script:nativeCalls -le 2){return 0};return [pscustomobject]@{ExitCode=255;Output='';ErrorOutput='PRIVATE_STDERR'} }
function Write-RunnerImagePreparationFailure { param($State,$BundleHash,$Detail);$script:events+='artifact';if($script:recoverInWriter){$script:busy=$false;$script:now=$script:now.AddSeconds(30);$script:state.networkRecovery.phase='healthy';$script:state.networkRecovery.progressUtc=$script:now.ToString('o');$script:state.networkRecovery.diagnostics.lastTransition='healthy'};if($script:busyInWriter){$script:busy=$true};if($script:writerThrows){throw 'PRIVATE_ARTIFACT'} }
function Write-RunnerSessionFailure {}
function Write-RunnerFailure {}
function Remove-RunnerInstance { param($State);$script:cleanupCalls++ }
function Invoke-Failure { try { & $owner } catch { return $_ };throw 'Expected image failure.' }
Check 'captures current recovery before the artifact wait using a reentrant fail-fast read' {
    Reset-Fixture
    Require ((Get-RunnerRecoveryClaimHash $script:passed) -cne $script:state.networkRecovery.binding.claimHash)
    $errorRecord=Invoke-Failure; $observation=$errorRecord.Exception.Data['runnerFailureObservation']
    Require ($observation.capture -ceq 'complete' -and $observation.origin -ceq 'image-preparation' -and $observation.reason -ceq 'image-command' -and $observation.recoveryPhase -ceq 'quarantining')
    Require ($script:events.IndexOf('capture') -lt $script:events.IndexOf('artifact') -and $script:fast -eq 1 -and $script:captureCalls -eq 1 -and $script:depth -eq 0 -and $script:cleanupCalls -eq 1)
    Require ($script:journal.first.recoveryDiagnostic.preflightElapsedMs -eq 26000 -and $script:journal.first.recoveryDiagnostic.staleAdmissionCount -eq 2)
    Require (($script:journal | ConvertTo-Json -Depth 6 -Compress) -cnotmatch 'PRIVATE|instancePath|claimHash|adapterId|switchId|fingerprint"|supervisorPid')
    Assert-RunnerCleanupJournal $script:journal
}
Check 'one later capture honestly retains completed healthy recovery trigger and maximum timings' {
    Reset-Fixture;$early=$script:now;$script:busy=$true;$script:recoverInWriter=$true
    $errorRecord=Invoke-Failure;$observation=$errorRecord.Exception.Data['runnerFailureObservation']
    Require ($observation.capture -ceq 'complete' -and $observation.recoveryPhase -ceq 'healthy' -and $observation.recoveryDiagnostic.trigger -ceq 'fingerprint-change')
    Require ($observation.atUtc -ceq $script:now.ToString('o') -and [DateTime]::Parse($observation.atUtc).ToUniversalTime() -gt $early -and $script:captureCalls -eq 2 -and $script:fast -eq 2)
    Require ($observation.recoveryDiagnostic.preflightElapsedMs -eq 26000 -and $observation.recoveryDiagnostic.fingerprintChangeCount -eq 1 -and $script:cleanupCalls -eq 1)
}
Check 'busy and invalid reads return the existing unavailable shape without provider or liveness work' {
    foreach($case in @('busy','read','size')){Reset-Fixture;switch($case){busy{$script:busy=$true};read{$script:readFails=$true};size{$script:shapeFails=$true}};$record=Get-RunnerImageCommandFailureObservation $script:passed
        Require ($record.capture -ceq 'unavailable' -and (@($record.Keys | Sort-Object)-join ',') -ceq 'atUtc,capture,schema' -and $script:depth -eq 0 -and $script:events -notcontains 'initial-liveness')
        if($case -ceq 'busy'){Require ($script:reads -eq 0)}
    }
}
Check 'session VM instance owner and current claim mismatches are unavailable' {
    foreach($case in @('session','vm','instance','owner','owner-start','claim','binding-vm','binding-mac','guardian','purpose','job-field')){Reset-Fixture
        switch($case){session{$script:state.vmName='ITIR-'+('2'*32)};vm{$script:state.vmId='33333333-3333-3333-3333-333333333333'};instance{$script:state.instancePath='C:\PRIVATE'};owner{$script:state.supervisorPid=12};owner-start{$script:state.supervisorStartUtc=$script:now.ToString('o')};claim{$script:state.networkRecovery.binding.claimHash=Get-RunnerRecoveryClaimHash $script:passed};binding-vm{$script:state.networkRecovery.binding.vmId='33333333-3333-3333-3333-333333333333'};binding-mac{$script:state.networkRecovery.binding.mac='020000000099'};guardian{$script:state.guardianPid='PRIVATE'};purpose{$script:state.purpose='verify-image'};job-field{$script:state | Add-Member runnerId 1}}
        Require ((Get-RunnerImageCommandFailureObservation $script:passed).capture -ceq 'unavailable' -and $script:depth -eq 0)
    }
}
Check 'malformed diagnostics fail closed and private extras never enter bounded observations' {
    Reset-Fixture;$script:state | Add-Member privateCredential 'PRIVATE';$script:state.networkRecovery.diagnostics | Add-Member rawOutput 'PRIVATE'
    $record=Get-RunnerImageCommandFailureObservation $script:passed;$json=$record | ConvertTo-Json -Depth 4 -Compress
    Require ($record.capture -ceq 'complete' -and [Text.Encoding]::UTF8.GetByteCount($json) -le 2048 -and $json -cnotmatch 'PRIVATE|privateCredential|rawOutput')
    $script:state.networkRecovery.diagnostics.preflightElapsedMs=[double]::NaN
    Require ((Get-RunnerImageCommandFailureObservation $script:passed).capture -ceq 'unavailable')
}
Check 'capture artifact persistence and lock-release errors never replace the SSH exception or cleanup' {
    foreach($case in @('capture','artifact','persistence','unlock','still-busy')){Reset-Fixture
        switch($case){capture{$script:captureThrows=$true};artifact{$script:writerThrows=$true};persistence{$script:persistFails=$true};unlock{$script:lockExitFails=$true};still-busy{$script:busy=$true;$script:busyInWriter=$true}}
        $errorRecord=Invoke-Failure
        Require ($errorRecord.Exception -is [InvalidOperationException] -and $errorRecord.Exception.Message -ceq 'IMAGE_PREPARATION_COMMAND_FAILED' -and $errorRecord.Exception.Data['runnerImagePreparation'].exitCode -eq 255)
        Require ($errorRecord.InvocationInfo.Line -match 'throw \$failure' -and $errorRecord.InvocationInfo.ScriptLineNumber -gt 0)
        Require ($script:cleanupCalls -eq 1 -and $script:captureCalls -ge 1 -and $script:captureCalls -le 2 -and $script:depth -eq 0)
    }
}
Check 'capture has no provider liveness bundle reads or writes and siblings remain distinct' {
    $common=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Common.ps1'),[ref]$null,[ref]$null)
    $capture=@($common.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-RunnerImageCommandFailureObservation'},$false))[0]
    $calls=@($capture.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst]},$true) | ForEach-Object {$_.GetCommandName()})
    foreach($name in @('Get-VM','Get-CimInstance','Assert-SessionAlive','Get-CoherentInstalledRunnerBundle','Write-RunnerJson','Save-Heartbeat','Test-RunnerProcessIdentity')){Require ($calls -cnotcontains $name)}
    Reset-Fixture;$script:nativeCalls=-10
    # The pre-builder input operations still have their own errors; no fabricated
    # image-command observation is attached to a failure before that SSH result.
    $body=(Get-Command Invoke-RunnerImageBuild).ScriptBlock.ToString()
    Require ($body.IndexOf('Image input directory creation failed.') -lt $body.IndexOf('Get-RunnerImageCommandFailureObservation') -and $body.IndexOf('Trusted image input transfer failed.') -lt $body.IndexOf('Get-RunnerImageCommandFailureObservation'))
    foreach($position in @(1,2)){Reset-Fixture;$script:siblingFailAt=$position;$errorRecord=Invoke-Failure
        $expected=if($position -eq 1){'Image input directory creation failed.'}else{'Trusted image input transfer failed.'}
        Require ($errorRecord.Exception.Message -ceq $expected -and $script:captureCalls -eq 0 -and $script:cleanupCalls -eq 1 -and -not $errorRecord.Exception.Data.Contains('runnerFailureObservation'))
    }
}
Write-Host "Image command observation passed: $script:checks offline metadata/owner-cleanup regressions."
