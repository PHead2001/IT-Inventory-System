Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RunnerRoot = Join-Path $env:ProgramData 'ITInventoryLocalRunner'
$script:RunnerTag = 'it-inventory-local-runner-v1'
$script:RunnerPrefix = 'ITIR-'
$script:RunnerSwitch = 'ITIR-Isolated'
$script:RunnerNat = 'ITIR-Nat'
$script:RunnerTask = 'ITInventoryLocalRunner-Watchdog'
$script:RunnerSupervisorTask = 'ITInventoryLocalRunner-Supervisor'
$script:RunnerConfigPath = Join-Path $script:RunnerRoot 'config.json'
$script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
$script:RunnerOperationStage = 'idle'
$script:RunnerSessionName = $null
$script:RunnerPreparationAuthorized = $false

function Initialize-RunnerDpapi {
    # Fresh Windows PowerShell 5.1 sessions do not preload ProtectedData.
    # Fail before a secure prompt/read if its framework assembly is unavailable.
    Add-Type -AssemblyName System.Security -ErrorAction Stop
}

function Write-RunnerFailure([string] $Stage, [ValidateSet('STAGE_FAILED', 'NETWORK_CHANGED', 'NETWORK_INSPECTION_FAILED', 'RECOVERY_FAILED', 'OWNER_EXITED', 'DEADLINE_REACHED')][string] $Code, [string] $SessionName = '') {
    Write-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json') ([ordered]@{
        atUtc = [DateTime]::UtcNow.ToString('o'); stage = $Stage; code = $Code; sessionName = $SessionName
    })
}

# Failure-only projection. Never serialize a state, exception, message or path.
# Every observation consumes the already evaluated guard result, not a reread.
function Get-RunnerRecoveryDiagnosticNumber($Value, [long] $Maximum = 86400000, [switch] $Signed) {
    if ($Value -isnot [ValueType] -or $Value -is [bool] -or [double]::IsNaN([double]$Value) -or [double]::IsInfinity([double]$Value) -or
        $Value -ne [Math]::Truncate([double]$Value) -or $Value -gt $Maximum -or $Value -lt $(if ($Signed) { -$Maximum } else { 0 })) { throw 'Invalid recovery diagnostic number.' }
    return [long]$Value
}

function Assert-RunnerRecoveryDiagnostic($Diagnostic) {
    $enums = @{
        operation = @('', 'quarantine', 'apply', 'connect', 'resume', 'probe', 'other')
        trigger = @('', 'observation-unavailable', 'fingerprint-change', 'connectivity-lost', 'other')
        lastTransition = @('healthy', 'quarantining', 'isolated', 'applying', 'verified', 'connecting', 'resuming', 'probing', 'failed', 'sealed-preparation', 'other')
        refusal = @('', 'stale-observation', 'dispatch-deadline', 'provider-uncertain', 'operation-uncertain', 'stop', 'owner-dead', 'identity-changed', 'hard-deadline', 'outage-deadline', 'guardian-progress-expired', 'clock-regressed', 'vm-state-uncertain', 'connectivity-state-uncertain', 'watchdog-expired', 'other')
    }
    $numbers = @('generation', 'episodeAgeMs', 'episodeRemainingMs', 'operationAgeMs', 'observationUnavailableCount', 'fingerprintChangeCount', 'staleAdmissionCount', 'applyCount', 'observationElapsedMs', 'preflightElapsedMs', 'applyElapsedMs')
    # Prior protected cleanup journals remain readable. New projections add only
    # these fixed optional diagnostics; unknown fields remain invalid.
    if ($Diagnostic -is [pscustomobject]) {
        if ($Diagnostic.PSObject.Properties.Name -contains 'admissionOperation') { $enums.admissionOperation = @('', 'connect', 'resume', 'other') }
        foreach ($name in @('observationAgeMs', 'quarantineElapsedMs', 'connectElapsedMs', 'resumeElapsedMs')) {
            if ($Diagnostic.PSObject.Properties.Name -contains $name) { $numbers += $name }
        }
    }
    if ($Diagnostic -isnot [pscustomobject] -or (@($Diagnostic.PSObject.Properties.Name | Sort-Object) -join ',') -cne (@(@($enums.Keys) + $numbers | Sort-Object) -join ',')) { throw 'Invalid recovery diagnostic fields.' }
    foreach ($name in $enums.Keys) {
        if ($Diagnostic.$name -isnot [string] -or $Diagnostic.$name -cnotin $enums[$name]) { throw 'Invalid recovery diagnostic enum.' }
    }
    foreach ($name in $numbers) {
        $max = if ($name -ceq 'generation') { 2147483647 } elseif ($name -clike '*Count') { 1000000 } else { 86400000 }
        [void](Get-RunnerRecoveryDiagnosticNumber $Diagnostic.$name $max -Signed:($name -cin @('episodeRemainingMs', 'observationAgeMs')))
    }
}

function New-RunnerRecoveryDiagnostic($Recovery, [DateTime] $NowUtc) {
    $phases = @('healthy', 'quarantining', 'isolated', 'applying', 'verified', 'connecting', 'resuming', 'probing', 'failed', 'sealed-preparation')
    $value = [ordered]@{
        operation = ''; trigger = ''; lastTransition = 'other'; refusal = ''
        generation = if ($Recovery.PSObject.Properties.Name -contains 'generation') { Get-RunnerRecoveryDiagnosticNumber $Recovery.generation 2147483647 } else { 0 }
        episodeAgeMs = 0; episodeRemainingMs = 0; operationAgeMs = 0
        observationUnavailableCount = 0; fingerprintChangeCount = 0; staleAdmissionCount = 0; applyCount = 0
        observationElapsedMs = 0; preflightElapsedMs = 0; applyElapsedMs = 0
        admissionOperation = ''; observationAgeMs = 0; quarantineElapsedMs = 0; connectElapsedMs = 0; resumeElapsedMs = 0
    }
    if ($Recovery.PSObject.Properties.Name -contains 'operation') { $value.operation = if ($Recovery.operation -cin @('', 'quarantine', 'apply', 'connect', 'resume', 'probe')) { $Recovery.operation } else { 'other' } }
    if ($Recovery.PSObject.Properties.Name -contains 'diagnostics') {
        $d = $Recovery.diagnostics
        foreach ($name in @('observationUnavailableCount', 'fingerprintChangeCount', 'staleAdmissionCount', 'applyCount', 'observationElapsedMs', 'preflightElapsedMs', 'applyElapsedMs')) {
            $value[$name] = Get-RunnerRecoveryDiagnosticNumber $d.$name $(if ($name -clike '*Count') { 1000000 } else { 86400000 })
        }
        foreach ($name in @('observationAgeMs', 'quarantineElapsedMs', 'connectElapsedMs', 'resumeElapsedMs')) {
            if ($d.PSObject.Properties.Name -contains $name) { $value[$name] = Get-RunnerRecoveryDiagnosticNumber $d.$name 86400000 -Signed:($name -ceq 'observationAgeMs') }
        }
        if ($d.PSObject.Properties.Name -contains 'admissionOperation') { $value.admissionOperation = if ($d.admissionOperation -cin @('', 'connect', 'resume')) { $d.admissionOperation } else { 'other' } }
        $value.trigger = if ($d.trigger -cin @('', 'observation-unavailable', 'fingerprint-change', 'connectivity-lost')) { $d.trigger } else { 'other' }
        $value.lastTransition = if ($d.lastTransition -cin $phases) { $d.lastTransition } else { 'other' }
        $refusals = @('', 'stale-observation', 'dispatch-deadline', 'provider-uncertain', 'operation-uncertain', 'stop', 'owner-dead', 'identity-changed', 'hard-deadline', 'outage-deadline', 'guardian-progress-expired', 'clock-regressed', 'vm-state-uncertain', 'connectivity-state-uncertain', 'watchdog-expired')
        $value.refusal = if ($d.refusal -cin $refusals) { $d.refusal } else { 'other' }
        if ($Recovery.phase -ceq 'failed' -and -not $Recovery.operation) {
            $value.operation = if ($d.operation -cin @('', 'quarantine', 'apply', 'connect', 'resume', 'probe')) { $d.operation } else { 'other' }
        }
    }
    foreach ($pair in @(@('episodeStartedUtc', 'episodeAgeMs'), @('operationStartedUtc', 'operationAgeMs'), @('episodeDeadlineUtc', 'episodeRemainingMs'))) {
        $stamp = if ($Recovery.PSObject.Properties.Name -contains $pair[0]) { $Recovery.($pair[0]) } else { '' }
        if ($pair[0] -ceq 'operationStartedUtc' -and $Recovery.phase -ceq 'failed' -and -not $stamp -and $Recovery.PSObject.Properties.Name -contains 'diagnostics') { $stamp = $Recovery.diagnostics.operationStartedUtc }
        if ($pair[0] -ceq 'operationStartedUtc' -and -not $value.operation) { $stamp = '' }
        if ($stamp) {
            $elapsed = ($NowUtc - [DateTime]::Parse($stamp).ToUniversalTime()).TotalMilliseconds
            if ($pair[1] -ceq 'episodeRemainingMs') { $elapsed = -$elapsed } else { $elapsed = [Math]::Max(0, $elapsed) }
            $value[$pair[1]] = [long][Math]::Truncate([Math]::Max(-86400000, [Math]::Min(86400000, $elapsed)))
        }
    }
    $result = [pscustomobject]$value
    Assert-RunnerRecoveryDiagnostic $result
    return $result
}

