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
