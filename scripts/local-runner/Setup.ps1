# Run once from an elevated owner session after reviewing this script. It never enables job pickup.
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string] $Repository = 'PHead2001/IT-Inventory-System',
    [ValidateRange(1, 2147483647)][int] $RunnerGroupId = 1,
    [switch] $EnableHyperV
)

. (Join-Path $PSScriptRoot 'Common.ps1')
if ($EnableHyperV) {
    Assert-Administrator
    $result = Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart
    Write-Host "Hyper-V feature state: $($result.State). Restart Windows if requested, then rerun Setup.ps1 without -EnableHyperV."
    return
}
Assert-HostPrerequisites

$mutex = Enter-RunnerLock
try {
    if (Test-Path -LiteralPath $script:RunnerRoot) {
        Assert-SecureRoot
    } else {
        [void][IO.Directory]::CreateDirectory($script:RunnerRoot)
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
        foreach ($sidText in @('S-1-5-18', 'S-1-5-32-544')) {
            $sid = [Security.Principal.SecurityIdentifier]::new($sidText)
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $sid, [Security.AccessControl.FileSystemRights]::FullControl,
                [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow)
            $acl.AddAccessRule($rule)
        }
        (Get-Item -LiteralPath $script:RunnerRoot).SetAccessControl($acl)
        Assert-SecureRoot
    }
    if (Test-Path -LiteralPath $script:RunnerConfigPath) {
        throw 'Setup is already present. Inspect the installed config; this command will not replace it.'
    }
    if (Get-RunnerState) { throw 'An instance is recorded; setup cannot run while it exists.' }

    $stagePath = Join-Path $script:RunnerRoot 'setup-stage.json'
    $stage = Read-RunnerJson $stagePath
    $resuming = $null -ne $stage
    if ($null -eq $stage) {
        $stage = [ordered]@{
            tag = $script:RunnerTag; repo = $Repository; group = $RunnerGroupId
            helperName = "ITInventoryImageConverter-$([guid]::NewGuid().ToString('N'))"
        }
    } elseif ($stage.tag -ne $script:RunnerTag -or $stage.repo -ne $Repository -or $stage.group -ne $RunnerGroupId) {
        throw 'Existing setup stage belongs to a different configuration.'
    }
    if ($stage.helperName -notmatch '^ITInventoryImageConverter-[0-9a-f]{32}$') {
        throw 'Existing setup stage lacks a trustworthy converter identity; refusing to adopt a WSL distribution.'
    }

    $otherNats = @(Get-NetNat -ErrorAction Stop | Where-Object Name -ne $script:RunnerNat)
    if ($otherNats.Count -gt 0) {
        throw 'Another Windows NAT exists. Setup will not alter it or the Rancher/WSL network.'
    }
    $existingSwitch = Get-VMSwitch -Name $script:RunnerSwitch -ErrorAction SilentlyContinue
    if ($null -ne $existingSwitch -and -not $resuming) { throw 'Reserved switch exists without an owned setup stage.' }
    if ($null -ne $existingSwitch -and $existingSwitch.SwitchType -ne 'Internal') {
        throw 'Reserved switch name is occupied by a non-internal switch.'
    }
    $existingNat = Get-NetNat -Name $script:RunnerNat -ErrorAction SilentlyContinue
    if ($null -ne $existingNat -and -not $resuming) { throw 'Reserved NAT exists without an owned setup stage.' }
    if ($null -ne $existingNat -and $existingNat.InternalIPInterfaceAddressPrefix -ne '172.30.240.0/29') {
        throw 'Reserved NAT name is occupied by a different network.'
    }
    $reserved = [ipaddress]::Parse('172.30.240.1').GetAddressBytes()
    foreach ($ip in Get-NetIPAddress -AddressFamily IPv4) {
        $bytes = ([ipaddress]::Parse($ip.IPAddress)).GetAddressBytes()
        if ($bytes[0] -eq $reserved[0] -and $bytes[1] -eq $reserved[1] -and $bytes[2] -eq $reserved[2] -and $bytes[3] -ge 0 -and $bytes[3] -le 7) {
            if (-not ($resuming -and $null -ne $existingSwitch -and $ip.IPAddress -eq '172.30.240.1' -and
                $ip.InterfaceAlias -eq "vEthernet ($($script:RunnerSwitch))" -and $ip.PrefixLength -eq 29)) {
                throw 'The reserved 172.30.240.0/29 runner subnet overlaps a host address.'
            }
        }
    }
    if (-not $resuming) { Write-RunnerJson $stagePath $stage }

    $imageDir = Join-Path $script:RunnerRoot 'image'
    $binDir = Join-Path $script:RunnerRoot 'bin'
    [void](Assert-OwnedPath $imageDir)
    [void](Assert-OwnedPath $binDir)
    [void](Assert-OwnedPath (Join-Path $script:RunnerRoot 'instances'))
    New-Item -ItemType Directory -Path $imageDir, $binDir, (Join-Path $script:RunnerRoot 'instances') -Force | Out-Null

    # Both hashes are fixed values published by Ubuntu for immutable release artifacts.
    $wslName = 'ubuntu-24.04.5-wsl-amd64.wsl'
    $wslHash = 'bb415d824822c4b878125729af451a5d18fb13d1cf5cbed9a7393ad64ac6039e'
    $wslPath = Join-Path $imageDir $wslName
    $imageName = 'ubuntu-24.04-server-cloudimg-amd64.img'
    $imageHash = '6a81c37564db9b1ee84e141922625e1d7c5b389b99bb3c572e0243607d5bb4d2'
    $imagePath = Join-Path $imageDir $imageName
    $vhdxPath = Join-Path $imageDir 'ubuntu-24.04-20260926.vhdx'
    foreach ($item in @(
        @{ path = $wslPath; url = "https://releases.ubuntu.com/24.04/$wslName"; hash = $wslHash },
        @{ path = $imagePath; url = "https://cloud-images.ubuntu.com/releases/noble/release-20260926/$imageName"; hash = $imageHash }
    )) {
        [void](Assert-OwnedPath $item.path)
        if (-not (Test-Path -LiteralPath $item.path)) {
            Invoke-WebRequest -Uri $item.url -OutFile $item.path -UseBasicParsing -TimeoutSec 1800
        }
        if ((Get-FileHash -LiteralPath $item.path -Algorithm SHA256).Hash -ine $item.hash) {
            throw "Downloaded Ubuntu artifact checksum mismatch: $([IO.Path]::GetFileName($item.path))"
        }
    }

    # WSL is a trusted setup tool with host integration, not a security sandbox.
    # Retire this owned converter before completed setup allows PAT storage.
    $helper = $stage.helperName
    $helperRoot = Join-Path $script:RunnerRoot 'image-converter'
    [void](Assert-OwnedPath $helperRoot)
    $registrations = @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue |
        Get-ItemProperty -ErrorAction Stop | Where-Object DistributionName -EQ $helper)
    if ($registrations.Count -gt 1) { throw 'Duplicate WSL converter registrations were found.' }
    $distros = @(wsl.exe --list --quiet | ForEach-Object { $_.Trim([char]0).Trim() })
    if ($LASTEXITCODE -ne 0) { throw 'WSL registrations could not be listed safely.' }
    if ($registrations.Count -eq 0) {
        if ($distros -contains $helper) { throw 'An unregistered WSL converter name cannot be adopted.' }
        if (Test-Path -LiteralPath $helperRoot) {
            if (-not $resuming) { throw 'Preexisting WSL converter data cannot be adopted.' }
            $links = @(Get-ChildItem -LiteralPath $helperRoot -Recurse -Force -ErrorAction Stop |
                Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
            if ($links.Count -gt 0) { throw 'Partial WSL converter data contains a reparse point.' }
            Remove-Item -LiteralPath $helperRoot -Recurse -Force -ErrorAction Stop
        }
        New-Item -ItemType Directory -Path $helperRoot -Force | Out-Null
        & wsl.exe --import $helper $helperRoot $wslPath --version 2
        if ($LASTEXITCODE -ne 0) { throw 'The dedicated Ubuntu image converter could not be imported.' }
        $registrations = @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction Stop |
            Get-ItemProperty -ErrorAction Stop | Where-Object DistributionName -EQ $helper)
    }
    if ($registrations.Count -ne 1 -or $distros -contains $helper -and -not $resuming) {
        throw 'WSL converter registration cannot be proven as this setup-owned import.'
    }
    Assert-ConverterOwnership $stage $registrations[0] $helperRoot
    Assert-ConverterTools $helper
    $receiptPath = Join-Path $imageDir 'converted-vhdx.json'
    $receipt = Read-RunnerJson $receiptPath
    $verifiedImage = $false
    if (Test-Path -LiteralPath $vhdxPath) {
        [void](Assert-OwnedPath $vhdxPath)
        $validVhdx = $false
        try { $validVhdx = [bool](Test-VHD -Path $vhdxPath) } catch { $validVhdx = $false }
        if ($null -ne $receipt -and $validVhdx) {
            $existingHash = (Get-FileHash -LiteralPath $vhdxPath -Algorithm SHA256).Hash.ToLowerInvariant()
            $verifiedImage = Test-ConvertedImageReceipt $receipt $imageHash $existingHash
        }
    }
    if (-not $verifiedImage) {
        $partialPath = Join-Path $imageDir 'ubuntu-24.04-20260926.converting.vhdx'
        [void](Assert-OwnedPath $partialPath)
        if (Test-Path -LiteralPath $partialPath) { Remove-Item -LiteralPath $partialPath -Force }
        if (Test-Path -LiteralPath $vhdxPath) { Remove-Item -LiteralPath $vhdxPath -Force }
        if (Test-Path -LiteralPath $receiptPath) { Remove-Item -LiteralPath $receiptPath -Force }
        $linuxImage = Get-ConverterLinuxPath $helper $imagePath
        $linuxVhdx = Get-ConverterLinuxPath $helper $partialPath
        $exitCode = Invoke-ConverterCommand $helper @('qemu-img', 'convert', '-f', 'qcow2', '-O', 'vhdx', '-o', 'subformat=dynamic', $linuxImage, $linuxVhdx)
        if ($exitCode -ne 0) { throw 'Ubuntu image conversion failed.' }
        if (-not (Test-VHD -Path $partialPath)) { throw 'Completed conversion failed Hyper-V VHDX validation.' }
        Resize-VHD -Path $partialPath -SizeBytes 64GB
        $convertedHash = (Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Move-Item -LiteralPath $partialPath -Destination $vhdxPath -ErrorAction Stop
        Write-RunnerJson $receiptPath ([ordered]@{
            tag = $script:RunnerTag; completed = $true
            sourceSha256 = $imageHash; outputSha256 = $convertedHash
        })
    }
    if (-not (Test-VHD -Path $vhdxPath)) { throw 'Converted VHDX failed Hyper-V validation.' }
    $vhdxHash = (Get-FileHash -LiteralPath $vhdxPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not (Test-ConvertedImageReceipt (Read-RunnerJson $receiptPath) $imageHash $vhdxHash)) {
        throw 'Converted Ubuntu image has no matching completed-conversion receipt.'
    }
    Remove-OwnedConverter $stage $helperRoot

    if ($null -eq $existingSwitch) { New-VMSwitch -Name $script:RunnerSwitch -SwitchType Internal | Out-Null }
    $interface = "vEthernet ($($script:RunnerSwitch))"
    $gateway = Get-NetIPAddress -InterfaceAlias $interface -IPAddress '172.30.240.1' -ErrorAction SilentlyContinue
    if ($null -eq $gateway) { New-NetIPAddress -InterfaceAlias $interface -IPAddress '172.30.240.1' -PrefixLength 29 | Out-Null }
    elseif ($gateway.PrefixLength -ne 29) { throw 'Reserved gateway has the wrong prefix length.' }
    if ($null -eq $existingNat) { New-NetNat -Name $script:RunnerNat -InternalIPInterfaceAddressPrefix '172.30.240.0/29' | Out-Null }

    foreach ($file in @('Common.ps1', 'Runner.ps1', 'Start.cmd', 'Restart.cmd', 'Stop.cmd', 'Status.cmd')) {
        $destination = Assert-OwnedPath (Join-Path $binDir $file)
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $destination -Force
    }
    $installed = Join-Path $binDir 'Runner.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installed`" -Action Watchdog"
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $minute = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $boot = New-ScheduledTaskTrigger -AtStartup
    Register-ScheduledTask -TaskName $script:RunnerTask -Action $action -Trigger $minute -Principal $principal -Force | Out-Null
    $supervisorAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installed`" -Action Supervise"
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $script:RunnerSupervisorTask -Action $supervisorAction -Trigger $boot -Principal $principal -Settings $settings -Force | Out-Null

    Write-RunnerJson $script:RunnerConfigPath ([ordered]@{
        schema = 1; tag = $script:RunnerTag; repo = $Repository; runnerGroupId = $RunnerGroupId
        label = 'it-inventory-ephemeral'; maxMinutes = 120; activation = 'disabled'
        baseVhdx = $vhdxPath; baseSha256 = $vhdxHash
        guestIp = '172.30.240.2'; gatewayIp = '172.30.240.1'; prefixLength = 29
    })
    Remove-Item -LiteralPath $stagePath -Force
    Write-Host 'Runner files, isolated NAT and watchdog installed. Job pickup remains disabled.'
} finally {
    Exit-RunnerLock $mutex
}
