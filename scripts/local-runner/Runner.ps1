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
    $binding = Get-RunnerImageBinding $Config
    [void](Get-RunnerVerifiedImageLease $Config.baseVhdx $Config.baseSha256 $binding.hash 'base-verification')
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

function Get-GuestSeedData([string] $PublicKey, [string] $Mac, $Config, [string] $ProfileLabel = 'it-inventory-ephemeral', [bool] $Prepared = $false) {
    $network = @"
version: 2
ethernets:
  runner0:
    match:
      macaddress: $Mac
    set-name: runner0
    mtu: $(Get-RunnerGuestMtu)
    addresses: [$($Config.guestIp)/$($Config.prefixLength)]
    routes:
      - to: default
        via: $($Config.gatewayIp)
    nameservers:
      addresses: [1.1.1.1, 8.8.8.8]
"@
    return [pscustomobject]@{ userData = (Get-GuestCloudConfig $PublicKey $ProfileLabel $Prepared); networkConfig = $network }
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
        $seedData = Get-GuestSeedData $PublicKey $Mac $Config $ProfileLabel $Prepared

        [IO.File]::WriteAllText((Join-Path $root 'user-data'), $seedData.userData, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $root 'meta-data'), "instance-id: $([guid]::NewGuid().ToString('N'))`nlocal-hostname: itir-guest`n", [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $root 'network-config'), $seedData.networkConfig, [Text.UTF8Encoding]::new($false))
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
    $gateway = [ipaddress]::Parse($Config.gatewayIp)
    $listener = [Net.Sockets.TcpListener]::new($gateway, 0)
    try {
        # Port zero lets Windows select an available port outside exclusions.
        # Keep this exact gateway listener bound throughout the guest deny test.
        $listener.Start()
        $endpoint = $listener.LocalEndpoint
        if ($endpoint -isnot [Net.IPEndPoint] -or -not $endpoint.Address.Equals($gateway) -or $endpoint.Port -lt 1 -or $endpoint.Port -gt 65535) { throw 'Isolation listener endpoint readback differs.' }
        $port = $endpoint.Port
        $command = 'timeout 4 bash -c "echo probe >/dev/tcp/{0}/{1}" >/dev/null 2>&1; test $? -ne 0' -f $gateway.ToString(), $port
        $exitCode = $null
        $listenerStatus = 'unavailable'
        try {
            $observedExit = Invoke-RunnerNative 'ssh.exe' ($args + @("runner@$($Config.guestIp)", $command))
            if ($observedExit -is [int]) { $exitCode = $observedExit }
        } catch { } # An unavailable SSH observation never authorizes continuation.
        try {
            $pending = $listener.Pending()
            if ($pending -is [bool]) { $listenerStatus = if ($pending) { 'pending' } else { 'clear' } }
        } catch { } # Observe independently even when SSH failed or was unavailable.
        if ($null -eq $exitCode -or $exitCode -ne 0 -or $listenerStatus -cne 'clear') {
            throw (New-RunnerIsolationProbeFailure $exitCode $listenerStatus)
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
    Assert-RunnerSessionTrustedPaths $State
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
            [IO.Path]::GetFullPath($vm.Path) -ine ((Get-RunnerSessionPaths $current).vmPath)) { throw 'VM identity changed before boot dispatch.' }
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
                $vm.Notes -cne $script:RunnerTag -or [IO.Path]::GetFullPath($vm.Path) -ine ((Get-RunnerSessionPaths $current).vmPath)) { throw 'Booted VM readback differs from the recorded identity/running state.' }
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
    Assert-RunnerSessionTrustedPaths $Current
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
        } elseif ($Event -ceq 'dispatch') {
            # Guardian quarantine may begin after the caller's liveness check.
            # Fence the durable handoff against fresh state under this mutex.
            [void](Assert-RunnerJitAdmission $State $current)
        }
        $journal = if ($current.PSObject.Properties.Name -contains 'runnerLaunch') { $current.runnerLaunch } else { $null }
        $next = Get-RunnerLaunchDecision $journal $Event $RunnerId $LaunchId $ExitCode
        if ($Event -ceq 'intent') {
            Assert-RunnerJitRegistrationClear
            if ($null -eq $Config) { $Config = Get-RunnerConfig }
            $registration = [pscustomobject][ordered]@{ schema = 1; tag = $script:RunnerTag; phase = 'intent'; operationId = $next.launchId
                repo = $Config.repo; vmName = $current.vmName; vmId = $current.vmId; instancePath = $current.instancePath; layoutVersion = $current.layoutVersion
                supervisorPid = $current.supervisorPid; supervisorStartUtc = $current.supervisorStartUtc
                labels = @(Get-RunnerJitLabels $Config $current.resourceLabel); runnerGroupId = $Config.runnerGroupId; runnerId = 0 }
            # Atomic root-level barrier is committed before the POST can run.
            Write-RunnerJitRegistration $registration
            Invoke-RunnerTransitionCheckpoint 'jit-registration-intent'
        } elseif ($Event -cin @('registered', 'dispatch')) {
            $registration = Get-RunnerJitRegistration
            Assert-RunnerJitRegistration $registration # Legacy evidence is retirement only.
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
        if ($null -ne $result -and $result.ExitCode -eq 0) {
            try { $receipt = ConvertFrom-RunnerGuestReceipt $result.Output $journal }
            catch {
                try { $_.Exception.Data['runnerFailureClass'] = 'receipt-invalid' } catch { }
                throw
            }
        }
        if ($null -eq $receipt) {
            [void](Save-RunnerLaunchEvent $State 'transport-lost')
        } elseif ($receipt.phase -ceq 'exited') {
            [void](Save-RunnerLaunchEvent $State 'runner-exited' $journal.runnerId $journal.launchId $receipt.exitCode)
            if ($receipt.exitCode -ne 0) { throw (New-RunnerExecutionFailure 'runner-exit' $receipt.exitCode) }
            return
        } else { [void](Save-RunnerLaunchEvent $State 'receipt' $journal.runnerId $journal.launchId) }
        Start-Sleep -Seconds 1
    }
}

