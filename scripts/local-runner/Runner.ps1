[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Preflight', 'StoreCredential', 'Start', 'Restart', 'Stop', 'Status', 'Watchdog', 'Guard', 'Supervise', 'EnablePilot', 'EnableActive')]
    [string] $Action,
    [ValidatePattern('^ITIR-[0-9a-f]{32}$')][string] $SessionName
)

. (Join-Path $PSScriptRoot 'Common.ps1')

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

function Assert-InstalledHost($Config) {
    Assert-HostPrerequisites
    Assert-SecureRoot
    if ($Config.activation -notin @('pilot', 'active')) { throw 'Runner pickup is disabled in installed config.' }
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
    if (@(Get-VM -ErrorAction Stop | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -gt 0) {
        throw 'An owned-prefix VM already exists. Resolve it before launching another.'
    }
    if (Get-RunnerState) { throw 'Runner state exists. Stop or investigate it before launching another.' }
}

function Get-GuestCloudConfig([string] $PublicKey) {
    # cloud-init's users/groups module runs before package installation. Declare
    # docker here so runner membership succeeds before docker.io creates it.
    return @"
#cloud-config
hostname: itir-guest
manage_etc_hosts: true
groups:
  - docker
users:
  - name: runner
    lock_passwd: true
    groups: [sudo, docker]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $PublicKey
package_update: true
packages: [ca-certificates, curl, docker.io, git, openssh-server, unzip]
growpart:
  mode: auto
  devices: ['/']
resize_rootfs: true
"@
}

function New-SeedDisk([string] $Path, [string] $PublicKey, [string] $Mac, $Config) {
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
        $userData = Get-GuestCloudConfig $PublicKey
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

function Set-IsolatedAdapter([string] $VmName) {
    # Host-switch rules precede boot. Higher weights win. IPv6 and private routes are always denied.
    $installed = @()
    $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Deny -Direction Inbound -Weight 1 -Passthru
    $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Deny -Direction Outbound -Weight 1 -Passthru
    $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Deny -Direction Outbound -RemoteIPAddress '::/0' -Weight 300 -Passthru
    foreach ($prefix in @('0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4')) {
        $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Deny -Direction Outbound -RemoteIPAddress $prefix -Weight 200 -Passthru
    }
    foreach ($ip in @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty IPAddress -Unique)) {
        if ($ip -match '^\d{1,3}(\.\d{1,3}){3}$') {
            $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Deny -Direction Outbound -RemoteIPAddress "$ip/32" -Weight 250 -Passthru
        }
    }
    # Corporate/VPN destinations can have public prefixes behind a gateway.
    # Deny every non-default route, including split-default VPN /1 prefixes.
    foreach ($route in @(Get-NetRoute -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.DestinationPrefix -ne '0.0.0.0/0' })) {
        if ($route.DestinationPrefix -match '^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$') {
            $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Deny -Direction Outbound -RemoteIPAddress $route.DestinationPrefix -Weight 220 -Passthru
        }
    }
    foreach ($port in @(80, 443, 5432)) {
        $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Allow -Direction Outbound -Protocol TCP -RemotePort $port -Weight 100 -Stateful $true -Passthru
    }
    foreach ($dns in @('1.1.1.1', '8.8.8.8')) {
        foreach ($protocol in @('UDP', 'TCP')) {
            $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Allow -Direction Outbound -RemoteIPAddress $dns -RemotePort 53 -Protocol $protocol -Weight 110 -Stateful $true -Passthru
        }
    }
    $installed += Add-VMNetworkAdapterExtendedAcl -VMName $VmName -Action Allow -Direction Inbound -RemoteIPAddress '172.30.240.1' -LocalPort 22 -Protocol TCP -Weight 150 -Stateful $true -Passthru
    Assert-AdapterRules $VmName $installed
    return ,$installed
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
    if ([DateTime]::UtcNow -ge [DateTime]::Parse($State.deadlineUtc).ToUniversalTime()) { throw 'Host hard deadline reached.' }
    if (Test-Path -LiteralPath (Join-Path $State.instancePath 'stop.requested')) { throw 'Stop requested.' }
    Save-Heartbeat $State
    $current = Get-RunnerState
    if ($current.PSObject.Properties.Name -contains 'networkFingerprint') {
        if ((Get-HostNetworkFingerprint) -cne $current.networkFingerprint) { throw 'Host network changed; session cannot continue.' }
    }
    if ($current.PSObject.Properties.Name -contains 'guardianReady' -and $current.guardianReady -eq $true -and
        -not (Test-RunnerProcessIdentity $current.guardianPid $current.guardianStartUtc)) {
        throw 'Session network guardian exited; refusing further operations.'
    }
}

