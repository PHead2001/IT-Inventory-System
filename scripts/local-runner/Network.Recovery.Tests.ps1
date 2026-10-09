# Offline recovery proof only. Every provider/network/state effect is mocked.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-network-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
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
function Check([string] $Name, [scriptblock] $Work) { & $Work; $script:count++; Write-Host "PASS $Name" }
function New-Capture([string] $Ip = '192.168.4.12', [string] $Route = '192.168.4.0/24') {
    [pscustomobject]@{
        addresses = @([pscustomobject]@{ AddressFamily = 'IPv4'; IPAddress = $Ip; PrefixLength = 24; InterfaceIndex = 3 })
        routes = @([pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = '0.0.0.0/0'; NextHop = '192.168.4.1'; InterfaceIndex = 3 },
            [pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = $Route; NextHop = '192.168.4.1'; InterfaceIndex = 3 })
    }
}
function Get-NetIPAddress { $script:readIndex++; if ($script:fail -ceq 'slow-network') { $script:clock = $script:clock.AddSeconds(3) }; return $script:captures[[Math]::Min($script:readIndex, $script:captures.Count - 1)].addresses }
function Get-NetRoute { return $script:captures[[Math]::Min($script:readIndex, $script:captures.Count - 1)].routes }
function Get-RunnerState { return $script:state }
function Write-RunnerJson($Path, $Value) { $script:state = $Value }
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) } # TEMP fixture; no installed ACL claim.
function Enter-RunnerLock { if ($script:locked) { throw 'Nested state mutex.' }; $script:locked = $true; return 'fixture' }
function Exit-RunnerLock($Mutex) { $script:locked = $false }
function Test-RunnerProcessIdentity { return $script:alive }
function Get-RunnerRecoveryNow { return $script:clock }
function Get-VM { return $script:vm }
function Get-VMSwitch { return $script:switch }
function Get-VMNetworkAdapter { return $script:adapter }
function Assert-FixtureTarget($Target, [string] $Kind) {
    $expected = if ($Kind -ceq 'vm') { $script:vm.Id } else { $script:adapter.Id }
    if ([string]$Target.Id -cne [string]$expected) { throw 'Mutation escaped its exact fixture resource.' }
}
function Suspend-VM($VM) { Assert-FixtureTarget $VM 'vm'; $script:effects += 'pause'; if ($script:fail -ceq 'pause') { throw 'pause failed' }; $script:vm.State = 'Paused' }
function Disconnect-VMNetworkAdapter($VMNetworkAdapter) { Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:effects += 'disconnect'; if ($script:fail -ceq 'disconnect') { throw 'disconnect failed' }; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty }
function Connect-VMNetworkAdapter($VMNetworkAdapter, $SwitchName) { Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:effects += 'connect'; if ($script:fail -ceq 'connect') { throw 'connect failed' }; $script:adapter.SwitchName = $SwitchName; $script:adapter.SwitchId = $script:switch.Id }
function Resume-VM($VM) { Assert-FixtureTarget $VM 'vm'; $script:effects += 'resume'; if ($script:fail -ceq 'resume') { throw 'resume failed' }; $script:vm.State = 'Running' }
function Remove-VMNetworkAdapterExtendedAcl($VMNetworkAdapter) { Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:effects += 'remove-acl'; $script:rules = @() }
function Add-VMNetworkAdapterExtendedAcl($VMNetworkAdapter, $Action, $Direction, $Weight, $RemoteIPAddress = '', $LocalIPAddress = '', $LocalPort = '', $RemotePort = '', $Protocol = '', $Stateful = $false, [switch] $Passthru) {
    Assert-FixtureTarget $VMNetworkAdapter 'adapter'; $script:addCount++; $script:effects += 'add-acl'
    if ($script:fail -ceq 'partial-acl' -and $script:addCount -eq 3) { throw 'partial ACL failure' }
    $rule = [pscustomobject]@{ Action = $Action; Direction = $Direction; Weight = $Weight; LocalIPAddress = $LocalIPAddress; RemoteIPAddress = $RemoteIPAddress; LocalPort = $LocalPort; RemotePort = $RemotePort; Protocol = $Protocol; Stateful = $Stateful }
    $script:rules += $rule
    if ($Passthru) { return $rule }
}
function Get-VMNetworkAdapterExtendedAcl($VMNetworkAdapter) { Assert-FixtureTarget $VMNetworkAdapter 'adapter'; if ($script:fail -ceq 'readback') { return }; if ($script:fail -ceq 'slow-readback') { $script:clock = $script:clock.AddSeconds(3) }; return $script:rules }
function Remove-RunnerInstance($State) { $script:effects += 'cleanup'; $script:cleanups++; if ($script:fail -ceq 'cleanup') { throw 'cleanup refused' }; $script:state = $null }
function New-RunnerProbeProcess($Executable, $Arguments) {
    if ($script:locked) { throw 'Probe dispatch held state mutex.' }
    if ($Arguments -notmatch 'Network.Recovery.Probe.ps1') { throw 'Probe dispatched arbitrary command.' }
    $script:effects += 'probe-start'
    $job = [pscustomobject]@{ Completed = $false; ExitCode = 0 }
    $job | Add-Member -MemberType ScriptMethod -Name CancelAndDrain -Value { $script:effects += 'probe-cancel'; $script:effects += 'probe-remove'; if ($script:fail -ceq 'probe-drain') { throw 'Uncertain probe drain.' } }
    return $job
}
$script:realObservation = (Get-Command Get-RunnerNetworkObservation).ScriptBlock
function Get-RunnerNetworkObservation { if ($script:locked) { throw 'Network observation held the state mutex.' }; return & $script:realObservation }
function New-Fixture {
    $script:now = [DateTime]::UtcNow
    $script:clock = $script:now; $script:RunnerRecoveryProbe = $null
    $script:locked = $false; $script:alive = $true; $script:fail = ''; $script:effects = @(); $script:cleanups = 0; $script:addCount = 0; $script:rules = @()
    $script:captures = @(New-Capture); $script:readIndex = -1
    $script:state = [pscustomobject]@{
        tag = $script:RunnerTag; vmName = 'ITIR-' + ('a' * 32); vmId = '00000000-0000-0000-0000-000000000001'
        instancePath = Join-Path $root ('ITIR-' + ('a' * 32)); purpose = 'job'; resourceLabel = 'it-inventory-heavy'; claimMode = 'active'
        createdUtc = $script:now.ToString('o'); deadlineUtc = $script:now.AddMinutes(10).ToString('o')
        supervisorPid = 42; supervisorStartUtc = $script:now.ToString('o'); guardianPid = $PID; guardianStartUtc = $script:now.ToString('o'); guestMac = '02AABBCCDDEE'
        networkFingerprint = ('a' * 64)
    }
    $script:vm = [pscustomobject]@{ Id = [guid]$script:state.vmId; Name = $script:state.vmName; Notes = $script:RunnerTag; Path = Join-Path $script:state.instancePath $script:state.vmName; State = 'Running' }
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
try {
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
    Check 'partial ACL installation never connects or resumes' { New-Fixture; $script:vm.State = 'Paused'; $script:adapter.SwitchName = ''; $script:adapter.SwitchId = [guid]::Empty; $script:state.networkRecovery.operation = 'apply'; $script:state.networkRecovery.phase = 'applying'; $script:state.networkRecovery.candidateRules = $script:observation.rules; $script:fail = 'partial-acl'; Assert-Refused { Invoke-RunnerRecoveryAdapterEffect $script:state $script:state.networkRecovery 'apply' } 'Partial ACL accepted.'; Assert-Equal $script:adapter.SwitchName '' 'Partial ACL reconnected.'; if ($script:effects -contains 'resume') { throw 'Partial ACL resumed.' } }
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
    Write-Host "Network recovery offline regressions passed: $script:count cases. No live network/provider containment or GitHub continuity proof."
} finally {
    # One checked TEMP directory, same shell end-to-end; no host state cleanup.
    $resolved = [IO.Path]::GetFullPath($root)
    $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -cnotmatch '^ITIR-network-[0-9a-f]{32}$') { throw 'Fixture cleanup target escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