function New-RunnerFailureObservation([string] $Origin, [string] $Reason, $State, [DateTime] $NowUtc,
    [string] $StopReason = '', [string] $Expiry = '', [hashtable] $Checks = @{}) {
    $record = [ordered]@{ schema = 1; capture = 'complete' }
    try {
        $origins = @('session-initial', 'session-current', 'session-guardian', 'guardian-catch', 'watchdog', 'recovery-plan', 'recovery-dispatch')
        $reasons = @('deadline', 'stop', 'guardian-identity', 'guardian-failed', 'recovery-expiry', 'guard-exception', 'watchdog-condition', 'recovery-cleanup', 'dispatch-deadline', 'provider-uncertain')
        $stops = @('', 'none', 'instance-marker', 'state-absent', 'claim-mismatch', 'purpose-ineligible', 'unavailable')
        $expiries = @('', 'hard-deadline', 'outage-deadline', 'guardian-progress-expired')
        $record.origin = if ($Origin -cin $origins) { $Origin } else { 'other' }
        $record.reason = if ($Reason -cin $reasons) { $Reason } else { 'other' }
        $record.stopReason = if ($StopReason -cin $stops) { $StopReason } else { 'other' }
        $record.expiry = if ($Expiry -cin $expiries) { $Expiry } else { 'other' }
        $record.atUtc = $NowUtc.ToUniversalTime().ToString('o')
        $record.statePresent = $null -ne $State
        $record.checks = [ordered]@{}
        foreach ($name in @('deadlineReached', 'ownerAlive', 'guardianAlive', 'guardianRecorded', 'guardianDead', 'recoveryExpired', 'sealedInvalid')) {
            if ($Checks.ContainsKey($name)) {
                if ($Checks[$name] -isnot [bool]) { throw 'Invalid diagnostic flag.' }
                $record.checks[$name] = $Checks[$name]
            }
        }
        if ($null -ne $State) {
            $record.purpose = if ($State.PSObject.Properties.Name -contains 'purpose' -and $State.purpose -cin @('job', 'prepare', 'verify-image')) { $State.purpose } else { 'other' }
            $record.phase = if ($State.PSObject.Properties.Name -notcontains 'phase') { 'initial' } elseif ($State.phase -cin @('creating', 'owned', 'sealed-off')) { $State.phase } else { 'other' }
            if ($State.PSObject.Properties.Name -contains 'deadlineUtc') {
                $record.deadlineRemainingMs = ($([DateTime]::Parse($State.deadlineUtc).ToUniversalTime()) - $NowUtc).TotalMilliseconds
            }
            if ($State.PSObject.Properties.Name -contains 'networkRecovery') {
                $r = $State.networkRecovery
                $record.recoveryPhase = if ($r.phase -cin @('healthy', 'quarantining', 'isolated', 'applying', 'verified', 'connecting', 'resuming', 'probing', 'failed', 'sealed-preparation')) { $r.phase } else { 'other' }
                $record.progressAgeMs = ($NowUtc - [DateTime]::Parse($r.progressUtc).ToUniversalTime()).TotalMilliseconds
                $record.failureSet = $false; $record.recoveryFailure = ''
                if ($r.PSObject.Properties.Name -contains 'failure') {
                    $record.failureSet = -not [string]::IsNullOrEmpty([string]$r.failure)
                    $record.recoveryFailure = if ($r.failure -cin @('', 'stop', 'owner-dead', 'identity-changed', 'hard-deadline', 'outage-deadline', 'guardian-progress-expired', 'clock-regressed', 'vm-state-uncertain', 'connectivity-state-uncertain', 'operation-uncertain', 'dispatch-deadline', 'provider-uncertain', 'watchdog-expired')) { $r.failure } else { 'other' }
                }
                $record.recoveryDiagnostic = New-RunnerRecoveryDiagnostic $r $NowUtc
            }
        }
        if ([Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $record -Depth 4 -Compress)) -gt 2048) { throw 'Diagnostic bound.' }
        return $record
    } catch {
        return [ordered]@{ schema = 1; capture = 'unavailable'; atUtc = $NowUtc.ToUniversalTime().ToString('o') }
    }
}

function New-RunnerObservedFailure([string] $Message, $Observation) {
    $failure = [Management.Automation.RuntimeException]::new($Message)
    try { $failure.Data['runnerFailureObservation'] = $Observation }
    catch { $failure.Data['runnerFailureCapture'] = 'unavailable' }
    return $failure
}

function Assert-RunnerFailureRecord($Record) {
    $enums = @{
        capture = @('complete', 'unavailable')
        origin = @('session-initial', 'session-current', 'session-guardian', 'guardian-catch', 'watchdog', 'recovery-plan', 'recovery-dispatch', 'other')
        reason = @('deadline', 'stop', 'guardian-identity', 'guardian-failed', 'recovery-expiry', 'guard-exception', 'watchdog-condition', 'recovery-cleanup', 'dispatch-deadline', 'provider-uncertain', 'other')
        stopReason = @('', 'none', 'instance-marker', 'state-absent', 'claim-mismatch', 'purpose-ineligible', 'unavailable', 'other')
        expiry = @('', 'hard-deadline', 'outage-deadline', 'guardian-progress-expired', 'other')
        purpose = @('job', 'prepare', 'verify-image', 'other')
        phase = @('initial', 'creating', 'owned', 'sealed-off', 'other')
        recoveryPhase = @('healthy', 'quarantining', 'isolated', 'applying', 'verified', 'connecting', 'resuming', 'probing', 'failed', 'sealed-preparation', 'other')
        recoveryFailure = @('', 'stop', 'owner-dead', 'identity-changed', 'hard-deadline', 'outage-deadline', 'guardian-progress-expired', 'clock-regressed', 'vm-state-uncertain', 'connectivity-state-uncertain', 'operation-uncertain', 'dispatch-deadline', 'provider-uncertain', 'watchdog-expired', 'other')
        errorSource = @('Runner.ps1', 'Common.ps1', 'Network.Recovery.ps1', 'Network.Recovery.Probe.ps1', 'other')
    }
    if ($Record -isnot [pscustomobject] -or $Record.schema -isnot [int] -or $Record.schema -ne 1 -or $Record.capture -cnotin $enums.capture -or
        [DateTime]::Parse($Record.atUtc).ToUniversalTime().ToString('o') -cne $Record.atUtc) { throw 'Invalid diagnostic record.' }
    if ($Record.capture -ceq 'unavailable') {
        if ((@($Record.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'atUtc,capture,schema') { throw 'Invalid unavailable capture.' }
    } else {
        foreach ($required in @('origin', 'reason', 'stopReason', 'expiry', 'statePresent', 'checks')) {
            if ($Record.PSObject.Properties.Name -cnotcontains $required) { throw 'Incomplete diagnostic record.' }
        }
    }
    foreach ($property in $Record.PSObject.Properties) {
        $name = $property.Name; $value = $property.Value
        if ($enums.ContainsKey($name)) { if ($value -isnot [string] -or $value -cnotin $enums[$name]) { throw 'Invalid diagnostic enum.' }; continue }
        switch -CaseSensitive ($name) {
            'schema' { if ($value -ne 1) { throw 'Invalid diagnostic schema.' } }
            'atUtc' { }
            'statePresent' { if ($value -isnot [bool]) { throw 'Invalid diagnostic flag.' } }
            'failureSet' { if ($value -isnot [bool]) { throw 'Invalid diagnostic flag.' } }
            'recoveryDiagnostic' { Assert-RunnerRecoveryDiagnostic $value }
            'checks' {
                if ($value -isnot [pscustomobject]) { throw 'Invalid diagnostic checks.' }
                foreach ($flag in $value.PSObject.Properties) {
                    if ($flag.Name -cnotin @('deadlineReached', 'ownerAlive', 'guardianAlive', 'guardianRecorded', 'guardianDead', 'recoveryExpired', 'sealedInvalid') -or $flag.Value -isnot [bool]) { throw 'Invalid diagnostic check.' }
                }
            }
            { $_ -cin @('deadlineRemainingMs', 'progressAgeMs', 'errorLine') } {
                if ($value -isnot [ValueType] -or $value -is [bool] -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)) { throw 'Invalid diagnostic number.' }
                if ($name -ceq 'errorLine' -and ($value -lt 0 -or $value -gt 100000 -or $value -ne [Math]::Truncate($value))) { throw 'Invalid diagnostic line.' }
            }
            default { throw 'Unknown diagnostic field.' }
        }
    }
    if ($Record.PSObject.Properties.Name -contains 'failureSet' -and
        ($Record.PSObject.Properties.Name -notcontains 'recoveryFailure' -or $Record.failureSet -ne (-not [string]::IsNullOrEmpty($Record.recoveryFailure)))) { throw 'Inconsistent recovery failure evidence.' }
}

function Assert-RunnerCleanupJournal($Journal) {
    if ($Journal -isnot [pscustomobject] -or $Journal.schema -isnot [int] -or $Journal.schema -notin @(2, 3) -or
        (@($Journal.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'first,identity,latest,schema' -or
        $Journal.identity -isnot [pscustomobject] -or $Journal.identity.sessionId -isnot [string] -or
        $Journal.identity.sessionId -cnotmatch '^[0-9a-f]{32}$' -or $Journal.identity.ownerStartedUtc -isnot [string] -or
        [DateTime]::Parse($Journal.identity.ownerStartedUtc).ToUniversalTime().ToString('o') -cne $Journal.identity.ownerStartedUtc) { throw 'Invalid diagnostic journal.' }
    $identityFields = if ($Journal.schema -eq 2) { 'ownerStartedUtc,sessionId,vmId' } else { 'ownerStartedUtc,phase,sessionId,vmId' }
    if ((@($Journal.identity.PSObject.Properties.Name | Sort-Object) -join ',') -cne $identityFields) { throw 'Invalid diagnostic journal identity.' }
    if ($Journal.schema -eq 3 -and ($Journal.identity.phase -isnot [string] -or $Journal.identity.phase -cnotin @('initial', 'creating', 'owned', 'sealed-off'))) { throw 'Invalid diagnostic identity phase.' }
    if ($null -eq $Journal.identity.vmId) {
        if ($Journal.schema -ne 3 -or $Journal.identity.phase -cnotin @('initial', 'creating')) { throw 'Unrecorded diagnostic VM ID is not eligible.' }
    } elseif ($Journal.identity.vmId -isnot [string] -or $Journal.identity.vmId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or [guid]$Journal.identity.vmId -eq [guid]::Empty) { throw 'Invalid diagnostic VM ID.' }
    Assert-RunnerFailureRecord $Journal.first
    Assert-RunnerFailureRecord $Journal.latest
    if ([Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $Journal -Depth 6 -Compress)) -gt 4096) { throw 'Diagnostic journal bound.' }
}

function Write-RunnerCleanupObservation([string] $Origin, [string] $Reason, $State, [DateTime] $NowUtc,
    [string] $StopReason = '', [string] $Expiry = '', [hashtable] $Checks = @{}, $Failure = $null, $CapturedRecord = $null) {
    # Callers hold the existing state mutex. Preserve the first decision for the
    # exact instance; later cleanup failures/retries replace only latest.
    try {
        $record = New-RunnerFailureObservation $Origin $Reason $State $NowUtc $StopReason $Expiry $Checks
        if ($null -ne $CapturedRecord) {
            $captured = ConvertTo-Json -InputObject $CapturedRecord -Depth 4 -Compress | ConvertFrom-Json
            Assert-RunnerFailureRecord $captured
            $record = [ordered]@{}
            foreach ($property in $captured.PSObject.Properties) { $record[$property.Name] = $property.Value }
        }
        $record.atUtc = $NowUtc.ToUniversalTime().ToString('o')
        if ($null -ne $Failure -and $record.capture -ceq 'complete') {
            $source = [IO.Path]::GetFileName($Failure.InvocationInfo.ScriptName)
            $record.errorSource = if ($source -cin @('Runner.ps1', 'Common.ps1', 'Network.Recovery.ps1', 'Network.Recovery.Probe.ps1')) { $source } else { 'other' }
            $record.errorLine = [Math]::Max(0, [Math]::Min(100000, [int]$Failure.InvocationInfo.ScriptLineNumber))
        }
        if ([Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $record -Depth 4 -Compress)) -gt 2048) { throw 'Diagnostic bound.' }
        Assert-SecureRoot
        $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'failure-cleanup.json')
        Assert-StateIdentity $State
        if ($State.vmName -cnotmatch '^ITIR-[0-9a-f]{32}$') { throw 'Invalid diagnostic instance.' }
        $phase = if ($State.PSObject.Properties.Name -notcontains 'phase') { 'initial' } elseif ($State.phase -cin @('creating', 'owned', 'sealed-off')) { $State.phase } else { throw 'Invalid diagnostic state phase.' }
        $vmId = $null
        if ($State.PSObject.Properties.Name -contains 'vmId') {
            if ([string]$State.vmId -cnotmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or [guid]$State.vmId -eq [guid]::Empty) { throw 'Invalid recorded diagnostic VM ID.' }
            $vmId = ([guid]$State.vmId).ToString()
        } elseif ($phase -cnotin @('initial', 'creating')) { throw 'Owned diagnostic state requires its recorded VM ID.' }
        # Null means the GUID was not recorded yet, never authoritative VM absence.
        $identity = [ordered]@{ sessionId = $State.vmName.Substring(5); vmId = $vmId; ownerStartedUtc = [DateTime]::Parse($State.supervisorStartUtc).ToUniversalTime().ToString('o'); phase = $phase }
        $journal = [ordered]@{ schema = 3; identity = $identity; first = $record; latest = $record }
        if (Test-Path -LiteralPath $path) {
            Assert-RunnerProtectedPath $path
            $existing = Read-RunnerJson $path
            Assert-RunnerCleanupJournal $existing
            if ($existing.identity.sessionId -ceq $identity.sessionId -and $existing.identity.ownerStartedUtc -ceq $identity.ownerStartedUtc) {
                if ($null -ne $existing.identity.vmId -and $null -eq $identity.vmId) { throw 'Diagnostic VM identity may not be downgraded.' }
                if ($null -eq $existing.identity.vmId -or $existing.identity.vmId -ceq $identity.vmId) { $journal.first = $existing.first }
            }
        }
        # Roundtrip to validate exactly the JSON property representation read by
        # the helper, including an unavailable capture's attribution envelope.
        $validated = ConvertTo-Json -InputObject $journal -Depth 6 -Compress | ConvertFrom-Json
        Assert-RunnerCleanupJournal $validated
        Write-RunnerJson $path $journal
        Assert-RunnerProtectedPath $path
    } catch {
        try { Write-Warning 'RUNNER_FAILURE_CAPTURE_UNAVAILABLE' -WarningAction Continue } catch { }
    }
}