function Get-SshArgs($State) {
    Assert-RunnerSessionTrustedPaths $State -RequireKnownHosts
    $paths = Get-RunnerSessionPaths $State
    return @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=2', '-o', 'StrictHostKeyChecking=accept-new',
        '-o', "UserKnownHostsFile=$($paths.knownHosts)", '-i', $paths.privateKey)
}

function Get-RunnerGuestReadinessCommand([string] $ProfileLabel) {
    $prerequisites = Get-RunnerGuestPrerequisites $ProfileLabel
    $command = 'timeout 25 cloud-init status --wait >/dev/null 2>&1; readiness_code=$?; if test "$readiness_code" -eq 124; then exit 71; elif test "$readiness_code" -ne 0; then exit 72; fi; test "$(id -un)" = runner || exit 73; command -v curl >/dev/null || exit 74; command -v git >/dev/null || exit 75; command -v unzip >/dev/null || exit 76'
    $command += '; readiness_mtu=$(cat /sys/class/net/runner0/mtu 2>/dev/null) || exit 80; test "$readiness_mtu" = ' + (Get-RunnerGuestMtu) + ' || exit 80'
    if ($prerequisites.docker) { $command += '; test -S /var/run/docker.sock || exit 77; timeout 10 docker info >/dev/null 2>&1; readiness_code=$?; if test "$readiness_code" -eq 124; then exit 78; elif test "$readiness_code" -ne 0; then exit 79; fi' }
    return $command + '; exit 0'
}

