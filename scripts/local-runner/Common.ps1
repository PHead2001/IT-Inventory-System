Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RunnerRoot = Join-Path $env:ProgramData 'ITInventoryLocalRunner'
$script:RunnerTag = 'it-inventory-local-runner-v1'
$script:RunnerPrefix = 'ITIR-'
$script:RunnerSwitch = 'ITIR-Isolated'
$script:RunnerNat = 'ITIR-Nat'
$script:RunnerTask = 'ITInventoryLocalRunner-Watchdog'
$script:RunnerBootTask = 'ITInventoryLocalRunner-BootCleanup'
$script:RunnerSupervisorTask = 'ITInventoryLocalRunner-Supervisor'
$script:RunnerConfigPath = Join-Path $script:RunnerRoot 'config.json'
$script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this shortcut from an elevated PowerShell session. No host changes were made.'
    }
}

function Assert-OwnedPath([string] $Path) {
    $root = [IO.Path]::GetFullPath($script:RunnerRoot).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath($Path)
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing a path outside the fixed runner root: $target"
    }
    $probe = $target
    while ($probe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing a reparse point in the runner data tree: $probe"
            }
        }
        $probe = [IO.Path]::GetDirectoryName($probe)
    }
    return $target
}

function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1') {
    $mutex = [Threading.Mutex]::new($false, $Name)
    try {
        try {
            if (-not $mutex.WaitOne([TimeSpan]::FromSeconds(20))) {
                throw 'Runner state is busy; retry after the other operation finishes.'
            }
        } catch [Threading.AbandonedMutexException] {
            # Windows grants ownership to this caller when the former owner dies.
            # The watchdog must still be able to inspect and remove the old VM.
        }
        return $mutex
    } catch {
        $mutex.Dispose()
        throw
    }
}

function Test-QueuedRunnerJob($Job, [string] $Label) {
    return $Job.status -eq 'queued' -and $Job.labels -contains 'self-hosted' -and
        $Job.labels -contains $Label -and ($null -eq $Job.runner_id -or $Job.runner_id -eq 0)
}

function Test-PilotJobResult($Result, [string] $RunnerName, [long] $RunnerId) {
    return $Result.status -eq 'completed' -and $Result.conclusion -eq 'success' -and
        $Result.runner_name -ceq $RunnerName -and $Result.runner_id -eq $RunnerId
}