function Invoke-GuardCheck([string] $Name) {
    $mutex = Enter-RunnerLock
    try {
        $state = Get-RunnerState
        if ($null -eq $state -or $state.vmName -cne $Name) { return $false }
        Assert-StateIdentity $state
        $code = $null
        try {
            if ((Get-HostNetworkFingerprint) -cne $state.networkFingerprint) { $code = 'NETWORK_CHANGED' }
        } catch { $code = 'NETWORK_INSPECTION_FAILED' }
        if ($null -eq $code -and -not (Test-RunnerProcessIdentity $state.supervisorPid $state.supervisorStartUtc)) { $code = 'OWNER_EXITED' }
        if ([DateTime]::UtcNow -ge [DateTime]::Parse($state.deadlineUtc).ToUniversalTime()) { $code = 'DEADLINE_REACHED' }
        if ($null -ne $code) {
            Write-RunnerFailure 'network-guard' $code $Name
            Remove-RunnerInstance $state
            return $false
        }
        $state | Add-Member -NotePropertyName guardianPid -NotePropertyValue $PID -Force
        $state | Add-Member -NotePropertyName guardianStartUtc -NotePropertyValue ((Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')) -Force
        $state | Add-Member -NotePropertyName guardianReady -NotePropertyValue $true -Force
        Write-RunnerJson $script:RunnerStatePath $state
        return $true
    } finally { Exit-RunnerLock $mutex }
}

function Start-SessionGuardian($State) {
    $installed = Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1'
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installed`" -Action Guard -SessionName $($State.vmName)"
    $guardian = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
    try {
        $limit = [DateTime]::UtcNow.AddSeconds(10)
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
    $mutex = Enter-RunnerLock
    try {
        Assert-SessionAlive $State
        $current = Get-RunnerState
        if ($current.vmName -cne $State.vmName -or $current.guardianReady -ne $true) { throw 'VM boot requires its ready guardian.' }
        Assert-RunnerVmLifecycle $State.vmName
        Start-VM -Name $State.vmName
    } finally { Exit-RunnerLock $mutex }
}

function Get-SshArgs($State) {
    return @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=2', '-o', 'StrictHostKeyChecking=accept-new',
        '-o', "UserKnownHostsFile=$($State.instancePath)\known_hosts", '-i', "$($State.instancePath)\id_ed25519")
}

function Wait-Guest($State, $Config) {
    $args = Get-SshArgs $State
    $limit = [DateTime]::UtcNow.AddMinutes(12)
    while ([DateTime]::UtcNow -lt $limit) {
        Assert-SessionAlive $State
        $exitCode = Invoke-RunnerNative 'ssh.exe' ($args + @("runner@$($Config.guestIp)", 'timeout 25 cloud-init status --wait >/dev/null 2>&1 && test -S /var/run/docker.sock && test "$(id -un)" = runner && timeout 10 docker info >/dev/null 2>&1'))
        if ($exitCode -eq 0) { return }
        Start-Sleep -Seconds 10
    }
    throw 'Guest never reached cloud-init/Docker readiness.'
}

function Get-RunnerArchive($State) {
    $release = Invoke-GitHub 'https://api.github.com/repos/actions/runner/releases/latest'
    $assets = @($release.assets | Where-Object name -Match '^actions-runner-linux-x64-[0-9.]+\.tar\.gz$')
    if ($assets.Count -ne 1) {
        throw 'GitHub runner release has no unique Linux x64 archive with an SHA-256 digest.'
    }
    $digestMatch = [regex]::Match([string]$assets[0].digest, '^sha256:([0-9a-f]{64})$')
    if (-not $digestMatch.Success) { throw 'GitHub runner archive has no SHA-256 digest.' }
    $expectedDigest = $digestMatch.Groups[1].Value
    $path = Join-Path $State.instancePath 'runner.tar.gz'
    Invoke-WebRequest -Uri $assets[0].browser_download_url -OutFile $path -UseBasicParsing -TimeoutSec 1800
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $expectedDigest) {
        throw 'GitHub runner archive digest mismatch.'
    }
    return $path
}

function Invoke-RunnerSession($Config) {
    $script:RunnerOperationStage = 'preflight'
    Assert-InstalledHost $Config
    [void](Get-OwnerToken) # Check owner binding before changing the host or contacting GitHub.
    $name = "$($script:RunnerPrefix)$([guid]::NewGuid().ToString('N'))"
    $script:RunnerSessionName = $name
    $instance = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'instances') $name)
    $state = [ordered]@{
        tag = $script:RunnerTag; vmName = $name; instancePath = $instance
        createdUtc = [DateTime]::UtcNow.ToString('o'); heartbeatUtc = [DateTime]::UtcNow.ToString('o')
        deadlineUtc = [DateTime]::UtcNow.AddMinutes($Config.maxMinutes).ToString('o')
        supervisorPid = $PID
        supervisorStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    }
    $mutex = Enter-RunnerLock
    try {
        if (Get-RunnerState) { throw 'Another runner session is already recorded.' }
        New-Item -ItemType Directory -Path $instance -Force | Out-Null
        Write-RunnerJson $script:RunnerStatePath $state
    } finally { Exit-RunnerLock $mutex }
    try {
        $script:RunnerOperationStage = 'disk-copy'
        $disk = Join-Path $instance 'guest.vhdx'
        Copy-Item -LiteralPath $Config.baseVhdx -Destination $disk -ErrorAction Stop
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
            Write-RunnerJson $script:RunnerStatePath $current
            $vm = New-VM -Name $name -Generation 2 -VHDPath $disk -Path $instance -MemoryStartupBytes 8GB -SwitchName $script:RunnerSwitch
            Set-VM -Name $name -Notes $script:RunnerTag -AutomaticCheckpointsEnabled $false -CheckpointType Disabled -AutomaticStartAction Nothing -AutomaticStopAction TurnOff
            Assert-RunnerVmLifecycle $name
            if ((Get-VM -Name $name -ErrorAction Stop).Notes -ne $script:RunnerTag) { throw 'VM ownership tag readback failed.' }
            $current.phase = 'owned'
            Write-RunnerJson $script:RunnerStatePath $current
        } finally { Exit-RunnerLock $mutex }
        $script:RunnerOperationStage = 'vm-configuration'
        Set-VMProcessor -VMName $name -Count 4
        Set-VMMemory -VMName $name -DynamicMemoryEnabled $false
        Set-VMFirmware -VMName $name -EnableSecureBoot On -SecureBootTemplate 'MicrosoftUEFICertificateAuthority'
        foreach ($service in @(Get-VMIntegrationService -VMName $name | Where-Object Name -Match 'Guest Service')) {
            Disable-VMIntegrationService -VMName $name -Name $service.Name
        }
        $mac = (Get-VMNetworkAdapter -VMName $name).MacAddress.ToLowerInvariant() -replace '(..)(?!$)', '$1:'
        $seed = Join-Path $instance 'cidata.vhdx'
        New-SeedDisk $seed $key $mac $Config
        Add-VMHardDiskDrive -VMName $name -Path $seed
        $script:RunnerOperationStage = 'network-isolation'
        $mutex = Enter-RunnerLock
        try {
            $current = Get-RunnerState
            if ($null -eq $current -or $current.vmName -cne $name) { throw 'Session removed before network isolation.' }
            $current | Add-Member -NotePropertyName networkFingerprint -NotePropertyValue (Get-HostNetworkFingerprint) -Force
            Write-RunnerJson $script:RunnerStatePath $current
        } finally { Exit-RunnerLock $mutex }
        $expectedRules = Set-IsolatedAdapter $name
        Start-SessionGuardian $state
        Start-GuardedVm $state
        $script:RunnerOperationStage = 'guest-readiness'
        Wait-Guest $state $Config
        Assert-SessionAlive $state
        Assert-AdapterRules $name $expectedRules
        Test-GuestIsolation $state $Config

        $script:RunnerOperationStage = 'runner-download'
        $archive = Get-RunnerArchive $state
        $sshArgs = Get-SshArgs $state
        $script:RunnerOperationStage = 'runner-transfer'
        $exitCode = Invoke-RunnerNative 'scp.exe' ($sshArgs + @($archive, "runner@$($Config.guestIp):/home/runner/runner.tar.gz"))
        if ($exitCode -ne 0) { throw 'Runner archive transfer failed.' }
        $exitCode = Invoke-RunnerNative 'ssh.exe' ($sshArgs + @("runner@$($Config.guestIp)", 'mkdir -p ~/actions-runner && tar -xzf ~/runner.tar.gz -C ~/actions-runner && rm ~/runner.tar.gz'))
        if ($exitCode -ne 0) { throw 'Runner archive extraction failed.' }
        Assert-SessionAlive $state
        Assert-AdapterRules $name $expectedRules

        # The repository-scoped PAT remains on Windows. Only the one-job JIT value enters the guest.
        $token = Get-OwnerToken
        $parts = $Config.repo.Split('/')
        $script:RunnerOperationStage = 'jit-registration'
        Assert-SessionAlive $state # Fresh snapshot immediately before the JIT API call.
        $jit = Invoke-GitHub "https://api.github.com/repos/$($parts[0])/$($parts[1])/actions/runners/generate-jitconfig" 'POST' @{
            name = $name; runner_group_id = $Config.runnerGroupId; labels = @($Config.label); work_folder = '_work'
        } $token
        $token = $null
        if ($jit.encoded_jit_config -notmatch '^[A-Za-z0-9+/=]+$' -or $jit.runner.name -ne $name -or
            $null -eq $jit.runner.id -or $jit.runner.id -le 0) {
            throw 'GitHub returned an invalid or mismatched JIT runner configuration.'
        }
        $runnerId = [long]$jit.runner.id
        Assert-SessionAlive $state
        Write-Host "JIT runner $name is waiting for one GitHub job. Hard deadline: $($state.deadlineUtc) UTC."
        # A JIT runner exits after one job. No guest output or secret-bearing config is logged on the host.
        $script:RunnerOperationStage = 'job-execution'
        $exitCode = Invoke-RunnerNative 'ssh.exe' ($sshArgs + @("runner@$($Config.guestIp)", 'read -r JIT; cd ~/actions-runner; exec ./run.sh --jitconfig "$JIT" >/dev/null 2>&1')) $jit.encoded_jit_config
        if ($exitCode -ne 0) { throw 'JIT runner process ended abnormally; check GitHub Actions job state.' }
        Write-Host 'Runner process ended; consult GitHub Actions for the actual job result.'
        return [pscustomobject]@{ name = $name; id = $runnerId }
    } finally {
        $mutex = Enter-RunnerLock
        try {
            $current = Get-RunnerState
            if ($null -ne $current -and $current.vmName -eq $name) { Remove-RunnerInstance $current }
        } catch {
            Write-RunnerFailure 'cleanup' 'STAGE_FAILED' $name
            throw
        } finally { Exit-RunnerLock $mutex }
    }
}

function Get-QueuedRunnerJob($Config, [string] $Token) {
    $parts = $Config.repo.Split('/')
    $base = "https://api.github.com/repos/$($parts[0])/$($parts[1])/actions"
    foreach ($runStatus in @('queued', 'in_progress')) {
        $runs = Invoke-GitHub "$base/runs?status=$runStatus&per_page=100" 'GET' $null $Token
        if ($runs.total_count -gt 100) { throw 'Workflow run queue exceeds the bounded API view.' }
        foreach ($run in @($runs.workflow_runs)) {
            $jobs = Invoke-GitHub "$base/runs/$($run.id)/jobs?filter=latest&per_page=100" 'GET' $null $Token
            if ($jobs.total_count -gt 100) { throw 'Workflow job queue exceeds the bounded API view.' }
            foreach ($job in @($jobs.jobs)) {
                if (Test-QueuedRunnerJob $job $Config.label) {
                    return $job
                }
            }
        }
    }
    return $null
}

function Invoke-Supervisor {
    Assert-Administrator
    Assert-SecureRoot
    # One process owns recovery and pickup, including boot and manual starts.
    $supervisorMutex = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1'
    try {
        $mutex = Enter-RunnerLock
        try { $stale = Get-RunnerState; if ($null -ne $stale) { Remove-RunnerInstance $stale } }
        finally { Exit-RunnerLock $mutex }
        Invoke-SupervisorLoop
    } finally { Exit-RunnerLock $supervisorMutex }
}

function Invoke-SupervisorLoop {
    while (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) {
        $config = Get-RunnerConfig
        if ($config.activation -notin @('pilot', 'active')) {
            Start-Sleep -Seconds 30
            continue
        }
        $pilotAttemptPath = Join-Path $script:RunnerRoot 'pilot-attempt.json'
        if ($config.activation -eq 'pilot' -and (Test-Path -LiteralPath $pilotAttemptPath)) {
            # A crashed or restarted supervisor must not take a second pilot job.
            return
        }
        try {
            $script:RunnerSessionName = $null
            $script:RunnerOperationStage = 'queue-inspection'
            $token = Get-OwnerToken
            $job = Get-QueuedRunnerJob $config $token
            $token = $null
            if ($null -ne $job) {
                if ($config.activation -eq 'pilot') {
                    $script:RunnerOperationStage = 'pilot-consumption'
                    Write-RunnerJson $pilotAttemptPath ([ordered]@{
                        tag = $script:RunnerTag; jobId = $job.id
                        consumedUtc = [DateTime]::UtcNow.ToString('o')
                    })
                }
                $allocatedRunner = Invoke-RunnerSession $config
                if ($config.activation -eq 'pilot') {
                    $script:RunnerOperationStage = 'pilot-verification'
                    $token = Get-OwnerToken
                    $parts = $config.repo.Split('/')
                    $result = $null
                    $limit = [DateTime]::UtcNow.AddSeconds(60)
                    do {
                        $result = Invoke-GitHub "https://api.github.com/repos/$($parts[0])/$($parts[1])/actions/jobs/$($job.id)" 'GET' $null $token
                        if ($result.status -eq 'completed') { break }
                        Start-Sleep -Seconds 5
                    } while ([DateTime]::UtcNow -lt $limit)
                    $token = $null
                    Write-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json') ([ordered]@{
                        tag = $script:RunnerTag; jobId = $job.id; status = $result.status
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
            # API/guest failures never register a fallback runner. The next bounded poll may retry.
            $existing = Read-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json')
            if ($null -eq $existing -or $null -eq $script:RunnerSessionName -or $existing.sessionName -cne $script:RunnerSessionName) {
                Write-RunnerFailure $script:RunnerOperationStage 'STAGE_FAILED' $script:RunnerSessionName
            }
            Write-EventLog -LogName Application -Source 'Windows PowerShell' -EntryType Error -EventId 500 -Message "IT Inventory runner stage failed: $script:RunnerOperationStage" -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 30
    }
}

function Stop-Supervisor {
    Assert-Administrator
    Assert-SecureRoot
    [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop', [Text.UTF8Encoding]::new($false))
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

function Invoke-Watchdog {
    Assert-Administrator
    $mutex = Enter-RunnerLock
    try {
        $state = Get-RunnerState
        if ($null -eq $state) { return }
        Assert-StateIdentity $state
        $deadline = [DateTime]::Parse($state.deadlineUtc).ToUniversalTime()
        $ownerAlive = Test-RunnerProcessIdentity $state.supervisorPid $state.supervisorStartUtc
        $guardianDead = $state.PSObject.Properties.Name -contains 'guardianReady' -and $state.guardianReady -eq $true -and
            -not (Test-RunnerProcessIdentity $state.guardianPid $state.guardianStartUtc)
        if ([DateTime]::UtcNow -ge $deadline -or -not $ownerAlive -or $guardianDead) {
            Remove-RunnerInstance $state
        }
    } finally { Exit-RunnerLock $mutex }
}

switch ($Action) {
    'Preflight' {
        Assert-HostPrerequisites
        $config = Get-RunnerConfig
        Write-Host "Host prerequisites present. Repository: $($config.repo). Activation: $($config.activation)."
    }
    'StoreCredential' {
        Assert-Administrator
        Assert-SecureRoot
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
        Assert-Administrator
        Assert-SecureRoot
        $config = Get-RunnerConfig
        if ($config.activation -eq 'disabled') { throw 'Job pickup is disabled. Open Setup and choose Enable one-job pilot after review.' }
        if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested')) {
            Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested') -Force
        }
        Start-ScheduledTask -TaskName $script:RunnerSupervisorTask
        Write-Host 'Persistent SYSTEM supervisor started; it waits for a matching queued job.'
    }
    'Restart' {
        Stop-Supervisor
        Remove-Item -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested') -Force
        Start-ScheduledTask -TaskName $script:RunnerSupervisorTask
        Write-Host 'Supervisor restarted. Its next job uses a new VM.'
    }
    'Stop' {
        Stop-Supervisor
        Write-Host 'Supervisor stopped and its owned VM removed.'
    }
    'Status' {
        Assert-Administrator
        Assert-SecureRoot
        $config = Get-RunnerConfig
        $state = Get-RunnerState
        $supervisor = Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction SilentlyContinue
        if ($null -eq $state) { Write-Host "Supervisor: $($supervisor.State). Idle. Activation: $($config.activation)." }
        else {
            Assert-StateIdentity $state
            $vm = Get-VM -Name $state.vmName -ErrorAction SilentlyContinue
            Write-Host "VM: $($state.vmName); state: $(if ($vm) { $vm.State } else { 'missing' }); deadline: $($state.deadlineUtc); heartbeat: $($state.heartbeatUtc)."
        }
        $recentError = Read-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json')
        if ($null -ne $recentError) { Write-Host "Last supervisor failure ($($recentError.atUtc)): stage=$($recentError.stage); code=$($recentError.code)." }
        $attempt = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json')
        if ($null -ne $attempt) { Write-Host "Pilot consumed for job $($attempt.jobId). Failure or uncertainty requires maintainer investigation; it cannot take another pilot job." }
        $pilot = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json')
        if ($null -ne $pilot) { Write-Host "Pilot proof: status=$($pilot.status); conclusion=$($pilot.conclusion); verified=$($pilot.verified)." }
    }
    'Watchdog' { Invoke-Watchdog }
    'Guard' {
        Assert-Administrator
        Assert-SecureRoot
        if (-not $SessionName) { throw 'Network guard requires one exact session identity.' }
        while (Invoke-GuardCheck $SessionName) { Start-Sleep -Seconds 1 }
    }
    'Supervise' { Invoke-Supervisor }
    'EnablePilot' {
        Assert-Administrator
        Assert-SecureRoot
        $config = Get-RunnerConfig
        [void](Get-OwnerToken)
        if ($config.activation -ne 'disabled') { throw 'Pilot can only be enabled from disabled state.' }
        if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')) {
            throw 'A previous pilot attempt exists; do not silently reset one-job proof.'
        }
        $config.activation = 'pilot'
        Write-RunnerJson $script:RunnerConfigPath $config
        Write-Host 'One-job pilot enabled. Supervisor will stop after its first matching job.'
    }
    'EnableActive' {
        Assert-Administrator
        Assert-SecureRoot
        $config = Get-RunnerConfig
        $result = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-result.json')
        $attempt = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json')
        if ($config.activation -ne 'pilot' -or $null -eq $attempt -or $attempt.tag -ne $script:RunnerTag -or
            $null -eq $result -or $result.tag -ne $script:RunnerTag -or $result.jobId -ne $attempt.jobId -or
            $result.verified -ne $true -or $result.status -ne 'completed' -or
            $result.conclusion -ne 'success' -or $result.runnerName -cne $result.allocatedRunnerName -or
            $result.runnerId -ne $result.allocatedRunnerId) {
            throw 'A successful recorded pilot job is required before persistent pickup.'
        }
        $config.activation = 'active'
        Write-RunnerJson $script:RunnerConfigPath $config
        Write-Host 'Persistent job pickup enabled. Start the supervisor shortcut.'
    }
}