function Get-RunnerCloudInitInspector {
    # Fixed read-only inspector. Raw status output exists only in bounded memory;
    # neither stderr nor unselected JSON keys cross the SSH protocol.
    return @'
import json, os, re, stat, subprocess, sys, threading, queue, time
STAGES = ('top-level','init-local','init','modules-config','modules-final')
STATUSES = ('not started','running','done','disabled','error','unknown')
EXTENDED = ('not started','running','done','disabled','error - running','error - done','degraded running','degraded done','unknown')
MODULES = ('users-groups','package-update-upgrade-install','runcmd','scripts-user','resizefs','growpart','ssh','set-passwords','apt-configure')
EXCEPTIONS = ('ProcessExecutionError','RuntimeError','ValueError','TypeError','KeyError','OSError','PermissionError','FileNotFoundError','TimeoutExpired','SchemaValidationError')
result = dict(schema=1,capture='unavailable',cloudInitExit=None,status='unknown',extendedStatus='unknown',stages=[dict(stage=s,errorCount=0,recoverableCount=0) for s in STAGES],reasons=[])
def reason(text):
    # Reasons are fixed templates, never copied prose, matches, tokens or tails.
    if not isinstance(text,str): return ('reason-withheld',True,False)
    # The full status JSON was capped at 64KiB before parsing. Scan the complete
    # bounded error, including a decisive tail after verbose package output.
    if len(text)>65536: return ('reason-withheld',True,True)
    # Multiline ProcessExecutionError text may contain the decisive apt reason.
    # Normalize only in bounded memory; no matched text ever reaches output.
    text=' '.join(text.split())
    templates = (
        (r'temporary failure in name resolution|temporary failure resolving|could not resolve|failed to resolve|name resolution.{0,80}(?:failed|failure)','DNS resolution failed.'),
        (r'network (?:is )?unreachable|no route to host','Network was unreachable.'),
        (r'connection timed out|connect(?:ion)? timeout|timed out (?:while )?connect(?:ing)?','Connection timed out.'),
        (r'connection refused','Connection was refused.'),
        (r'certificate verif(?:y|ication) failed|ssl certificate problem|tls.{0,80}handshake.{0,80}failed','TLS validation or handshake failed.'),
        (r'no_pubkey|gpg error|signatures could not be verified|signatures couldn.t be verified|repository.{0,80}not signed','Package repository signature verification failed.'),
        (r'(?:does not have|no longer has).{0,80}release file|release file.{0,80}(?:not found|missing)','Package repository Release file was unavailable.'),
        (r'hash sum mismatch','Package hash verification failed.'),
        (r'no space left on device','Disk space was exhausted.'),
        (r'no installation candidate','Package has no installation candidate.'),
        (r'unable to locate package|\bpackage\b.{0,80}(?:not found|does not exist)','Package was not found.'),
        (r'could not get lock|unable to acquire.{0,80}lock|(?:dpkg|apt).{0,80}lock','Package manager lock was unavailable.'),
        (r'dpkg was interrupted','Package manager was interrupted.'),
        (r'unmet dependencies|unmet dependency|held broken packages','Package dependencies could not be satisfied.'),
        (r'\bgroup\b.{0,96}\balready exists\b','Group already exists.'),
        (r'permission denied|operation not permitted','Permission was denied.'),
        (r'schema.{0,80}(?:error|invalid|failed)|invalid.{0,80}cloud.?config|cloud.?config.{0,80}(?:invalid|schema)','Cloud configuration schema was invalid.'),
        (r'(?:resize|growpart).{0,80}(?:failed|error)|(?:failed|error).{0,80}(?:resize|growpart)','Filesystem resize failed.'),
        (r'(?:could not|failed to|unable to) connect|connection failed','Connection failed.'),
        (r'failed to fetch|unable to fetch|some index files failed to download|failed to download','Package fetch failed.'),
        (r'dpkg: error|sub-process.{0,80}\bdpkg\b.{0,80}returned an error code','Package manager exited with an error.'),
    )
    for pattern,template in templates:
        if re.search(pattern,text,re.I): return (template,True,False)
    if re.search(r'\b(?:apt|apt-get|dpkg)\b',text,re.I) and re.search(r'exit code: [1-9][0-9]*\b|(?:returned|exited).{0,40}(?:error|non-zero|nonzero)',text,re.I):
        return ('Package manager exited with an error.',True,False)
    return ('reason-withheld',True,False)
def strings(value):
    if isinstance(value,list):
        return [s for s in value[:1024] if isinstance(s,str)]
    if isinstance(value,dict):
        return [s for key in ('WARNING','ERROR','CRITICAL') for s in strings(value.get(key,[]))][:1024]
    return []
def package_tail():
    # Fixed guest-local source; never accept caller paths or follow symlinks.
    # O_NONBLOCK prevents a substituted FIFO from blocking before fstat rejects it.
    # Read only a root-owned, non-writable-by-others regular file, capped BEFORE
    # allocation. The outer timeout also bounds this local filesystem operation.
    fd=None
    try:
        fd=os.open('/var/log/cloud-init-output.log',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o022: return None
        offset=max(0,info.st_size-65536)
        os.lseek(fd,offset,os.SEEK_SET)
        raw=os.read(fd,65536)
        # A partial first line cannot supply an independently meaningful match.
        if offset: raw=raw.partition(b'\n')[2]
        text,redacted,_=reason(raw.decode('utf-8',errors='replace'))
        if text in ('reason-withheld','Package manager exited with an error.','Group already exists.','Permission was denied.','Cloud configuration schema was invalid.','Filesystem resize failed.'): return None
        return (text,redacted,offset>0)
    except Exception: return None
    finally:
        if fd is not None: os.close(fd)

def inspect():
    process=None; thread=None; stop=threading.Event(); chunks=queue.Queue(maxsize=2)
    try:
        process=subprocess.Popen(['cloud-init','status','--format=json'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        def read():
            try:
                while not stop.is_set():
                    data=process.stdout.read1(4096)
                    while not stop.is_set():
                        try: chunks.put(data,timeout=0.05); break
                        except queue.Full: pass
                    if not data: break
            except Exception: pass
        thread=threading.Thread(target=read,daemon=True); thread.start()
        raw=bytearray(); deadline=time.monotonic()+5
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0: result['capture']='status-timeout'; return
            try: data=chunks.get(timeout=min(0.1,remaining))
            except queue.Empty: continue
            if not data: break
            if len(raw)+len(data)>65536: result['capture']='status-overflow'; return
            raw.extend(data)
        remaining=deadline-time.monotonic()
        if remaining<=0: result['capture']='status-timeout'; return
        try: code=process.wait(timeout=remaining)
        except subprocess.TimeoutExpired: result['capture']='status-timeout'; return
        result['cloudInitExit']=code
        try: status=json.loads(raw.decode('utf-8'))
        except (ValueError,UnicodeError): result['capture']='status-invalid'; return
        if not isinstance(status,dict): result['capture']='status-invalid'; return
        result['capture']='complete'
        result['status']=status.get('status') if status.get('status') in STATUSES else 'unknown'
        result['extendedStatus']=status.get('extended_status') if status.get('extended_status') in EXTENDED else 'unknown'
        package_module=False
        for stage in STAGES[1:]+STAGES[:1]:
            item=status if stage=='top-level' else status.get(stage,{})
            if not isinstance(item,dict): continue
            errors=strings(item.get('errors',[])); recoverable=strings(item.get('recoverable_errors',{}))
            if any(re.search(r'\bcc_package_update_upgrade_install\b',entry) for entry in errors+recoverable): package_module=True
            result['stages'][STAGES.index(stage)].update(errorCount=len(errors),recoverableCount=len(recoverable))
            for kind,entries in (('error',errors),('recoverable',recoverable)):
                for entry in entries:
                    if len(result['reasons'])>=8: break
                    text,redacted,truncated=reason(entry)
                    module=next((m for m in MODULES if re.search(r'\bcc_'+re.escape(m.replace('-','_'))+r'\b',entry)), 'other')
                    exception=next((e for e in EXCEPTIONS if re.search(r'\b'+e+r'\b',entry)), 'other')
                    result['reasons'].append(dict(stage=stage,kind=kind,module=module,exception=exception,reason=text,redacted=redacted,truncated=truncated))
        generic=[r for r in result['reasons'] if r['kind']=='error' and r['reason']=='Package manager exited with an error.']
        if result['status']=='error' and result['extendedStatus']=='error - done' and code!=0 and package_module and generic:
            tail=package_tail()
            if tail is not None:
                for entry in generic:
                    entry.update(reason=tail[0],redacted=tail[1],truncated=tail[2],source='cloud-init-output-tail')
    except Exception: result['capture']='unavailable'
    finally:
        stop.set()
        if process is not None:
            try:
                if process.poll() is None: process.kill()
                process.wait(timeout=1)
            except Exception: pass
            if thread is not None: thread.join(timeout=1)
            if process.stdout is not None: process.stdout.close()
inspect()
encoded=json.dumps(result,ensure_ascii=True,separators=(',',':'))
if len(encoded)>4096:
    result['reasons']=[]; result['capture']='status-overflow'
    encoded=json.dumps(result,ensure_ascii=True,separators=(',',':'))
sys.stdout.write(encoded)
'@
}

function Assert-RunnerCloudInitPreparationIdentity($State) {
    Assert-RunnerPreparationAuthorized
    Assert-SessionAlive $State
    $mutex = Enter-RunnerLock
    try {
        $current = Get-RunnerState
        Assert-StateIdentity $current
        if ($State.purpose -cne 'prepare' -or $current.purpose -cne 'prepare' -or
            $current.vmName -cne $State.vmName -or $current.vmId -cne $State.vmId -or
            $current.PSObject.Properties.Name -contains 'imageCandidate' -or
            $current.PSObject.Properties.Name -contains 'runnerLaunch' -or
            $current.PSObject.Properties.Name -contains 'runnerId' -or
            $current.PSObject.Properties.Name -contains 'claimMode' -or
            $current.PSObject.Properties.Name -contains 'pilotClaim') { throw 'Cloud-init diagnostic requires the current generic preparation session.' }
    } finally { Exit-RunnerLock $mutex }
}

function Invoke-RunnerCloudInitPreparationCapture($State, $Config) {
    # Diagnostic failure never replaces readiness failure or changes admission.
    $terminal = $false
    try {
        Assert-RunnerCloudInitPreparationIdentity $State
        $bundle = Get-CoherentInstalledRunnerBundle
        $python = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-RunnerCloudInitInspector)))
        # Fixed read-only inspector, no environment preservation or caller input.
        # GNU timeout owns the process group, including the status child.
        $command = "sudo -n timeout --signal=KILL 10s python3 -c 'import base64;exec(base64.b64decode(""$python""))'"
        try { $transport = Invoke-RunnerReceiptNative 'ssh.exe' ((Get-SshArgs $State) + @("runner@$($Config.guestIp)", $command)) }
        catch { $transport = $null }
        Assert-RunnerCloudInitPreparationIdentity $State
        $capture = ConvertFrom-RunnerCloudInitCapture $transport
        $terminal = Test-RunnerCloudInitTerminal $capture
        $record = [pscustomobject][ordered]@{ schema=1; sessionId=$State.vmName.Substring(5); vmId=$State.vmId; purpose='prepare'; bundleHash=$bundle.hash; atUtc=[DateTime]::UtcNow.ToString('o'); diagnostic=$capture }
        Assert-RunnerCloudInitArtifact $record
        $mutex = Enter-RunnerLock
        try {
            # No stale session may publish after waiting for the state mutex.
            $current = Get-RunnerState
            Assert-StateIdentity $current
            if ($null -eq $current -or $current.vmName -cne $State.vmName -or $current.vmId -cne $State.vmId -or $current.purpose -cne 'prepare' -or
                $current.PSObject.Properties.Name -contains 'imageCandidate' -or $current.PSObject.Properties.Name -contains 'runnerLaunch' -or
                $current.PSObject.Properties.Name -contains 'runnerId' -or $current.PSObject.Properties.Name -contains 'claimMode' -or
                $current.PSObject.Properties.Name -contains 'pilotClaim') { throw 'Cloud-init diagnostic session was replaced.' }
            Assert-RunnerPreparationAuthorized
            $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'preparation-cloud-init.json')
            if (Test-Path -LiteralPath $path) { Assert-RunnerProtectedPath $path }
            Write-RunnerJson $path $record
            Assert-RunnerProtectedPath $path
        } finally { Exit-RunnerLock $mutex }
    } catch { }
    return $terminal
}

