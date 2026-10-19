# Guardian-only recovery primitives. Loading compiles the lifetime helper; it
# performs no VM/network/control mutation or probe dispatch.
# Provider calls are synchronous and serialized by the integration's state lock.
# A provider hang is NOT cancellable proof: retain uncertain state and never resume.
$script:RunnerRecoveryProbe = $null
. (Join-Path $PSScriptRoot 'Probe.Job.ps1') # Compile before guardian/VM execution, never after resume.
function Get-RunnerRecoveryNow { return [DateTime]::UtcNow }
function Get-RunnerRecoveryHash([string] $Text) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}

function Get-RunnerNetworkCapture {
    # No mutex here. Fingerprint and policy MUST consume this same capture.
    $observedUtc = (Get-RunnerRecoveryNow).ToString('o')
    $addresses = @(Get-NetIPAddress -ErrorAction Stop)
    $routes = @(Get-NetRoute -ErrorAction Stop)
    $records = @(
        foreach ($ip in $addresses) {
            'address|{0}|{1}|{2}|{3}' -f $ip.AddressFamily, $ip.IPAddress, $ip.PrefixLength, $ip.InterfaceIndex
        }
        foreach ($route in $routes) {
            'route|{0}|{1}|{2}|{3}' -f $route.AddressFamily, $route.DestinationPrefix, $route.NextHop, $route.InterfaceIndex
        }
    )
    if ($addresses.Count -eq 0 -or $routes.Count -eq 0) { throw 'Network observation is incomplete.' }
    return [pscustomobject]@{
        addresses = $addresses; routes = $routes; observedUtc = $observedUtc
        fingerprint = Get-RunnerRecoveryHash (@($records | Sort-Object -Unique) -join "`n")
    }
}

