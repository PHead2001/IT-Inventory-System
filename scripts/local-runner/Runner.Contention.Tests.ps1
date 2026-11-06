# Pure failure-path cases plus opt-in REAL, unscaled, independent-process waits.
# All providers/receipts are mocked; kernel locks use only a GUID TEMP namespace.
param([switch] $NativeContention)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
$runnerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($n in $runnerAst.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $n.Extent.Text }
$script:actualElapsed = (Get-Command Get-RunnerMonitorElapsedMs).ScriptBlock
$script:actualProcessIdentity = (Get-Command Test-RunnerProcessIdentity).ScriptBlock
$script:actualLock = (Get-Command Enter-RunnerLock).ScriptBlock
$script:actualExit = (Get-Command Exit-RunnerLock).ScriptBlock
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-contention-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
$script:checks = 0; $script:native = $false; $holder = $null
function Require([bool] $Condition, [string] $Why) { if (-not $Condition) { throw $Why } }
function Check([string] $Name, [scriptblock] $Work) { & $Work; Require ($null -eq $script:RunnerMonitorLockBudget -and -not $script:RunnerMonitorContentionActive -and $script:depth -eq 0) 'Leaked monitor scope or mutex.'; $script:checks++; Write-Host "PASS $Name" }
function Failure([scriptblock] $Work) { try { & $Work | Out-Null } catch { return $_ }; throw 'Expected refusal.' }
function Get-RunnerMonitorElapsedMs { if ($script:native) { return & $script:actualElapsed }; return $script:elapsed }
function Get-RunnerRecoveryNow { if ($script:native) { return [DateTime]::UtcNow }; return $script:clock }
function Test-RunnerProcessIdentity($ProcessId, $StartUtc) { if ($script:native) { return & $script:actualProcessIdentity $ProcessId $StartUtc }; return -not $script:deadGuardian }
function Enter-RunnerLock {
    $script:lockCalls++
    if (-not $script:native -and $script:busy -gt 0) {
        $script:busy--; $script:elapsed += 20000; $script:clock = $script:clock.AddSeconds(20)
        if ($null -ne $script:onBusy) { & $script:onBusy }
        throw (New-RunnerLockBusyFailure 'state' 20000)
    }
    if (-not $script:native -and $script:lockFailure) { throw $script:lockFailure }
    if ($script:native) { $lock = & $script:nativeLock; $script:depth++; return $lock }
    $script:depth++; return 'fixture'
}
function Exit-RunnerLock($Mutex) { $script:depth--; if ($script:native) { & $script:actualExit $Mutex } }
function Get-RunnerState { return $script:state }
function Save-Heartbeat {}
function Test-RunnerSessionStopRequested($State, $Observation = $null) { if ($null -ne $Observation) { $Observation.Value = if ($script:stop) { 'instance-marker' } else { 'none' } }; return $script:stop }
function Get-SshArgs { return @() }
function Invoke-RunnerReceiptNative($Executable, $Arguments, $TimeoutSeconds = 12, $TimeoutMilliseconds = 0) {
    $script:receipts++; $script:receiptBudget = $TimeoutMilliseconds
    if ($null -ne $script:onReceipt) { & $script:onReceipt $TimeoutMilliseconds }
    return [pscustomobject]@{ ExitCode = 0; Output = ('c' * 32) + '|123|exited|0' }
}
function Save-RunnerLaunchEvent($State, $Event, $RunnerId, $LaunchId, $ExitCode) { Require ($Event -ceq 'runner-exited') 'Unexpected launch event.'; $script:events++; $script:state.runnerLaunch.phase = 'runner-exited' }
function Invoke-GitHub { throw 'Forbidden registration replay.' }
function Invoke-RunnerNative { throw 'Forbidden launch replay.' }
function Start-Sleep { param($Milliseconds, $Seconds); if ($script:native) { Microsoft.PowerShell.Utility\Start-Sleep @PSBoundParameters } elseif ($null -ne $script:onSleep) { & $script:onSleep $Milliseconds } }
function Reset-Case {
    $script:clock = [DateTime]::UtcNow; $script:elapsed = 0; $script:busy = 0; $script:onBusy = $null; $script:lockFailure = $null
    $script:lockCalls = 0; $script:depth = 0; $script:stop = $false; $script:deadGuardian = $false; $script:receipts = 0; $script:events = 0
    $script:onSleep = $null; $script:onReceipt = $null; $script:receiptBudget = 0
    $script:state = [pscustomobject]@{
        layoutVersion = 2; tag = $script:RunnerTag; purpose = 'job'; vmName = 'ITIR-' + ('a' * 32); vmId = '00000000-0000-0000-0000-000000000001'
        instancePath = Join-Path (Join-Path $root 'instances') ('ITIR-' + ('a' * 32)); deadlineUtc = $script:clock.AddMinutes(5).ToString('o')
        supervisorPid = $PID; supervisorStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
        guardianPid = $PID; guardianStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'); guardianReady = $true
        runnerLaunch = [pscustomobject]@{ phase = 'launch-intent'; launchId = 'c' * 32; runnerId = 123 }
        networkRecovery = [pscustomobject]@{ generation = 0; phase = 'healthy'; progressUtc = $script:clock.ToString('o'); hardDeadlineUtc = $script:clock.AddMinutes(5).ToString('o'); episodeDeadlineUtc = '' }
    }
    $script:admission = New-RunnerMonitorAdmission $script:state
}
try {
    Check 'only exact validated state-lock busy tag is retryable' {
        Reset-Case
        foreach ($ex in @([TimeoutException]::new('same text'), [UnauthorizedAccessException]::new('ACL'), [InvalidOperationException]::new('busy'), (New-RunnerLockBusyFailure 'control' 0))) {
            Require (-not (Test-RunnerStateLockBusy (Failure { throw $ex }))) 'Unrelated error became retryable.'
        }
        Require (Test-RunnerStateLockBusy (Failure { throw (New-RunnerLockBusyFailure 'state' 20000) })) 'Validated busy lost classification.'
    }
    Check 'simulated busy retries only exact receipt monitoring after dispatch' {
        Reset-Case; $script:busy = 1
        Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = 'fixture' }) $script:admission
        Require ($script:receipts -eq 1 -and $script:events -eq 1) 'Monitor duplicated an operation.'
    }
    Check 'simulated permanent contention has one total budget including initial wait' {
        Reset-Case; $script:busy = 10
        [void](Failure { Wait-DetachedRunner $script:state ([pscustomobject]@{}) $script:admission })
        Require ($script:lockCalls -eq 2 -and $script:receipts -eq 0) 'Contention renewed its budget or queried guest without state.'
    }
    Check 'partial successful state reads cannot renew an interrupted transaction budget' {
        Reset-Case; $script:workCalls = 0
        [void](Failure {
            Invoke-RunnerMonitorTransaction $script:state $script:admission {
                $script:workCalls++; $script:elapsed += 20000
                throw (New-RunnerLockBusyFailure 'state' 20000)
            }
        })
        Require ($script:workCalls -eq 2 -and $script:receipts -eq 0) 'A partial success reset contention budget.'
    }
    Check 'contention followed by ongoing recovery cannot escape the monitor budget through available locks' {
        Reset-Case; $script:busy = 1
        $script:onBusy = { $script:state.networkRecovery.phase = 'isolated'; $script:state.networkRecovery.episodeDeadlineUtc = $script:clock.AddSeconds(120).ToString('o') }
        $script:onSleep = {
            param($Ms)
            $script:elapsed += $Ms; $script:clock = $script:clock.AddMilliseconds($Ms)
            $script:state.networkRecovery.progressUtc = $script:clock.ToString('o')
            if ($script:elapsed -ge 40000) { throw 'Fixture exceeded intended monitor bound.' }
        }
        $failure = Failure { Wait-DetachedRunner $script:state ([pscustomobject]@{}) $script:admission }
        Require ($script:elapsed -ge 30000 -and $script:elapsed -lt 31000 -and $script:receipts -eq 0 -and $failure.Exception.Message -cne 'Fixture exceeded intended monitor bound.') 'Available-lock recovery renewed or bypassed the monitor budget.'
    }
    Check 'contention followed by slow receipt receives only the remaining transport budget' {
        Reset-Case; $script:busy = 1
        $script:onBusy = { $script:elapsed = 29000; $script:clock = $script:clock.AddSeconds(9); $script:state.networkRecovery.progressUtc = $script:clock.ToString('o') }
        $script:onReceipt = {
            param($Ms)
            $script:elapsed += $(if ($Ms -gt 0) { $Ms } else { 12000 })
            throw 'Receipt transport timed out.'
        }
        [void](Failure { Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = 'fixture' }) $script:admission })
        Require ($script:receipts -eq 1 -and $script:receiptBudget -gt 0 -and $script:receiptBudget -le 1000 -and $script:elapsed -le 30000 -and $script:events -eq 0) 'Receipt transport ignored remaining monitor budget.'
    }
    Check 'actual detached monitor preserves valid thirty-five-second recovery without any lock timeout' {
        Reset-Case
        $script:state.networkRecovery.phase = 'isolated'; $script:state.networkRecovery.episodeDeadlineUtc = $script:clock.AddSeconds(120).ToString('o')
        $script:onSleep = {
            param($Ms)
            $script:elapsed += $Ms; $script:clock = $script:clock.AddMilliseconds($Ms); $script:state.networkRecovery.progressUtc = $script:clock.ToString('o')
            if ($script:elapsed -ge 35000) { $script:state.networkRecovery.phase = 'healthy' }
            if ($script:elapsed -gt 36000) { throw 'Fixture exceeded valid ordinary recovery.' }
        }
        Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = 'fixture' }) $script:admission
        Require ($script:elapsed -eq 35000 -and $script:receipts -eq 1 -and $script:events -eq 1 -and $script:receiptBudget -eq 12000) 'Detached monitor shortened ordinary recovery or its normal receipt timeout.'
    }
    Check 'ordinary nonmonitor liveness retains recovery beyond thirty seconds and its full outage deadline' {
        foreach ($recoverAt in @(35000, 0)) {
            Reset-Case; $script:recoverAt = $recoverAt
            $script:state.networkRecovery.phase = 'isolated'; $script:state.networkRecovery.episodeDeadlineUtc = $script:clock.AddSeconds(120).ToString('o')
            $script:onSleep = {
                param($Ms)
                $script:elapsed += $Ms; $script:clock = $script:clock.AddMilliseconds($Ms); $script:state.networkRecovery.progressUtc = $script:clock.ToString('o')
                if ($script:recoverAt -gt 0 -and $script:elapsed -ge $script:recoverAt) { $script:state.networkRecovery.phase = 'healthy' }
                if ($script:elapsed -gt 121000) { throw 'Fixture exceeded configured outage.' }
            }
            if ($recoverAt) { Assert-SessionAlive $script:state; Require ($script:elapsed -eq 35000) 'Ordinary recovery was shortened to monitor budget.' }
            else { [void](Failure { Assert-SessionAlive $script:state }); Require ($script:elapsed -eq 120000) 'Ordinary outage deadline changed.' }
        }
    }
    Check 'ACL and unrelated provider TimeoutException are fatal without a retry' {
        foreach ($ex in @([UnauthorizedAccessException]::new('ACL'), [TimeoutException]::new('provider'))) {
            Reset-Case; $script:lockFailure = $ex
            [void](Failure { Wait-DetachedRunner $script:state ([pscustomobject]@{}) $script:admission })
            Require ($script:lockCalls -eq 1 -and $script:receipts -eq 0) 'Unrelated failure was retried.'
        }
    }
    Check 'Stop deadline VM session guardian generation and expiry fail closed after simulated wait' {
        foreach ($change in @('stop', 'deadline', 'vm', 'session', 'owner', 'guardian', 'generation', 'dead', 'progress', 'episode')) {
            Reset-Case; $script:busy = 1; $script:change = $change
            $script:onBusy = {
                switch ($script:change) {
                    'stop' { $script:stop = $true }
                    'deadline' { $script:clock = $script:clock.AddMinutes(6) }
                    'vm' { $script:state.vmId = '00000000-0000-0000-0000-000000000002' }
                    'session' { $script:state.vmName = 'ITIR-' + ('b' * 32) }
                    'owner' { $script:state.supervisorStartUtc = $script:clock.ToString('o') }
                    'guardian' { $script:state.guardianStartUtc = $script:clock.ToString('o') }
                    'generation' { $script:state.networkRecovery.generation++ }
                    'dead' { $script:deadGuardian = $true }
                    'progress' { $script:state.networkRecovery.progressUtc = $script:clock.AddSeconds(-31).ToString('o') }
                    'episode' { $script:state.networkRecovery.phase = 'isolated'; $script:state.networkRecovery.episodeDeadlineUtc = $script:clock.AddSeconds(-1).ToString('o') }
                }
            }
            [void](Failure { Wait-DetachedRunner $script:state ([pscustomobject]@{}) $script:admission })
            Require ($script:receipts -eq 0 -and $script:events -eq 0) "Unsafe monitor continued after $change."
        }
    }
    Check 'control diagnostics retain only fixed purpose duration and stage and old records remain readable' {
        Reset-Case
        $record = New-RunnerSessionFailureRecord (Failure { throw (New-RunnerLockBusyFailure 'state' 20000) }) 'job-execution'
        Require ($record.capture -ceq 'complete' -and $record.controlDiagnostic.purpose -ceq 'state' -and $record.controlDiagnostic.waitMs -eq 20000) 'Diagnostic projection lost lock evidence.'
        $journal = [pscustomobject]@{ schema = 1; sessions = @([pscustomobject]@{ sessionId = 'a' * 32; vmId = $null; first = $record; latest = $record }) } | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        Assert-RunnerSessionFailureJournal $journal
        $journal.sessions[0].first.PSObject.Properties.Remove('controlDiagnostic'); $journal.sessions[0].latest.PSObject.Properties.Remove('controlDiagnostic')
        Assert-RunnerSessionFailureJournal $journal
        $bad = [pscustomobject]@{ purpose = 'state'; waitMs = 2; preflightStage = ''; token = 'SECRET' }
        [void](Failure { Assert-RunnerControlDiagnostic $bad })
    }
    if ($NativeContention) {
        . (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
        $lockName = 'Local\' + [IO.Path]::GetFileName($root)
        # Only substitute the kernel object's name; ACL fixtures still reject
        # canonical runner names. All timeout/classification code is production.
        $script:nativeLock = [scriptblock]::Create($script:actualLock.ToString().Replace('Global\ITInventoryLocalRunner-v1', $lockName))
        $child = Join-Path $root 'holder.ps1'
        [IO.File]::WriteAllText($child, @'
param($Root, $Source, $LockName, [int]$HoldSeconds)
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
. (Join-Path $Source 'Common.ps1')
. (Join-Path $Source 'Test.Mutex.ps1')
$lock = $null
try {
    $lock = Enter-RunnerLock $LockName
    [IO.File]::WriteAllText((Join-Path $Root 'ready'), 'ready')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt $HoldSeconds -and -not (Test-Path -LiteralPath (Join-Path $Root 'release'))) { Start-Sleep -Milliseconds 25 }
} finally { if ($null -ne $lock) { Exit-RunnerLock $lock } }
$exitLimit = [DateTime]::UtcNow.AddSeconds(8)
while (-not (Test-Path -LiteralPath (Join-Path $Root 'release')) -and [DateTime]::UtcNow -lt $exitLimit) { Start-Sleep -Milliseconds 25 }
[IO.File]::WriteAllText((Join-Path $Root 'completed'), 'released-disposed')
'@, [Text.UTF8Encoding]::new($false))
        foreach ($seconds in @(22, 45)) {
            Check "REAL independent-process contention hold=$seconds seconds" {
                Reset-Case; $script:native = $true
                foreach ($file in @('ready', 'release', 'completed')) { $p = Join-Path $root $file; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p } }
                $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $child, $root, $PSScriptRoot, $lockName, [string]$seconds)
                $holder = Start-Process (Join-Path $PSHOME 'powershell.exe') -ArgumentList (($args | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ') -WindowStyle Hidden -PassThru
                try {
                    $readyLimit = [DateTime]::UtcNow.AddSeconds(8)
                    while (-not (Test-Path -LiteralPath (Join-Path $root 'ready')) -and -not $holder.HasExited -and [DateTime]::UtcNow -lt $readyLimit) { Microsoft.PowerShell.Utility\Start-Sleep -Milliseconds 25 }
                    Require ((Test-Path -LiteralPath (Join-Path $root 'ready')) -and -not $holder.HasExited) 'Independent holder failed readiness.'
                    $script:state.guardianPid = $holder.Id; $script:state.guardianStartUtc = $holder.StartTime.ToUniversalTime().ToString('o')
                    $script:admission = New-RunnerMonitorAdmission $script:state
                    $watch = [Diagnostics.Stopwatch]::StartNew()
                    $failure = $null
                    try { Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = 'fixture' }) $script:admission } catch { $failure = $_ }
                    $ms = $watch.ElapsedMilliseconds
                    if ($seconds -eq 22) { Require ($null -eq $failure -and $ms -ge 20000 -and $ms -lt 30000 -and $script:receipts -eq 1 -and $script:events -eq 1) 'Real recoverable contention killed or duplicated the dispatched monitor.' }
                    else { Require ($null -ne $failure -and $ms -ge 29000 -and $ms -lt 33000 -and $script:receipts -eq 0) 'Real permanent contention escaped total bound.' }
                    Require ($holder.PeakWorkingSet64 -lt 536870912) 'Holder exceeded 512 MiB.'
                    [IO.File]::WriteAllText((Join-Path $root 'release'), 'release')
                    Require ($holder.WaitForExit(4000) -and $holder.ExitCode -eq 0) 'Independent holder did not exit cleanly.'
                    Require ([IO.File]::ReadAllText((Join-Path $root 'completed')) -ceq 'released-disposed') 'Holder did not release and dispose its mutex.'
                    $lock = & $script:nativeLock -FailFast
                    & $script:actualExit $lock
                    Write-Host "Measured independent-process wait ${ms}ms; receipt=$script:receipts; exit/disposal/readback passed."
                } finally {
                    if (-not $holder.HasExited) { $holder.Kill(); Require ($holder.WaitForExit(4000)) 'Fixture holder termination unverified.' }
                    $holder.Dispose(); $holder = $null; $script:native = $false
                }
            }
        }
    }
    Write-Host "Runner contention regressions passed: $script:checks cases. Provider/ACL/receipt operations remain mocked; native kernel waits only with -NativeContention."
} finally {
    if ($null -ne $holder) { if (-not $holder.HasExited) { $holder.Kill(); [void]$holder.WaitForExit(4000) }; $holder.Dispose() }
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -cnotmatch '^ITIR-contention-[0-9a-f]{32}$') { throw 'Fixture cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