function Write-RunnerSessionFailureObservation($State, $Failure) {
    # Only an observed failure from this invocation is eligible; healthy cleanup
    # never creates evidence. Capture errors must not mask the initiating error.
    try {
        if ($null -eq $Failure) { return }
        $record = $Failure.Exception.Data['runnerFailureObservation']
        if ($null -eq $record) { return }
        $captured = ConvertTo-Json -InputObject $record -Depth 4 -Compress | ConvertFrom-Json
        Assert-RunnerFailureRecord $captured
        Write-RunnerCleanupObservation '' '' $State ([DateTime]::Parse($captured.atUtc)) -CapturedRecord $captured
    } catch {
        try { Write-Warning 'RUNNER_FAILURE_CAPTURE_UNAVAILABLE' -WarningAction Continue } catch { }
    }
}

function New-RunnerExecutionFailure([ValidateSet('runner-exit')][string] $Class, [int] $ExitCode = 0) {
    # Only these trusted call sites tag a failure. No guest text is accepted.
    $failure = [Management.Automation.RuntimeException]::new('Runner execution failed; consult the bounded session failure record.')
    $failure.Data['runnerFailureClass'] = $Class
    if ($Class -ceq 'runner-exit') { $failure.Data['runnerFailureExitCode'] = $ExitCode }
    return $failure
}

function Get-RunnerSessionFailureEnums {
    return @{
        stage = @('idle', 'preflight', 'disk-copy', 'disk-clone', 'key-generation', 'vm-creation', 'vm-configuration', 'network-isolation', 'vm-boot', 'guest-readiness', 'image-clone-readiness', 'image-preparation', 'runner-download', 'runner-transfer', 'jit-registration', 'job-execution', 'memory-admission', 'queue-inspection', 'pilot-consumption', 'pilot-verification', 'cleanup', 'other')
        source = @('Runner.ps1', 'Common.ps1', 'PreparedImage.ps1', 'Network.Recovery.ps1', 'Network.Recovery.Probe.ps1', 'other')
        exceptionType = @('System.Management.Automation.RuntimeException', 'System.Management.Automation.CmdletInvocationException', 'System.Management.Automation.CommandNotFoundException', 'System.Management.Automation.ParameterBindingException', 'System.InvalidOperationException', 'System.IO.IOException', 'System.UnauthorizedAccessException', 'System.TimeoutException', 'System.ArgumentException', 'other')
        category = @('NotSpecified', 'InvalidData', 'InvalidOperation', 'InvalidArgument', 'ObjectNotFound', 'PermissionDenied', 'ResourceUnavailable', 'OperationTimeout', 'ReadError', 'WriteError', 'ParserError', 'SecurityError', 'ConnectionError', 'LimitsExceeded', 'other')
        errorId = @('RuntimeException', 'CommandNotFoundException', 'ParameterBindingException', 'PositionalParameterNotFound', 'NativeCommandError', 'other')
        failureClass = @('receipt-invalid', 'runner-exit', 'other')
        capture = @('complete', 'unavailable')
    }
}

function New-RunnerSessionFailureRecord($Failure, [string] $Stage) {
    $enums = Get-RunnerSessionFailureEnums
    $record = [ordered]@{ atUtc = [DateTime]::UtcNow.ToString('o'); stage = 'other'; capture = 'unavailable'; source = 'other'; line = 0; exceptionType = 'other'; hResult = 0; category = 'other'; errorId = 'other'; failureClass = 'other'; exitCode = $null }
    if ($Stage -cin $enums.stage) { $record.stage = $Stage }
    try {
        if ($Failure -isnot [Management.Automation.ErrorRecord] -or $null -eq $Failure.Exception -or $null -eq $Failure.InvocationInfo) { return $record }
        $source = [IO.Path]::GetFileName($Failure.InvocationInfo.ScriptName)
        if ($source -cin $enums.source) { $record.source = $source }
        $record.line = [Math]::Max(0, [Math]::Min(100000, $Failure.InvocationInfo.ScriptLineNumber))
        $type = $Failure.Exception.GetType().FullName
        if ($type -cin $enums.exceptionType) { $record.exceptionType = $type }
        $record.hResult = [int]$Failure.Exception.HResult
        $category = $Failure.CategoryInfo.Category.ToString()
        if ($category -cin $enums.category) { $record.category = $category }
        if ($Failure.FullyQualifiedErrorId -cin $enums.errorId) { $record.errorId = $Failure.FullyQualifiedErrorId }
        # Read only fixed scalar tags, never serialize the Data dictionary.
        $class = $Failure.Exception.Data['runnerFailureClass']
        if ($class -is [string] -and $class -cin @('receipt-invalid', 'runner-exit')) {
            $record.failureClass = $class
            $exit = $Failure.Exception.Data['runnerFailureExitCode']
            if ($class -ceq 'runner-exit' -and $exit -is [int]) { $record.exitCode = $exit }
        }
        $record.capture = 'complete'
    } catch { $record.capture = 'unavailable' }
    return $record
}

