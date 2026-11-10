# Offline recovery proof only. Every provider/network/state effect is mocked.
param([string] $CandidateRoot = $PSScriptRoot, [switch] $PolicyCapacityOnly, [string] $CasePattern = '*')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $CandidateRoot 'Network.Recovery.ps1')
. (Join-Path $CandidateRoot 'PreparedImage.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-network-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$root = [IO.Path]::GetFullPath($root)
$script:RunnerRoot = $root
$script:RunnerStatePath = Join-Path $root 'state.json'
$script:count = 0
function Copy-Fixture($Value) { $Value | ConvertTo-Json -Depth 30 -Compress | ConvertFrom-Json }
function Assert-Equal($Actual, $Expected, [string] $Message) {
    if (($Actual | ConvertTo-Json -Depth 30 -Compress) -cne ($Expected | ConvertTo-Json -Depth 30 -Compress)) { throw $Message }
}
function Assert-Refused([scriptblock] $Work, [string] $Message) {
    $refused = $false; try { & $Work | Out-Null } catch { $refused = $true }
    if (-not $refused) { throw $Message }
}
function Check([string] $Name, [scriptblock] $Work) { if ($Name -notlike $CasePattern -or ($PolicyCapacityOnly -and $Name -cne 'final deny capacity includes defaults after actual group deduplication')) { return }; & $Work; if ($script:fixtureStateDepth -ne 0 -or $script:locked) { throw 'Recovery case leaked state recursion.' }; $script:count++; Write-Host "PASS $Name" }
function New-Capture([string] $Ip = '192.168.4.12', [string] $Route = '192.168.4.0/24') {
    [pscustomobject]@{
        addresses = @([pscustomobject]@{ AddressFamily = 'IPv4'; IPAddress = $Ip; PrefixLength = 24; InterfaceIndex = 3 })
        routes = @([pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = '0.0.0.0/0'; NextHop = '192.168.4.1'; InterfaceIndex = 3 },
            [pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = $Route; NextHop = '192.168.4.1'; InterfaceIndex = 3 })
    }
}
function Get-NetIPAddress {
    $script:readIndex++
    if ($script:captureDurations.Count -gt 0) { $script:clock = $script:clock.AddMilliseconds($script:captureDurations[$script:readIndex % $script:captureDurations.Count]) }
    if ($script:fail -ceq 'slow-network') { $script:clock = $script:clock.AddSeconds(3) }
    return $script:captures[[Math]::Min($script:readIndex, $script:captures.Count - 1)].addresses
}
function New-SplitCapture {
    $capture=New-Capture
    $capture.routes+=@('0.0.0.0/1','128.0.0.0/1') | ForEach-Object { [pscustomobject]@{AddressFamily='IPv4';DestinationPrefix=$_;NextHop='0.0.0.0';InterfaceIndex=3;RouteMetric=0} }
    return $capture
}
function Get-NetRoute { return $script:captures[[Math]::Min($script:readIndex, $script:captures.Count - 1)].routes }
function Get-RunnerState { $script:clock = $script:clock.AddMilliseconds($script:stateReadDelayMs); if ($script:serializeState) { return ($script:serializedState | ConvertFrom-Json) }; return $script:state }
$script:realStopRead = (Get-Command Test-RunnerSessionStopRequested).ScriptBlock
function Test-RunnerSessionStopRequested($State, [ref] $Reason) {
    $result = if ($null -ne $Reason) { & $script:realStopRead $State $Reason } else { & $script:realStopRead $State }
    if ($script:stopReadDelayMs -gt 0) { $script:clock = $script:clock.AddMilliseconds($script:stopReadDelayMs) }
    return $result
}
function Write-RunnerJson($Path, $Value) { $script:stateSnapshots += @(Copy-Fixture $Value); if ($script:serializeState) { if (-not $script:locked) { throw 'Serialized fixture write escaped state lock.' }; $script:serializedState = $Value | ConvertTo-Json -Depth 30 -Compress; $script:stateWrites++ }; $script:state = $Value }
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) } # TEMP fixture; no installed ACL claim.
# Windows state mutex recursion must retain locked=true until the outer release.
$script:fixtureStateDepth = 0
function Enter-RunnerLock { $script:fixtureStateDepth++; $script:locked = $true; return 'fixture' }
function Exit-RunnerLock {
    if ($script:fixtureStateDepth -le 0) { throw 'Unbalanced fixture state release.' }
    $script:fixtureStateDepth--; $script:locked = $script:fixtureStateDepth -gt 0
}
$fixtureOuter = Enter-RunnerLock; $fixtureInner = Enter-RunnerLock
Exit-RunnerLock $fixtureInner
if (-not $script:locked) { throw 'Nested state release exposed locked IO.' }
Exit-RunnerLock $fixtureOuter
if ($script:locked -or $script:fixtureStateDepth -ne 0) { throw 'State fixture did not balance.' }
function Test-RunnerProcessIdentity { return $script:alive }
function Get-RunnerRecoveryNow { return $script:clock }
function Get-VM {
    $script:vmQueries++
    if (-not $script:locked) { $script:clock = $script:clock.AddMilliseconds($script:preflightDelayMs) }
    if (-not $script:locked -and $null -ne $script:afterPreflightRead) { & $script:afterPreflightRead }
    if ($script:fail -ceq 'timing-success') { $script:clock = $script:clock.AddMilliseconds(100) }
    if ($script:fail -ceq 'timing-stages') {
        # Tick preflight, effect preflight, then final adapter readback. These
        # deliberately differ from the ACL installation's per-rule duration.
        $delaySeconds = switch ($script:vmQueries) { 1 { 1 }; 2 { 5 }; 3 { 7 }; default { 0 } }
        $script:clock = $script:clock.AddSeconds($delaySeconds)
    }
    return $script:vm
}
function Get-RunnerVmInventory { return $script:sealInventory }
function Assert-RunnerInstanceUnreferenced { if ($script:sealDiskReference) { throw 'Fixture disk remains referenced.' } }
function Get-VMSwitch { return $script:switch }
function Get-VMNetworkAdapter { return $script:adapter }
function Assert-FixtureTarget($Target, [string] $Kind) {
    $expected = if ($Kind -ceq 'vm') { $script:vm.Id } else { $script:adapter.Id }
    if ([string]$Target.Id -cne [string]$expected) { throw 'Mutation escaped its exact fixture resource.' }
}
function Suspend-VM($VM) { Assert-FixtureTarget $VM 'vm'; $script:effects += 'pause'; if ($script:fail -ceq 'pause') { throw 'pause failed' }; $script:vm.State = 'Paused' }
function Disconnect-VMNetworkAdapter($VMNetworkAdapter) { Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:effects += 'disconnect'; if ($script:fail -ceq 'disconnect') { throw 'disconnect failed' }; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty; if ($null -ne $script:afterDisconnect) { & $script:afterDisconnect } }
function Connect-VMNetworkAdapter($VMNetworkAdapter, $SwitchName) { Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:effects += 'connect'; if ($script:fail -ceq 'connect') { throw 'connect failed' }; $script:adapter.SwitchName = $SwitchName; $script:adapter.SwitchId = $script:switch.Id }
function Resume-VM($VM) { Assert-FixtureTarget $VM 'vm'; $script:effects += 'resume'; if ($script:fail -ceq 'resume') { throw 'resume failed' }; $script:vm.State = 'Running' }
function Remove-VMNetworkAdapterExtendedAcl {
    [CmdletBinding(DefaultParameterSetName = 'InputObjectParameter')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'InputObjectParameter')][ValidateNotNullOrEmpty()][object[]] $InputObject,
        [Parameter(Mandatory, ParameterSetName = 'ResourceObject')][object] $VMNetworkAdapter,
        [Parameter(Mandatory, ParameterSetName = 'ResourceObject')][int] $Weight,
        [Parameter(Mandatory, ParameterSetName = 'ResourceObject')][ValidateSet('Inbound', 'Outbound')][string] $Direction
    )
    # Mirrors native mandatory parameter sets. Production must use the exact
    # queried ACL object, never a reconstructed direction/weight selector.
    if ($PSCmdlet.ParameterSetName -cne 'InputObjectParameter' -or $InputObject.Count -ne 1) { throw 'Fixture requires one queried ACL InputObject.' }
    $rule = $InputObject[0]
    if (@($script:queriedRules | Where-Object { [object]::ReferenceEquals($_, $rule) }).Count -ne 1) { throw 'Removal did not use the exact queried provider object.' }
    $script:effects += 'remove-acl'; $script:removeCount++
    if ($script:fail -ceq 'remove-acl') { throw 'ACL removal failed' }
    if ($script:fail -cne 'stale-acl') { $script:rules = @($script:rules | Where-Object { -not [object]::ReferenceEquals($_, $rule) }) }
}
function Add-VMNetworkAdapterExtendedAcl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][object] $VMNetworkAdapter,
        [Parameter(Mandatory)][ValidateSet('Allow', 'Deny')][string] $Action,
        [Parameter(Mandatory)][ValidateSet('Inbound', 'Outbound')][string] $Direction,
        [Parameter(Mandatory)][int] $Weight,
        $RemoteIPAddress = '', $LocalIPAddress = '', $LocalPort = '', $RemotePort = '', $Protocol = '', $Stateful = $false, [switch] $Passthru
    )
    Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:addCount++; $script:effects += 'add-acl'
    if ($script:fail -ceq 'slow-apply') { $script:clock = $script:clock.AddSeconds(6) }
    if ($script:fail -ceq 'timing-stages') { $script:clock = $script:clock.AddMilliseconds(100) }
    if ($script:fail -ceq 'partial-acl' -and $script:addCount -eq 3) { throw 'partial ACL failure' }
    $rule = [pscustomobject]@{ Action = $Action; Direction = $Direction; Weight = $Weight; LocalIPAddress = $LocalIPAddress; RemoteIPAddress = $RemoteIPAddress; LocalPort = $LocalPort; RemotePort = $RemotePort; Protocol = $Protocol; Stateful = $Stateful }
    $script:rules += $rule
    if ($Passthru) { return $rule }
}
function Get-VMNetworkAdapterExtendedAcl($VMNetworkAdapter) {
    Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:aclQueries++
    if ($script:fail -ceq 'acl-query') { throw 'ACL query failed' }
    if ($script:fail -ceq 'spoof-stale') { throw 'Recovery observation stale; isolated reinspection required.' }
    if ($script:fail -ceq 'readback') { return }
    if ($script:fail -ceq 'slow-readback') { $script:clock = $script:clock.AddSeconds(3) }
    $script:queriedRules = @($script:rules)
    return $script:rules
}
function Remove-RunnerInstance($State) { $script:effects += 'cleanup'; $script:cleanups++; $script:lastCleanupState = Copy-Fixture $State; if ($script:fail -ceq 'cleanup') { throw 'cleanup refused' }; $script:state = $null }
function New-RunnerProbeProcess($Executable, $Arguments) {
    if ($script:locked) { throw 'Probe dispatch held state mutex.' }
    if ($Arguments -notmatch 'Network.Recovery.Probe.ps1') { throw 'Probe dispatched arbitrary command.' }
    $script:effects += 'probe-start'
    $job = [pscustomobject]@{ Completed = $false; ExitCode = 0 }
    $job | Add-Member -MemberType ScriptMethod -Name CancelAndDrain -Value { $script:effects += 'probe-cancel'; $script:effects += 'probe-remove'; if ($script:fail -ceq 'probe-drain') { throw 'Uncertain probe drain.' } }
    return $job
}
$script:realObservation = (Get-Command Get-RunnerNetworkObservation).ScriptBlock
function Get-RunnerNetworkObservation {
    if ($script:locked) { throw 'Network observation held the state mutex.' }
    $observation = & $script:realObservation
    if ($null -ne $script:afterObservation) { & $script:afterObservation }
    return $observation
}
function New-Fixture {
    if ($script:fixtureStateDepth -ne 0) { throw 'Previous fixture leaked state recursion.' }
    $script:serializeState = $false; $script:serializedState = ''; $script:stateWrites = 0
    $script:stateSnapshots = @()
    $script:now = [DateTime]::UtcNow
    $script:lastCleanupState = $null
    $script:vmQueries = 0
    $script:clock = $script:now; $script:RunnerRecoveryProbe = $null
    $script:afterObservation = $null
    $script:afterDisconnect = $null
    $script:afterPreflightRead = $null
    $script:captureDurations = @(); $script:preflightDelayMs = 0
    $script:stopReadDelayMs = 0; $script:stateReadDelayMs = 0
    $script:sealInventory = @(); $script:sealDiskReference = $false
    $script:locked = $false; $script:alive = $true; $script:fail = ''; $script:effects = @(); $script:cleanups = 0; $script:addCount = 0; $script:removeCount = 0; $script:aclQueries = 0; $script:rules = @(); $script:queriedRules = @()
    $script:captures = @(New-Capture); $script:readIndex = -1
    $script:state = [pscustomobject]@{
        layoutVersion = 2; tag = $script:RunnerTag; vmName = 'ITIR-' + ('a' * 32); vmId = '00000000-0000-0000-0000-000000000001'
        instancePath = Join-Path (Join-Path $root 'instances') ('ITIR-' + ('a' * 32)); purpose = 'job'; resourceLabel = 'it-inventory-heavy'; claimMode = 'active'
        createdUtc = $script:now.ToString('o'); deadlineUtc = $script:now.AddMinutes(10).ToString('o')
        supervisorPid = 42; supervisorStartUtc = $script:now.ToString('o'); guardianPid = $PID; guardianStartUtc = $script:now.ToString('o'); guestMac = '02AABBCCDDEE'
        networkFingerprint = ('a' * 64)
    }
    $script:vm = [pscustomobject]@{ Id = [guid]$script:state.vmId; Name = $script:state.vmName; Notes = $script:RunnerTag; Path = (Get-RunnerSessionPaths $script:state).vmPath; State = 'Running' }
    $script:switch = [pscustomobject]@{ Id = [guid]'00000000-0000-0000-0000-000000000002'; Name = $script:RunnerSwitch; SwitchType = 'Internal' }
    $script:adapter = [pscustomobject]@{ Id = 'fixture-adapter'; VMId = $script:vm.Id; VMName = $script:vm.Name; DynamicMacAddressEnabled = $false; MacAddress = $script:state.guestMac; SwitchName = $script:switch.Name; SwitchId = $script:switch.Id }
    $script:binding = New-RunnerNetworkBinding $script:state $script:vm $script:adapter $script:switch
    $script:recovery = New-RunnerNetworkRecovery $script:binding ('a' * 64) $script:now.AddMinutes(10) $script:now
    $script:state | Add-Member -NotePropertyName networkRecovery -NotePropertyValue $script:recovery
    $script:observation = [pscustomobject]@{ fingerprint = ('b' * 64); rules = @(New-RunnerNetworkPolicy $script:captures[0]) }
}
function Plan([int] $Seconds = 0, $Observation = $script:observation, $Outcome = $null, [string] $VmState = 'Running') {
    Get-RunnerNetworkRecoveryPlan $script:recovery $Observation $script:now.AddSeconds($Seconds) $VmState $Outcome
}
function Complete([string] $Operation, [int] $Seconds, [bool] $Success = $true) {
    $outcome = [pscustomobject]@{ generation = $script:recovery.generation; operation = $Operation; success = $Success }
    $script:recovery = (Plan $Seconds $script:observation $outcome).recovery
}
function Isolate {
    $script:recovery = (Plan).recovery
    Complete 'quarantine' 1
}
function Set-FixtureVerifiedRules {
    $script:rules = @(foreach ($rule in $script:observation.rules) {
        $full = [ordered]@{ Action = ''; Direction = ''; LocalIPAddress = ''; RemoteIPAddress = ''; LocalPort = ''; RemotePort = ''; Protocol = ''; Weight = 0; Stateful = $false }
        foreach ($field in $rule.PSObject.Properties) { $full[$field.Name] = $field.Value }
        [pscustomobject]$full
    })
    $script:state.networkRecovery.verifiedRules = $script:rules
}
function New-StaleRetryFixture {
    New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
    $r = $script:state.networkRecovery; $r.phase = 'verified'; $r.operation = ''; $r.stableObservations = 2
    $r.lastStableUtc = $script:now.AddSeconds(-1).ToString('o')
    $r.episodeStartedUtc = $script:now.ToString('o'); $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o')
    $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
    Set-FixtureVerifiedRules
    $script:fail = 'slow-readback'
}
function New-SealingFixture {
    New-Fixture
    $script:state.purpose = 'prepare'; $script:state.PSObject.Properties.Remove('claimMode')
    $script:binding.claimHash = Get-RunnerRecoveryClaimHash $script:state
    $script:state | Add-Member phase 'preparing'
    $script:state | Add-Member guardianReady $false
    $bin = Join-Path $root 'bin'; [void][IO.Directory]::CreateDirectory($bin)
    Copy-Item -LiteralPath (Join-Path $CandidateRoot 'Image.Inputs.json') -Destination (Join-Path $bin 'Image.Inputs.json') -Force
}
function Commit-FixtureSeal {
    $r = $script:state.networkRecovery
    $r.generation++; $r.phase = 'sealed-preparation'; $r.operation = ''; $r.resumeRequired = $false
    $r.episodeStartedUtc = ''; $r.episodeDeadlineUtc = ''; $r.progressUtc = $script:clock.ToString('o')
    $script:state.phase = 'sealed-off'
    $inputs = Get-Content -LiteralPath (Join-Path $CandidateRoot 'Image.Inputs.json') -Raw | ConvertFrom-Json
    $images = @(foreach ($image in $inputs.images) {
        [pscustomobject]@{ source = $image.source; reference = $image.candidates[0]; id = 'sha256:' + ('a' * 64); digests = @('fixture');
            aliases = @(if ($image.PSObject.Properties.Name -contains 'aliases') { $image.aliases | ForEach-Object { [pscustomobject]@{ reference = $_; id = 'sha256:' + ('a' * 64) } } }) }
    })
    $proof = [pscustomobject]@{ schema = 1; recipeId = 'A' * 64; scrubbed = $true; capabilities = @('os-prerequisites', 'node-toolcache', 'npm-cache', 'playwright', 'supabase-images'); images = $images }
    $script:state | Add-Member imageScrubProof (Get-RunnerJsonEvidence $proof) -Force
    $seal = [pscustomobject]@{ schema = 1; generation = $r.generation; bindingHash = 'B' * 64; bundleHash = 'C' * 64; recipeId = 'A' * 64; scrubProofHash = $script:state.imageScrubProof.hash }
    $script:state | Add-Member imageSealBinding (Get-RunnerJsonEvidence $seal) -Force
}
try {
    Check 'isolated completed preflight changes only progress before genuine slow capture' {
        foreach ($phase in @('isolated', 'verified')) {
          foreach ($vmState in @('Paused', 'Off')) {
            New-Fixture; $r = $script:state.networkRecovery; $r.phase = $phase
            $script:state | Add-Member guardianReady $false -Force
            $script:vm.State = $vmState; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
            $r.episodeStartedUtc = $script:now.ToString('o'); $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o')
            $r.progressUtc = $script:now.AddSeconds(-1).ToString('o'); $before = Copy-Fixture $script:state
            $script:preflightDelayMs = 26122
            # Explicit 4351 + 1799 = 6150 ms. Retained age is 1799 ms.
            $script:readIndex = -1; $script:captureDurations = @(4351, 1799)
            $script:preObservationWrites = -1; $script:afterObservation = { $script:preObservationWrites = $script:stateSnapshots.Count }
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            Assert-Equal $script:preObservationWrites 1 'Isolated completed preflight checkpoint missing or repeated.'
            $expected = Copy-Fixture $before; $expected.networkRecovery.progressUtc = $script:now.AddMilliseconds(26122).ToString('o')
            Assert-Equal $script:stateSnapshots[0] $expected 'Isolated checkpoint changed authority, readiness, phase, proof or deadlines.'
            Assert-Equal $p.continue $true 'Positively isolated work falsely expired.'
            Assert-Equal $script:effects @() 'Isolated checkpoint supplied connection authority.'
            Assert-Equal $script:clock $script:now.AddMilliseconds(32272) 'Fixture omitted actual inspection time.'
          }
        }
    }
    Check 'slow healthy inspection retains its original thirty second admission boundary' {
        New-Fixture; $script:state | Add-Member guardianReady $true -Force
        $r = $script:state.networkRecovery; $r.fingerprint = (Get-RunnerNetworkObservation).fingerprint
        $r.progressUtc = $script:now.AddSeconds(-1).ToString('o'); $before = $r.progressUtc
        $script:preflightDelayMs = 26122; $script:readIndex = -1; $script:captureDurations = @(4351, 1799)
        $script:preObservationWrites = -1; $script:afterObservation = { $script:preObservationWrites = $script:stateSnapshots.Count }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $script:preObservationWrites 0 'Healthy preflight renewed admission before network verification.'
        Assert-Equal $p.continue $false 'Healthy inspection exceeding thirty seconds remained authorized.'
        Assert-Equal $script:lastCleanupState.networkRecovery.progressUtc $before 'Slow healthy inspection invented authority.'
        Assert-Equal $script:lastCleanupState.networkRecovery.failure 'guardian-progress-expired' 'Healthy boundary failed for another reason.'
    }
    Check 'checkpoint cannot revive expired isolated progress or a hanging following capture' {
        foreach ($age in @(0, 1000)) {
            New-Fixture; $script:state | Add-Member guardianReady $false -Force
            $script:state.networkRecovery.phase = 'isolated'; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            $script:state.networkRecovery.progressUtc = $script:now.AddMilliseconds(-$age).ToString('o'); $script:preflightDelayMs = 30000 - $age
            $script:preObservationWrites = -1; $script:afterObservation = { $script:preObservationWrites = $script:stateSnapshots.Count }
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            Assert-Equal $p.continue $false 'Thirty-second boundary was revived.'
            Assert-Equal $script:preObservationWrites 0 'Expired isolated preflight published progress.'
            Assert-Equal $script:lastCleanupState.networkRecovery.progressUtc $script:now.AddMilliseconds(-$age).ToString('o') 'Expired progress changed before cleanup.'
        }
        New-Fixture; $script:state | Add-Member guardianReady $false -Force
        $script:state.networkRecovery.phase = 'isolated'; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $script:preflightDelayMs = 1000; $script:readIndex = -1; $script:captureDurations = @(15001, 15000)
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Following capture hang renewed the isolated checkpoint.'
        Assert-Equal $script:lastCleanupState.networkRecovery.failure 'guardian-progress-expired' 'Capture hang lost its progress deadline.'
        Assert-Equal $script:lastCleanupState.networkRecovery.progressUtc $script:now.AddSeconds(1).ToString('o') 'Capture hang invented progress.'
    }
    Check 'running connected ready pending and mislabeled recovery never receives a checkpoint' {
        foreach ($kind in @('running', 'connected', 'ready', 'unknown-ready', 'healthy', 'quarantine', 'apply', 'connect', 'resume', 'probe', 'mislabeled-probe')) {
            New-Fixture; $r = $script:state.networkRecovery; $r.phase = 'isolated'
            $script:state | Add-Member guardianReady $false -Force
            $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
            $outcome = $null
            switch ($kind) {
                'running' { $script:vm.State = 'Running' }
                'connected' { $script:adapter.SwitchName = $script:switch.Name; $script:adapter.SwitchId = $script:switch.Id }
                'ready' { $script:state.guardianReady = $true }
                'unknown-ready' { $script:state.guardianReady = 'false' }
                'healthy' { $r.phase = 'healthy'; $r.fingerprint = $r.candidateFingerprint }
                'mislabeled-probe' { $r.operation = 'probe' }
                default {
                    $r.operation = $kind
                    $r.phase = @{ quarantine='quarantining';apply='applying';connect='connecting';resume='resuming';probe='probing' }[$kind]
                    $outcome = [pscustomobject]@{ generation=$r.generation;operation=$kind;success=$true }
                }
            }
            $script:preflightDelayMs = 1000; $script:preObservationWrites = -1
            $script:afterObservation = { $script:preObservationWrites = $script:stateSnapshots.Count }
            try { [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) $outcome) } catch { }
            Assert-Equal $script:preObservationWrites 0 "Nonisolated or unresolved $kind state acquired progress authority."
        }
    }
    Check 'pending probe cannot renew progress through repeated good provider polls' {
        New-Fixture; $r = $script:state.networkRecovery; $r.phase = 'probing'; $r.operation = 'probe'
        $script:state | Add-Member guardianReady $false -Force
        $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint; $before = $r.progressUtc
        $script:preflightDelayMs = 1000
        foreach ($poll in 1..29) {
            $script:stateSnapshots = @(); $script:preObservationWrites = -1
            $script:afterObservation = { $script:preObservationWrites = $script:stateSnapshots.Count }
            [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}))
            Assert-Equal $script:preObservationWrites 0 'Pending probe acquired a checkpoint.'
            Assert-Equal $script:state.networkRecovery.progressUtc $before 'Pending probe refreshed progress.'
        }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Pending probe survived its original progress boundary.'
        Assert-Equal $script:lastCleanupState.networkRecovery.progressUtc $before 'Pending probe revived progress before cleanup.'
    }
    Check 'failed unknown or mismatched provider preflight cannot publish completed progress' {
        foreach ($kind in @('failed', 'unknown', 'binding')) {
            New-Fixture; $script:preflightKind = $kind; $script:preflightDelayMs = 1000
            $script:state.networkRecovery.phase = 'isolated'; $script:state | Add-Member guardianReady $false -Force
            $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            $script:afterPreflightRead = {
                switch ($script:preflightKind) {
                    'failed' { throw 'Fixture provider failure.' }
                    'unknown' { $script:vm = $null }
                    'binding' { $script:vm.Id = [guid]'00000000-0000-0000-0000-000000000003' }
                }
            }
            $script:preObservationWrites = -1; $script:afterObservation = { $script:preObservationWrites = $script:stateSnapshots.Count }
            $result = $null; $failure = $null
            try { $result = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) } catch { $failure = $_ }
            if ($kind -ceq 'failed') { Assert-Equal $script:stateSnapshots.Count 0 'Failed provider published progress.' }
            else { Assert-Equal $script:preObservationWrites 0 'Unknown/mismatched provider published progress.' }
            if ($null -eq $failure -and ($null -eq $result -or $result.continue)) { throw 'Uncertain provider result reported success.' }
        }
    }
    Check 'pending probe and unvalidated outcomes cannot renew completed preflight progress' {
        foreach ($outcomeKind in @('pending', 'stale', 'wrong-operation', 'failed', 'raw-success')) {
            New-Fixture; $r = $script:state.networkRecovery; $r.phase = 'probing'; $r.operation = 'probe'
            $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
            $r.episodeStartedUtc = $script:now.ToString('o'); $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o')
            $before = $r.progressUtc
            $outcome = switch ($outcomeKind) {
                'pending' { $null }
                'stale' { [pscustomobject]@{ generation = -1; operation = 'probe'; success = $true } }
                'wrong-operation' { [pscustomobject]@{ generation = 0; operation = 'apply'; success = $true } }
                'failed' { [pscustomobject]@{ generation = 0; operation = 'probe'; success = $false } }
                'raw-success' { [pscustomobject]@{ generation = 0; operation = 'probe'; success = $true } }
            }
            $script:preflightDelayMs = 1000
            # Observe the checkpoint boundary before the reducer is allowed to
            # consume any completion; an arbitrary success object is insufficient.
            $script:preObservationWrites = -1; $script:afterObservation = { $script:preObservationWrites = $script:stateSnapshots.Count }
            if ($outcomeKind -ceq 'pending') {
                foreach ($poll in 1..29) {
                    [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) $outcome)
                    Assert-Equal $script:preObservationWrites 0 'Pending operation acquired a checkpoint.'
                    Assert-Equal $script:state.networkRecovery.progressUtc $before 'Pending probe polls refreshed progress.'
                    $script:stateSnapshots = @()
                }
                $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
                Assert-Equal $p.continue $false 'Pending probe survived its original progress bound.'
                Assert-Equal $script:lastCleanupState.networkRecovery.progressUtc $before 'Pending probe was revived before cleanup.'
            } else {
                [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) $outcome)
                Assert-Equal $script:preObservationWrites 0 'Unvalidated operation acquired a checkpoint.'
            }
        }
    }
    Check 'preflight precedes genuine two-capture observation without ageing the retained lease' {
        New-Fixture; $r = $script:state.networkRecovery; $r.fingerprint = (Get-RunnerNetworkObservation).fingerprint
        # Explicit fixture durations: first capture 2052 ms, retained second
        # capture 1419 ms. Total 3471 ms does not establish the retained age.
        $script:readIndex = -1; $script:captureDurations = @(2052, 1419); $script:preflightDelayMs = 1328
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $script:effects @() 'Provider preflight aged a newly retained observation into quarantine.'
        Assert-Equal $p.continue $true 'Fresh observed network stopped.'
        Assert-Equal $script:state.networkRecovery.diagnostics.observationElapsedMs 3471 'Capture duration changed.'
        Assert-Equal $script:state.networkRecovery.diagnostics.preflightElapsedMs 1328 'Preflight duration changed.'
        Assert-Equal $script:clock $script:now.AddMilliseconds(4799) 'Fixture omitted real elapsed time.'
    }
    Check 'seal committed during unlocked preflight discards stale success and failure' {
        foreach ($providerFailure in @($false, $true)) {
            New-SealingFixture; $script:sealProviderFailure = $providerFailure
            $script:afterPreflightRead = { Commit-FixtureSeal; if ($script:sealProviderFailure) { throw 'Removed builder registration.' } }
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            Assert-Equal $p.continue $true 'Committed preparation seal was rejected.'
            Assert-Equal $p.outcome $null 'Obsolete provider result survived sealing.'
            Assert-Equal $script:state.guardianReady $true 'Sealed supervision was not published.'
            Assert-Equal $script:effects @() 'Sealed builder entered recovery effects or cleanup.'
        }
    }
    Check 'seal committed after the completed checkpoint still supersedes obsolete provider success' {
        New-SealingFixture; $script:preflightDelayMs = 1000
        $script:state.networkRecovery.phase = 'isolated'; $script:vm.State = 'Paused'
        $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $script:afterObservation = { Commit-FixtureSeal }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $true 'Seal committed after checkpoint was rejected.'
        Assert-Equal $p.outcome $null 'Obsolete preflight outcome survived the later seal.'
        Assert-Equal $script:effects @() 'Later seal entered reducer, effects or cleanup.'
        Assert-Equal $script:stateSnapshots.Count 2 'Fixture did not exercise checkpoint followed by sealed publication.'
        Assert-Equal $script:state.guardianReady $true 'Later committed seal lost supervision.'
    }
    Check 'seal handoff rejects immutable drift partial proofs unrelated generation Stop expiry and live references' {
        foreach ($change in @('owner', 'guardian', 'vm', 'instance', 'partial-state', 'partial-recovery', 'proof', 'generation', 'stop', 'deadline', 'progress', 'vm-present', 'disk-reference')) {
            New-SealingFixture; $script:sealChange = $change
            $stopPath = Join-Path $script:state.instancePath 'stop.requested'; [void][IO.Directory]::CreateDirectory($script:state.instancePath)
            $script:afterPreflightRead = {
                Commit-FixtureSeal
                switch ($script:sealChange) {
                    'owner' { $script:state.supervisorStartUtc = $script:clock.AddSeconds(1).ToString('o') }
                    'guardian' { $script:state.guardianStartUtc = $script:clock.AddSeconds(1).ToString('o') }
                    'vm' { $script:state.vmId = '00000000-0000-0000-0000-000000000003' }
                    'instance' { $script:state.instancePath += '-other' }
                    'partial-state' { $script:state.phase = 'preparing' }
                    'partial-recovery' { $script:state.networkRecovery.phase = 'healthy' }
                    'proof' { $script:state.imageScrubProof.hash = 'D' * 64 }
                    'generation' { $script:state.networkRecovery.generation += 7; $seal = Get-RunnerEvidenceValue $script:state.imageSealBinding; $seal.generation += 7; $script:state.imageSealBinding = Get-RunnerJsonEvidence $seal }
                    'stop' { [IO.File]::WriteAllText($stopPath, '') }
                    'deadline' { $script:clock = $script:clock.AddMinutes(11) }
                    'progress' { $script:state.networkRecovery.progressUtc = $script:clock.AddSeconds(1).ToString('o') }
                    'vm-present' { $script:sealInventory = @($script:vm) }
                    'disk-reference' { $script:sealDiskReference = $true }
                }
            }
            try { Assert-Refused { Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) } "Seal accepted $change." }
            finally { if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath } }
            Assert-Equal $script:effects @() "Rejected seal mutated provider after $change."
        }
    }
    Check 'final dispatch clock follows blocking state and Stop reads' {
        foreach ($action in @('connect', 'resume')) {
          foreach ($blockingRead in @('state', 'stop')) {
            New-Fixture; $r = $script:state.networkRecovery; $r.operation = $action
            $r.phase = if ($action -ceq 'connect') { 'connecting' } else { 'resuming' }
            $r.observationUtc = $script:now.AddMilliseconds(-1419).ToString('o')
            $script:vm.State = 'Paused'
            if ($blockingRead -ceq 'state') { $script:stateReadDelayMs = 600 } else { $script:stopReadDelayMs = 600 }
            $failure = $null
            try { Assert-RunnerRecoveryDispatch $script:state $r $script:vm $script:adapter } catch { $failure = $_ }
            if ($null -eq $failure -or -not (Test-RunnerIsolatedStaleAdmission $failure $r)) { throw 'Blocking final Stop read authorized an aged lease.' }
            Assert-Equal $r.diagnostics.observationAgeMs 2019 'Final admission sampled before Stop completed.'
            Assert-Equal $script:effects @('disconnect') 'Stale final admission failed to preserve isolation.'
          }
            New-Fixture; $r = $script:state.networkRecovery; $r.operation = $action
            $r.hardDeadlineUtc = $script:now.AddSeconds(2).ToString('o'); $script:stopReadDelayMs = 2001
            Assert-Refused { Assert-RunnerRecoveryDispatch $script:state $r $script:vm $script:adapter } 'Final Stop read crossed the hard deadline but authorized dispatch.'
            Assert-Equal $script:effects @() 'Expired dispatch mutated provider.'
        }
    }
    Check 'preflight delay alone preserves a fresh capture but slow retained capture remains stale' {
        New-Fixture; $script:state.networkRecovery.fingerprint = (Get-RunnerNetworkObservation).fingerprint
        $script:preflightDelayMs = 26000
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $script:effects @() 'Preflight delay poisoned a later fresh observation.'
        Assert-Equal $p.continue $true 'Fresh capture within real progress deadline stopped.'
        New-Fixture; $script:state.networkRecovery.fingerprint = (Get-RunnerNetworkObservation).fingerprint
        $script:readIndex = -1; $script:captureDurations = @(1471, 2001); $script:preflightDelayMs = 1328
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.outcome.operation 'quarantine' 'Retained capture above two seconds authorized access.'
        Assert-Equal $script:effects @('pause', 'disconnect') 'Slow retained capture escaped isolation.'
        Assert-Equal $script:state.networkRecovery.diagnostics.staleAdmissionCount 1 'Slow retained capture lost refusal evidence.'
    }
    Check 'fresh post-preflight captures complete quarantine stable apply stable connect resume and probe once' {
        New-Fixture; $script:readIndex = -1; $script:captureDurations = @(2052, 1419); $script:preflightDelayMs = 1328
        $config = [pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }
        $hard = $script:state.networkRecovery.hardDeadlineUtc; $p = $null; $operations = @(); $episode = ''
        foreach ($tick in 1..12) {
            $beforeReads = $script:readIndex
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName $config $(if ($null -ne $p) { $p.outcome } else { $null })
            Assert-Equal $p.continue $true 'Stable end-to-end recovery stopped.'
            Assert-Equal $script:state.networkRecovery.hardDeadlineUtc $hard 'Recovery extended hard lifetime.'
            if ($null -ne $p.outcome) { $operations += $p.outcome.operation }
            if ($script:state.networkRecovery.episodeDeadlineUtc) {
                if (-not $episode) { $episode = $script:state.networkRecovery.episodeDeadlineUtc }
                Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $episode 'Recovery reset the outage deadline.'
            }
            if ($null -ne $p.outcome -and $p.outcome.operation -cin @('connect', 'resume')) {
                Assert-Equal ($script:readIndex - $beforeReads) 4 'Reconnect/resume reused the tick capture instead of its independent fresh pair.'
            }
            if ($null -ne $script:RunnerRecoveryProbe) {
                $probe = $script:RunnerRecoveryProbe; $probe.job.Completed = $true
                [void][IO.Directory]::CreateDirectory((Split-Path -Parent $probe.resultPath))
                [IO.File]::WriteAllText($probe.resultPath, (@{ schema = 1; probeId = $probe.probeId; generation = $probe.generation; success = $true; diagnostic = 'passed'; elapsedMs = 1 } | ConvertTo-Json -Compress))
            }
            if ($script:state.networkRecovery.phase -ceq 'healthy') { break }
        }
        Assert-Equal $operations @('quarantine', 'apply', 'connect', 'resume') 'Recovery repeated apply or skipped a containment/connection phase.'
        Assert-Equal $script:state.networkRecovery.phase 'healthy' 'Fresh end-to-end observations did not recover.'
        Assert-Equal $script:state.networkRecovery.diagnostics.applyCount 1 'Stable recovery applied policy more than once.'
        Assert-Equal $script:cleanups 0 'Fresh recovery used cleanup.'
        Assert-Equal @($script:effects | Where-Object { $_ -ceq 'probe-start' }).Count 1 'Recovery did not run exactly one probe.'
    }
    Check 'successful reconnect diagnostics survive serialized state and the next guardian tick' {
        foreach ($action in @('connect', 'resume', 'quarantine')) {
            New-Fixture; $script:vm.State = 'Paused'
            if ($action -cne 'resume') { $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty }
            $r = $script:state.networkRecovery; $r.phase = if ($action -ceq 'resume') { 'resuming' } else { 'connecting' }; $r.operation = if ($action -ceq 'resume') { 'resume' } else { 'connect' }
            $r.resumeRequired = $action -ceq 'resume'; $r.candidateFingerprint = if ($action -ceq 'quarantine') { 'b' * 64 } else { (Get-RunnerNetworkObservation).fingerprint }
            $r.episodeStartedUtc = $script:now.ToString('o'); $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o')
            Set-FixtureVerifiedRules
            $deadline = $r.episodeDeadlineUtc; $hard = $r.hardDeadlineUtc; $binding = Copy-Fixture $r.binding
            $script:serializedState = $script:state | ConvertTo-Json -Depth 30 -Compress; $script:serializeState = $true; $script:fail = 'timing-success'
            $p = Invoke-RunnerRecoveryReconnect $script:binding 0 $(if ($action -ceq 'resume') { 'resume' } else { 'connect' })
            Assert-Equal $p.continue $true 'Successful serialized reconnect stopped.'
            Assert-Equal $p.outcome.operation $action 'Serialized reconnect changed its operation.'
            $saved = Get-RunnerState
            Assert-Equal $saved.networkRecovery.diagnostics.($action + 'ElapsedMs') 200 'Successful adapter attempt timing was not durably written.'
            if ($action -cne 'quarantine') {
                Assert-Equal $saved.networkRecovery.diagnostics.admissionOperation $action 'Successful admission operation was lost at serialization.'
                Assert-Equal $saved.networkRecovery.diagnostics.observationAgeMs 100 'Successful actual observation age was lost at serialization.'
            }
            Assert-Equal $saved.networkRecovery.generation $p.outcome.generation 'Diagnostic persistence advanced generation.'
            Assert-Equal $saved.networkRecovery.binding $binding 'Diagnostic persistence changed authority binding.'
            Assert-Equal $saved.networkRecovery.episodeDeadlineUtc $deadline 'Diagnostic persistence extended the episode.'
            Assert-Equal $saved.networkRecovery.hardDeadlineUtc $hard 'Diagnostic persistence extended the hard lifetime.'
            Assert-Equal $script:stateWrites 2 'Success must persist intent and completed diagnostics under the same mutex.'
            Assert-Equal $script:vmQueries 2 'Persistence added an extra provider identity check.'
            $effects = @($script:effects); $diagnostic = Copy-Fixture $saved.networkRecovery.diagnostics
            $tick = Invoke-RunnerNetworkRecoveryTick $saved.vmName ([pscustomobject]@{})
            $next = Get-RunnerState
            Assert-Equal $tick.outcome $null 'The next tick fabricated a completed provider outcome.'
            Assert-Equal $next.networkRecovery.diagnostics.($action + 'ElapsedMs') $diagnostic.($action + 'ElapsedMs') 'Next fresh-state tick lost successful attempt duration.'
            Assert-Equal $next.networkRecovery.diagnostics.admissionOperation $diagnostic.admissionOperation 'Next fresh-state tick lost admission operation.'
            Assert-Equal $next.networkRecovery.diagnostics.observationAgeMs $diagnostic.observationAgeMs 'Next fresh-state tick lost admission age.'
            Assert-Equal $script:effects $effects 'Diagnostic persistence repeated provider mutations.'
        }
    }
    Check 'successful tick quarantine diagnostics survive serialized state and the next guardian tick' {
        New-Fixture; $script:fail = 'timing-success'
        $binding = Copy-Fixture $script:state.networkRecovery.binding; $hard = $script:state.networkRecovery.hardDeadlineUtc
        $script:serializedState = $script:state | ConvertTo-Json -Depth 30 -Compress; $script:serializeState = $true
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        $saved = Get-RunnerState
        Assert-Equal $p.outcome.operation 'quarantine' 'Serialized tick did not quarantine drift.'
        Assert-Equal $saved.networkRecovery.diagnostics.quarantineElapsedMs 300 'Successful quarantine timing was not durably written.'
        Assert-Equal $saved.networkRecovery.generation $p.outcome.generation 'Diagnostic persistence advanced quarantine generation.'
        Assert-Equal $saved.networkRecovery.binding $binding 'Diagnostic persistence changed quarantine binding.'
        Assert-Equal $saved.networkRecovery.hardDeadlineUtc $hard 'Quarantine persistence extended hard lifetime.'
        Assert-Equal $script:stateWrites 2 'Tick must persist intent and completed quarantine diagnostics under the same mutex.'
        Assert-Equal $script:effects @('pause', 'disconnect') 'Quarantine persistence changed isolation effects.'
        $tick = Invoke-RunnerNetworkRecoveryTick $saved.vmName ([pscustomobject]@{})
        Assert-Equal $tick.outcome $null 'The next tick fabricated quarantine completion.'
        Assert-Equal (Get-RunnerState).networkRecovery.diagnostics.quarantineElapsedMs 300 'Next fresh-state tick lost successful quarantine timing.'
        Assert-Equal $script:effects @('pause', 'disconnect') 'The next tick repeated quarantine.'
    }
    Check 'episode diagnostics distinguish churn from repeated identical observations and reset only on a new episode' {
        New-Fixture; Isolate
        $deadline = $script:recovery.episodeDeadlineUtc; $hard = $script:recovery.hardDeadlineUtc
        $script:recovery = (Plan 2 $null).recovery
        $script:recovery = (Plan 3 $null).recovery
        $script:recovery = (Plan 4).recovery
        $script:recovery = (Plan 5).recovery
        $changed = [pscustomobject]@{ fingerprint = ('c' * 64); rules = $script:observation.rules }
        $script:recovery = (Plan 6 $changed).recovery
        Assert-Equal $script:recovery.diagnostics.observationUnavailableCount 2 'Unavailable observations lost.'
        Assert-Equal $script:recovery.diagnostics.fingerprintChangeCount 2 'Repeated same fingerprint counted as churn.'
        Assert-Equal $script:recovery.diagnostics.trigger 'fingerprint-change' 'Episode trigger overwritten.'
        Assert-Equal $script:recovery.episodeDeadlineUtc $deadline 'Diagnostic churn changed episode deadline.'
        Assert-Equal $script:recovery.hardDeadlineUtc $hard 'Diagnostic churn changed hard deadline.'
        $script:recovery.phase = 'healthy'; $script:recovery.operation = ''; $script:recovery.fingerprint = 'c' * 64
        $script:recovery.episodeStartedUtc = ''; $script:recovery.episodeDeadlineUtc = ''
        $script:recovery = (Plan 7 $null).recovery
        Assert-Equal $script:recovery.diagnostics.observationUnavailableCount 1 'New episode did not reset counters.'
        Assert-Equal $script:recovery.diagnostics.fingerprintChangeCount 0 'New episode retained old churn.'
        Assert-Equal $script:recovery.diagnostics.trigger 'observation-unavailable' 'New outage trigger missing.'
    }
    Check 'diagnostic counters and timings saturate and corrupt evidence cannot change admission' {
        New-Fixture; $d = $script:recovery.diagnostics
        $d.staleAdmissionCount = 1000000; Set-RunnerRecoveryDiagnostic $script:recovery 'staleAdmissionCount' 1
        Set-RunnerRecoveryDiagnostic $script:recovery 'applyElapsedMs' 999999999
        Assert-Equal $d.staleAdmissionCount 1000000 'Counter exceeded bound.'
        Assert-Equal $d.applyElapsedMs 86400000 'Timing exceeded bound.'
        $script:recovery.diagnostics = 'SECRET malformed evidence'
        $p = Plan
        Assert-Equal $p.action 'quarantine' 'Malformed diagnostics affected quarantine admission.'
        Assert-Equal $p.recovery.episodeDeadlineUtc $script:now.AddSeconds(120).ToString('o') 'Malformed diagnostics changed deadline.'
    }
    Check 'legacy diagnostics accept new bounded admission fields without affecting authority' {
        New-Fixture; $r = $script:state.networkRecovery
        foreach ($name in @('admissionOperation', 'observationAgeMs', 'quarantineElapsedMs', 'connectElapsedMs', 'resumeElapsedMs')) { $r.diagnostics.PSObject.Properties.Remove($name) }
        Set-RunnerRecoveryDiagnostic $r 'admissionOperation' 'resume'
        Set-RunnerRecoveryDiagnostic $r 'observationAgeMs' -1000
        Set-RunnerRecoveryDiagnostic $r 'connectElapsedMs' 3000
        Assert-Equal $r.diagnostics.admissionOperation 'resume' 'Legacy diagnostic object lost the new string field.'
        Assert-Equal $r.diagnostics.observationAgeMs (-1000) 'Future retained capture age was normalized away.'
        Assert-Equal $r.diagnostics.connectElapsedMs 3000 'Legacy diagnostic object lost the new timing field.'
        $projected = New-RunnerRecoveryDiagnostic $r $script:now
        Assert-RunnerRecoveryDiagnostic ($projected | ConvertTo-Json -Compress | ConvertFrom-Json)
        Assert-Equal $projected.admissionOperation 'resume' 'Projection lost bounded admission operation.'
    }
    Check 'missing and malformed existing episode diagnostics cannot change connect or drift quarantine effects' {
        foreach ($case in @('missing', 'null', 'scalar', 'missing-fields', 'nonnumeric', 'boolean', 'negative', 'oversized', 'nan')) {
            foreach ($drift in @($false, $true)) {
                New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
                $r = $script:state.networkRecovery; $r.phase = 'verified'; $r.operation = ''
                $r.episodeStartedUtc = $script:now.AddSeconds(-10).ToString('o'); $r.episodeDeadlineUtc = $script:now.AddSeconds(110).ToString('o')
                $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
                $r.stableObservations = 2; $r.lastStableUtc = $script:now.AddSeconds(-2).ToString('o')
                $script:readIndex = -1
                if ($drift) {
                    $base = New-Capture; $changed = New-Capture '192.168.9.12' '192.168.9.0/24'
                    $script:captures = @($base, $base, $changed, $changed)
                }
                switch ($case) {
                    'missing' { $r.PSObject.Properties.Remove('diagnostics') }
                    'null' { $r.diagnostics = $null }
                    'scalar' { $r.diagnostics = 'SECRET malformed evidence' }
                    'missing-fields' { $r.diagnostics = [pscustomobject]@{} }
                    default {
                        $r.diagnostics.preflightElapsedMs = switch ($case) { 'nonnumeric' { 'SECRET' }; 'boolean' { $true }; 'negative' { -1 }; 'oversized' { 86400001 }; 'nan' { [double]::NaN } }
                        $r.diagnostics.lastFingerprint = [pscustomobject]@{ secret = 'SECRET' }
                    }
                }
                $hard = $r.hardDeadlineUtc; $deadline = $r.episodeDeadlineUtc
                Set-FixtureVerifiedRules
                $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
                Assert-Equal $p.continue $true "Malformed $case evidence stopped reconnect."
                Assert-Equal $p.outcome.operation $(if ($drift) { 'quarantine' } else { 'connect' }) "Malformed $case evidence changed action."
                Assert-Equal $script:effects $(if ($drift) { @('disconnect') } else { @('connect') }) "Malformed $case evidence changed provider effects."
                Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $deadline 'Malformed diagnostics extended existing episode.'
                Assert-Equal $script:state.networkRecovery.hardDeadlineUtc $hard 'Malformed diagnostics extended hard deadline.'
            }
        }
    }
    Check 'ACL installation timing excludes slow identity preflight and final adapter readback' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $observation = Get-RunnerNetworkObservation; $r = $script:state.networkRecovery
        $r.phase = 'isolated'; $r.episodeStartedUtc = $script:now.ToString('o'); $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o')
        $r.candidateFingerprint = $observation.fingerprint; $r.candidateRules = $observation.rules; $r.stableObservations = 2; $r.lastStableUtc = $script:now.AddSeconds(-2).ToString('o')
        $script:fail = 'timing-stages'
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        $r = $script:state.networkRecovery
        Assert-Equal $p.outcome.operation 'apply' 'Timing fixture failed to reach ACL installation.'
        Assert-Equal $script:vmQueries 3 'Timing fixture did not exercise both preflights and final readback.'
        Assert-Equal $r.diagnostics.preflightElapsedMs 5000 'Longest preflight timing was lost.'
        Assert-Equal $r.diagnostics.applyElapsedMs ($script:addCount * 100) 'Apply timing included identity preflight or final adapter readback.'
        Assert-Equal ($script:clock - $script:now).TotalMilliseconds (13000 + $script:addCount * 100) 'Timing fixture did not separate stages.'
        Assert-Equal $r.episodeDeadlineUtc $script:now.AddSeconds(120).ToString('o') 'Stage timing changed episode deadline.'
        Assert-Equal $r.diagnostics.applyCount 1 'Stage timing duplicated the apply intent.'
        if ($script:effects -contains 'connect' -or $script:effects -contains 'resume' -or $script:effects -contains 'cleanup') { throw 'Stage timing changed provider actions.' }
    }
    Check 'long synchronous apply records elapsed duration and original operation before unchanged deadline cleanup' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $observation = Get-RunnerNetworkObservation; $r = $script:state.networkRecovery
        $r.phase = 'isolated'; $r.episodeStartedUtc = $script:now.ToString('o'); $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o')
        $r.candidateFingerprint = $observation.fingerprint; $r.candidateRules = $observation.rules; $r.stableObservations = 2; $r.lastStableUtc = $script:now.AddSeconds(-2).ToString('o')
        $script:fail = 'slow-apply'; $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Expired completed apply exposed a successful outcome.'
        $r = $script:lastCleanupState.networkRecovery
        Assert-Equal $r.diagnostics.applyCount 1 'Apply intent was not counted.'
        Assert-Equal $r.diagnostics.applyElapsedMs ($script:addCount * 6000) 'Apply timing lost synchronous work.'
        Assert-Equal $r.episodeDeadlineUtc $script:now.AddSeconds(120).ToString('o') 'Slow apply extended deadline.'
        if ($script:clock -le $script:now.AddSeconds(120)) { throw 'Long apply fixture did not cross outage deadline.' }
        $data = New-RunnerRecoveryDiagnostic $script:lastCleanupState.networkRecovery $script:clock
        Assert-Equal $data.operation 'apply' 'Cleanup erased initiating operation.'
        Assert-Equal $data.refusal 'outage-deadline' 'Cleanup lost exact expiry refusal.'
        Assert-Equal $data.operationAgeMs ($script:addCount * 6000) 'Cleanup erased operation age.'
        Assert-Equal $data.episodeRemainingMs (120000 - $script:addCount * 6000) 'Episode remaining time was not signed.'
        Assert-Equal $script:cleanups 1 'Long apply changed cleanup behavior.'
        if ($script:effects -contains 'connect' -or $script:effects -contains 'resume') { throw 'Long apply resumed despite expiry.' }
    }
    Check 'final deny capacity includes defaults after actual group deduplication' {
        foreach ($total in @(4095, 4096, 4097, 4098)) {
            New-Fixture; $capture = New-Capture
            $routeCount = $total - 13 # Two defaults + nine private + one host + IPv6.
            $unique = @([pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = '10.0.0.0/8'; NextHop = '192.168.4.1'; InterfaceIndex = 3 }) +
                @(0..($routeCount - 2) | ForEach-Object { [pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = "10.12.$([Math]::Floor($_ / 256)).$($_ % 256)/32"; NextHop = '192.168.4.1'; InterfaceIndex = 3 } })
            # Deduplicate host/route groups only; overlap with the private tier
            # still creates its own rule and consumes capacity.
            $capture.addresses += $capture.addresses[0]
            $capture.addresses += [pscustomobject]@{ AddressFamily = 'IPv6'; IPAddress = '::1'; PrefixLength = 128; InterfaceIndex = 3 }
            $capture.routes = @($capture.routes[0]) + $unique + @($unique[0], $unique[-1], $capture.routes[0]) +
                @([pscustomobject]@{ AddressFamily = 'IPv6'; DestinationPrefix = '::/0'; NextHop = '::'; InterfaceIndex = 3 })
            if ($total -le 4096) {
                $rules = @(New-RunnerNetworkPolicy $capture)
                Assert-Equal @($rules | Where-Object Action -CEQ 'Deny').Count $total 'Final deny count omitted defaults or changed group deduplication.'
                Assert-Equal @($rules | Where-Object Action -CEQ 'Allow').Count 8 'Deny limit changed the allow scope.'
                Assert-Equal @($rules | Where-Object { $_.Action -ceq 'Deny' -and $_.Weight -in @(1, 2) }).Count 2 'Default denies lost.'
                Assert-Equal @($rules | Where-Object { $_.PSObject.Properties.Name -contains 'RemoteIPAddress' -and $_.RemoteIPAddress -ceq '10.0.0.0/8' }).Count 2 'Cross-tier denies were silently deduplicated.'
            } else {
                $reason = ''; try { New-RunnerNetworkPolicy $capture | Out-Null } catch { $reason = $_.Exception.Message }
                if ($reason -cne 'Network policy exceeds the existing deny capacity.') { throw "Final $total deny rules were admitted or refused for an unrelated reason." }
                $script:captures = @($capture); $script:readIndex = -1
                $reason = ''; try { Get-RunnerNetworkObservation | Out-Null } catch { $reason = $_.Exception.Message }
                if ($reason -cne 'Network policy exceeds the existing deny capacity.') { throw 'Oversized coherent observation was not refused by actual policy capacity.' }
            }
            if ($script:effects.Count -ne 0 -or $script:addCount -ne 0 -or $script:removeCount -ne 0) { throw 'Policy derivation touched provider ACLs.' }
        }
    }
    Check 'one coherent capture supplies fingerprint and policy' {
        New-Fixture; $actual = Get-RunnerNetworkObservation
        Assert-Equal @($actual.rules | Where-Object { $_.PSObject.Properties.Name -contains 'RemoteIPAddress' -and $_.RemoteIPAddress -ceq '192.168.4.12/32' }).Count 1 'Captured host IP was not denied.'
        Assert-Equal @($actual.rules | Where-Object { $_.PSObject.Properties.Name -contains 'RemoteIPAddress' -and $_.RemoteIPAddress -ceq '192.168.4.0/24' }).Count 1 'Captured route was not denied.'
        $first = $actual.fingerprint
        $script:captures = @(New-Capture '192.168.5.12' '192.168.5.0/24'); $script:readIndex = -1
        if ((Get-RunnerNetworkObservation).fingerprint -ceq $first) { throw 'Fingerprint missed address/route drift.' }
    }
    Check 'capture enumeration order preserves fingerprint and ACL weights' {
        New-Fixture
        $script:captures[0].addresses += [pscustomobject]@{ AddressFamily = 'IPv4'; IPAddress = '203.0.113.2'; PrefixLength = 24; InterfaceIndex = 4 }
        $script:captures[0].routes += [pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = '0.0.0.0/1'; NextHop = '10.0.0.1'; InterfaceIndex = 4 }
        $first = Get-RunnerNetworkObservation
        [Array]::Reverse($script:captures[0].addresses); [Array]::Reverse($script:captures[0].routes)
        $second = Get-RunnerNetworkObservation
        Assert-Equal $second.fingerprint $first.fingerprint 'Enumeration order changed fingerprint.'
        Assert-Equal @($second.rules | ForEach-Object { Get-RunnerRecoveryRuleKey $_ }) @($first.rules | ForEach-Object { Get-RunnerRecoveryRuleKey $_ }) 'Enumeration order changed rule priority/identity.'
    }
    Check 'changing address/route sweeps are rejected' { New-Fixture; $script:captures = @((New-Capture), (New-Capture '192.168.5.12')); Assert-Refused { Get-RunnerNetworkObservation } 'Mixed snapshots accepted.' }
    Check 'deny tiers and exact allowed ports/DNS retained' {
        New-Fixture; $capture = New-Capture; $capture.routes += [pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = '0.0.0.0/1'; NextHop = '192.168.4.1'; InterfaceIndex = 3 }
        $rules = @(New-RunnerNetworkPolicy $capture)
        Assert-Equal @($rules | Where-Object { $_.Action -ceq 'Allow' }).Count 8 'Allow scope changed.'
        Assert-Equal @($rules | Where-Object { $_.PSObject.Properties.Name -contains 'RemoteIPAddress' -and $_.RemoteIPAddress -ceq '::/0' }).Count 1 'IPv6 deny lost.'
        Assert-Equal @($rules | Where-Object { $_.PSObject.Properties.Name -contains 'RemoteIPAddress' -and $_.RemoteIPAddress -ceq '0.0.0.0/1' }).Count 1 'Split-default deny lost.'
        Assert-Equal @($rules.Weight | Sort-Object -Unique).Count $rules.Count 'Rule priority collided.'
    }
    Check 'paired split default only removes transport denies and preserves exact allow scope' {
        New-Fixture; $capture=New-SplitCapture
        $capture.routes += [pscustomobject]@{AddressFamily='IPv4';DestinationPrefix='203.0.113.0/24';NextHop='0.0.0.0';InterfaceIndex=3;RouteMetric=0}
        $rules=@(New-RunnerNetworkPolicy $capture)
        $ordinary=Copy-Fixture $capture; $ordinary.routes=@($ordinary.routes | Where-Object DestinationPrefix -notin @('0.0.0.0/1','128.0.0.0/1'))
        Assert-Equal @($rules | ForEach-Object {Get-RunnerRecoveryRuleKey $_}) @((New-RunnerNetworkPolicy $ordinary) | ForEach-Object {Get-RunnerRecoveryRuleKey $_}) 'Pair changed any non-transport rule or weight.'
        Assert-Equal @($rules | Where-Object Action -eq Allow).Count 8 'Pair expanded allowed endpoints or ports.'
        foreach($hop in @('0.0.0.0','192.168.4.1')) {
            foreach($metric in @([uint16]0,[uint16]65535)) {
                $valid=New-SplitCapture
                foreach($route in $valid.routes[-2..-1]) {$route.NextHop=$hop;$route.RouteMetric=$metric;$route.InterfaceIndex=[uint32]3}
                if(-not (Test-RunnerSplitDefaultTransport $valid)){throw 'Valid native-typed pair refused.'}
            }
        }
    }
    Check 'single ambiguous malformed or unmatched split defaults stay denied' {
        New-Fixture
        foreach ($case in @('single','duplicate','different-interface','different-hop','different-metric','missing-metric','string-metric','negative-metric','large-metric','array-metric','missing-index','zero-index','string-index','large-index','missing-hop','noncanonical-hop','ipv6-hop','missing-host-interface','host-string-index','ipv6-host')) {
            $capture=New-SplitCapture
            switch ($case) {
                single {$capture.routes=@($capture.routes | Where-Object DestinationPrefix -ne '128.0.0.0/1')}
                duplicate {$capture.routes+=Copy-Fixture $capture.routes[-1]}
                different-interface {$capture.routes[-1].InterfaceIndex=4}
                different-hop {$capture.routes[-1].NextHop='192.168.4.1'}
                different-metric {$capture.routes[-1].RouteMetric=1}
                missing-metric {$capture.routes[-1].PSObject.Properties.Remove('RouteMetric')}
                string-metric {$capture.routes[-1].RouteMetric='0'}
                negative-metric {$capture.routes[-1].RouteMetric=-1}
                large-metric {$capture.routes[-1].RouteMetric=65536}
                array-metric {$capture.routes[-1].RouteMetric=@(0)}
                missing-index {$capture.routes[-1].PSObject.Properties.Remove('InterfaceIndex')}
                zero-index {$capture.routes[-1].InterfaceIndex=0}
                string-index {$capture.routes[-1].InterfaceIndex='3'}
                large-index {$capture.routes[-1].InterfaceIndex=[long]4294967296}
                missing-hop {$capture.routes[-1].PSObject.Properties.Remove('NextHop')}
                noncanonical-hop {$capture.routes[-1].NextHop='127.1'}
                ipv6-hop {$capture.routes[-1].NextHop='::1'}
                missing-host-interface {$capture.addresses[0].InterfaceIndex=4}
                host-string-index {$capture.addresses[0].InterfaceIndex='3'}
                ipv6-host {$capture.addresses[0].AddressFamily='IPv6';$capture.addresses+=[pscustomobject]@{AddressFamily='IPv4';IPAddress='192.168.5.2';InterfaceIndex=4}}
            }
            $rules=@(New-RunnerNetworkPolicy $capture)
            Assert-Equal @($rules | Where-Object { $_.PSObject.Properties.Name -contains 'RemoteIPAddress' -and $_.RemoteIPAddress -ceq '0.0.0.0/1' }).Count 1 ('Unsafe pair exemption: '+$case)
        }
    }
    Check 'metric and duplicate pair drift change the coherent fingerprint and quarantine' {
        New-Fixture; $script:captures=@(New-SplitCapture);$script:readIndex=-1
        $first=Get-RunnerNetworkObservation
        foreach($case in @('metric','duplicate','metric-type','host-index-type')) {
            $changed=New-SplitCapture
            switch($case) { metric {$changed.routes[-1].RouteMetric=1}; duplicate {$changed.routes+=Copy-Fixture $changed.routes[-1]}; metric-type {$changed.routes[-1].RouteMetric='0'}; host-index-type {$changed.addresses[0].InterfaceIndex='3'} }
            $script:captures=@($changed);$script:readIndex=-1
            $next=Get-RunnerNetworkObservation
            if($first.fingerprint -ceq $next.fingerprint){throw ('Pair drift hidden: '+$case)}
            $script:recovery.fingerprint=$first.fingerprint
            Assert-Equal (Plan 0 $next).action 'quarantine' 'Pair drift bypassed recovery.'
            $script:captures=@((New-SplitCapture),$changed);$script:readIndex=-1
            Assert-Refused {Get-RunnerNetworkObservation} 'Mixed pair snapshots accepted.'
        }
    }
    Check 'paired split default enumeration is deterministic' {
        New-Fixture; $script:captures=@(New-SplitCapture);$script:readIndex=-1
        $first=Get-RunnerNetworkObservation
        [Array]::Reverse($script:captures[0].routes)
        $next=Get-RunnerNetworkObservation
        Assert-Equal $first.fingerprint $next.fingerprint 'Pair enumeration changed fingerprint.'
        Assert-Equal @($first.rules | ForEach-Object {Get-RunnerRecoveryRuleKey $_}) @($next.rules | ForEach-Object {Get-RunnerRecoveryRuleKey $_}) 'Pair enumeration changed rules.'
    }
    Check 'malformed or oversized captured policy is refused' {
        New-Fixture; Assert-Refused { New-RunnerNetworkPolicy (New-Capture '999.1.1.1') } 'Invalid IP accepted.'
        Assert-Refused { New-RunnerNetworkPolicy (New-Capture '192.168.4.12' '1.2.3.4/33') } 'Invalid prefix accepted.'
        $capture = New-Capture; $capture.routes = @(1..4100 | ForEach-Object { [pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = "10.$([Math]::Floor($_ / 256)).$($_ % 256).0/24" } })
        Assert-Refused { New-RunnerNetworkPolicy $capture } 'Capacity accepted.'
    }
    Check 'stable healthy tick does not quarantine' { New-Fixture; Assert-Equal (Plan 0 ([pscustomobject]@{ fingerprint = ('a' * 64); rules = @() })).action 'none' 'Stable network mutated.' }
    Check 'drift and inspection failure request quarantine' { New-Fixture; Assert-Equal (Plan).action 'quarantine' 'Drift uncontained.'; Assert-Equal (Plan 0 $null).action 'quarantine' 'Inspection failure uncontained.' }
    Check 'Off stays Off and no recovery is an implicit boot' { New-Fixture; $p = Plan 0 $script:observation $null 'Off'; Assert-Equal $p.recovery.resumeRequired $false 'Off would resume.'; Assert-Equal $p.action 'quarantine' 'Off isolation skipped.' }
    Check 'three spaced observations precede policy installation' { New-Fixture; Isolate; $script:recovery = (Plan 2).recovery; $script:recovery = (Plan 2).recovery; Assert-Equal $script:recovery.stableObservations 1 'Same-instant tick counted twice.'; $script:recovery = (Plan 3).recovery; Assert-Equal (Plan 4).action 'apply' 'Stable policy not staged.' }
    Check 'flapping and failed observation do not extend outage deadline' {
        New-Fixture; Isolate; $deadline = $script:recovery.episodeDeadlineUtc
        foreach ($i in 2..8) { $obs = [pscustomobject]@{ fingerprint = $(if ($i % 2) { 'c' * 64 } else { 'b' * 64 }); rules = $script:observation.rules }; $script:recovery = (Plan $i $obs).recovery }
        $script:recovery = (Plan 9 $null).recovery
        Assert-Equal $script:recovery.episodeDeadlineUtc $deadline 'Flap extended outage.'; Assert-Equal $script:recovery.stableObservations 0 'Failed observation retained stability.'
    }
    Check 'outage uses unchanged earlier hard deadline' { New-Fixture; $script:recovery.hardDeadlineUtc = $script:now.AddSeconds(20).ToString('o'); Assert-Equal (Plan).recovery.episodeDeadlineUtc $script:now.AddSeconds(20).ToString('o') 'Hard deadline rebased.' }
    Check '120-second outage and guardian hang are cleanup eligible' { New-Fixture; Isolate; Assert-Equal (Plan 120).action 'cleanup' 'Outage deadline missed.'; Assert-Equal (Plan 31).recovery.failure 'guardian-progress-expired' 'Hung guardian missed.' }
    Check 'Stop owner death and identity changes preempt a stale result' {
        New-Fixture; Isolate
        foreach ($flag in @('Stop', 'OwnerDead', 'IdentityChanged')) {
            $args = @{}; $args[$flag] = $true
            $p = Get-RunnerNetworkRecoveryPlan $script:recovery $script:observation $script:now.AddSeconds(2) 'Paused' @args
            Assert-Equal $p.action 'cleanup' 'Control lost priority.'
        }
    }
    Check 'old generation completion cannot advance to resume' { New-Fixture; Isolate; $script:recovery.phase = 'connecting'; $script:recovery.operation = 'connect'; $outcome = [pscustomobject]@{ generation = $script:recovery.generation - 1; operation = 'connect'; success = $true }; Assert-Equal (Plan 2 $script:observation $outcome).action 'none' 'Old completion resumed.' }
    Check 'policy readback is followed by three fresh matching observations' { New-Fixture; Isolate; foreach ($i in 2..4) { $script:recovery = (Plan $i).recovery }; Complete 'apply' 5; Assert-Equal $script:recovery.phase 'verified' 'Apply skipped readback state.'; foreach ($i in 6..7) { $script:recovery = (Plan $i).recovery }; Assert-Equal (Plan 8).action 'connect' 'Fresh stability did not gate connect.' }
    Check 'connect drift requarantines without extending episode' { New-Fixture; Isolate; $deadline = $script:recovery.episodeDeadlineUtc; $script:recovery.candidateFingerprint = 'b' * 64; $script:recovery.operation = 'connect'; $script:recovery.phase = 'connecting'; $outcome = [pscustomobject]@{ generation = $script:recovery.generation; operation = 'connect'; success = $true }; $p = Plan 2 ([pscustomobject]@{ fingerprint = ('c' * 64); rules = @() }) $outcome; Assert-Equal $p.action 'quarantine' 'Connect flap resumed.'; Assert-Equal $p.recovery.episodeDeadlineUtc $deadline 'Connect flap extended episode.' }
    Check 'resume requires matching observation and postresume probe' { New-Fixture; Isolate; $script:recovery.candidateFingerprint = 'b' * 64; $script:recovery.operation = 'connect'; $script:recovery.phase = 'connecting'; Complete 'connect' 2; Assert-Equal $script:recovery.operation 'resume' 'Connected running session did not resume.'; Complete 'resume' 3; Assert-Equal $script:recovery.operation 'probe' 'Probe skipped.'; Complete 'probe' 4; Assert-Equal $script:recovery.phase 'healthy' 'Verified recovery did not finish.' }
    Check 'failed probe requarantines in same outage' { New-Fixture; Isolate; $deadline = $script:recovery.episodeDeadlineUtc; $script:recovery.candidateFingerprint = 'b' * 64; $script:recovery.operation = 'probe'; $script:recovery.phase = 'probing'; Complete 'probe' 2 $false; Assert-Equal $script:recovery.operation 'quarantine' 'Probe failure left VM exposed.'; Assert-Equal $script:recovery.episodeDeadlineUtc $deadline 'Probe failure reset deadline.' }
    Check 'partial or failed provider effects are terminal' { New-Fixture; Isolate; $script:recovery.operation = 'apply'; $script:recovery.phase = 'applying'; Complete 'apply' 2 $false; Assert-Equal $script:recovery.phase 'failed' 'Uncertain ACL outcome continued.' }
    Check 'exact owned VM pauses then disconnects before any ACL write' { New-Fixture; $script:state.networkRecovery = (Plan).recovery; Invoke-RunnerRecoveryAdapterEffect $script:state $script:state.networkRecovery 'quarantine'; Assert-Equal $script:effects @('pause', 'disconnect') 'Quarantine ordering changed.'; Assert-Equal $script:vm.State 'Paused' 'VM not paused.'; Assert-Equal $script:adapter.SwitchName '' 'Adapter not disconnected.' }
    Check 'Off quarantine does not pause or boot' { New-Fixture; $script:vm.State = 'Off'; $script:state.networkRecovery = (Plan 0 $script:observation $null 'Off').recovery; Invoke-RunnerRecoveryAdapterEffect $script:state $script:state.networkRecovery 'quarantine'; Assert-Equal $script:effects @('disconnect') 'Off state was changed.'; Assert-Equal $script:vm.State 'Off' 'Off was booted.' }
    Check 'generation race fences provider resume before dispatch' { New-Fixture; $old = Copy-Fixture $script:recovery; $old.operation = 'resume'; $script:state.networkRecovery.generation++; Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $old 'resume' } 'Stale effect accepted.'; Assert-Equal $script:effects @() 'Stale effect mutated provider.' }
    Check 'adapter MAC switch claim and process identity cannot be adopted' {
        foreach ($field in @('adapter', 'mac', 'switch', 'claim', 'process')) {
            New-Fixture
            switch ($field) { 'adapter' { $script:adapter.Id = 'replacement' }; 'mac' { $script:adapter.MacAddress = '02FFFFFFFFFF' }; 'switch' { $script:switch.Id = [guid]::NewGuid() }; 'claim' { $script:state.supervisorStartUtc = $script:now.AddSeconds(5).ToString('o') }; 'process' { $script:alive = $false } }
            Assert-Refused { Assert-RunnerNetworkBinding $script:state $script:binding $script:vm @($script:adapter) $script:switch } 'Identity was adopted.'
        }
    }
    Check 'fresh zero-ACL Off adapter skips removal and installs exact policy' {
        New-Fixture; $script:vm.State = 'Off'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'applying'; $r.operation = 'apply'; $r.candidateRules = $script:observation.rules
        $installed = @(Invoke-RunnerRecoveryAdapterEffect $script:state $r 'apply')
        Assert-Equal $script:removeCount 0 'Fresh adapter dispatched unnecessary Remove.'
        Assert-Equal $installed.Count $script:observation.rules.Count 'Fresh adapter did not install exact rules.'
        Assert-Equal $script:vm.State 'Off' 'Initial policy application booted the VM.'
        Assert-Equal $script:aclQueries 3 'Policy replacement skipped pre-query, empty check or final readback.'
    }
    Check 'populated paused adapter removes each exact queried rule before replacement' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        Set-FixtureVerifiedRules; $previousCount = $script:rules.Count
        $r = $script:state.networkRecovery; $r.phase = 'applying'; $r.operation = 'apply'; $r.candidateRules = $script:observation.rules
        [void](Invoke-RunnerRecoveryAdapterEffect $script:state $r 'apply')
        Assert-Equal $script:removeCount $previousCount 'Replacement did not remove each exact old object.'
        Assert-Equal @($script:effects | Select-Object -First $previousCount) @((1..$previousCount) | ForEach-Object { 'remove-acl' }) 'Addition preceded old-policy removal.'
        Assert-Equal $script:aclQueries 3 'Old policy removal was not requeried before Add.'
    }
    Check 'ACL query removal error and surviving stale rules cannot add reconnect or resume' {
        foreach ($failure in @('acl-query', 'remove-acl', 'stale-acl')) {
            New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            Set-FixtureVerifiedRules
            $r = $script:state.networkRecovery; $r.phase = 'applying'; $r.operation = 'apply'; $r.candidateRules = $script:observation.rules
            $script:fail = $failure
            Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $r 'apply' } 'Uncertain old-policy removal accepted.'
            Assert-Equal $script:addCount 0 'Uncertain old-policy removal added replacement rules.'
            Assert-Equal $script:adapter.SwitchName '' 'Uncertain old-policy removal reconnected.'
            Assert-Equal $script:vm.State 'Paused' 'Uncertain old-policy removal resumed.'
        }
    }
    Check 'guardian fails closed and cleans up after uncertain ACL removal' {
        foreach ($failure in @('remove-acl', 'stale-acl')) {
            New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            Set-FixtureVerifiedRules
            $observation = Get-RunnerNetworkObservation
            $r = $script:state.networkRecovery; $r.phase = 'isolated'; $r.resumeRequired = $true
            $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o'); $r.candidateFingerprint = $observation.fingerprint; $r.candidateRules = $observation.rules
            $r.stableObservations = 2; $r.lastStableUtc = $script:now.AddSeconds(-2).ToString('o')
            $script:fail = $failure
            $result = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            Assert-Equal $result.continue $false 'Uncertain removal remained recoverable.'
            Assert-Equal $script:cleanups 1 'Uncertain removal did not request exact owned cleanup.'
            Assert-Equal $script:addCount 0 'Guardian added replacement after uncertain removal.'
            if ($script:effects -contains 'connect' -or $script:effects -contains 'resume') { throw 'Guardian resumed after uncertain removal.' }
        }
    }
    Check 'partial ACL installation never connects or resumes' { New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty; $script:state.networkRecovery.operation = 'apply'; $script:state.networkRecovery.phase = 'applying'; $script:state.networkRecovery.candidateRules = $script:observation.rules; $script:fail = 'partial-acl'; Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $script:state.networkRecovery 'apply' } 'Partial ACL accepted.'; Assert-Equal $script:addCount 3 'Partial ACL fixture did not reach failed Add.'; Assert-Equal $script:adapter.SwitchName '' 'Partial ACL reconnected.'; if ($script:effects -contains 'resume') { throw 'Partial ACL resumed.' } }
    Check 'successful exact readback connects before resuming the same VM' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'applying'; $r.operation = 'apply'; $r.candidateRules = $script:observation.rules; $r.resumeRequired = $true
        $r.verifiedRules = @(Invoke-RunnerRecoveryAdapterEffect $script:state $r 'apply')
        Assert-Equal $r.verifiedRules.Count $script:observation.rules.Count 'Rule installation lost a denial/allow.'
        $r.phase = 'connecting'; $r.operation = 'connect'; Invoke-RunnerRecoveryAdapterEffect $script:state $r 'connect'
        $r.phase = 'resuming'; $r.operation = 'resume'; Invoke-RunnerRecoveryAdapterEffect $script:state $r 'resume'
        Assert-Equal $script:vm.State 'Running' 'Exact VM did not resume.'
        Assert-Equal @($script:effects | Select-Object -Last 2) @('connect', 'resume') 'Resume preceded verified connection.'
    }
    Check 'missing ACL readback blocks reconnect while remaining isolated' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        Set-FixtureVerifiedRules; $script:state.networkRecovery.phase = 'connecting'; $script:state.networkRecovery.operation = 'connect'; $script:fail = 'readback'
        Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $script:state.networkRecovery 'connect' } 'Missing ACL readback accepted.'
        Assert-Equal $script:effects @() 'Failed ACL readback connected.'
    }
    Check 'Stop marker wins before synchronous provider dispatch' {
        New-Fixture; $old = Copy-Fixture $script:recovery; $old.phase = 'resuming'; $old.operation = 'resume'; $old.resumeRequired = $true; $script:state.networkRecovery = $old
        $marker = Join-Path $root 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        try { Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $old 'resume' } 'Stop race dispatched resume.'; Assert-Equal $script:effects @() 'Stop race mutated provider.' }
        finally { Remove-Item -LiteralPath $marker }
    }
    Check 'root pickup suspension cancels job and missing-purpose sessions' {
        New-Fixture; $marker = Join-Path $root 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        try {
            Assert-Equal (Test-RunnerSessionStopRequested $script:state) $true 'Job ignored root Stop.'
            $script:state.PSObject.Properties.Remove('purpose')
            Assert-Equal (Test-RunnerSessionStopRequested $script:state) $true 'Legacy job ignored root Stop.'
            $script:state | Add-Member purpose 'invalid'
            Assert-Refused { Test-RunnerSessionStopRequested $script:state } 'Invalid purpose escaped Stop.'
        } finally { Remove-Item -LiteralPath $marker }
    }
    Check 'protected builder survives pickup suspension but instance cancellation wins' {
        New-Fixture; $script:state.purpose = 'prepare'; $script:state.PSObject.Properties.Remove('claimMode')
        $marker = Join-Path $root 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        [void][IO.Directory]::CreateDirectory($script:state.instancePath)
        $cancel = Join-Path $script:state.instancePath 'stop.requested'
        try {
            Assert-Equal (Test-RunnerSessionStopRequested $script:state) $false 'Builder treated pickup suspension as cancellation.'
            [IO.File]::WriteAllText($cancel, '')
            Assert-Equal (Test-RunnerSessionStopRequested $script:state) $true 'Builder ignored instance cancellation.'
        } finally { if (Test-Path -LiteralPath $cancel) { Remove-Item -LiteralPath $cancel }; Remove-Item -LiteralPath $marker }
    }
    Check 'protected verifier requires exact candidate before suspension exemption' {
        New-Fixture; $script:state.purpose = 'verify-image'; $script:state.PSObject.Properties.Remove('claimMode')
        $script:state | Add-Member imageCandidate ([pscustomobject]@{ id = ('a' * 32); diskHash = ('A' * 64); bindingHash = ('B' * 64); recipeId = ('C' * 64) })
        $marker = Join-Path $root 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        try {
            Assert-Equal (Test-RunnerSessionStopRequested $script:state) $false 'Verifier treated pickup suspension as cancellation.'
            $script:state.imageCandidate.diskHash = 'invalid'
            Assert-Refused { Test-RunnerSessionStopRequested $script:state } 'Invalid verifier candidate escaped Stop.'
        } finally { Remove-Item -LiteralPath $marker }
    }
    Check 'forged preparation job claims refuse suspension exemption' {
        New-Fixture; $script:state.purpose = 'prepare'
        $marker = Join-Path $root 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        try {
            Assert-Refused { Test-RunnerSessionStopRequested $script:state } 'Preparation with active job claim escaped Stop.'
            $script:state.PSObject.Properties.Remove('claimMode'); $script:state | Add-Member pilotClaim ([pscustomobject]@{})
            Assert-Refused { Test-RunnerSessionStopRequested $script:state } 'Preparation with pilot claim escaped Stop.'
        } finally { Remove-Item -LiteralPath $marker }
    }
    Check 'owner removal prevents stale preparation exemption and subsequent resume' {
        New-Fixture; $script:state.purpose = 'prepare'; $script:state.PSObject.Properties.Remove('claimMode')
        $old = Copy-Fixture $script:state; $old.networkRecovery.operation = 'resume'; $old.networkRecovery.resumeRequired = $true
        $marker = Join-Path $root 'stop.requested'; [IO.File]::WriteAllText($marker, '')
        try {
            $script:state = $null
            Assert-Equal (Test-RunnerSessionStopRequested $old) $true 'Stale preparation retained suspension exemption after removal.'
            Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $old $old.networkRecovery 'resume' } 'Removed preparation resumed.'
            Assert-Equal $script:effects @() 'Removed preparation mutated provider.'
        } finally { Remove-Item -LiteralPath $marker }
    }
    Check 'recovery of an Off VM completes without resume or guest probe' {
        New-Fixture; $script:recovery = (Plan 0 $script:observation $null 'Off').recovery; Complete 'quarantine' 1
        $script:recovery.candidateFingerprint = 'b' * 64; $script:recovery.phase = 'connecting'; $script:recovery.operation = 'connect'; Complete 'connect' 2
        Assert-Equal $script:recovery.phase 'healthy' 'Off recovery failed to settle.'; Assert-Equal $script:recovery.operation '' 'Off recovery started guest work.'
    }
    Check 'VM replacement and additional adapters are refused' {
        New-Fixture; $script:vm.Id = [guid]::NewGuid()
        Assert-Refused { Assert-RunnerNetworkBinding $script:state $script:binding $script:vm @($script:adapter) $script:switch } 'Replacement VM adopted.'
        New-Fixture; Assert-Refused { Assert-RunnerNetworkBinding $script:state $script:binding $script:vm @($script:adapter, $script:adapter) $script:switch } 'Additional adapter adopted.'
    }
    Check 'same switch GUID with changed type or invalid MAC is refused' {
        New-Fixture; $script:switch.SwitchType = 'External'
        Assert-Refused { Assert-RunnerNetworkBinding $script:state $script:binding $script:vm @($script:adapter) $script:switch } 'Changed switch type adopted.'
        New-Fixture; $script:state.guestMac = '000000000000'; $script:adapter.MacAddress = $script:state.guestMac
        Assert-Refused { New-RunnerNetworkBinding $script:state $script:vm $script:adapter $script:switch } 'Invalid MAC admitted.'
    }
    Check 'resume provider error is explicit and cannot fake running readback' { New-Fixture; $script:vm.State = 'Paused'; $script:state.networkRecovery.operation = 'resume'; $script:state.networkRecovery.resumeRequired = $true; Set-FixtureVerifiedRules; $script:fail = 'resume'; Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $script:state.networkRecovery 'resume' } 'Resume error accepted.'; Assert-Equal $script:effects @('resume') 'Resume error path not reached.'; Assert-Equal $script:vm.State 'Paused' 'Resume error guessed running.' }
    Check 'delay after capture rejects stale observation and publishes actual containment completion' {
        New-Fixture
        $script:state.networkRecovery.fingerprint = (Get-RunnerNetworkObservation).fingerprint
        $script:afterObservation = {
            Assert-Equal $script:locked $false 'Slow observation held state mutex.'
            $script:clock = $script:clock.AddSeconds(26)
        }
        $script:afterDisconnect = { $script:clock = $script:clock.AddMilliseconds(6661) }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.outcome.operation 'quarantine' 'Stale preflight authorized connection or stayed healthy.'
        Assert-Equal $script:effects @('pause', 'disconnect') 'Stale preflight escaped containment.'
        Assert-Equal $script:state.networkRecovery.progressUtc $script:clock.ToString('o') 'Completed containment published an old clock.'
        Assert-Equal $script:state.networkRecovery.episodeStartedUtc $script:now.AddSeconds(26).ToString('o') 'Reducer reused pre-preflight time.'
        Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $script:now.AddSeconds(146).ToString('o') 'Episode did not retain decision-time 120s bound.'
        $script:afterObservation = $null; $script:afterDisconnect = $null
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) $p.outcome
        Assert-Equal $p.continue $true 'Genuine completed progress was falsely expired.'
    }
    Check 'Stop hard deadline progress expiry owner VM session and generation changes during preflight cannot publish success' {
        foreach ($change in @('stop', 'hard', 'progress', 'owner', 'vm', 'session', 'generation', 'guardian')) {
            New-Fixture; $script:change = $change
            $stopPath = Join-Path $script:state.instancePath 'stop.requested'
            [void][IO.Directory]::CreateDirectory($script:state.instancePath)
            $script:afterPreflightRead = {
                switch ($script:change) {
                    'stop' { [IO.File]::WriteAllText($stopPath, '') }
                    'hard' { $script:clock = $script:clock.AddMinutes(11) }
                    'progress' { $script:clock = $script:clock.AddSeconds(31) }
                    'owner' { $script:alive = $false }
                    'vm' { $script:vm.Id = [guid]'00000000-0000-0000-0000-000000000003' }
                    'session' { $script:state.vmName = 'ITIR-' + ('b' * 32) }
                    'generation' { $script:state.networkRecovery.generation++ }
                    'guardian' { $script:state.guardianStartUtc = $script:clock.AddSeconds(1).ToString('o') }
                }
            }
            $result = $null; $failure = $null; $name = $script:state.vmName
            try { $result = Invoke-RunnerNetworkRecoveryTick $name ([pscustomobject]@{}) } catch { $failure = $_ }
            finally { if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath } }
            if ($null -eq $failure -and ($null -eq $result -or $result.continue)) { throw "Preflight accepted $change." }
            if (@($script:effects | Where-Object { $_ -cne 'cleanup' }).Count -ne 0) { throw "Preflight mutation after $change." }
        }
    }
    Check 'failed read-only preflight carries only bounded fixed stage diagnostics' {
        New-Fixture; $script:afterPreflightRead = { throw 'SECRET provider command output' }
        $failure = $null; try { Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) } catch { $failure = $_ }
        if ($null -eq $failure) { throw 'Uncertain preflight accepted.' }
        $record = New-RunnerSessionFailureRecord $failure 'guardian'
        Assert-Equal $record.controlDiagnostic.preflightStage 'vm' 'Preflight stage was not retained.'
        if (($record | ConvertTo-Json -Depth 6 -Compress) -cmatch 'SECRET|command output') { throw 'Preflight diagnostic leaked provider details.' }
        Assert-Equal $script:effects @() 'Uncertain preflight mutated provider.'
    }
    Check 'late containment completion cannot revive expired progress or expose a successful outcome' {
        New-Fixture
        $originalProgress = $script:state.networkRecovery.progressUtc
        $script:afterDisconnect = { $script:clock = $script:clock.AddSeconds(31) }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Late containment completion reported liveness.'
        Assert-Equal $p.outcome $null 'Expired containment returned success.'
        Assert-Equal $script:lastCleanupState.networkRecovery.progressUtc $originalProgress 'Expired containment fabricated progress.'
        Assert-Equal $script:lastCleanupState.networkRecovery.failure 'guardian-progress-expired' 'Late containment lost expiry reason.'
        Assert-Equal $script:effects @('pause', 'disconnect', 'cleanup') 'Late containment changed cleanup or isolation.'
    }
    Check 'guardian tick observes outside mutex then quarantines exact provider' { New-Fixture; $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}); Assert-Equal $p.outcome.operation 'quarantine' 'Tick did not quarantine.'; Assert-Equal $script:locked $false 'Tick retained mutex.'; Assert-Equal $script:effects @('pause', 'disconnect') 'Tick mutated beyond quarantine.' }
    Check 'unchanged host fingerprint cannot leave detached bound adapter healthy' {
        New-Fixture; $r = $script:state.networkRecovery; $r.fingerprint = (Get-RunnerNetworkObservation).fingerprint
        $hard = $r.hardDeadlineUtc; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.outcome.operation 'quarantine' 'Detached adapter remained healthy.'
        Assert-Equal $script:effects @('pause', 'disconnect') 'Detached running VM was not quarantined.'
        Assert-Equal $script:state.networkRecovery.phase 'quarantining' 'Detached adapter retained healthy phase.'
        Assert-Equal $script:state.networkRecovery.hardDeadlineUtc $hard 'Detachment extended hard deadline.'
        Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $script:now.AddSeconds(120).ToString('o') 'Detachment lacked fixed outage episode.'
    }
    Check 'detachment rejects connecting resume and probe successful outcomes without extending episode' {
        foreach ($phase in @('connecting', 'resuming', 'probing')) {
            New-Fixture; $r = $script:state.networkRecovery; $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
            $r.phase = $phase; $r.operation = switch ($phase) { 'connecting' { 'connect' }; 'resuming' { 'resume' }; 'probing' { 'probe' } }
            $r.resumeRequired = $true; $r.episodeDeadlineUtc = $script:now.AddSeconds(45).ToString('o'); $r.episodeStartedUtc = $script:now.AddSeconds(-75).ToString('o')
            $deadline = $r.episodeDeadlineUtc; $hard = $r.hardDeadlineUtc
            $outcome = [pscustomobject]@{ generation = $r.generation; operation = $r.operation; success = $true }
            $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) $outcome
            Assert-Equal $p.outcome.operation 'quarantine' "Detached $phase accepted success."
            Assert-Equal $script:state.networkRecovery.phase 'quarantining' "Detached $phase became healthy or advanced."
            Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $deadline 'Detachment restarted outage deadline.'
            Assert-Equal $script:state.networkRecovery.hardDeadlineUtc $hard 'Detachment extended hard deadline.'
            Assert-Equal $script:effects @('pause', 'disconnect') 'Detachment dispatched resume/probe.'
        }
    }
    Check 'detached bound adapter completes guarded recovery while preserving running or Off intent' {
        foreach ($initialState in @('Running', 'Off')) {
            New-Fixture; $script:vm.State = $initialState; $script:state.networkRecovery.fingerprint = (Get-RunnerNetworkObservation).fingerprint
            $hard = $script:state.networkRecovery.hardDeadlineUtc; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            $config = [pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName $config
            $deadline = $script:state.networkRecovery.episodeDeadlineUtc
            for ($tick = 0; $tick -lt 16 -and $script:state.networkRecovery.phase -cne 'healthy'; $tick++) {
                if ($null -ne $script:RunnerRecoveryProbe) {
                    [void][IO.Directory]::CreateDirectory($script:state.instancePath)
                    $probe = $script:RunnerRecoveryProbe; $probe.job.Completed = $true
                    [IO.File]::WriteAllText($probe.resultPath, ([ordered]@{ generation = $probe.generation; probeId = $probe.probeId; success = $true } | ConvertTo-Json -Compress))
                }
                $script:clock = $script:clock.AddSeconds(1)
                $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName $config $p.outcome
                Assert-Equal $script:state.networkRecovery.hardDeadlineUtc $hard 'Recovery extended hard deadline.'
                if ($script:state.networkRecovery.phase -cne 'healthy') { Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $deadline 'Recovery extended detachment episode.' }
            }
            Assert-Equal $script:state.networkRecovery.phase 'healthy' 'Detached adapter did not complete guarded recovery.'
            Assert-Equal $script:vm.State $initialState 'Recovery changed original Running/Off intent.'
            Assert-Equal $script:adapter.SwitchName $script:switch.Name 'Recovery did not reconnect exact bound switch.'
            Assert-Equal @($script:effects | Where-Object { $_ -ceq 'resume' }).Count $(if ($initialState -ceq 'Running') { 1 } else { 0 }) 'Recovery resumed an Off VM or repeated resume.'
        }
    }
    Check 'intended isolated apply verified and preconnect phases allow detached adapter' {
        foreach ($phase in @('isolated', 'applying', 'verified', 'connecting')) {
            New-Fixture; $r = $script:state.networkRecovery; $r.phase = $phase; $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
            $r.operation = switch ($phase) { 'applying' { 'apply' }; 'connecting' { 'connect' }; default { '' } }
            $r.episodeDeadlineUtc = $script:now.AddSeconds(60).ToString('o'); $script:vm.State = 'Paused'
            $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            Assert-Equal $p.continue $true "Intended detached $phase refused."
            Assert-Equal $script:state.networkRecovery.phase $phase "Intended detached $phase changed incorrectly."
            Assert-Equal $script:effects @() 'Intended isolation started another provider operation.'
        }
    }
    Check 'probe detachment obsoletes and drains pending probe after quarantine' {
        New-Fixture; $r = $script:state.networkRecovery; $r.phase = 'probing'; $r.operation = 'probe'; $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
        $r.episodeDeadlineUtc = $script:now.AddSeconds(45).ToString('o')
        $script:RunnerRecoveryProbe = Start-RunnerRecoveryProbe $script:state ([pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }) 0
        $script:effects = @(); $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}))
        Assert-Equal $script:effects @('pause', 'disconnect', 'probe-cancel', 'probe-remove') 'Detached probe continued or was not drained.'
        Assert-Equal $script:RunnerRecoveryProbe $null 'Detached probe retained lifetime owner.'
    }
    Check 'wrong attached switch still performs canonical cleanup' {
        New-Fixture; $script:adapter.SwitchName = 'Unowned'; $script:adapter.SwitchId = [guid]::NewGuid()
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Wrong switch was recovered as ordinary detachment.'
        Assert-Equal $script:effects @('cleanup') 'Wrong switch escaped canonical cleanup.'
    }
    Check 'probe dispatch is outside mutex and obsolete result is cancelled' {
        New-Fixture; Isolate; $script:state.networkRecovery = $script:recovery; $script:state.networkRecovery.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
        $script:state.networkRecovery.phase = 'resuming'; $script:state.networkRecovery.operation = 'resume'; $script:state.networkRecovery.progressUtc = $script:now.AddSeconds(-2).ToString('o')
        $outcome = [pscustomobject]@{ generation = $script:recovery.generation; operation = 'resume'; success = $true }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }) $outcome
        Assert-Equal $p.outcome $null 'Guardian waited for probe.'; Assert-Equal $script:effects @('probe-start') 'Probe changed provider.'
        $script:state.networkRecovery.generation++; Assert-Equal (Get-RunnerRecoveryProbeOutcome) $null 'Old probe completion accepted.'
        Assert-Equal $script:effects @('probe-start', 'probe-cancel', 'probe-remove') 'Old probe not cancelled.'
    }
    Check 'network drift during running probe immediately requarantines' {
        New-Fixture; Isolate; $script:recovery.operation = 'probe'; $script:recovery.phase = 'probing'; $script:recovery.candidateFingerprint = 'b' * 64
        $p = Plan 2 ([pscustomobject]@{ fingerprint = ('c' * 64); rules = @() }); Assert-Equal $p.action 'quarantine' 'Probe stopped network observations.'
        if ($p.recovery.generation -le $script:recovery.generation) { throw 'Probe generation not invalidated.' }
    }
    Check 'separate probe expires without guardian waiting' {
        New-Fixture; $script:state.networkRecovery.operation = 'probe'; $script:state.networkRecovery.phase = 'probing'
        $script:RunnerRecoveryProbe = Start-RunnerRecoveryProbe $script:state ([pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }) 0
        Assert-Equal (Get-RunnerRecoveryProbeOutcome) $null 'Pending probe blocked/finished early.'
        $script:clock = $script:clock.AddSeconds(25); $p = Get-RunnerRecoveryProbeOutcome
        Assert-Equal $p.success $false 'Hung probe declared success.'; Assert-Equal $script:RunnerRecoveryProbe $null 'Expired probe retained.'
    }
    Check 'probe completion requires exact protected nonce generation and bounded result' {
        foreach ($case in @('matching', 'wrong-nonce', 'wrong-generation', 'oversized')) {
            New-Fixture; $script:state.networkRecovery.operation = 'probe'; $script:state.networkRecovery.phase = 'probing'
            [void][IO.Directory]::CreateDirectory($script:state.instancePath)
            $script:RunnerRecoveryProbe = Start-RunnerRecoveryProbe $script:state ([pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }) 0
            $probe = $script:RunnerRecoveryProbe; $probe.job.Completed = $true
            $value = [ordered]@{ generation = if ($case -ceq 'wrong-generation') { 1 } else { 0 }; probeId = if ($case -ceq 'wrong-nonce') { 'f' * 32 } else { $probe.probeId }; success = $true }
            $text = $value | ConvertTo-Json -Compress
            if ($case -ceq 'oversized') { $text += ' ' * 300 }
            [IO.File]::WriteAllText($probe.resultPath, $text)
            $outcome = Get-RunnerRecoveryProbeOutcome
            Assert-Equal $outcome.success ($case -ceq 'matching') 'Uncorrelated/oversized probe outcome accepted.'
            if (Test-Path -LiteralPath $probe.resultPath) { throw 'Probe result not removed after drain.' }
        }
    }
    Check 'uncertain obsolete probe drain is explicit and cannot authorize continuation' {
        New-Fixture; $script:state.networkRecovery.operation = 'probe'; $script:state.networkRecovery.phase = 'probing'
        $script:RunnerRecoveryProbe = Start-RunnerRecoveryProbe $script:state ([pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }) 0
        $script:state.networkRecovery.generation++; $script:fail = 'probe-drain'
        Assert-Refused { Get-RunnerRecoveryProbeOutcome } 'Uncertain cancellation swallowed.'
        Assert-Equal $script:RunnerRecoveryProbe $null 'Uncertain worker handle was reusable.'
    }
    Check 'last-moment stale ACL inspection cannot resume and disconnects paused VM' {
        New-Fixture; $script:vm.State = 'Paused'; $r = $script:state.networkRecovery; $r.phase = 'resuming'; $r.operation = 'resume'; $r.resumeRequired = $true; Set-FixtureVerifiedRules; $script:fail = 'slow-readback'
        Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $r 'resume' } 'Stale inspection resumed.'
        Assert-Equal $script:vm.State 'Paused' 'Stale inspection resumed VM.'; Assert-Equal $script:adapter.SwitchName '' 'Stale inspection left connection live.'
        Assert-Equal $script:effects @('disconnect') 'Stale inspection dispatched resume.'
        Assert-Equal $r.diagnostics.staleAdmissionCount 1 'Stale lease refusal was not counted once.'
        Assert-Equal $r.diagnostics.refusal 'stale-observation' 'Stale lease refusal missing.'
        Assert-Equal $r.diagnostics.preflightElapsedMs 3000 'Slow ACL preflight duration missing.'
    }
    Check 'slow network inspection retains oldest capture timestamp' {
        New-Fixture; $script:fail = 'slow-network'; $observation = Get-RunnerNetworkObservation
        if (($script:clock - [DateTime]::Parse($observation.observedUtc).ToUniversalTime()).TotalSeconds -ne 3) { throw 'Slow inspection manufactured a fresh observation.' }
    }
    Check 'outage deadline crossing during ACL inspection prevents connect' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'; $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o'); $r.progressUtc = $script:now.AddSeconds(118).ToString('o'); $r.observationUtc = $r.progressUtc
        Set-FixtureVerifiedRules; $script:clock = $script:now.AddSeconds(118); $script:fail = 'slow-readback'
        Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $r 'connect' } 'Expired outage connected.'
        Assert-Equal $script:effects @() 'Expired outage mutated connection.'
    }
    Check 'hard deadline crossing during ACL inspection prevents resume' {
        New-Fixture; $script:vm.State = 'Paused'; $r = $script:state.networkRecovery; $r.phase = 'resuming'; $r.operation = 'resume'; $r.resumeRequired = $true
        $r.hardDeadlineUtc = $script:now.AddSeconds(2).ToString('o'); $script:state.deadlineUtc = $r.hardDeadlineUtc; $script:binding.claimHash = Get-RunnerRecoveryClaimHash $script:state
        Set-FixtureVerifiedRules; $script:fail = 'slow-readback'
        Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $r 'resume' } 'Expired hard deadline resumed.'
        Assert-Equal $script:effects @() 'Expired hard deadline dispatched resume.'
    }
    Check 'healthy guardian observation hang expires progress lease' {
        New-Fixture; Assert-Equal (Get-RunnerRecoveryExpiry $script:recovery $script:now.AddSeconds(30)) 'guardian-progress-expired' 'Healthy hang not detected.'
    }
    Check 'fresh observation after preflight drift requarantines without reconnect' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'; $r.candidateFingerprint = 'b' * 64; $r.episodeDeadlineUtc = $script:now.AddSeconds(120).ToString('o')
        Set-FixtureVerifiedRules; $p = Invoke-RunnerRecoveryReconnect $script:binding 0 'connect'
        Assert-Equal $p.outcome.operation 'quarantine' 'Fresh post-preflight drift adopted.'
        Assert-Equal $script:effects @('disconnect') 'Fresh drift connected or resumed.'
        Assert-Equal $script:state.networkRecovery.generation 1 'Requarantine did not obsolete dispatch generation.'
    }
    Check 'fresh matching post-preflight observation connects exact isolated adapter' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'; $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
        Set-FixtureVerifiedRules; $p = Invoke-RunnerRecoveryReconnect $script:binding 0 'connect'
        Assert-Equal $p.outcome.operation 'connect' 'Matching preflight did not connect.'; Assert-Equal $script:effects @('connect') 'Matching connection changed VM state.'
    }
    Check 'stale final admission keeps verified policy isolated without repeating the early ACL inspection or apply' {
        New-StaleRetryFixture
        $deadline = $script:state.networkRecovery.episodeDeadlineUtc; $hard = $script:state.networkRecovery.hardDeadlineUtc
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $script:aclQueries 1 'Connect handoff repeated an early ACL query before the final live admission.'
        Assert-Equal $script:state.networkRecovery.phase 'verified' 'Known isolated stale admission lost its verified policy.'
        Assert-Equal $script:state.networkRecovery.operation '' 'Stale admission retained an active operation.'
        Assert-Equal $script:state.networkRecovery.stableObservations 0 'Stale admission reused old stability.'
        Assert-Equal $script:effects @('disconnect') 'Stale admission connected or resumed.'
        Assert-Equal $script:state.networkRecovery.diagnostics.observationAgeMs 3000 'Actual retained capture age was not recorded.'
        $script:fail = ''
        foreach ($i in 1..3) {
            $script:clock = $script:clock.AddSeconds(1)
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $deadline 'Verified retry extended the original episode.'
            Assert-Equal $script:state.networkRecovery.hardDeadlineUtc $hard 'Verified retry extended the hard deadline.'
            if ($i -lt 3) { Assert-Equal $p.outcome $null 'Verified retry bypassed three new spaced observations.' }
        }
        Assert-Equal $p.outcome.operation 'connect' 'Fresh live admission did not connect after new stability.'
        Assert-Equal $script:addCount 0 'Unchanged verified policy was redundantly reapplied.'
        Assert-Equal $script:effects @('disconnect', 'connect') 'Verified retry changed isolation or resume intent.'
    }
    Check 'fingerprint change after known isolated stale admission requires new policy application in the same episode' {
        New-StaleRetryFixture
        $deadline = $script:state.networkRecovery.episodeDeadlineUtc
        [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}))
        $script:fail = ''; $script:captures = @(New-Capture '192.168.5.12' '192.168.5.0/24'); $script:readIndex = -1
        foreach ($i in 1..3) {
            $script:clock = $script:clock.AddSeconds(1)
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        }
        Assert-Equal $p.outcome.operation 'apply' 'Changed fingerprint reused the old verified policy.'
        if ($script:addCount -le 0) { throw 'Changed policy was not installed.' }
        Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $deadline 'Changed fingerprint restarted the original episode.'
        Assert-Equal $script:adapter.SwitchName '' 'Changed fingerprint connected before fresh readback/stability.'
    }
    Check 'provider errors copying stale wording remain terminal without verified retry authority' {
        New-StaleRetryFixture; $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'
        $script:fail = 'spoof-stale'
        $p = Invoke-RunnerRecoveryReconnect $script:binding $r.generation 'connect'
        Assert-Equal $p.continue $false 'Arbitrary provider wording acquired verified retry authority.'
        Assert-Equal $script:effects @('cleanup') 'Ambiguous provider error retried or exposed the VM.'
    }
    Check 'a deadline crossing during stale isolation readback cannot retain a verified retry' {
        New-StaleRetryFixture
        $script:afterDisconnect = { $script:clock = $script:clock.AddSeconds(121) }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Expired isolated admission retained a retry.'
        Assert-Equal $script:effects @('disconnect', 'cleanup') 'Expired stale admission connected or resumed.'
        Assert-Equal $script:lastCleanupState.networkRecovery.episodeDeadlineUtc $script:now.AddSeconds(120).ToString('o') 'Stale readback extended the original deadline.'
    }
    Check 'generation replacement during stale isolation readback cannot retain retry authority' {
        New-StaleRetryFixture
        $script:afterDisconnect = { $replacement = Copy-Fixture $script:state; $replacement.networkRecovery.generation++; $script:state = $replacement }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Replaced generation acquired a stale retry.'
        Assert-Equal $script:effects @('disconnect', 'cleanup') 'Replaced generation connected or resumed.'
    }
    Check 'Stop during stale isolation readback preempts retained verified policy' {
        New-StaleRetryFixture
        $stopPath = Join-Path $script:state.instancePath 'stop.requested'
        try {
            [void][IO.Directory]::CreateDirectory($script:state.instancePath)
            $script:afterDisconnect = { [IO.File]::WriteAllText($stopPath, 'fixture') }
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            Assert-Equal $p.continue $false 'Stop acquired a retained verified retry.'
            Assert-Equal $script:effects @('disconnect', 'cleanup') 'Stop was delayed by verified retry.'
        } finally { if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath -Force } }
    }
    Check 'clock regression during stale isolation readback preempts retained verified policy' {
        New-StaleRetryFixture
        $script:afterDisconnect = { $script:clock = $script:now.AddSeconds(-1) }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Regressed clock acquired a retained verified retry.'
        Assert-Equal $script:effects @('disconnect', 'cleanup') 'Clock regression connected or resumed.'
    }
    Check 'failed stale isolation readback remains terminal rather than retaining verified phase' {
        New-StaleRetryFixture
        $script:afterDisconnect = { $replacement = Copy-Fixture $script:adapter; $replacement.SwitchName = $script:switch.Name; $replacement.SwitchId = $script:switch.Id; $script:adapter = $replacement }
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Unverified disconnect retained policy retry authority.'
        Assert-Equal $script:effects @('disconnect', 'cleanup') 'Failed isolation retried or resumed.'
    }
    Check 'failed live ACL readback after a known stale retry is terminal without policy reapplication' {
        New-StaleRetryFixture
        [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}))
        $script:fail = ''
        foreach ($i in 1..2) { $script:clock = $script:clock.AddSeconds(1); [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})) }
        $script:fail = 'acl-query'; $script:clock = $script:clock.AddSeconds(1)
        $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
        Assert-Equal $p.continue $false 'Uncertain live ACL query retained verified retry.'
        Assert-Equal $script:effects @('disconnect', 'cleanup') 'Uncertain ACL query connected or reapplied.'
        Assert-Equal $script:addCount 0 'Uncertain readback was repaired by speculative ACL writes.'
    }
    Check 'repeated slow verified admissions never extend the original total recovery deadline' {
        New-StaleRetryFixture
        $deadline = $script:state.networkRecovery.episodeDeadlineUtc; $hard = $script:state.networkRecovery.hardDeadlineUtc
        for ($tick = 0; $tick -lt 130; $tick++) {
            $p = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{})
            if (-not $p.continue) { break }
            Assert-Equal $script:state.networkRecovery.episodeDeadlineUtc $deadline 'Retry extended the original episode.'
            Assert-Equal $script:state.networkRecovery.hardDeadlineUtc $hard 'Retry extended the hard deadline.'
            $script:clock = $script:clock.AddSeconds(1)
        }
        Assert-Equal $p.continue $false 'Repeated slow admission survived the total deadline.'
        Assert-Equal $script:lastCleanupState.networkRecovery.episodeDeadlineUtc $deadline 'Cleanup rebased the original episode.'
        Assert-Equal $script:addCount 0 'Slow verified retries repeatedly reapplied policy.'
        if ($script:effects -contains 'connect' -or $script:effects -contains 'resume') { throw 'Expired retry exposed the VM.' }
    }
    Check 'ACL changes during the final network capture cannot connect from earlier policy evidence' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'
        $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
        Set-FixtureVerifiedRules
        $script:afterObservation = { $script:rules = @($script:rules | Select-Object -Skip 1) }
        $p = Invoke-RunnerRecoveryReconnect $script:binding 0 'connect'
        Assert-Equal $p.continue $false 'Changed ACL continued from cached policy.'
        Assert-Equal $script:effects @('cleanup') 'Changed ACL connected or resumed.'
        Assert-Equal $script:adapter.SwitchName '' 'Changed ACL exposed the adapter.'
    }
    Check 'native adapter replacement during final capture refuses connection before mutation' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'
        $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
        Set-FixtureVerifiedRules
        $script:afterObservation = { $replacement = Copy-Fixture $script:adapter; $replacement.Id = 'replacement-adapter'; $script:adapter = $replacement }
        $p = Invoke-RunnerRecoveryReconnect $script:binding 0 'connect'
        Assert-Equal $p.continue $false 'Changed adapter retained old provider authority.'
        Assert-Equal $script:effects @('cleanup') 'Changed adapter received a connection mutation.'
    }
    Check 'foreign attachment during final capture is never adopted for connection' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'
        $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
        Set-FixtureVerifiedRules
        $script:afterObservation = { $replacement = Copy-Fixture $script:adapter; $replacement.SwitchName = 'foreign'; $replacement.SwitchId = [guid]'00000000-0000-0000-0000-000000000099'; $script:adapter = $replacement }
        $p = Invoke-RunnerRecoveryReconnect $script:binding 0 'connect'
        Assert-Equal $p.continue $false 'Foreign attachment retained cached isolation authority.'
        Assert-Equal $script:effects @('cleanup') 'Foreign attachment received a connection mutation.'
    }
    Check 'a running VM during final capture cannot use earlier paused isolation evidence' {
        New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty
        $r = $script:state.networkRecovery; $r.phase = 'connecting'; $r.operation = 'connect'
        $r.candidateFingerprint = (Get-RunnerNetworkObservation).fingerprint
        Set-FixtureVerifiedRules
        $script:afterObservation = { $replacement = Copy-Fixture $script:vm; $replacement.State = 'Running'; $script:vm = $replacement }
        $p = Invoke-RunnerRecoveryReconnect $script:binding 0 'connect'
        Assert-Equal $p.continue $false 'Changed VM state retained cached paused authority.'
        Assert-Equal $script:effects @('cleanup') 'Running VM was connected from stale isolation evidence.'
    }
    Check 'cleanup refusal retains failed state rather than reporting recovered' { New-Fixture; $script:state.networkRecovery.hardDeadlineUtc = $script:now.AddSeconds(-1).ToString('o'); $script:fail = 'cleanup'; Assert-Refused { Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) } 'Cleanup refusal swallowed.'; Assert-Equal $script:state.networkRecovery.phase 'failed' 'Failed state not retained.' }
    Check 'registration transport ambiguity never obtains a second JIT' { $j = Get-RunnerLaunchDecision $null 'intent' 0 ('c' * 32); $j = Get-RunnerLaunchDecision $j 'transport-lost'; Assert-Equal $j.action 'cleanup' 'Ambiguous registration replayed.'; Assert-Refused { Get-RunnerLaunchDecision $j 'intent' 0 ('d' * 32) } 'New JIT intent accepted.' }
    Check 'detached launch is dispatch-once and exit is not workflow success' {
        $j = Get-RunnerLaunchDecision $null 'intent' 0 ('c' * 32); $j = Get-RunnerLaunchDecision $j 'registered' 123; $j = Get-RunnerLaunchDecision $j 'dispatch'
        Assert-Equal $j.action 'launch-once' 'Initial launch missing.'; $j = Get-RunnerLaunchDecision $j 'transport-lost'
        Assert-Refused { Get-RunnerLaunchDecision $j 'dispatch' } 'Launch replayed.'; $j = Get-RunnerLaunchDecision $j 'receipt' 123 ('c' * 32)
        Assert-Equal $j.phase 'running' 'Liveness not correlated.'; Assert-Equal $j.action 'monitor' 'Liveness declared job success.'
        Assert-Refused { Get-RunnerLaunchDecision $j 'runner-exited' 124 ('c' * 32) } 'Wrong runner exit accepted.'
        $failed = Get-RunnerLaunchDecision $j 'runner-exited' 123 ('c' * 32) 1; Assert-Equal $failed.phase 'runner-failed' 'Nonzero exit ignored.'
        $j = Get-RunnerLaunchDecision $j 'runner-exited' 123 ('c' * 32); Assert-Equal $j.phase 'runner-exited' 'Exit receipt implied workflow success.'
    }
    Check 'probe terminal diagnostics distinguish timeout exit missing invalid legacy and worker failure without changing success correlation' {
        foreach ($case in @('timeout', 'child-exit', 'result-missing', 'result-invalid', 'probe-failed', 'passed', 'legacy', 'untrusted-detail')) {
            New-Fixture; $r = $script:state.networkRecovery; $r.operation = 'probe'; $r.phase = 'probing'
            [void][IO.Directory]::CreateDirectory($script:state.instancePath)
            $script:RunnerRecoveryProbe = Start-RunnerRecoveryProbe $script:state ([pscustomobject]@{ guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1' }) 0
            $probe = $script:RunnerRecoveryProbe; $probe.job.Completed = $true
            if ($case -ceq 'timeout') { $script:clock = $script:clock.AddSeconds(25) }
            elseif ($case -ceq 'child-exit') { $probe.job.ExitCode = 1 }
            elseif ($case -cne 'result-missing') {
                $value = [ordered]@{ generation = 0; probeId = $probe.probeId; success = $case -cin @('passed', 'legacy', 'untrusted-detail') }
                if ($case -ceq 'result-invalid') { $value.probeId = 'f' * 32 }
                if ($case -cin @('probe-failed', 'passed')) { $value.detail = @{ code = if ($case -ceq 'passed') { 'passed' } else { 'github-command-failed' }; elapsedMs = 12 } }
                if ($case -ceq 'untrusted-detail') { $value.detail = @{ code = 'SECRET raw URL credential'; elapsedMs = -1; rawOutput = 'SECRET' } }
                [IO.File]::WriteAllText($probe.resultPath, ($value | ConvertTo-Json -Depth 4 -Compress))
            }
            $outcome = Get-RunnerRecoveryProbeOutcome
            Assert-Equal $outcome.success ($case -cin @('passed', 'legacy', 'untrusted-detail')) 'Diagnostic detail changed the existing Boolean success policy.'
            Assert-Equal $outcome.diagnostic.outcome $(if ($case -cin @('legacy', 'untrusted-detail')) { 'passed' } else { $case }) 'Terminal probe reason collapsed.'
            if ($case -ceq 'probe-failed') { Assert-Equal $outcome.diagnostic.worker 'github-command-failed' 'Worker stage lost.' }
            if ($case -ceq 'untrusted-detail') { Assert-Equal $outcome.diagnostic.worker 'other' 'Untrusted detail persisted.' }
            if (($outcome | ConvertTo-Json -Depth 4 -Compress) -cmatch 'SECRET|credential|rawOutput') { throw 'Raw worker data escaped sanitization.' }
            Assert-Equal $script:effects @('probe-start', 'probe-cancel', 'probe-remove') 'Probe diagnostics changed lifetime actions.'
            Assert-Equal $script:RunnerRecoveryProbe $null 'Probe diagnostics retained a worker.'
        }
    }
    Check 'unsigned child exit diagnostics preserve native values and classify only reserved worker stages' {
        $cases = @(
            @{ code=[uint32]0; stage=''; success=$true },
            @{ code=[uint32]61; stage='common-import' }, @{ code=[uint32]62; stage='instance-containment' },
            @{ code=[uint32]63; stage='instance-identity' }, @{ code=[uint32]64; stage='instance-acl' },
            @{ code=[uint32]65; stage='result-precondition' }, @{ code=[uint32]66; stage='result-publication' },
            @{ code=[uint32]67; stage='acl-read-command-unavailable' }, @{ code=[uint32]68; stage='acl-read-access-denied' },
            @{ code=[uint32]69; stage='acl-read-other' }, @{ code=[uint32]70; stage='owner-read' },
            @{ code=[uint32]71; stage='owner-rejected' }, @{ code=[uint32]72; stage='ace-enumeration' },
            @{ code=[uint32]73; stage='sid-translation' }, @{ code=[uint32]74; stage='allow-rejected' },
            @{ code=[uint32]1; stage='other' }, @{ code=[uint32]3221225781; stage='other' },
            @{ code=[uint32]::MaxValue; stage='other' }
        )
        foreach ($case in $cases) {
            New-Fixture; $r=$script:state.networkRecovery; $r.operation='probe'; $r.phase='probing'
            [void][IO.Directory]::CreateDirectory($script:state.instancePath)
            $script:RunnerRecoveryProbe=Start-RunnerRecoveryProbe $script:state ([pscustomobject]@{guestIp='172.30.240.2';gatewayIp='172.30.240.1'}) 0
            $probe=$script:RunnerRecoveryProbe; $probe.job.Completed=$true; $probe.job.ExitCode=$case.code
            $success=$case.ContainsKey('success') -and $case.success
            if ($success) { [IO.File]::WriteAllText($probe.resultPath,([ordered]@{generation=0;probeId=$probe.probeId;success=$true}|ConvertTo-Json -Compress)) }
            $outcome=Get-RunnerRecoveryProbeOutcome
            Assert-Equal $outcome.success $success 'Unsigned exit changed fail-closed result admission.'
            Assert-Equal $outcome.diagnostic.exitCode ([long]$case.code) 'Unsigned native exit was lost or overflowed.'
            Assert-Equal $outcome.diagnostic.exitStage $case.stage 'Unknown native exit manufactured a reserved stage.'
            $plan=Get-RunnerNetworkRecoveryPlan $r $script:observation $script:clock 'Running' $outcome
            Assert-Equal $plan.recovery.diagnostics.probeExitCode ([long]$case.code) 'Reducer lost exact child exit.'
            Assert-Equal $plan.recovery.diagnostics.probeExitStage $case.stage 'Reducer lost mapped child stage.'
            $projected=New-RunnerRecoveryDiagnostic $plan.recovery $script:clock | ConvertTo-Json -Depth 4 -Compress | ConvertFrom-Json
            Assert-RunnerRecoveryDiagnostic $projected
            Assert-Equal $projected.probeExitCode ([long]$case.code) 'Failure projection lost high unsigned exit.'
        }
    }
    Check 'malformed negative or overflowing child exits stay unavailable and fail closed' {
        foreach ($bad in @(-1,[long]4294967296,'61',[double]61,$true,@([uint32]61),$null)) {
            New-Fixture; $script:state.networkRecovery.operation='probe'; $script:state.networkRecovery.phase='probing'
            $script:RunnerRecoveryProbe=Start-RunnerRecoveryProbe $script:state ([pscustomobject]@{guestIp='172.30.240.2';gatewayIp='172.30.240.1'}) 0
            $script:RunnerRecoveryProbe.job.Completed=$true; $script:RunnerRecoveryProbe.job.ExitCode=$bad
            $outcome=Get-RunnerRecoveryProbeOutcome
            Assert-Equal $outcome.success $false 'Malformed child exit authorized continuation.'
            Assert-Equal $outcome.diagnostic.exitCode $null 'Malformed child exit was fabricated as numeric evidence.'
            Assert-Equal $outcome.diagnostic.exitStage 'other' 'Malformed child exit acquired a trusted stage.'
        }
    }
    Check 'probe evidence cannot change any core action generation binding or deadline and stale outcomes are not counted' {
        foreach ($success in @($false, $true)) {
            foreach ($condition in @('current', 'drift', 'expired', 'stale')) {
                New-Fixture; Isolate; $r = $script:recovery; $r.phase = 'probing'; $r.operation = 'probe'; $r.candidateFingerprint = $script:observation.fingerprint
                $now = if ($condition -ceq 'expired') { $script:now.AddSeconds(120) } else { $script:now.AddSeconds(2) }
                $observation = if ($condition -ceq 'drift') { [pscustomobject]@{ fingerprint = 'c' * 64; rules = @() } } else { $script:observation }
                $outcome = [pscustomobject]@{ generation = if ($condition -ceq 'stale') { $r.generation - 1 } else { $r.generation }; operation = 'probe'; success = $success; diagnostic = [pscustomobject]@{ outcome = if ($success) { 'passed' } else { 'timeout' }; worker = ''; elapsedMs = 25000; workerElapsedMs = 0 } }
                $core = Get-RunnerNetworkRecoveryPlanCore $r $observation $now 'Running' $outcome
                $rich = Get-RunnerNetworkRecoveryPlan $r $observation $now 'Running' $outcome
                Assert-Equal $rich.action $core.action 'Probe evidence changed core action.'
                if ($condition -ceq 'stale') { Assert-Equal $rich.recovery.diagnostics.probeCount 0 'Stale probe evidence counted.' }
                else { Assert-Equal $rich.recovery.diagnostics.probeCount 1 'Correlated probe evidence missing.'; Assert-Equal $rich.recovery.diagnostics.probeFailureCount $(if ($success) { 0 } else { 1 }) 'Probe failure count differs.' }
                $core.recovery.PSObject.Properties.Remove('diagnostics'); $rich.recovery.PSObject.Properties.Remove('diagnostics')
                Assert-Equal $rich.recovery $core.recovery 'Probe evidence changed core state/generation/deadline/binding.'
            }
        }
    }
    Write-Host "Network recovery offline regressions passed: $script:count cases. No live network/provider containment or GitHub continuity proof."
} finally {
    # One checked TEMP directory, same shell end-to-end; no host state cleanup.
    $resolved = [IO.Path]::GetFullPath($root)
    $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -cnotmatch '^ITIR-network-[0-9a-f]{32}$') { throw 'Fixture cleanup target escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
