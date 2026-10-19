# Windows PowerShell 5.1 executable projection and atomic IO regressions.
# Only a disposable TEMP root is written; host providers/real locks are mocked.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$common = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Common.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $common.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    if ($definition.Name -cin @('New-RunnerExecutionFailure', 'Get-RunnerSessionFailureEnums', 'New-RunnerSessionFailureRecord', 'Assert-RunnerSessionFailureJournal', 'Write-RunnerSessionFailure', 'Write-RunnerJson', 'Read-RunnerJson')) { Invoke-Expression $definition.Extent.Text }
}
$script:RunnerRoot = Join-Path $env:TEMP ('ITIR-session-failure-' + [guid]::NewGuid().ToString('N'))
$script:path = Join-Path $script:RunnerRoot 'session-failures.json'
$script:depth = 0; $script:warnings = @(); $script:checks = 0; $script:state = $null; $script:readFails = $false
$script:writeFails = $false; $script:cleanupFails = $false; $script:cleanupCalls = 0; $script:events = @(); $script:lockCalls = 0; $script:oldFailureWriteFails = $false
$script:RunnerOperationStage = 'job-execution'
function Require([bool] $Condition) { if (-not $Condition) { throw 'Session failure regression assertion failed.' } }
function Check([string] $Name, [scriptblock] $Work) { & $Work; $script:checks++; Write-Host "PASS $Name" }
function Enter-RunnerLock { $script:depth++; $script:lockCalls++; return 'fixture' }
function Exit-RunnerLock { $script:depth-- }
function Assert-RunnerProtectedPath { Require ($script:depth -gt 0) }
function Assert-SecureRoot { Require ($script:depth -gt 0) }
function Assert-OwnedPath([string] $Path) {
    Require ($Path.StartsWith($script:RunnerRoot + '\', [StringComparison]::OrdinalIgnoreCase))
    if ($script:writeFails -and $Path -ceq $script:path) { throw 'SECRET_WRITE_PATH token' }
    return $Path
}
function Get-RunnerState { Require ($script:depth -gt 0); if ($script:readFails) { throw 'SECRET_STATE_READ' }; return $script:state }
function Write-Warning([string] $Message, [string] $WarningAction) { $script:warnings += $Message }
function Write-RunnerSessionFailureObservation {}
function Write-RunnerFailure { if ($script:oldFailureWriteFails) { throw 'SECRET_LEGACY_WRITE' } }
function Remove-RunnerInstance {
    $script:cleanupCalls++; $script:events += 'cleanup'
    Require (Test-Path -LiteralPath $script:path)
    if ($script:cleanupFails) { throw 'SECRET_CLEANUP' }
}
function Get-Failure([scriptblock] $Work) { try { & $Work } catch { return $_ }; throw 'Expected failure.' }
function New-FixtureFailure {
    $exception = [InvalidOperationException]::new('SECRET_MESSAGE token C:\SECRET_PATH')
    $exception.Data['SECRET_DATA'] = @{ secret = 'SECRET_NESTED_TOKEN' }
    return [Management.Automation.ErrorRecord]::new($exception, 'SECRET_ERROR_ID', [Management.Automation.ErrorCategory]::InvalidOperation, 'SECRET_TARGET')
}
function Reset-Case {
    if (Test-Path -LiteralPath $script:path) { Remove-Item -LiteralPath $script:path -Force }
    $script:depth = 0; $script:warnings = @(); $script:readFails = $false; $script:writeFails = $false; $script:cleanupFails = $false; $script:cleanupCalls = 0; $script:events = @(); $script:lockCalls = 0; $script:oldFailureWriteFails = $false
    $script:state = [pscustomobject]@{ vmName = 'ITIR-11111111111111111111111111111111'; vmId = '22222222-2222-2222-2222-222222222222' }
}
try {
    [void][IO.Directory]::CreateDirectory($script:RunnerRoot)
    Check 'actual thrown error excludes message stack paths arguments target data and unknown IDs' {
        Reset-Case
        $inputError = New-FixtureFailure
        $failure = Get-Failure { throw $inputError }
        Write-RunnerSessionFailure $script:state.vmName $failure 'job-execution'
        $json = [IO.File]::ReadAllText($script:path)
        Require ($json -cnotmatch 'SECRET|token|TargetObject|StackTrace|Data|\\')
        $journal = Read-RunnerJson $script:path; Assert-RunnerSessionFailureJournal $journal
        $record = $journal.sessions[0].first
        Require ($record.capture -ceq 'complete' -and $record.source -ceq 'other' -and $record.line -gt 0 -and $record.errorId -ceq 'other')
        Require ($journal.sessions[0].vmId -ceq $script:state.vmId -and $record.hResult -is [int] -and $script:depth -eq 0)
    }
    Check 'malformed objects cannot run getters and retain explicit unavailable projection' {
        Reset-Case
        $malformed = [pscustomobject]@{ Message = 'SECRET_MESSAGE' }
        $malformed | Add-Member ScriptProperty Exception { throw 'SECRET_GETTER' }
        Write-RunnerSessionFailure $script:state.vmName $malformed 'SECRET_STAGE'
        $journal = Read-RunnerJson $script:path
        Require ($journal.sessions[0].first.capture -ceq 'unavailable' -and $journal.sessions[0].first.stage -ceq 'other')
        Require (([IO.File]::ReadAllText($script:path)) -cnotmatch 'SECRET')
        $script:readFails = $true
        Write-RunnerSessionFailure $script:state.vmName (Get-Failure { throw 'SECRET_READ' }) 'cleanup'
        Require ((Read-RunnerJson $script:path).sessions[0].latest.capture -ceq 'unavailable')
    }
    Check 'trusted receipt and nonzero exit tags retain only the fixed class and integer code' {
        Reset-Case
        foreach ($class in @('runner-exit')) {
            $failure = Get-Failure { throw (New-RunnerExecutionFailure $class 27) }
            Write-RunnerSessionFailure $script:state.vmName $failure 'job-execution'
            $record = (Read-RunnerJson $script:path).sessions[0].latest
            Require ($record.failureClass -ceq $class)
            if ($class -ceq 'runner-exit') { Require ($record.exitCode -eq 27) } else { Require ($null -eq $record.exitCode) }
        }
    }
    Check 'real detached receipt monitor classifies malformed identity and nonzero exit without retaining guest output' {
        $runner = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
        $prepared = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'PreparedImage.ps1'), [ref]$null, [ref]$null)
        Invoke-Expression ($runner.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Wait-DetachedRunner' }, $false).Extent.Text)
        Invoke-Expression ($prepared.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'ConvertFrom-RunnerGuestReceipt' }, $false).Extent.Text)
        foreach ($text in @('SECRET_GUEST_OUTPUT', (('b' * 32) + '|41|running|-'), (('a' * 32) + '|41|exited|27'))) {
            Reset-Case
            $script:receiptText = $text; $script:nativeCalls = 0; $script:launchEvents = @()
            $script:state | Add-Member runnerLaunch ([pscustomobject]@{ launchId = ('a' * 32); runnerId = 41 })
            $failure = & {
                function Assert-SessionAlive {}
                function Get-RunnerState { return $script:state }
                function Get-SshArgs { return @() }
                function Get-RunnerReceiptCommand { return 'fixed-command' }
                function Invoke-RunnerReceiptNative { $script:nativeCalls++; return [pscustomobject]@{ ExitCode = 0; Output = $script:receiptText } }
                function Save-RunnerLaunchEvent($State, [string] $Event) { $script:launchEvents += $Event }
                Get-Failure { Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = '192.0.2.1' }) }
            }
            Write-RunnerSessionFailure $script:state.vmName $failure 'job-execution'
            $latest = (Read-RunnerJson $script:path).sessions[0].latest
            Require ($latest.failureClass -ceq $(if ($text.EndsWith('|27')) { 'runner-exit' } else { 'receipt-invalid' }))
            Require ($script:nativeCalls -eq 1 -and ([IO.File]::ReadAllText($script:path)) -cnotmatch 'SECRET|192\.0\.2|fixed-command')
            if ($text.EndsWith('|27')) { Require ($latest.exitCode -eq 27 -and $script:launchEvents[0] -ceq 'runner-exited') }
            else { Require ($script:launchEvents.Count -eq 0) }
            if ($text -ceq 'SECRET_GUEST_OUTPUT') { Require ($failure.Exception.Message -ceq 'Guest receipt is malformed; workflow results remain GitHub authoritative.') }
            elseif (-not $text.EndsWith('|27')) { Require ($failure.Exception.Message -ceq 'Guest receipt does not match the sole runner launch.') }
        }
    }
    Check 'eight-session bound exact first/latest retention VM promotion and no idle overwrite' {
        Reset-Case
        $failure = Get-Failure { throw 'SECRET_FIRST' }
        $script:state = $null
        $name = 'ITIR-11111111111111111111111111111111'
        Write-RunnerSessionFailure $name $failure 'job-execution'
        $first = (Read-RunnerJson $script:path).sessions[0].first | ConvertTo-Json -Compress
        $script:state = [pscustomobject]@{ vmName = $name; vmId = '22222222-2222-2222-2222-222222222222' }
        Write-RunnerSessionFailure $name (Get-Failure { throw 'SECRET_CLEANUP' }) 'cleanup'
        $journal = Read-RunnerJson $script:path
        Require (($journal.sessions[0].first | ConvertTo-Json -Compress) -ceq $first -and $journal.sessions[0].latest.stage -ceq 'cleanup' -and $null -ne $journal.sessions[0].vmId)
        $before = [IO.File]::ReadAllText($script:path)
        Write-RunnerSessionFailure $name $failure 'idle' -FirstOnly
        Write-RunnerSessionFailure '' $failure 'idle'
        Write-RunnerSessionFailure 'SECRET_SESSION' $failure 'idle'
        Write-RunnerSessionFailure ('ITIR-' + ('0' * 32)) $failure 'idle'
        Require (([IO.File]::ReadAllText($script:path)) -ceq $before)
        for ($index = 2; $index -le 12; $index++) { Write-RunnerSessionFailure ('ITIR-' + $index.ToString('x32')) $failure 'job-execution' }
        $journal = Read-RunnerJson $script:path; Assert-RunnerSessionFailureJournal $journal
        Require ($journal.sessions.Count -eq 8 -and $journal.sessions[0].sessionId -ceq (5).ToString('x32') -and (Get-Item -LiteralPath $script:path).Length -le 16384)
        Require (@(Get-ChildItem -LiteralPath $script:RunnerRoot).Count -eq 1)
    }
    Check 'oversized or corrupt history refuses before parsing and unknown fields remain retained' {
        Reset-Case
        foreach ($raw in @(('SECRET_OVERSIZE' * 1300), '{SECRET malformed', '{"schema":1,"sessions":[],"SECRET_FIELD":"SECRET"}')) {
            [IO.File]::WriteAllText($script:path, $raw)
            & {
                if ($raw.Length -gt 16384) { function Read-RunnerJson { throw 'Parser must not be reached.' } }
                Write-RunnerSessionFailure $script:state.vmName (Get-Failure { throw 'SECRET' }) 'job-execution'
            }
            Require (([IO.File]::ReadAllText($script:path)) -ceq $raw -and $script:depth -eq 0)
        }
        Require ($script:warnings.Count -eq 3 -and @($script:warnings | Where-Object { $_ -cne 'RUNNER_SESSION_FAILURE_CAPTURE_UNAVAILABLE' }).Count -eq 0)
    }
    Check 'actual session hooks retain original metadata while preserving canonical cleanup failure behavior' {
        $runner = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
        $session = $runner.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-RunnerSession' }, $false)
        $handler = $session.Find({ param($node) $node -is [Management.Automation.Language.TryStatementAst] -and $null -ne $node.Finally -and $node.Finally.Extent.Text.Contains('$verificationFailure = $null') }, $true)
        Require ($handler.CatchClauses[0].Body.Extent.Text.Contains('Write-RunnerSessionFailure $name $sessionFailure'))
        foreach ($mode in @('cleanup-success', 'cleanup-failure', 'write-failure', 'legacy-write-failure')) {
            Reset-Case
            $name = $script:state.vmName; $state = $script:state; $verificationReady = $false; $sessionFailure = $null
            $original = [InvalidOperationException]::new('SECRET_ORIGINAL')
            $script:cleanupFails = $mode -cin @('cleanup-failure', 'legacy-write-failure')
            $script:oldFailureWriteFails = $mode -ceq 'legacy-write-failure'
            $script:writeFails = $mode -ceq 'write-failure'
            # The cleanup mock inspects the existing capture; for failed IO its
            # existence predicate is replaced without touching canonical cleanup.
            $failure = & {
                if ($script:writeFails) { function Remove-RunnerInstance { $script:cleanupCalls++ } }
                $work = [scriptblock]::Create('try { throw $original } catch ' + $handler.CatchClauses[0].Body.Extent.Text + ' finally ' + $handler.Finally.Extent.Text)
                Get-Failure $work
            }
            Require ($script:cleanupCalls -eq 1 -and $script:depth -eq 0)
            if (-not $script:cleanupFails) { Require ([object]::ReferenceEquals($failure.Exception, $original)) }
            else { Require ($failure.Exception.Message -ceq $(if ($script:oldFailureWriteFails) { 'SECRET_LEGACY_WRITE' } else { 'SECRET_CLEANUP' })) }
            if ($script:writeFails) { Require ($script:warnings.Count -eq 1) }
            else {
                $journal = Read-RunnerJson $script:path
                Require ($journal.sessions[0].first.stage -ceq 'job-execution')
                Require ($journal.sessions[0].latest.stage -ceq $(if ($script:cleanupFails) { 'cleanup' } else { 'job-execution' }))
            }
        }
        $supervisor = $runner.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-SupervisorLoop' }, $false)
        Require ($supervisor.Extent.Text.Contains('Write-RunnerSessionFailure $script:RunnerSessionName $_ $script:RunnerOperationStage -FirstOnly'))
    }
    Check 'held-lock capture does not reacquire and path ACL failures cannot escape' {
        Reset-Case
        $script:depth = 1
        Write-RunnerSessionFailure $script:state.vmName (Get-Failure { throw 'SECRET' }) 'cleanup' -LockHeld
        Require ($script:lockCalls -eq 0 -and $script:depth -eq 1)
        $script:depth = 0
        & {
            function Assert-RunnerProtectedPath { throw 'SECRET_ACL' }
            Write-RunnerSessionFailure $script:state.vmName (Get-Failure { throw 'SECRET' }) 'cleanup'
        }
        Require ($script:warnings.Count -eq 1 -and $script:depth -eq 0)
    }
    Check 'healthy cleanup emits no diagnostic evidence and no extra lock acquisition' {
        Reset-Case
        Write-RunnerSessionFailure $script:state.vmName $null 'job-execution'
        Require (-not (Test-Path -LiteralPath $script:path) -and $script:lockCalls -eq 0 -and $script:warnings.Count -eq 0)
    }
    Check 'real root and child ownership predicates publish instead of refusing the root itself' {
        Reset-Case
        foreach ($name in @('Write-RunnerCleanupObservation', 'Write-RunnerSessionFailure')) {
            $writer = $common.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $false)
            Require ($writer.Extent.Text.Contains('Assert-SecureRoot') -and -not $writer.Extent.Text.Contains('Assert-RunnerProtectedPath $script:RunnerRoot'))
        }
        & {
            foreach ($name in @('Assert-OwnedPath', 'Assert-SecureRoot', 'Assert-RunnerProtectedPath')) {
                Invoke-Expression ($common.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $false).Extent.Text)
            }
            function Get-Acl {
                Require ($script:depth -gt 0)
                $acl = [Security.AccessControl.DirectorySecurity]::new()
                $acl.SetAccessRuleProtection($true, $false)
                $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
                return $acl
            }
            $rejected = $false
            try { [void](Assert-OwnedPath $script:RunnerRoot) } catch { $rejected = $true }
            Require $rejected
            Write-RunnerSessionFailure $script:state.vmName (Get-Failure { throw 'SECRET' }) 'job-execution'
            Write-RunnerSessionFailure $script:state.vmName (Get-Failure { throw 'SECRET' }) 'cleanup'
            Require ((Read-RunnerJson $script:path).sessions[0].latest.stage -ceq 'cleanup' -and $script:warnings.Count -eq 0 -and $script:depth -eq 0)
        }
    }
    Check 'writer lock failure does not skip cleanup and cleanup lock failure retains the earlier diagnostic' {
        $runner = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
        $session = $runner.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-RunnerSession' }, $false)
        $handler = $session.Find({ param($node) $node -is [Management.Automation.Language.TryStatementAst] -and $null -ne $node.Finally -and $node.Finally.Extent.Text.Contains('$verificationFailure = $null') }, $true)
        foreach ($failAt in @(1, 2)) {
            Reset-Case
            $name = $script:state.vmName; $state = $script:state; $verificationReady = $false; $sessionFailure = $null
            $original = [InvalidOperationException]::new('SECRET_ORIGINAL'); $script:lockAttempts = 0
            $failure = & {
                function Enter-RunnerLock {
                    $script:lockAttempts++
                    if ($script:lockAttempts -eq $failAt) { throw 'SECRET_MUTEX' }
                    $script:depth++; return 'fixture'
                }
                function Remove-RunnerInstance { $script:cleanupCalls++ }
                $work = [scriptblock]::Create('try { throw $original } catch ' + $handler.CatchClauses[0].Body.Extent.Text + ' finally ' + $handler.Finally.Extent.Text)
                Get-Failure $work
            }
            Require ($script:depth -eq 0)
            if ($failAt -eq 1) { Require ($script:cleanupCalls -eq 1 -and [object]::ReferenceEquals($failure.Exception, $original) -and $script:warnings.Count -eq 1) }
            else { Require ($script:cleanupCalls -eq 0 -and (Read-RunnerJson $script:path).sessions[0].first.stage -ceq 'job-execution') }
        }
    }
} finally {
    # Exact previously constructed TEMP test root, no installed runner paths.
    if ([IO.Path]::GetFullPath($script:RunnerRoot).StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $script:RunnerRoot -Recurse -Force }
}
Write-Host "Session failure passed: $script:checks projection/retention/cleanup regressions; Windows PowerShell $($PSVersionTable.PSVersion). No installed state/providers touched."