function Assert-RunnerSessionFailureJournal($Journal) {
    if ($Journal -isnot [pscustomobject] -or (@($Journal.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'schema,sessions' -or
        $Journal.schema -isnot [int] -or $Journal.schema -ne 1 -or $Journal.sessions -isnot [array] -or $Journal.sessions.Count -gt 8) { throw 'Invalid session failure journal.' }
    $enums = Get-RunnerSessionFailureEnums; $seen = @{}
    foreach ($session in $Journal.sessions) {
        if ($session -isnot [pscustomobject] -or (@($session.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'first,latest,sessionId,vmId' -or
            $session.sessionId -isnot [string] -or $session.sessionId -cnotmatch '^[0-9a-f]{32}$' -or [guid]$session.sessionId -eq [guid]::Empty -or $seen.ContainsKey($session.sessionId)) { throw 'Invalid session failure identity.' }
        $seen[$session.sessionId] = $true
        if ($null -ne $session.vmId -and ($session.vmId -isnot [string] -or $session.vmId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or [guid]$session.vmId -eq [guid]::Empty)) { throw 'Invalid session failure VM identity.' }
        foreach ($record in @($session.first, $session.latest)) {
            if ($record -isnot [pscustomobject] -or (@($record.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'atUtc,capture,category,errorId,exceptionType,exitCode,failureClass,hResult,line,source,stage' -or
                $record.atUtc -isnot [string] -or [DateTime]::Parse($record.atUtc).ToUniversalTime().ToString('o') -cne $record.atUtc) { throw 'Invalid session failure projection.' }
            foreach ($key in $enums.Keys) { if ($record.$key -isnot [string] -or $record.$key -cnotin $enums[$key]) { throw 'Invalid session failure enum.' } }
            if ($record.line -isnot [int] -or $record.line -lt 0 -or $record.line -gt 100000 -or $record.hResult -isnot [int] -or
                ($null -ne $record.exitCode -and ($record.exitCode -isnot [int] -or $record.failureClass -cne 'runner-exit'))) { throw 'Invalid session failure number.' }
        }
    }
    if ([Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $Journal -Depth 6 -Compress)) -gt 16384) { throw 'Session failure journal bound.' }
}

function Write-RunnerSessionFailure([string] $SessionName, $Failure, [string] $Stage, [switch] $LockHeld, [switch] $FirstOnly) {
    # One state lock protects this bounded root journal independently of the
    # ephemeral state. A missing state can never erase attributed evidence.
    $mutex = $null
    try {
        if ($null -eq $Failure -or $SessionName -cnotmatch '^ITIR-[0-9a-f]{32}$' -or [guid]$SessionName.Substring(5) -eq [guid]::Empty) { return }
        $record = New-RunnerSessionFailureRecord $Failure $Stage
        if (-not $LockHeld) { $mutex = Enter-RunnerLock }
        Assert-SecureRoot
        $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'session-failures.json')
        $sessions = @()
        if (Test-Path -LiteralPath $path) {
            Assert-RunnerProtectedPath $path
            if ((Get-Item -LiteralPath $path).Length -gt 16384) { throw 'Session failure journal bound.' }
            $existing = Read-RunnerJson $path
            Assert-RunnerSessionFailureJournal $existing
            $sessions = @($existing.sessions)
        }
        $id = $SessionName.Substring(5)
        $prior = @($sessions | Where-Object { $_.sessionId -ceq $id })
        if ($FirstOnly -and $prior.Count -eq 1) { return }
        $vmId = if ($prior.Count -eq 1) { $prior[0].vmId } else { $null }
        # VM attribution is optional and best effort; do not invoke providers or
        # use a different/stale session's state to infer identity or health.
        try {
            $current = Get-RunnerState
            if ($null -ne $current -and $current.vmName -ceq $SessionName -and $current.PSObject.Properties.Name -contains 'vmId') {
                if ($current.vmId -isnot [string] -or $current.vmId -cnotmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or [guid]$current.vmId -eq [guid]::Empty) { throw 'Invalid diagnostic VM identity.' }
                $known = ([guid]$current.vmId).ToString()
                if ($null -ne $vmId -and $vmId -cne $known) { throw 'Changed diagnostic VM identity.' }
                $vmId = $known
            }
        } catch { $record.capture = 'unavailable' }
        $entry = [ordered]@{ sessionId = $id; vmId = $vmId; first = $record; latest = $record }
        if ($prior.Count -eq 1) { $entry.first = $prior[0].first }
        $sessions = @($sessions | Where-Object { $_.sessionId -cne $id }) + @($entry)
        if ($sessions.Count -gt 8) { $sessions = @($sessions | Select-Object -Last 8) }
        $journal = [ordered]@{ schema = 1; sessions = @($sessions) }
        Assert-RunnerSessionFailureJournal (ConvertTo-Json -InputObject $journal -Depth 6 -Compress | ConvertFrom-Json)
        Write-RunnerJson $path $journal
        Assert-RunnerProtectedPath $path
    } catch {
        try { Write-Warning 'RUNNER_SESSION_FAILURE_CAPTURE_UNAVAILABLE' -WarningAction Continue } catch { }
    } finally {
        if ($null -ne $mutex) {
            try { Exit-RunnerLock $mutex }
            catch { try { Write-Warning 'RUNNER_SESSION_FAILURE_CAPTURE_UNAVAILABLE' -WarningAction Continue } catch { } }
        }
    }
}

function Get-HostNetworkFingerprint {
    $records = @(
        foreach ($ip in @(Get-NetIPAddress -ErrorAction Stop)) {
            'address|{0}|{1}|{2}|{3}' -f $ip.AddressFamily, $ip.IPAddress, $ip.PrefixLength, $ip.InterfaceIndex
        }
        foreach ($route in @(Get-NetRoute -ErrorAction Stop)) {
            'route|{0}|{1}|{2}|{3}' -f $route.AddressFamily, $route.DestinationPrefix, $route.NextHop, $route.InterfaceIndex
        }
    )
    if ($records.Count -eq 0) { throw 'Host network inspection returned no addresses or routes.' }
    $canonical = (@($records | Sort-Object -Unique) -join "`n")
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}

function Test-RunnerProcessIdentity([int] $ProcessId, [string] $StartUtc) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    return $null -ne $process -and
        [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($StartUtc).ToUniversalTime()).TotalSeconds) -lt 2
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this shortcut from an elevated PowerShell session. No host changes were made.'
    }
}

function Assert-OwnedPath([string] $Path) {
    $root = [IO.Path]::GetFullPath($script:RunnerRoot).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath($Path)
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing a path outside the fixed runner root: $target"
    }
    $probe = $target
    while ($probe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing a reparse point in the runner data tree: $probe"
            }
        }
        $probe = [IO.Path]::GetDirectoryName($probe)
    }
    return $target
}

function New-RunnerMutexSecurity([string] $Name) {
    $security = [Security.AccessControl.MutexSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $owner = if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ceq 'S-1-5-18') { 'S-1-5-18' } else { 'S-1-5-32-544' }
    $security.SetOwner([Security.Principal.SecurityIdentifier]::new($owner))
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid), [Security.AccessControl.MutexRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow))
    }
    return $security
}

function Assert-RunnerMutexSecurity($Security, [string] $Name) {
    $owner = $Security.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -cnotin @('S-1-5-18', 'S-1-5-32-544')) { throw 'Runner mutex owner is untrusted.' }
    $rights = @{}
    $rules = @($Security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    # Captured Task Scheduler legacy descriptor: owner rights can read the ACL,
    # while SYSTEM and this exact Schedule service identity have full control.
    # Accept only the existing fixed runner objects, never a service-SID pattern.
    if ($owner -ceq 'S-1-5-18' -and $rules.Count -eq 3 -and $Name -cin @(
        'Global\ITInventoryLocalRunner-v1', 'Global\ITInventoryLocalRunner-Control-v1',
        'Global\ITInventoryLocalRunner-Supervisor-v1', 'Global\ITInventoryLocalRunner-Archive-v1')) {
        $expected = @{
            'S-1-3-4' = [int][Security.AccessControl.MutexRights]::ReadPermissions
            'S-1-5-18' = [int][Security.AccessControl.MutexRights]::FullControl
            'S-1-5-80-4125092361-1567024937-842823819-2091237918-836075745' = [int][Security.AccessControl.MutexRights]::FullControl
        }
        $seen = @{}
        foreach ($rule in $rules) {
            $sid = $rule.IdentityReference.Value
            if ($rule.AccessControlType -ne 'Allow' -or $rule.IsInherited -or -not $expected.ContainsKey($sid) -or
                [int]$rule.MutexRights -ne $expected[$sid] -or $seen.ContainsKey($sid)) { break }
            $seen[$sid] = $true
        }
        if ($seen.Count -eq 3) { return } # Use as-is; never repair legacy security.
    }
    foreach ($rule in $rules) {
        $sid = $rule.IdentityReference.Value
        if ($sid -cnotin @('S-1-5-18', 'S-1-5-32-544') -or $rule.AccessControlType -ne 'Allow' -or $rule.IsInherited) { throw 'Runner mutex ACL is untrusted.' }
        if (-not $rights.ContainsKey($sid)) { $rights[$sid] = 0 }
        $rights[$sid] = $rights[$sid] -bor [int]$rule.MutexRights
    }
    $full = [int][Security.AccessControl.MutexRights]::FullControl
    if ($rights.Count -eq 1 -and $rights.ContainsKey('S-1-5-18') -and $rights['S-1-5-18'] -eq $full -and $owner -ceq 'S-1-5-18') {
        return # Historical SYSTEM-only object: use under SYSTEM; never change it in place.
    }
    if (-not $Security.AreAccessRulesProtected -or $rights.Count -ne 2 -or
        $rights['S-1-5-18'] -ne $full -or $rights['S-1-5-32-544'] -ne $full) { throw 'Runner mutex ACL does not match protected SYSTEM/Administrators access.' }
}

function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    $created = $false
    # Windows ignores the supplied descriptor for an existing object. Validate
    # that object's owner/DACL before waiting; never repair its ACL in place.
    $mutex = [Threading.Mutex]::new($false, $Name, [ref]$created, (New-RunnerMutexSecurity $Name))
    try {
        Assert-RunnerMutexSecurity ($mutex.GetAccessControl()) $Name
        try {
            $timeout = if ($FailFast) { [TimeSpan]::Zero } else { [TimeSpan]::FromSeconds(20) }
            if (-not $mutex.WaitOne($timeout)) {
                throw 'Runner state is busy; retry after the other operation finishes.'
            }
        } catch [Threading.AbandonedMutexException] {
            # Windows grants ownership to this caller when the former owner dies.
            # The watchdog must still be able to inspect and remove the old VM.
        }
        return $mutex
    } catch {
        $mutex.Dispose()
        throw
    }
}

# Owner commands never queue behind another command. Background lifetime/state
# locks deliberately do not acquire this mutex. Lock order: control, supervisor, state.
function Invoke-RunnerControl([scriptblock] $Work) {
    $control = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Control-v1' -FailFast
    try { & $Work } finally { Exit-RunnerLock $control }
}

function Test-QueuedRunnerJob($Job, [string] $Label) {
    $labels = @($Job.labels)
    if ($labels -cnotcontains 'self-hosted' -or $labels -cnotcontains $Label -or
        $labels.Count -ne @($labels | Select-Object -Unique).Count -or
        @($labels | Where-Object { $_ -cnotin @('self-hosted', 'Linux', 'X64', $Label) }).Count -ne 0) { return $false }
    return $Job.status -eq 'queued' -and ($null -eq $Job.runner_id -or $Job.runner_id -eq 0)
}

function Test-PilotJobResult($Result, [string] $RunnerName, [long] $RunnerId) {
    return $Result.status -eq 'completed' -and $Result.conclusion -eq 'success' -and
        $Result.runner_name -ceq $RunnerName -and $Result.runner_id -eq $RunnerId
}

function Get-PilotLabel([string] $Sha) {
    if ($Sha -cnotmatch '^[0-9a-f]{40}$') { throw 'Pilot requires the intended full lowercase 40-character commit SHA.' }
    return "it-inventory-pilot-$Sha"
}

function Assert-PilotConfig($Config) {
    foreach ($field in @('pilotExpectedSha', 'pilotWorkflowPath', 'pilotLabel')) {
        if ($Config.PSObject.Properties.Name -notcontains $field) { throw 'Pilot workflow/SHA binding is missing; pickup refused.' }
    }
    $label = Get-PilotLabel $Config.pilotExpectedSha
    if ($Config.pilotWorkflowPath -cne '.github/workflows/local-runner-pilot.yml' -or $Config.pilotLabel -cne $label) {
        throw 'Pilot workflow/SHA label binding is invalid; pickup refused.'
    }
}