function Wait-Guest($State, $Config, [string] $ProfileLabel = 'it-inventory-ephemeral') {
    $args = Get-SshArgs $State
    $command = Get-RunnerGuestReadinessCommand $ProfileLabel
    $limit = [DateTime]::UtcNow.AddMinutes(12)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $purpose = if ($State.PSObject.Properties.Name -contains 'purpose' -and $State.purpose -is [string] -and $State.purpose -cin @('job','prepare','verify-image')) { $State.purpose } else { 'other' }
    $diagnostic = [pscustomobject]@{ purpose=$purpose; attemptCount=0; elapsedMs=[long]0; firstFailureStage=''; lastFailureStage=''; lastNativeExit=$null; anySshCompleted=$false }
    $cloudInitCaptureAttempted = $false
    try {
    while ([DateTime]::UtcNow -lt $limit) {
        Assert-SessionAlive $State
        try { $exitCode = Invoke-RunnerNative 'ssh.exe' ($args + @("runner@$($Config.guestIp)", $command)) }
        catch { Add-RunnerGuestReadinessAttempt $diagnostic $null $watch.ElapsedMilliseconds; throw }
        Add-RunnerGuestReadinessAttempt $diagnostic $exitCode $watch.ElapsedMilliseconds
        if ($exitCode -eq 0) { return Get-RunnerGuestMtu }
        if ($purpose -ceq 'prepare' -and $exitCode -eq 72 -and -not $cloudInitCaptureAttempted) {
            $cloudInitCaptureAttempted = $true
            if (Invoke-RunnerCloudInitPreparationCapture $State $Config) { throw 'Guest cloud-init reported a terminal preparation failure.' }
        }
        Start-Sleep -Seconds 10
    }
    throw 'Guest never reached its profile prerequisite readiness.'
    } catch {
        Set-RunnerGuestReadinessEvidence $_ $diagnostic $watch.ElapsedMilliseconds
        throw
    } finally { $watch.Stop() }
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
    $sessionWatch = [Diagnostics.Stopwatch]::StartNew()
    $preparing = $Purpose -cne 'job'
    if (($Purpose -ceq 'verify-image') -ne ($null -ne $ImageCandidate) -or ($preparing -and $null -ne $PilotAttempt)) { throw 'Image verification requires its explicit candidate and cannot carry a job claim.' }
    $profile = if ($preparing) { Get-RunnerResourceProfile 'it-inventory-heavy' } else { Get-RunnerSessionProfile $Config $ProfileLabel }
    Start-RunnerImagePreflight $Purpose
    $preflightScope = $script:RunnerImagePreflight
    try {
        # Read-only demand checks precede hashes/copies and remain repeated after
        # recovery immediately before the authoritative JIT intent.
        if (-not $preparing) {
            Write-RunnerImageProgress 'demand-inspection'
            if (-not (Test-RunnerSessionDemand $Config $profile.label $PilotAttempt)) { return [pscustomobject]@{ name = ''; id = $null; outcome = 'demand-withdrawn' } }
        }
        $script:RunnerOperationStage = 'preflight'
        Write-RunnerImageProgress 'host-inspection'
        if ($preparing) { Assert-RunnerPreparationAuthorized; Assert-InstalledHost $Config -ForPreparation }
        else { Assert-InstalledHost $Config; [void](Get-OwnerToken) }
        $image = if ($Purpose -ceq 'verify-image') {
            $candidateReceipt = Assert-RunnerImageCandidate $ImageCandidate $Config
            $lease = Get-RunnerVerifiedImageLease $ImageCandidate.path $candidateReceipt.diskHash ((Get-RunnerJsonEvidence $candidateReceipt).hash) -Prepared
            [pscustomobject]@{ path = $ImageCandidate.path; prepared = $true; differencing = $true; lease = $lease }
        } elseif ($preparing) { [pscustomobject]@{ path = $Config.baseVhdx; prepared = $false } } else { Get-RunnerImageSelection $Config }
        $name = "$($script:RunnerPrefix)$([guid]::NewGuid().ToString('N'))"
        $script:RunnerSessionName = $name
        $instance = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'instances') $name)
        $state = [ordered]@{
            tag = $script:RunnerTag; vmName = $name; instancePath = $instance; layoutVersion = 2
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
            $paths = Get-RunnerSessionPaths ([pscustomobject]$state)
            New-Item -ItemType Directory -Path $paths.instance -Force | Out-Null
            Assert-RunnerProtectedPath $paths.instance
            New-Item -ItemType Directory -Path $paths.vmData -ErrorAction Stop | Out-Null
            $script:RunnerOperationStage = 'disk-copy'
            $disk = $paths.guestDisk
            if (-not $preparing -and -not (Test-RunnerSessionDemand $Config $profile.label $PilotAttempt)) { return [pscustomobject]@{ name = $name; id = $null; outcome = 'demand-withdrawn' } }
            if ($image.PSObject.Properties.Name -contains 'differencing' -and $image.differencing) {
                $script:RunnerOperationStage = 'disk-clone'
                $childWatch = [Diagnostics.Stopwatch]::StartNew()
                [void](New-RunnerImageChild $disk $image.lease)
                $childWatch.Stop()
            } else { Copy-Item -LiteralPath $image.path -Destination $disk -ErrorAction Stop }
            $preflightSeconds = $sessionWatch.Elapsed.TotalSeconds
            Write-RunnerImageProgress 'complete'
            $script:RunnerImagePreflight = $null
            $script:RunnerOperationStage = 'key-generation'
            New-RunnerSshKey $paths.privateKey
            $knownHostsEvidence = New-RunnerKnownHosts $paths.knownHosts
            Assert-RunnerSessionTrustedPaths ([pscustomobject]$state)
            $key = (Get-Content -LiteralPath $paths.publicKey -Raw).Trim()
            Assert-SessionAlive $state
            $mutex = Enter-RunnerLock
            try {
                $script:RunnerOperationStage = 'vm-creation'
                $current = Get-RunnerState
                if ($null -eq $current -or $current.vmName -ne $name) { throw 'Session removed before VM creation.' }
                $current | Add-Member -NotePropertyName phase -NotePropertyValue 'creating' -Force
                $current | Add-Member -NotePropertyName expectedBootDisk -NotePropertyValue $disk -Force
                $current | Add-Member -NotePropertyName expectedVmPath -NotePropertyValue $paths.vmPath -Force
                Write-RunnerJson $script:RunnerStatePath $current
                $vm = New-RunnerProfileVm $name $disk $paths.vmData $profile.label
                $current | Add-Member -NotePropertyName vmId -NotePropertyValue ([guid]$vm.Id).ToString() -Force
                Assert-StateIdentity $current
                Write-RunnerJson $script:RunnerStatePath $current
                Assert-RunnerSessionTrustedPaths $current
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
            $seed = $paths.seedDisk
            New-SeedDisk $seed $key $guestMac.seedMac $Config $profile.label $image.prepared
            Add-VMHardDiskDrive -VMName $name -Path $seed
            Assert-RunnerSessionTrustedPaths $current
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
            if (-not $preparing -and -not (Test-RunnerSessionDemand $Config $profile.label $PilotAttempt)) { return [pscustomobject]@{ name = $name; id = $null; outcome = 'demand-withdrawn' } }
            $script:RunnerOperationStage = 'vm-boot'
            Start-GuardedVm $state
            Assert-RunnerGuestMac -VmName $name -ExpectedMac $guestMac.rawMac
            $script:RunnerOperationStage = 'guest-readiness'
            $readinessWatch = [Diagnostics.Stopwatch]::StartNew()
            $guestMtu = Wait-Guest $state $Config $profile.label
            Assert-RunnerKnownHosts $paths.knownHosts $knownHostsEvidence -RequireContent
            Write-Host 'Protected known-hosts file retained its identity and strict ACL after SSH appended a host key.'
            if ($guestMtu -isnot [int] -or $guestMtu -ne (Get-RunnerGuestMtu)) { throw 'Guest MTU readiness readback is invalid.' }
            Write-Host ('Guest prerequisites ready in {0:N1}s for {1}; verified MTU {2}.' -f $readinessWatch.Elapsed.TotalSeconds, $profile.label, $guestMtu)
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
                    [IO.Path]::GetFullPath($verifiedVm.Path) -ine ((Get-RunnerSessionPaths $verified).vmPath)) { throw 'Image verifier VM identity changed after readiness.' }
                # The same fixed probe runs in each of two successive children.
                # Reusing a written disk, or leaking writes into the parent, fails.
                $markerCommand = 'sudo test ! -e /var/lib/it-inventory-clone-probe && sudo touch /var/lib/it-inventory-clone-probe && sudo test -f /var/lib/it-inventory-clone-probe'
                if ((Invoke-RunnerNative 'ssh.exe' ((Get-SshArgs $state) + @("runner@$($Config.guestIp)", $markerCommand)) -TimeoutSeconds 15) -ne 0) { throw 'Fresh child marker isolation probe failed.' }
                Assert-SessionAlive $state
                $verificationReady = $true
                Invoke-RunnerTransitionCheckpoint 'image-clone-ready'
                return [pscustomobject]@{ schema = 1; candidateId = $ImageCandidate.id; diskHash = $candidateReceipt.diskHash
                    bindingHash = $candidateReceipt.bindingHash; recipeId = $candidateReceipt.recipeId; bundleHash = $candidateReceipt.bundleHash
                    purpose = 'verify-image'; diskType = 'Differencing'; parentLease = 'read-only-same-handle'; parentIdentity = $image.lease.identity; markerProof = 'absent-then-written'
                    preflightSeconds = $preflightSeconds; childCreationSeconds = $childWatch.Elapsed.TotalSeconds; sessionSeconds = $sessionWatch.Elapsed.TotalSeconds; vmName = $verified.vmName; vmId = $verified.vmId; guestMac = $verified.guestMac
                    networkFingerprint = $verified.networkFingerprint
                    sshPublicKeyHash = (Get-FileHash -LiteralPath $paths.publicKey -Algorithm SHA256).Hash
                    readiness = 'cloud-init-and-runner-prerequisites'; guestMtu = $guestMtu; readyUtc = [DateTime]::UtcNow.ToString('o'); readinessSeconds = $readinessWatch.Elapsed.TotalSeconds }
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
            Write-RunnerSessionFailure $name $sessionFailure $script:RunnerOperationStage
            throw
        } finally {
            $verificationFailure = $null
            if ($verificationReady) {
                try { Assert-SessionAlive $state }
                catch {
                    $verificationFailure = $_
                    Write-RunnerSessionFailure $name $verificationFailure $script:RunnerOperationStage
                }
            }
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
                Write-RunnerSessionFailure $name $_ 'cleanup' -LockHeld
                Write-RunnerFailure 'cleanup' 'STAGE_FAILED' $name
                throw
            } finally { Exit-RunnerLock $mutex }
        }
    } finally {
        # Clear only this attempt, including preclaim failure and withdrawal.
        # An expired abandoned scope must never poison later supervisor polls.
        if ([object]::ReferenceEquals($script:RunnerImagePreflight, $preflightScope)) { $script:RunnerImagePreflight = $null }
    }
}

