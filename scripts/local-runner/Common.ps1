Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RunnerRoot = Join-Path $env:ProgramData 'ITInventoryLocalRunner'
$script:RunnerTag = 'it-inventory-local-runner-v1'
$script:RunnerPrefix = 'ITIR-'
$script:RunnerSwitch = 'ITIR-Isolated'
$script:RunnerNat = 'ITIR-Nat'
$script:RunnerTask = 'ITInventoryLocalRunner-Watchdog'
$script:RunnerSupervisorTask = 'ITInventoryLocalRunner-Supervisor'
$script:RunnerConfigPath = Join-Path $script:RunnerRoot 'config.json'
$script:RunnerStatePath = Join-Path $script:RunnerRoot 'state.json'
$script:RunnerOperationStage = 'idle'
$script:RunnerSessionName = $null

function Initialize-RunnerDpapi {
    # Fresh Windows PowerShell 5.1 sessions do not preload ProtectedData.
    # Fail before a secure prompt/read if its framework assembly is unavailable.
    Add-Type -AssemblyName System.Security -ErrorAction Stop
}

function Write-RunnerFailure([string] $Stage, [ValidateSet('STAGE_FAILED', 'NETWORK_CHANGED', 'NETWORK_INSPECTION_FAILED', 'OWNER_EXITED', 'DEADLINE_REACHED')][string] $Code, [string] $SessionName = '') {
    Write-RunnerJson (Join-Path $script:RunnerRoot 'last-error.json') ([ordered]@{
        atUtc = [DateTime]::UtcNow.ToString('o'); stage = $Stage; code = $Code; sessionName = $SessionName
    })
}

function Get-HostNetworkFingerprint {
    $records = @(
        foreach ($ip in @(Get-NetIPAddress -ErrorAction Stop)) {
            'address|{0}|{1}|{2}|{3}' -f $ip.AddressFamily, $ip.IPAddress, $ip.PrefixLength, $ip.InterfaceIndex
        }
        foreach ($route in @(Get-NetRoute -ErrorAction Stop)) {
            'route|{0}|{1}|{2}|{3}' -f $route.AddressFamily, $route.DestinationPrefix, $route.NextHop, $route.InterfaceIndex
        }
    )
    if ($records.Count -eq 0) { throw 'Host network inspection returned no addresses or routes.' }
    $canonical = (@($records | Sort-Object -Unique) -join "`n")
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}

function Test-RunnerProcessIdentity([int] $ProcessId, [string] $StartUtc) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    return $null -ne $process -and
        [Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($StartUtc).ToUniversalTime()).TotalSeconds) -lt 2
}

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