function Test-PilotEvidence($Config, $Run, $Workflow, $Job, $Binding = $null) {
    Assert-PilotConfig $Config
    if ($null -eq $Run -or $null -eq $Workflow -or $null -eq $Job) { return $false }
    foreach ($field in @('id', 'workflow_id', 'head_sha', 'run_attempt')) {
        if ($Run.PSObject.Properties.Name -notcontains $field) { return $false }
    }
    foreach ($field in @('id', 'path')) { if ($Workflow.PSObject.Properties.Name -notcontains $field) { return $false } }
    foreach ($field in @('id', 'run_id', 'head_sha', 'labels')) { if ($Job.PSObject.Properties.Name -notcontains $field) { return $false } }
    if ($Run.id -le 0 -or $Run.workflow_id -le 0 -or $Run.run_attempt -lt 1 -or $Job.id -le 0 -or
        $Workflow.id -ne $Run.workflow_id -or $Workflow.path -cne $Config.pilotWorkflowPath -or
        $Run.head_sha -cne $Config.pilotExpectedSha -or $Job.head_sha -cne $Config.pilotExpectedSha -or
        $Job.run_id -ne $Run.id -or $Job.labels -notcontains $Config.pilotLabel -or $Job.labels -notcontains 'self-hosted') {
        return $false
    }
    if ($null -eq (Get-RunnerJobProfile $Config $Job)) { return $false }
    if ($null -ne $Binding) {
        foreach ($field in @('jobId', 'runId', 'workflowId', 'workflowPath', 'headSha', 'runAttempt', 'pilotLabel')) {
            if ($Binding.PSObject.Properties.Name -notcontains $field) { return $false }
        }
        if ($Binding.jobId -ne $Job.id -or $Binding.runId -ne $Run.id -or $Binding.workflowId -ne $Workflow.id -or
            $Binding.workflowPath -cne $Workflow.path -or $Binding.headSha -cne $Run.head_sha -or
            $Binding.runAttempt -ne $Run.run_attempt -or $Binding.pilotLabel -cne $Config.pilotLabel) { return $false }
    }
    return $true
}

# Resource requirements are a fixed host-code allowlist, never workflow/config memory values.
function Get-RunnerResourceProfile([string] $Label) {
    $memory = switch -CaseSensitive ($Label) {
        'it-inventory-light' { 2GB; break }
        'it-inventory-mid' { 4GB; break }
        'it-inventory-heavy' { 6GB; break }
        'it-inventory-ephemeral' { 8GB; break }
        default {
            if ($Label -cmatch '^it-inventory-pilot-[0-9a-f]{40}$') { 8GB }
            else { throw 'Unsupported runner resource label.' }
        }
    }
    $reserve = if ($Label -ceq 'it-inventory-heavy') { 1GB } else { 2GB }
    return [pscustomobject]@{ label = $Label; memoryBytes = $memory; hostReserveBytes = $reserve; requiredBytes = ($memory + $reserve) }
}

function Get-RunnerSessionProfile($Config, [string] $ProfileLabel = '') {
    if ($Config.activation -eq 'pilot') {
        Assert-PilotConfig $Config
        if ($ProfileLabel -and $ProfileLabel -cne $Config.pilotLabel) { throw 'Pilot resource label differs from its exact SHA binding.' }
        return Get-RunnerResourceProfile $Config.pilotLabel
    }
    if (-not $ProfileLabel) { $ProfileLabel = $Config.label } # Older direct callers retain the legacy 8 GiB profile.
    if ($ProfileLabel -cmatch '^it-inventory-pilot-') { throw 'Active pickup cannot advertise a pilot label.' }
    return Get-RunnerResourceProfile $ProfileLabel
}

function Get-RunnerJobProfile($Config, $Job) {
    if ($null -eq $Job -or $Job.PSObject.Properties.Name -notcontains 'labels') { return $null }
    $labels = @($Job.labels)
    if ($labels -cnotcontains 'self-hosted' -or $labels.Count -ne @($labels | Select-Object -Unique).Count) { return $null }
    $custom = @($labels | Where-Object { $_ -cnotin @('self-hosted', 'Linux', 'X64') })
    if ($custom.Count -ne 1) { return $null }
    try { return Get-RunnerSessionProfile $Config ([string]$custom[0]) }
    catch { return $null } # Unsupported/mixed requests are ineligible, not a queue-wide failure.
}

function Get-RunnerJitLabels($Config, [string] $ProfileLabel = '') {
    $profile = Get-RunnerSessionProfile $Config $ProfileLabel
    # A provisioned heavy guest must not be diverted to a queued light job.
    # Pilot and legacy callers retain their single custom label as before.
    return @('self-hosted', 'Linux', 'X64', $profile.label)
}

function Assert-RunnerJitLabels($Config, $Runner, [string] $ProfileLabel = '') {
    $expected = @(Get-RunnerJitLabels $Config $ProfileLabel | Sort-Object)
    $actual = @($Runner.labels | Select-Object -ExpandProperty name | Sort-Object)
    if ($actual.Count -ne $expected.Count -or (Compare-Object -CaseSensitive $expected $actual)) {
        throw 'GitHub JIT runner labels differ from the fixed capacity routing allowlist.'
    }
}

function ConvertTo-RunnerLocalPath([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Runner path is empty.' }
    if ($Path.StartsWith('\\?\', [StringComparison]::Ordinal)) {
        # WSL stores local BasePath using extended DOS syntax. Only remove this
        # prefix for an unambiguous drive-qualified path, never UNC/device paths.
        $Path = $Path.Substring(4)
        if ($Path.Contains('/') -or $Path -match '(^|\\)\.{1,2}(\\|$)|[ .](\\|$)') {
            throw 'Extended runner path has ambiguous components.'
        }
    }
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path.Substring(2).Contains(':')) {
        throw 'Runner path must be a fully qualified local DOS path.'
    }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Assert-ConverterOwnership($Stage, $Registration, [string] $HelperRoot) {
    if ($Stage.helperName -notmatch '^ITInventoryImageConverter-[0-9a-f]{32}$') {
        throw 'Setup stage has no valid dedicated image-converter identity.'
    }
    $expectedPath = ConvertTo-RunnerLocalPath $HelperRoot
    [void](Assert-OwnedPath $expectedPath)
    if ($null -eq $Registration -or $Registration.DistributionName -cne $Stage.helperName) {
        throw 'Existing WSL image converter does not match the protected setup stage and owned base path.'
    }
    $registeredPath = ConvertTo-RunnerLocalPath ([string]$Registration.BasePath)
    [void](Assert-OwnedPath $registeredPath)
    if (-not [string]::Equals($registeredPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Existing WSL image converter does not match the protected setup stage and owned base path.'
    }
}

function Test-ConvertedImageReceipt($Receipt, [string] $SourceHash, [string] $OutputHash) {
    return $null -ne $Receipt -and $Receipt.tag -eq $script:RunnerTag -and
        $Receipt.sourceSha256 -ieq $SourceHash -and $Receipt.outputSha256 -ieq $OutputHash -and
        $Receipt.completed -eq $true
}

function ConvertTo-NativeArgument([AllowEmptyString()][string] $Value) {
    # WSL parses its option prefix itself and does not recognize quoted flags.
    # Leave simple tokens bare; CRT quoting is needed only for empty/complex values.
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    # Windows CRT argument quoting: preserve empty values, embedded quotes and
    # backslashes preceding quotes or the closing delimiter.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-RunnerNative([string] $Executable, [string[]] $Arguments, [string] $InputText = $null, [switch] $CaptureOutput, [switch] $CaptureError, [ValidateRange(0, 3600)][int] $TimeoutSeconds = 0) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    if ($CaptureOutput) { $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false) }
    if ($CaptureError) { $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false) }
    $process = [Diagnostics.Process]::Start($start)
    try {
        # Only trusted setup path translation captures output. Guest output and
        # JIT data keep the existing discard behavior. Only fixed setup/probe
        # commands opt into visible, bounded stderr diagnostics.
        if ($CaptureOutput) { $output = $process.StandardOutput.ReadToEndAsync() }
        else { $output = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null) }
        if ($CaptureError) { $errorOutput = $process.StandardError.ReadToEndAsync() }
        else { $errorOutput = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null) }
        if ($null -ne $InputText) { $process.StandardInput.WriteLine($InputText) }
        $process.StandardInput.Close()
        if ($TimeoutSeconds -gt 0) {
            if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
                $process.Kill()
                throw "Native command timed out after $TimeoutSeconds seconds."
            }
        } else { $process.WaitForExit() }
        $captured = $output.GetAwaiter().GetResult()
        $capturedError = $errorOutput.GetAwaiter().GetResult()
        if ($CaptureOutput -or $CaptureError) {
            if (-not $CaptureOutput) { $captured = '' }
            if (-not $CaptureError) { $capturedError = '' }
            return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $captured; ErrorOutput = (ConvertTo-RunnerDiagnosticText $capturedError) }
        }
        return $process.ExitCode
    } finally { $process.Dispose() }
}