function Assert-RunnerPickupInspectionActive {
    if ((Get-Variable RunnerImagePreflight -Scope Script -ErrorAction SilentlyContinue) -and $null -ne $script:RunnerImagePreflight -and
        $script:RunnerImagePreflight.purpose -ceq 'job' -and [DateTime]::UtcNow -ge $script:RunnerImagePreflight.deadlineUtc) { throw 'Image preflight deadline reached during demand inspection.' }
    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { throw 'Pickup suspension requested during read-only demand inspection.' }
}

function Test-RunnerSessionDemand($Config, [string] $ProfileLabel, $PilotAttempt = $null) {
    $token = Get-OwnerToken
    try {
        if ($Config.activation -ceq 'pilot') {
            $evidence = Get-PilotEvidence $Config $PilotAttempt $token -PickupInspection
            return Test-QueuedRunnerJob $evidence.job $Config.pilotLabel
        }
        return $null -ne (Get-QueuedRunnerJob $Config $token -SessionProfileLabel $ProfileLabel)
    } finally { $token = $null }
}

function Wait-RunnerPickupPoll([ValidateRange(1,30)][int] $Seconds = 30) {
    # Preserve the poll budget while allowing a suspension marker to end idle
    # backoff. Never cancel an in-flight registration/receipt/provider operation.
    for ($elapsed = 0; $elapsed -lt $Seconds; $elapsed++) {
        if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
        Start-Sleep -Seconds 1
    }
}