function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    $mutex = [Threading.Mutex]::new($false, $Name)
    try {
        try {
            $timeout = if ($FailFast) { [TimeSpan]::Zero } else { [TimeSpan]::FromSeconds(20) }
            if (-not $mutex.WaitOne($timeout)) {
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

# Owner commands never queue behind another command. Background lifetime/state
# locks deliberately do not acquire this mutex. Lock order: control, supervisor, state.
function Invoke-RunnerControl([scriptblock] $Work) {
    $control = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Control-v1' -FailFast
    try { & $Work } finally { Exit-RunnerLock $control }
}

function Test-QueuedRunnerJob($Job, [string] $Label) {
    $labels = @($Job.labels)
    if ($labels -cnotcontains 'self-hosted' -or $labels -cnotcontains $Label -or
        $labels.Count -ne @($labels | Select-Object -Unique).Count -or
        @($labels | Where-Object { $_ -cnotin @('self-hosted', 'Linux', 'X64', $Label) }).Count -ne 0) { return $false }
    return $Job.status -eq 'queued' -and ($null -eq $Job.runner_id -or $Job.runner_id -eq 0)
}

function Test-PilotJobResult($Result, [string] $RunnerName, [long] $RunnerId) {
    return $Result.status -eq 'completed' -and $Result.conclusion -eq 'success' -and
        $Result.runner_name -ceq $RunnerName -and $Result.runner_id -eq $RunnerId
}

function Get-PilotLabel([string] $Sha) {
    if ($Sha -cnotmatch '^[0-9a-f]{40}$') { throw 'Pilot requires the intended full lowercase 40-character commit SHA.' }
    return "it-inventory-pilot-$Sha"
}

function Assert-PilotConfig($Config) {
    foreach ($field in @('pilotExpectedSha', 'pilotWorkflowPath', 'pilotLabel')) {
        if ($Config.PSObject.Properties.Name -notcontains $field) { throw 'Pilot workflow/SHA binding is missing; pickup refused.' }
    }
    $label = Get-PilotLabel $Config.pilotExpectedSha
    if ($Config.pilotWorkflowPath -cne '.github/workflows/local-runner-pilot.yml' -or $Config.pilotLabel -cne $label) {
        throw 'Pilot workflow/SHA label binding is invalid; pickup refused.'
    }
}

function Test-PilotEvidence($Config, $Run, $Workflow, $Job, $Binding = $null) {
    Assert-PilotConfig $Config
    if ($null -eq $Run -or $null -eq $Workflow -or $null -eq $Job) { return $false }
    foreach ($field in @('id', 'workflow_id', 'head_sha', 'run_attempt')) {
        if ($Run.PSObject.Properties.Name -notcontains $field) { return $false }
    }
    foreach ($field in @('id', 'path')) { if ($Workflow.PSObject.Properties.Name -notcontains $field) { return $false } }
    foreach ($field in @('id', 'run_id', 'head_sha', 'labels')) { if ($Job.PSObject.Properties.Name -notcontains $field) { return $false } }
    if ($Run.id -le 0 -or $Run.workflow_id -le 0 -or $Run.run_attempt -lt 1 -or $Job.id -le 0 -or
        $Workflow.id -ne $Run.workflow_id -or $Workflow.path -cne $Config.pilotWorkflowPath -or
        $Run.head_sha -cne $Config.pilotExpectedSha -or $Job.head_sha -cne $Config.pilotExpectedSha -or
        $Job.run_id -ne $Run.id -or $Job.labels -notcontains $Config.pilotLabel -or $Job.labels -notcontains 'self-hosted') {
        return $false
    }
    if ($null -eq (Get-RunnerJobProfile $Config $Job)) { return $false }
    if ($null -ne $Binding) {
        foreach ($field in @('jobId', 'runId', 'workflowId', 'workflowPath', 'headSha', 'runAttempt', 'pilotLabel')) {
            if ($Binding.PSObject.Properties.Name -notcontains $field) { return $false }
        }
        if ($Binding.jobId -ne $Job.id -or $Binding.runId -ne $Run.id -or $Binding.workflowId -ne $Workflow.id -or
            $Binding.workflowPath -cne $Workflow.path -or $Binding.headSha -cne $Run.head_sha -or
            $Binding.runAttempt -ne $Run.run_attempt -or $Binding.pilotLabel -cne $Config.pilotLabel) { return $false }
    }
    return $true
}

# Resource requirements are a fixed host-code allowlist, never workflow/config memory values.
function Get-RunnerResourceProfile([string] $Label) {
    $memory = switch -CaseSensitive ($Label) {
        'it-inventory-light' { 2GB; break }
        'it-inventory-mid' { 4GB; break }
        'it-inventory-heavy' { 6GB; break }
        'it-inventory-ephemeral' { 8GB; break }
        default {
            if ($Label -cmatch '^it-inventory-pilot-[0-9a-f]{40}$') { 8GB }
            else { throw 'Unsupported runner resource label.' }
        }
    }
    $reserve = if ($Label -ceq 'it-inventory-heavy') { 1GB } else { 2GB }
    return [pscustomobject]@{ label = $Label; memoryBytes = $memory; hostReserveBytes = $reserve; requiredBytes = ($memory + $reserve) }
}

function Get-RunnerSessionProfile($Config, [string] $ProfileLabel = '') {
    if ($Config.activation -eq 'pilot') {
        Assert-PilotConfig $Config
        if ($ProfileLabel -and $ProfileLabel -cne $Config.pilotLabel) { throw 'Pilot resource label differs from its exact SHA binding.' }
        return Get-RunnerResourceProfile $Config.pilotLabel
    }
    if (-not $ProfileLabel) { $ProfileLabel = $Config.label } # Older direct callers retain the legacy 8 GiB profile.
    if ($ProfileLabel -cmatch '^it-inventory-pilot-') { throw 'Active pickup cannot advertise a pilot label.' }
    return Get-RunnerResourceProfile $ProfileLabel
}

function Get-RunnerJobProfile($Config, $Job) {
    if ($null -eq $Job -or $Job.PSObject.Properties.Name -notcontains 'labels') { return $null }
    $labels = @($Job.labels)
    if ($labels -cnotcontains 'self-hosted' -or $labels.Count -ne @($labels | Select-Object -Unique).Count) { return $null }
    $custom = @($labels | Where-Object { $_ -cnotin @('self-hosted', 'Linux', 'X64') })
    if ($custom.Count -ne 1) { return $null }
    try { return Get-RunnerSessionProfile $Config ([string]$custom[0]) }
    catch { return $null } # Unsupported/mixed requests are ineligible, not a queue-wide failure.
}

function Get-RunnerJitLabels($Config, [string] $ProfileLabel = '') {
    $profile = Get-RunnerSessionProfile $Config $ProfileLabel
    # A provisioned heavy guest must not be diverted to a queued light job.
    # Pilot and legacy callers retain their single custom label as before.
    return @('self-hosted', 'Linux', 'X64', $profile.label)
}

function Assert-RunnerJitLabels($Config, $Runner, [string] $ProfileLabel = '') {
    $expected = @(Get-RunnerJitLabels $Config $ProfileLabel | Sort-Object)
    $actual = @($Runner.labels | Select-Object -ExpandProperty name | Sort-Object)
    if ($actual.Count -ne $expected.Count -or (Compare-Object -CaseSensitive $expected $actual)) {
        throw 'GitHub JIT runner labels differ from the fixed capacity routing allowlist.'
    }
}

function ConvertTo-RunnerLocalPath([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Runner path is empty.' }
    if ($Path.StartsWith('\\?\', [StringComparison]::Ordinal)) {
        # WSL stores local BasePath using extended DOS syntax. Only remove this
        # prefix for an unambiguous drive-qualified path, never UNC/device paths.
        $Path = $Path.Substring(4)
        if ($Path.Contains('/') -or $Path -match '(^|\\)\.{1,2}(\\|$)|[ .](\\|$)') {
            throw 'Extended runner path has ambiguous components.'
        }
    }
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path.Substring(2).Contains(':')) {
        throw 'Runner path must be a fully qualified local DOS path.'
    }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Assert-ConverterOwnership($Stage, $Registration, [string] $HelperRoot) {
    if ($Stage.helperName -notmatch '^ITInventoryImageConverter-[0-9a-f]{32}$') {
        throw 'Setup stage has no valid dedicated image-converter identity.'
    }
    $expectedPath = ConvertTo-RunnerLocalPath $HelperRoot
    [void](Assert-OwnedPath $expectedPath)
    if ($null -eq $Registration -or $Registration.DistributionName -cne $Stage.helperName) {
        throw 'Existing WSL image converter does not match the protected setup stage and owned base path.'
    }
    $registeredPath = ConvertTo-RunnerLocalPath ([string]$Registration.BasePath)
    [void](Assert-OwnedPath $registeredPath)
    if (-not [string]::Equals($registeredPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Existing WSL image converter does not match the protected setup stage and owned base path.'
    }
}

function Test-ConvertedImageReceipt($Receipt, [string] $SourceHash, [string] $OutputHash) {
    return $null -ne $Receipt -and $Receipt.tag -eq $script:RunnerTag -and
        $Receipt.sourceSha256 -ieq $SourceHash -and $Receipt.outputSha256 -ieq $OutputHash -and
        $Receipt.completed -eq $true
}

function ConvertTo-NativeArgument([AllowEmptyString()][string] $Value) {
    # WSL parses its option prefix itself and does not recognize quoted flags.
    # Leave simple tokens bare; CRT quoting is needed only for empty/complex values.
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    # Windows CRT argument quoting: preserve empty values, embedded quotes and
    # backslashes preceding quotes or the closing delimiter.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-RunnerNative([string] $Executable, [string[]] $Arguments, [string] $InputText = $null, [switch] $CaptureOutput, [switch] $CaptureError, [ValidateRange(0, 3600)][int] $TimeoutSeconds = 0) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    if ($CaptureOutput) { $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false) }
    if ($CaptureError) { $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false) }
    $process = [Diagnostics.Process]::Start($start)
    try {
        # Only trusted setup path translation captures output. Guest output and
        # JIT data keep the existing discard behavior. Only fixed setup/probe
        # commands opt into visible, bounded stderr diagnostics.
        if ($CaptureOutput) { $output = $process.StandardOutput.ReadToEndAsync() }
        else { $output = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null) }
        if ($CaptureError) { $errorOutput = $process.StandardError.ReadToEndAsync() }
        else { $errorOutput = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null) }
        if ($null -ne $InputText) { $process.StandardInput.WriteLine($InputText) }
        $process.StandardInput.Close()
        if ($TimeoutSeconds -gt 0) {
            if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
                $process.Kill()
                throw "Native command timed out after $TimeoutSeconds seconds."
            }
        } else { $process.WaitForExit() }
        $captured = $output.GetAwaiter().GetResult()
        $capturedError = $errorOutput.GetAwaiter().GetResult()
        if ($CaptureOutput -or $CaptureError) {
            if (-not $CaptureOutput) { $captured = '' }
            if (-not $CaptureError) { $capturedError = '' }
            return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $captured; ErrorOutput = (ConvertTo-RunnerDiagnosticText $capturedError) }
        }
        return $process.ExitCode
    } finally { $process.Dispose() }
}

function ConvertTo-RunnerDiagnosticText([string] $Text) {
    # WSL may mix UTF-16 diagnostics with UTF-8 guest output. Remove embedded
    # NUL/control characters and bound only the visible diagnostic, never log JIT.
    $Text = [regex]::Replace($Text, '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '')
    $Text = [regex]::Replace($Text, '(https?://)[^/\s@]+@', '$1[redacted]@')
    if ($Text.Length -gt 4096) { return $Text.Substring(0, 4096) + ' [truncated]' }
    return $Text.Trim()
}

function Invoke-ConverterCommand([string] $Name, [string[]] $Command, [switch] $CaptureOutput, [switch] $CaptureError, [string] $Executable = 'wsl.exe', [int] $TimeoutSeconds = 0) {
    if ($Name -notmatch '^ITInventoryImageConverter-[0-9a-f]{32}$' -or $Command.Count -eq 0) {
        throw 'Image converter command requires its exact recorded identity and a command.'
    }
    # -- alone lets WSL invoke the default Linux shell, which consumes Windows
    # path backslashes. --exec passes the native argv directly to the command.
    $arguments = @('-d', $Name, '-u', 'root', '--exec') + $Command
    return Invoke-RunnerNative $Executable $arguments -CaptureOutput:$CaptureOutput -CaptureError:$CaptureError -TimeoutSeconds $TimeoutSeconds
}

function Show-ConverterCommandFailure([string] $Heading, $Result) {
    Write-Host "$Heading (exit $($Result.ExitCode))."
    if ($Result.Output) { Write-Host (ConvertTo-RunnerDiagnosticText $Result.Output) }
    if ($Result.ErrorOutput) { Write-Host (ConvertTo-RunnerDiagnosticText $Result.ErrorOutput) }
}

function Assert-ConverterTools([string] $Name) {
    # Reuse a working installed tool rather than rerunning apt on every retry.
    $probe = Invoke-ConverterCommand $Name @('/usr/bin/qemu-img', '--version') -CaptureOutput -CaptureError -TimeoutSeconds 30
    if ($probe.ExitCode -eq 0 -and $probe.Output -match '^qemu-img version ') { return }
    if ($probe.ExitCode -notin @(1, 127)) {
        Show-ConverterCommandFailure 'Converter tool probe failed; dependency install was not attempted' $probe
        throw 'Image converter could not run its tool probe; inspect the diagnostic or use the elevated converter diagnostic menu.'
    }
    $install = Invoke-ConverterCommand $Name @('sh', '-c', 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qemu-utils') -CaptureError
    if ($install.ExitCode -ne 0) {
        Show-ConverterCommandFailure 'Fixed qemu-utils setup command failed' $install
        throw 'qemu-utils installation failed in the dedicated image converter; see bounded diagnostic above.'
    }
}

function Invoke-ConverterDiagnostics {
    Assert-Administrator
    Assert-SecureRoot
    $stage = Read-RunnerJson (Join-Path $script:RunnerRoot 'setup-stage.json')
    if ($null -eq $stage -or $stage.tag -ne $script:RunnerTag) { throw 'Diagnostics require the protected unfinished setup stage.' }
    $registrations = @(Get-ConverterRegistrations $stage.helperName)
    if ($registrations.Count -ne 1) { throw 'Diagnostics require one exact recorded converter registration.' }
    Assert-ConverterOwnership $stage $registrations[0] (Join-Path $script:RunnerRoot 'image-converter')
    Write-Host "Read-only converter diagnostic; PowerShell $($PSVersionTable.PSVersion); exact recorded registration verified."
    $commands = @(
        ,@('/usr/bin/qemu-img', '--version')
        ,@('sh', '-c', 'printf "converter-command=ok\n"; command -v qemu-img; command -v wslpath')
        ,@('wslpath', '-a', (Join-Path $script:RunnerRoot 'image\ubuntu-24.04-server-cloudimg-amd64.img'))
    )
    foreach ($command in $commands) {
        $result = Invoke-ConverterCommand $stage.helperName $command -CaptureOutput -CaptureError -TimeoutSeconds 30
        Show-ConverterCommandFailure "Read-only $($command[0])" $result
    }
}

function Get-ConverterLinuxPath([string] $Name, [string] $Path) {
    $Path = Assert-OwnedPath $Path
    $result = Invoke-ConverterCommand $Name @('wslpath', '-a', $Path) -CaptureOutput
    if ($result.ExitCode -ne 0) { throw "Image converter path translation failed (exit $($result.ExitCode))." }
    if ([string]::IsNullOrWhiteSpace([string]$result.Output)) { throw 'Image converter path translation returned no path.' }
    $linuxPath = ([string]$result.Output).Trim()
    if ($linuxPath -notmatch '^/[^\r\n\x00]+$') { throw 'Image converter path translation did not return one absolute Linux path.' }
    return $linuxPath
}

function New-RunnerSshKey([string] $Path, [string] $Executable = (Get-Command ssh-keygen.exe -ErrorAction Stop).Source) {
    $Path = Assert-OwnedPath $Path
    # The installed Windows PowerShell 5.1 drops empty native arguments; the
    # process helper preserves the explicit empty passphrase without a shell.
    if ((Invoke-RunnerNative $Executable @('-q', '-t', 'ed25519', '-N', '', '-f', $Path)) -ne 0) {
        throw 'Per-VM SSH key generation failed.'
    }
}

function Get-ConverterRegistrations([string] $Name) {
    return @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue |
        Get-ItemProperty -ErrorAction Stop | Where-Object DistributionName -CEQ $Name)
}

function Remove-OwnedConverter($Stage, [string] $HelperRoot) {
    $registrations = @(Get-ConverterRegistrations $Stage.helperName)
    if ($registrations.Count -ne 1) { throw 'Converter retirement requires one exact owned registration.' }
    Assert-ConverterOwnership $Stage $registrations[0] $HelperRoot
    & wsl.exe --terminate $Stage.helperName
    if ($LASTEXITCODE -ne 0) { throw 'Owned converter termination failed; setup remains incomplete.' }
    # Recheck the destructive target after termination.
    $registrations = @(Get-ConverterRegistrations $Stage.helperName)
    if ($registrations.Count -ne 1) { throw 'Converter registration changed before retirement.' }
    Assert-ConverterOwnership $Stage $registrations[0] $HelperRoot
    & wsl.exe --unregister $Stage.helperName
    if ($LASTEXITCODE -ne 0 -or @(Get-ConverterRegistrations $Stage.helperName).Count -ne 0) {
        throw 'Owned converter retirement could not be verified.'
    }
    $distros = @(& wsl.exe --list --quiet | ForEach-Object { $_.Trim([char]0).Trim() })
    if ($LASTEXITCODE -ne 0 -or $distros -contains $Stage.helperName) { throw 'Retired converter is still listed or WSL readback failed.' }
}

function Assert-RunnerVmLifecycle([string] $Name) {
    $vm = Get-VM -Name $Name -ErrorAction Stop
    if ($vm.AutomaticStartAction -ne 'Nothing' -or $vm.AutomaticStopAction -ne 'TurnOff') {
        throw 'VM lifecycle readback permits automatic restart or saved job state.'
    }
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

function Get-RunnerBytesHash([byte[]] $Bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-', '') }
    finally { $hash.Dispose() }
}

function Get-RunnerFileEvidence([string] $Path) {
    $Path = Assert-OwnedPath $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [pscustomobject]@{ exists = $false; hash = ''; content = '' } }
    $bytes = [IO.File]::ReadAllBytes($Path)
    return Get-RunnerBytesEvidence $bytes
}

function Get-RunnerBytesEvidence([byte[]] $Bytes) {
    return [pscustomobject]@{ exists = $true; hash = Get-RunnerBytesHash $Bytes; content = [Convert]::ToBase64String($Bytes) }
}

function Get-RunnerEvidenceValue($Evidence) {
    if (-not $Evidence.exists) { return $null }
    $bytes = [Convert]::FromBase64String($Evidence.content)
    if ((Get-RunnerBytesHash $bytes) -cne $Evidence.hash) { throw 'Transition evidence content/hash mismatch.' }
    return [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff) | ConvertFrom-Json
}

function Test-RunnerEvidence([string] $Path, $Evidence) {
    $actual = Get-RunnerFileEvidence $Path
    return $actual.exists -eq $Evidence.exists -and $actual.hash -ceq $Evidence.hash
}

function Write-RunnerBytes([string] $Path, [byte[]] $Bytes) {
    $Path = Assert-OwnedPath $Path
    $temporary = Assert-OwnedPath ($Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $backup = Assert-OwnedPath ($Path + '.' + [guid]::NewGuid().ToString('N') + '.bak')
    try {
        [IO.File]::WriteAllBytes($temporary, $Bytes)
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, $backup) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

function Get-RunnerJsonEvidence($Value) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 10 -Compress))
    return [pscustomobject]@{ exists = $true; hash = Get-RunnerBytesHash $bytes; content = [Convert]::ToBase64String($bytes) }
}

function Write-RunnerEvidence([string] $Path, $Evidence) {
    [void](Get-RunnerEvidenceValue $Evidence)
    if (-not $Evidence.exists) { throw 'Cannot write absent transition evidence.' }
    Write-RunnerBytes $Path ([Convert]::FromBase64String($Evidence.content))
    if (-not (Test-RunnerEvidence $Path $Evidence)) { throw 'Transition evidence readback failed.' }
}

function Assert-RunnerTransitionClear {
    foreach ($name in @('pilot-retry.json', 'update-journal.json', 'setup-publication.json')) {
        $record = Read-RunnerJson (Assert-OwnedPath (Join-Path $script:RunnerRoot $name))
        if ($null -ne $record -and ($record.tag -cne $script:RunnerTag -or $record.phase -cne 'complete')) {
            throw 'A pending or invalid lifecycle journal blocks pickup/activation; explicitly resume the recorded operation.'
        }
    }
}

function Assert-RunnerClaimOpen {
    Assert-RunnerTransitionClear
    if (Test-Path -LiteralPath (Assert-OwnedPath (Join-Path $script:RunnerRoot 'stop.requested'))) {
        throw 'Pickup suspension requested; no new job may be consumed or created.'
    }
}

function Get-RunnerVmInventory {
    # Collect both complete snapshots before returning any objects. A failed or
    # partial Hyper-V lookup must never become proof that a VM does not exist.
    try {
        $vms = @(Get-VM -ErrorAction Stop)
        $systems = @(Get-CimInstance -Namespace 'root/virtualization/v2' -ClassName Msvm_ComputerSystem -OperationTimeoutSec 10 -ErrorAction Stop)
        $registered = @($systems | Where-Object Caption -CEQ 'Virtual Machine')
        if (@($systems | Where-Object Caption -CEQ 'Hosting Computer System').Count -ne 1 -or
            $systems.Count -ne ($registered.Count + 1)) { throw 'Incomplete provider inventory.' }
        $seen = @{}
        foreach ($vm in $vms) {
            $id = [guid]$vm.Id
            if ($id -eq [guid]::Empty -or [string]::IsNullOrEmpty($vm.Name) -or $seen.ContainsKey($id.ToString())) { throw 'Invalid or duplicate VM identity.' }
            $seen[$id.ToString()] = $true
            $matching = @($registered | Where-Object { $_.Name -ieq $id.ToString() -and $_.ElementName -ceq $vm.Name })
            if ($matching.Count -ne 1) { throw 'VM/provider identity differs.' }
        }
        if ($vms.Count -ne $registered.Count) { throw 'VM/provider inventory differs.' }
    } catch {
        throw 'Hyper-V inventory could not be verified. Preserve runner instance files and state; investigate VM registration before retrying cleanup or pickup.'
    }
    return $vms
}

function Assert-RunnerControlIdle {
    if ((Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction Stop).State -eq 'Running' -or
        (Get-RunnerState) -or @(Get-RunnerVmInventory | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -gt 0) {
        throw 'Lifecycle control requires a stopped supervisor and no session or owned-prefix VM.'
    }
}

function Assert-RunnerProtectedPath([string] $Path) {
    [void](Assert-OwnedPath $Path)
    $acl = Get-Acl -LiteralPath $Path
    $allowed = @('S-1-5-18', 'S-1-5-32-544')
    if ($allowed -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Installed path owner is unexpected.' }
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid) { throw 'Installed path grants unexpected access.' }
    }
}

# Offline tests inject interruption here; production has no environment switch
# or callback that can change transition behavior.
function Invoke-RunnerTransitionCheckpoint([string] $Name) {}

# A committed initial state is the durable claim. Complete its exact receipt
# before any recovery can erase that state, including watchdog/Stop cleanup.
function Complete-RunnerPilotClaim($State) {
    if ($State.PSObject.Properties.Name -contains 'claimMode' -and
        ($State.claimMode -cnotin @('pilot', 'active') -or
        ($State.claimMode -ceq 'pilot' -and $State.PSObject.Properties.Name -notcontains 'pilotClaim') -or
        ($State.claimMode -ceq 'active' -and $State.PSObject.Properties.Name -contains 'pilotClaim'))) {
        throw 'Recorded session claim mode/evidence is invalid; state must be retained.'
    }
    if ($State.PSObject.Properties.Name -notcontains 'pilotClaim') { return }
    Assert-StateIdentity $State
    $attempt = Get-RunnerEvidenceValue $State.pilotClaim
    if ($null -eq $attempt -or $attempt.tag -cne $script:RunnerTag -or $attempt.sessionName -cne $State.vmName -or
        $attempt.jobId -le 0 -or $attempt.runId -le 0 -or $attempt.workflowId -le 0 -or $attempt.runAttempt -le 0 -or
        $attempt.workflowPath -cne '.github/workflows/local-runner-pilot.yml' -or
        $attempt.pilotLabel -cne (Get-PilotLabel $attempt.headSha)) { throw 'Recorded pilot claim identity is invalid; state must be retained.' }
    if ($State.PSObject.Properties.Name -contains 'resourceLabel' -and $State.resourceLabel -cne $attempt.pilotLabel) { throw 'Pilot state resource label differs from its committed receipt.' }
    $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'pilot-attempt.json')
    if (Test-Path -LiteralPath $path) {
        if (-not (Test-RunnerEvidence $path $State.pilotClaim)) { throw 'Pilot receipt differs from committed session claim; state must be retained.' }
    } else { Write-RunnerEvidence $path $State.pilotClaim }
}

