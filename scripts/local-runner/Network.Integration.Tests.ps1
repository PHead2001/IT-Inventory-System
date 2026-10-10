# Offline integration: TEMP state and fixed local subprocesses only. No VM,
# credentials, GitHub or guest network operations are invoked.
param([string] $CandidateRoot = $PSScriptRoot, [switch] $DispatchAdmissionOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $CandidateRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $CandidateRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$script:realReceiptNative = (Get-Command Invoke-RunnerReceiptNative).ScriptBlock
$script:realWriteRunnerJson = (Get-Command Write-RunnerJson).ScriptBlock
$script:realLaunchDecision = (Get-Command Get-RunnerLaunchDecision).ScriptBlock
$script:RunnerGuardOutcome = $null
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-integration-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
$script:checks = 0; $script:locked = $false
function Check([string] $Name, [scriptblock] $Work) { if ($DispatchAdmissionOnly -and $Name -cne 'locked dispatch rejects quarantine races before any decision or durable handoff') { return }; & $Work; if ($script:fixtureStateDepth -ne 0 -or $script:locked) { throw 'Integration case leaked state recursion.' }; $script:checks++; Write-Host "PASS $Name" }
function Refuse([scriptblock] $Work) { $failed = $false; try { & $Work | Out-Null } catch { $failed = $true }; if (-not $failed) { throw 'Unsafe integration accepted.' } }
# Windows state mutex recursion must retain locked=true until the outer release.
$script:fixtureStateDepth = 0
$script:nextLockMutation = $null
function Enter-RunnerLock {
    $script:fixtureStateDepth++; $script:locked = $true
    if ($script:fixtureStateDepth -eq 1 -and $script:nextLockMutation) {
        $mutation = $script:nextLockMutation; $script:nextLockMutation = $null; & $mutation
    }
    return 'fixture'
}
function Exit-RunnerLock {
    if ($script:fixtureStateDepth -le 0) { throw 'Unbalanced fixture state release.' }
    $script:fixtureStateDepth--; $script:locked = $script:fixtureStateDepth -gt 0
}
$fixtureOuter = Enter-RunnerLock; $fixtureInner = Enter-RunnerLock
Exit-RunnerLock $fixtureInner
if (-not $script:locked) { throw 'Nested state release exposed locked IO.' }
Exit-RunnerLock $fixtureOuter
if ($script:locked -or $script:fixtureStateDepth -ne 0) { throw 'State fixture did not balance.' }
function Get-RunnerState { $script:state }
function Write-RunnerJson($Path, $Value) {
    if ($Path -ceq (Join-Path $script:RunnerRoot 'last-error.json')) { $script:failure = $Value }
    elseif ($Path -ceq $script:RunnerStatePath) { $script:stateWrites++; $script:state = $Value }
    else {
        if ($Path -ceq (Join-Path $script:RunnerRoot 'jit-registration.json')) { $script:registrationWrites++ }
        & $script:realWriteRunnerJson $Path $Value
    }
}
function Get-RunnerLaunchDecision($Journal, $Event, $RunnerId, $LaunchId, $ExitCode) {
    $script:decisions++; return & $script:realLaunchDecision $Journal $Event $RunnerId $LaunchId $ExitCode
}
function Invoke-RunnerTransitionCheckpoint($Name) { $script:checkpoints += $Name }
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) }
function Test-RunnerProcessIdentity($ProcessId, $StartUtc) { if ($script:deadGuardian -and $ProcessId -eq 42) { return $false }; $script:alive }
function Get-RunnerRecoveryNow { $script:now }
function Save-Heartbeat { if ($script:locked) { throw 'Wait held state mutex.' }; $script:heartbeats++ }
function Start-Sleep {
    if ($script:locked) { throw 'Wait held state mutex.' }
    $script:sleeps++
    if ($script:state.networkRecovery.phase -cne 'healthy') { $script:state.networkRecovery.phase = 'healthy'; $script:state.guardianReady = $true }
}
function New-Fixture {
    if ($script:fixtureStateDepth -ne 0) { throw 'Previous fixture leaked state recursion.' }
    $registrationPath = Join-Path $root 'jit-registration.json'
    if (Test-Path -LiteralPath $registrationPath) { Remove-Item -LiteralPath $registrationPath }
    $script:now = [DateTime]::UtcNow; $script:alive = $true; $script:deadGuardian = $false; $script:sleeps = 0; $script:heartbeats = 0; $script:queries = 0; $script:badReceipt = $false
    $script:nextLockMutation = $null; $script:stateWrites = 0; $script:registrationWrites = 0; $script:decisions = 0; $script:checkpoints = @()
    $script:state = [pscustomobject]@{ tag = $script:RunnerTag; purpose = 'job'; resourceLabel = 'it-inventory-heavy'; vmName = 'ITIR-' + ('a' * 32); vmId = '00000000-0000-0000-0000-000000000001'; instancePath = Join-Path $root ('ITIR-' + ('a' * 32)); deadlineUtc = $script:now.AddMinutes(5).ToString('o'); guardianPid = 42; guardianStartUtc = $script:now.ToString('o'); guardianReady = $true
        supervisorPid = 43; supervisorStartUtc = $script:now.ToString('o')
        networkRecovery = [pscustomobject]@{ phase = 'healthy'; generation = 0; failure = ''; hardDeadlineUtc = $script:now.AddMinutes(5).ToString('o'); episodeDeadlineUtc = ''; progressUtc = $script:now.ToString('o') } }
    $script:state.networkRecovery | Add-Member binding ([pscustomobject]@{ vmId = $script:state.vmId; vmName = $script:state.vmName; claimHash = Get-RunnerRecoveryClaimHash $script:state })
}
function Get-HostNetworkFingerprint { throw 'Supervisor attempted competing network observation/repair.' }
function Get-RunnerConfig { [pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1'; repo = 'example/fixture'; activation = 'active'; label = 'it-inventory-ephemeral'; runnerGroupId = 1 } }
function Get-VM { $script:vm }
function Get-VMSwitch { $script:switch }
function Get-VMNetworkAdapter { $script:adapter }
function Get-VMNetworkAdapterExtendedAcl { $script:state.networkRules }
function Get-RunnerNetworkObservation { $script:observation }
function Suspend-VM { $script:vm.State = 'Paused'; $script:effects += 'pause' }
function Disconnect-VMNetworkAdapter { $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty; $script:effects += 'disconnect' }
function Invoke-GitHub { throw 'Receipt reattachment obtained another JIT or GitHub result.' }
function Invoke-RunnerNative { throw 'Receipt reattachment relaunched a guest command.' }
function Invoke-RunnerReceiptNative($Executable, $Arguments) {
    if ($script:locked) { throw 'Receipt IO held mutex.' }
    $script:queries++
    if ($Arguments[-1] -cne (Get-RunnerReceiptCommand $script:state.runnerLaunch.launchId)) { throw 'Receipt query changed launch identity.' }
    switch ($script:queries) {
        1 { throw 'simulated SSH transport loss' }
        2 { return [pscustomobject]@{ ExitCode = 1; Output = '' } }
        3 { return [pscustomobject]@{ ExitCode = 0; Output = ('c' * 32) + '|123|running|-' } }
        default { return [pscustomobject]@{ ExitCode = 0; Output = ('c' * 32) + $(if ($script:badReceipt) { '|124|exited|' } else { '|123|exited|' }) + $script:exitCode } }
    }
}
try {
    Check 'actual guardian wrapper initializes exact Off binding then quarantines drift' {
        New-Fixture
        foreach ($name in @('networkRecovery', 'guardianPid', 'guardianStartUtc', 'guardianReady')) { $script:state.PSObject.Properties.Remove($name) }
        $script:state.instancePath = Join-Path (Join-Path $root 'instances') $script:state.vmName
        foreach ($pair in @{ tag = $script:RunnerTag; supervisorPid = $PID; supervisorStartUtc = $script:now.ToString('o'); guestMac = '02AABBCCDDEE'; networkFingerprint = ('a' * 64) }.GetEnumerator()) { $script:state | Add-Member -NotePropertyName $pair.Key -NotePropertyValue $pair.Value -Force }
        $rule = [pscustomobject]@{ Action = 'Deny'; Direction = 'Outbound'; Weight = 2; LocalIPAddress = ''; RemoteIPAddress = ''; LocalPort = ''; RemotePort = ''; Protocol = ''; Stateful = $false }
        $script:state | Add-Member -NotePropertyName networkRules -NotePropertyValue @($rule)
        $script:vm = [pscustomobject]@{ Id = [guid]$script:state.vmId; Name = $script:state.vmName; Notes = $script:RunnerTag; Path = Join-Path $script:state.instancePath $script:state.vmName; State = 'Off' }
        $script:switch = [pscustomobject]@{ Id = [guid]'00000000-0000-0000-0000-000000000002'; Name = $script:RunnerSwitch; SwitchType = 'Internal' }
        $script:adapter = [pscustomobject]@{ Id = 'fixture-adapter'; VMId = $script:vm.Id; VMName = $script:vm.Name; MacAddress = $script:state.guestMac; DynamicMacAddressEnabled = $false; SwitchId = $script:switch.Id; SwitchName = $script:switch.Name }
        $script:observation = [pscustomobject]@{ fingerprint = ('a' * 64); rules = @($rule); observedUtc = $script:now.ToString('o') }; $script:effects = @()
        if (-not (Invoke-GuardCheck $script:state.vmName) -or -not $script:state.guardianReady -or $script:state.guardianPid -ne $PID) { throw 'Actual guardian initialization failed.' }
        $script:vm.State = 'Running'; $script:observation.fingerprint = 'b' * 64
        if (-not (Invoke-GuardCheck $script:state.vmName) -or $script:state.guardianReady -or $script:state.networkRecovery.phase -cne 'quarantining' -or ($script:effects -join ',') -cne 'pause,disconnect') { throw 'Guardian wrapper did not quarantine running drift without deleting session.' }
    }
    Check 'supervisor waits for sole guardian without holding mutex or repairing network' {
        New-Fixture; $script:state.networkRecovery.phase = 'isolated'; $script:state.guardianReady = $false
        Assert-SessionAlive $script:state
        if ($script:sleeps -ne 1 -or $script:heartbeats -ne 2 -or $script:locked) { throw 'Recovery wait did not retain guardian ownership.' }
    }
    Check 'precreation session remains valid before its VM identity exists' {
        New-Fixture
        foreach ($name in @('vmId', 'networkRecovery', 'guardianPid', 'guardianStartUtc', 'guardianReady')) { $script:state.PSObject.Properties.Remove($name) }
        Assert-SessionAlive $script:state
        if ($script:heartbeats -ne 1 -or $script:sleeps -ne 0) { throw 'Precreation was mistaken for a recovered VM.' }
    }
    Check 'dead guardian and expired recovery reject supervisor continuation' {
        New-Fixture; $script:alive = $false; Refuse { Assert-SessionAlive $script:state }
        New-Fixture; $script:state.networkRecovery.phase = 'isolated'; $script:state.networkRecovery.episodeDeadlineUtc = $script:now.AddSeconds(-1).ToString('o'); Refuse { Assert-SessionAlive $script:state }
    }
    Check 'watchdog checks established guardian death in every recovery phase independently of readiness' {
        $cleanup = (Get-Command Remove-RunnerInstance).ScriptBlock
        function Assert-Administrator {}
        function Assert-SecureRoot {}
        function Invoke-RunnerSupervisorRecovery {}
        function Remove-RunnerInstance($State) {
            if ($State.vmName -cne $script:state.vmName -or [guid]$State.vmId -ne [guid]$script:state.vmId) { throw 'Watchdog cleanup escaped recorded identity.' }
            $script:cleanups++; $script:state = $null
        }
        try {
            foreach ($phase in @('healthy', 'quarantining', 'isolated', 'applying', 'verified', 'connecting', 'resuming', 'probing')) {
                New-Fixture; $script:cleanups = 0; $script:deadGuardian = $true
                $script:state.networkRecovery.phase = $phase; $script:state.guardianReady = $phase -ceq 'healthy'
                Refuse { Assert-SessionAlive $script:state }
                Invoke-Watchdog
                if ($script:cleanups -ne 1 -or $null -ne $script:state -or $script:locked) { throw 'Watchdog retained dead established guardian before recovery expiry.' }
            }
            New-Fixture; $script:cleanups = 0
            foreach ($property in @('guardianPid', 'guardianStartUtc', 'guardianReady', 'networkRecovery')) { $script:state.PSObject.Properties.Remove($property) }
            Invoke-Watchdog
            if ($script:cleanups -ne 0 -or $null -eq $script:state) { throw 'Watchdog removed valid pre-guardian initialization.' }
            New-Fixture; $script:cleanups = 0; $script:state.guardianReady = $false; $script:state.PSObject.Properties.Remove('guardianStartUtc')
            Invoke-Watchdog
            if ($script:cleanups -ne 1 -or $null -ne $script:state) { throw 'Incomplete recorded guardian identity bypassed watchdog.' }
        } finally { Set-Item Function:Remove-RunnerInstance $cleanup }
    }
    Check 'recorded guardian without recovery journal cannot use precreation exemption' {
        New-Fixture; $script:state.PSObject.Properties.Remove('networkRecovery')
        Refuse { Assert-SessionAlive $script:state }
    }
    Check 'protected launch intent cannot be replaced or reused after ambiguity' {
        New-Fixture; $admission = Get-RunnerJitAdmission $script:state
        $journal = Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission $admission
        if ($journal.phase -cne 'registration-intent') { throw 'Intent was not journaled.' }
        [void](Save-RunnerLaunchEvent $script:state 'transport-lost')
        Refuse { Save-RunnerLaunchEvent $script:state 'intent' 0 ('d' * 32) -Admission $admission }
    }
    Check 'instance cancellation between liveness check and intent prevents registration intent' {
        New-Fixture; Assert-SessionAlive $script:state
        $admission = Get-RunnerJitAdmission $script:state
        [void][IO.Directory]::CreateDirectory($script:state.instancePath)
        $marker = Join-Path $script:state.instancePath 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        try {
            Refuse { Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission $admission }
            if ($script:state.PSObject.Properties.Name -contains 'runnerLaunch') { throw 'Cancelled session journaled JIT intent.' }
        } finally { Remove-Item -LiteralPath $marker }
    }
    Check 'instance cancellation before dispatch preserves registered journal without launching' {
        New-Fixture
        [void](Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state)); [void](Save-RunnerLaunchEvent $script:state 'registered' 123)
        $before = $script:state.runnerLaunch | ConvertTo-Json -Depth 8 -Compress
        Assert-SessionAlive $script:state
        [void][IO.Directory]::CreateDirectory($script:state.instancePath)
        $marker = Join-Path $script:state.instancePath 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        try {
            Refuse { Save-RunnerLaunchEvent $script:state 'dispatch' }
            if (($script:state.runnerLaunch | ConvertTo-Json -Depth 8 -Compress) -cne $before) { throw 'Cancelled dispatch advanced or replaced sole runner journal.' }
        } finally { Remove-Item -LiteralPath $marker }
    }
    Check 'locked dispatch rejects quarantine races before any decision or durable handoff' {
        foreach ($change in @('quarantining', 'isolated', 'applying', 'verified', 'connecting', 'resuming', 'probing', 'failed', 'not-ready', 'dead', 'progress-expired', 'deadline', 'binding', 'claim', 'identity', 'root-stop', 'instance-stop')) {
            New-Fixture
            [void](Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state))
            [void](Save-RunnerLaunchEvent $script:state 'registered' 123)
            $caller = $script:state | ConvertTo-Json -Depth 12 | ConvertFrom-Json
            Assert-SessionAlive $caller # Healthy before mutex acquisition.
            $beforeLaunch = $script:state.runnerLaunch | ConvertTo-Json -Depth 8 -Compress
            $registrationPath = Join-Path $root 'jit-registration.json'; $beforeRegistration = (Get-FileHash $registrationPath).Hash
            $script:stateWrites = 0; $script:registrationWrites = 0; $script:decisions = 0; $script:checkpoints = @(); $script:dispatchChange = $change
            $script:nextLockMutation = {
                switch ($script:dispatchChange) {
                    'not-ready' { $script:state.guardianReady = $false }
                    'dead' { $script:deadGuardian = $true }
                    'progress-expired' { $script:state.networkRecovery.progressUtc = $script:now.AddSeconds(-31).ToString('o') }
                    'deadline' { $script:now = $script:now.AddMinutes(6) }
                    'binding' { $script:state.networkRecovery.binding.vmId = '00000000-0000-0000-0000-000000000002' }
                    'claim' { $script:state.networkRecovery.binding.claimHash = 'b' * 64 }
                    'identity' { $script:state.vmId = '00000000-0000-0000-0000-000000000002' }
                    'root-stop' { [IO.File]::WriteAllText((Join-Path $root 'stop.requested'), '') }
                    'instance-stop' { [void][IO.Directory]::CreateDirectory($script:state.instancePath); [IO.File]::WriteAllText((Join-Path $script:state.instancePath 'stop.requested'), '') }
                    default { $script:state.networkRecovery.phase = $script:dispatchChange; $script:state.guardianReady = $false }
                }
            }
            try {
                $rejected = $false; try { [void](Save-RunnerLaunchEvent $caller 'dispatch') } catch { $rejected = $true }
                if (-not $rejected) { throw 'Locked dispatch admitted quarantine before handoff.' }
                if (($script:state.runnerLaunch | ConvertTo-Json -Depth 8 -Compress) -cne $beforeLaunch -or (Get-FileHash $registrationPath).Hash -cne $beforeRegistration -or
                    (Get-RunnerJitRegistration).phase -cne 'registered' -or $script:stateWrites -ne 0 -or $script:registrationWrites -ne 0 -or $script:decisions -ne 0 -or $script:checkpoints.Count -ne 0 -or $script:queries -ne 0) { throw 'Unsafe dispatch changed its registered barrier, decided launch, emitted a checkpoint or queried SSH.' }
            } finally {
                foreach ($marker in @((Join-Path $root 'stop.requested'), (Join-Path $script:state.instancePath 'stop.requested'))) { if (Test-Path $marker) { Remove-Item -LiteralPath $marker } }
            }
        }
        New-Fixture
        [void](Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state))
        $script:state.networkRecovery.phase = 'quarantining'; $script:state.guardianReady = $false
        [void](Save-RunnerLaunchEvent $script:state 'registered' 123)
        if ((Get-RunnerJitRegistration).phase -cne 'registered' -or $script:state.runnerLaunch.phase -cne 'registered') { throw 'Recovery discarded the validated POST response instead of preserving its barrier.' }
        $script:state.networkRecovery.phase = 'healthy'; $script:state.guardianReady = $true
        $script:state.networkRecovery.generation++
        [void](Save-RunnerLaunchEvent $script:state 'dispatch')
        if ((Get-RunnerJitRegistration).phase -cne 'handed-off' -or $script:state.runnerLaunch.phase -cne 'launch-intent') { throw 'Fresh healthy dispatch could not commit its sole handoff.' }
    }
    Check 'preparation purpose never grants JIT or guest launch admission' {
        New-Fixture; $admission = Get-RunnerJitAdmission $script:state; $script:state.purpose = 'prepare'
        Refuse { Get-RunnerJitAdmission $script:state }
        Refuse { Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission $admission }
        if ($script:state.PSObject.Properties.Name -contains 'runnerLaunch') { throw 'Preparation journaled a guest job intent.' }
    }
    Check 'locked final intent admission rejects guardian changes after demand capture without waiting' {
        foreach ($change in @('dead', 'not-ready', 'recovering', 'new-generation', 'expired', 'removed', 'changed-claim', 'changed-binding')) {
            New-Fixture; $before = $script:state
            $admission = Get-RunnerJitAdmission $before
            switch ($change) {
                'dead' { $script:alive = $false }
                'not-ready' { $script:state.guardianReady = $false }
                'recovering' { $script:state.networkRecovery.phase = 'isolated' }
                'new-generation' { $script:state.networkRecovery.generation++ }
                'expired' { $script:now = $script:now.AddMinutes(6) }
                'removed' { $script:state = $null }
                'changed-claim' { $script:state.networkRecovery.binding.claimHash = 'b' * 64 }
                'changed-binding' { $script:state.networkRecovery.binding | Add-Member adapterId 'different-adapter' }
            }
            Refuse { Save-RunnerLaunchEvent $before 'intent' 0 ('c' * 32) -Admission $admission }
            if (($null -ne $script:state -and $script:state.PSObject.Properties.Name -contains 'runnerLaunch') -or $script:sleeps -ne 0 -or $script:locked) { throw 'Obsolete demand caused intent, waiting or a leaked mutex.' }
        }
    }
    Check 'actual Guard failure writes fixed safe diagnostic and performs owned cleanup' {
        New-Fixture; $script:failure = $null; $script:cleaned = $false
        $guard = (Get-Command Invoke-GuardCheck).ScriptBlock; $cleanup = (Get-Command Remove-RunnerInstance).ScriptBlock
        function Assert-Administrator {}
        function Assert-SecureRoot {}
        function Invoke-GuardCheck { throw 'Synthetic guard failure containing SENTINEL_SECRET' }
        function Remove-RunnerInstance { param($State) if ($State.vmName -cne $script:state.vmName) { throw 'Cleanup escaped its exact session.' }; $script:cleaned = $true; $script:state = $null }
        try {
            $SessionName = $script:state.vmName
            $actionSwitch = $ast.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] -and $node.Condition.Extent.Text -ceq '$Action' }, $true)
            $clause = @($actionSwitch.Clauses | Where-Object { $_.Item1.Value -ceq 'Guard' })[0].Item2
            Refuse { & ([scriptblock]::Create($clause.Extent.Text.Substring(1, $clause.Extent.Text.Length - 2))) }
            if ($null -eq $script:failure -or $script:failure.code -cne 'RECOVERY_FAILED' -or $script:failure.stage -cne 'network-guard' -or
                ($script:failure | ConvertTo-Json -Compress).Contains('SENTINEL_SECRET') -or -not $script:cleaned) { throw 'Guard failure lost safe diagnostic or exact owned cleanup.' }
        } finally { Set-Item Function:Invoke-GuardCheck $guard; Set-Item Function:Remove-RunnerInstance $cleanup }
    }
    Check 'detached command retains fixed runner environment and never embeds JIT' {
        foreach ($prepared in @($false, $true)) {
            $command = Get-RunnerDetachedCommand $prepared ('c' * 32) 123
            if ($command -cnotmatch 'printf ''%s'' ([A-Za-z0-9+/=]+) \| base64 -d') { throw 'Fixed detached wrapper is missing.' }
            $wrapper = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))
            if (-not $wrapper.Contains((Get-RunnerJobCommand $prepared)) -or -not $wrapper.Contains('rm -f jit') -or -not $wrapper.Contains('cccccccccccccccccccccccccccccccc|123|exited')) { throw 'Detached runner changed the job/env or secret lifetime.' }
            if ($command -notmatch '--property=Restart=no' -or $command -notmatch 'mkdir /home/runner/.itir-session/' -or $command -notmatch 'read -r JIT') { throw 'Detached launch lacks dispatch-once/private input.' }
        }
        Refuse { Get-RunnerDetachedCommand $true 'bad' 123 }
    }
    Check 'receipt parser rejects different identity and malformed exit status' {
        $journal = [pscustomobject]@{ launchId = 'c' * 32; runnerId = 123 }
        foreach ($text in @(('d' * 32) + '|123|running|-', ('c' * 32) + '|124|exited|0', ('c' * 32) + '|123|exited|256', ('c' * 32) + '|123|running|0', ('c' * 32) + '|123|exited|0|success')) { Refuse { ConvertFrom-RunnerGuestReceipt $text $journal } }
    }
    Check 'SSH loss reattaches only receipt monitor to same launch and preserves result meaning' {
        New-Fixture; $script:exitCode = 0
        [void](Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state)); [void](Save-RunnerLaunchEvent $script:state 'registered' 123); [void](Save-RunnerLaunchEvent $script:state 'dispatch')
        Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = 'fixture' })
        if ($script:queries -ne 4 -or $script:state.runnerLaunch.phase -cne 'runner-exited' -or $script:state.runnerLaunch.runnerId -ne 123 -or $script:sleeps -ne 3) { throw 'Transport recovery lost the sole runner/session outcome.' }
    }
    Check 'nonzero detached exit remains abnormal rather than workflow success' {
        New-Fixture; $script:exitCode = 1
        [void](Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state)); [void](Save-RunnerLaunchEvent $script:state 'registered' 123); [void](Save-RunnerLaunchEvent $script:state 'dispatch')
        Refuse { Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = 'fixture' }) }
        if ($script:state.runnerLaunch.phase -cne 'runner-failed') { throw 'Nonzero exit was not retained.' }
    }
    Check 'successfully received different runner receipt fails instead of retrying identity' {
        New-Fixture; $script:exitCode = 0; $script:badReceipt = $true
        [void](Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state)); [void](Save-RunnerLaunchEvent $script:state 'registered' 123); [void](Save-RunnerLaunchEvent $script:state 'dispatch')
        Refuse { Wait-DetachedRunner $script:state ([pscustomobject]@{ guestIp = 'fixture' }) }
        if ($script:queries -ne 4 -or $script:state.runnerLaunch.runnerId -ne 123) { throw 'Different guest runner was adopted.' }
    }
    Check 'native receipt capture bounds output and transport timeout without logging stderr' {
        $exe = Join-Path $PSHOME 'powershell.exe'
        $result = & $script:realReceiptNative $exe @('-NoProfile', '-NonInteractive', '-Command', '[Console]::Out.Write(''receipt''); [Console]::Error.Write(''discard-me'')') 3
        if ($result.ExitCode -ne 0 -or $result.Output -cne 'receipt') { throw 'Fixed native receipt capture changed output.' }
        Refuse { & $script:realReceiptNative $exe @('-NoProfile', '-NonInteractive', '-Command', '[Console]::Out.Write((''x'' * 5000))') 3 }
        Refuse { & $script:realReceiptNative $exe @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 10') 1 }
    }
    Write-Host "Network integration offline regressions passed: $script:checks cases; no live continuity proof."
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -cnotmatch '^ITIR-integration-[0-9a-f]{32}$') { throw 'Fixture cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
