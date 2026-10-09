# Non-mutating host contract tests. Creates only a disposable directory below TEMP.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

foreach ($file in @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1')) {
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "PowerShell parse error in $($file.Name): $($errors[0].Message)" }
}

# Keep DPAPI proof in a fresh -NoProfile process rather than inheriting any
# assemblies imported by these contract checks or an interactive owner shell.
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Mutex.Security.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell mutex policy regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Dpapi.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell DPAPI regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Setup.Download.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell image download regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Pilot.Binding.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell pilot binding regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Lifecycle.Recovery.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell lifecycle recovery regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Update.Controls.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell update controls regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Lifecycle.Atomicity.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell lifecycle atomicity regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Cleanup.Integrity.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell cleanup integrity regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Guest.Network.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell guest MAC regression failed.' }

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Memory.Admission.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell memory admission regression failed.' }

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Resource.Profiles.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell resource profile regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Capacity.Observation.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell capacity observation regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Unattended.Recovery.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell unattended recovery regression failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Task.Power.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell task power regression failed.' }

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Jit.Demand.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell JIT demand regression failed.' }

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Runner.Latency.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fresh Windows PowerShell runner latency regression failed.' }

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Network.Recovery.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Network.Recovery.Tests.ps1 failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Network.Integration.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Network.Integration.Tests.ps1 failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Probe.Job.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Probe.Job.Tests.ps1 failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Network.Guardian.Process.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Network.Guardian.Process.Tests.ps1 failed.' }

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
. (Join-Path $PSScriptRoot 'Guest.Network.ps1')

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Prepared.Image.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Prepared image tests failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Guardian.Boot.Tests.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Guardian boot tests failed.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "ITIR-contract-$([guid]::NewGuid().ToString('N'))"
[void][IO.Directory]::CreateDirectory($testRoot)
$script:RunnerRoot = $testRoot
$script:RunnerStatePath = Join-Path $testRoot 'state.json'
$script:RunnerConfigPath = Join-Path $testRoot 'config.json'
$script:contractLockPrefix = 'Local\ITIR-contract-' + [guid]::NewGuid().ToString('N')
$script:realEnterLock = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    $mapped = if ($Name -eq 'Global\ITInventoryLocalRunner-v1') { $script:contractLockPrefix + '-state' }
        elseif ($Name -eq 'Global\ITInventoryLocalRunner-Supervisor-v1') { $script:contractLockPrefix + '-supervisor' } else { $Name }
    return & $script:realEnterLock $mapped -FailFast:$FailFast
}
try {
    $insecureRootRejected = $false
    try { Assert-SecureRoot } catch { $insecureRootRejected = $true }
    if (-not $insecureRootRejected) { throw 'An unprotected TEMP directory was accepted as a secure runner root.' }

    $outsideRejected = $false
    try { [void](Assert-OwnedPath ([IO.Path]::GetTempPath())) } catch { $outsideRejected = $true }
    if (-not $outsideRejected) { throw 'Path escape was accepted.' }

    $validName = 'ITIR-' + ('a' * 32)
    $validInstance = Join-Path (Join-Path $testRoot 'instances') $validName
    $state = [ordered]@{ tag = $script:RunnerTag; vmName = $validName; instancePath = $validInstance }
    Assert-StateIdentity $state
    $state.instancePath = [IO.Path]::GetTempPath()
    $invalidRejected = $false
    try { Assert-StateIdentity $state } catch { $invalidRejected = $true }
    if (-not $invalidRejected) { throw 'Malformed state path was accepted.' }

    $mutex = Enter-RunnerLock
    try {
        $job = Start-Job -ArgumentList ($script:contractLockPrefix + '-state') -ScriptBlock {
            param($name)
            $probe = [Threading.Mutex]::new($false, $name)
            try { $probe.WaitOne(0) } finally { $probe.Dispose() }
        }
        [void](Wait-Job -Job $job -Timeout 10)
        if ($job.State -ne 'Completed' -or (Receive-Job $job) -ne $false) {
            throw 'Another process acquired the runner state mutex concurrently.'
        }
        Remove-Job $job
    } finally { Exit-RunnerLock $mutex }

    $abandonedName = "Global\ITIR-contract-$([guid]::NewGuid().ToString('N'))"
    $abandoner = Start-Job -ArgumentList $abandonedName -ScriptBlock {
        param($name)
        $held = [Threading.Mutex]::new($false, $name)
        [void]$held.WaitOne()
        [Environment]::Exit(0)
    }
    [void](Wait-Job -Job $abandoner -Timeout 10)
    if ($abandoner.State -eq 'Running') { Stop-Job $abandoner; throw 'Mutex abandonment test helper did not exit.' }
    Remove-Job $abandoner -Force
    $recovered = Enter-RunnerLock $abandonedName
    Exit-RunnerLock $recovered

    $queued = [pscustomobject]@{ status = 'queued'; labels = @('self-hosted', 'it-inventory-ephemeral'); runner_id = $null }
    if (-not (Test-QueuedRunnerJob $queued 'it-inventory-ephemeral')) { throw 'Null runner ID was not considered queued.' }
    $queued.runner_id = 0
    if (-not (Test-QueuedRunnerJob $queued 'it-inventory-ephemeral')) { throw 'Zero runner ID was not considered queued.' }
    $queued.runner_id = 42
    if (Test-QueuedRunnerJob $queued 'it-inventory-ephemeral') { throw 'Assigned job was accepted as queued.' }

    $pilot = [pscustomobject]@{ status = 'completed'; conclusion = 'success'; runner_name = 'ITIR-test'; runner_id = 17 }
    if (-not (Test-PilotJobResult $pilot 'ITIR-test' 17)) { throw 'Matching pilot job was rejected.' }
    $pilot.runner_name = 'ITIR-other'
    if (Test-PilotJobResult $pilot 'ITIR-test' 17) { throw 'Another runner job was accepted as pilot proof.' }
    $pilot.runner_name = 'ITIR-test'
    $pilot.runner_id = 18
    if (Test-PilotJobResult $pilot 'ITIR-test' 17) { throw 'Another runner ID was accepted as pilot proof.' }
    $pilot.runner_id = 17
    $pilot.status = 'in_progress'
    if (Test-PilotJobResult $pilot 'ITIR-test' 17) { throw 'Nonterminal pilot job was accepted.' }

    $helperRoot = Join-Path $testRoot 'image-converter'
    $stage = [pscustomobject]@{ helperName = 'ITInventoryImageConverter-' + ('a' * 32) }
    $registration = [pscustomobject]@{ DistributionName = $stage.helperName; BasePath = $helperRoot }
    Assert-ConverterOwnership $stage $registration $helperRoot
    $registration.BasePath = '\\?\' + $helperRoot
    Assert-ConverterOwnership $stage $registration $helperRoot
    $registration.BasePath = '\\?\' + $helperRoot.ToLowerInvariant() + '\'
    Assert-ConverterOwnership $stage $registration $helperRoot
    $badPaths = @(
        ('\\?\' + (Join-Path $testRoot 'different-converter')),
        ('\\?\UNC\localhost\C$\' + $helperRoot.Substring(3)),
        ('\\.\' + $helperRoot),
        ('\\?\' + $helperRoot + '\..\image-converter'),
        ('\\?\' + $helperRoot + '.'),
        ('\\?\' + $helperRoot + ' '),
        'C:image-converter',
        '\image-converter'
    )
    if ($badPaths.Count -ne 8) { throw 'Converter rejection cases did not produce eight distinct paths.' }
    foreach ($badPath in $badPaths) {
        $registration.BasePath = $badPath
        $rejected = $false
        try { Assert-ConverterOwnership $stage $registration $helperRoot } catch { $rejected = $true }
        if (-not $rejected) { throw 'Unowned or ambiguous converter path was accepted after normalization.' }
    }
    $registration.BasePath = $helperRoot
    $registration.BasePath = Join-Path ([IO.Path]::GetTempPath()) 'unowned-converter'
    $unownedRejected = $false
    try { Assert-ConverterOwnership $stage $registration $helperRoot } catch { $unownedRejected = $true }
    if (-not $unownedRejected) { throw 'A converter registered outside the owned root was accepted.' }
    $registration.BasePath = $helperRoot
    $registration.DistributionName = 'ITInventoryImageConverter-other'
    $nameRejected = $false
    try { Assert-ConverterOwnership $stage $registration $helperRoot } catch { $nameRejected = $true }
    if (-not $nameRejected) { throw 'A different converter registration was accepted.' }

    $sourceHash = 'a' * 64
    $outputHash = 'b' * 64
    $receipt = [pscustomobject]@{ tag = $script:RunnerTag; completed = $true; sourceSha256 = $sourceHash; outputSha256 = $outputHash }
    if (-not (Test-ConvertedImageReceipt $receipt $sourceHash $outputHash)) { throw 'Matching conversion receipt was rejected.' }
    if (Test-ConvertedImageReceipt $receipt $sourceHash ('c' * 64)) { throw 'Mismatched VHDX hash was accepted.' }
    $receipt.completed = $false
    if (Test-ConvertedImageReceipt $receipt $sourceHash $outputHash) { throw 'Incomplete conversion receipt was accepted.' }

    Write-RunnerJson $script:RunnerStatePath ([ordered]@{ schema = 1; value = 'first' })
    Write-RunnerJson $script:RunnerStatePath ([ordered]@{ schema = 1; value = 'second' })
    if ((Read-RunnerJson $script:RunnerStatePath).value -ne 'second' -or
        @(Get-ChildItem -LiteralPath $testRoot -Filter '*.tmp').Count -ne 0) {
        throw 'Atomic state replacement left invalid content or temporary files.'
    }

    # A native argv sink proves behavior in the installed Windows PowerShell 5.1
    # without generating keys, invoking SSH, or creating host resources.
    $sink = Join-Path $testRoot 'argv-sink.exe'
    Add-Type -OutputAssembly $sink -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
public class ArgvSink {
    public static int Main(string[] args) {
        if (args[0] == "--block") System.Threading.Thread.Sleep(3000);
        string capture = Environment.GetEnvironmentVariable("ITIR_NATIVE_ARGV_PATH");
        string target = String.IsNullOrEmpty(capture) ? args[args.Length - 1] + ".argv" : capture;
        File.WriteAllLines(target, args);
        File.WriteAllText(target + ".raw", Environment.CommandLine);
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        if (args[0] == "--output") { Console.WriteLine("/mnt/c/fixture image"); Console.Error.WriteLine("fixed stderr diagnostic"); }
        return args[args.Length - 1].Contains("fail-key") ? 9 : 0;
    }
}
'@
    $keyPath = Join-Path $testRoot 'key with spaces'
    New-RunnerSshKey $keyPath $sink
    $captured = [IO.File]::ReadAllLines($keyPath + '.argv')
    $expected = @('-q', '-t', 'ed25519', '-N', '', '-f', $keyPath)
    if ($captured.Count -ne 7 -or (Compare-Object $expected $captured -SyncWindow 0)) {
        throw 'Native keygen arguments lost the empty passphrase or output path.'
    }
    $keyFailureRejected = $false
    try { New-RunnerSshKey (Join-Path $testRoot 'fail-key') $sink } catch { $keyFailureRejected = $true }
    if (-not $keyFailureRejected) { throw 'Native keygen failure was ignored.' }
    $probePath = Join-Path $testRoot 'quoted-command'
    $command = 'timeout 4 bash -c "echo probe >/dev/tcp/172.30.240.1/49581"; exec ./run.sh --jitconfig "$JIT"'
    $arguments = @('', 'space value', 'C:\trailing\', 'embedded\"quote', $command, $probePath)
    if ((Invoke-RunnerNative $sink $arguments) -ne 0 -or
        (Compare-Object $arguments ([IO.File]::ReadAllLines($probePath + '.argv')) -SyncWindow 0)) {
        throw 'Native SSH command quotes, empty values or backslashes changed.'
    }
    if ((ConvertTo-NativeArgument '-d') -cne '-d' -or (ConvertTo-NativeArgument '') -cne '""') {
        throw 'Native encoder quoted a WSL option or lost an empty keygen passphrase.'
    }
    $safeDiagnostic = ConvertTo-RunnerDiagnosticText ("w`0s`0l: https://user:password@example.test/path`n" + ('x' * 5000))
    if ($safeDiagnostic.Length -gt 4108 -or $safeDiagnostic.Contains('password') -or $safeDiagnostic.Contains([string][char]0)) {
        throw 'Fixed-command diagnostic was unbounded or retained control characters/URL credentials.'
    }

    $outputResult = Invoke-RunnerNative $sink @('--output', (Join-Path $testRoot 'captured-output')) -CaptureOutput
    if ($outputResult.ExitCode -ne 0 -or $outputResult.Output.Trim() -cne '/mnt/c/fixture image') { throw 'Trusted native output capture failed.' }
    $outputResult = Invoke-RunnerNative $sink @('--output', (Join-Path $testRoot 'fail-key-output')) -CaptureOutput
    if ($outputResult.ExitCode -ne 9) { throw 'Trusted native output capture lost the failing exit code.' }
    $outputResult = Invoke-RunnerNative $sink @('--output', (Join-Path $testRoot 'captured-error')) -CaptureOutput -CaptureError
    if ($outputResult.ErrorOutput -cne 'fixed stderr diagnostic') { throw 'Fixed-command stderr capture was lost.' }
    $timedOut = $false
    try { Invoke-RunnerNative $sink @('--block', (Join-Path $testRoot 'timed-out')) -TimeoutSeconds 1 | Out-Null } catch {
        $timedOut = $_.Exception.Message -ceq 'Native command timed out after 1 seconds.'
    }
    if (-not $timedOut -or (Test-Path -LiteralPath (Join-Path $testRoot 'timed-out.argv'))) { throw 'Native diagnostic timeout did not stop its owned process.' }

    # WSL's default-shell route consumes Windows backslashes. All Linux
    # conversion commands must use --exec with their exact native argv.
    $previousArgvPath = $env:ITIR_NATIVE_ARGV_PATH
    $env:ITIR_NATIVE_ARGV_PATH = Join-Path $testRoot 'wsl-argv.txt'
    try {
        $windowsImage = Join-Path $testRoot 'image with spaces\source.img'
        $windowsDisk = Join-Path $testRoot 'image with spaces\target.vhdx'
        $converterCommands = @(
            ,@('wslpath', '-a', $windowsImage)
            ,@('wslpath', '-a', $windowsDisk)
            ,@('sh', '-c', 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qemu-utils')
            ,@('qemu-img', 'convert', '-f', 'qcow2', '-O', 'vhdx', '-o', 'subformat=dynamic', '/mnt/c/image with spaces/source.img', '/mnt/c/image with spaces/target.vhdx')
        )
        if ($converterCommands.Count -ne 4) { throw 'Conversion argv tests did not produce four separate command arrays.' }
        foreach ($converterCommand in $converterCommands) {
            if ((Invoke-ConverterCommand $stage.helperName $converterCommand -Executable $sink) -ne 0) { throw 'Conversion argv sink failed.' }
            $captured = [IO.File]::ReadAllLines($env:ITIR_NATIVE_ARGV_PATH)
            $expected = @('-d', $stage.helperName, '-u', 'root', '--exec') + $converterCommand
            if ($captured.Count -ne $expected.Count -or (Compare-Object $expected $captured -SyncWindow 0)) {
                throw 'WSL conversion command lost --exec, backslashes, spaces or its fixed shell script argument.'
            }
            $rawCommandLine = [IO.File]::ReadAllText($env:ITIR_NATIVE_ARGV_PATH + '.raw')
            if (-not $rawCommandLine.Contains('-d ' + $stage.helperName + ' -u root --exec ')) {
                throw 'WSL option prefix was quoted; the actual raw parser would miss converter binding.'
            }
        }
    } finally { $env:ITIR_NATIVE_ARGV_PATH = $previousArgvPath }

    $realConverterCommand = (Get-Command Invoke-ConverterCommand).ScriptBlock
    $script:pathResult = [pscustomobject]@{ ExitCode = 0; Output = "/mnt/c/fixture image`n" }
    function Invoke-ConverterCommand {
        param($Name, $Command, [switch]$CaptureOutput)
        if ($Name -cne $stage.helperName -or $Command.Count -ne 3 -or $Command[0] -cne 'wslpath' -or
            $Command[1] -cne '-a' -or $Command[2] -cne $windowsImage -or -not $CaptureOutput) { throw 'WSL path helper constructed the wrong command.' }
        return $script:pathResult
    }
    if ((Get-ConverterLinuxPath $stage.helperName $windowsImage) -cne '/mnt/c/fixture image') { throw 'Valid WSL path output was rejected.' }
    foreach ($case in @('exit', 'null', 'empty', 'relative', 'multiple-lines')) {
        $script:pathResult.ExitCode = 0; $script:pathResult.Output = '/mnt/c/fixture image'
        switch ($case) {
            'exit' { $script:pathResult.ExitCode = 9; $script:pathResult.Output = $null }
            'null' { $script:pathResult.Output = $null }
            'empty' { $script:pathResult.Output = "`n " }
            'relative' { $script:pathResult.Output = 'relative/path' }
            'multiple-lines' { $script:pathResult.Output = "/mnt/c/first`n/mnt/c/second" }
        }
        $rejected = $false
        try { Get-ConverterLinuxPath $stage.helperName $windowsImage | Out-Null } catch {
            $rejected = $true
            if ($case -eq 'exit' -and $_.Exception.Message -cne 'Image converter path translation failed (exit 9).') {
                throw 'Failed WSL path translation did not check exit status before missing output.'
            }
        }
        if (-not $rejected) { throw "Invalid WSL path result $case was accepted." }
    }
    Set-Item -Path Function:\Invoke-ConverterCommand -Value $realConverterCommand

    $script:toolCalls = [Collections.Generic.List[string]]::new()
    $script:toolReady = $true; $script:installCode = 0; $script:probeCode = 127
    function Invoke-ConverterCommand {
        param($Name, $Command, [switch]$CaptureOutput, [switch]$CaptureError, $TimeoutSeconds)
        $script:toolCalls.Add($Command[0])
        if ($Command[0] -eq '/usr/bin/qemu-img') {
            if ($TimeoutSeconds -ne 30) { throw 'Converter tool probe lost its bounded timeout.' }
            return [pscustomobject]@{ ExitCode = $(if ($script:toolReady) { 0 } else { $script:probeCode }); Output = $(if ($script:toolReady) { 'qemu-img version 8.2.2' } else { '' }); ErrorOutput = 'missing tool' }
        }
        if ($Command[0] -ne 'sh' -or $Command[1] -ne '-c' -or
            $Command[2] -cne 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qemu-utils' -or -not $CaptureError) {
            throw 'Converter dependency install was not the fixed diagnostic command.'
        }
        return [pscustomobject]@{ ExitCode = $script:installCode; Output = ''; ErrorOutput = 'synthetic fixed-command failure' }
    }
    Assert-ConverterTools $stage.helperName
    if (($script:toolCalls -join ',') -cne '/usr/bin/qemu-img') { throw 'Resume unnecessarily reran apt for an installed qemu-img.' }
    $script:toolCalls.Clear(); $script:toolReady = $false
    Assert-ConverterTools $stage.helperName
    if (($script:toolCalls -join ',') -cne '/usr/bin/qemu-img,sh') { throw 'Missing converter tools did not use the fixed install command.' }
    $script:installCode = 100; $rejected = $false
    try { Assert-ConverterTools $stage.helperName } catch { $rejected = $true }
    if (-not $rejected) { throw 'Failed fixed converter dependency command was accepted.' }
    $script:toolCalls.Clear(); $script:probeCode = -1; $rejected = $false
    try { Assert-ConverterTools $stage.helperName } catch { $rejected = $true }
    if (-not $rejected -or ($script:toolCalls -join ',') -cne '/usr/bin/qemu-img') { throw 'WSL host/protected-disk failure incorrectly attempted a dependency install.' }
    Set-Item -Path Function:\Invoke-ConverterCommand -Value $realConverterCommand

    $realNativeCommand = (Get-Command Invoke-RunnerNative).ScriptBlock
    $script:nativeTimeouts = [Collections.Generic.List[int]]::new()
    function Invoke-RunnerNative {
        param($Executable, $Arguments, $InputText, [switch]$CaptureOutput, [switch]$CaptureError, $TimeoutSeconds)
        $script:nativeTimeouts.Add($TimeoutSeconds)
        return 0
    }
    [void](Invoke-ConverterCommand $stage.helperName @('qemu-img', 'convert', '-f', 'qcow2', '-O', 'vhdx', '/mnt/c/source.img', '/mnt/c/target.vhdx'))
    [void](Invoke-ConverterCommand $stage.helperName @('sh', '-c', 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qemu-utils'))
    if (($script:nativeTimeouts -join ',') -cne '0,0') { throw 'Mutating converter commands gained a host-client timeout that could leave guest work running.' }
    [void](Invoke-ConverterCommand $stage.helperName @('/usr/bin/qemu-img', '--version') -TimeoutSeconds 30)
    if ($script:nativeTimeouts[2] -ne 30) { throw 'Read-only diagnostic lost its explicit timeout.' }
    Set-Item -Path Function:\Invoke-RunnerNative -Value $realNativeCommand

    $setupAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Setup.ps1'), [ref]$null, [ref]$null)
    $linuxTranslations = @($setupAst.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Get-ConverterLinuxPath' }, $true))
    $converterCalls = @($setupAst.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Invoke-ConverterCommand' }, $true))
    $shellRoutedLinuxCalls = @($setupAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'wsl.exe' -and
            $node.CommandElements.Extent.Text -contains '-d'
    }, $true))
    $toolChecks = @($setupAst.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Assert-ConverterTools' }, $true))
    if ($linuxTranslations.Count -ne 2 -or $converterCalls.Count -ne 1 -or $toolChecks.Count -ne 1 -or $shellRoutedLinuxCalls.Count -ne 0) {
        throw 'A setup conversion command bypassed the verified --exec/output helpers.'
    }

    # Load definitions only; never execute Runner.ps1's action dispatch.
    $runnerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
    $tokenReader = $runnerAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-OwnerToken' }, $true)
    $runnerSwitch = $runnerAst.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true)
    $credentialWriter = @($runnerSwitch.Clauses | Where-Object { $_.Item1.Value -eq 'StoreCredential' })[0].Item2
    if ($tokenReader.Extent.Text.IndexOf('Initialize-RunnerDpapi') -lt 0 -or
        $tokenReader.Extent.Text.IndexOf('Initialize-RunnerDpapi') -gt $tokenReader.Extent.Text.IndexOf('::Unprotect') -or
        $credentialWriter.Extent.Text.IndexOf('Initialize-RunnerDpapi') -lt 0 -or
        $credentialWriter.Extent.Text.IndexOf('Initialize-RunnerDpapi') -gt $credentialWriter.Extent.Text.IndexOf('Read-Host')) {
        throw 'Credential protect/unprotect entrypoints do not initialize DPAPI before use/input.'
    }
    foreach ($definition in $runnerAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
        Invoke-Expression $definition.Extent.Text
    }
    $cloudConfig = Get-GuestCloudConfig 'ssh-ed25519 dummy-public-key runner-contract'
    if ($cloudConfig -notmatch '(?m)^groups:\r?\n  - docker\r?\nusers:' -or
        $cloudConfig -notmatch '(?m)^    groups: \[sudo, docker\]' -or
        $cloudConfig.IndexOf('groups:') -ge $cloudConfig.IndexOf('package_update:')) {
        throw 'Guest Docker group was not declared before user/group setup and package installation.'
    }
    $seedDefinition = $runnerAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-SeedDisk' }, $true)
    if (@($seedDefinition.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Get-GuestCloudConfig' }, $true)).Count -ne 1) {
        throw 'Actual seed disk bypassed the guest user/group configuration contract.'
    }
    $realSessionAlive = (Get-Command Assert-SessionAlive).ScriptBlock
    $realNativeCommand = (Get-Command Invoke-RunnerNative).ScriptBlock
    $script:readinessCalls = 0; $script:readinessSleeps = 0
    function Assert-SessionAlive { param($State) }
    function Start-Sleep { param($Seconds) $script:readinessSleeps++ }
    function Invoke-RunnerNative {
        param($Executable, $Arguments)
        $script:readinessCalls++
        $remoteCommand = $Arguments[$Arguments.Count - 1]
        if ($Executable -cne 'ssh.exe' -or $Arguments -notcontains 'runner@172.30.240.2' -or
            $remoteCommand -notmatch 'cloud-init status --wait' -or $remoteCommand -notmatch 'test -S /var/run/docker.sock' -or
            $remoteCommand -notmatch 'test "\$\(id -un\)" = runner' -or $remoteCommand -notmatch 'timeout 10 docker info' -or $remoteCommand -match '\bsudo\b') {
            throw 'Guest readiness did not check unprivileged runner access to Docker.'
        }
        # A completed cloud-init with a recoverable warning exits 2. Neither it
        # nor failed Docker access (1) may satisfy the strict readiness contract.
        if ($script:readinessCalls -eq 1) { return 2 }
        if ($script:readinessCalls -eq 2) { return 1 }
        return 0
    }
    Wait-Guest ([pscustomobject]@{ instancePath = Join-Path $testRoot 'readiness' }) ([pscustomobject]@{ guestIp = '172.30.240.2' })
    if ($script:readinessCalls -ne 3 -or $script:readinessSleeps -ne 2) { throw 'Guest readiness accepted cloud-init warnings or a Docker access failure.' }
    Set-Item -Path Function:\Assert-SessionAlive -Value $realSessionAlive
    Set-Item -Path Function:\Invoke-RunnerNative -Value $realNativeCommand
    Remove-Item -Path Function:\Start-Sleep
    $expectedVmPath = Join-Path $validInstance $validName
    $script:fakeVm = [pscustomobject]@{
        Id = [guid]'11111111-1111-1111-1111-111111111111'; Name = $validName; Notes = ''; Path = $expectedVmPath; State = 'Off'
        AutomaticStartAction = 'Nothing'; AutomaticStopAction = 'TurnOff'
    }
    $script:fakeDisks = @([pscustomobject]@{ Path = Join-Path $validInstance 'guest.vhdx' })
    $script:deletions = 0
    $script:fakeVmRemoved = $false
    function Get-VM { param($Name, $Id) if (-not $script:fakeVmRemoved) { return $script:fakeVm } }
    # Provider coherence is tested separately by Cleanup.Integrity.Tests.ps1.
    function Get-RunnerVmInventory { return @(Get-VM) }
    function Get-VMHardDiskDrive { param($VM, $VMName) return $script:fakeDisks }
    function Remove-VM { param($VM, $Name, [switch]$Force) $script:deletions++; $script:fakeVmRemoved = $true }
    function Stop-VM { param($VM, $Name, [switch]$TurnOff, [switch]$Force) $script:fakeVm.State = 'Off' }
    Assert-RunnerVmLifecycle $validName
    foreach ($property in @('AutomaticStartAction', 'AutomaticStopAction')) {
        $previous = $script:fakeVm.$property
        $script:fakeVm.$property = 'Save'
        $rejected = $false
        try { Assert-RunnerVmLifecycle $validName } catch { $rejected = $true }
        if (-not $rejected) { throw "Unsafe VM lifecycle $property passed readback." }
        $script:fakeVm.$property = $previous
    }
    $creating = [pscustomobject]@{
        tag = $script:RunnerTag; vmName = $validName; vmId = $script:fakeVm.Id.ToString(); instancePath = $validInstance
        phase = 'creating'; expectedBootDisk = $script:fakeDisks[0].Path; expectedVmPath = $expectedVmPath
    }
    Remove-RunnerInstance $creating
    if ($script:deletions -ne 1) { throw 'Crash after New-VM left the exact provisional VM undeletable.' }
    foreach ($case in @('running', 'wrong-note', 'wrong-path', 'instance-root', 'descendant', 'wrong-recorded-path', 'extra-disk', 'wrong-disk', 'owned-phase', 'wrong-name')) {
        $script:fakeVmRemoved = $false
        $script:fakeVm.State = 'Off'; $script:fakeVm.Notes = ''; $script:fakeVm.Path = $expectedVmPath
        $creating.expectedVmPath = $expectedVmPath
        $script:fakeVm.Name = $validName; $creating.phase = 'creating'
        $script:fakeDisks = @([pscustomobject]@{ Path = $creating.expectedBootDisk })
        switch ($case) {
            'running' { $script:fakeVm.State = 'Running' }
            'wrong-note' { $script:fakeVm.Notes = 'unrelated' }
            'wrong-path' { $script:fakeVm.Path = Join-Path $validInstance 'another-vm' }
            'instance-root' { $script:fakeVm.Path = $validInstance }
            'descendant' { $script:fakeVm.Path = Join-Path $expectedVmPath 'another-vm' }
            'wrong-recorded-path' { $creating.expectedVmPath = Join-Path $validInstance 'another-vm' }
            'extra-disk' { $script:fakeDisks += [pscustomobject]@{ Path = Join-Path $validInstance 'cidata.vhdx' } }
            'wrong-disk' { $script:fakeDisks[0].Path = Join-Path $validInstance 'other.vhdx' }
            'owned-phase' { $creating.phase = 'owned' }
            'wrong-name' { $script:fakeVm.Name = 'ITIR-' + ('b' * 32) }
        }
        $rejected = $false
        try { Remove-RunnerInstance $creating } catch { $rejected = $true }
        if (-not $rejected -or $script:deletions -ne 1) { throw "Provisional cleanup accepted $case." }
    }
    $script:fakeVm.Name = $validName; $script:fakeVm.Notes = $script:RunnerTag
    $script:fakeVmRemoved = $false
    Remove-RunnerInstance $creating
    if ($script:deletions -ne 2) { throw 'Crash after tagging rejected normal owned cleanup.' }
    $creating.PSObject.Properties.Remove('expectedVmPath')
    $script:fakeVmRemoved = $false
    Remove-RunnerInstance $creating
    if ($script:deletions -ne 3) { throw 'Legacy state rejected the exact known New-VM nested layout.' }
    foreach ($badVmPath in @($validInstance, (Join-Path $expectedVmPath 'descendant'), (Join-Path $validInstance 'another-vm'))) {
        $script:fakeVmRemoved = $false
        $script:fakeVm.Path = $badVmPath
        $rejected = $false
        try { Remove-RunnerInstance $creating } catch { $rejected = $true }
        if (-not $rejected -or $script:deletions -ne 3) { throw 'Tagged cleanup adopted an unexpected path.' }
    }
    $script:fakeVm.Path = $expectedVmPath

    # Execute the actual seed-construction segment against a zero dynamic MAC;
    # all Hyper-V/disk commands are mocks and state is confined to this TEMP root.
    $script:seedAdapter = [pscustomobject]@{ VMName = $validName; SwitchName = 'ITIR-Isolated'; MacAddress = '000000000000'; DynamicMacAddressEnabled = $true }
    function Get-VMNetworkAdapter { param($VMName, [switch]$All) return $script:seedAdapter }
    function Set-VMNetworkAdapter { param($VMNetworkAdapter, $StaticMacAddress) $script:seedAdapter.MacAddress = $StaticMacAddress; $script:seedAdapter.DynamicMacAddressEnabled = $false }
    function Add-VMHardDiskDrive { param($VMName, $Path) }
    $realSeedWriter = (Get-Command New-SeedDisk).ScriptBlock
    function New-SeedDisk {
        param($Path, $PublicKey, $MacAddress, $Config, $ProfileLabel)
        $script:capturedSeedMac = $MacAddress
        if ($ProfileLabel -cne 'it-inventory-heavy') { throw 'Seed construction lost the selected profile.' }
        if ((Get-RunnerState).guestMac -cne $script:seedAdapter.MacAddress) { throw 'Seed was built before static MAC journaling.' }
    }
    Write-RunnerJson $script:RunnerStatePath $creating
    $name = $validName; $instance = $validInstance; $key = 'dummy public key'; $Config = [pscustomobject]@{}
    $profile = Get-RunnerResourceProfile 'it-inventory-heavy'
    $image = [pscustomobject]@{ prepared = $false }
    $sessionDefinition = $runnerAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-RunnerSession' }, $true)
    $segmentStart = $sessionDefinition.Extent.Text.IndexOf('$guestMac = Set-RunnerGuestMac')
    $segmentEnd = $sessionDefinition.Extent.Text.IndexOf('$script:RunnerOperationStage = ''network-isolation''')
    & ([scriptblock]::Create($sessionDefinition.Extent.Text.Substring($segmentStart, $segmentEnd - $segmentStart)))
    if ($script:capturedSeedMac -cnotmatch '^02(:[0-9a-f]{2}){5}$' -or
        ($script:capturedSeedMac.Replace(':', '').ToUpperInvariant()) -cne (Get-RunnerState).guestMac) {
        throw 'NoCloud seed did not use the assigned exact static MAC.'
    }
    $macChecks = @($sessionDefinition.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Assert-RunnerGuestMac' }, $true))
    $bootCall = $sessionDefinition.Find({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Start-GuardedVm' }, $true)
    if ($macChecks.Count -ne 3 -or $macChecks[0].Extent.StartOffset -ge $bootCall.Extent.StartOffset -or
        $macChecks[1].Extent.StartOffset -le $bootCall.Extent.StartOffset -or
        $macChecks[2].Extent.StartOffset -le $macChecks[1].Extent.StartOffset) { throw 'Static MAC is not checked around boot and before JIT.' }
    Set-Item -Path Function:\New-SeedDisk -Value $realSeedWriter
    Remove-Item -LiteralPath $script:RunnerStatePath -Force

    # Recovery denial/readback/Stop/death/freshness and independent-guardian
    # behavior now lives in the focused permanent suites above; drift requests
    # verified quarantine rather than the removed fatal-baseline implementation.

    # Execute the actual setup menu clauses against an inert installed-script
    # sink, proving activation happens before Start and failures stop the chain.
    $bin = Join-Path $testRoot 'bin'
    [void][IO.Directory]::CreateDirectory($bin)
    $controlSink = Join-Path $bin 'Runner.ps1'
    [IO.File]::WriteAllText($controlSink, @'
param([string] $Action, [string] $ExpectedPilotSha)
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'actions.txt'), $Action + "`n")
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'fail')) { throw 'synthetic activation failure' }
'@)
    $menuAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'SetupMenu.ps1'), [ref]$null, [ref]$null)
    $menuSwitch = $menuAst.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true)
    function Read-Host { return ('a' * 40) }
    function Assert-RunnerBundleCurrent { param($SourceRoot) }
    foreach ($choice in @('5', '6')) {
        $clause = @($menuSwitch.Clauses | Where-Object { $_.Item1.Value -eq $choice })[0].Item2
        $control = [scriptblock]::Create($clause.Extent.Text.Substring(1, $clause.Extent.Text.Length - 2))
        & $control
        $calls = [IO.File]::ReadAllLines((Join-Path $bin 'actions.txt'))
        $expectedAction = if ($choice -eq '5') { 'EnablePilot' } else { 'EnableActive' }
        if (($calls -join ',') -cne "$expectedAction,Start") { throw 'Setup menu failed reviewed activation order.' }
        Remove-Item -LiteralPath (Join-Path $bin 'actions.txt') -Force
        [IO.File]::WriteAllText((Join-Path $bin 'fail'), 'fail')
        $rejected = $false
        try { & $control } catch { $rejected = $true }
        $calls = [IO.File]::ReadAllLines((Join-Path $bin 'actions.txt'))
        if (-not $rejected -or ($calls -join ',') -cne $expectedAction) { throw 'Setup menu started after activation failed.' }
        Remove-Item -LiteralPath (Join-Path $bin 'actions.txt'), (Join-Path $bin 'fail') -Force
    }
    Remove-Item -Path Function:\Read-Host

    $realSupervisorLoop = (Get-Command Invoke-SupervisorLoop).ScriptBlock
    Write-RunnerJson $script:RunnerConfigPath ([ordered]@{
        schema = 1; tag = $script:RunnerTag; repo = 'example/runner-test'; maxMinutes = 120; activation = 'pilot'
        pilotExpectedSha = ('a' * 40); pilotWorkflowPath = '.github/workflows/local-runner-pilot.yml'; pilotLabel = 'it-inventory-pilot-' + ('a' * 40)
    })
    $previousFailure = Join-Path $testRoot 'last-error.json'
    if (Test-Path -LiteralPath $previousFailure) { Remove-Item -LiteralPath $previousFailure -Force }
    function Get-RunnerMemoryAdmission { return [pscustomobject]@{ ready = $true; availableBytes = 32GB } }
    function Get-OwnerToken { return 'SENTINEL_SECRET' }
    function Get-QueuedRunnerJob { param($Config, $Token) return [pscustomobject]@{ id = 123; labels = @('self-hosted', $Config.pilotLabel); pilotBinding = [pscustomobject]@{ runId = 456; workflowId = 789; workflowPath = '.github/workflows/local-runner-pilot.yml'; headSha = ('a' * 40); runAttempt = 1; pilotLabel = 'it-inventory-pilot-' + ('a' * 40) } } }
    function Get-PilotEvidence { param($Config, $Binding, $Token) return [pscustomobject]@{ job = [pscustomobject]@{ status = 'queued'; labels = @('self-hosted', ('it-inventory-pilot-' + ('a' * 40))); runner_id = 0 } } }
    function Invoke-RunnerSession {
        param($Config, $PilotAttempt)
        Write-RunnerJson (Join-Path $testRoot 'pilot-attempt.json') $PilotAttempt
        $script:RunnerOperationStage = 'key-generation'; $script:RunnerSessionName = $validName
        throw 'synthetic failure containing SENTINEL_SECRET'
    }
    function Write-EventLog {}
    function Start-Sleep { [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'stop.requested'), 'stop') }
    & $realSupervisorLoop
    $diagnosis = Read-RunnerJson (Join-Path $testRoot 'last-error.json')
    if ($diagnosis.stage -cne 'key-generation' -or $diagnosis.code -cne 'STAGE_FAILED' -or
        (Get-Content -LiteralPath (Join-Path $testRoot 'last-error.json') -Raw).Contains('SENTINEL_SECRET') -or
        (Read-RunnerJson (Join-Path $testRoot 'pilot-attempt.json')).jobId -ne 123) {
        throw 'Consumed pilot failure lost its safe stage/code or recorded secret-bearing exception text.'
    }
    Remove-Item -LiteralPath (Join-Path $testRoot 'stop.requested') -Force

    $script:events = [Collections.Generic.List[string]]::new()
    function Assert-Administrator {}
    function Assert-SecureRoot {}
    function Get-RunnerState { return $creating }
    function Remove-RunnerInstance { param($State) $script:events.Add('recovery') }
    function Invoke-SupervisorLoop { $script:events.Add('pickup') }
    Invoke-Supervisor
    if (($script:events -join ',') -ne 'recovery,pickup') { throw 'Supervisor pickup ran before stale-VM recovery.' }
    function Remove-RunnerInstance { param($State) throw 'recovery denied' }
    $script:events.Clear()
    $rejected = $false
    try { Invoke-Supervisor } catch { $rejected = $true }
    if (-not $rejected -or $script:events.Count -ne 0) { throw 'Supervisor picked up a job after failed boot recovery.' }
    $recovered = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1'
    Exit-RunnerLock $recovered

    $script:converterRegistration = [pscustomobject]@{ DistributionName = $stage.helperName; BasePath = $helperRoot }
    $script:converterCalls = [Collections.Generic.List[string]]::new()
    $script:converterFailure = ''
    function Get-ConverterRegistrations { param($Name) if ($null -ne $script:converterRegistration) { return $script:converterRegistration } }
    function wsl.exe {
        $verb = $args[0]
        $script:converterCalls.Add(($args -join ' '))
        $global:LASTEXITCODE = 0
        if ($verb -eq $script:converterFailure) { $global:LASTEXITCODE = 9; return }
        if ($verb -eq '--unregister') { $script:converterRegistration = $null }
    }
    $script:converterRegistration.BasePath = Join-Path $testRoot 'different-converter'
    $rejected = $false
    try { Remove-OwnedConverter $stage $helperRoot } catch { $rejected = $true }
    if (-not $rejected -or $script:converterCalls.Count -ne 0) { throw 'Unowned converter was terminated or unregistered.' }
    $script:converterRegistration.BasePath = '\\?\' + $helperRoot
    $script:converterFailure = '--terminate'
    $rejected = $false
    try { Remove-OwnedConverter $stage $helperRoot } catch { $rejected = $true }
    if (-not $rejected -or $script:converterCalls.Count -ne 1) { throw 'Converter retirement continued after termination failure.' }
    $script:converterCalls.Clear(); $script:converterFailure = ''
    Remove-OwnedConverter $stage $helperRoot
    if (($script:converterCalls -join ',') -ne "--terminate $($stage.helperName),--unregister $($stage.helperName),--list --quiet") {
        throw 'Converter retirement missed verified terminate/unregister/readback order.'
    }

    # The elevated diagnostic requires the exact protected stage/registration,
    # executes only three fixed read-only commands and retains no host changes.
    $script:converterRegistration = [pscustomobject]@{ DistributionName = $stage.helperName; BasePath = $helperRoot }
    $stage | Add-Member -NotePropertyName tag -NotePropertyValue $script:RunnerTag -Force
    Write-RunnerJson (Join-Path $testRoot 'setup-stage.json') $stage
    $script:diagnosticCalls = [Collections.Generic.List[string]]::new()
    function Invoke-ConverterCommand {
        param($Name, $Command, [switch]$CaptureOutput, [switch]$CaptureError, $TimeoutSeconds)
        if ($Name -cne $stage.helperName -or -not $CaptureOutput -or -not $CaptureError -or $TimeoutSeconds -ne 30) { throw 'Diagnostic lost exact binding or bounded output/timeout.' }
        $script:diagnosticCalls.Add(($Command -join '|'))
        return [pscustomobject]@{ ExitCode = 0; Output = 'read-only fixture'; ErrorOutput = '' }
    }
    Invoke-ConverterDiagnostics
    if ($script:diagnosticCalls.Count -ne 3 -or ($script:diagnosticCalls -join ',') -match 'apt-get|--import|--unregister|--terminate') {
        throw 'Converter diagnostic installed, changed or omitted a read-only command.'
    }
    $script:diagnosticCalls.Clear()
    $script:converterRegistration.BasePath = Join-Path $testRoot 'different-converter'
    $rejected = $false
    try { Invoke-ConverterDiagnostics } catch { $rejected = $true }
    if (-not $rejected -or $script:diagnosticCalls.Count -ne 0) { throw 'Diagnostic invoked an unowned converter.' }
    Write-Host 'Local runner contract checks passed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^ITIR-contract-[0-9a-f]{32}$') {
        throw 'Refusing to remove a contract-test directory outside TEMP.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