function ConvertTo-RunnerDiagnosticText([string] $Text) {
    # WSL may mix UTF-16 diagnostics with UTF-8 guest output. Remove embedded
    # NUL/control characters and bound only the visible diagnostic, never log JIT.
    $Text = [regex]::Replace($Text, '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '')
    $Text = [regex]::Replace($Text, '(https?://)[^/\s@]+@', '$1[redacted]@')
    if ($Text.Length -gt 4096) { return $Text.Substring(0, 4096) + ' [truncated]' }
    return $Text.Trim()
}

function Invoke-ConverterCommand([string] $Name, [string[]] $Command, [switch] $CaptureOutput, [switch] $CaptureError, [string] $Executable = 'wsl.exe', [int] $TimeoutSeconds = 0) {
    if ($Name -notmatch '^ITInventoryImageConverter-[0-9a-f]{32}$' -or $Command.Count -eq 0) {
        throw 'Image converter command requires its exact recorded identity and a command.'
    }
    # -- alone lets WSL invoke the default Linux shell, which consumes Windows
    # path backslashes. --exec passes the native argv directly to the command.
    $arguments = @('-d', $Name, '-u', 'root', '--exec') + $Command
    return Invoke-RunnerNative $Executable $arguments -CaptureOutput:$CaptureOutput -CaptureError:$CaptureError -TimeoutSeconds $TimeoutSeconds
}

function Show-ConverterCommandFailure([string] $Heading, $Result) {
    Write-Host "$Heading (exit $($Result.ExitCode))."
    if ($Result.Output) { Write-Host (ConvertTo-RunnerDiagnosticText $Result.Output) }
    if ($Result.ErrorOutput) { Write-Host (ConvertTo-RunnerDiagnosticText $Result.ErrorOutput) }
}

function Assert-ConverterTools([string] $Name) {
    # Reuse a working installed tool rather than rerunning apt on every retry.
    $probe = Invoke-ConverterCommand $Name @('/usr/bin/qemu-img', '--version') -CaptureOutput -CaptureError -TimeoutSeconds 30
    if ($probe.ExitCode -eq 0 -and $probe.Output -match '^qemu-img version ') { return }
    if ($probe.ExitCode -notin @(1, 127)) {
        Show-ConverterCommandFailure 'Converter tool probe failed; dependency install was not attempted' $probe
        throw 'Image converter could not run its tool probe; inspect the diagnostic or use the elevated converter diagnostic menu.'
    }
    $install = Invoke-ConverterCommand $Name @('sh', '-c', 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qemu-utils') -CaptureError
    if ($install.ExitCode -ne 0) {
        Show-ConverterCommandFailure 'Fixed qemu-utils setup command failed' $install
        throw 'qemu-utils installation failed in the dedicated image converter; see bounded diagnostic above.'
    }
}

function Invoke-ConverterDiagnostics {
    Assert-Administrator
    Assert-SecureRoot
    $stage = Read-RunnerJson (Join-Path $script:RunnerRoot 'setup-stage.json')
    if ($null -eq $stage -or $stage.tag -ne $script:RunnerTag) { throw 'Diagnostics require the protected unfinished setup stage.' }
    $registrations = @(Get-ConverterRegistrations $stage.helperName)
    if ($registrations.Count -ne 1) { throw 'Diagnostics require one exact recorded converter registration.' }
    Assert-ConverterOwnership $stage $registrations[0] (Join-Path $script:RunnerRoot 'image-converter')
    Write-Host "Read-only converter diagnostic; PowerShell $($PSVersionTable.PSVersion); exact recorded registration verified."
    $commands = @(
        ,@('/usr/bin/qemu-img', '--version')
        ,@('sh', '-c', 'printf "converter-command=ok\n"; command -v qemu-img; command -v wslpath')
        ,@('wslpath', '-a', (Join-Path $script:RunnerRoot 'image\ubuntu-24.04-server-cloudimg-amd64.img'))
    )
    foreach ($command in $commands) {
        $result = Invoke-ConverterCommand $stage.helperName $command -CaptureOutput -CaptureError -TimeoutSeconds 30
        Show-ConverterCommandFailure "Read-only $($command[0])" $result
    }
}

function Get-ConverterLinuxPath([string] $Name, [string] $Path) {
    $Path = Assert-OwnedPath $Path
    $result = Invoke-ConverterCommand $Name @('wslpath', '-a', $Path) -CaptureOutput
    if ($result.ExitCode -ne 0) { throw "Image converter path translation failed (exit $($result.ExitCode))." }
    if ([string]::IsNullOrWhiteSpace([string]$result.Output)) { throw 'Image converter path translation returned no path.' }
    $linuxPath = ([string]$result.Output).Trim()
    if ($linuxPath -notmatch '^/[^\r\n\x00]+$') { throw 'Image converter path translation did not return one absolute Linux path.' }
    return $linuxPath
}

function New-RunnerSshKey([string] $Path, [string] $Executable = (Get-Command ssh-keygen.exe -ErrorAction Stop).Source) {
    $Path = Assert-OwnedPath $Path
    # The installed Windows PowerShell 5.1 drops empty native arguments; the
    # process helper preserves the explicit empty passphrase without a shell.
    if ((Invoke-RunnerNative $Executable @('-q', '-t', 'ed25519', '-N', '', '-f', $Path)) -ne 0) {
        throw 'Per-VM SSH key generation failed.'
    }
}

function Get-ConverterRegistrations([string] $Name) {
    return @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue |
        Get-ItemProperty -ErrorAction Stop | Where-Object DistributionName -CEQ $Name)
}

function Remove-OwnedConverter($Stage, [string] $HelperRoot) {
    $registrations = @(Get-ConverterRegistrations $Stage.helperName)
    if ($registrations.Count -ne 1) { throw 'Converter retirement requires one exact owned registration.' }
    Assert-ConverterOwnership $Stage $registrations[0] $HelperRoot
    & wsl.exe --terminate $Stage.helperName
    if ($LASTEXITCODE -ne 0) { throw 'Owned converter termination failed; setup remains incomplete.' }
    # Recheck the destructive target after termination.
    $registrations = @(Get-ConverterRegistrations $Stage.helperName)
    if ($registrations.Count -ne 1) { throw 'Converter registration changed before retirement.' }
    Assert-ConverterOwnership $Stage $registrations[0] $HelperRoot
    & wsl.exe --unregister $Stage.helperName
    if ($LASTEXITCODE -ne 0 -or @(Get-ConverterRegistrations $Stage.helperName).Count -ne 0) {
        throw 'Owned converter retirement could not be verified.'
    }
    $distros = @(& wsl.exe --list --quiet | ForEach-Object { $_.Trim([char]0).Trim() })
    if ($LASTEXITCODE -ne 0 -or $distros -contains $Stage.helperName) { throw 'Retired converter is still listed or WSL readback failed.' }
}

function Assert-RunnerVmLifecycle([string] $Name) {
    $vm = Get-VM -Name $Name -ErrorAction Stop
    if ($vm.AutomaticStartAction -ne 'Nothing' -or $vm.AutomaticStopAction -ne 'TurnOff') {
        throw 'VM lifecycle readback permits automatic restart or saved job state.'
    }
}

function Exit-RunnerLock($Mutex) {
    $Mutex.ReleaseMutex()
    $Mutex.Dispose()
}

function Read-RunnerJson([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-RunnerJson([string] $Path, $Value) {
    $Path = Assert-OwnedPath $Path
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    $backup = "$Path.$([guid]::NewGuid().ToString('N')).bak"
    $json = ConvertTo-Json -InputObject $Value -Depth 10 -Compress
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    try {
        if (Test-Path -LiteralPath $Path) {
            [IO.File]::Replace($temporary, $Path, $backup)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

function Get-RunnerConfig {
    $config = Read-RunnerJson $script:RunnerConfigPath
    if ($null -eq $config) { throw 'Runner setup is incomplete: config.json is missing.' }
    if ($config.schema -ne 1 -or $config.tag -ne $script:RunnerTag) {
        throw 'Runner config identity or schema is invalid.'
    }
    if ($config.repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
        throw 'Runner config repository is invalid.'
    }
    if ($config.maxMinutes -lt 10 -or $config.maxMinutes -gt 360) {
        throw 'Runner hard deadline must be between 10 and 360 minutes.'
    }
    return $config
}

function Assert-HostPrerequisites {
    Assert-Administrator
    if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
        throw 'Hyper-V tools are unavailable. Run Setup.ps1 -EnableHyperV once as Administrator, restart Windows if requested, then run Setup.ps1.'
    }
    foreach ($name in @('Get-VM', 'New-VM', 'Get-VMSwitch', 'New-VMSwitch', 'Add-VMNetworkAdapterExtendedAcl', 'Get-VMNetworkAdapterExtendedAcl', 'New-VHD', 'Mount-VHD', 'Get-VHD', 'Test-VHD', 'Resize-VHD', 'Get-NetNat', 'New-NetNat', 'Get-ScheduledTask', 'Start-ScheduledTask')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Hyper-V prerequisite unavailable: $name" }
    }
    foreach ($name in @('ssh.exe', 'scp.exe', 'ssh-keygen.exe', 'wsl.exe')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Host prerequisite unavailable: $name" }
    }
    $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V
    if ($feature.State -ne 'Enabled') { throw 'Hyper-V is not enabled. Setup cannot continue.' }
    if ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory -lt 24GB) {
        throw 'At least 24 GiB physical RAM is required for the 8 GiB VM and host workload.'
    }
    $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($script:RunnerRoot).TrimEnd(':\'))
    if ($drive.Free -lt 80GB) { throw 'At least 80 GiB free on the runner data volume is required.' }
}

function Assert-SecureRoot {
    if (-not (Test-Path -LiteralPath $script:RunnerRoot -PathType Container)) {
        throw 'Fixed runner data root is missing.'
    }
    $item = Get-Item -LiteralPath $script:RunnerRoot -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Runner data root may not be a reparse point.'
    }
    $acl = Get-Acl -LiteralPath $script:RunnerRoot
    if (-not $acl.AreAccessRulesProtected) { throw 'Runner data root inherits permissions; refusing use.' }
    $allowed = @('S-1-5-18', 'S-1-5-32-544')
    $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($allowed -notcontains $ownerSid) { throw "Runner data root has an unexpected owner: $ownerSid" }
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid) {
            throw "Runner data root grants access to an unexpected principal: $sid"
        }
    }
}

function Get-RunnerState {
    # File.Replace publication can be transiently absent to Windows providers.
    # Share the writers' reentrant mutex for the entire existence/read sequence.
    $mutex = Enter-RunnerLock
    try { return Read-RunnerJson $script:RunnerStatePath }
    finally { Exit-RunnerLock $mutex }
}

function Test-RunnerSessionStopRequested($State, $Observation = $null) {
    # An instance marker always cancels. The root marker also suspends pickup
    # during explicit owner image preparation; never infer that exemption from
    # a stale caller snapshot or a process-local preparation flag.
    $mutex = Enter-RunnerLock
    try {
        if ($null -ne $Observation) { $Observation.Value = 'unavailable' }
        if (Test-Path -LiteralPath (Join-Path $State.instancePath 'stop.requested')) {
            if ($null -ne $Observation) { $Observation.Value = 'instance-marker' }; return $true
        }
        if (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) {
            if ($null -ne $Observation) { $Observation.Value = 'none' }; return $false
        }
        Assert-RunnerProtectedPath $script:RunnerStatePath
        $current = Get-RunnerState
        if ($null -eq $current) { if ($null -ne $Observation) { $Observation.Value = 'state-absent' }; return $true }
        Assert-StateIdentity $current
        if ($current.vmName -cne $State.vmName -or $current.instancePath -ine $State.instancePath -or
            ($State.PSObject.Properties.Name -contains 'vmId' -and
                ($current.PSObject.Properties.Name -notcontains 'vmId' -or [guid]$current.vmId -ne [guid]$State.vmId))) {
            if ($null -ne $Observation) { $Observation.Value = 'claim-mismatch' }; return $true
        }
        if ($current.PSObject.Properties.Name -notcontains 'purpose' -or $current.purpose -cnotin @('prepare', 'verify-image')) {
            if ($null -ne $Observation) { $Observation.Value = 'purpose-ineligible' }; return $true
        }
        $requested = Test-Path -LiteralPath (Join-Path $current.instancePath 'stop.requested')
        if ($null -ne $Observation) { $Observation.Value = if ($requested) { 'instance-marker' } else { 'none' } }
        return $requested
    } finally { Exit-RunnerLock $mutex }
}

function Get-RunnerBytesHash([byte[]] $Bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-', '') }
    finally { $hash.Dispose() }
}

function Get-RunnerFileEvidence([string] $Path) {
    $Path = Assert-OwnedPath $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [pscustomobject]@{ exists = $false; hash = ''; content = '' } }
    $bytes = [IO.File]::ReadAllBytes($Path)
    return Get-RunnerBytesEvidence $bytes
}

function Get-RunnerBytesEvidence([byte[]] $Bytes) {
    return [pscustomobject]@{ exists = $true; hash = Get-RunnerBytesHash $Bytes; content = [Convert]::ToBase64String($Bytes) }
}

function Get-RunnerEvidenceValue($Evidence) {
    if (-not $Evidence.exists) { return $null }
    $bytes = [Convert]::FromBase64String($Evidence.content)
    if ((Get-RunnerBytesHash $bytes) -cne $Evidence.hash) { throw 'Transition evidence content/hash mismatch.' }
    return [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff) | ConvertFrom-Json
}

function Test-RunnerEvidence([string] $Path, $Evidence) {
    $actual = Get-RunnerFileEvidence $Path
    return $actual.exists -eq $Evidence.exists -and $actual.hash -ceq $Evidence.hash
}

function Write-RunnerBytes([string] $Path, [byte[]] $Bytes) {
    $Path = Assert-OwnedPath $Path
    $temporary = Assert-OwnedPath ($Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $backup = Assert-OwnedPath ($Path + '.' + [guid]::NewGuid().ToString('N') + '.bak')
    try {
        [IO.File]::WriteAllBytes($temporary, $Bytes)
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, $backup) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

function Get-RunnerJsonEvidence($Value) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 10 -Compress))
    return [pscustomobject]@{ exists = $true; hash = Get-RunnerBytesHash $bytes; content = [Convert]::ToBase64String($bytes) }
}

