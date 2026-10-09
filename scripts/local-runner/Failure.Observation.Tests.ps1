# Pure AST-extracted guards and diagnostic IO mocks. No imports, host providers,
# real mutexes, installed state, credentials, network or filesystem writes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
foreach ($file in @('Common.ps1', 'Runner.ps1', 'Network.Recovery.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$null, [ref]$null)
    foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
        if ($definition.Name -cin @('New-RunnerFailureObservation', 'New-RunnerObservedFailure', 'Write-RunnerCleanupObservation', 'Assert-RunnerFailureRecord', 'Assert-RunnerCleanupJournal',
            'Test-RunnerSessionStopRequested', 'Assert-SessionAlive', 'Get-RunnerRecoveryExpiry', 'Invoke-Watchdog')) {
            Invoke-Expression $definition.Extent.Text
        }
    }
}
$script:RunnerRoot = 'C:\synthetic-runner'; $script:RunnerStatePath = 'C:\synthetic-runner\state.json'
$script:checks = 0
function Check([string] $Name, [scriptblock] $Work) { & $Work; $script:checks++; Write-Host "PASS $Name" }
function Require([bool] $Condition) { if (-not $Condition) { throw 'Diagnostic regression assertion failed.' } }
function Reset-Fixture {
    $script:now = [DateTime]::UtcNow
    $script:state = [pscustomobject]@{
        vmName = 'ITIR-11111111111111111111111111111111'; vmId = '11111111-1111-1111-1111-111111111111'; instancePath = 'C:\synthetic-runner\instance'
        purpose = 'prepare'; phase = 'sealed-off'; deadlineUtc = $script:now.AddHours(1).ToString('o')
        supervisorPid = 11; supervisorStartUtc = $script:now.ToString('o'); guardianPid = 22; guardianStartUtc = 'fixture'; guardianReady = $true
        networkRecovery = [pscustomobject]@{ phase = 'healthy'; progressUtc = $script:now.AddSeconds(-1).ToString('o');
            hardDeadlineUtc = $script:now.AddHours(1).ToString('o'); episodeDeadlineUtc = ''; generation = 1; failure = '' }
    }
    $script:reads = 0; $script:vanishAt = 0; $script:rootStop = $false; $script:localStop = $false
    $script:guardianAlive = $true; $script:ownerAlive = $true; $script:identityCalls = 0
    $script:heartbeat = 0; $script:record = $null; $script:recordPath = ''; $script:writes = 0
    $script:writeFails = $false; $script:removed = $false; $script:sealedInvalid = $false
    $script:events = @(); $script:warnings = @()
    $script:journal = $null; $script:cleanupFails = $false
}
function Get-RunnerRecoveryNow { return $script:now }
function Get-RunnerState { $script:reads++; if ($script:vanishAt -and $script:reads -ge $script:vanishAt) { return $null }; return $script:state }
function Test-Path([string] $LiteralPath) {
    if ($LiteralPath -ceq (Join-Path $script:RunnerRoot 'stop.requested')) { return $script:rootStop }
    if ($LiteralPath -ceq (Join-Path $script:state.instancePath 'stop.requested')) { return $script:localStop }
    return $null -ne $script:record
}
function Assert-RunnerProtectedPath {}
function Assert-StateIdentity {}
function Save-Heartbeat { $script:heartbeat++ }
function Test-RunnerProcessIdentity([int] $ProcessId) {
    $script:identityCalls++
    if ($ProcessId -eq 11) { return $script:ownerAlive }
    return $script:guardianAlive
}
function Assert-RunnerSealedPreparation { if ($script:sealedInvalid) { throw 'SECRET sealed reason' } }
function Assert-OwnedPath([string] $Path) { return $Path }
function Write-RunnerJson([string] $Path, $Value) {
    if ($script:writeFails) { throw 'SECRET C:\credential secret-token' }
    if ($Path -ceq $script:RunnerStatePath) { $script:events += 'state-write'; return }
    $script:writes++; $script:journal = $Value | ConvertTo-Json -Depth 6 -Compress | ConvertFrom-Json
    $script:record = $script:journal.latest
    $script:recordPath = $Path; $script:events += 'capture'
}
function Read-RunnerJson { return $script:journal }
function Write-Warning([string] $Message, [string] $WarningAction) { $script:warnings += $Message }
function Assert-Administrator {}
function Assert-SecureRoot {}
function Enter-RunnerLock { $script:events += 'lock'; return 'mock-lock' }
function Exit-RunnerLock { $script:events += 'unlock' }
function Invoke-RunnerSupervisorRecovery {}
function Remove-RunnerInstance { $script:events += 'cleanup'; if ($script:cleanupFails) { throw 'SECRET cleanup failure' }; $script:removed = $true }
function Write-RunnerFailure {}
function Get-Failure([scriptblock] $Work) { try { & $Work } catch { return $_ }; throw 'Expected guard failure.' }

