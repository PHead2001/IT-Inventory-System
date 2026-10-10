# Offline actual-session regression: all host/API operations are fixture stubs.
param([string] $CandidateRoot = $PSScriptRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $CandidateRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $CandidateRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-demand-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
$config = [pscustomobject]@{ activation = 'active'; label = 'it-inventory-ephemeral'; repo = 'example/fixture'; maxMinutes = 120; baseVhdx = 'fixture'; guestIp = 'fixture'; runnerGroupId = 1 }
function Assert-Rejected([scriptblock] $Work) { $rejected = $false; try { & $Work } catch { $rejected = $true }; if (-not $rejected) { throw 'Demand fixture unexpectedly accepted unsafe input.' } }
$script:actualClaimOpen = (Get-Command Assert-RunnerClaimOpen).ScriptBlock
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) }
# Stub every host touch while retaining the actual session control flow/finally.
foreach ($name in @('Assert-InstalledHost', 'Assert-RunnerClaimOpen', 'Invoke-RunnerTransitionCheckpoint', 'Copy-Item', 'Assert-SessionAlive', 'Set-VM', 'Assert-RunnerVmLifecycle', 'Set-VMProcessor', 'Set-VMMemory', 'Assert-RunnerVmResources', 'Set-VMFirmware', 'Disable-VMIntegrationService', 'New-SeedDisk', 'Add-VMHardDiskDrive', 'Start-SessionGuardian', 'Assert-RunnerGuestMac', 'Start-GuardedVm', 'Wait-Guest', 'Assert-AdapterRules', 'Assert-CurrentRunnerNetworkRules', 'Test-GuestIsolation')) { Set-Item -Path "Function:$name" -Value {} }
$script:dispatchChanges = 0
function Enter-RunnerLock {
    # The caller already passed its liveness check. Reproduce guardian state
    # changing just before the actual dispatch helper obtains its mutex.
    if ($script:RunnerOperationStage -ceq 'job-execution' -and $script:dispatchChanges -eq 0 -and $script:case -cmatch '^dispatch-(quarantining|isolated|applying|verified|connecting|resuming|probing)$') {
        $phase = $Matches[1]
        $current = Read-RunnerJson $script:RunnerStatePath
        if ($null -ne $current -and $current.runnerLaunch.phase -ceq 'registered') {
            $script:dispatchChanges++
            $current.networkRecovery.phase = $phase; $current.guardianReady = $false
            Write-RunnerJson $script:RunnerStatePath $current
        }
    }
    return $null
}
function Exit-RunnerLock {}
function Get-OwnerToken { return 'fixture' }
function Start-SessionGuardian($State) {
    # Protected TEMP journal with a real live process identity; no host guardian
    # or Hyper-V operation is launched by this fixture.
    $current = Get-RunnerState
    $current | Add-Member guardianPid $PID -Force
    $current | Add-Member guardianStartUtc ((Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')) -Force
    $current | Add-Member guardianReady $true -Force
    $binding = [pscustomobject]@{ vmId = $current.vmId; vmName = $current.vmName; claimHash = Get-RunnerRecoveryClaimHash $current }
    $current | Add-Member networkRecovery (New-RunnerNetworkRecovery $binding ('a' * 64) ([DateTime]::Parse($current.deadlineUtc).ToUniversalTime()) ([DateTime]::UtcNow)) -Force
    Write-RunnerJson $script:RunnerStatePath $current
    if ($script:case -ceq 'withdraw-before-boot') { $script:jobs[0].status = 'completed' }
}
function Change-GuardianDuringDemand {
    $current = Get-RunnerState
    if ($null -eq $current -or $script:case -notmatch 'lookup$' -or $script:RunnerOperationStage -cne 'jit-registration') { return }
    switch -Regex ($script:case) {
        'recovery-lookup$' { $current.networkRecovery.phase = 'isolated'; $current.guardianReady = $false }
        'dead-guardian-lookup$' { $current.guardianStartUtc = [DateTime]::UtcNow.AddYears(-1).ToString('o') }
        'not-ready-lookup$' { $current.guardianReady = $false }
        'expired-lookup$' { $current.networkRecovery.progressUtc = [DateTime]::UtcNow.AddSeconds(-31).ToString('o') }
        'new-generation-lookup$' { $current.networkRecovery.generation++; $current.networkRecovery.phase = 'healthy' }
    }
    Write-RunnerJson $script:RunnerStatePath $current
    $script:lookupChanges++
}
function Assert-SessionAlive($State) {
    if ($script:case -ceq 'handoff-before-ssh' -and $script:RunnerOperationStage -ceq 'job-execution' -and $script:nativeCalls -ge 3) { throw 'Bounded fixture session ended after uncertain SSH dispatch.' }
    if ($script:case -in @('recovery-cancelled', 'pilot-recovery-cancelled') -and $script:RunnerOperationStage -ceq 'jit-registration') {
        $script:recoveryWaits++
        if ($script:case -ceq 'pilot-recovery-cancelled') { $script:pilotJob.status = 'completed' }
        else { $script:jobs[0].status = 'completed' }
    }
}
function Assert-InstalledHost {
    $script:preflights++
    if ($script:case -ceq 'preflight-failed') {
        $script:abandonedPreflight = $script:RunnerImagePreflight
        $script:abandonedPreflight.deadlineUtc = [DateTime]::UtcNow.AddSeconds(-1)
        throw 'Fixture failed preclaim image verification.'
    }
}
function Copy-Item { $script:copies++ }
function Start-GuardedVm { $script:boots++ }
function Get-RunnerImageSelection($Config) {
    $script:images++
    if ($script:case -ceq 'withdraw-before-copy') { $script:jobs[0].status = 'completed' }
    return [pscustomobject]@{ path = $Config.baseVhdx; prepared = $script:case -ceq 'prepared' }
}
function Wait-Guest {
    param($State, $Config, $ProfileLabel)
    if ($ProfileLabel -cne 'it-inventory-heavy') { throw 'Selected profile did not reach guest readiness.' }
    # Withdraw the originally selected heavy demand during guest startup.
    if ($script:case -eq 'cancelled') { $script:jobs[0].status = 'completed' }
    elseif ($script:case -eq 'incompatible') { $script:jobs = @((New-Job 1 'it-inventory-ephemeral')) }
}
function Get-CimInstance { throw 'Postallocation capacity must not be inspected.' }
function New-SeedDisk($Path, $PublicKey, $Mac, $Config, $ProfileLabel) { if ($ProfileLabel -cne 'it-inventory-heavy') { throw 'Selected profile did not reach guest cloud-config.' } }
function New-RunnerSshKey($Path) { [IO.File]::WriteAllText(($Path + '.pub'), 'fixture-public') }
function New-RunnerProfileVm { $script:allocations++; return [pscustomobject]@{ Id = [guid]'11111111-1111-1111-1111-111111111111' } }
function Set-VM {
    $recorded = Get-RunnerState
    if ($recorded.vmId -cne '11111111-1111-1111-1111-111111111111' -or $recorded.phase -cne 'creating') {
        throw 'VM GUID was not journaled immediately after creation, before tagging.'
    }
}
function Get-VM { return [pscustomobject]@{ Notes = $script:RunnerTag } }
function Get-VMIntegrationService { return @() }
function Set-RunnerGuestMac { return [pscustomobject]@{ rawMac = 'fixture'; seedMac = 'fixture' } }
function Get-RunnerNetworkObservation { return [pscustomobject]@{ fingerprint = ('a' * 64); rules = @(); observedUtc = [DateTime]::UtcNow.ToString('o') } }
function Set-IsolatedAdapter { return @() }
function Get-RunnerArchive { return 'fixture' }
function Get-SshArgs { return @() }
function Invoke-RunnerNative($Executable, $Arguments, $InputText = $null, $TimeoutSeconds = 0) {
    $script:nativeCalls++
    if ($null -ne $InputText) {
        if ($script:case -ceq 'handoff-before-ssh') { throw 'SENTINEL_SECRET: SSH transport failed before guest dispatch.' }
        $command = $Arguments[-1]
        if ($command -cnotmatch 'printf ''%s'' ([A-Za-z0-9+/=]+) \| base64 -d') { throw 'Detached fixed wrapper missing.' }
        $wrapper = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))
        if (($wrapper -match 'RUNNER_TOOL_CACHE=/opt/hostedtoolcache') -ne ($script:case -ceq 'prepared')) { throw 'Generic fallback lost writable runner-default toolcache, or prepared cache was not exposed.' }
    }
    return 0
}
function Invoke-RunnerReceiptNative {
    $launch = (Get-RunnerState).runnerLaunch
    return [pscustomobject]@{ ExitCode = 0; Output = $launch.launchId + '|' + $launch.runnerId + '|exited|0' }
}
function Remove-RunnerInstance($State) {
    $script:cleanups++
    $script:intentPresent = (Get-RunnerState).PSObject.Properties.Name -contains 'runnerLaunch'
    Remove-Item -LiteralPath $script:RunnerStatePath
}
function New-Job([int] $Id, [string] $Label, [string] $Status = 'queued') { return [pscustomobject]@{ id = $Id; status = $Status; runner_id = 0; labels = @('self-hosted', $Label) } }
function Invoke-GitHub($Uri, $Method, $Body, $Token) {
    if ($Uri -match '/runs\?') { return [pscustomobject]@{ total_count = $script:runCount; workflow_runs = @([pscustomobject]@{ id = 12 }) } }
    if ($Uri -match '/runs/12/jobs\?') {
        Change-GuardianDuringDemand
        return [pscustomobject]@{ total_count = $script:jobCount; jobs = $script:jobs }
    }
    if ($Uri -match '/generate-jitconfig$') {
        $script:jits++
        if ($script:case -ceq 'post-lost') { throw 'SENTINEL_SECRET: registration response lost after remote side effect.' }
        if (($Body.labels -join ',') -cne 'self-hosted,Linux,X64,it-inventory-heavy') { throw 'Session advertised another resource profile at JIT submission.' }
        $labels = @($Body.labels)
        if ($script:badReadback) { $labels += 'it-inventory-ephemeral' }
        return [pscustomobject]@{ encoded_jit_config = 'ZmFrZQ=='; runner = [pscustomobject]@{ name = $Body.name; id = 42; labels = @($labels | ForEach-Object { [pscustomobject]@{ name = $_ } }) } }
    }
    throw 'Unexpected API fixture operation.'
}
try {
    $script:runCount = 1; $script:jobCount = 2; $script:badReadback = $false
    foreach ($capacity in @('light', 'mid', 'heavy')) {
        foreach ($demand in @('light', 'mid', 'heavy', 'ephemeral')) {
            $script:jobs = @((New-Job 1 "it-inventory-$demand"))
            $script:jobCount = 1
            $selected = Get-QueuedRunnerJob $config 'fixture' -SessionProfileLabel "it-inventory-$capacity"
            $expected = $demand -ceq $capacity
            if (($null -ne $selected) -ne $expected) { throw 'Capacity compatibility matrix changed.' }
        }
    }
    $script:jobs = @((New-Job 1 'it-inventory-light')); $script:jobCount = 1
    if ($null -ne (Get-QueuedRunnerJob $config 'fixture' -SessionProfileLabel 'it-inventory-ephemeral')) { throw 'Legacy runner accepted normal demand.' }
    $script:jobs = @((New-Job 1 'it-inventory-ephemeral'))
    if ($null -eq (Get-QueuedRunnerJob $config 'fixture' -SessionProfileLabel 'it-inventory-ephemeral')) { throw 'Legacy singleton lost its own demand.' }
    $script:jobs = @((New-Job 1 'it-inventory-heavy'), (New-Job 2 'it-inventory-mid')); $script:jobCount = 2
    if ((Get-QueuedRunnerJob $config 'fixture' -SessionProfileLabel 'it-inventory-mid').id -ne 2) { throw 'Demand scan stopped at an incompatible first job.' }
    $script:runCount = 101
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' -SessionProfileLabel 'it-inventory-heavy' }
    $script:runCount = 1; $script:jobCount = 101
    Assert-Rejected { Get-QueuedRunnerJob $config 'fixture' -SessionProfileLabel 'it-inventory-heavy' }
    $script:jobCount = 1
    foreach ($case in @('preflight-failed', 'withdraw-before-image', 'withdraw-before-copy', 'withdraw-before-boot', 'cancelled', 'recovery-cancelled', 'incompatible', 'lower', 'same', 'prepared', 'unexpected-readback', 'overflow', 'recovery-lookup', 'dead-guardian-lookup', 'not-ready-lookup', 'expired-lookup', 'new-generation-lookup', 'dispatch-quarantining', 'dispatch-isolated', 'dispatch-applying', 'dispatch-verified', 'dispatch-connecting', 'dispatch-resuming', 'dispatch-probing')) {
        # Independent synthetic sessions have independent fixture lifetimes.
        # Repeated admission below deliberately retains its previous barrier.
        $registrationPath = Join-Path $base 'jit-registration.json'
        if (Test-Path -LiteralPath $registrationPath) { Remove-Item -LiteralPath $registrationPath }
        $script:allocations = 0; $script:cleanups = 0; $script:jits = 0; $script:nativeCalls = 0; $script:recoveryWaits = 0
        $script:lookupChanges = 0; $script:intentPresent = $false
        $script:dispatchChanges = 0
        $script:preflights = 0; $script:images = 0; $script:copies = 0; $script:boots = 0
        $script:badReadback = $case -eq 'unexpected-readback'
        $script:jobs = switch ($case) {
            'preflight-failed' { New-Job 1 'it-inventory-heavy' }
            'withdraw-before-image' { New-Job 1 'it-inventory-heavy' 'completed' }
            'withdraw-before-copy' { New-Job 1 'it-inventory-heavy' }
            'withdraw-before-boot' { New-Job 1 'it-inventory-heavy' }
            'cancelled' { New-Job 1 'it-inventory-heavy' }
            'recovery-cancelled' { New-Job 1 'it-inventory-heavy' }
            'incompatible' { New-Job 1 'it-inventory-heavy' }
            'same' { New-Job 1 'it-inventory-heavy' }
            'prepared' { New-Job 1 'it-inventory-heavy' }
            'unexpected-readback' { New-Job 1 'it-inventory-heavy' }
            default { New-Job 1 $(if ($case -match 'lookup$' -or $case -cmatch '^dispatch-') { 'it-inventory-heavy' } else { 'it-inventory-light' }) }
        }
        $script:jobCount = if ($case -eq 'overflow') { 101 } else { 1 }
        if ($case -cmatch '^dispatch-') {
            $rejected = $false; try { [void](Invoke-RunnerSession $config $null 'it-inventory-heavy') } catch { $rejected = $true }
            if (-not $rejected) {
                if ($script:dispatchChanges -ne 1 -or $script:jits -ne 1 -or $script:nativeCalls -ne 3 -or
                    (Read-RunnerJson $registrationPath).phase -cne 'handed-off') { throw 'Dispatch red fixture did not reach the registered mutex race and SSH.' }
                throw 'Quarantine before dispatch mutex still sent SSH in the actual session.'
            }
        } elseif ($case -in @('preflight-failed', 'unexpected-readback', 'overflow') -or $case -match 'lookup$') { Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' } }
        else {
            $result = Invoke-RunnerSession $config $null 'it-inventory-heavy'
            if ($case -in @('same', 'prepared')) { if ($result.id -ne 42 -or $result.outcome -cne 'runner-exited' -or $script:jits -ne 1 -or $script:nativeCalls -ne 3) { throw 'Exact profile demand did not execute the actual session.' } }
            elseif ($result.outcome -cne 'demand-withdrawn' -or $script:jits -ne 0 -or $script:nativeCalls -ne $(if ($case -in @('lower','withdraw-before-image','withdraw-before-copy','withdraw-before-boot')) { 0 } else { 2 })) { throw "Withdrawn demand registered or executed an idle JIT ($case)." }
        }
        $early = $case -in @('preflight-failed','lower','overflow','withdraw-before-image')
        $expectedAllocations = if ($early -or $case -ceq 'withdraw-before-copy') { 0 } else { 1 }
        $expectedCleanups = if ($early) { 0 } else { 1 }
        if ($script:allocations -ne $expectedAllocations -or $script:cleanups -ne $expectedCleanups -or (Test-Path -LiteralPath $script:RunnerStatePath)) { throw "Session did not perform its owned cleanup ($case)." }
        if ($early -and ($script:preflights -ne $(if ($case -ceq 'preflight-failed') { 1 } else { 0 }) -or $script:images -or $script:copies -or $script:boots)) { throw 'Withdrawn demand reached expensive image work.' }
        if ($null -ne $script:RunnerImagePreflight) { throw 'Attempt leaked its preflight deadline into later queue polling.' }
        if ($case -in @('preflight-failed','withdraw-before-image','withdraw-before-copy')) {
            $script:jobs = @((New-Job 1 'it-inventory-heavy'))
            if ($null -eq (Get-QueuedRunnerJob $config 'fixture' -SessionProfileLabel 'it-inventory-heavy')) { throw 'Abandoned attempt blocked a later valid queue lookup.' }
        }
        if ($case -ceq 'withdraw-before-copy' -and $script:copies -ne 0) { throw 'Withdrawn demand copied a disk.' }
        if ($case -ceq 'withdraw-before-boot' -and $script:boots -ne 0) { throw 'Withdrawn demand booted a VM.' }
        if ($case -ceq 'recovery-cancelled' -and $script:recoveryWaits -ne 1) { throw 'Cancellation did not occur at the pre-JIT recovery wait.' }
        if ($case -match 'lookup$' -and ($script:lookupChanges -ne 1 -or $script:jits -ne 0 -or $script:intentPresent -or $script:nativeCalls -ne 2)) { throw 'Changed guardian during queued evidence admitted JIT intent or launch.' }
        if ($case -cmatch '^dispatch-' -and ($script:dispatchChanges -ne 1 -or $script:jits -ne 1 -or $script:nativeCalls -ne 2 -or
            (Read-RunnerJson $registrationPath).phase -cne 'registered')) { throw 'Guardian quarantine race advanced handoff, sent JIT to SSH or lost registered evidence.' }
    }
    # Actual handoff followed by failed SSH still survives finally cleanup and
    # blocks another POST, even though no guest job execution was proven.
    if (Test-Path -LiteralPath $registrationPath) { Remove-Item -LiteralPath $registrationPath }
    $script:case = 'handoff-before-ssh'; $script:jobs = @((New-Job 1 'it-inventory-heavy')); $script:jobCount = 1
    $script:allocations = 0; $script:cleanups = 0; $script:jits = 0; $script:nativeCalls = 0; $script:badReadback = $false
    Set-Item Function:Assert-RunnerClaimOpen $script:actualClaimOpen
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' }
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' }
    $barrier = Read-RunnerJson $registrationPath
    if ($script:jits -ne 1 -or $script:allocations -ne 1 -or $script:cleanups -ne 1 -or $script:nativeCalls -ne 3 -or $barrier.phase -cne 'handed-off' -or $barrier.runnerId -ne 42 -or (Test-Path -LiteralPath $script:RunnerStatePath)) { throw 'Uncertain handed-off SSH permitted another actual-session JIT.' }
    if ((Get-Content -LiteralPath $registrationPath -Raw).Contains('SENTINEL_SECRET')) { throw 'SSH exception leaked into registration evidence.' }
    # Actual session POST ambiguity survives its finally cleanup. Simulate the
    # next admission/restart without resetting the protected registration file.
    $registrationPath = Join-Path $base 'jit-registration.json'
    if (Test-Path -LiteralPath $registrationPath) { Remove-Item -LiteralPath $registrationPath }
    $script:case = 'post-lost'; $script:jobs = @((New-Job 1 'it-inventory-heavy')); $script:jobCount = 1
    $script:allocations = 0; $script:cleanups = 0; $script:jits = 0; $script:nativeCalls = 0; $script:badReadback = $false
    Set-Item Function:Assert-RunnerClaimOpen $script:actualClaimOpen
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' }
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' }
    if ($script:jits -ne 1 -or $script:allocations -ne 1 -or $script:cleanups -ne 1 -or (Test-Path -LiteralPath $script:RunnerStatePath)) { throw 'Lost JIT POST response allowed a second registration after cleanup.' }
    $barrier = Read-RunnerJson $registrationPath
    if ($barrier.phase -cne 'intent' -or $barrier.runnerId -ne 0 -or (Get-Content -LiteralPath $registrationPath -Raw).Contains('SENTINEL_SECRET')) { throw 'Ambiguous registration lost its durable nonsecret barrier.' }
    Remove-Item -LiteralPath $registrationPath
    # Exercise the actual pilot registration segment: only the external evidence
    # read is mocked. A completed bound job after the recovery wait must fail
    # before the real launch journal helper can record an intent.
    $pilotLabel = 'it-inventory-pilot-' + ('a' * 40)
    $Config = [pscustomobject]@{ activation = 'pilot'; pilotLabel = $pilotLabel }
    Write-RunnerJson (Join-Path $base 'pilot-attempt.json') ([ordered]@{ jobId = 1 })
    function Get-PilotEvidence { Change-GuardianDuringDemand; return [pscustomobject]@{ job = $script:pilotJob } }
    $session = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-RunnerSession' }, $true).Extent.Text
    $start = $session.IndexOf('$script:RunnerOperationStage = ''jit-registration'''); $end = $session.IndexOf('$jit = Invoke-GitHub')
    foreach ($case in @('pilot-recovery-cancelled', 'pilot-recovery-lookup', 'pilot-dead-guardian-lookup', 'pilot-not-ready-lookup', 'pilot-expired-lookup', 'pilot-new-generation-lookup')) {
        $script:recoveryWaits = 0; $script:jits = 0; $script:lookupChanges = 0
        $script:pilotJob = New-Job 1 $pilotLabel
        $state = [pscustomobject]@{ tag = $script:RunnerTag; vmName = 'ITIR-' + ('a' * 32); vmId = '11111111-1111-1111-1111-111111111111'; instancePath = Join-Path $base ('ITIR-' + ('a' * 32)); purpose = 'job'; deadlineUtc = [DateTime]::UtcNow.AddMinutes(5).ToString('o') }
        Write-RunnerJson $script:RunnerStatePath $state; Start-SessionGuardian $state
        $name = $state.vmName; $guestMac = [pscustomobject]@{ rawMac = 'fixture' }; $token = 'fixture'
        Assert-Rejected { & ([scriptblock]::Create($session.Substring($start, $end - $start))) }
        if ($script:jits -ne 0 -or (Get-RunnerState).PSObject.Properties.Name -contains 'runnerLaunch' -or
            ($case -ceq 'pilot-recovery-cancelled' -and $script:recoveryWaits -ne 1) -or
            ($case -match 'lookup$' -and $script:lookupChanges -ne 1)) { throw 'Changed pilot evidence/guardian registered or journaled another JIT.' }
    }
    Write-Host 'JIT demand passed: exact profile matrix, queue filtering, overflow refusal, canceled startup/recovery, active/pilot guardian races during demand, lower-profile refusal, exact readback and actual-session cleanup.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -notmatch '^ITIR-demand-[0-9a-f]{32}$') { throw 'Unexpected demand fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