function Write-RunnerEvidence([string] $Path, $Evidence) {
    [void](Get-RunnerEvidenceValue $Evidence)
    if (-not $Evidence.exists) { throw 'Cannot write absent transition evidence.' }
    Write-RunnerBytes $Path ([Convert]::FromBase64String($Evidence.content))
    if (-not (Test-RunnerEvidence $Path $Evidence)) { throw 'Transition evidence readback failed.' }
}

function Assert-RunnerTransitionClear {
    foreach ($name in @('pilot-retry.json', 'update-journal.json', 'setup-publication.json')) {
        $record = Read-RunnerJson (Assert-OwnedPath (Join-Path $script:RunnerRoot $name))
        if ($null -ne $record -and ($record.tag -cne $script:RunnerTag -or $record.phase -cne 'complete')) {
            throw 'A pending or invalid lifecycle journal blocks pickup/activation; explicitly resume the recorded operation.'
        }
    }
}

function Assert-RunnerClaimOpen {
    Assert-RunnerControllerOpen
    Assert-RunnerJitRegistrationClear
}

function Assert-RunnerControllerOpen {
    Assert-RunnerTransitionClear
    # Restarting the reconciler is not admission of a new VM or JIT request.
    # A valid unresolved barrier may be reconciled; malformed evidence refuses.
    [void](Get-RunnerJitRegistration)
    if (Test-Path -LiteralPath (Assert-OwnedPath (Join-Path $script:RunnerRoot 'stop.requested'))) {
        throw 'Pickup suspension requested; no new job may be consumed or created.'
    }
}

# This root-level, nonsecret barrier survives deletion of an ephemeral session.
# It records only the sole registration operation; it is not a job queue.
function Assert-RunnerJitRegistration($Record) {
    $fields = @('schema', 'tag', 'phase', 'operationId', 'repo', 'vmName', 'vmId', 'instancePath', 'supervisorPid', 'supervisorStartUtc', 'labels', 'runnerGroupId', 'runnerId')
    if ($null -eq $Record -or @($Record.PSObject.Properties.Name).Count -ne $fields.Count -or
        @($fields | Where-Object { $Record.PSObject.Properties.Name -notcontains $_ }).Count -ne 0 -or
        $Record.schema -ne 1 -or $Record.tag -cne $script:RunnerTag -or
        $Record.phase -cnotin @('intent', 'registered', 'handed-off', 'removal-intent', 'complete') -or
        $Record.operationId -cnotmatch '^[0-9a-f]{32}$' -or $Record.repo -cnotmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or
        [string]$Record.supervisorPid -cnotmatch '^[1-9][0-9]*$' -or [string]$Record.runnerGroupId -cnotmatch '^[1-9][0-9]*$' -or
        [string]$Record.runnerId -cnotmatch '^(0|[1-9][0-9]*)$' -or
        ($Record.phase -ceq 'intent' -and $Record.runnerId -ne 0) -or ($Record.phase -cne 'intent' -and $Record.runnerId -le 0)) { throw 'JIT registration barrier identity is invalid.' }
    Assert-StateIdentity $Record
    [void][DateTime]::Parse($Record.supervisorStartUtc).ToUniversalTime()
    $labels = @($Record.labels)
    if ($labels.Count -ne 4 -or @($labels | Select-Object -Unique).Count -ne 4 -or
        @('self-hosted', 'Linux', 'X64' | Where-Object { $labels -cnotcontains $_ }).Count -ne 0 -or
        @($labels | Where-Object { $_ -cmatch '^it-inventory-(light|mid|heavy|ephemeral|pilot-[0-9a-f]{40})$' }).Count -ne 1) { throw 'JIT registration barrier labels are invalid.' }
}

function Get-RunnerJitRegistration {
    $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'jit-registration.json')
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    Assert-RunnerProtectedPath $path
    $record = Read-RunnerJson $path
    Assert-RunnerJitRegistration $record
    return $record
}

function Assert-RunnerJitRegistrationClear {
    $record = Get-RunnerJitRegistration
    if ($null -ne $record -and $record.phase -cne 'complete') {
        throw 'Unresolved JIT registration blocks new claims and pilot retry; supervisor reconciliation is required.'
    }
}

function Write-RunnerJitRegistration($Record) {
    Assert-RunnerJitRegistration $Record
    $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'jit-registration.json')
    Write-RunnerJson $path $Record
    $actual = Get-RunnerJitRegistration
    if ((Get-RunnerJsonEvidence $actual).hash -cne (Get-RunnerJsonEvidence $Record).hash) { throw 'JIT registration barrier readback differs.' }
}

function Get-RunnerVmInventory {
    # Collect both complete snapshots before returning any objects. A failed or
    # partial Hyper-V lookup must never become proof that a VM does not exist.
    try {
        $vms = @(Get-VM -ErrorAction Stop)
        $systems = @(Get-CimInstance -Namespace 'root/virtualization/v2' -ClassName Msvm_ComputerSystem -OperationTimeoutSec 10 -ErrorAction Stop)
        $registered = @($systems | Where-Object Caption -CEQ 'Virtual Machine')
        if (@($systems | Where-Object Caption -CEQ 'Hosting Computer System').Count -ne 1 -or
            $systems.Count -ne ($registered.Count + 1)) { throw 'Incomplete provider inventory.' }
        $seen = @{}
        foreach ($vm in $vms) {
            $id = [guid]$vm.Id
            if ($id -eq [guid]::Empty -or [string]::IsNullOrEmpty($vm.Name) -or $seen.ContainsKey($id.ToString())) { throw 'Invalid or duplicate VM identity.' }
            $seen[$id.ToString()] = $true
            $matching = @($registered | Where-Object { $_.Name -ieq $id.ToString() -and $_.ElementName -ceq $vm.Name })
            if ($matching.Count -ne 1) { throw 'VM/provider identity differs.' }
        }
        if ($vms.Count -ne $registered.Count) { throw 'VM/provider inventory differs.' }
    } catch {
        throw 'Hyper-V inventory could not be verified. Preserve runner instance files and state; investigate VM registration before retrying cleanup or pickup.'
    }
    return $vms
}

function Assert-RunnerControlIdle {
    if ((Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction Stop).State -eq 'Running' -or
        (Get-RunnerState) -or @(Get-RunnerVmInventory | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -gt 0) {
        throw 'Lifecycle control requires a stopped supervisor and no session or owned-prefix VM.'
    }
}

function Assert-RunnerProtectedPath([string] $Path) {
    [void](Assert-OwnedPath $Path)
    $acl = Get-Acl -LiteralPath $Path
    $allowed = @('S-1-5-18', 'S-1-5-32-544')
    if ($allowed -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Installed path owner is unexpected.' }
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid) { throw 'Installed path grants unexpected access.' }
    }
}

# Offline tests inject interruption here; production has no environment switch
# or callback that can change transition behavior.
function Invoke-RunnerTransitionCheckpoint([string] $Name) {}

# A committed initial state is the durable claim. Complete its exact receipt
# before any recovery can erase that state, including watchdog/Stop cleanup.
function Complete-RunnerPilotClaim($State) {
    if ($State.PSObject.Properties.Name -contains 'purpose' -and $State.purpose -ceq 'prepare') {
        Assert-StateIdentity $State
        return
    }
    if ($State.PSObject.Properties.Name -contains 'claimMode' -and
        ($State.claimMode -cnotin @('pilot', 'active') -or
        ($State.claimMode -ceq 'pilot' -and $State.PSObject.Properties.Name -notcontains 'pilotClaim') -or
        ($State.claimMode -ceq 'active' -and $State.PSObject.Properties.Name -contains 'pilotClaim'))) {
        throw 'Recorded session claim mode/evidence is invalid; state must be retained.'
    }
    if ($State.PSObject.Properties.Name -notcontains 'pilotClaim') { return }
    Assert-StateIdentity $State
    $attempt = Get-RunnerEvidenceValue $State.pilotClaim
    if ($null -eq $attempt -or $attempt.tag -cne $script:RunnerTag -or $attempt.sessionName -cne $State.vmName -or
        $attempt.jobId -le 0 -or $attempt.runId -le 0 -or $attempt.workflowId -le 0 -or $attempt.runAttempt -le 0 -or
        $attempt.workflowPath -cne '.github/workflows/local-runner-pilot.yml' -or
        $attempt.pilotLabel -cne (Get-PilotLabel $attempt.headSha)) { throw 'Recorded pilot claim identity is invalid; state must be retained.' }
    if ($State.PSObject.Properties.Name -contains 'resourceLabel' -and $State.resourceLabel -cne $attempt.pilotLabel) { throw 'Pilot state resource label differs from its committed receipt.' }
    $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')
    if (Test-Path -LiteralPath $path) {
        if (-not (Test-RunnerEvidence $path $State.pilotClaim)) { throw 'Pilot receipt differs from committed session claim; state must be retained.' }
    } else { Write-RunnerEvidence $path $State.pilotClaim }
}