function Get-PilotEvidence($Config, $Binding, [string] $Token, [switch] $PickupInspection) {
    Assert-PilotConfig $Config
    if ($null -eq $Binding) { throw 'Pilot receipt binding is missing.' }
    foreach ($field in @('jobId', 'runId', 'workflowId')) {
        if ($Binding.PSObject.Properties.Name -notcontains $field -or [string]$Binding.$field -notmatch '^[1-9][0-9]*$') {
            throw 'Pilot receipt API identity is invalid.'
        }
    }
    $base = "https://api.github.com/repos/$($Config.repo)/actions"
    if ($PickupInspection) { Assert-RunnerPickupInspectionActive }
    $run = Invoke-GitHub "$base/runs/$($Binding.runId)" 'GET' $null $Token
    if ($PickupInspection) { Assert-RunnerPickupInspectionActive }
    $workflow = Invoke-GitHub "$base/workflows/$($Binding.workflowId)" 'GET' $null $Token
    if ($PickupInspection) { Assert-RunnerPickupInspectionActive }
    $job = Invoke-GitHub "$base/jobs/$($Binding.jobId)" 'GET' $null $Token
    if ($PickupInspection) { Assert-RunnerPickupInspectionActive }
    if (-not (Test-PilotEvidence $Config $run $workflow $job $Binding)) { throw 'Fresh GitHub pilot workflow/run/SHA/job metadata does not match the recorded binding.' }
    return [pscustomobject]@{ run = $run; workflow = $workflow; job = $job }
}

