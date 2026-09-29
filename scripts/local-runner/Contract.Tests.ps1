# Non-mutating host contract tests. Creates only a disposable directory below TEMP.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

foreach ($file in @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1')) {
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "PowerShell parse error in $($file.Name): $($errors[0].Message)" }
}

. (Join-Path $PSScriptRoot 'Common.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "ITIR-contract-$([guid]::NewGuid().ToString('N'))"
[void][IO.Directory]::CreateDirectory($testRoot)
$script:RunnerRoot = $testRoot
$script:RunnerStatePath = Join-Path $testRoot 'state.json'
$script:RunnerConfigPath = Join-Path $testRoot 'config.json'
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
        $job = Start-Job -ScriptBlock {
            $probe = [Threading.Mutex]::new($false, 'Global\ITInventoryLocalRunner-v1')
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
        File.WriteAllLines(args[args.Length - 1] + ".argv", args);
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

    # Load definitions only; never execute Runner.ps1's action dispatch.
    $runnerAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
    foreach ($definition in $runnerAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
        Invoke-Expression $definition.Extent.Text
    }
    $script:fakeVm = [pscustomobject]@{
        Name = $validName; Notes = ''; Path = $validInstance; State = 'Off'
        AutomaticStartAction = 'Nothing'; AutomaticStopAction = 'TurnOff'
    }
    $script:fakeDisks = @([pscustomobject]@{ Path = Join-Path $validInstance 'guest.vhdx' })
    $script:deletions = 0
    function Get-VM { param($Name) return $script:fakeVm }
    function Get-VMHardDiskDrive { param($VMName) return $script:fakeDisks }
    function Remove-VM { param($Name, [switch]$Force) $script:deletions++ }
    function Stop-VM { param($Name, [switch]$TurnOff, [switch]$Force) $script:fakeVm.State = 'Off' }
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
        tag = $script:RunnerTag; vmName = $validName; instancePath = $validInstance
        phase = 'creating'; expectedBootDisk = $script:fakeDisks[0].Path
    }
    Remove-RunnerInstance $creating
    if ($script:deletions -ne 1) { throw 'Crash after New-VM left the exact provisional VM undeletable.' }
    foreach ($case in @('running', 'wrong-note', 'wrong-path', 'extra-disk', 'wrong-disk', 'owned-phase', 'wrong-name')) {
        $script:fakeVm.State = 'Off'; $script:fakeVm.Notes = ''; $script:fakeVm.Path = $validInstance
        $script:fakeVm.Name = $validName; $creating.phase = 'creating'
        $script:fakeDisks = @([pscustomobject]@{ Path = $creating.expectedBootDisk })
        switch ($case) {
            'running' { $script:fakeVm.State = 'Running' }
            'wrong-note' { $script:fakeVm.Notes = 'unrelated' }
            'wrong-path' { $script:fakeVm.Path = Join-Path $validInstance 'another-vm' }
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
    Remove-RunnerInstance $creating
    if ($script:deletions -ne 2) { throw 'Crash after tagging rejected normal owned cleanup.' }

    # Route/address drift is fatal even during work blocked in another process.
    $script:fakeAddresses = @(
        [pscustomobject]@{ AddressFamily = 'IPv4'; IPAddress = '192.0.2.1'; PrefixLength = 24; InterfaceIndex = 7 },
        [pscustomobject]@{ AddressFamily = 'IPv6'; IPAddress = '2001:db8::1'; PrefixLength = 64; InterfaceIndex = 7 }
    )
    $script:fakeRoutes = @([pscustomobject]@{ AddressFamily = 'IPv4'; DestinationPrefix = '0.0.0.0/0'; NextHop = '192.0.2.2'; InterfaceIndex = 7 })
    $script:inspectionFailure = $false
    function Get-NetIPAddress { if ($script:inspectionFailure) { throw 'synthetic inspection failure' }; return $script:fakeAddresses }
    function Get-NetRoute { return $script:fakeRoutes }
    $script:aclRules = @()
    function Add-VMNetworkAdapterExtendedAcl {
        param($VMName, $Action, $Direction, $Weight, [switch]$Passthru, $RemoteIPAddress = '', $RemotePort = '', $Protocol = '', $Stateful = '', $LocalPort = '')
        $rule = [pscustomobject]@{
            Action = $Action; Direction = $Direction; Weight = $Weight; RemoteIPAddress = $RemoteIPAddress
            RemotePort = $RemotePort; Protocol = $Protocol; Stateful = $Stateful; LocalPort = $LocalPort; LocalIPAddress = ''
        }
        $script:aclRules += $rule
        return $rule
    }
    function Get-VMNetworkAdapterExtendedAcl { param($VMName) return $script:aclRules }
    [void](Set-IsolatedAdapter $validName)
    foreach ($port in @(80, 443, 5432)) {
        if (@($script:aclRules | Where-Object { $_.Action -eq 'Allow' -and $_.Direction -eq 'Outbound' -and $_.Protocol -eq 'TCP' -and $_.RemotePort -eq $port -and $_.Weight -eq 100 }).Count -ne 1) {
            throw "Expected public TCP $port rule is missing."
        }
    }
    if (@($script:aclRules | Where-Object { $_.RemotePort -eq 6543 }).Count -ne 0 -or
        @($script:aclRules | Where-Object { $_.Action -eq 'Deny' -and $_.RemoteIPAddress -eq '192.0.2.1/32' -and $_.Weight -gt 100 }).Count -ne 1 -or
        @($script:aclRules | Where-Object { $_.Action -eq 'Deny' -and $_.RemoteIPAddress -eq '::/0' -and $_.Weight -gt 100 }).Count -ne 1) {
        throw 'Public database routing weakened host/IPv6 denial or opened unused 6543.'
    }
    $fingerprint = Get-HostNetworkFingerprint
    [Array]::Reverse($script:fakeAddresses)
    if ((Get-HostNetworkFingerprint) -cne $fingerprint) { throw 'Network fingerprint depends on enumeration order.' }
    $networkState = [pscustomobject]@{
        tag = $script:RunnerTag; vmName = $validName; instancePath = $validInstance
        networkFingerprint = $fingerprint; supervisorPid = $PID
        heartbeatUtc = [DateTime]::UtcNow.ToString('o')
        supervisorStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
        deadlineUtc = [DateTime]::UtcNow.AddMinutes(1).ToString('o')
    }
    Write-RunnerJson $script:RunnerStatePath $networkState
    $guardReady = Invoke-GuardCheck $validName
    if (-not $guardReady -or $null -eq (Get-RunnerState) -or (Get-RunnerState).guardianReady -ne $true) {
        $guardError = Read-RunnerJson (Join-Path $testRoot 'last-error.json')
        throw "Stable network guardian failed readiness: $($guardError | ConvertTo-Json -Compress)."
    }
    foreach ($change in @('route', 'ipv4', 'ipv6', 'inspection')) {
        Write-RunnerJson $script:RunnerStatePath $networkState
        switch ($change) {
            'route' { $script:fakeRoutes[0].NextHop = '192.0.2.3' }
            'ipv4' { $script:fakeAddresses[1].IPAddress = '192.0.2.4' }
            'ipv6' { $script:fakeAddresses[0].IPAddress = '2001:db8::2' }
            'inspection' { $script:inspectionFailure = $true }
        }
        $before = $script:deletions
        if ((Invoke-GuardCheck $validName) -ne $false -or $script:deletions -ne $before + 1 -or (Get-RunnerState)) {
            throw "Guardian did not cancel and clean a session on $change drift."
        }
        $failure = Read-RunnerJson (Join-Path $testRoot 'last-error.json')
        $expectedCode = if ($change -eq 'inspection') { 'NETWORK_INSPECTION_FAILED' } else { 'NETWORK_CHANGED' }
        if ($failure.code -cne $expectedCode -or $failure.stage -cne 'network-guard') { throw 'Guardian lost its fixed safe failure diagnosis.' }
        $script:fakeRoutes[0].NextHop = '192.0.2.2'
        $script:fakeAddresses[1].IPAddress = '192.0.2.1'; $script:fakeAddresses[0].IPAddress = '2001:db8::1'
        $script:inspectionFailure = $false
    }
    $script:starts = 0
    function Start-VM { param($Name) $script:starts++ }
    $rejected = $false
    try { Start-GuardedVm $networkState } catch { $rejected = $true }
    if (-not $rejected -or $script:starts -ne 0) { throw 'Cancelled session booted after guardian removed its state.' }
    Write-RunnerJson $script:RunnerStatePath $networkState
    [void](Invoke-GuardCheck $validName)
    Start-GuardedVm $networkState
    if ($script:starts -ne 1) { throw 'Stable session could not boot with its ready guardian.' }
    $script:fakeRoutes[0].InterfaceIndex = 8
    $rejected = $false
    try { Assert-SessionAlive $networkState } catch { $rejected = $true }
    if (-not $rejected) { throw 'Fresh pre-JIT session check accepted route drift.' }
    $script:fakeRoutes[0].InterfaceIndex = 7
    Remove-Item -LiteralPath $script:RunnerStatePath -Force

    # The guardian executes in another process while the supervisor is inside
    # a blocking native call, rather than relying on supervisor polling.
    Write-RunnerJson $script:RunnerStatePath $networkState
    $readyName = 'Local\ITIR-guard-test-' + [guid]::NewGuid().ToString('N')
    $ready = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $readyName)
    $guardJob = Start-Job -ArgumentList $PSScriptRoot, $testRoot, $validName, $readyName -ScriptBlock {
        param($source, $root, $name, $eventName)
        . (Join-Path $source 'Common.ps1')
        $script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
        $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $source 'Runner.ps1'), [ref]$null, [ref]$null)
        $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-GuardCheck' }, $true)
        Invoke-Expression $definition.Extent.Text
        function Get-HostNetworkFingerprint { return 'synthetic changed fingerprint' }
        function Remove-RunnerInstance {
            param($State)
            Assert-StateIdentity $State
            Remove-Item -LiteralPath $script:RunnerStatePath -Force
            [IO.File]::WriteAllText((Join-Path $script:RunnerRoot 'guard-cancelled'), 'cancelled')
        }
        $signal = [Threading.EventWaitHandle]::OpenExisting($eventName)
        try { [void]$signal.Set() } finally { $signal.Dispose() }
        Start-Sleep -Milliseconds 250
        Invoke-GuardCheck $name
    }
    try {
        if (-not $ready.WaitOne([TimeSpan]::FromSeconds(10))) { throw 'Independent test guardian did not initialize.' }
        [void](Invoke-RunnerNative $sink @('--block', (Join-Path $testRoot 'blocked-work')))
        [void](Wait-Job $guardJob -Timeout 10)
        if ($guardJob.State -ne 'Completed' -or (Receive-Job $guardJob) -ne $false -or
            -not (Test-Path -LiteralPath (Join-Path $testRoot 'guard-cancelled')) -or (Get-RunnerState)) {
            throw 'Independent guardian did not cancel during blocking native work.'
        }
    } finally {
        if ($guardJob.State -eq 'Running') { Stop-Job $guardJob }
        Remove-Job $guardJob -Force
        $ready.Dispose()
    }

    # Execute the actual setup menu clauses against an inert installed-script
    # sink, proving activation happens before Start and failures stop the chain.
    $bin = Join-Path $testRoot 'bin'
    [void][IO.Directory]::CreateDirectory($bin)
    $controlSink = Join-Path $bin 'Runner.ps1'
    [IO.File]::WriteAllText($controlSink, @'
param([string] $Action)
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'actions.txt'), $Action + "`n")
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'fail')) { throw 'synthetic activation failure' }
'@)
    $menuAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'SetupMenu.ps1'), [ref]$null, [ref]$null)
    $menuSwitch = $menuAst.Find({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true)
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

    $realSupervisorLoop = (Get-Command Invoke-SupervisorLoop).ScriptBlock
    Write-RunnerJson $script:RunnerConfigPath ([ordered]@{
        schema = 1; tag = $script:RunnerTag; repo = 'example/runner-test'; maxMinutes = 120; activation = 'pilot'
    })
    Remove-Item -LiteralPath (Join-Path $testRoot 'last-error.json') -Force
    function Get-OwnerToken { return 'SENTINEL_SECRET' }
    function Get-QueuedRunnerJob { param($Config, $Token) return [pscustomobject]@{ id = 123 } }
    function Invoke-RunnerSession {
        param($Config)
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