function Assert-StateIdentity($State) {
    if ($State.tag -ne $script:RunnerTag -or $State.vmName -notmatch '^ITIR-[0-9a-f]{32}$') {
        throw 'Runner state identity is invalid; manual investigation is required.'
    }
    if ($State.PSObject.Properties.Name -contains 'resourceLabel') {
        [void](Get-RunnerResourceProfile $State.resourceLabel)
        if ($State.PSObject.Properties.Name -contains 'claimMode' -and $State.claimMode -ceq 'active' -and
            $State.resourceLabel -cmatch '^it-inventory-pilot-') { throw 'Active state has a pilot resource label.' }
    }
    if ($State.PSObject.Properties.Name -contains 'vmId') {
        if ([string]$State.vmId -cnotmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or
            [guid]$State.vmId -eq [guid]::Empty) { throw 'Recorded VM GUID is invalid; runner instance files and state are retained.' }
    }
    [void](Assert-OwnedPath $State.instancePath)
    if (-not $State.instancePath.EndsWith($State.vmName, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runner state instance path does not match its VM name.'
    }
}

function Assert-RunnerInstanceUnreferenced($State) {
    $instancePath = Assert-OwnedPath $State.instancePath
    $instancePrefix = $instancePath.TrimEnd('\') + '\'
    foreach ($entry in @(Get-RunnerVmInventory)) {
        if ([string]::IsNullOrEmpty($entry.Path)) { throw 'VM configuration path inspection failed; runner files/state are retained.' }
        $configurationPath = [IO.Path]::GetFullPath($entry.Path)
        if ($configurationPath.StartsWith($instancePrefix, [StringComparison]::OrdinalIgnoreCase) -or $configurationPath.Equals($instancePath, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'A registered VM still references the recorded instance configuration path; runner files/state are retained.'
        }
        foreach ($disk in @(Get-VMHardDiskDrive -VM $entry -ErrorAction Stop)) {
            if ([string]::IsNullOrEmpty($disk.Path)) { throw 'VM disk path inspection failed; runner files/state are retained.' }
            $diskPath = [IO.Path]::GetFullPath($disk.Path)
            if ($diskPath.StartsWith($instancePrefix, [StringComparison]::OrdinalIgnoreCase) -or $diskPath.Equals($instancePath, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'A registered VM still references the recorded instance disk path; runner files/state are retained.'
            }
        }
    }
}

function Remove-RunnerInstance($State) {
    Assert-StateIdentity $State
    Complete-RunnerPilotClaim $State
    $hasVmId = $State.PSObject.Properties.Name -contains 'vmId'
    $matching = @(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $State.vmName -or ($hasVmId -and [guid]$_.Id -eq [guid]$State.vmId) })
    if ($matching.Count -gt 1) { throw 'Ambiguous VM identity; runner instance files and state are retained.' }
    $vm = if ($matching.Count -eq 1) { $matching[0] } else { $null }
    if ($null -ne $vm) {
        $vmId = [guid]$vm.Id
        if ($hasVmId -and $vmId -ne [guid]$State.vmId) { throw 'Recorded VM GUID differs from the inspected VM; runner files/state are retained.' }
        $disk = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
        foreach ($entry in $disk) {
            [void](Assert-OwnedPath $entry.Path)
        }
        $vmPath = [IO.Path]::GetFullPath($vm.Path)
        # New-VM appends its name to -Path. Legacy state has the same deterministic layout.
        $ownedVmPath = Assert-OwnedPath (Join-Path $State.instancePath $State.vmName)
        if ($State.PSObject.Properties.Name -contains 'expectedVmPath' -and
            -not [string]::Equals([IO.Path]::GetFullPath($State.expectedVmPath), $ownedVmPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Recorded VM configuration path differs from the exact creation layout; refusing deletion.'
        }
        $normalOwner = $vm.Name -ceq $State.vmName -and $vm.Notes -eq $script:RunnerTag -and
            $vmPath.Equals($ownedVmPath, [StringComparison]::OrdinalIgnoreCase)
        $provisionalOwner = $false
        if ([string]::IsNullOrEmpty($vm.Notes) -and $State.PSObject.Properties.Name -contains 'phase' -and $State.phase -eq 'creating') {
            $expectedBootDisk = Assert-OwnedPath (Join-Path $State.instancePath 'guest.vhdx')
            $provisionalOwner = $vm.Name -ceq $State.vmName -and $vm.State -eq 'Off' -and
                $vmPath.Equals($ownedVmPath, [StringComparison]::OrdinalIgnoreCase) -and
                $State.expectedBootDisk -ceq $expectedBootDisk -and $disk.Count -eq 1 -and
                [string]::Equals([IO.Path]::GetFullPath($disk[0].Path), $expectedBootDisk, [StringComparison]::OrdinalIgnoreCase)
        }
        if (-not ($normalOwner -or $provisionalOwner)) {
            throw 'VM identity does not match owned state; refusing deletion.'
        }
        if ($vm.State -ne 'Off') { Stop-VM -VM $vm -TurnOff -Force -ErrorAction Stop }
        Remove-VM -VM $vm -Force -ErrorAction Stop
        $remaining = @(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $State.vmName -or [guid]$_.Id -eq $vmId })
        if ($remaining.Count -ne 0) { throw 'VM removal was not verified; runner instance files and state are retained.' }
    }
    Assert-RunnerInstanceUnreferenced $State
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