function New-RunnerNetworkPolicy($Capture) {
    $privatePrefixes = @('0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4')
    $hostIps = @($Capture.addresses | Where-Object { [string]$_.AddressFamily -in @('IPv4', 'InterNetwork', '2') } | ForEach-Object { [string]$_.IPAddress } | Sort-Object -Unique)
    $routes = @($Capture.routes | Where-Object { [string]$_.AddressFamily -in @('IPv4', 'InterNetwork', '2') -and $_.DestinationPrefix -cne '0.0.0.0/0' } | ForEach-Object { [string]$_.DestinationPrefix } | Sort-Object -Unique)
    if ($hostIps.Count -eq 0) { throw 'Network observation has no host IPv4 addresses.' }
    foreach ($ip in $hostIps) {
        $parsed = $null
        if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or -not [Net.IPAddress]::TryParse($ip, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Network policy contains an invalid host IPv4 address.' }
    }
    foreach ($prefix in $routes) {
        $parsed = $null
        if ($prefix -notmatch '^(\d{1,3}(\.\d{1,3}){3})/(\d{1,2})$' -or [int]$Matches[3] -gt 32 -or -not [Net.IPAddress]::TryParse($Matches[1], [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Network policy contains an invalid route.' }
    }
    # Count both default denies as well as the IPv6/private/host/route denies.
    if ((2 + $privatePrefixes.Count + $hostIps.Count + $routes.Count + 1) -gt 4096) { throw 'Network policy exceeds the existing deny capacity.' }
    $rules = @(
        [pscustomobject]@{ Action = 'Deny'; Direction = 'Inbound'; Weight = 1 }
        [pscustomobject]@{ Action = 'Deny'; Direction = 'Outbound'; Weight = 2 }
    )
    $weight = 200
    foreach ($prefix in @($privatePrefixes) + @($routes) + @($hostIps | ForEach-Object { "$_/32" }) + @('::/0')) {
        $rules += [pscustomobject]@{ Action = 'Deny'; Direction = 'Outbound'; RemoteIPAddress = $prefix; Weight = $weight }
        $weight++
    }
    $weight = 100
    foreach ($port in @(80, 443, 5432)) {
        $rules += [pscustomobject]@{ Action = 'Allow'; Direction = 'Outbound'; Protocol = 'TCP'; RemotePort = [string]$port; Weight = $weight; Stateful = $true }
        $weight++
    }
    $weight = 110
    foreach ($dns in @('1.1.1.1', '8.8.8.8')) {
        foreach ($protocol in @('UDP', 'TCP')) {
            $rules += [pscustomobject]@{ Action = 'Allow'; Direction = 'Outbound'; RemoteIPAddress = $dns; RemotePort = '53'; Protocol = $protocol; Weight = $weight; Stateful = $true }
            $weight++
        }
    }
    $rules += [pscustomobject]@{ Action = 'Allow'; Direction = 'Inbound'; RemoteIPAddress = '172.30.240.1'; LocalPort = '22'; Protocol = 'TCP'; Weight = 150; Stateful = $true }
    return $rules
}

function Get-RunnerNetworkObservation {
    # Windows does not expose an atomic address+route snapshot. Reject a changing
    # pair, then retain the second matching capture as the sole policy input.
    $before = Get-RunnerNetworkCapture
    $after = Get-RunnerNetworkCapture
    if ($before.fingerprint -cne $after.fingerprint) { throw 'Network changed during observation.' }
    # Timestamp the oldest read in the retained capture, not the end of policy
    # derivation. Slow inspection cannot manufacture a fresh admission lease.
    return [pscustomobject]@{ fingerprint = $after.fingerprint; rules = @(New-RunnerNetworkPolicy $after); observedUtc = $after.observedUtc }
}

function Get-RunnerRecoveryClaimHash($State) {
    $claim = [ordered]@{}
    foreach ($name in @('tag', 'vmName', 'vmId', 'instancePath', 'purpose', 'resourceLabel', 'claimMode', 'pilotClaim', 'createdUtc', 'deadlineUtc', 'supervisorPid', 'supervisorStartUtc', 'guardianPid', 'guardianStartUtc', 'guestMac')) {
        if ($State.PSObject.Properties.Name -contains $name) { $claim[$name] = $State.$name }
    }
    return Get-RunnerRecoveryHash ($claim | ConvertTo-Json -Depth 20 -Compress)
}

function New-RunnerNetworkBinding($State, $Vm, $Adapter, $Switch) {
    Assert-StateIdentity $State
    if ([guid]$Vm.Id -ne [guid]$State.vmId -or $Vm.Name -cne $State.vmName -or $Vm.Notes -cne $State.tag -or
        [IO.Path]::GetFullPath($Vm.Path) -ine (Join-Path $State.instancePath $State.vmName)) { throw 'Network recovery VM ownership differs.' }
    if ([string]$State.guestMac -cnotmatch '^02[0-9a-fA-F]{10}$' -or [string]::IsNullOrEmpty([string]$Adapter.Id) -or [guid]$Adapter.VMId -ne [guid]$State.vmId -or $Adapter.VMName -cne $State.vmName -or
        $Adapter.DynamicMacAddressEnabled -ne $false -or [string]$Adapter.MacAddress -ine $State.guestMac -or
        $Switch.Name -cne $script:RunnerSwitch -or [string]$Switch.SwitchType -cne 'Internal' -or [guid]$Switch.Id -eq [guid]::Empty -or [guid]$Adapter.SwitchId -ne [guid]$Switch.Id) { throw 'Network recovery adapter/switch/MAC ownership differs.' }
    return [pscustomobject]@{
        claimHash = Get-RunnerRecoveryClaimHash $State
        vmId = [string]$State.vmId; vmName = $State.vmName; adapterId = [string]$Adapter.Id
        mac = ([string]$State.guestMac).ToUpperInvariant(); switchId = [string]$Switch.Id; switchName = $Switch.Name
    }
}

function Assert-RunnerNetworkBinding($State, $Binding, $Vm, $Adapters, $Switch, [switch] $RequireDisconnected) {
    Assert-StateIdentity $State
    if ((Get-RunnerRecoveryClaimHash $State) -cne $Binding.claimHash -or [guid]$State.vmId -ne [guid]$Binding.vmId -or $State.vmName -cne $Binding.vmName) { throw 'Network recovery session/claim/process identity changed.' }
    if (-not (Test-RunnerProcessIdentity $State.supervisorPid $State.supervisorStartUtc) -or -not (Test-RunnerProcessIdentity $State.guardianPid $State.guardianStartUtc)) { throw 'Network recovery owner/guardian is dead.' }
    if ([guid]$Vm.Id -ne [guid]$Binding.vmId -or $Vm.Name -cne $Binding.vmName -or $Vm.Notes -cne $State.tag -or [IO.Path]::GetFullPath($Vm.Path) -ine (Join-Path $State.instancePath $State.vmName)) { throw 'Network recovery VM was replaced.' }
    if (@($Adapters).Count -ne 1) { throw 'Network recovery requires exactly one owned adapter.' }
    $adapter = @($Adapters)[0]
    if ([string]$adapter.Id -cne $Binding.adapterId -or [guid]$adapter.VMId -ne [guid]$Binding.vmId -or $adapter.VMName -cne $Binding.vmName -or
        $adapter.DynamicMacAddressEnabled -ne $false -or [string]$adapter.MacAddress -ine $Binding.mac -or
        [guid]$Switch.Id -ne [guid]$Binding.switchId -or $Switch.Name -cne $Binding.switchName -or [string]$Switch.SwitchType -cne 'Internal') { throw 'Network recovery adapter/switch identity changed.' }
    $disconnected = [string]::IsNullOrEmpty([string]$adapter.SwitchName) -and ([string]::IsNullOrEmpty([string]$adapter.SwitchId) -or [guid]$adapter.SwitchId -eq [guid]::Empty)
    if ($RequireDisconnected) {
        if (-not $disconnected -or [string]$Vm.State -cnotin @('Paused', 'Off')) { throw 'Network recovery quarantine readback failed.' }
    } elseif (-not $disconnected -and ([guid]$adapter.SwitchId -ne [guid]$Binding.switchId -or $adapter.SwitchName -cne $Binding.switchName)) { throw 'Network recovery adapter attached to a different switch.' }
    return $adapter
}

function New-RunnerRecoveryEpisodeDiagnostic {
    return [pscustomobject]@{
        trigger = ''; lastTransition = 'healthy'; refusal = ''
        lastFingerprint = ''; operation = ''; operationStartedUtc = ''
        observationUnavailableCount = 0; fingerprintChangeCount = 0; staleAdmissionCount = 0; applyCount = 0
        observationElapsedMs = 0; preflightElapsedMs = 0; applyElapsedMs = 0
        admissionOperation = ''; observationAgeMs = 0; quarantineElapsedMs = 0; connectElapsedMs = 0; resumeElapsedMs = 0
    }
}

function Set-RunnerRecoveryDiagnostic($Recovery, [string] $Name, $Value) {
    # Diagnostics never influence admission. Ignore malformed historical counters
    # here; their failure projection is independently validated and unavailable.
    try {
    if ($Recovery.PSObject.Properties.Name -notcontains 'diagnostics') {
        $Recovery | Add-Member -NotePropertyName diagnostics -NotePropertyValue (New-RunnerRecoveryEpisodeDiagnostic)
    }
    if ($Name -cin @('trigger', 'lastTransition', 'refusal', 'lastFingerprint', 'operation', 'operationStartedUtc', 'admissionOperation')) {
        if ($Recovery.diagnostics.PSObject.Properties.Name -notcontains $Name) { $Recovery.diagnostics | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
        else { $Recovery.diagnostics.$Name = $Value }
        return
    }
    if ($Name -cnotin @('observationUnavailableCount', 'fingerprintChangeCount', 'staleAdmissionCount', 'applyCount', 'observationElapsedMs', 'preflightElapsedMs', 'applyElapsedMs', 'observationAgeMs', 'quarantineElapsedMs', 'connectElapsedMs', 'resumeElapsedMs')) { return }
    if ($Recovery.diagnostics.PSObject.Properties.Name -notcontains $Name) { $Recovery.diagnostics | Add-Member -NotePropertyName $Name -NotePropertyValue 0 }
    if ($Name -ceq 'observationAgeMs') {
        # Last actual retained-capture age, including a future-clock refusal.
        $Recovery.diagnostics.$Name = [long][Math]::Truncate([Math]::Max(-86400000, [Math]::Min(86400000, [double]$Value)))
        return
    }
    $maximum = if ($Name -clike '*Count') { 1000000 } else { 86400000 }
    if ($Name -clike '*Count') {
        $old = $Recovery.diagnostics.$Name
        if ($old -isnot [ValueType] -or $old -is [bool] -or [double]::IsNaN([double]$old) -or [double]::IsInfinity([double]$old) -or $old -lt 0 -or $old -ne [Math]::Truncate([double]$old)) { return }
        $Value = [Math]::Min($maximum, [double]$old + 1)
    } elseif ($Recovery.diagnostics.$Name -is [ValueType] -and $Recovery.diagnostics.$Name -isnot [bool]) {
        $Value = [Math]::Max([double]$Recovery.diagnostics.$Name, [double]$Value)
    }
    $Recovery.diagnostics.$Name = [long][Math]::Truncate([Math]::Max(0, [Math]::Min($maximum, [double]$Value)))
    } catch { } # Evidence must never become an admission/cleanup dependency.
}

function Get-RunnerRecoveryDiagnosticValue($Recovery, [string] $Name, $Default) {
    # Historical/malformed evidence must not become a new admission input.
    try {
        if ($Recovery.PSObject.Properties.Name -notcontains 'diagnostics' -or
            $Recovery.diagnostics.PSObject.Properties.Name -notcontains $Name) { return $Default }
        $value = $Recovery.diagnostics.$Name
        if ($Name -ceq 'lastFingerprint') {
            if ($value -is [string] -and $value -cmatch '^[0-9a-f]{64}$') { return $value }
        } elseif ($Name -ceq 'preflightElapsedMs') {
            return Get-RunnerRecoveryDiagnosticNumber $value
        }
    } catch { }
    return $Default
}

function New-RunnerNetworkRecovery($Binding, [string] $Fingerprint, [DateTime] $HardDeadlineUtc, [DateTime] $NowUtc) {
    if ($Fingerprint -cnotmatch '^[0-9a-f]{64}$' -or $HardDeadlineUtc -le $NowUtc) { throw 'Network recovery baseline/deadline is invalid.' }
    return [pscustomobject]@{
        schema = 1; binding = $Binding; generation = 0; phase = 'healthy'; fingerprint = $Fingerprint
        hardDeadlineUtc = $HardDeadlineUtc.ToUniversalTime().ToString('o'); episodeDeadlineUtc = ''; episodeStartedUtc = ''
        candidateFingerprint = ''; candidateRules = @(); verifiedRules = @(); stableObservations = 0; lastStableUtc = ''
        resumeRequired = $false; operation = ''; operationStartedUtc = ''; observationUtc = $NowUtc.ToUniversalTime().ToString('o'); progressUtc = $NowUtc.ToUniversalTime().ToString('o'); failure = ''
        diagnostics = New-RunnerRecoveryEpisodeDiagnostic
    }
}

function Get-RunnerRecoveryExpiry($Recovery, [DateTime] $NowUtc) {
    if ($NowUtc -ge [DateTime]::Parse($Recovery.hardDeadlineUtc).ToUniversalTime()) { return 'hard-deadline' }
    if ($Recovery.phase -cne 'healthy') {
        if ($Recovery.episodeDeadlineUtc -and $NowUtc -ge [DateTime]::Parse($Recovery.episodeDeadlineUtc).ToUniversalTime()) { return 'outage-deadline' }
    }
    if (($NowUtc - [DateTime]::Parse($Recovery.progressUtc).ToUniversalTime()).TotalSeconds -ge 30) { return 'guardian-progress-expired' }
    return ''
}

function Get-RunnerNetworkRecoveryPlan($Recovery, $Observation, [DateTime] $NowUtc, [string] $VmState,
    $Outcome = $null, [switch] $Stop, [switch] $OwnerDead, [switch] $IdentityChanged, [switch] $ConnectivityLost) {
    # The unchanged admission reducer decides first. Add only bounded evidence
    # to its returned journal, which the caller already publishes once per tick.
    $plan = Get-RunnerNetworkRecoveryPlanCore $Recovery $Observation $NowUtc $VmState $Outcome -Stop:$Stop -OwnerDead:$OwnerDead -IdentityChanged:$IdentityChanged -ConnectivityLost:$ConnectivityLost
    $next = $plan.recovery
    try {
    if ($Recovery.phase -ceq 'healthy' -and $next.episodeStartedUtc -and $next.episodeStartedUtc -cne $Recovery.episodeStartedUtc) {
        if ($next.PSObject.Properties.Name -notcontains 'diagnostics') { $next | Add-Member -NotePropertyName diagnostics -NotePropertyValue (New-RunnerRecoveryEpisodeDiagnostic) }
        else { $next.diagnostics = New-RunnerRecoveryEpisodeDiagnostic }
    }
    if ($next.phase -cne $Recovery.phase) { Set-RunnerRecoveryDiagnostic $next 'lastTransition' $next.phase }
    if ($next.episodeStartedUtc) {
        $observed = $null -ne $Observation -and $Observation.fingerprint -cmatch '^[0-9a-f]{64}$'
        if (-not $observed) { Set-RunnerRecoveryDiagnostic $next 'observationUnavailableCount' 1 }
        $baseline = if ($Recovery.phase -ceq 'healthy') { $Recovery.fingerprint } elseif ($Recovery.PSObject.Properties.Name -contains 'diagnostics' -and $Recovery.diagnostics.PSObject.Properties.Name -contains 'lastFingerprint' -and $Recovery.diagnostics.lastFingerprint) { $Recovery.diagnostics.lastFingerprint } else { $Recovery.candidateFingerprint }
        if ($observed -and $baseline -and $Observation.fingerprint -cne $baseline) { Set-RunnerRecoveryDiagnostic $next 'fingerprintChangeCount' 1 }
        if ($observed) { Set-RunnerRecoveryDiagnostic $next 'lastFingerprint' $Observation.fingerprint }
        if ($Recovery.phase -ceq 'healthy') {
            $trigger = if ($ConnectivityLost) { 'connectivity-lost' } elseif (-not $observed) { 'observation-unavailable' } else { 'fingerprint-change' }
            Set-RunnerRecoveryDiagnostic $next 'trigger' $trigger
        }
        if ($plan.action -ceq 'apply') { Set-RunnerRecoveryDiagnostic $next 'applyCount' 1 }
    }
    if ($next.operation) {
        Set-RunnerRecoveryDiagnostic $next 'operation' $next.operation
        Set-RunnerRecoveryDiagnostic $next 'operationStartedUtc' $next.operationStartedUtc
    } elseif ($next.phase -ceq 'failed' -and $Recovery.operation) {
        Set-RunnerRecoveryDiagnostic $next 'operation' $Recovery.operation
        Set-RunnerRecoveryDiagnostic $next 'operationStartedUtc' $Recovery.operationStartedUtc
    }
    if ($next.failure) { Set-RunnerRecoveryDiagnostic $next 'refusal' $next.failure }
    } catch { } # Malformed evidence cannot change the reducer's decision.
    return $plan
}

function Get-RunnerNetworkRecoveryPlanCore($Recovery, $Observation, [DateTime] $NowUtc, [string] $VmState,
    $Outcome = $null, [switch] $Stop, [switch] $OwnerDead, [switch] $IdentityChanged, [switch] $ConnectivityLost) {
    # Pure reducer: guardian publishes its result under the state lock before an
    # effect. Outcomes carry generation+operation; old completions never resume.
    $next = $Recovery | ConvertTo-Json -Depth 24 -Compress | ConvertFrom-Json
    $action = 'none'
    $expired = Get-RunnerRecoveryExpiry $next $NowUtc
    if ($Stop -or $OwnerDead -or $IdentityChanged -or $expired -or $NowUtc -lt [DateTime]::Parse($next.progressUtc).ToUniversalTime()) {
        $next.generation++; $next.phase = 'failed'; $next.operation = ''
        $next.failure = if ($Stop) { 'stop' } elseif ($OwnerDead) { 'owner-dead' } elseif ($IdentityChanged) { 'identity-changed' } elseif ($expired) { $expired } else { 'clock-regressed' }
        return [pscustomobject]@{ recovery = $next; action = 'cleanup' }
    }
    if ($next.phase -ceq 'failed') { return [pscustomobject]@{ recovery = $next; action = 'cleanup' } }
    if ($null -ne $Outcome -and ($Outcome.generation -ne $next.generation -or $Outcome.operation -cne $next.operation)) {
        $Outcome = $null
    }
    $observed = $null -ne $Observation -and $Observation.fingerprint -cmatch '^[0-9a-f]{64}$'
    $drift = $ConnectivityLost -or -not $observed -or $Observation.fingerprint -cne $(if ($next.phase -ceq 'healthy') { $next.fingerprint } else { $next.candidateFingerprint })
    if ($ConnectivityLost -and $next.phase -cne 'healthy') {
        # A successful old connect/resume/probe outcome cannot replace current
        # provider connectivity. Requarantine within the original episode.
        $next.generation++
        if (-not $next.episodeDeadlineUtc) {
            $next.phase = 'failed'; $next.operation = ''; $next.failure = 'connectivity-state-uncertain'
            return [pscustomobject]@{ recovery = $next; action = 'cleanup' }
        }
        $next.phase = 'quarantining'; $next.operation = 'quarantine'; $next.operationStartedUtc = $NowUtc.ToUniversalTime().ToString('o'); $next.progressUtc = $next.operationStartedUtc
        if ($VmState -ceq 'Running') { $next.resumeRequired = $true }
        return [pscustomobject]@{ recovery = $next; action = 'quarantine' }
    }
    if ($next.operation) {
        if ($null -eq $Outcome) {
            if ($next.operation -ceq 'probe' -and $drift) {
                $next.generation++; $next.phase = 'quarantining'; $next.operation = 'quarantine'; $next.operationStartedUtc = $NowUtc.ToUniversalTime().ToString('o'); $next.progressUtc = $NowUtc.ToUniversalTime().ToString('o')
                return [pscustomobject]@{ recovery = $next; action = 'quarantine' }
            }
            return [pscustomobject]@{ recovery = $next; action = 'none' }
        }
        if (-not $Outcome.success -and $next.operation -cne 'probe') {
            $next.phase = 'failed'; $next.failure = 'operation-uncertain'; $next.generation++; $next.operation = ''
            return [pscustomobject]@{ recovery = $next; action = 'cleanup' }
        }
        $completed = $next.operation; $next.operation = ''; $next.operationStartedUtc = ''
        if ($completed -ceq 'quarantine') { $next.phase = 'isolated'; $next.candidateFingerprint = ''; $next.candidateRules = @(); $next.stableObservations = 0 }
        elseif ($completed -ceq 'apply') { $next.phase = 'verified'; $next.stableObservations = 0; $next.lastStableUtc = '' }
        elseif ($completed -ceq 'connect') {
            if (-not $drift) {
                if ($next.resumeRequired) { $next.phase = 'resuming'; $action = 'resume' }
                else { $next.phase = 'healthy'; $next.fingerprint = $next.candidateFingerprint; $next.episodeDeadlineUtc = ''; $next.episodeStartedUtc = '' }
            }
        } elseif ($completed -ceq 'resume') { if (-not $drift) { $next.phase = 'probing'; $action = 'probe' } }
        elseif ($completed -ceq 'probe' -and $Outcome.success -and -not $drift) {
            $next.phase = 'healthy'; $next.fingerprint = $next.candidateFingerprint; $next.episodeDeadlineUtc = ''; $next.episodeStartedUtc = ''
        }
        if ($completed -cne 'quarantine' -and ($drift -or -not $Outcome.success)) { $action = 'quarantine'; $next.phase = 'quarantining'; $next.generation++ }
    } elseif ($next.phase -ceq 'healthy') {
        if ($drift) {
            if ($VmState -cnotin @('Running', 'Paused', 'Off')) { $next.phase = 'failed'; $next.failure = 'vm-state-uncertain'; return [pscustomobject]@{ recovery = $next; action = 'cleanup' } }
            $next.episodeStartedUtc = $NowUtc.ToUniversalTime().ToString('o')
            $deadline = $NowUtc.AddSeconds(120)
            $hard = [DateTime]::Parse($next.hardDeadlineUtc).ToUniversalTime()
            if ($deadline -gt $hard) { $deadline = $hard }
            $next.episodeDeadlineUtc = $deadline.ToUniversalTime().ToString('o')
            $next.resumeRequired = $VmState -ceq 'Running'; $next.phase = 'quarantining'; $next.generation++; $action = 'quarantine'
        }
    } elseif ($next.phase -cin @('isolated', 'verified')) {
        if (-not $observed) { $next.candidateFingerprint = ''; $next.candidateRules = @(); $next.stableObservations = 0; $next.lastStableUtc = '' }
        else {
            if ($next.candidateFingerprint -cne $Observation.fingerprint) {
                $next.candidateFingerprint = $Observation.fingerprint; $next.candidateRules = @($Observation.rules); $next.stableObservations = 0; $next.lastStableUtc = ''
                if ($next.phase -ceq 'verified') { $next.phase = 'isolated' }
            }
            if (-not $next.lastStableUtc -or ($NowUtc - [DateTime]::Parse($next.lastStableUtc).ToUniversalTime()).TotalSeconds -ge 1) {
                $next.stableObservations++; $next.lastStableUtc = $NowUtc.ToUniversalTime().ToString('o')
            }
            if ($next.stableObservations -ge 3) {
                if ($next.phase -ceq 'isolated') { $next.phase = 'applying'; $action = 'apply' }
                else { $next.phase = 'connecting'; $action = 'connect' }
            }
        }
    }
    if ($action -cne 'none') {
        $next.operation = $action; $next.operationStartedUtc = $NowUtc.ToUniversalTime().ToString('o')
        $next.observationUtc = if ($observed -and $Observation.PSObject.Properties.Name -contains 'observedUtc') { $Observation.observedUtc } else { $NowUtc.ToUniversalTime().ToString('o') }
    }
    $next.progressUtc = $NowUtc.ToUniversalTime().ToString('o')
    return [pscustomobject]@{ recovery = $next; action = $action }
}

function Get-RunnerRecoveryRuleKey($Rule) {
    $values = foreach ($field in @('Action', 'Direction', 'LocalIPAddress', 'RemoteIPAddress', 'LocalPort', 'RemotePort', 'Protocol', 'Weight', 'Stateful')) {
        if ($Rule.PSObject.Properties.Name -contains $field) { [string]$Rule.$field } else { '' }
    }
    return $values -join '|'
}

function Assert-RunnerRecoveryRules($Adapter, $Expected) {
    if (@($Expected).Count -eq 0) { throw 'Recovery has no verified ACL baseline.' }
    $actual = @(Get-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $Adapter -ErrorAction Stop)
    $left = @($Expected | ForEach-Object { Get-RunnerRecoveryRuleKey $_ } | Sort-Object)
    $right = @($actual | ForEach-Object { Get-RunnerRecoveryRuleKey $_ } | Sort-Object)
    if ($left.Count -ne $right.Count -or (Compare-Object $left $right)) { throw 'Recovery ACL exact readback failed.' }
}

function Install-RunnerRecoveryRules($Adapter, $Rules) {
    # Caller has already proven the exact VM paused/off and its vNIC disconnected
    # (or the initial never-booted Off lifecycle). Never called on a live vNIC.
    if (@($Rules).Count -eq 0) { throw 'Recovery cannot install an empty policy.' }
    # Remove the provider's actual ACL objects for this already verified adapter.
    # The adapter parameter set also requires Weight/Direction; it is not a
    # remove-all operation and must never be used as a broad selector here.
    $existing = @(Get-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $Adapter -ErrorAction Stop)
    foreach ($existingRule in $existing) {
        Remove-VMNetworkAdapterExtendedAcl -InputObject $existingRule -ErrorAction Stop
    }
    if (@(Get-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $Adapter -ErrorAction Stop).Count -ne 0) { throw 'Recovery old ACL removal was not verified empty.' }
    $installed = @()
    foreach ($rule in @($Rules)) {
        $arguments = @{ VMNetworkAdapter = $Adapter; ErrorAction = 'Stop' }
        foreach ($field in $rule.PSObject.Properties) { $arguments[$field.Name] = $field.Value }
        $returned = @(Add-VMNetworkAdapterExtendedAcl @arguments -Passthru)
        if ($returned.Count -ne 1) { throw 'Recovery ACL installation returned an ambiguous rule.' }
        foreach ($field in $rule.PSObject.Properties) {
            if ([string]$returned[0].($field.Name) -ine [string]$field.Value) { throw 'Recovery ACL installation changed the requested policy.' }
        }
        $canonical = [ordered]@{}
        foreach ($field in @('Action', 'Direction', 'LocalIPAddress', 'RemoteIPAddress', 'LocalPort', 'RemotePort', 'Protocol', 'Weight', 'Stateful')) { $canonical[$field] = [string]$returned[0].$field }
        $installed += [pscustomobject]$canonical
    }
    Assert-RunnerRecoveryRules $Adapter $installed
    return $installed
}

function Get-RunnerRecoveryAdmissionKey($Recovery) {
    $rules = @($Recovery.verifiedRules | ForEach-Object { Get-RunnerRecoveryRuleKey $_ } | Sort-Object)
    return Get-RunnerRecoveryHash (@(
        ($Recovery.binding | ConvertTo-Json -Depth 4 -Compress), [string]$Recovery.generation,
        $Recovery.operation, $Recovery.candidateFingerprint, $Recovery.observationUtc, ($rules -join "`n")
    ) -join "`n")
}

function Test-RunnerIsolatedStaleAdmission($Failure, $Recovery) {
    try {
        $key = $Failure.Exception.Data['runnerIsolatedStaleAdmission']
        return $key -is [string] -and $key -cmatch '^[0-9a-f]{64}$' -and
            $key -ceq (Get-RunnerRecoveryAdmissionKey $Recovery)
    } catch { return $false }
}

function Assert-RunnerRecoveryDispatch($State, $Recovery, $Vm, $Adapter) {
    # Called AFTER slow provider identity/ACL reads, immediately before the
    # reconnect/resume command. A stale observation never grants live access.
    $now = Get-RunnerRecoveryNow
    Set-RunnerRecoveryDiagnostic $Recovery 'admissionOperation' $Recovery.operation
    $age = ($now - [DateTime]::Parse($Recovery.observationUtc).ToUniversalTime()).TotalSeconds
    Set-RunnerRecoveryDiagnostic $Recovery 'observationAgeMs' ($age * 1000)
    if ((Get-RunnerRecoveryExpiry $Recovery $now) -or $now -ge [DateTime]::Parse($State.deadlineUtc).ToUniversalTime()) { throw 'Recovery deadline reached before dispatch.' }
    if ($age -lt 0 -or $age -gt 2) {
        Set-RunnerRecoveryDiagnostic $Recovery 'staleAdmissionCount' 1
        Set-RunnerRecoveryDiagnostic $Recovery 'refusal' 'stale-observation'
        if ([string]$Vm.State -cnotin @('Paused', 'Off')) { throw 'Stale recovery observation has uncertain VM state.' }
        Disconnect-VMNetworkAdapter -VMNetworkAdapter $Adapter -ErrorAction Stop
        $readback = Get-VM -Id ([guid]$Recovery.binding.vmId) -ErrorAction Stop
        $switch = Get-VMSwitch -Id ([guid]$Recovery.binding.switchId) -ErrorAction Stop
        [void](Assert-RunnerNetworkBinding $State $Recovery.binding $readback @(Get-VMNetworkAdapter -VM $readback -ErrorAction Stop) $switch -RequireDisconnected)
        $current = Get-RunnerState
        $isolatedUtc = Get-RunnerRecoveryNow
        if (-not (Test-RunnerRecoveryGeneration $current $Recovery.binding $Recovery.generation $Recovery.operation) -or
            (Test-RunnerSessionStopRequested $State) -or (Get-RunnerRecoveryExpiry $Recovery $isolatedUtc) -or
            $isolatedUtc -ge [DateTime]::Parse($State.deadlineUtc).ToUniversalTime() -or
            $isolatedUtc -lt [DateTime]::Parse($Recovery.progressUtc).ToUniversalTime()) { throw 'Isolated stale recovery lost its lifetime.' }
        # Only this post-isolation branch may retain already-live-read policy.
        # A provider exception with similar text never acquires retry authority.
        $failure = [Management.Automation.RuntimeException]::new('Recovery observation stale; isolated reinspection required.')
        $failure.Data['runnerIsolatedStaleAdmission'] = Get-RunnerRecoveryAdmissionKey $Recovery
        throw $failure
    }
    $current = Get-RunnerState
    if (-not (Test-RunnerRecoveryGeneration $current $Recovery.binding $Recovery.generation $Recovery.operation) -or
        (Test-RunnerSessionStopRequested $State)) { throw 'Recovery dispatch cancelled.' }
}

function Invoke-RunnerRecoveryAdapterEffect($State, $Recovery, [ValidateSet('quarantine', 'apply', 'connect', 'resume')][string] $Action) {
    # Caller MUST hold the checked session mutex. No sleeps/network probes here.
    # These provider calls are synchronous, not bounded cancellation promises.
    $attemptStartedUtc = Get-RunnerRecoveryNow
    try {
    $binding = $Recovery.binding
    $preflightStartedUtc = Get-RunnerRecoveryNow
    $current = Get-RunnerState
    if (-not (Test-RunnerRecoveryGeneration $current $binding $Recovery.generation $Action) -or $current.guardianPid -ne $PID -or
        (Test-RunnerSessionStopRequested $State)) { throw 'Recovery generation cancelled before provider mutation.' }
    $vm = Get-VM -Id ([guid]$binding.vmId) -ErrorAction Stop
    $switch = Get-VMSwitch -Id ([guid]$binding.switchId) -ErrorAction Stop
    $adapters = @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
    $adapter = Assert-RunnerNetworkBinding $State $binding $vm $adapters $switch
    Set-RunnerRecoveryDiagnostic $Recovery 'preflightElapsedMs' (((Get-RunnerRecoveryNow) - $preflightStartedUtc).TotalMilliseconds)
    if ($Action -ceq 'quarantine') {
        if ([string]$vm.State -ceq 'Running') {
            Suspend-VM -VM $vm -ErrorAction Stop
            $vm = Get-VM -Id ([guid]$binding.vmId) -ErrorAction Stop
            if ([string]$vm.State -cne 'Paused') { throw 'Recovery pause was not verified.' }
        } elseif ([string]$vm.State -cnotin @('Off', 'Paused')) { throw 'Recovery cannot quarantine an uncertain VM state.' }
        Disconnect-VMNetworkAdapter -VMNetworkAdapter $adapter -ErrorAction Stop
    } elseif ($Action -ceq 'apply') {
        [void](Assert-RunnerNetworkBinding $State $binding $vm $adapters $switch -RequireDisconnected)
        $applyStartedUtc = Get-RunnerRecoveryNow
        try { $installed = @(Install-RunnerRecoveryRules $adapter $Recovery.candidateRules) }
        finally { Set-RunnerRecoveryDiagnostic $Recovery 'applyElapsedMs' (((Get-RunnerRecoveryNow) - $applyStartedUtc).TotalMilliseconds) }
    } elseif ($Action -ceq 'connect') {
        [void](Assert-RunnerNetworkBinding $State $binding $vm $adapters $switch -RequireDisconnected)
        Assert-RunnerRecoveryRules $adapter $Recovery.verifiedRules
        Set-RunnerRecoveryDiagnostic $Recovery 'preflightElapsedMs' (((Get-RunnerRecoveryNow) - $preflightStartedUtc).TotalMilliseconds)
        Assert-RunnerRecoveryDispatch $State $Recovery $vm $adapter
        Connect-VMNetworkAdapter -VMNetworkAdapter $adapter -SwitchName $binding.switchName -ErrorAction Stop
    } else {
        if (-not $Recovery.resumeRequired -or [string]$vm.State -cne 'Paused' -or [guid]$adapter.SwitchId -ne [guid]$binding.switchId) { throw 'Recovery resume requires its own paused, connected VM.' }
        Assert-RunnerRecoveryRules $adapter $Recovery.verifiedRules
        Set-RunnerRecoveryDiagnostic $Recovery 'preflightElapsedMs' (((Get-RunnerRecoveryNow) - $preflightStartedUtc).TotalMilliseconds)
        Assert-RunnerRecoveryDispatch $State $Recovery $vm $adapter
        Resume-VM -VM $vm -ErrorAction Stop
    }
    $vm = Get-VM -Id ([guid]$binding.vmId) -ErrorAction Stop
    $adapters = @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
    $adapter = Assert-RunnerNetworkBinding $State $binding $vm $adapters $switch -RequireDisconnected:($Action -cin @('quarantine', 'apply'))
    if ($Action -ceq 'connect' -and ([guid]$adapter.SwitchId -ne [guid]$binding.switchId -or [string]$vm.State -cnotin @('Paused', 'Off'))) { throw 'Recovery connect readback failed.' }
    if ($Action -ceq 'resume' -and [string]$vm.State -cne 'Running') { throw 'Recovery resume readback failed.' }
    if ($Action -ceq 'apply') { return $installed }
    } finally {
        if ($Action -cne 'apply') { Set-RunnerRecoveryDiagnostic $Recovery ($Action + 'ElapsedMs') (((Get-RunnerRecoveryNow) - $attemptStartedUtc).TotalMilliseconds) }
    }
}

function New-RunnerProbeProcess([string] $Executable, [string] $Arguments) {
    return [ITIR.ProbeJob]::new($Executable, $Arguments)
}

function Start-RunnerRecoveryProbe($State, $Config, [long] $Generation) {
    if ($Config.guestIp -cne '172.30.240.2' -or $Config.gatewayIp -cne '172.30.240.1') { throw 'Recovery probe network identity differs.' }
    $current = Get-RunnerState
    if (-not (Test-RunnerRecoveryGeneration $current $State.networkRecovery.binding $Generation 'probe') -or
        (Get-RunnerRecoveryExpiry $current.networkRecovery (Get-RunnerRecoveryNow)) -or
        (Test-RunnerSessionStopRequested $State)) { throw 'Recovery probe admission was cancelled.' }
    $probeId = [guid]::NewGuid().ToString('N')
    $resultPath = Assert-OwnedPath (Join-Path $State.instancePath ("probe-$probeId.json"))
    $executable = Join-Path $PSHOME 'powershell.exe'
    $arguments = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'Network.Recovery.Probe.ps1'),
        '-InstancePath', $State.instancePath, '-ProbeId', $probeId, '-Generation', [string]$Generation)
    # Fixed worker is assigned while suspended before it can spawn SSH. The sole
    # noninherited guardian Job handle owns its complete native descendant tree.
    $job = New-RunnerProbeProcess $executable (($arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    return [pscustomobject]@{ job = $job; probeId = $probeId; resultPath = $resultPath; generation = $Generation; operation = 'probe'; startedUtc = (Get-RunnerRecoveryNow).ToString('o'); binding = $State.networkRecovery.binding }
}

function Stop-RunnerRecoveryProbe {
    if ($null -eq $script:RunnerRecoveryProbe) { return }
    $probe = $script:RunnerRecoveryProbe
    try { $probe.job.CancelAndDrain() } finally { $script:RunnerRecoveryProbe = $null }
    if (Test-Path -LiteralPath $probe.resultPath) {
        Assert-RunnerProtectedPath $probe.resultPath
        Remove-Item -LiteralPath $probe.resultPath -Force -ErrorAction Stop
    }
}

function Get-RunnerRecoveryProbeOutcome {
    if ($null -eq $script:RunnerRecoveryProbe) { return $null }
    $probe = $script:RunnerRecoveryProbe
    $current = Get-RunnerState
    if (-not (Test-RunnerRecoveryGeneration $current $probe.binding $probe.generation 'probe')) { Stop-RunnerRecoveryProbe; return $null }
    $expired = ((Get-RunnerRecoveryNow) - [DateTime]::Parse($probe.startedUtc).ToUniversalTime()).TotalSeconds -ge 25
    if (-not $expired -and -not $probe.job.Completed) { return $null }
    $success = $false
    if (-not $expired -and $probe.job.ExitCode -eq 0 -and (Test-Path -LiteralPath $probe.resultPath -PathType Leaf)) {
        try {
            Assert-RunnerProtectedPath $probe.resultPath
            if ((Get-Item -LiteralPath $probe.resultPath).Length -gt 256) { throw 'Probe result exceeded protocol bound.' }
            $received = Read-RunnerJson $probe.resultPath
            $success = $received.generation -eq $probe.generation -and $received.probeId -ceq $probe.probeId -and $received.success -is [bool] -and $received.success -eq $true
        } catch { $success = $false }
    }
    $outcome = [pscustomobject]@{ generation = $probe.generation; operation = 'probe'; success = $success }
    Stop-RunnerRecoveryProbe
    return $outcome
}


function Invoke-RunnerRecoveryReconnect($Binding, [long] $Generation, [ValidateSet('connect', 'resume')][string] $Action, [long] $PreflightElapsedMs = 0) {
    # The tick completed identity/ACL preflight before releasing its mutex.
    # Capture again now, then reacquire/fence before synchronous dispatch. No
    # provider mutation is pending/running while the mutex is released.
    $observation = $null
    $observationStartedUtc = Get-RunnerRecoveryNow
    try { $observation = Get-RunnerNetworkObservation } catch { $observation = $null }
    $observationElapsedMs = ((Get-RunnerRecoveryNow) - $observationStartedUtc).TotalMilliseconds
    $mutex = Enter-RunnerLock
    try {
        $state = Get-RunnerState
        if ($null -eq $state) { return [pscustomobject]@{ continue = $false; outcome = $null } }
        if (-not (Test-RunnerRecoveryGeneration $state $Binding $Generation $Action)) { return [pscustomobject]@{ continue = $true; outcome = $null } }
        $r = $state.networkRecovery
        Set-RunnerRecoveryDiagnostic $r 'observationElapsedMs' $observationElapsedMs
        Set-RunnerRecoveryDiagnostic $r 'preflightElapsedMs' $PreflightElapsedMs
        $decisionUtc = Get-RunnerRecoveryNow
        $expiry = Get-RunnerRecoveryExpiry $r $decisionUtc
        if ($expiry) {
            Set-RunnerRecoveryDiagnostic $r 'refusal' 'dispatch-deadline'
            Write-RunnerCleanupObservation 'recovery-dispatch' 'dispatch-deadline' $state $decisionUtc '' $expiry
            $r.phase = 'failed'; $r.generation++; $r.failure = 'dispatch-deadline'; Write-RunnerJson $script:RunnerStatePath $state
            Remove-RunnerInstance $state; return [pscustomobject]@{ continue = $false; outcome = $null }
        }
        $effect = $Action
        if ($null -eq $observation -or $observation.fingerprint -cne $r.candidateFingerprint) {
            if ($null -eq $observation) { Set-RunnerRecoveryDiagnostic $r 'observationUnavailableCount' 1 }
            elseif ((Get-RunnerRecoveryDiagnosticValue $r 'lastFingerprint' '') -cne $observation.fingerprint) { Set-RunnerRecoveryDiagnostic $r 'fingerprintChangeCount' 1 }
            if ($null -ne $observation) { Set-RunnerRecoveryDiagnostic $r 'lastFingerprint' $observation.fingerprint }
            Set-RunnerRecoveryDiagnostic $r 'lastTransition' 'quarantining'
            $r.generation++; $r.phase = 'quarantining'; $r.operation = 'quarantine'; $r.progressUtc = (Get-RunnerRecoveryNow).ToString('o'); $r.operationStartedUtc = $r.progressUtc
            $effect = 'quarantine'
        } else { $r.observationUtc = $observation.observedUtc }
        Write-RunnerJson $script:RunnerStatePath $state
        try {
            [void](Invoke-RunnerRecoveryAdapterEffect $state $r $effect)
            return [pscustomobject]@{ continue = $true; outcome = [pscustomobject]@{ generation = $r.generation; operation = $effect; success = $true } }
        } catch {
            if (Test-RunnerIsolatedStaleAdmission $_ $r) {
                Set-RunnerRecoveryDiagnostic $r 'refusal' 'stale-observation'
                Set-RunnerRecoveryDiagnostic $r 'lastTransition' 'verified'
                # Exact live ACL/binding passed before the stale lease refused;
                # positive disconnect/readback retained isolation. Recheck three
                # new observations and every live admission check next time.
                $r.generation++; $r.phase = 'verified'; $r.operation = ''; $r.operationStartedUtc = ''; $r.stableObservations = 0; $r.lastStableUtc = ''; $r.progressUtc = (Get-RunnerRecoveryNow).ToString('o')
                Write-RunnerJson $script:RunnerStatePath $state
                return [pscustomobject]@{ continue = $true; outcome = $null }
            }
            Set-RunnerRecoveryDiagnostic $r 'refusal' 'provider-uncertain'
            Write-RunnerCleanupObservation 'recovery-dispatch' 'provider-uncertain' $state ([DateTime]::UtcNow)
            $r.phase = 'failed'; $r.generation++; $r.failure = 'provider-uncertain'; Write-RunnerJson $script:RunnerStatePath $state
            Remove-RunnerInstance $state; return [pscustomobject]@{ continue = $false; outcome = $null }
        }
    } finally { Exit-RunnerLock $mutex }
}

function Test-RunnerRecoveryGeneration($State, $Binding, [long] $Generation, [string] $Operation) {
    return $null -ne $State -and $State.PSObject.Properties.Name -contains 'networkRecovery' -and
        (Get-RunnerRecoveryClaimHash $State) -ceq $Binding.claimHash -and
        $State.networkRecovery.generation -eq $Generation -and $State.networkRecovery.operation -ceq $Operation -and
        $State.networkRecovery.phase -cnotin @('failed', 'sealed-preparation')
}

function Assert-RunnerSealedPreparation($State, [DateTime] $NowUtc) {
    # Only the committed credential-free preparation seal can supervise absent
    # VM registration. All provider absence/reference checks remain authoritative.
    Assert-RunnerPrepareState $State
    $r = $State.networkRecovery
    if ($State.phase -cne 'sealed-off' -or $r.phase -cne 'sealed-preparation' -or $r.operation -cne '' -or $r.resumeRequired -ne $false -or
        [guid]$r.binding.vmId -ne [guid]$State.vmId -or $r.binding.vmName -cne $State.vmName -or $r.binding.claimHash -cne (Get-RunnerRecoveryClaimHash $State) -or
        -not (Test-RunnerProcessIdentity $State.supervisorPid $State.supervisorStartUtc) -or
        -not (Test-RunnerProcessIdentity $State.guardianPid $State.guardianStartUtc) -or (Test-RunnerSessionStopRequested $State) -or
        $NowUtc -ge [DateTime]::Parse($State.deadlineUtc).ToUniversalTime() -or (Get-RunnerRecoveryExpiry $r $NowUtc) -or
        $NowUtc -lt [DateTime]::Parse($r.progressUtc).ToUniversalTime()) { throw 'Sealed preparation identity, owner, guardian, Stop or deadline is invalid.' }
    $seal = Get-RunnerEvidenceValue $State.imageSealBinding
    $proof = Get-RunnerEvidenceValue $State.imageScrubProof
    if ($seal.schema -ne 1 -or $seal.generation -ne $r.generation -or $seal.bindingHash -cnotmatch '^[0-9A-F]{64}$' -or $seal.bundleHash -cnotmatch '^[0-9A-F]{64}$' -or
        $seal.recipeId -cnotmatch '^[0-9A-F]{64}$' -or $seal.scrubProofHash -cne $State.imageScrubProof.hash -or
        $proof.schema -ne 1 -or $proof.recipeId -cne $seal.recipeId -or $proof.scrubbed -ne $true -or
        (Compare-Object @($proof.capabilities | Sort-Object) @('os-prerequisites', 'node-toolcache', 'npm-cache', 'playwright', 'supabase-images' | Sort-Object))) { throw 'Sealed preparation committed scrub/binding proof is invalid.' }
    Assert-RunnerImageStorageReceipt $proof
    if (@(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $State.vmName -or [guid]$_.Id -eq [guid]$State.vmId }).Count -ne 0) { throw 'Sealed preparation VM registration reappeared.' }
    Assert-RunnerInstanceUnreferenced $State
}

function Invoke-RunnerNetworkRecoveryTick([string] $SessionName, $Config, $Outcome = $null) {
    # Only the exact guardian invokes this function. Observation/probe IO occurs
    # outside the mutex; provider mutations retain the existing serialization.
    $probeOutcome = Get-RunnerRecoveryProbeOutcome
    if ($null -ne $probeOutcome) { $Outcome = $probeOutcome }
    $observation = $null
    $initial = Get-RunnerState
    $observationStartedUtc = Get-RunnerRecoveryNow
    if ($null -eq $initial -or $initial.PSObject.Properties.Name -notcontains 'phase' -or $initial.phase -cne 'sealed-off') {
        try { $observation = Get-RunnerNetworkObservation } catch { $observation = $null }
    }
    $observationElapsedMs = ((Get-RunnerRecoveryNow) - $observationStartedUtc).TotalMilliseconds
    $observedUtc = if ($null -ne $observation) { [DateTime]::Parse($observation.observedUtc).ToUniversalTime() } else { Get-RunnerRecoveryNow }
    $probe = $false; $probeState = $null; $result = $null; $reconnect = $null
    $mutex = Enter-RunnerLock
    try {
        $state = Get-RunnerState
        if ($null -eq $state -or $state.vmName -cne $SessionName) { return [pscustomobject]@{ continue = $false; outcome = $null } }
        Assert-StateIdentity $state
        if ($state.guardianPid -ne $PID -or -not (Test-RunnerProcessIdentity $state.guardianPid $state.guardianStartUtc)) { throw 'Recovery tick belongs to a different guardian.' }
        if ($state.PSObject.Properties.Name -notcontains 'networkRecovery') { throw 'Recovery tick requires its initialized protected journal.' }
        $recovery = $state.networkRecovery
        $now = Get-RunnerRecoveryNow
        if (($state.PSObject.Properties.Name -contains 'phase' -and $state.phase -ceq 'sealed-off') -or $recovery.phase -ceq 'sealed-preparation') {
            Assert-RunnerSealedPreparation $state $now
            $recovery.progressUtc = $now.ToUniversalTime().ToString('o')
            $state.guardianReady = $true
            Write-RunnerJson $script:RunnerStatePath $state
            return [pscustomobject]@{ continue = $true; outcome = $null }
        }
        # Do not authorize a connection from an observation that waited for a lock.
        $staleObservation = ($now - $observedUtc).TotalSeconds -gt 2 -or ($now - $observedUtc).TotalSeconds -lt 0
        if ($staleObservation) { $observation = $null }
        $preflightStartedUtc = Get-RunnerRecoveryNow
        $vm = Get-VM -Id ([guid]$recovery.binding.vmId) -ErrorAction Stop
        $switch = Get-VMSwitch -Id ([guid]$recovery.binding.switchId) -ErrorAction Stop
        $adapters = @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
        $identityChanged = $false
        $adapter = $null
        try { $adapter = Assert-RunnerNetworkBinding $state $recovery.binding $vm $adapters $switch } catch { $identityChanged = $true }
        $expectsConnected = $recovery.phase -cin @('healthy', 'resuming', 'probing') -or
            ($recovery.phase -ceq 'connecting' -and $null -ne $Outcome -and $Outcome.generation -eq $recovery.generation -and $Outcome.operation -ceq 'connect' -and $Outcome.success)
        $connectivityLost = -not $identityChanged -and $expectsConnected -and [string]::IsNullOrEmpty([string]$adapter.SwitchName)
        $stopReason = 'unavailable'
        $stop = Test-RunnerSessionStopRequested $state ([ref]$stopReason)
        $ownerDead = -not (Test-RunnerProcessIdentity $state.supervisorPid $state.supervisorStartUtc)
        $plan = Get-RunnerNetworkRecoveryPlan $recovery $observation $now ([string]$vm.State) $Outcome -Stop:$stop -OwnerDead:$ownerDead -IdentityChanged:$identityChanged -ConnectivityLost:$connectivityLost
        $state.networkRecovery = $plan.recovery
        Set-RunnerRecoveryDiagnostic $plan.recovery 'observationElapsedMs' $observationElapsedMs
        if ($staleObservation -and $plan.recovery.episodeStartedUtc) {
            Set-RunnerRecoveryDiagnostic $plan.recovery 'staleAdmissionCount' 1
            Set-RunnerRecoveryDiagnostic $plan.recovery 'refusal' 'stale-observation'
        }
        Set-RunnerRecoveryDiagnostic $plan.recovery 'preflightElapsedMs' (((Get-RunnerRecoveryNow) - $preflightStartedUtc).TotalMilliseconds)
        if ($plan.recovery.phase -ceq 'healthy') { $state.networkFingerprint = $plan.recovery.fingerprint }
        Write-RunnerJson $script:RunnerStatePath $state
        if ($plan.action -ceq 'cleanup') {
            Write-RunnerCleanupObservation 'recovery-plan' 'recovery-cleanup' $state $now $stopReason '' @{ ownerAlive = -not $ownerDead }
            Remove-RunnerInstance $state; return [pscustomobject]@{ continue = $false; outcome = $null }
        }
        if ($plan.action -ceq 'probe') { $probe = $true; $probeState = $state }
        elseif ($plan.action -cin @('connect', 'resume')) {
            # No dispatch or duplicate ACL query here. The fresh capture below
            # is still followed by ALL live identity/isolation/ACL checks.
            $reconnect = $plan
        }
        elseif ($plan.action -cne 'none') {
            try {
                $installed = @(Invoke-RunnerRecoveryAdapterEffect $state $plan.recovery $plan.action)
                if ($plan.action -ceq 'apply') { $state.networkRecovery.verifiedRules = $installed; Write-RunnerJson $script:RunnerStatePath $state }
                $result = [pscustomobject]@{ generation = $plan.recovery.generation; operation = $plan.action; success = $true }
            } catch {
                # No provider cancellation/retry claim. Canonical cleanup can
                # itself refuse; retain protected state/files in that case.
                Set-RunnerRecoveryDiagnostic $plan.recovery 'refusal' 'provider-uncertain'
                Write-RunnerCleanupObservation 'recovery-plan' 'provider-uncertain' $state ([DateTime]::UtcNow)
                $state.networkRecovery.phase = 'failed'; $state.networkRecovery.failure = 'provider-uncertain'; $state.networkRecovery.generation++
                Write-RunnerJson $script:RunnerStatePath $state
                Remove-RunnerInstance $state
                return [pscustomobject]@{ continue = $false; outcome = $null }
            }
        }
    } finally { Exit-RunnerLock $mutex }
    if ($null -ne $script:RunnerRecoveryProbe -and -not (Test-RunnerRecoveryGeneration (Get-RunnerState) $script:RunnerRecoveryProbe.binding $script:RunnerRecoveryProbe.generation 'probe')) { Stop-RunnerRecoveryProbe }
    if ($null -ne $reconnect) { return Invoke-RunnerRecoveryReconnect $reconnect.recovery.binding $reconnect.recovery.generation $reconnect.action (Get-RunnerRecoveryDiagnosticValue $reconnect.recovery 'preflightElapsedMs' 0) }
    if ($probe) {
        if ($null -ne $script:RunnerRecoveryProbe) { throw 'Recovery already owns a probe.' }
        $script:RunnerRecoveryProbe = Start-RunnerRecoveryProbe $probeState $Config $probeState.networkRecovery.generation
        # No wait: this same guardian continues observation/quarantine each tick.
    }
    return [pscustomobject]@{ continue = $true; outcome = $result }
}

function Get-RunnerLaunchDecision($Journal, [ValidateSet('intent', 'registered', 'dispatch', 'transport-lost', 'receipt', 'runner-exited')][string] $Event,
    [long] $RunnerId = 0, [string] $LaunchId = '', [ValidateRange(0, 255)][int] $ExitCode = 0) {
    # Guest receipt/SSH success is liveness only. No event authorizes a new JIT,
    # duplicate launch or workflow replay after registration/dispatch ambiguity.
    if ($null -eq $Journal) {
        if ($Event -cne 'intent' -or $LaunchId -cnotmatch '^[0-9a-f]{32}$') { throw 'Launch requires one fresh protected intent.' }
        return [pscustomobject]@{ phase = 'registration-intent'; launchId = $LaunchId; runnerId = 0; action = 'register-once' }
    }
    $next = $Journal | ConvertTo-Json -Compress | ConvertFrom-Json
    $next.action = 'monitor'
    if ($Event -ceq 'registered') {
        if ($next.phase -cne 'registration-intent' -or $RunnerId -le 0) { throw 'Registration outcome cannot replace a runner identity.' }
        $next.runnerId = $RunnerId; $next.phase = 'registered'
    } elseif ($Event -ceq 'dispatch') {
        if ($next.phase -cne 'registered') { throw 'Runner launch cannot be dispatched twice.' }
        $next.phase = 'launch-intent'; $next.action = 'launch-once'
    } elseif ($Event -ceq 'transport-lost') {
        if ($next.phase -ceq 'registration-intent') { $next.phase = 'registration-uncertain'; $next.action = 'cleanup' }
        elseif ($next.phase -cin @('launch-intent', 'running', 'transport-uncertain')) { $next.phase = 'transport-uncertain' }
    } elseif ($Event -ceq 'receipt') {
        if ($LaunchId -cne $next.launchId -or $RunnerId -ne $next.runnerId -or $next.phase -cnotin @('launch-intent', 'running', 'transport-uncertain')) { throw 'Guest liveness receipt does not match the sole launch.' }
        $next.phase = 'running'
    } elseif ($Event -ceq 'runner-exited') {
        if ($RunnerId -ne $next.runnerId -or $LaunchId -cne $next.launchId -or $next.runnerId -le 0 -or $next.phase -cnotin @('launch-intent', 'running', 'transport-uncertain')) { throw 'Guest exit receipt does not match the sole launch.' }
        $next.phase = if ($ExitCode -eq 0) { 'runner-exited' } else { 'runner-failed' }; $next.action = 'cleanup'
    } else { throw 'Existing runner intent cannot be recreated.' }
    return $next
}
