[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Preflight', 'StoreCredential', 'Start', 'Restart', 'Stop', 'Status', 'Watchdog', 'Guard', 'Supervise', 'EnablePilot', 'RetryPilot', 'EnableActive', 'PrepareImage')]
    [string] $Action,
    [ValidatePattern('^ITIR-[0-9a-f]{32}$')][string] $SessionName,
    [ValidatePattern('^[0-9a-f]{40}$')][string] $ExpectedPilotSha,
    [string] $RetryReason
)

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Guest.Network.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
. (Join-Path $PSScriptRoot 'Update.ps1') # Definitions only; dot sourcing never installs a bundle.
. (Join-Path $PSScriptRoot 'PreparedImage.ps1')
$script:RunnerGuardOutcome = $null

function Invoke-GitHub([string] $Uri, [string] $Method = 'GET', $Body = $null, [string] $Token = '') {
    $headers = @{ Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2026-03-10'; 'User-Agent' = 'ITInventoryLocalRunner' }
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $args = @{ Uri = $Uri; Method = $Method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 20 }
    if ($null -ne $Body) {
        $args.ContentType = 'application/json'
        $args.Body = ConvertTo-Json -InputObject $Body -Compress -Depth 5
    }
    return Invoke-RestMethod @args
}

function Get-OwnerToken {
    Assert-SecureRoot
    Initialize-RunnerDpapi
    $credentialPath = Join-Path $script:RunnerRoot 'credential.dpapi'
    $record = Read-RunnerJson $credentialPath
    if ($null -eq $record -or $record.scope -ne 'LocalMachine' -or $record.tag -ne $script:RunnerTag) {
        throw 'The machine-bound DPAPI credential is missing or invalid.'
    }
    $cipher = [Convert]::FromBase64String($record.ciphertext)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { return [Text.Encoding]::UTF8.GetString($plain) }
    finally { [Array]::Clear($plain, 0, $plain.Length) }
}

function Assert-InstalledHost($Config, [switch] $ForPreparation) {
    Assert-HostPrerequisites
    Assert-SecureRoot
    if (-not $ForPreparation -and $Config.activation -notin @('pilot', 'active')) { throw 'Runner pickup is disabled in installed config.' }
    if (-not (Get-ScheduledTask -TaskName $script:RunnerTask -ErrorAction SilentlyContinue) -or
        -not (Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction SilentlyContinue)) {
        throw 'Supervisor and periodic host watchdog tasks must be installed before runner registration.'
    }
    $switch = Get-VMSwitch -Name $script:RunnerSwitch -ErrorAction SilentlyContinue
    $nat = Get-NetNat -Name $script:RunnerNat -ErrorAction SilentlyContinue
    if ($null -eq $switch -or $switch.SwitchType -ne 'Internal' -or $null -eq $nat -or
        $nat.InternalIPInterfaceAddressPrefix -ne '172.30.240.0/29') {
        throw 'The dedicated internal switch/NAT is absent or differs from the installed contract.'
    }
    if ((Get-FileHash -LiteralPath $Config.baseVhdx -Algorithm SHA256).Hash -ine $Config.baseSha256) {
        throw 'The immutable Ubuntu base VHDX has changed.'
    }
    if (@(Get-RunnerVmInventory | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -gt 0) {
        throw 'An owned-prefix VM already exists. Resolve it before launching another.'
    }
    if (Get-RunnerState) { throw 'Runner state exists. Stop or investigate it before launching another.' }
}

function Get-RunnerGuestPrerequisites([string] $ProfileLabel) {
    $profile = Get-RunnerResourceProfile $ProfileLabel
    $docker = $profile.label -cnotin @('it-inventory-light', 'it-inventory-mid')
    $packages = @('ca-certificates', 'curl', 'git', 'openssh-server', 'unzip')
    if ($docker) { $packages += 'docker.io' }
    return [pscustomobject]@{ docker = $docker; packages = $packages }
}

function Get-GuestCloudConfig([string] $PublicKey, [string] $ProfileLabel = 'it-inventory-ephemeral', [bool] $Prepared = $false) {
    $prerequisites = Get-RunnerGuestPrerequisites $ProfileLabel
    # Generic guests need the group before package installation. Prepared guests
    # already have it; redeclaring it makes cloud-init report a recoverable error.
    $groupCreation = if ($Prepared) { '' } else { "groups:`n  - docker" }
    $installation = if ($Prepared) { 'package_update: false' } else { "package_update: true`npackages: [$($prerequisites.packages -join ', ')]" }
    return @"
#cloud-config
hostname: itir-guest
manage_etc_hosts: true
$groupCreation
users:
  - name: runner
    lock_passwd: true
    groups: [sudo, docker]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $PublicKey
$installation
growpart:
  mode: auto
  devices: ['/']
resize_rootfs: true
"@
}

function New-SeedDisk([string] $Path, [string] $PublicKey, [string] $Mac, $Config, [string] $ProfileLabel = 'it-inventory-ephemeral', [bool] $Prepared = $false) {
    [void](Assert-OwnedPath $Path)
    New-VHD -Path $Path -SizeBytes 64MB -Dynamic | Out-Null
    $mounted = Mount-VHD -Path $Path -Passthru
    try {
        $mountedPath = (Get-VHD -DiskNumber $mounted.DiskNumber).Path
        if (-not [string]::Equals([IO.Path]::GetFullPath($mountedPath), [IO.Path]::GetFullPath($Path), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Seed disk identity changed after mount; refusing to format.'
        }
        $disk = Get-Disk -Number $mounted.DiskNumber
        if ($disk.PartitionStyle -ne 'RAW') { throw 'Seed disk is not blank.' }
        $partition = $disk | Initialize-Disk -PartitionStyle MBR -PassThru | New-Partition -UseMaximumSize -AssignDriveLetter
        $partition | Format-Volume -FileSystem FAT32 -NewFileSystemLabel CIDATA -Confirm:$false | Out-Null
        $letter = $partition.DriveLetter
        $root = "$($letter):\"
        $userData = Get-GuestCloudConfig $PublicKey $ProfileLabel $Prepared
        $network = @"
version: 2
ethernets:
  runner0:
    match:
      macaddress: $Mac
    set-name: runner0
    addresses: [$($Config.guestIp)/$($Config.prefixLength)]
    routes:
      - to: default
        via: $($Config.gatewayIp)
    nameservers:
      addresses: [1.1.1.1, 8.8.8.8]
"@
        [IO.File]::WriteAllText((Join-Path $root 'user-data'), $userData, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $root 'meta-data'), "instance-id: $([guid]::NewGuid().ToString('N'))`nlocal-hostname: itir-guest`n", [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $root 'network-config'), $network, [Text.UTF8Encoding]::new($false))
    } finally {
        Dismount-VHD -Path $Path -ErrorAction Stop
    }
}

function Set-IsolatedAdapter($State, $Observation) {
    # Initial configuration only, while the owned VM is Off. Recovery uses the
    # guardian's isolated exact-adapter path instead of this startup function.
    Assert-StateIdentity $State
    $vm = Get-VM -Id ([guid]$State.vmId) -ErrorAction Stop
    $adapters = @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
    if ($adapters.Count -ne 1 -or $vm.State -cne 'Off') { throw 'Initial isolation requires the sole owned Off VM adapter.' }
    $switch = Get-VMSwitch -Name $script:RunnerSwitch -ErrorAction Stop
    [void](New-RunnerNetworkBinding $State $vm $adapters[0] $switch)
    return @(Install-RunnerRecoveryRules $adapters[0] $Observation.rules)
}

function Get-RuleFingerprint($Rule) {
    $fields = @('Action', 'Direction', 'LocalIPAddress', 'RemoteIPAddress', 'LocalPort', 'RemotePort', 'Protocol', 'Weight', 'Stateful')
    $values = foreach ($field in $fields) { [string]$Rule.$field }
    return ($values -join '|')
}

function Assert-AdapterRules([string] $VmName, $Expected) {
    $actual = @(Get-VMNetworkAdapterExtendedAcl -VMName $VmName)
    $expectedFingerprints = @($Expected | ForEach-Object { Get-RuleFingerprint $_ } | Sort-Object)
    $actualFingerprints = @($actual | ForEach-Object { Get-RuleFingerprint $_ } | Sort-Object)
    if ($actualFingerprints.Count -ne $expectedFingerprints.Count -or
        (Compare-Object -ReferenceObject $expectedFingerprints -DifferenceObject $actualFingerprints)) {
        throw 'Hyper-V network ACL readback differs from the exact installed rule set.'
    }
}

function Test-GuestIsolation($State, $Config) {
    $args = Get-SshArgs $State
    $listener = [Net.Sockets.TcpListener]::new([ipaddress]::Parse($Config.gatewayIp), 49581)
    $listener.Start()
    try {
        $exitCode = Invoke-RunnerNative 'ssh.exe' ($args + @("runner@$($Config.guestIp)", 'timeout 4 bash -c "echo probe >/dev/tcp/172.30.240.1/49581" >/dev/null 2>&1; test $? -ne 0'))
        if ($exitCode -ne 0 -or $listener.Pending()) {
            throw 'Guest-to-host isolation probe failed.'
        }
    } finally { $listener.Stop() }
    $exitCode = Invoke-RunnerNative 'ssh.exe' ($args + @("runner@$($Config.guestIp)", 'curl --head --fail --silent --show-error --max-time 10 https://api.github.com >/dev/null'))
    if ($exitCode -ne 0) { throw 'Guest public TLS/DNS probe failed.' }
}

function Save-Heartbeat($State) {
    $mutex = Enter-RunnerLock
    try {
        $current = Get-RunnerState
        if ($null -eq $current -or $current.vmName -ne $State.vmName) { throw 'Runner state was removed.' }
        $current.heartbeatUtc = [DateTime]::UtcNow.ToString('o')
        Write-RunnerJson $script:RunnerStatePath $current
    } finally { Exit-RunnerLock $mutex }
}

function Assert-SessionAlive($State) {
    $State = [pscustomobject]$State
    # This wait is never called under the state mutex. Only the guardian repairs.
    while ($true) {
        $now = Get-RunnerRecoveryNow
        $deadlineReached = $now -ge [DateTime]::Parse($State.deadlineUtc).ToUniversalTime()
        $stopReason = 'unavailable'
        $stopRequested = -not $deadlineReached -and (Test-RunnerSessionStopRequested $State ([ref]$stopReason))
        # Stop inspection can wait for a publisher; never reuse the pre-wait clock.
        $now = Get-RunnerRecoveryNow
        $deadlineReached = $deadlineReached -or $now -ge [DateTime]::Parse($State.deadlineUtc).ToUniversalTime()
        if ($deadlineReached -or $stopRequested) {
            $reason = if ($deadlineReached) { 'deadline' } else { 'stop' }
            throw (New-RunnerObservedFailure 'Session deadline or Stop reached.' (New-RunnerFailureObservation 'session-initial' $reason $State $now $stopReason '' @{ deadlineReached = $deadlineReached }))
        }
        Save-Heartbeat $State
        $sealedState = $null
        $mutex = Enter-RunnerLock
        try {
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -cne $State.vmName -or
                ($State.PSObject.Properties.Name -contains 'vmId' -and ($current.PSObject.Properties.Name -notcontains 'vmId' -or [guid]$current.vmId -ne [guid]$State.vmId))) { throw 'Runner state was removed or replaced.' }
            # Heartbeat may wait for the mutex while the guardian advances progress.
            # Evaluate the freshly read journal against a later clock sample.
            $now = Get-RunnerRecoveryNow
            $deadlineReached = $now -ge [DateTime]::Parse($current.deadlineUtc).ToUniversalTime()
            $stopReason = 'unavailable'
            $stopRequested = -not $deadlineReached -and (Test-RunnerSessionStopRequested $current ([ref]$stopReason))
            $now = Get-RunnerRecoveryNow
            $deadlineReached = $deadlineReached -or $now -ge [DateTime]::Parse($current.deadlineUtc).ToUniversalTime()
            if ($deadlineReached -or $stopRequested) {
                $reason = if ($deadlineReached) { 'deadline' } else { 'stop' }
                throw (New-RunnerObservedFailure 'Session deadline or Stop reached.' (New-RunnerFailureObservation 'session-current' $reason $current $now $stopReason '' @{ deadlineReached = $deadlineReached }))
            }
            if ($current.PSObject.Properties.Name -notcontains 'networkRecovery') {
                if ($current.PSObject.Properties.Name -contains 'guardianPid') { throw 'Recorded guardian lacks its recovery journal.' }
                return # Pre-guardian setup only.
            }
            $guardianAlive = Test-RunnerProcessIdentity $current.guardianPid $current.guardianStartUtc
            $expiry = ''
            $failureReason = if (-not $guardianAlive) { 'guardian-identity' }
                elseif ($current.networkRecovery.phase -ceq 'failed') { 'guardian-failed' }
                elseif (($expiry = Get-RunnerRecoveryExpiry $current.networkRecovery $now)) { 'recovery-expiry' }
                else { '' }
            if ($failureReason) {
                throw (New-RunnerObservedFailure 'Session network guardian failed or expired.' (New-RunnerFailureObservation 'session-guardian' $failureReason $current $now '' $expiry @{ guardianAlive = [bool]$guardianAlive }))
            }
            if (($current.PSObject.Properties.Name -contains 'phase' -and $current.phase -ceq 'sealed-off') -or $current.networkRecovery.phase -ceq 'sealed-preparation') {
                $sealedState = $current
            }
            elseif ($current.networkRecovery.phase -ceq 'healthy' -and $current.guardianReady) { return }
        } finally { Exit-RunnerLock $mutex }
        if ($null -ne $sealedState) {
            # Slow storage/Hyper-V inspection must not block containment's lock.
            Assert-RunnerSealedPreparation $sealedState (Get-RunnerRecoveryNow)
            return
        }
        Start-Sleep -Milliseconds 250
    }
}

function Invoke-GuardCheck([string] $Name) {
    $mutex = Enter-RunnerLock
    try {
        $state = Get-RunnerState
        if ($null -eq $state -or $state.vmName -cne $Name) { return $false }
        Assert-StateIdentity $state
        if ($state.PSObject.Properties.Name -notcontains 'networkRecovery') {
            if ($state.PSObject.Properties.Name -contains 'guardianPid') { throw 'Guardian identity may not be adopted.' }
            $state | Add-Member guardianPid $PID
            $state | Add-Member guardianStartUtc ((Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'))
            $state | Add-Member guardianReady $false
            $vm = Get-VM -Id ([guid]$state.vmId) -ErrorAction Stop
            $adapters = @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
            if ($adapters.Count -ne 1 -or $vm.State -cne 'Off') { throw 'Guardian initialization requires the sole owned Off VM.' }
            $switch = Get-VMSwitch -Name $script:RunnerSwitch -ErrorAction Stop
            $binding = New-RunnerNetworkBinding $state $vm $adapters[0] $switch
            Assert-RunnerRecoveryRules $adapters[0] $state.networkRules
            $recovery = New-RunnerNetworkRecovery $binding $state.networkFingerprint ([DateTime]::Parse($state.deadlineUtc).ToUniversalTime()) (Get-RunnerRecoveryNow)
            $recovery.verifiedRules = $state.networkRules
            $state | Add-Member networkRecovery $recovery
            Write-RunnerJson $script:RunnerStatePath $state
        }
    } finally { Exit-RunnerLock $mutex }
    $tick = Invoke-RunnerNetworkRecoveryTick $Name (Get-RunnerConfig) $script:RunnerGuardOutcome
    $script:RunnerGuardOutcome = $tick.outcome
    if ($tick.continue) {
        $mutex = Enter-RunnerLock
        try {
            $state = Get-RunnerState
            if ($null -eq $state -or $state.vmName -cne $Name -or $state.guardianPid -ne $PID) { return $false }
            $state.guardianReady = $state.networkRecovery.phase -cin @('healthy', 'sealed-preparation')
            Write-RunnerJson $script:RunnerStatePath $state
        } finally { Exit-RunnerLock $mutex }
    }
    return $tick.continue
}

function Start-SessionGuardian($State) {
    $installed = Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1'
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installed`" -Action Guard -SessionName $($State.vmName)"
    $guardian = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
    try {
        $limit = [DateTime]::Parse($State.deadlineUtc).ToUniversalTime()
        do {
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -cne $State.vmName) { throw 'Guardian cancelled the session before boot.' }
            if ($current.PSObject.Properties.Name -contains 'guardianReady' -and $current.guardianReady -eq $true -and
                $current.guardianPid -eq $guardian.Id -and (Test-RunnerProcessIdentity $current.guardianPid $current.guardianStartUtc)) { return }
            if ($guardian.HasExited) { throw 'Network guardian exited before readiness.' }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $limit)
        throw 'Network guardian did not confirm readiness before boot.'
    } finally { $guardian.Dispose() }
}

function Start-GuardedVm($State) {
    Assert-SessionAlive $State
    $boot = $null
    $mutex = Enter-RunnerLock
    try {
        $current = Get-RunnerState
        if ($null -eq $current -or $current.vmName -cne $State.vmName -or $current.guardianReady -ne $true -or
            $current.PSObject.Properties.Name -notcontains 'vmId' -or $current.networkRecovery.phase -cne 'healthy' -or
            (Get-RunnerRecoveryExpiry $current.networkRecovery (Get-RunnerRecoveryNow)) -or
            (Test-RunnerSessionStopRequested $current)) { throw 'VM boot requires its recorded identity and ready guardian.' }
        Assert-RunnerVmLifecycle $State.vmName
        $vmId = [guid]$current.vmId
        $vm = Get-VM -Id $vmId -ErrorAction Stop
        if ([guid]$vm.Id -ne $vmId -or $vm.Name -cne $current.vmName -or $vm.Notes -cne $script:RunnerTag -or
            [IO.Path]::GetFullPath($vm.Path) -ine (Join-Path $current.instancePath $current.vmName)) { throw 'VM identity changed before boot dispatch.' }
        # Dispatch against the verified object, never a delayed name lookup.
        # Hyper-V boot completion must not monopolize the guardian's state lock.
        $boot = Start-VM -VM $vm -AsJob -ErrorAction Stop
    } finally { Exit-RunnerLock $mutex }
    try {
        $limit = [DateTime]::UtcNow.AddMinutes(12)
        while ($boot.State -notin @('Completed', 'Failed', 'Stopped')) {
            Assert-SessionAlive $State
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -cne $State.vmName -or [guid]$current.vmId -ne $vmId) { throw 'Session removed or replaced during VM boot.' }
            if ([DateTime]::UtcNow -ge $limit) { throw 'VM boot completion exceeded its bounded wait.' }
            [void](Wait-Job -Job $boot -Timeout 1)
        }
        if ($boot.State -ne 'Completed') {
            [void](Receive-Job -Job $boot -ErrorAction Stop)
            throw 'Hyper-V VM boot job did not complete successfully.'
        }
        [void](Receive-Job -Job $boot -ErrorAction Stop)
        Assert-SessionAlive $State
        $mutex = Enter-RunnerLock
        try {
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -cne $State.vmName -or [guid]$current.vmId -ne $vmId -or $current.guardianReady -ne $true) { throw 'Session identity changed before VM boot continuation.' }
            $vm = Get-VM -Id $vmId -ErrorAction Stop
            if ([guid]$vm.Id -ne $vmId -or $vm.Name -cne $State.vmName -or $vm.State -cne 'Running' -or
                $vm.Notes -cne $script:RunnerTag -or [IO.Path]::GetFullPath($vm.Path) -ine (Join-Path $current.instancePath $current.vmName)) { throw 'Booted VM readback differs from the recorded identity/running state.' }
        } finally { Exit-RunnerLock $mutex }
    } finally {
        # Stop-Job is not proof of provider cancellation. Canonical cleanup owns
        # exact-GUID removal and retains state/files if provider readback fails.
        if ($null -ne $boot -and $boot.State -in @('Completed', 'Failed', 'Stopped')) { Remove-Job -Job $boot -ErrorAction Stop }
    }
}


function Assert-CurrentRunnerNetworkRules($State) {
    Assert-SessionAlive $State
    $mutex = Enter-RunnerLock
    try {
        $current = Get-RunnerState
        if ($null -eq $current -or $current.vmName -cne $State.vmName -or $current.networkRecovery.phase -cne 'healthy') { throw 'Network changed before current ACL verification.' }
        $vm = Get-VM -Id ([guid]$current.vmId) -ErrorAction Stop
        $adapters = @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
        $switch = Get-VMSwitch -Id ([guid]$current.networkRecovery.binding.switchId) -ErrorAction Stop
        [void](Assert-RunnerNetworkBinding $current $current.networkRecovery.binding $vm $adapters $switch)
        Assert-RunnerRecoveryRules $adapters[0] $current.networkRecovery.verifiedRules
    } finally { Exit-RunnerLock $mutex }
}

function Assert-RunnerJitAdmission($State, $Current, $Expected = $null) {
    # Caller holds the session mutex. Never wait or perform remote demand IO
    # here: evidence obtained before an intervening recovery is obsolete.
    if ($null -eq $Current) { throw 'JIT admission session was removed.' }
    Assert-StateIdentity $Current
    if ($Current.vmName -cne $State.vmName -or [guid]$Current.vmId -ne [guid]$State.vmId -or $Current.instancePath -ine $State.instancePath -or
        $Current.purpose -cne 'job' -or $Current.PSObject.Properties.Name -notcontains 'networkRecovery' -or
        (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) -or (Test-RunnerSessionStopRequested $Current) -or
        (Get-RunnerRecoveryNow) -ge [DateTime]::Parse($Current.deadlineUtc).ToUniversalTime()) { throw 'JIT admission identity, purpose, Stop or deadline differs.' }
    $recovery = $Current.networkRecovery
    if ($recovery.phase -cne 'healthy' -or $Current.guardianReady -ne $true -or
        -not (Test-RunnerProcessIdentity $Current.guardianPid $Current.guardianStartUtc) -or (Get-RunnerRecoveryExpiry $recovery (Get-RunnerRecoveryNow)) -or
        [guid]$recovery.binding.vmId -ne [guid]$Current.vmId -or $recovery.binding.vmName -cne $Current.vmName -or
        $recovery.binding.claimHash -cne (Get-RunnerRecoveryClaimHash $Current)) { throw 'JIT admission guardian is unbound, unhealthy, dead or expired.' }
    $admission = [pscustomobject]@{ generation = [long]$recovery.generation; claimHash = $recovery.binding.claimHash; bindingHash = Get-RunnerRecoveryHash ($recovery.binding | ConvertTo-Json -Depth 8 -Compress); vmId = $Current.vmId; vmName = $Current.vmName; guardianPid = $Current.guardianPid; guardianStartUtc = $Current.guardianStartUtc }
    if ($null -ne $Expected -and ($Expected.generation -ne $admission.generation -or $Expected.claimHash -cne $admission.claimHash -or $Expected.bindingHash -cne $admission.bindingHash -or
        [guid]$Expected.vmId -ne [guid]$admission.vmId -or $Expected.vmName -cne $admission.vmName -or
        $Expected.guardianPid -ne $admission.guardianPid -or $Expected.guardianStartUtc -cne $admission.guardianStartUtc)) { throw 'JIT demand evidence predates a guardian recovery or identity change.' }
    return $admission
}

function Get-RunnerJitAdmission($State) {
    $mutex = Enter-RunnerLock
    try { return Assert-RunnerJitAdmission $State (Get-RunnerState) }
    finally { Exit-RunnerLock $mutex }
}

function Save-RunnerLaunchEvent($State, [string] $Event, [long] $RunnerId = 0, [string] $LaunchId = '', [int] $ExitCode = 0, $Admission = $null, $Config = $null) {
    $mutex = Enter-RunnerLock
    try {
        $current = Get-RunnerState
        if ($null -eq $current -or $current.vmName -cne $State.vmName -or [guid]$current.vmId -ne [guid]$State.vmId -or
            ($current.PSObject.Properties.Name -contains 'purpose' -and $current.purpose -cne 'job') -or
            (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) -or
            (Test-RunnerSessionStopRequested $current) -or (Get-RunnerRecoveryNow) -ge [DateTime]::Parse($current.deadlineUtc).ToUniversalTime()) { throw 'Runner launch session removed/stopped/expired.' }
        if ($Event -ceq 'intent') {
            if ($null -eq $Admission) { throw 'JIT intent requires admission captured before the demand lookup.' }
            [void](Assert-RunnerJitAdmission $State $current $Admission)
        }
        $journal = if ($current.PSObject.Properties.Name -contains 'runnerLaunch') { $current.runnerLaunch } else { $null }
        $next = Get-RunnerLaunchDecision $journal $Event $RunnerId $LaunchId $ExitCode
        if ($Event -ceq 'intent') {
            Assert-RunnerJitRegistrationClear
            if ($null -eq $Config) { $Config = Get-RunnerConfig }
            $registration = [pscustomobject][ordered]@{ schema = 1; tag = $script:RunnerTag; phase = 'intent'; operationId = $next.launchId
                repo = $Config.repo; vmName = $current.vmName; vmId = $current.vmId; instancePath = $current.instancePath
                supervisorPid = $current.supervisorPid; supervisorStartUtc = $current.supervisorStartUtc
                labels = @(Get-RunnerJitLabels $Config $current.resourceLabel); runnerGroupId = $Config.runnerGroupId; runnerId = 0 }
            # Atomic root-level barrier is committed before the POST can run.
            Write-RunnerJitRegistration $registration
            Invoke-RunnerTransitionCheckpoint 'jit-registration-intent'
        } elseif ($Event -cin @('registered', 'dispatch')) {
            $registration = Get-RunnerJitRegistration
            if ($null -eq $registration -or $registration.operationId -cne $next.launchId -or
                $registration.vmName -cne $current.vmName -or [guid]$registration.vmId -ne [guid]$current.vmId -or
                $registration.instancePath -ine $current.instancePath -or $registration.supervisorPid -ne $current.supervisorPid -or
                $registration.supervisorStartUtc -cne $current.supervisorStartUtc) { throw 'JIT response or handoff differs from its exact durable operation.' }
            if ($Event -ceq 'registered') {
                if ($registration.phase -cne 'intent') { throw 'JIT registration response cannot be adopted twice.' }
                $registration.runnerId = $RunnerId; $registration.phase = 'registered'
                Write-RunnerJitRegistration $registration
                Invoke-RunnerTransitionCheckpoint 'jit-registration-registered'
            } elseif ($registration.phase -cne 'registered' -or $registration.runnerId -ne $next.runnerId) { throw 'Guest dispatch lacks its sole validated registration.' }
        }
        $current | Add-Member runnerLaunch $next -Force
        Write-RunnerJson $script:RunnerStatePath $current
        if ($Event -ceq 'dispatch') {
            Invoke-RunnerTransitionCheckpoint 'jit-dispatch-state'
            # Only a fully committed cross-file handoff authorizes SSH. A write
            # failure leaves the predispatch barrier and never sends JIT data.
            $registration.phase = 'handed-off'
            Write-RunnerJitRegistration $registration
            Invoke-RunnerTransitionCheckpoint 'jit-handed-off'
        }
        return $next
    } finally { Exit-RunnerLock $mutex }
}

function Wait-DetachedRunner($State, $Config) {
    # One dispatch already occurred. All retries below are read-only receipt
    # monitor attachment; no registration or launch API/command belongs here.
    while ($true) {
        Assert-SessionAlive $State
        $current = Get-RunnerState
        $journal = $current.runnerLaunch
        $receipt = $null
        $result = $null
        try {
            $result = Invoke-RunnerReceiptNative 'ssh.exe' ((Get-SshArgs $State) + @("runner@$($Config.guestIp)", (Get-RunnerReceiptCommand $journal.launchId)))
        } catch { $result = $null }
        # A transport outage may be retried read-only. A successfully received
        # malformed/different receipt is an integrity failure, never adopted.
        if ($null -ne $result -and $result.ExitCode -eq 0) { $receipt = ConvertFrom-RunnerGuestReceipt $result.Output $journal }
        if ($null -eq $receipt) {
            [void](Save-RunnerLaunchEvent $State 'transport-lost')
        } elseif ($receipt.phase -ceq 'exited') {
            [void](Save-RunnerLaunchEvent $State 'runner-exited' $journal.runnerId $journal.launchId $receipt.exitCode)
            if ($receipt.exitCode -ne 0) { throw 'Detached runner ended abnormally; check GitHub Actions job state.' }
            return
        } else { [void](Save-RunnerLaunchEvent $State 'receipt' $journal.runnerId $journal.launchId) }
        Start-Sleep -Seconds 1
    }
}

function Get-SshArgs($State) {
    return @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=2', '-o', 'StrictHostKeyChecking=accept-new',
        '-o', "UserKnownHostsFile=$($State.instancePath)\known_hosts", '-i', "$($State.instancePath)\id_ed25519")
}

function Get-RunnerGuestReadinessCommand([string] $ProfileLabel) {
    $prerequisites = Get-RunnerGuestPrerequisites $ProfileLabel
    $command = 'timeout 25 cloud-init status --wait >/dev/null 2>&1 && test "$(id -un)" = runner && command -v curl >/dev/null && command -v git >/dev/null && command -v unzip >/dev/null'
    if ($prerequisites.docker) { $command += ' && test -S /var/run/docker.sock && timeout 10 docker info >/dev/null 2>&1' }
    return $command
}

function Wait-Guest($State, $Config, [string] $ProfileLabel = 'it-inventory-ephemeral') {
    $args = Get-SshArgs $State
    $command = Get-RunnerGuestReadinessCommand $ProfileLabel
    $limit = [DateTime]::UtcNow.AddMinutes(12)
    while ([DateTime]::UtcNow -lt $limit) {
        Assert-SessionAlive $State
        $exitCode = Invoke-RunnerNative 'ssh.exe' ($args + @("runner@$($Config.guestIp)", $command))
        if ($exitCode -eq 0) { return }
        Start-Sleep -Seconds 10
    }
    throw 'Guest never reached its profile prerequisite readiness.'
}

function Get-RunnerArchive($State) {
    Assert-SecureRoot
    $release = Invoke-GitHub 'https://api.github.com/repos/actions/runner/releases/latest'
    $assets = @($release.assets | Where-Object name -Match '^actions-runner-linux-x64-[0-9.]+\.tar\.gz$')
    if ($assets.Count -ne 1) {
        throw 'GitHub runner release has no unique Linux x64 archive with an SHA-256 digest.'
    }
    $digestMatch = [regex]::Match([string]$assets[0].digest, '^sha256:([0-9a-f]{64})$')
    if (-not $digestMatch.Success) { throw 'GitHub runner archive has no SHA-256 digest.' }
    $expectedDigest = $digestMatch.Groups[1].Value
    $assetName = [string]$assets[0].name
    $version = $assetName.Substring('actions-runner-linux-x64-'.Length).Replace('.tar.gz', '')
    $url = "https://github.com/actions/runner/releases/download/v$version/$assetName"
    if ($release.tag_name -cne "v$version" -or $assets[0].browser_download_url -cne $url) {
        throw 'GitHub runner archive release identity or official URL is invalid.'
    }
    $mutex = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Archive-v1'
    $temporary = $null
    try {
        $cache = Assert-OwnedPath (Join-Path $script:RunnerRoot 'runner-cache')
        if (-not (Test-Path -LiteralPath $cache)) { [void][IO.Directory]::CreateDirectory($cache) }
        Assert-RunnerProtectedPath $cache
        # Validate the entire small cache before reuse or retention cleanup.
        # Unknown entries, links, ACL changes and corrupted archives fail closed.
        $archives = @()
        $partials = @()
        $entries = @(Get-ChildItem -LiteralPath $cache -Force -ErrorAction Stop)
        if ($entries.Count -gt 16) { throw 'Runner archive cache exceeds its bounded entry view.' }
        foreach ($entry in $entries) {
            $entryPath = Assert-OwnedPath $entry.FullName
            Assert-RunnerProtectedPath $entryPath
            if ($entry.PSIsContainer) { throw 'Runner archive cache contains an unexpected directory.' }
            if ($entry.Name -cmatch '^([0-9a-f]{64})\.tar\.gz$') {
                $digest = $Matches[1]
                if ((Get-FileHash -LiteralPath $entryPath -Algorithm SHA256).Hash -ine $digest) { throw 'Cached runner archive digest mismatch.' }
                $archives += $entry
            } elseif ($entry.Name -cmatch '^[0-9a-f]{64}\.[0-9a-f]{32}\.download$') { $partials += $entry }
            else { throw 'Runner archive cache contains an unexpected entry.' }
        }
        foreach ($partial in $partials) { Remove-Item -LiteralPath (Assert-OwnedPath $partial.FullName) -Force -ErrorAction Stop }
        $path = Assert-OwnedPath (Join-Path $cache "$expectedDigest.tar.gz")
        if (-not (Test-Path -LiteralPath $path)) {
            $temporary = Assert-OwnedPath (Join-Path $cache "$expectedDigest.$([guid]::NewGuid().ToString('N')).download")
            Invoke-WebRequest -Uri $url -OutFile $temporary -UseBasicParsing -TimeoutSec 1800
            Assert-RunnerProtectedPath $temporary
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ine $expectedDigest) { throw 'GitHub runner archive digest mismatch.' }
            # Same-directory rename publishes only a complete verified archive.
            [IO.File]::Move($temporary, $path)
            $temporary = $null
            Assert-RunnerProtectedPath $path
        }
        # Retain the current archive and at most one verified previous release.
        $previous = @($archives | Where-Object FullName -CNE $path | Sort-Object LastWriteTimeUtc -Descending)
        foreach ($old in @($previous | Select-Object -Skip 1)) { Remove-Item -LiteralPath (Assert-OwnedPath $old.FullName) -Force -ErrorAction Stop }
        return $path
    } finally {
        try {
            if ($null -ne $temporary -and (Test-Path -LiteralPath $temporary)) {
                Assert-RunnerProtectedPath $temporary
                Remove-Item -LiteralPath (Assert-OwnedPath $temporary) -Force -ErrorAction Stop
            }
        } finally { Exit-RunnerLock $mutex }
    }
}

function New-RunnerProfileVm([string] $Name, [string] $Disk, [string] $Instance, [string] $ProfileLabel) {
    $profile = Get-RunnerResourceProfile $ProfileLabel
    return New-VM -Name $Name -Generation 2 -VHDPath $Disk -Path $Instance -MemoryStartupBytes $profile.memoryBytes -SwitchName $script:RunnerSwitch
}

function Assert-RunnerVmResources([string] $Name, [string] $ProfileLabel) {
    $profile = Get-RunnerResourceProfile $ProfileLabel
    $memory = Get-VMMemory -VMName $Name -ErrorAction Stop
    if ($memory.Startup -ne $profile.memoryBytes -or $memory.DynamicMemoryEnabled -ne $false) { throw 'VM resource readback differs from the fixed selected profile.' }
}

function Invoke-RunnerSession($Config, $PilotAttempt = $null, [string] $ProfileLabel = '', [ValidateSet('job', 'prepare', 'verify-image')][string] $Purpose = 'job', $ImageCandidate = $null) {
    $preparing = $Purpose -cne 'job'
    if (($Purpose -ceq 'verify-image') -ne ($null -ne $ImageCandidate) -or ($preparing -and $null -ne $PilotAttempt)) { throw 'Image verification requires its explicit candidate and cannot carry a job claim.' }
    $profile = if ($preparing) { Get-RunnerResourceProfile 'it-inventory-heavy' } else { Get-RunnerSessionProfile $Config $ProfileLabel }
    $script:RunnerOperationStage = 'preflight'
    if ($preparing) { Assert-RunnerPreparationAuthorized; Assert-InstalledHost $Config -ForPreparation }
    else { Assert-InstalledHost $Config; [void](Get-OwnerToken) }
    $image = if ($Purpose -ceq 'verify-image') {
        $candidateReceipt = Assert-RunnerImageCandidate $ImageCandidate $Config
        [pscustomobject]@{ path = $ImageCandidate.path; prepared = $true }
    } elseif ($preparing) { [pscustomobject]@{ path = $Config.baseVhdx; prepared = $false } } else { Get-RunnerImageSelection $Config }
    $name = "$($script:RunnerPrefix)$([guid]::NewGuid().ToString('N'))"
    $script:RunnerSessionName = $name
    $instance = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'instances') $name)
    $state = [ordered]@{
        tag = $script:RunnerTag; vmName = $name; instancePath = $instance
        purpose = $Purpose; resourceLabel = $profile.label
        createdUtc = [DateTime]::UtcNow.ToString('o'); heartbeatUtc = [DateTime]::UtcNow.ToString('o')
        deadlineUtc = [DateTime]::UtcNow.AddMinutes($Config.maxMinutes).ToString('o')
        supervisorPid = $PID
        supervisorStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    }
    if ($Purpose -ceq 'verify-image') { $state.imageCandidate = [ordered]@{ id = $ImageCandidate.id; diskHash = $candidateReceipt.diskHash; bindingHash = $candidateReceipt.bindingHash; recipeId = $candidateReceipt.recipeId } }
    if (-not $preparing) { $state.claimMode = $Config.activation }
    $mutex = Enter-RunnerLock
    try {
        if ($preparing) { Assert-RunnerPreparationAuthorized; Assert-RunnerTransitionClear }
        else { Assert-RunnerClaimOpen }
        if (Get-RunnerState) { throw 'Another runner session is already recorded.' }
        if (-not $preparing -and $Config.activation -eq 'pilot') {
            if ($null -eq $PilotAttempt -or (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json'))) { throw 'Pilot claim requires a fresh bound receipt.' }
            $PilotAttempt | Add-Member -NotePropertyName sessionName -NotePropertyValue $name -Force
            $state.pilotClaim = Get-RunnerJsonEvidence $PilotAttempt
        }
        Write-RunnerJson $script:RunnerStatePath $state
        Invoke-RunnerTransitionCheckpoint 'claim-state'
        Complete-RunnerPilotClaim ([pscustomobject]$state)
        Invoke-RunnerTransitionCheckpoint 'claim-receipt'
    } finally { Exit-RunnerLock $mutex }
    $verificationReady = $false
    $sessionFailure = $null
    try {
        New-Item -ItemType Directory -Path $instance -Force | Out-Null
        $script:RunnerOperationStage = 'disk-copy'
        $disk = Join-Path $instance 'guest.vhdx'
        Copy-Item -LiteralPath $image.path -Destination $disk -ErrorAction Stop
        $script:RunnerOperationStage = 'key-generation'
        New-RunnerSshKey (Join-Path $instance 'id_ed25519')
        $key = (Get-Content -LiteralPath (Join-Path $instance 'id_ed25519.pub') -Raw).Trim()
        Assert-SessionAlive $state
        $mutex = Enter-RunnerLock
        try {
            $script:RunnerOperationStage = 'vm-creation'
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -ne $name) { throw 'Session removed before VM creation.' }
            $current | Add-Member -NotePropertyName phase -NotePropertyValue 'creating' -Force
            $current | Add-Member -NotePropertyName expectedBootDisk -NotePropertyValue $disk -Force
            $current | Add-Member -NotePropertyName expectedVmPath -NotePropertyValue (Join-Path $instance $name) -Force
            Write-RunnerJson $script:RunnerStatePath $current
            $vm = New-RunnerProfileVm $name $disk $instance $profile.label
            $current | Add-Member -NotePropertyName vmId -NotePropertyValue ([guid]$vm.Id).ToString() -Force
            Assert-StateIdentity $current
            Write-RunnerJson $script:RunnerStatePath $current
            Set-VM -Name $name -Notes $script:RunnerTag -AutomaticCheckpointsEnabled $false -CheckpointType Disabled -AutomaticStartAction Nothing -AutomaticStopAction TurnOff
            Assert-RunnerVmLifecycle $name
            if ((Get-VM -Name $name -ErrorAction Stop).Notes -ne $script:RunnerTag) { throw 'VM ownership tag readback failed.' }
            $current.phase = 'owned'
            Write-RunnerJson $script:RunnerStatePath $current
        } finally { Exit-RunnerLock $mutex }
        $script:RunnerOperationStage = 'vm-configuration'
        Set-VMProcessor -VMName $name -Count 4
        Set-VMMemory -VMName $name -DynamicMemoryEnabled $false
        Assert-RunnerVmResources $name $profile.label
        Set-VMFirmware -VMName $name -EnableSecureBoot On -SecureBootTemplate 'MicrosoftUEFICertificateAuthority'
        foreach ($service in @(Get-VMIntegrationService -VMName $name | Where-Object Name -Match 'Guest Service')) {
            Disable-VMIntegrationService -VMName $name -Name $service.Name
        }
        $guestMac = Set-RunnerGuestMac -VmName $name
        $mutex = Enter-RunnerLock
        try {
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -cne $name) { throw 'Session removed before guest MAC journaling.' }
            $current | Add-Member -NotePropertyName guestMac -NotePropertyValue $guestMac.rawMac -Force
            Write-RunnerJson $script:RunnerStatePath $current
        } finally { Exit-RunnerLock $mutex }
        $seed = Join-Path $instance 'cidata.vhdx'
        New-SeedDisk $seed $key $guestMac.seedMac $Config $profile.label $image.prepared
        Add-VMHardDiskDrive -VMName $name -Path $seed
        $script:RunnerOperationStage = 'network-isolation'
        $observation = Get-RunnerNetworkObservation # Probe IO outside mutex.
        $mutex = Enter-RunnerLock
        try {
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -cne $name -or
                (Test-RunnerSessionStopRequested $current) -or
                (Get-RunnerRecoveryNow) -ge [DateTime]::Parse($current.deadlineUtc).ToUniversalTime()) { throw 'Session removed/stopped before network isolation.' }
            $rules = @(Set-IsolatedAdapter $current $observation)
            $current | Add-Member networkFingerprint $observation.fingerprint -Force
            $current | Add-Member networkRules $rules -Force
            Write-RunnerJson $script:RunnerStatePath $current
            $state = [pscustomobject]$current # Freeze the verified VM/MAC identity for later supervisor checks.
        } finally { Exit-RunnerLock $mutex }
        Start-SessionGuardian $state
        Assert-RunnerGuestMac -VmName $name -ExpectedMac $guestMac.rawMac
        $script:RunnerOperationStage = 'vm-boot'
        Start-GuardedVm $state
        Assert-RunnerGuestMac -VmName $name -ExpectedMac $guestMac.rawMac
        $script:RunnerOperationStage = 'guest-readiness'
        $readinessWatch = [Diagnostics.Stopwatch]::StartNew()
        Wait-Guest $state $Config $profile.label
        Write-Host ('Guest prerequisites ready in {0:N1}s for {1}.' -f $readinessWatch.Elapsed.TotalSeconds, $profile.label)
        Assert-SessionAlive $state
        Assert-CurrentRunnerNetworkRules $state
        Test-GuestIsolation $state $Config

        if ($Purpose -ceq 'verify-image') {
            $script:RunnerOperationStage = 'image-clone-readiness'
            Assert-SessionAlive $state
            $verified = Get-RunnerState
            Assert-StateIdentity $verified
            if ($verified.purpose -cne 'verify-image' -or $verified.vmName -cne $state.vmName -or
                [guid]$verified.vmId -ne [guid]$vm.Id -or
                $verified.guardianReady -ne $true -or -not (Test-RunnerProcessIdentity $verified.guardianPid $verified.guardianStartUtc) -or
                $verified.imageCandidate.id -cne $ImageCandidate.id -or $verified.imageCandidate.diskHash -cne $candidateReceipt.diskHash) { throw 'Image verifier session binding changed.' }
            $verifiedVm = Get-VM -Id ([guid]$verified.vmId) -ErrorAction Stop
            if ($verifiedVm.Name -cne $verified.vmName -or $verifiedVm.State -cne 'Running' -or $verifiedVm.Notes -cne $script:RunnerTag -or
                [IO.Path]::GetFullPath($verifiedVm.Path) -ine (Join-Path $instance $verified.vmName)) { throw 'Image verifier VM identity changed after readiness.' }
            $verificationReady = $true
            Invoke-RunnerTransitionCheckpoint 'image-clone-ready'
            return [pscustomobject]@{ schema = 1; candidateId = $ImageCandidate.id; diskHash = $candidateReceipt.diskHash
                bindingHash = $candidateReceipt.bindingHash; recipeId = $candidateReceipt.recipeId; bundleHash = $candidateReceipt.bundleHash
                purpose = 'verify-image'; vmName = $verified.vmName; vmId = $verified.vmId; guestMac = $verified.guestMac
                networkFingerprint = $verified.networkFingerprint
                sshPublicKeyHash = (Get-FileHash -LiteralPath (Join-Path $instance 'id_ed25519.pub') -Algorithm SHA256).Hash
                readiness = 'cloud-init-and-runner-prerequisites'; readyUtc = [DateTime]::UtcNow.ToString('o'); readinessSeconds = $readinessWatch.Elapsed.TotalSeconds }
        }
        if ($preparing) {
            $script:RunnerOperationStage = 'image-preparation'
            return Invoke-RunnerImageBuild ([pscustomobject]$state) $Config
        }

        $script:RunnerOperationStage = 'runner-download'
        $archiveWatch = [Diagnostics.Stopwatch]::StartNew()
        $archive = Get-RunnerArchive $state
        $sshArgs = Get-SshArgs $state
        $script:RunnerOperationStage = 'runner-transfer'
        $exitCode = Invoke-RunnerNative 'scp.exe' ($sshArgs + @($archive, "runner@$($Config.guestIp):/home/runner/runner.tar.gz"))
        if ($exitCode -ne 0) { throw 'Runner archive transfer failed.' }
        $exitCode = Invoke-RunnerNative 'ssh.exe' ($sshArgs + @("runner@$($Config.guestIp)", 'mkdir -p ~/actions-runner && tar -xzf ~/runner.tar.gz -C ~/actions-runner && rm ~/runner.tar.gz'))
        if ($exitCode -ne 0) { throw 'Runner archive extraction failed.' }
        Write-Host ('Verified runner archive retrieval, transfer and extraction finished in {0:N1}s.' -f $archiveWatch.Elapsed.TotalSeconds)
        Assert-SessionAlive $state
        Assert-CurrentRunnerNetworkRules $state

        # The repository-scoped PAT remains on Windows. Only the one-job JIT value enters the guest.
        $token = Get-OwnerToken
        $parts = $Config.repo.Split('/')
        $script:RunnerOperationStage = 'jit-registration'
        Assert-RunnerGuestMac -VmName $name -ExpectedMac $guestMac.rawMac
        # Recovery may wait for the whole outage episode. Demand evidence must
        # be obtained after that wait, immediately before the one JIT intent.
        Assert-SessionAlive $state
        $admission = Get-RunnerJitAdmission $state
        if ($Config.activation -eq 'pilot') {
            $attempt = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json')
            $evidence = Get-PilotEvidence $Config $attempt $token
            if (-not (Test-QueuedRunnerJob $evidence.job $Config.pilotLabel)) { throw 'Bound pilot job is no longer queued before registration.' }
        } elseif ($null -eq (Get-QueuedRunnerJob $Config $token -SessionProfileLabel $profile.label)) {
            # Demand may have been canceled or taken during boot. The selected
            # profile must still be queued; another profile cannot divert this VM.
            $token = $null
            return [pscustomobject]@{ name = $name; id = $null; outcome = 'demand-withdrawn' }
        }
        $launchId = [guid]::NewGuid().ToString('N')
        [void](Save-RunnerLaunchEvent $state 'intent' 0 $launchId -Admission $admission -Config $Config)
        $jit = Invoke-GitHub "https://api.github.com/repos/$($parts[0])/$($parts[1])/actions/runners/generate-jitconfig" 'POST' @{
            name = $name; runner_group_id = $Config.runnerGroupId; labels = @(Get-RunnerJitLabels $Config $profile.label); work_folder = '_work'
        } $token
        $token = $null
        if ($jit.runner.name -cne $name -or $null -eq $jit.runner.id -or [string]$jit.runner.id -cnotmatch '^[1-9][0-9]*$') {
            throw 'GitHub returned an invalid or mismatched JIT runner configuration.'
        }
        $runnerId = [long]$jit.runner.id
        Assert-RunnerJitLabels $Config $jit.runner $profile.label
        [void](Save-RunnerLaunchEvent $state 'registered' $runnerId)
        if ($jit.encoded_jit_config -notmatch '^[A-Za-z0-9+/=]+$') { throw 'GitHub returned an invalid JIT runner configuration.' }
        Assert-SessionAlive $state
        Write-Host "JIT runner $name is waiting for one GitHub job. Hard deadline: $($state.deadlineUtc) UTC."
        # The fixed JIT runner launches exactly once in a guest service. SSH is
        # only dispatch/monitor transport; its loss never reruns the command.
        $script:RunnerOperationStage = 'job-execution'
        [void](Save-RunnerLaunchEvent $state 'dispatch')
        $command = Get-RunnerDetachedCommand $image.prepared $launchId $runnerId
        try {
            $exitCode = Invoke-RunnerNative 'ssh.exe' ($sshArgs + @("runner@$($Config.guestIp)", $command)) $jit.encoded_jit_config -TimeoutSeconds 15
            if ($exitCode -ne 0) { [void](Save-RunnerLaunchEvent $state 'transport-lost') }
        } catch { [void](Save-RunnerLaunchEvent $state 'transport-lost') }
        finally { $jit = $null }
        Wait-DetachedRunner $state $Config
        Write-Host 'Runner process ended; consult GitHub Actions for the actual job result.'
        return [pscustomobject]@{ name = $name; id = $runnerId; outcome = 'runner-exited' }
    } catch {
        $sessionFailure = $_
        throw
    } finally {
        $verificationFailure = $null
        if ($verificationReady) { try { Assert-SessionAlive $state } catch { $verificationFailure = $_ } }
        $mutex = Enter-RunnerLock
        try {
            $current = Get-RunnerState
            if ($verificationReady) {
                if ($null -eq $current -or $current.vmName -cne $name -or [guid]$current.vmId -ne [guid]$vm.Id) { throw 'Verifier ownership was cancelled before cleanup.' }
            }
            if ($null -ne $current -and $current.vmName -eq $name) {
                Write-RunnerSessionFailureObservation $current $sessionFailure
                if ($null -eq $sessionFailure) { Write-RunnerSessionFailureObservation $current $verificationFailure }
                Remove-RunnerInstance $current
            }
            if ($null -ne $verificationFailure) { throw $verificationFailure }
        } catch {
            Write-RunnerFailure 'cleanup' 'STAGE_FAILED' $name
            throw
        } finally { Exit-RunnerLock $mutex }
    }
}

function Get-PilotEvidence($Config, $Binding, [string] $Token) {
    Assert-PilotConfig $Config
    if ($null -eq $Binding) { throw 'Pilot receipt binding is missing.' }
    foreach ($field in @('jobId', 'runId', 'workflowId')) {
        if ($Binding.PSObject.Properties.Name -notcontains $field -or [string]$Binding.$field -notmatch '^[1-9][0-9]*$') {
            throw 'Pilot receipt API identity is invalid.'
        }
    }
    $base = "https://api.github.com/repos/$($Config.repo)/actions"
    $run = Invoke-GitHub "$base/runs/$($Binding.runId)" 'GET' $null $Token
    $workflow = Invoke-GitHub "$base/workflows/$($Binding.workflowId)" 'GET' $null $Token
    $job = Invoke-GitHub "$base/jobs/$($Binding.jobId)" 'GET' $null $Token
    if (-not (Test-PilotEvidence $Config $run $workflow $job $Binding)) { throw 'Fresh GitHub pilot workflow/run/SHA/job metadata does not match the recorded binding.' }
    return [pscustomobject]@{ run = $run; workflow = $workflow; job = $job }
}

function Get-QueuedRunnerJob($Config, [string] $Token, [decimal] $AvailableBytes = [decimal]::MaxValue, [string] $SessionProfileLabel = '') {
    $script:RunnerQueueObservation = @{}
    if ($SessionProfileLabel) { [void](Get-RunnerSessionProfile $Config $SessionProfileLabel) }
    $label = $Config.label
    if ($Config.activation -eq 'pilot') { Assert-PilotConfig $Config; $label = $Config.pilotLabel }
    $parts = $Config.repo.Split('/')
    $base = "https://api.github.com/repos/$($parts[0])/$($parts[1])/actions"
    foreach ($runStatus in @('queued', 'in_progress')) {
        $runs = Invoke-GitHub "$base/runs?status=$runStatus&per_page=100" 'GET' $null $Token
        if ($runs.total_count -gt 100) { throw 'Workflow run queue exceeds the bounded API view.' }
        foreach ($run in @($runs.workflow_runs)) {
            $workflow = $null
            if ($Config.activation -eq 'pilot') {
                if ($run.head_sha -cne $Config.pilotExpectedSha) { continue }
                $workflow = Invoke-GitHub "$base/workflows/$($run.workflow_id)" 'GET' $null $Token
                if ($workflow.path -cne $Config.pilotWorkflowPath) { continue }
            }
            $jobs = Invoke-GitHub "$base/runs/$($run.id)/jobs?filter=latest&per_page=100" 'GET' $null $Token
            if ($jobs.total_count -gt 100) { throw 'Workflow job queue exceeds the bounded API view.' }
            foreach ($job in @($jobs.jobs)) {
                $profile = Get-RunnerJobProfile $Config $job
                if ($null -eq $profile) { continue }
                if ($SessionProfileLabel -and $SessionProfileLabel -cne $profile.label) { continue }
                if (Test-QueuedRunnerJob $job $profile.label) {
                    if (-not $script:RunnerQueueObservation.ContainsKey($profile.label)) { $script:RunnerQueueObservation[$profile.label] = 0 }
                    $script:RunnerQueueObservation[$profile.label]++
                    if ($AvailableBytes -lt $profile.requiredBytes) { continue }
                    if ($Config.activation -eq 'pilot') {
                        if (-not (Test-PilotEvidence $Config $run $workflow $job)) { continue }
                        $job | Add-Member -NotePropertyName pilotBinding -NotePropertyValue ([pscustomobject]@{
                            jobId = $job.id; runId = $run.id; workflowId = $workflow.id; workflowPath = $workflow.path
                            headSha = $run.head_sha; runAttempt = $run.run_attempt; pilotLabel = $Config.pilotLabel
                        }) -Force
                        $fresh = Get-PilotEvidence $Config $job.pilotBinding $Token
                        if (-not (Test-QueuedRunnerJob $fresh.job $label)) { continue }
                    }
                    $job | Add-Member -NotePropertyName resourceLabel -NotePropertyValue $profile.label -Force
                    return $job
                }
            }
        }
    }
    return $null
}

function Assert-RunnerJitAbandoned($Record) {
    # Caller holds the state mutex. Owner death is never a substitute for
    # authoritative local cleanup; a late POST reply cannot regain this state.
    $current = Get-RunnerState
    if ($null -ne $current) {
        Assert-StateIdentity $current
        if ($current.vmName -ceq $Record.vmName -or
            ($current.PSObject.Properties.Name -contains 'vmId' -and [guid]$current.vmId -eq [guid]$Record.vmId) -or
            $current.instancePath -ieq $Record.instancePath) { throw 'Original JIT session is still recorded.' }
    }
    $matching = @(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $Record.vmName -or [guid]$_.Id -eq [guid]$Record.vmId })
    if ($matching.Count -ne 0) { throw 'Original JIT VM cleanup is not authoritative.' }
    Assert-RunnerInstanceUnreferenced $Record
}

function Assert-RunnerJitReconciliation($Expected, $Config) {
    $current = Get-RunnerJitRegistration
    if ($null -eq $current -or (Get-RunnerJsonEvidence $current).hash -cne (Get-RunnerJsonEvidence $Expected).hash -or
        $current.repo -cne $Config.repo -or (Get-RunnerConfig).repo -cne $Config.repo -or $current.phase -cnotin @('intent', 'registered', 'handed-off', 'removal-intent') -or
        (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) { throw 'JIT reconciliation operation, repository or Stop changed.' }
    Assert-RunnerJitAbandoned $current
    return $current
}

function Get-RunnerJitInventory($Record, [string] $Token) {
    # One complete bounded repository snapshot. 404/transport errors never
    # stand in for absence, and a truncated first page is not authoritative.
    $response = Invoke-GitHub "https://api.github.com/repos/$($Record.repo)/actions/runners?per_page=100" 'GET' $null $Token
    if ($null -eq $response -or [string]$response.total_count -cnotmatch '^(0|[1-9][0-9]*)$' -or
        $response.total_count -gt 100 -or @($response.runners).Count -ne $response.total_count) { throw 'JIT runner inventory is incomplete.' }
    $seen = @{}
    foreach ($runner in @($response.runners)) {
        if ([string]$runner.id -cnotmatch '^[1-9][0-9]*$' -or $seen.ContainsKey([string]$runner.id) -or
            [string]::IsNullOrEmpty($runner.name) -or $runner.status -cnotin @('offline', 'online') -or $runner.busy -isnot [bool]) { throw 'JIT runner inventory identity is invalid.' }
        $seen[[string]$runner.id] = $true
    }
    return @($response.runners)
}

function Invoke-RunnerJitReconciliation($Config) {
    $stage = 'evidence'; $token = $null
    try {
        $mutex = Enter-RunnerLock
        try {
            $record = Get-RunnerJitRegistration
            if ($null -eq $record -or $record.phase -ceq 'complete') { return $true }
            [void](Assert-RunnerJitReconciliation $record $Config)
        } finally { Exit-RunnerLock $mutex }
        $stage = 'transport'; $token = Get-OwnerToken
        $inventory = @(Get-RunnerJitInventory $record $token); $stage = 'evidence'
        $byName = @($inventory | Where-Object { $_.name -ceq $record.vmName })
        $byId = @($inventory | Where-Object { $_.id -eq $record.runnerId })
        if ($record.phase -cin @('handed-off', 'removal-intent') -and $record.runnerId -gt 0 -and $byId.Count -eq 0 -and $byName.Count -eq 0) {
            # Known handoff/DELETE identities retire only after authoritative
            # local abandonment and a complete remote ID/name absence snapshot.
            $mutex = Enter-RunnerLock
            try { $record = Assert-RunnerJitReconciliation $record $Config; $record.phase = 'complete'; Write-RunnerJitRegistration $record }
            finally { Exit-RunnerLock $mutex }
            Write-Host 'JIT registration retirement completed.'
            return $true
        }
        $runner = Assert-RunnerJitRetirementEligible $record $inventory
        $mutex = Enter-RunnerLock
        try {
            $record = Assert-RunnerJitReconciliation $record $Config
            $record.runnerId = [long]$runner.id; $record.phase = 'removal-intent'
            Write-RunnerJitRegistration $record
        } finally { Exit-RunnerLock $mutex }
        # Local proof/provider work may be slow. Refresh remote eligibility for
        # the persisted exact ID immediately before final local admission.
        $stage = 'transport'
        $inventory = @(Get-RunnerJitInventory $record $token); $stage = 'evidence'
        [void](Assert-RunnerJitRetirementEligible $record $inventory)
        # Native/API IO stays outside the state mutex. The supervisor lifetime
        # mutex owns this bounded operation; the unresolved claim stays shut.
        $mutex = Enter-RunnerLock
        try { [void](Assert-RunnerJitReconciliation $record $Config) }
        finally { Exit-RunnerLock $mutex }
        $stage = 'transport'
        [void](Invoke-GitHub "https://api.github.com/repos/$($record.repo)/actions/runners/$($record.runnerId)" 'DELETE' $null $token)
        $inventory = @(Get-RunnerJitInventory $record $token); $stage = 'evidence'
        if (@($inventory | Where-Object { $_.id -eq $record.runnerId -or $_.name -ceq $record.vmName }).Count -ne 0) { throw 'JIT retirement absence is not authoritative.' }
        $mutex = Enter-RunnerLock
        try { $record = Assert-RunnerJitReconciliation $record $Config; $record.phase = 'complete'; Write-RunnerJitRegistration $record }
        finally { Exit-RunnerLock $mutex }
        Write-Host 'JIT registration retirement completed.'
        return $true
    } catch {
        # No API exception, PAT or JIT configuration is persisted or printed.
        Write-Host "JIT registration reconciliation blocked: $stage. New claims remain refused."
        return $false
    } finally { $token = $null }
}

function Assert-RunnerJitRetirementEligible($Record, $Inventory) {
    $byName = @($Inventory | Where-Object { $_.name -ceq $Record.vmName })
    $byId = @($Inventory | Where-Object { $_.id -eq $Record.runnerId })
    if ($byName.Count -ne 1 -or ($Record.runnerId -gt 0 -and ($byId.Count -ne 1 -or $byId[0].id -ne $byName[0].id))) { throw 'JIT runner identity is absent or ambiguous; late registration remains possible.' }
    $runner = $byName[0]
    $labels = @($runner.labels | ForEach-Object { $_.name })
    if ($runner.status -cne 'offline' -or $runner.busy -ne $false -or $labels.Count -ne @($Record.labels).Count -or
        @($labels | Select-Object -Unique).Count -ne $labels.Count -or
        (($labels | Sort-Object) -join ',') -cne (($Record.labels | Sort-Object) -join ',')) { throw 'JIT runner is active, busy or has different labels.' }
    return $runner
}

function Invoke-Supervisor {
    Assert-Administrator
    Assert-SecureRoot
    Assert-RunnerTransitionClear
    # One process owns recovery and pickup, including boot and manual starts.
    $supervisorMutex = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1'
    try {
        $mutex = Enter-RunnerLock
        try { $stale = Get-RunnerState; if ($null -ne $stale) { Remove-RunnerInstance $stale } }
        finally { Exit-RunnerLock $mutex }
        Invoke-SupervisorLoop
    } finally { Exit-RunnerLock $supervisorMutex }
}

function Get-RunnerMemoryAdmission([string] $ProfileLabel = 'it-inventory-ephemeral') {
    # CIM reports KiB. Reject missing, ambiguous or inconsistent inspection data.
    try { $systems = @(Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 10 -ErrorAction Stop) }
    catch { throw 'Available physical memory inspection failed.' }
    if ($systems.Count -ne 1) { throw 'Available physical memory inspection is invalid.' }
    $free = [uint64]0; $total = [uint64]0
    $names = @($systems[0].PSObject.Properties.Name)
    if ($names -notcontains 'FreePhysicalMemory' -or $names -notcontains 'TotalVisibleMemorySize' -or
        -not [uint64]::TryParse([string]$systems[0].FreePhysicalMemory, [ref]$free) -or
        -not [uint64]::TryParse([string]$systems[0].TotalVisibleMemorySize, [ref]$total) -or
        $total -eq 0 -or $free -gt $total) { throw 'Available physical memory inspection is invalid.' }
    $profile = Get-RunnerResourceProfile $ProfileLabel
    $availableBytes = [decimal]$free * 1024
    return [pscustomobject]@{ ready = ($availableBytes -ge $profile.requiredBytes); requiredBytes = $profile.requiredBytes; availableBytes = $availableBytes }
}

function Get-RunnerCapacityReport($Config, [decimal] $AvailableBytes, $QueuedProfiles = $null) {
    $labels = if ($Config.activation -ceq 'pilot') { @($Config.pilotLabel) } else {
        @('it-inventory-light', 'it-inventory-mid', 'it-inventory-heavy', 'it-inventory-ephemeral')
    }
    foreach ($label in $labels) {
        $profile = Get-RunnerResourceProfile $label
        $queued = if ($null -eq $QueuedProfiles) { $null } elseif ($QueuedProfiles.ContainsKey($label)) { $QueuedProfiles[$label] } else { 0 }
        [pscustomobject]@{
            label = $label; memoryBytes = $profile.memoryBytes; hostReserveBytes = $profile.hostReserveBytes
            requiredBytes = $profile.requiredBytes; ready = ($AvailableBytes -ge $profile.requiredBytes); observedQueued = $queued
        }
    }
}

function Write-RunnerObservation([ValidateSet('waiting-capacity', 'idle', 'session-starting', 'inspection-failed')][string] $Outcome,
    $Config, $AvailableBytes = $null, $QueuedProfiles = $null) {
    # A poll timestamp is not a job heartbeat: SSH may block for a whole one-job session.
    $profiles = if ($null -eq $AvailableBytes) { @() } else { @(Get-RunnerCapacityReport $Config $AvailableBytes $QueuedProfiles) }
    Write-RunnerJson (Assert-OwnedPath (Join-Path $script:RunnerRoot 'controller-observation.json')) ([ordered]@{
        schema = 1; tag = $script:RunnerTag; observedUtc = [DateTime]::UtcNow.ToString('o')
        supervisorPid = $PID; outcome = $Outcome; availableBytes = $AvailableBytes; profiles = $profiles
    })
}

function Show-RunnerCapacityStatus($Config) {
    try {
        $admission = Get-RunnerMemoryAdmission 'it-inventory-light'
        Write-Host ('Capacity now: {0:N2} GiB available physical memory.' -f ($admission.availableBytes / 1GB))
        foreach ($profile in @(Get-RunnerCapacityReport $Config $admission.availableBytes)) {
            $eligibility = if ($profile.ready) { 'fits' } else { 'waiting for capacity' }
            Write-Host ("{0}: {1} GiB guest + {2} GiB host reserve = {3} GiB admission; {4}." -f
                $profile.label, ($profile.memoryBytes / 1GB), ($profile.hostReserveBytes / 1GB), ($profile.requiredBytes / 1GB), $eligibility)
        }
    } catch { Write-Host 'Capacity: physical memory inspection unavailable; pickup refuses work.' }
    try {
        $observation = Read-RunnerJson (Assert-OwnedPath (Join-Path $script:RunnerRoot 'controller-observation.json'))
        if ($null -ne $observation) {
            if ($observation.schema -ne 1 -or $observation.tag -cne $script:RunnerTag -or
                $observation.outcome -cnotin @('waiting-capacity','idle','session-starting','inspection-failed')) { throw 'Invalid observation.' }
            $age = [Math]::Max(0, ([DateTime]::UtcNow - [DateTime]::Parse($observation.observedUtc).ToUniversalTime()).TotalSeconds)
            Write-Host ('Last controller poll: {0}; {1}; {2:N0}s ago. A poll timestamp does not establish job/process health.' -f $observation.observedUtc, $observation.outcome, $age)
            foreach ($profile in @($observation.profiles)) {
                if ($null -ne $profile.observedQueued -and $profile.observedQueued -gt 0) {
                    [void](Get-RunnerResourceProfile $profile.label)
                    Write-Host ("Observed queued {0}: {1}; capacity at that poll: {2}." -f $profile.label, $profile.observedQueued, $(if ($profile.ready) { 'fits' } else { 'blocked' }))
                }
            }
        }
    } catch { Write-Host 'Last controller poll: observation unavailable or invalid.' }
}

function Show-RunnerSessionResources($State, $Vm) {
    try {
        Assert-StateIdentity $State
        $expectedPath = Assert-OwnedPath (Join-Path $State.instancePath $State.vmName)
        if ($null -eq $Vm -or $Vm.Name -cne $State.vmName -or $Vm.Notes -cne $script:RunnerTag -or
            -not [string]::Equals([IO.Path]::GetFullPath($Vm.Path), $expectedPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'VM ownership readback failed.' }
        $label = if ($State.PSObject.Properties.Name -contains 'resourceLabel') { $State.resourceLabel } else { 'it-inventory-ephemeral' }
        $profile = Get-RunnerResourceProfile $label
        $memory = Get-VMMemory -VMName $State.vmName -ErrorAction Stop
        Write-Host ('Session resources: {0}; startup memory {1:N2} GiB; dynamic memory {2}; expected fixed guest {3} GiB.' -f
            $label, ($memory.Startup / 1GB), $memory.DynamicMemoryEnabled, ($profile.memoryBytes / 1GB))
        if ($memory.Startup -ne $profile.memoryBytes -or $memory.DynamicMemoryEnabled) { Write-Host 'Session resources differ from the current fixed profile; this is not candidate allocation proof.' }
    } catch { Write-Host 'Session resource readback unavailable or VM ownership is unverified.' }
}

function Invoke-SupervisorLoop {
    while (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) {
        Assert-RunnerTransitionClear
        $config = Get-RunnerConfig
        if ($config.activation -notin @('pilot', 'active')) {
            Start-Sleep -Seconds 30
            continue
        }
        $pilotAttemptPath = Join-Path $script:RunnerRoot 'pilot-attempt.json'
        if (Get-RunnerState) { return } # A failed initial claim/cleanup requires recovery before further queue inspection.
        if (-not (Invoke-RunnerJitReconciliation $config)) { Start-Sleep -Seconds 30; continue }
        if ($config.activation -eq 'pilot' -and (Test-Path -LiteralPath $pilotAttemptPath)) {
            # A crashed or restarted supervisor must not take a second pilot job.
            return
        }
        try {
            $completedSession = $false
            $script:RunnerQueueObservation = $null
            $script:RunnerSessionName = $null
            $script:RunnerOperationStage = 'memory-admission'
            $initialLabel = if ($config.activation -eq 'pilot') { $config.pilotLabel } else { 'it-inventory-light' }
            $admission = Get-RunnerMemoryAdmission $initialLabel
            if (-not $admission.ready) {
                Write-RunnerObservation 'waiting-capacity' $config $admission.availableBytes
                Start-Sleep -Seconds 30
                continue
            }
            $script:RunnerOperationStage = 'queue-inspection'
            $token = Get-OwnerToken
            $job = Get-QueuedRunnerJob $config $token $admission.availableBytes
            $pollOutcome = if ($null -ne $job) { 'session-starting' } elseif ($null -ne $script:RunnerQueueObservation -and $script:RunnerQueueObservation.Count -gt 0) { 'waiting-capacity' } else { 'idle' }
            Write-RunnerObservation $pollOutcome $config $admission.availableBytes $script:RunnerQueueObservation
            if ($null -ne $job) {
                if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
                Assert-RunnerTransitionClear
                $script:RunnerOperationStage = 'memory-admission'
                $profile = Get-RunnerJobProfile $config $job
                if ($null -eq $profile) { throw 'Selected runner job has unsupported resource labels.' }
                $selectedAdmission = Get-RunnerMemoryAdmission $profile.label
                if (-not $selectedAdmission.ready) {
                    Write-RunnerObservation 'waiting-capacity' $config $selectedAdmission.availableBytes $script:RunnerQueueObservation
                    Start-Sleep -Seconds 30
                    continue
                }
                if ($config.activation -eq 'pilot') {
                    $script:RunnerOperationStage = 'pilot-consumption'
                    $fresh = Get-PilotEvidence $config $job.pilotBinding $token
                    if (-not (Test-QueuedRunnerJob $fresh.job $config.pilotLabel)) { throw 'Bound pilot job changed before consumption.' }
                    $pilotAttempt = [pscustomobject][ordered]@{
                        tag = $script:RunnerTag; jobId = $job.id
                        runId = $job.pilotBinding.runId; workflowId = $job.pilotBinding.workflowId
                        workflowPath = $job.pilotBinding.workflowPath; headSha = $job.pilotBinding.headSha
                        runAttempt = $job.pilotBinding.runAttempt; pilotLabel = $job.pilotBinding.pilotLabel
                        consumedUtc = [DateTime]::UtcNow.ToString('o')
                    }
                } else { $pilotAttempt = $null }
                $token = $null
                $allocatedRunner = Invoke-RunnerSession $config $pilotAttempt $profile.label
                $completedSession = $allocatedRunner.PSObject.Properties.Name -contains 'outcome' -and $allocatedRunner.outcome -ceq 'runner-exited'
                if ($config.activation -eq 'pilot') {
                    $script:RunnerOperationStage = 'pilot-verification'
                    $token = Get-OwnerToken
                    $parts = $config.repo.Split('/')
                    $result = $null
                    $limit = [DateTime]::UtcNow.AddSeconds(60)
                    do {
                        $fresh = Get-PilotEvidence $config $job.pilotBinding $token
                        $result = $fresh.job
                        if ($result.status -eq 'completed') { break }
                        Start-Sleep -Seconds 5
                    } while ([DateTime]::UtcNow -lt $limit)
                    $token = $null
                    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json') ([ordered]@{
                        tag = $script:RunnerTag; jobId = $job.id; status = $result.status
                        runId = $job.pilotBinding.runId; workflowId = $job.pilotBinding.workflowId
                        workflowPath = $job.pilotBinding.workflowPath; headSha = $job.pilotBinding.headSha
                        runAttempt = $job.pilotBinding.runAttempt; pilotLabel = $job.pilotBinding.pilotLabel
                        conclusion = $result.conclusion; runnerName = $result.runner_name
                        runnerId = $result.runner_id; allocatedRunnerName = $allocatedRunner.name
                        allocatedRunnerId = $allocatedRunner.id
                        verified = [bool](Test-PilotJobResult $result $allocatedRunner.name $allocatedRunner.id)
                        checkedUtc = [DateTime]::UtcNow.ToString('o')
                    })
                    return
                }
            }
        } catch {
            # The next bounded poll may retry inspection. An unresolved durable
            # registration barrier refuses a new JIT after API/guest failure.
            $completedSession = $false
            $existing = Read-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json')
            if ($null -eq $existing -or $null -eq $script:RunnerSessionName -or $existing.sessionName -cne $script:RunnerSessionName) {
                Write-RunnerFailure $script:RunnerOperationStage 'STAGE_FAILED' $script:RunnerSessionName
            }
            Write-EventLog -LogName Application -Source 'Windows PowerShell' -EntryType Error -EventId 500 -Message "IT Inventory runner stage failed: $script:RunnerOperationStage" -ErrorAction SilentlyContinue
            Write-RunnerObservation 'inspection-failed' $config
        } finally { $token = $null }
        if ($completedSession) { continue } # Session's finally completed owned cleanup.
        Start-Sleep -Seconds 30
    }
}

function Stop-SupervisorCore {
    Assert-Administrator
    Assert-SecureRoot
    $claimLock = Enter-RunnerLock
    try { Write-RunnerBytes (Join-Path $script:RunnerRoot 'stop.requested') ([Text.Encoding]::UTF8.GetBytes('stop')) }
    finally { Exit-RunnerLock $claimLock }
    $task = Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction SilentlyContinue
    if ($null -ne $task -and $task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $script:RunnerSupervisorTask
        $limit = [DateTime]::UtcNow.AddSeconds(30)
        while ((Get-ScheduledTask -TaskName $script:RunnerSupervisorTask).State -eq 'Running') {
            if ([DateTime]::UtcNow -ge $limit) { throw 'Supervisor task did not stop in 30 seconds.' }
            Start-Sleep -Seconds 1
        }
    }
    $mutex = Enter-RunnerLock
    try { $state = Get-RunnerState; if ($null -ne $state) { Remove-RunnerInstance $state } }
    finally { Exit-RunnerLock $mutex }
}

function Complete-PilotRetry($Plan) {
    Assert-RunnerJitRegistrationClear
    if ($Plan.tag -cne $script:RunnerTag -or $Plan.retryId -cnotmatch '^[0-9a-f]{32}$' -or $Plan.phase -cne 'pending') {
        throw 'Retry journal identity/phase is invalid.'
    }
    $expectedDisabled = Get-RunnerEvidenceValue $Plan.sources.'config.json'
    $expectedTarget = Get-RunnerEvidenceValue $Plan.sources.'config.json'
    $expectedDisabled.activation = 'disabled'
    $expectedTarget | Add-Member -NotePropertyName pilotExpectedSha -NotePropertyValue $Plan.nextSha -Force
    $expectedTarget | Add-Member -NotePropertyName pilotWorkflowPath -NotePropertyValue '.github/workflows/local-runner-pilot.yml' -Force
    $expectedTarget | Add-Member -NotePropertyName pilotLabel -NotePropertyValue (Get-PilotLabel $Plan.nextSha) -Force
    $expectedTarget.activation = 'pilot'
    $expectedArchive = Get-RunnerJsonEvidence ([ordered]@{ tag = $script:RunnerTag; retryId = $Plan.retryId; reason = $Plan.reason; nextSha = $Plan.nextSha; sources = $Plan.sources })
    if ($Plan.disabledConfig.hash -cne (Get-RunnerJsonEvidence $expectedDisabled).hash -or
        $Plan.targetConfig.hash -cne (Get-RunnerJsonEvidence $expectedTarget).hash -or $Plan.archive.hash -cne $expectedArchive.hash) {
        throw 'Retry journal does not encode the exact authorized source/archive/target transition.'
    }
    $archivePath = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'pilot-history') ($Plan.retryId + '.json'))
    $configPath = $script:RunnerConfigPath
    foreach ($name in @('pilot-attempt.json', 'pilot-result.json', 'last-error.json')) {
        $path = Assert-OwnedPath (Join-Path $script:RunnerRoot $name)
        $source = $Plan.sources.$name
        [void](Get-RunnerEvidenceValue $source)
        $absent = -not (Test-Path -LiteralPath $path)
        if (-not (Test-RunnerEvidence $path $source) -and -not ($name -ne 'last-error.json' -and $source.exists -and $absent)) {
            throw 'Retry evidence changed unexpectedly; no receipt/config overwrite is permitted.'
        }
    }
    $old = $Plan.sources.'config.json'; $disabled = $Plan.disabledConfig; $target = $Plan.targetConfig
    if (-not (Test-RunnerEvidence $configPath $old) -and -not (Test-RunnerEvidence $configPath $disabled) -and
        -not (Test-RunnerEvidence $configPath $target)) { throw 'Retry config differs from recorded old/intermediate/target state.' }
    if (Test-Path -LiteralPath $archivePath) {
        if (-not (Test-RunnerEvidence $archivePath $Plan.archive)) { throw 'Retry archive changed; refusing resume.' }
    } else { Write-RunnerEvidence $archivePath $Plan.archive }
    Invoke-RunnerTransitionCheckpoint 'retry-archive'
    if (-not (Test-RunnerEvidence $configPath $target)) {
        Write-RunnerEvidence $configPath $disabled
        Invoke-RunnerTransitionCheckpoint 'retry-disabled'
        foreach ($name in @('pilot-attempt.json', 'pilot-result.json')) {
            $path = Assert-OwnedPath (Join-Path $script:RunnerRoot $name)
            if (Test-Path -LiteralPath $path) {
                if (-not (Test-RunnerEvidence $path $Plan.sources.$name)) { throw 'Retry receipt changed before removal.' }
                Remove-Item -LiteralPath $path -ErrorAction Stop
            }
            Invoke-RunnerTransitionCheckpoint ('retry-remove-' + $name)
        }
        Write-RunnerEvidence $configPath $target
        Invoke-RunnerTransitionCheckpoint 'retry-target'
    } elseif ((Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) -or
        (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-result.json'))) {
        throw 'Target retry config has unexpected remaining receipts; refusing adoption.'
    }
    Invoke-RunnerTransitionCheckpoint 'retry-before-complete'
    $Plan.phase = 'complete'
    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json') $Plan
    Invoke-RunnerTransitionCheckpoint 'retry-complete'
}

function Enable-RunnerPilotCore([string] $Sha, [string] $Reason = '', [switch] $Retry) {
    Assert-Administrator
    Assert-SecureRoot
    $label = Get-PilotLabel $Sha
    if ($Retry -and ([string]::IsNullOrWhiteSpace($Reason) -or $Reason.Length -gt 256 -or $Reason -match '[\x00-\x1f\x7f]')) {
        throw 'Maintainer retry requires a short nonsecret investigation reason (1-256 characters, one line).'
    }
    # The same lifetime lock excludes both manual and boot supervisor startup.
    $supervisorLock = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1'
    try {
        $mutex = Enter-RunnerLock
        try {
            $config = Get-RunnerConfig
            [void](Get-OwnerToken)
            Assert-RunnerControlIdle
            Assert-RunnerJitRegistrationClear
            foreach ($name in @('update-journal.json', 'setup-publication.json')) {
                $update = Read-RunnerJson (Join-Path $script:RunnerRoot $name)
                if ($null -ne $update -and ($update.tag -cne $script:RunnerTag -or $update.phase -cne 'complete')) { throw 'Resume the pending setup/update before pilot control.' }
            }
            $journalPath = Join-Path $script:RunnerRoot 'pilot-retry.json'
            $plan = Read-RunnerJson $journalPath
            if ($null -ne $plan) {
                if ($plan.tag -cne $script:RunnerTag -or $plan.phase -cnotin @('pending', 'complete')) { throw 'Retry journal is invalid.' }
                if ($plan.phase -ceq 'pending') {
                    if (-not $Retry -or $plan.nextSha -cne $Sha -or $plan.reason -cne $Reason) { throw 'Pending retry requires identical recorded SHA/reason via RetryPilot.' }
                    Complete-PilotRetry $plan
                    Write-Host 'Recorded maintainer retry completed. Pickup remains stopped.'
                    return
                }
                if ($Retry -and $plan.nextSha -ceq $Sha -and $plan.reason -ceq $Reason) {
                    if (-not (Test-RunnerEvidence $script:RunnerConfigPath $plan.targetConfig)) { throw 'Completed retry replay does not match current target config.' }
                    Write-Host 'Maintainer retry already completed; no evidence or pickup changed.'
                    return
                }
            }
            $attemptPath = Join-Path $script:RunnerRoot 'pilot-attempt.json'
            $resultPath = Join-Path $script:RunnerRoot 'pilot-result.json'
            $attempt = Read-RunnerJson $attemptPath
            $result = Read-RunnerJson $resultPath
            if ($Retry) {
                if ($config.activation -ne 'pilot' -or $null -eq $attempt -or $attempt.tag -ne $script:RunnerTag -or
                    $attempt.jobId -le 0 -or ($null -ne $result -and $result.verified -eq $true)) {
                    throw 'Maintainer retry requires a consumed unsuccessful pilot; successful proof cannot be reset.'
                }
                if ($config.PSObject.Properties.Name -contains 'pilotExpectedSha' -and $config.pilotExpectedSha -ceq $Sha) {
                    throw 'Maintainer retry must target a new reviewed SHA.'
                }
                $history = Assert-OwnedPath (Join-Path $script:RunnerRoot 'pilot-history')
                [void][IO.Directory]::CreateDirectory($history)
                if ($null -ne $plan) {
                    $priorPath = Join-Path $history ($plan.retryId + '.journal.json')
                    $prior = Get-RunnerFileEvidence $journalPath
                    if (Test-Path -LiteralPath $priorPath) {
                        if (-not (Test-RunnerEvidence $priorPath $prior)) { throw 'Previous completed retry journal archive differs.' }
                    } else { Write-RunnerEvidence $priorPath $prior }
                }
                $sources = [ordered]@{}
                foreach ($name in @('config.json', 'pilot-attempt.json', 'pilot-result.json', 'last-error.json')) {
                    $sources[$name] = Get-RunnerFileEvidence (Join-Path $script:RunnerRoot $name)
                }
                $disabledConfig = Get-RunnerEvidenceValue $sources.'config.json'
                $disabledConfig.activation = 'disabled'
                $targetConfig = Get-RunnerEvidenceValue $sources.'config.json'
                $targetConfig | Add-Member -NotePropertyName pilotExpectedSha -NotePropertyValue $Sha -Force
                $targetConfig | Add-Member -NotePropertyName pilotWorkflowPath -NotePropertyValue '.github/workflows/local-runner-pilot.yml' -Force
                $targetConfig | Add-Member -NotePropertyName pilotLabel -NotePropertyValue $label -Force
                $targetConfig.activation = 'pilot'
                $retryId = [guid]::NewGuid().ToString('N')
                $archive = Get-RunnerJsonEvidence ([ordered]@{ tag = $script:RunnerTag; retryId = $retryId; reason = $Reason; nextSha = $Sha; sources = $sources })
                $plan = [pscustomobject]@{
                    tag = $script:RunnerTag; retryId = $retryId; phase = 'pending'; nextSha = $Sha; reason = $Reason
                    sources = [pscustomobject]$sources; disabledConfig = Get-RunnerJsonEvidence $disabledConfig
                    targetConfig = Get-RunnerJsonEvidence $targetConfig; archive = $archive
                }
                Write-RunnerJson $journalPath $plan
                Invoke-RunnerTransitionCheckpoint 'retry-pending'
                Complete-PilotRetry $plan
                Write-Host 'Maintainer retry evidence retained and new bound pilot configured. Pickup remains stopped.'
                return
            } elseif ($config.activation -ne 'disabled' -or $null -ne $attempt -or $null -ne $result -or $null -ne $plan -or
                @(Get-ChildItem -LiteralPath (Join-Path $script:RunnerRoot 'pilot-history') -ErrorAction SilentlyContinue).Count -gt 0) {
                throw 'Initial pilot requires disabled activation and no previous receipt; use a reviewed maintainer retry after investigation.'
            }
            $config | Add-Member -NotePropertyName pilotExpectedSha -NotePropertyValue $Sha -Force
            $config | Add-Member -NotePropertyName pilotWorkflowPath -NotePropertyValue '.github/workflows/local-runner-pilot.yml' -Force
            $config | Add-Member -NotePropertyName pilotLabel -NotePropertyValue $label -Force
            $config.activation = 'pilot'
            Write-RunnerJson $script:RunnerConfigPath $config
            Write-Host "One-job pilot enabled for SHA $Sha; label $label. Start remains an explicit action."
        } finally { Exit-RunnerLock $mutex }
    } finally { Exit-RunnerLock $supervisorLock }
}

function Enable-RunnerActiveCore {
    Assert-Administrator
    Assert-SecureRoot
    Assert-RunnerTransitionClear
    $mutex = Enter-RunnerLock
    try {
        Assert-RunnerJitRegistrationClear
        $config = Get-RunnerConfig
        Assert-PilotConfig $config
        $result = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json')
        $attempt = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json')
        if ($config.activation -ne 'pilot' -or $null -eq $attempt -or $attempt.tag -ne $script:RunnerTag -or
            $null -eq $result -or $result.tag -ne $script:RunnerTag -or $result.jobId -ne $attempt.jobId -or
            $result.verified -ne $true -or $result.status -ne 'completed' -or $result.conclusion -ne 'success' -or
            $result.runnerName -cne $result.allocatedRunnerName -or $result.runnerId -ne $result.allocatedRunnerId) {
            throw 'A successful bound pilot job is required before persistent pickup.'
        }
        $token = Get-OwnerToken
        $evidence = Get-PilotEvidence $config $attempt $token
        $token = $null
        if (-not (Test-PilotEvidence $config $evidence.run $evidence.workflow $evidence.job $result) -or
            -not (Test-PilotJobResult $evidence.job $result.allocatedRunnerName $result.allocatedRunnerId)) {
            throw 'Fresh GitHub pilot proof differs from recorded successful workflow/SHA/runner evidence.'
        }
        $config.activation = 'active'
        Write-RunnerJson $script:RunnerConfigPath $config
        Write-Host 'Persistent job pickup enabled. Start the supervisor shortcut.'
    } finally { Exit-RunnerLock $mutex }
}

function Stop-Supervisor { Invoke-RunnerControl { Assert-RunnerTransitionClear; Stop-SupervisorCore } }
function Enable-RunnerPilot([string] $Sha, [string] $Reason = '', [switch] $Retry) {
    Invoke-RunnerControl { Enable-RunnerPilotCore $Sha $Reason -Retry:$Retry }
}
function Enable-RunnerActive { Invoke-RunnerControl { Enable-RunnerActiveCore } }

function Start-RunnerSupervisorCore {
    Assert-Administrator
    Assert-SecureRoot
    $mutex = Enter-RunnerLock
    try {
        Assert-RunnerTransitionClear
        [void](Get-RunnerJitRegistration) # Validate before explicit Start clears Stop.
        $config = Get-RunnerConfig
        if ($config.activation -eq 'disabled') { throw 'Job pickup is disabled. Open Setup and choose Enable one-job pilot after review.' }
        $marker = Assert-OwnedPath (Join-Path $script:RunnerRoot 'stop.requested')
        if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
        Assert-RunnerControllerOpen
        Start-ScheduledTask -TaskName $script:RunnerSupervisorTask
    } finally { Exit-RunnerLock $mutex }
    Write-Host 'Persistent SYSTEM supervisor started; it waits for a matching queued job.'
}

function Invoke-Watchdog {
    Assert-Administrator
    Assert-SecureRoot
    $mutex = Enter-RunnerLock
    try {
        $state = Get-RunnerState
        if ($null -ne $state) {
            Assert-StateIdentity $state
            $deadline = [DateTime]::Parse($state.deadlineUtc).ToUniversalTime()
            $ownerAlive = Test-RunnerProcessIdentity $state.supervisorPid $state.supervisorStartUtc
            # Readiness becomes false during recovery; an established guardian
            # must still be alive then. Only setup without any recorded identity
            # has initialization grace. Partial identity is not that exemption.
            $guardianRecorded = $state.PSObject.Properties.Name -contains 'guardianPid' -or $state.PSObject.Properties.Name -contains 'guardianStartUtc'
            $guardianDead = $guardianRecorded -and ($state.PSObject.Properties.Name -notcontains 'guardianPid' -or
                $state.PSObject.Properties.Name -notcontains 'guardianStartUtc' -or -not (Test-RunnerProcessIdentity $state.guardianPid $state.guardianStartUtc))
            $expiry = ''
            $recoveryExpired = $state.PSObject.Properties.Name -contains 'networkRecovery' -and ($expiry = Get-RunnerRecoveryExpiry $state.networkRecovery (Get-RunnerRecoveryNow))
            $sealedInvalid = $false
            $sealedFailure = $null
            if (($state.PSObject.Properties.Name -contains 'phase' -and $state.phase -ceq 'sealed-off') -or
                ($state.PSObject.Properties.Name -contains 'networkRecovery' -and $state.networkRecovery.phase -ceq 'sealed-preparation')) {
                try { Assert-RunnerSealedPreparation $state (Get-RunnerRecoveryNow) } catch { $sealedInvalid = $true; $sealedFailure = $_ }
            }
            $decisionUtc = [DateTime]::UtcNow
            $deadlineReached = $decisionUtc -ge $deadline
            if ($deadlineReached -or -not $ownerAlive -or $guardianDead -or $recoveryExpired -or $sealedInvalid) {
                Write-RunnerCleanupObservation 'watchdog' 'watchdog-condition' $state $decisionUtc '' $expiry @{
                    deadlineReached = $deadlineReached; ownerAlive = [bool]$ownerAlive; guardianRecorded = [bool]$guardianRecorded
                    guardianDead = [bool]$guardianDead; recoveryExpired = [bool]$recoveryExpired; sealedInvalid = [bool]$sealedInvalid
                } -Failure $sealedFailure
                if ($state.PSObject.Properties.Name -contains 'networkRecovery') {
                    $state.networkRecovery.generation++; $state.networkRecovery.phase = 'failed'; $state.networkRecovery.failure = 'watchdog-expired'
                    Write-RunnerJson $script:RunnerStatePath $state
                }
                Remove-RunnerInstance $state
            }
        }
    } finally { Exit-RunnerLock $mutex }
    Invoke-RunnerSupervisorRecovery
}

function Invoke-RunnerSupervisorRecovery {
    # Cleanup is separate above. Never wait behind a running supervisor or updater.
    try { $lifetime = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1' -FailFast }
    catch { return }
    try {
        $mutex = Enter-RunnerLock
        try {
            Assert-SecureRoot
            Assert-RunnerTransitionClear
            $config = Get-RunnerConfig
            if ($config.activation -cne 'active' -or (Get-RunnerState) -or
                (Test-Path -LiteralPath (Assert-OwnedPath (Join-Path $script:RunnerRoot 'stop.requested')))) { return }
            $task = Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction Stop
            if ($task.State -cne 'Ready') { return }
            [void](Get-CoherentInstalledRunnerBundle)
            $credentialPath = Assert-OwnedPath (Join-Path $script:RunnerRoot 'credential.dpapi')
            if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) { throw 'Credential record is missing.' }
            Assert-RunnerProtectedPath $credentialPath
            $record = Read-RunnerJson $credentialPath
            if ($null -eq $record -or $record.tag -cne $script:RunnerTag -or $record.scope -cne 'LocalMachine' -or
                [string]::IsNullOrEmpty($record.ciphertext) -or $record.ciphertext.Length -gt 16384 -or
                [Convert]::FromBase64String($record.ciphertext).Length -eq 0) { throw 'Credential record is invalid.' }
            # No token decryption, VM creation or API request belongs to recovery.
            if (@(Get-RunnerVmInventory | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -ne 0) { throw 'Unexpected owned-prefix VM blocks recovery.' }
            Assert-RunnerControllerOpen # Recheck Stop/journals; restart the sole reconciler, not a VM claim.
            if ((Get-RunnerConfig).activation -cne 'active' -or (Get-RunnerState) -or
                (Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction Stop).State -cne 'Ready') { return }
            Start-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction Stop
        } finally { Exit-RunnerLock $mutex }
    } finally { Exit-RunnerLock $lifetime }
}

$actionControl = $null
if ($Action -in @('StoreCredential', 'Start', 'Restart', 'Stop', 'EnablePilot', 'RetryPilot', 'EnableActive', 'PrepareImage')) {
    $actionControl = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Control-v1' -FailFast
}
try { switch ($Action) {
    'PrepareImage' { Invoke-RunnerPrepareImageCore }
    'Preflight' {
        Assert-HostPrerequisites
        $config = Get-RunnerConfig
        Write-Host "Host prerequisites present. Repository: $($config.repo). Activation: $($config.activation)."
    }
    'StoreCredential' {
        Assert-Administrator
        Assert-SecureRoot
        Assert-RunnerTransitionClear
        [void](Get-RunnerConfig)
        Initialize-RunnerDpapi
        $secret = Read-Host 'Repository-scoped GitHub fine-grained token' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try {
            $plain = [Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        try {
            $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        } finally { [Array]::Clear($plain, 0, $plain.Length) }
        Write-RunnerJson (Join-Path $script:RunnerRoot 'credential.dpapi') ([ordered]@{
            tag = $script:RunnerTag; scope = 'LocalMachine'; ciphertext = [Convert]::ToBase64String($cipher)
        })
        Write-Host 'Machine-bound DPAPI credential stored under the SYSTEM/Administrators-only root.'
    }
    'Start' {
        Start-RunnerSupervisorCore
    }
    'Restart' {
        Assert-RunnerTransitionClear
        Stop-SupervisorCore
        Start-RunnerSupervisorCore
        Write-Host 'Supervisor restarted. Its next job uses a new VM.'
    }
    'Stop' {
        Assert-RunnerTransitionClear
        Stop-SupervisorCore
        Write-Host 'Supervisor stopped and its owned VM removed.'
    }
    'Status' {
        Assert-Administrator
        Assert-SecureRoot
        $config = Get-RunnerConfig
        $state = Get-RunnerState
        Show-RunnerImageStatus $config
        $supervisor = Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction SilentlyContinue
        if ($null -eq $state) { Write-Host "Supervisor: $($supervisor.State). Idle. Activation: $($config.activation)." }
        else {
            Assert-StateIdentity $state
            $vm = Get-VM -Name $state.vmName -ErrorAction SilentlyContinue
            Write-Host "VM: $($state.vmName); state: $(if ($vm) { $vm.State } else { 'missing' }); deadline: $($state.deadlineUtc); heartbeat: $($state.heartbeatUtc)."
            Show-RunnerSessionResources $state $vm
        }
        if ($null -eq $state -and $config.activation -in @('pilot', 'active')) {
            Show-RunnerCapacityStatus $config
        }
        try {
            $inventory = @(Get-RunnerVmInventory)
            Write-Host "Hyper-V inventory verified: $($inventory.Count) virtual machine(s)."
        } catch {
            Write-Host 'Hyper-V inventory is unverified. Pickup and cleanup are blocked; preserve instance files/state and investigate VM registration.'
        }
        $recentError = Read-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json')
        if ($config.PSObject.Properties.Name -contains 'pilotExpectedSha') { Write-Host "Pilot binding: workflow=$($config.pilotWorkflowPath); SHA=$($config.pilotExpectedSha); label=$($config.pilotLabel)." }
        if ($null -ne $recentError) { Write-Host "Last supervisor failure ($($recentError.atUtc)): stage=$($recentError.stage); code=$($recentError.code)." }
        $attempt = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json')
        if ($null -ne $attempt) { Write-Host "Pilot consumed for job $($attempt.jobId). Failure or uncertainty requires maintainer investigation; it cannot take another pilot job." }
        $pilot = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json')
        if ($null -ne $pilot) { Write-Host "Pilot proof: status=$($pilot.status); conclusion=$($pilot.conclusion); verified=$($pilot.verified)." }
        foreach ($name in @('pilot-retry.json', 'update-journal.json', 'setup-publication.json')) {
            $journal = Read-RunnerJson (Join-Path $script:RunnerRoot $name)
            if ($null -ne $journal) {
                $phase = if ($journal.tag -ceq $script:RunnerTag -and $journal.phase -cin @('pending', 'complete')) { $journal.phase } else { 'invalid' }
                if ($phase -ceq 'complete') { Write-Host "Lifecycle journal $name : complete. Retained history; this journal does not block pickup." }
                else { Write-Host "Lifecycle journal $name : $phase. Explicit recovery is required; pickup is blocked." }
            }
        }
    }
    'Watchdog' { Invoke-Watchdog }
    'Guard' {
        Assert-Administrator
        Assert-SecureRoot
        if (-not $SessionName) { throw 'Network guard requires one exact session identity.' }
        try { while (Invoke-GuardCheck $SessionName) { Start-Sleep -Seconds 1 } }
        catch {
            Write-RunnerFailure 'network-guard' 'RECOVERY_FAILED' $SessionName
            $mutex = Enter-RunnerLock
            try {
                $current = Get-RunnerState
                if ($null -ne $current -and $current.vmName -ceq $SessionName) {
                    Write-RunnerCleanupObservation 'guardian-catch' 'guard-exception' $current ([DateTime]::UtcNow) -Failure $_
                    Remove-RunnerInstance $current
                }
            } finally { Exit-RunnerLock $mutex }
            throw
        } finally { Stop-RunnerRecoveryProbe }
    }
    'Supervise' { Invoke-Supervisor }
    'EnablePilot' {
        Enable-RunnerPilotCore $ExpectedPilotSha
    }
    'RetryPilot' { Enable-RunnerPilotCore $ExpectedPilotSha $RetryReason -Retry }
    'EnableActive' { Enable-RunnerActiveCore }
} } finally { if ($null -ne $actionControl) { Exit-RunnerLock $actionControl } }