function Assert-StateIdentity($State) {
    if ($State.PSObject.Properties.Name -contains 'purpose') {
        if ($State.purpose -cnotin @('job', 'prepare', 'verify-image') -or
            ($State.purpose -cne 'job' -and ($State.PSObject.Properties.Name -contains 'claimMode' -or $State.PSObject.Properties.Name -contains 'pilotClaim'))) {
            throw 'Session purpose may not carry job authorization in a preparation session.'
        }
        $hasCandidate = $State.PSObject.Properties.Name -contains 'imageCandidate'
        if ($State.purpose -ceq 'verify-image') {
            if (-not $hasCandidate -or $State.imageCandidate.id -cnotmatch '^[0-9a-f]{32}$' -or
                $State.imageCandidate.diskHash -cnotmatch '^[0-9A-F]{64}$' -or $State.imageCandidate.bindingHash -cnotmatch '^[0-9A-F]{64}$' -or
                $State.imageCandidate.recipeId -cnotmatch '^[0-9A-F]{64}$') { throw 'Image verifier requires its protected candidate binding.' }
        } elseif ($hasCandidate) { throw 'Only the credential-free verifier may carry an image candidate.' }
    }
    if ($State.tag -ne $script:RunnerTag -or $State.vmName -notmatch '^ITIR-[0-9a-f]{32}$') {
        throw 'Runner state identity is invalid; manual investigation is required.'
    }
    if ($State.PSObject.Properties.Name -contains 'resourceLabel') {
        [void](Get-RunnerResourceProfile $State.resourceLabel)
        if ($State.PSObject.Properties.Name -contains 'claimMode' -and $State.claimMode -ceq 'active' -and
            $State.resourceLabel -cmatch '^it-inventory-pilot-') { throw 'Active state has a pilot resource label.' }
    }
    if ($State.PSObject.Properties.Name -contains 'vmId') {
        if ([string]$State.vmId -cnotmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or
            [guid]$State.vmId -eq [guid]::Empty) { throw 'Recorded VM GUID is invalid; runner instance files and state are retained.' }
    }
    [void](Assert-OwnedPath $State.instancePath)
    if (-not $State.instancePath.EndsWith($State.vmName, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runner state instance path does not match its VM name.'
    }
}

function Get-RunnerDiskChain([string] $Path) {
    $seen = @{}
    for ($depth = 0; $depth -lt 32; $depth++) {
        if ([string]::IsNullOrEmpty($Path) -or -not [IO.Path]::IsPathRooted($Path)) { throw 'Disk ancestry path is unknown; retain files.' }
        $Path = [IO.Path]::GetFullPath($Path)
        if ($seen.ContainsKey($Path)) { throw 'Disk ancestry cycle; retain files.' }
        $seen[$Path] = $true
        $disk = Get-VHD -Path $Path -ErrorAction Stop
        if ($null -eq $disk -or $disk.VhdType -cnotin @('Fixed','Dynamic','Differencing')) { throw 'Disk ancestry type is unknown; retain files.' }
        $Path
        if ($disk.VhdType -cne 'Differencing') {
            if (-not [string]::IsNullOrEmpty($disk.ParentPath)) { throw 'Standalone disk has an unexpected parent; retain files.' }
            return
        }
        $Path = $disk.ParentPath
    }
    throw 'Disk ancestry exceeds its bounded depth; retain files.'
}

function Get-RunnerManagedDiskRoots([string] $ExcludedInstance = '') {
    $root = Assert-OwnedPath (Join-Path $script:RunnerRoot 'instances')
    if (-not (Test-Path -LiteralPath $root)) { return }
    $entries = @(Get-ChildItem -LiteralPath $root -Force -ErrorAction Stop)
    if ($entries.Count -gt 128) { throw 'Instance inventory exceeds its bounded view; retain files.' }
    $count = 0
    foreach ($entry in $entries) {
        if (-not $entry.PSIsContainer -or $entry.Name -cnotmatch '^ITIR-[0-9a-f]{32}$') { throw 'Unknown managed instance entry; retain files.' }
        [void](Assert-OwnedPath $entry.FullName)
        if ($ExcludedInstance -and $entry.FullName -ieq $ExcludedInstance) { continue }
        $pending = [Collections.Generic.Queue[string]]::new()
        $pending.Enqueue($entry.FullName)
        while ($pending.Count) {
            foreach ($file in @(Get-ChildItem -LiteralPath $pending.Dequeue() -Force -ErrorAction Stop)) {
                $count++
                if ($count -gt 2048) { throw 'Managed file inventory exceeds its bounded view; retain files.' }
                [void](Assert-OwnedPath $file.FullName)
                if ($file.PSIsContainer) { $pending.Enqueue($file.FullName) }
                elseif ($file.Extension -imatch '^\.vhdx?$') { $file.FullName }
            }
        }
    }
}

function Assert-RunnerDiskReferencesAbsent([string] $Path, [switch] $Directory, [string] $ExcludedInstance = '') {
    $Path = Assert-OwnedPath $Path
    $prefix = $Path.TrimEnd('\') + '\'
    $roots = @()
    foreach ($vm in @(Get-RunnerVmInventory)) {
        foreach ($disk in @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)) {
            if ([string]::IsNullOrEmpty($disk.Path)) { throw 'VM disk reference is unknown; retain files.' }
            $roots += $disk.Path
            if ($roots.Count -gt 512) { throw 'VM disk view exceeds its bound; retain files.' }
        }
    }
    # An offline managed file is not a reference to itself. VM attachments
    # above still count, and every other managed child's ancestry is inspected.
    $roots += @(Get-RunnerManagedDiskRoots $ExcludedInstance | Where-Object { $_ -ine $Path })
    foreach ($root in $roots) {
        foreach ($ancestor in @(Get-RunnerDiskChain $root)) {
            if ($ancestor -ieq $Path -or ($Directory -and $ancestor.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))) { throw 'A disk chain still references the protected target; retain files.' }
        }
    }
}

function Assert-RunnerInstanceUnreferenced($State) {
    $instancePath = Assert-OwnedPath $State.instancePath
    $instancePrefix = $instancePath.TrimEnd('\') + '\'
    foreach ($entry in @(Get-RunnerVmInventory)) {
        if ([string]::IsNullOrEmpty($entry.Path)) { throw 'VM configuration path inspection failed; runner files/state are retained.' }
        $configurationPath = [IO.Path]::GetFullPath($entry.Path)
        if ($configurationPath.StartsWith($instancePrefix, [StringComparison]::OrdinalIgnoreCase) -or $configurationPath.Equals($instancePath, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'A registered VM still references the recorded instance configuration path; runner files/state are retained.'
        }
    }
    Assert-RunnerDiskReferencesAbsent $instancePath -Directory -ExcludedInstance $instancePath
}

function Remove-RunnerInstance($State) {
    Assert-StateIdentity $State
    Complete-RunnerPilotClaim $State
    $hasVmId = $State.PSObject.Properties.Name -contains 'vmId'
    $matching = @(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $State.vmName -or ($hasVmId -and [guid]$_.Id -eq [guid]$State.vmId) })
    if ($matching.Count -gt 1) { throw 'Ambiguous VM identity; runner instance files and state are retained.' }
    $vm = if ($matching.Count -eq 1) { $matching[0] } else { $null }
    if ($null -ne $vm) {
        $vmId = [guid]$vm.Id
        if ($hasVmId -and $vmId -ne [guid]$State.vmId) { throw 'Recorded VM GUID differs from the inspected VM; runner files/state are retained.' }
        $disk = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
        foreach ($entry in $disk) {
            [void](Assert-OwnedPath $entry.Path)
        }
        $vmPath = [IO.Path]::GetFullPath($vm.Path)
        # New-VM appends its name to -Path. Legacy state has the same deterministic layout.
        $ownedVmPath = Assert-OwnedPath (Join-Path $State.instancePath $State.vmName)
        if ($State.PSObject.Properties.Name -contains 'expectedVmPath' -and
            -not [string]::Equals([IO.Path]::GetFullPath($State.expectedVmPath), $ownedVmPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Recorded VM configuration path differs from the exact creation layout; refusing deletion.'
        }
        $normalOwner = $vm.Name -ceq $State.vmName -and $vm.Notes -eq $script:RunnerTag -and
            $vmPath.Equals($ownedVmPath, [StringComparison]::OrdinalIgnoreCase)
        $provisionalOwner = $false
        if ([string]::IsNullOrEmpty($vm.Notes) -and $State.PSObject.Properties.Name -contains 'phase' -and $State.phase -eq 'creating') {
            $expectedBootDisk = Assert-OwnedPath (Join-Path $State.instancePath 'guest.vhdx')
            $provisionalOwner = $vm.Name -ceq $State.vmName -and $vm.State -eq 'Off' -and
                $vmPath.Equals($ownedVmPath, [StringComparison]::OrdinalIgnoreCase) -and
                $State.expectedBootDisk -ceq $expectedBootDisk -and $disk.Count -eq 1 -and
                [string]::Equals([IO.Path]::GetFullPath($disk[0].Path), $expectedBootDisk, [StringComparison]::OrdinalIgnoreCase)
        }
        if (-not ($normalOwner -or $provisionalOwner)) {
            throw 'VM identity does not match owned state; refusing deletion.'
        }
        if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force -ErrorAction Stop }
        Remove-VM -VM $vm -Force -ErrorAction Stop
        $remaining = @(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $State.vmName -or [guid]$_.Id -eq $vmId })
        if ($remaining.Count -ne 0) { throw 'VM removal was not verified; runner instance files and state are retained.' }
    }
    Assert-RunnerInstanceUnreferenced $State
    $instancePath = Assert-OwnedPath $State.instancePath
    if (Test-Path -LiteralPath $instancePath) {
        $links = @(Get-ChildItem -LiteralPath $instancePath -Recurse -Force -ErrorAction Stop |
            Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
        if ($links.Count -gt 0) { throw 'Refusing recursive deletion of an instance containing a reparse point.' }
        Remove-Item -LiteralPath $instancePath -Recurse -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $script:RunnerStatePath) {
        Remove-Item -LiteralPath $script:RunnerStatePath -Force
    }
}

. (Join-Path $PSScriptRoot 'PreparedImage.ps1')

function Invoke-RunnerReceiptNative([string] $Executable, [string[]] $Arguments, [ValidateRange(1, 30)][int] $TimeoutSeconds = 12) {
    # Only a fixed non-secret guest receipt is captured. Limit memory before
    # appending, discard stderr, and bound the SSH process independently.
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true; $start.RedirectStandardInput = $true
    $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $process = [Diagnostics.Process]::Start($start)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        $process.StandardInput.Close()
        $discard = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        $buffer = New-Object char[] 512
        $output = [Text.StringBuilder]::new()
        while ($true) {
            $read = $process.StandardOutput.ReadAsync($buffer, 0, $buffer.Length)
            while (-not $read.IsCompleted) {
                if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) { throw 'Receipt transport timed out.' }
                [void]$read.Wait(100)
            }
            $length = $read.GetAwaiter().GetResult()
            if ($length -eq 0) { break }
            if ($output.Length + $length -gt 4096) { throw 'Guest receipt exceeded its bounded protocol.' }
            [void]$output.Append($buffer, 0, $length)
            if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) { throw 'Receipt transport timed out.' }
        }
        $remaining = [Math]::Max(1, [int](($TimeoutSeconds - $clock.Elapsed.TotalSeconds) * 1000))
        if (-not $process.WaitForExit($remaining)) { throw 'Receipt transport timed out.' }
        [void]$discard.GetAwaiter().GetResult()
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output.ToString() }
    } finally {
        # This kills only the host SSH monitor, never the detached guest service.
        if (-not $process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
}