function Assert-ConverterOwnership($Stage, $Registration, [string] $HelperRoot) {
    if ($Stage.helperName -notmatch '^ITInventoryImageConverter-[0-9a-f]{32}$') {
        throw 'Setup stage has no valid dedicated image-converter identity.'
    }
    [void](Assert-OwnedPath $HelperRoot)
    if ($null -eq $Registration -or $Registration.DistributionName -cne $Stage.helperName -or
        -not [string]::Equals([IO.Path]::GetFullPath([string]$Registration.BasePath).TrimEnd('\'),
            [IO.Path]::GetFullPath($HelperRoot).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Existing WSL image converter does not match the protected setup stage and owned base path.'
    }
}

function Test-ConvertedImageReceipt($Receipt, [string] $SourceHash, [string] $OutputHash) {
    return $null -ne $Receipt -and $Receipt.tag -eq $script:RunnerTag -and
        $Receipt.sourceSha256 -ieq $SourceHash -and $Receipt.outputSha256 -ieq $OutputHash -and
        $Receipt.completed -eq $true
}

function Exit-RunnerLock($Mutex) {
    $Mutex.ReleaseMutex()
    $Mutex.Dispose()
}

function Read-RunnerJson([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-RunnerJson([string] $Path, $Value) {
    $Path = Assert-OwnedPath $Path
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    $backup = "$Path.$([guid]::NewGuid().ToString('N')).bak"
    $json = ConvertTo-Json -InputObject $Value -Depth 10 -Compress
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    try {
        if (Test-Path -LiteralPath $Path) {
            [IO.File]::Replace($temporary, $Path, $backup)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

function Get-RunnerConfig {
    $config = Read-RunnerJson $script:RunnerConfigPath
    if ($null -eq $config) { throw 'Runner setup is incomplete: config.json is missing.' }
    if ($config.schema -ne 1 -or $config.tag -ne $script:RunnerTag) {
        throw 'Runner config identity or schema is invalid.'
    }
    if ($config.repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
        throw 'Runner config repository is invalid.'
    }
    if ($config.maxMinutes -lt 10 -or $config.maxMinutes -gt 360) {
        throw 'Runner hard deadline must be between 10 and 360 minutes.'
    }
    return $config
}

function Assert-HostPrerequisites {
    Assert-Administrator
    if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
        throw 'Hyper-V tools are unavailable. Run Setup.ps1 -EnableHyperV once as Administrator, restart Windows if requested, then run Setup.ps1.'
    }
    foreach ($name in @('Get-VM', 'New-VM', 'Get-VMSwitch', 'New-VMSwitch', 'Add-VMNetworkAdapterExtendedAcl', 'Get-VMNetworkAdapterExtendedAcl', 'New-VHD', 'Mount-VHD', 'Get-VHD', 'Test-VHD', 'Resize-VHD', 'Get-NetNat', 'New-NetNat', 'Get-ScheduledTask', 'Start-ScheduledTask')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Hyper-V prerequisite unavailable: $name" }
    }
    foreach ($name in @('ssh.exe', 'scp.exe', 'ssh-keygen.exe', 'wsl.exe')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Host prerequisite unavailable: $name" }
    }
    $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V
    if ($feature.State -ne 'Enabled') { throw 'Hyper-V is not enabled. Setup cannot continue.' }
    if ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory -lt 24GB) {
        throw 'At least 24 GiB physical RAM is required for the 8 GiB VM and host workload.'
    }
    $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($script:RunnerRoot).TrimEnd(':\'))
    if ($drive.Free -lt 80GB) { throw 'At least 80 GiB free on the runner data volume is required.' }
}

function Assert-SecureRoot {
    if (-not (Test-Path -LiteralPath $script:RunnerRoot -PathType Container)) {
        throw 'Fixed runner data root is missing.'
    }
    $item = Get-Item -LiteralPath $script:RunnerRoot -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Runner data root may not be a reparse point.'
    }
    $acl = Get-Acl -LiteralPath $script:RunnerRoot
    if (-not $acl.AreAccessRulesProtected) { throw 'Runner data root inherits permissions; refusing use.' }
    $allowed = @('S-1-5-18', 'S-1-5-32-544')
    $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($allowed -notcontains $ownerSid) { throw "Runner data root has an unexpected owner: $ownerSid" }
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid) {
            throw "Runner data root grants access to an unexpected principal: $sid"
        }
    }
}

function Get-RunnerState { return Read-RunnerJson $script:RunnerStatePath }

function Assert-StateIdentity($State) {
    if ($State.tag -ne $script:RunnerTag -or $State.vmName -notmatch '^ITIR-[0-9a-f]{32}$') {
        throw 'Runner state identity is invalid; manual investigation is required.'
    }
    [void](Assert-OwnedPath $State.instancePath)
    if (-not $State.instancePath.EndsWith($State.vmName, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runner state instance path does not match its VM name.'
    }
}

function Remove-RunnerInstance($State) {
    Assert-StateIdentity $State
    $vm = Get-VM -Name $State.vmName -ErrorAction SilentlyContinue
    if ($null -ne $vm) {
        $disk = @(Get-VMHardDiskDrive -VMName $State.vmName)
        foreach ($entry in $disk) {
            [void](Assert-OwnedPath $entry.Path)
        }
        $vmPath = [IO.Path]::GetFullPath($vm.Path)
        $ownedVmPath = [IO.Path]::GetFullPath($State.instancePath).TrimEnd('\')
        if ($vm.Notes -ne $script:RunnerTag -or
            -not ($vmPath.Equals($ownedVmPath, [StringComparison]::OrdinalIgnoreCase) -or
                $vmPath.StartsWith($ownedVmPath + '\', [StringComparison]::OrdinalIgnoreCase))) {
            throw 'VM identity does not match owned state; refusing deletion.'
        }
        if ($vm.State -ne 'Off') { Stop-VM -Name $State.vmName -TurnOff -Force -ErrorAction Stop }
        Remove-VM -Name $State.vmName -Force -ErrorAction Stop
    }
    $instancePath = Assert-OwnedPath $State.instancePath
    if (Test-Path -LiteralPath $instancePath) {
        $links = @(Get-ChildItem -LiteralPath $instancePath -Recurse -Force -ErrorAction Stop |
            Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
        if ($links.Count -gt 0) { throw 'Refusing recursive deletion of an instance containing a reparse point.' }
        Remove-Item -LiteralPath $instancePath -Recurse -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $script:RunnerStatePath) {
        Remove-Item -LiteralPath $script:RunnerStatePath -Force
    }
}