function Test-RunnerReleaseQueuePriority($Config, $Run, [string] $Base, [string] $Token, [hashtable] $WorkflowCache) {
    # This is provisioning preference only, never an authorization or assignment
    # predicate. Legacy/incomplete metadata keeps ordinary queue eligibility.
    $repository = 'PHead2001/IT-Inventory-System'
    if ($Config.activation -cne 'active' -or $Config.repo -cne $repository -or $null -eq $Run) { return $false }
    foreach ($field in @('event', 'head_branch', 'repository', 'head_repository', 'workflow_id')) {
        if ($Run.PSObject.Properties.Name -notcontains $field) { return $false }
    }
    if ($Run.event -isnot [string] -or $Run.head_branch -isnot [string] -or
        $Run.event -cne 'push' -or $Run.head_branch -cne 'main') { return $false }
    foreach ($field in @('repository', 'head_repository')) {
        $identity = $Run.$field
        if ($null -eq $identity -or $identity.PSObject.Properties.Name -notcontains 'full_name' -or
            $identity.full_name -isnot [string] -or $identity.full_name -cne $repository) { return $false }
    }
    $workflowId = [uint64]0
    if ($Run.workflow_id -is [array] -or [string]$Run.workflow_id -cnotmatch '^[1-9][0-9]*$' -or
        -not [uint64]::TryParse([string]$Run.workflow_id, [ref]$workflowId)) { return $false }
    $path = '.github/workflows/ci.yml'
    if ($Run.PSObject.Properties.Name -contains 'path' -and -not [string]::IsNullOrEmpty([string]$Run.path)) {
        return $Run.path -is [string] -and $Run.path -ceq $path
    }
    # At most one metadata request per workflow ID in the two bounded snapshots.
    # Unknown metadata denies preference; API errors still fail this inspection
    # closed rather than being mistaken for trustworthy release evidence.
    $key = [string]$workflowId
    if (-not $WorkflowCache.ContainsKey($key)) {
        Assert-RunnerPickupInspectionActive
        $WorkflowCache[$key] = Invoke-GitHub "$Base/workflows/$key" 'GET' $null $Token
        Assert-RunnerPickupInspectionActive
    }
    $workflow = $WorkflowCache[$key]
    if ($null -eq $workflow -or $workflow.PSObject.Properties.Name -notcontains 'id' -or
        $workflow.PSObject.Properties.Name -notcontains 'path' -or
        $workflow.id -is [array] -or [string]$workflow.id -cne $key -or
        $workflow.path -isnot [string] -or $workflow.path -cne $path) { return $false }
    return $true
}

