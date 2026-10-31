# Definitions only; disposable publication root and mocked session/SSH providers.
param([string] $CapturedProjectionsPath = '')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
trap { Write-Host ('CLOUD_INIT_TEST_FAILURE '+(($_.ScriptStackTrace -split '\r?\n' | ForEach-Object { if ($_ -match 'line (\d+)') { $Matches[1] } }) -join ',')+' '+$_.Exception.GetType().Name); exit 1 }
$functions=@('Get-RunnerSessionPaths','Assert-RunnerSessionTrustedPaths','Assert-RunnerCloudInitFields','Assert-RunnerCloudInitDiagnostic','ConvertFrom-RunnerCloudInitCapture','Test-RunnerCloudInitTerminal','Assert-RunnerCloudInitArtifact','Assert-RunnerCloudInitPreparationIdentity','Invoke-RunnerCloudInitPreparationCapture','Write-RunnerJson','Get-SshArgs','Get-RunnerGuestMtu','Get-RunnerGuestReadinessCommand','Get-RunnerGuestPrerequisites','Get-RunnerResourceProfile','Get-RunnerGuestReadinessStage','Assert-RunnerGuestReadinessDiagnostic','Add-RunnerGuestReadinessAttempt','Set-RunnerGuestReadinessEvidence')
$runner=$null
foreach ($file in @('Common.ps1','Runner.ps1')) {
    $errors=$null; $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file),[ref]$null,[ref]$errors)
    if ($errors.Count) { throw 'CLOUD_INIT_SOURCE_PARSE' }
    foreach ($node in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) { if ($node.Name -cin $functions) { Invoke-Expression $node.Extent.Text } }
    if ($file -ceq 'Runner.ps1') { $runner=$ast }
}
$script:checks=0; $script:RunnerRoot=Join-Path $env:TEMP ('ITIR-cloud-init-'+[guid]::NewGuid().ToString('N'))
$script:artifact=Join-Path $script:RunnerRoot 'preparation-cloud-init.json'
function Require([bool]$Condition) { $script:checks++; if (-not $Condition) { throw 'CLOUD_INIT_ASSERTION_FAILED' } }
function Refuses([scriptblock]$Work) { $refused=$false; try { & $Work } catch { $refused=$true }; Require $refused }
function Copy-Diagnostic($Value) { return ($Value | ConvertTo-Json -Depth 10 -Compress | ConvertFrom-Json) }
function New-Diagnostic {
    return [pscustomobject]@{schema=1;capture='complete';cloudInitExit=2;status='done';extendedStatus='degraded done';stages=@(@('top-level','init-local','init','modules-config','modules-final') | ForEach-Object { [pscustomobject]@{stage=$_;errorCount=0;recoverableCount=0} });reasons=@([pscustomobject]@{stage='modules-config';kind='recoverable';module='users-groups';exception='ProcessExecutionError';reason='Group already exists.';redacted=$false;truncated=$false});sshExit=0}
}
function To-Transport($Value) { $copy=Copy-Diagnostic $Value; $copy.PSObject.Properties.Remove('sshExit'); return [pscustomobject]@{ExitCode=0;Output=($copy | ConvertTo-Json -Depth 8 -Compress)} }
function Reset {
    $script:state=[pscustomobject]@{purpose='prepare';vmName='ITIR-11111111111111111111111111111111';vmId='22222222-2222-2222-2222-222222222222';instancePath=(Join-Path (Join-Path $script:RunnerRoot 'instances') 'ITIR-11111111111111111111111111111111');layoutVersion=2}
    [void][IO.Directory]::CreateDirectory($script:state.instancePath)
    [IO.File]::WriteAllText((Join-Path $script:state.instancePath 'known_hosts'),'') # Transport fixture's precreated file; no SSH runs.
    $script:auth=$true; $script:alive=0; $script:depth=0; $script:sshCalls=0; $script:changed=$false; $script:writeFails=$false; $script:transportThrows=$false; $script:reads=0; $script:publicationRace=$false; $script:transport=To-Transport (New-Diagnostic)
    if (Test-Path -LiteralPath $script:artifact) { Remove-Item -LiteralPath $script:artifact -Force }
}
function Assert-RunnerPreparationAuthorized { if (-not $script:auth) { throw 'PRIVATE_AUTH_FAILURE' } }
function Assert-SessionAlive { $script:alive++ }
function Enter-RunnerLock { $script:depth++; return 'fixture' }
function Exit-RunnerLock { $script:depth-- }
function Get-RunnerState { Require ($script:depth -gt 0); $script:reads++; if ($script:publicationRace -and $script:reads -eq 3) { $script:state | Add-Member runnerId 1 }; return $script:state }
function Assert-StateIdentity($State) { if ($null -eq $State) { throw 'PRIVATE_IDENTITY' } }
function Get-CoherentInstalledRunnerBundle { return [pscustomobject]@{hash=('A'*64)} }
function Assert-OwnedPath([string]$Path) { Require ($Path.StartsWith($script:RunnerRoot+'\',[StringComparison]::OrdinalIgnoreCase)); if ($script:writeFails -and $Path -ceq $script:artifact) { throw 'PRIVATE_WRITE' }; return $Path }
function Assert-RunnerProtectedPath([string]$Path) { Require ($script:depth -gt 0 -or $Path.StartsWith((Join-Path $script:RunnerRoot 'instances'))) }
function Invoke-RunnerReceiptNative($Executable,$Arguments) {
    $script:sshCalls++; Require ($Executable -ceq 'ssh.exe' -and $Arguments[-2] -ceq 'runner@192.0.2.1' -and $Arguments[-1].StartsWith("sudo -n timeout --signal=KILL 10s python3 -c 'import base64;"))
    if ($script:changed) { $script:state=Copy-Diagnostic $script:state; $script:state.vmId='33333333-3333-3333-3333-333333333333' }
    if ($script:transportThrows) { throw 'PRIVATE_STDERR' }
    return $script:transport
}
function Get-RunnerCloudInitInspector { return 'fixed inspector fixture' }
try {
    [void][IO.Directory]::CreateDirectory($script:RunnerRoot)
    if ($CapturedProjectionsPath) {
        foreach ($projection in ([IO.File]::ReadAllText($CapturedProjectionsPath) | ConvertFrom-Json)) {
            $captured=ConvertFrom-RunnerCloudInitCapture ([pscustomobject]@{ExitCode=0;Output=($projection | ConvertTo-Json -Depth 8 -Compress)})
            Require ($captured.capture -ceq $projection.capture)
            Assert-RunnerCloudInitDiagnostic $captured
        }
    }
    $valid=New-Diagnostic; Assert-RunnerCloudInitDiagnostic $valid; Require (Test-RunnerCloudInitTerminal $valid)
    $tail=Copy-Diagnostic $valid; $tail.status='error'; $tail.extendedStatus='error - done'; $tail.reasons[0].kind='error'; $tail.reasons[0].reason='DNS resolution failed.'; $tail.reasons[0].redacted=$true; $tail.reasons[0] | Add-Member source 'cloud-init-output-tail'
    Assert-RunnerCloudInitDiagnostic $tail
    Require ((ConvertFrom-RunnerCloudInitCapture (To-Transport $tail)).reasons[0].source -ceq 'cloud-init-output-tail')
    foreach ($source in @('PRIVATE_SOURCE','cloud-init-output.log',@('cloud-init-output-tail'),$null)) { $bad=Copy-Diagnostic $tail; $bad.reasons[0].source=$source; Refuses { Assert-RunnerCloudInitDiagnostic $bad } }
    foreach ($reason in @('reason-withheld','Package manager exited with an error.','Group already exists.')) { $bad=Copy-Diagnostic $tail; $bad.reasons[0].reason=$reason; Refuses { Assert-RunnerCloudInitDiagnostic $bad } }
    $bad=Copy-Diagnostic $tail; $bad.status='running'; Refuses { Assert-RunnerCloudInitDiagnostic $bad }
    $bad=Copy-Diagnostic $tail; $bad.reasons[0].kind='recoverable'; Refuses { Assert-RunnerCloudInitDiagnostic $bad }
    $bad=Copy-Diagnostic $tail; $bad.reasons[0].redacted=$false; Refuses { Assert-RunnerCloudInitDiagnostic $bad }
    foreach ($template in @('DNS resolution failed.','Network was unreachable.','Connection timed out.','Connection was refused.','Connection failed.','Package fetch failed.','Package manager exited with an error.','TLS validation or handshake failed.','Package repository signature verification failed.','Package repository Release file was unavailable.','Package hash verification failed.','Disk space was exhausted.','Package manager was interrupted.','Package dependencies could not be satisfied.')) {
        $value=Copy-Diagnostic $valid; $value.reasons[0].reason=$template
        Assert-RunnerCloudInitDiagnostic $value
        $captured=ConvertFrom-RunnerCloudInitCapture (To-Transport $value)
        Require ($captured.capture -ceq 'complete' -and $captured.reasons[0].reason -ceq $template)
        $value.reasons[0].reason=$template+"`nPRIVATE_SECRET hunter2"
        Refuses { Assert-RunnerCloudInitDiagnostic $value }
        $captured=ConvertFrom-RunnerCloudInitCapture (To-Transport $value)
        Require ($captured.capture -ceq 'unavailable')
    }
    foreach ($case in @(@{code=1;status='error';extended='error - done';terminal=$true},@{code=2;status='done';extended='degraded done';terminal=$true},@{code=0;status='done';extended='degraded done';terminal=$false},@{code=3;status='error';extended='error - done';terminal=$false},@{code=2;status='running';extended='degraded running';terminal=$false},@{code=1;status='error';extended='error - running';terminal=$false},@{code=1;status='error';extended='unknown';terminal=$false})) {
        $value=Copy-Diagnostic $valid; $value.cloudInitExit=$case.code; $value.status=$case.status; $value.extendedStatus=$case.extended
        Require ((Test-RunnerCloudInitTerminal $value) -eq $case.terminal)
    }
    foreach ($text in @('PRIVATE_RAW',('x'*4097),'{"schema":1}', '[]', 'null')) {
        $result=ConvertFrom-RunnerCloudInitCapture ([pscustomobject]@{ExitCode=0;Output=$text}); Require ($result.capture -ceq 'unavailable' -and -not (Test-RunnerCloudInitTerminal $result))
    }
    foreach ($exit in @($null,'0',@(0),255,-1073741515)) { $result=ConvertFrom-RunnerCloudInitCapture ([pscustomobject]@{ExitCode=$exit;Output='PRIVATE_RAW'}); Require ($result.capture -ceq 'unavailable') }
    foreach ($field in @('schema','capture','cloudInitExit','status','extendedStatus','sshExit')) {
        $bad=Copy-Diagnostic $valid; $bad.$field=@($bad.$field); Refuses { Assert-RunnerCloudInitDiagnostic $bad }
    }
    foreach ($field in @('stages','reasons')) { $bad=Copy-Diagnostic $valid; $bad.$field='PRIVATE'; Refuses { Assert-RunnerCloudInitDiagnostic $bad } }
    foreach ($text in @('Error PRIVATE_UNKNOWN_CONTENT','Failed running command echo hunter2','Group already exists. PRIVATE_TAIL','failed token=PRIVATE','failed https://user:PRIVATE@host/x','failed /PRIVATE/file','failed C:\PRIVATE','failed 192.0.2.1','failed a@b.example','Authorization PRIVATE','PRIVATE_WITHOUT_REASON',"failed`nPRIVATE",'failed 2001:db8::1')) {
        $bad=Copy-Diagnostic $valid; $bad.reasons[0].reason=$text; Refuses { Assert-RunnerCloudInitDiagnostic $bad }
        $result=ConvertFrom-RunnerCloudInitCapture (To-Transport $bad); Require ($result.capture -ceq 'unavailable')
    }
    $bad=Copy-Diagnostic $valid; $bad.reasons[0].PSObject.Properties.Remove('reason'); $script:getter=$false; $bad.reasons[0] | Add-Member ScriptProperty reason { $script:getter=$true; throw 'PRIVATE_GETTER' }; Refuses { Assert-RunnerCloudInitDiagnostic $bad }; Require (-not $script:getter)
    $bad=Copy-Diagnostic $valid; $bad | Add-Member private 'PRIVATE'; Refuses { Assert-RunnerCloudInitDiagnostic $bad }
    $bad=Copy-Diagnostic $valid; $bad.stages[0].errorCount=1025; Refuses { Assert-RunnerCloudInitDiagnostic $bad }
    $bad=Copy-Diagnostic $valid; $bad.reasons=@($bad.reasons[0])*9; Refuses { Assert-RunnerCloudInitDiagnostic $bad }
    Reset; $frozen=Copy-Diagnostic $script:state
    Require (Invoke-RunnerCloudInitPreparationCapture $frozen ([pscustomobject]@{guestIp='192.0.2.1'}))
    Require ($script:sshCalls -eq 1 -and $script:alive -eq 2 -and $script:depth -eq 0)
    $storedArtifact=[IO.File]::ReadAllText($script:artifact) | ConvertFrom-Json; Assert-RunnerCloudInitArtifact $storedArtifact
    Require ($storedArtifact.sessionId -ceq $frozen.vmName.Substring(5) -and $storedArtifact.vmId -ceq $frozen.vmId -and $storedArtifact.bundleHash -ceq ('A'*64) -and (Get-Item -LiteralPath $script:artifact).Length -le 8192)
    # Actual atomic replacement retains one latest attributable artifact.
    $script:state.vmName='ITIR-44444444444444444444444444444444'; $script:state.instancePath=Join-Path (Join-Path $script:RunnerRoot 'instances') $script:state.vmName; $frozen=Copy-Diagnostic $script:state
    [void][IO.Directory]::CreateDirectory($script:state.instancePath)
    [IO.File]::WriteAllText((Join-Path $script:state.instancePath 'known_hosts'),'')
    Require (Invoke-RunnerCloudInitPreparationCapture $frozen ([pscustomobject]@{guestIp='192.0.2.1'}))
    Require (([IO.File]::ReadAllText($script:artifact) | ConvertFrom-Json).sessionId -ceq ('4'*32))
    $children=@(Get-ChildItem -LiteralPath $script:RunnerRoot)
    Require ($children.Count -eq 2 -and @($children|Where-Object{$_.Name -cnotin @('instances','preparation-cloud-init.json')}).Count -eq 0)
    foreach ($case in @('job','verify-image','unauthorized','changed','imageCandidate','runnerLaunch','runnerId','claimMode','pilotClaim')) {
        Reset
        if ($case -cin @('job','verify-image')) { $script:state.purpose=$case }
        elseif ($case -ceq 'unauthorized') { $script:auth=$false }
        elseif ($case -ceq 'changed') { $script:changed=$true }
        else { $script:state | Add-Member NoteProperty $case ([pscustomobject]@{}) }
        Require (-not (Invoke-RunnerCloudInitPreparationCapture (Copy-Diagnostic $script:state) ([pscustomobject]@{guestIp='192.0.2.1'})))
        Require (-not (Test-Path -LiteralPath $script:artifact) -and $script:depth -eq 0)
        Require ($script:sshCalls -eq $(if ($case -ceq 'changed') { 1 } else { 0 }))
    }
    Reset; $script:writeFails=$true; Require (Invoke-RunnerCloudInitPreparationCapture (Copy-Diagnostic $script:state) ([pscustomobject]@{guestIp='192.0.2.1'})); Require (-not (Test-Path -LiteralPath $script:artifact) -and $script:depth -eq 0)
    Reset; $script:publicationRace=$true; Require (Invoke-RunnerCloudInitPreparationCapture (Copy-Diagnostic $script:state) ([pscustomobject]@{guestIp='192.0.2.1'})); Require (-not (Test-Path -LiteralPath $script:artifact) -and $script:reads -eq 3 -and $script:depth -eq 0)
    Reset; $script:transportThrows=$true; Require (-not (Invoke-RunnerCloudInitPreparationCapture (Copy-Diagnostic $script:state) ([pscustomobject]@{guestIp='192.0.2.1'}))); Require (([IO.File]::ReadAllText($script:artifact) | ConvertFrom-Json).diagnostic.capture -ceq 'unavailable')
    $wait=$runner.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Wait-Guest'},$false).Extent.Text.Replace('[DateTime]::UtcNow','(Get-FixtureClock)')
    foreach ($case in @(@{purpose='prepare';codes=@(72,72,0);terminal=$false;captures=1;calls=3},@{purpose='prepare';codes=@(72,0);terminal=$true;captures=1;calls=1},@{purpose='job';codes=@(72,0);terminal=$true;captures=0;calls=2},@{purpose='verify-image';codes=@(72,0);terminal=$true;captures=0;calls=2},@{purpose='prepare';codes=@(255,71,0);terminal=$true;captures=0;calls=3})) {
        $script:case=$case; $script:captures=0; $script:attempts=0; $script:now=[DateTime]::UtcNow; $script:failure=$null
        & {
            Invoke-Expression $wait
            function Get-FixtureClock { return $script:now }
            function Assert-SessionAlive {}
            function Invoke-RunnerNative { $value=$script:case.codes[$script:attempts]; $script:attempts++; return $value }
            function Invoke-RunnerCloudInitPreparationCapture { $script:captures++; return $script:case.terminal }
            function Start-Sleep([int]$Seconds) { Require ($Seconds -eq 10); $script:now=$script:now.AddSeconds(10) }
            try { $script:readyMtu=Wait-Guest ([pscustomobject]@{purpose=$script:case.purpose;vmName='ITIR-11111111111111111111111111111111';layoutVersion=2;instancePath=(Join-Path (Join-Path $script:RunnerRoot 'instances') 'ITIR-11111111111111111111111111111111')}) ([pscustomobject]@{guestIp='192.0.2.1'}) 'it-inventory-heavy' } catch { $script:failure=$_ }
        }
        Require ($script:captures -eq $case.captures -and $script:attempts -eq $case.calls)
        if ($case.purpose -ceq 'prepare' -and $case.terminal -and $case.captures -eq 1) { Require ($null -ne $script:failure -and $script:failure.Exception.Data['runnerGuestReadiness'].lastNativeExit -eq 72) }
        else { Require ($null -eq $script:failure -and $script:readyMtu -is [int] -and $script:readyMtu -eq 1400) }
    }
    Write-Host "PASS cloud-init diagnostic $script:checks assertions"
} finally {
    if (Test-Path -LiteralPath $script:RunnerRoot) { Remove-Item -LiteralPath $script:RunnerRoot -Recurse -Force }
}