Check 'Stop decision is captured from the same disappearing-state read, preserving the boolean API' {
    Reset-Fixture
    $script:rootStop = $true; $script:vanishAt = 3
    $errorRecord = Get-Failure { Assert-SessionAlive $script:state }
    Require ($errorRecord.Exception.Message -ceq 'Session deadline or Stop reached.')
    $data = $errorRecord.Exception.Data['runnerFailureObservation']
    Require ($data.origin -ceq 'session-current' -and $data.reason -ceq 'stop' -and $data.stopReason -ceq 'state-absent')
    Require ($script:reads -eq 3 -and $script:heartbeat -eq 1 -and $script:identityCalls -eq 0)
    Reset-Fixture
    $reason = ''; $requested = Test-RunnerSessionStopRequested $script:state ([ref]$reason)
    Require ($requested -is [bool] -and -not $requested -and $reason -ceq 'none')
    $script:localStop = $true
    $requested = Test-RunnerSessionStopRequested $script:state
    Require ($requested -is [bool] -and $requested)
}
Check 'deadline retains short circuit and original error when diagnostic data is malformed' {
    Reset-Fixture
    $script:state.deadlineUtc = $script:now.AddSeconds(-1).ToString('o')
    $script:state.networkRecovery.progressUtc = 'SECRET invalid timestamp'
    $errorRecord = Get-Failure { Assert-SessionAlive $script:state }
    Require ($errorRecord.Exception.Message -ceq 'Session deadline or Stop reached.')
    Require ($script:reads -eq 0 -and $script:heartbeat -eq 0 -and $script:identityCalls -eq 0)
    Require ($errorRecord.Exception.Data['runnerFailureObservation'].capture -ceq 'unavailable')
}
Check 'Stop predicate keeps all claim and purpose decisions with and without observation' {
    foreach ($case in @('none', 'instance-marker', 'state-absent', 'claim-mismatch', 'purpose-ineligible')) {
        Reset-Fixture
        $caller = $script:state | ConvertTo-Json -Depth 4 | ConvertFrom-Json
        $script:rootStop = $true
        if ($case -ceq 'instance-marker') { $script:localStop = $true }
        if ($case -ceq 'state-absent') { $script:vanishAt = 1 }
        if ($case -ceq 'claim-mismatch') { $script:state.vmName = 'different' }
        if ($case -ceq 'purpose-ineligible') { $script:state.purpose = 'job' }
        $reason = ''; $observed = Test-RunnerSessionStopRequested $caller ([ref]$reason)
        $legacy = Test-RunnerSessionStopRequested $caller
        Require ($observed -is [bool] -and $legacy -is [bool] -and $observed -eq $legacy)
        Require ($reason -ceq $case -and $observed -eq ($case -cne 'none'))
    }
}
Check 'guardian identity, failed phase and exact expiry are distinct without reevaluation' {
    foreach ($case in @('guardian-identity', 'guardian-failed', 'recovery-expiry')) {
        Reset-Fixture
        if ($case -ceq 'guardian-identity') { $script:guardianAlive = $false }
        if ($case -ceq 'guardian-failed') { $script:state.networkRecovery.phase = 'failed' }
        if ($case -ceq 'recovery-expiry') { $script:state.networkRecovery.progressUtc = $script:now.AddSeconds(-31).ToString('o') }
        $errorRecord = Get-Failure { Assert-SessionAlive $script:state }
        Require ($errorRecord.Exception.Message -ceq 'Session network guardian failed or expired.')
        $data = $errorRecord.Exception.Data['runnerFailureObservation']
        Require ($data.reason -ceq $case -and $script:identityCalls -eq 1 -and $script:reads -eq 1)
        if ($case -ceq 'recovery-expiry') { Require ($data.expiry -ceq 'guardian-progress-expired' -and $data.progressAgeMs -eq 31000) }
        else { Require ($data.expiry -ceq '') }
    }
}
Check 'projection excludes secret sentinels, raw state, paths and unknown enum values' {
    Reset-Fixture
    $script:state | Add-Member secret 'SECRET credential/network/token'
    $script:state.purpose = 'SECRET'; $script:state.phase = 'SECRET'; $script:state.vmName = 'SECRET'
    $script:state.networkRecovery.phase = 'SECRET'; $script:state.networkRecovery.failure = 'SECRET'
    $data = New-RunnerFailureObservation 'SECRET' 'SECRET' $script:state $script:now 'SECRET' 'SECRET' @{ secret = 'SECRET' }
    $json = ConvertTo-Json -InputObject $data -Depth 4 -Compress
    Require ($json -cnotmatch 'SECRET|synthetic-runner|11111111|credential|token' -and $data.capture -ceq 'complete')
    Require ([Text.Encoding]::UTF8.GetByteCount($json) -le 2048)
}
Check 'fixed versioned precleanup record overwrites within bound and IO failure cannot stop cleanup' {
    Reset-Fixture
    Write-RunnerCleanupObservation 'watchdog' 'watchdog-condition' $script:state $script:now '' '' @{ ownerAlive = $false }
    $firstPath = $script:recordPath
    Write-RunnerCleanupObservation 'guardian-catch' 'guard-exception' $script:state $script:now
    Require ($script:writes -eq 2 -and $script:record.schema -eq 1 -and $script:record.origin -ceq 'guardian-catch')
    Require ($firstPath -ceq $script:recordPath -and $script:recordPath -ceq (Join-Path $script:RunnerRoot 'failure-cleanup.json'))
    $script:writeFails = $true
    Write-RunnerCleanupObservation 'watchdog' 'watchdog-condition' $script:state $script:now
    Remove-RunnerInstance $script:state
    Require ($script:removed -and $script:warnings.Count -eq 1 -and $script:warnings[0] -ceq 'RUNNER_FAILURE_CAPTURE_UNAVAILABLE')
}
Check 'actual watchdog records its evaluated reasons under the existing lock before cleanup' {
    Reset-Fixture
    $script:ownerAlive = $false; $script:state.networkRecovery.progressUtc = $script:now.AddSeconds(-31).ToString('o')
    Invoke-Watchdog
    Require ($script:removed -and $script:record.origin -ceq 'watchdog')
    Require (-not $script:record.checks.ownerAlive -and $script:record.checks.recoveryExpired)
    Require ($script:record.expiry -ceq 'guardian-progress-expired')
    Require ($script:events[0] -ceq 'lock' -and [array]::IndexOf($script:events, 'capture') -lt [array]::IndexOf($script:events, 'cleanup') -and $script:events[-1] -ceq 'unlock')
}
Check 'healthy liveness path adds no evidence write or extra state read' {
    Reset-Fixture
    Assert-SessionAlive $script:state
    Require ($script:writes -eq 0 -and $script:reads -eq 1 -and $script:heartbeat -eq 1 -and $script:identityCalls -eq 1)
}
Check 'watchdog sealed failure retains a bounded source location without the exception text' {
    Reset-Fixture
    $script:sealedInvalid = $true
    Invoke-Watchdog
    Require ($script:removed -and $script:record.checks.sealedInvalid -and $script:record.errorLine -gt 0)
    Require (($script:record | ConvertTo-Json -Depth 4 -Compress) -cnotmatch 'SECRET|sealed reason|Failure.Observation.Tests')
}
Check 'actual guardian catch preserves the original error when capture IO fails' {
    Reset-Fixture
    $SessionName = $script:state.vmName; $script:writeFails = $true
    $script:originalFailure = [InvalidOperationException]::new('SECRET original sentinel')
    $runnerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
    $handler = @($runnerAst.FindAll({ param($node)
        $node -is [Management.Automation.Language.CatchClauseAst] -and $node.Body.Extent.Text.Contains("Write-RunnerFailure 'network-guard'")
    }, $true))
    Require ($handler.Count -eq 1)
    $work = [scriptblock]::Create('try { throw $script:originalFailure } catch ' + $handler[0].Body.Extent.Text)
    $errorRecord = Get-Failure $work
    Require ([Object]::ReferenceEquals($errorRecord.Exception, $script:originalFailure))
    Require ($script:removed -and $script:warnings.Count -eq 1 -and $script:events[-1] -ceq 'unlock')
    Reset-Fixture
    $errorRecord = Get-Failure $work
    Require ($script:record.origin -ceq 'guardian-catch' -and $script:record.errorSource -ceq 'other')
    Require (($script:record | ConvertTo-Json -Depth 4 -Compress) -cnotmatch 'SECRET|sentinel|originalFailure')
}
Check 'initiating watchdog evidence survives cleanup throw, guardian catch and repeated retry' {
    Reset-Fixture
    $SessionName = $script:state.vmName
    $script:ownerAlive = $false; $script:cleanupFails = $true
    $runnerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
    $handler = $runnerAst.Find({ param($node) $node -is [Management.Automation.Language.CatchClauseAst] -and $node.Body.Extent.Text.Contains("Write-RunnerFailure 'network-guard'") }, $true)
    $work = [scriptblock]::Create('try { Invoke-Watchdog } catch ' + $handler.Body.Extent.Text)
    $failure = Get-Failure $work
    Require ($failure.Exception.Message -ceq 'SECRET cleanup failure')
    Require ($script:journal.schema -eq 2 -and $script:journal.first.origin -ceq 'watchdog' -and $script:journal.latest.origin -ceq 'guardian-catch')
    $first = $script:journal.first | ConvertTo-Json -Depth 4 -Compress
    $null = Get-Failure $work
    Require (($script:journal.first | ConvertTo-Json -Depth 4 -Compress) -ceq $first)
    Require ([Text.Encoding]::UTF8.GetByteCount(($script:journal | ConvertTo-Json -Depth 6 -Compress)) -le 4096)
    Require (($script:journal | ConvertTo-Json -Depth 6 -Compress) -cnotmatch 'SECRET|synthetic-runner|cleanup failure')
}
Check 'new exact instance rotates evidence and malformed existing evidence is retained' {
    Reset-Fixture
    Write-RunnerCleanupObservation 'watchdog' 'watchdog-condition' $script:state $script:now
    $oldIdentity = $script:journal.identity.sessionId
    $script:state.vmName = 'ITIR-22222222222222222222222222222222'
    $script:state.vmId = '22222222-2222-2222-2222-222222222222'
    $script:state.supervisorStartUtc = $script:now.AddSeconds(1).ToString('o')
    $script:state.networkRecovery.progressUtc = 'malformed SECRET'
    Write-RunnerCleanupObservation 'guardian-catch' 'guard-exception' $script:state $script:now.AddSeconds(2)
    Require ($script:journal.identity.sessionId -cne $oldIdentity -and $script:journal.first.capture -ceq 'unavailable')
    Require ($script:journal.first.atUtc -ceq $script:now.AddSeconds(2).ToString('o'))
    $script:journal | Add-Member unknown 'SECRET'
    $writes = $script:writes
    Write-RunnerCleanupObservation 'watchdog' 'watchdog-condition' $script:state $script:now
    Require ($script:writes -eq $writes -and $script:warnings[-1] -ceq 'RUNNER_FAILURE_CAPTURE_UNAVAILABLE')
    Require ($script:journal.unknown -ceq 'SECRET')
}
Write-Host "Failure observation passed: $script:checks pure guard/capture regressions. No host providers or files touched."