function Get-QueuedRunnerJob($Config, [string] $Token, [decimal] $AvailableBytes = [decimal]::MaxValue, [string] $SessionProfileLabel = '') {
    Assert-RunnerPickupInspectionActive
    $script:RunnerQueueObservation = @{}
    if ($SessionProfileLabel) { [void](Get-RunnerSessionProfile $Config $SessionProfileLabel) }
    $label = $Config.label
    if ($Config.activation -eq 'pilot') { Assert-PilotConfig $Config; $label = $Config.pilotLabel }
    $parts = $Config.repo.Split('/')
    $base = "https://api.github.com/repos/$($parts[0])/$($parts[1])/actions"
    # Runs can already be in progress while a continuation waits for this runner.
    # Collect both bounded views before selection; API newest-first/status order
    # must not give new previews priority over older continuations. A verified
    # main Foundation push receives only a bounded 30-minute age preference.
    $candidates = @{}
    foreach ($runStatus in @('queued', 'in_progress')) {
        Assert-RunnerPickupInspectionActive
        $runs = Invoke-GitHub "$base/runs?status=$runStatus&per_page=100" 'GET' $null $Token
        Assert-RunnerPickupInspectionActive
        if ($runs.total_count -gt 100 -or @($runs.workflow_runs).Count -gt 100) { throw 'Workflow run queue exceeds the bounded API view.' }
        foreach ($run in @($runs.workflow_runs)) {
            $runId = [uint64]0
            if ($null -eq $run -or $run.PSObject.Properties.Name -notcontains 'id' -or
                [string]$run.id -notmatch '^[1-9][0-9]*$' -or -not [uint64]::TryParse([string]$run.id, [ref]$runId)) {
                throw 'Workflow run queue identity is invalid.'
            }
            # Undated/malformed timestamps remain eligible after dated runs,
            # ordered by numeric ID. Never infer their age from response order.
            $createdTicks = [long]::MaxValue
            $created = [DateTimeOffset]::MinValue
            if ($run.PSObject.Properties.Name -contains 'created_at' -and
                [string]$run.created_at -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$' -and
                [DateTimeOffset]::TryParse([string]$run.created_at, [Globalization.CultureInfo]::InvariantCulture,
                    [Globalization.DateTimeStyles]::None, [ref]$created)) {
                $createdTicks = $created.UtcTicks
            }
            $key = [string]$runId
            if ($candidates.ContainsKey($key)) {
                # Status can change between snapshots. Inspect one run only and
                # retain its oldest valid timestamp from either bounded view.
                $candidates[$key].createdTicks = [Math]::Min($candidates[$key].createdTicks, $createdTicks)
                $candidates[$key].observations.Add($run)
            } else {
                $observations = [Collections.Generic.List[object]]::new()
                $observations.Add($run)
                $candidates[$key] = [pscustomobject]@{ run = $run; id = $runId; createdTicks = $createdTicks; effectiveTicks = $createdTicks; observations = $observations }
            }
        }
    }
    $workflowCache = @{}
    $boostTicks = [TimeSpan]::FromMinutes(30).Ticks
    foreach ($candidate in $candidates.Values) {
        $candidate.effectiveTicks = $candidate.createdTicks
        # Invalid/unknown dates stay after every dated run, even for main.
        if ($candidate.createdTicks -eq [long]::MaxValue) { continue }
        $preferred = $true
        foreach ($observation in $candidate.observations) {
            if (-not (Test-RunnerReleaseQueuePriority $Config $observation $base $Token $workflowCache)) { $preferred = $false; break }
        }
        if ($preferred) { $candidate.effectiveTicks = [Math]::Max([long]0, ($candidate.createdTicks - $boostTicks)) }
    }
    foreach ($candidate in @($candidates.Values | Sort-Object effectiveTicks, createdTicks, id)) {
        $run = $candidate.run
        $workflow = $null
        if ($Config.activation -eq 'pilot') {
            if ($run.head_sha -cne $Config.pilotExpectedSha) { continue }
            Assert-RunnerPickupInspectionActive
            $workflow = Invoke-GitHub "$base/workflows/$($run.workflow_id)" 'GET' $null $Token
            Assert-RunnerPickupInspectionActive
            if ($workflow.path -cne $Config.pilotWorkflowPath) { continue }
        }
        Assert-RunnerPickupInspectionActive
        $jobs = Invoke-GitHub "$base/runs/$($run.id)/jobs?filter=latest&per_page=100" 'GET' $null $Token
        Assert-RunnerPickupInspectionActive
        if ($jobs.total_count -gt 100 -or @($jobs.jobs).Count -gt 100) { throw 'Workflow job queue exceeds the bounded API view.' }
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
                    $fresh = Get-PilotEvidence $Config $job.pilotBinding $Token -PickupInspection
                    if (-not (Test-QueuedRunnerJob $fresh.job $label)) { continue }
                }
                $job | Add-Member -NotePropertyName resourceLabel -NotePropertyValue $profile.label -Force
                return $job
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
        if ($record.phase -cin @('registered', 'handed-off', 'removal-intent') -and $record.runnerId -gt 0 -and $byId.Count -eq 0 -and $byName.Count -eq 0) {
            # Known registration/handoff/DELETE identities retire only after
            # authoritative local abandonment and complete remote ID/name absence.
            $mutex = Enter-RunnerLock
            try { $record = Assert-RunnerJitReconciliation $record $Config; $record.phase = 'complete'; Write-RunnerJitRegistration $record -AllowLegacy }
            finally { Exit-RunnerLock $mutex }
            Write-Host 'JIT registration retirement completed.'
            return $true
        }
        $runner = Assert-RunnerJitRetirementEligible $record $inventory
        $mutex = Enter-RunnerLock
        try {
            $record = Assert-RunnerJitReconciliation $record $Config
            $record.runnerId = [long]$runner.id; $record.phase = 'removal-intent'
            Write-RunnerJitRegistration $record -AllowLegacy
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
        try { $record = Assert-RunnerJitReconciliation $record $Config; $record.phase = 'complete'; Write-RunnerJitRegistration $record -AllowLegacy }
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
        try {
            # Publication uses this mutex too: validate the live installed
            # artifact before stale cleanup or any registration reconciliation.
            Assert-RunnerTransitionClear
            [void](Get-CoherentInstalledRunnerBundle)
            $stale = Get-RunnerState; if ($null -ne $stale) { Remove-RunnerInstance $stale }
        }
        finally { Exit-RunnerLock $mutex }
        Invoke-SupervisorLoop
    } finally { Close-RunnerImageLeases; Exit-RunnerLock $supervisorMutex }
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
        Assert-StateIdentity $State -AllowLegacy
        $expectedPath = (Get-RunnerSessionPaths $State -AllowLegacy).vmPath
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
            Wait-RunnerPickupPoll
            continue
        }
        $pilotAttemptPath = Join-Path $script:RunnerRoot 'pilot-attempt.json'
        if (Get-RunnerState) { return } # A failed initial claim/cleanup requires recovery before further queue inspection.
        $reconciled = Invoke-RunnerJitReconciliation $config
        if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
        if (-not $reconciled) { Wait-RunnerPickupPoll; continue }
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
            if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
            if (-not $admission.ready) {
                Write-RunnerObservation 'waiting-capacity' $config $admission.availableBytes
                Wait-RunnerPickupPoll
                continue
            }
            $script:RunnerOperationStage = 'queue-inspection'
            $token = Get-OwnerToken
            $job = Get-QueuedRunnerJob $config $token $admission.availableBytes
            if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
            $pollOutcome = if ($null -ne $job) { 'session-starting' } elseif ($null -ne $script:RunnerQueueObservation -and $script:RunnerQueueObservation.Count -gt 0) { 'waiting-capacity' } else { 'idle' }
            Write-RunnerObservation $pollOutcome $config $admission.availableBytes $script:RunnerQueueObservation
            if ($null -ne $job) {
                if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
                Assert-RunnerTransitionClear
                $script:RunnerOperationStage = 'memory-admission'
                $profile = Get-RunnerJobProfile $config $job
                if ($null -eq $profile) { throw 'Selected runner job has unsupported resource labels.' }
                $selectedAdmission = Get-RunnerMemoryAdmission $profile.label
                if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
                if (-not $selectedAdmission.ready) {
                    Write-RunnerObservation 'waiting-capacity' $config $selectedAdmission.availableBytes $script:RunnerQueueObservation
                    Wait-RunnerPickupPoll
                    continue
                }
                if ($config.activation -eq 'pilot') {
                    $script:RunnerOperationStage = 'pilot-consumption'
                    $fresh = Get-PilotEvidence $config $job.pilotBinding $token -PickupInspection
                    if (-not (Test-QueuedRunnerJob $fresh.job $config.pilotLabel)) { throw 'Bound pilot job changed before consumption.' }
                    if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) { return }
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
            # A session catch retained its initiating failure before finally.
            # Fallback captures preclaim/verification failures only once, and
            # later idle errors have no validated session identity to overwrite.
            Write-RunnerSessionFailure $script:RunnerSessionName $_ $script:RunnerOperationStage -FirstOnly
            if ($script:RunnerOperationStage -cin @('memory-admission', 'queue-inspection', 'pilot-consumption') -and
                (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) { return }
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
        Wait-RunnerPickupPoll
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
            Assert-StateIdentity $state -AllowLegacy
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
        Show-RunnerImageProgress
        $supervisor = Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction SilentlyContinue
        if ($null -eq $state) { Write-Host "Supervisor: $($supervisor.State). Idle. Activation: $($config.activation)." }
        else {
            Assert-StateIdentity $state -AllowLegacy
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
