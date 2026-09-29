# Durable owner-controlled installed bundle update. Never activates or starts pickup.
[CmdletBinding()]
param([switch] $Resume)
. (Join-Path $PSScriptRoot 'Common.ps1')

function Get-RunnerBundle([string] $SourceRoot) {
    $path = Join-Path $SourceRoot 'Bundle.json'
    $bundle = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $names = @('Common.ps1', 'Runner.ps1', 'Guest.Network.ps1', 'SetupMenu.ps1', 'Setup.ps1', 'Setup.Download.ps1', 'Update.ps1',
        'Setup.cmd', 'Start.cmd', 'Restart.cmd', 'Stop.cmd', 'Status.cmd')
    if ($bundle.schema -ne 1 -or $bundle.tag -cne $script:RunnerTag -or $bundle.version -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$' -or
        $bundle.files.Count -ne $names.Count -or (Compare-Object @($bundle.files.name | Sort-Object) @($names | Sort-Object))) {
        throw 'Runner bundle manifest identity/version/dependency list is invalid.'
    }
    foreach ($file in $bundle.files) {
        $sourcePath = Join-Path $SourceRoot $file.name
        if ($file.hash -cnotmatch '^[0-9A-F]{64}$' -or -not (Test-Path -LiteralPath $sourcePath -PathType Leaf) -or
            (Get-Item -LiteralPath $sourcePath).Attributes -band [IO.FileAttributes]::ReparsePoint -or
            (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -cne $file.hash) {
            throw 'Runner bundle source/dependency hash verification failed.'
        }
    }
    return [pscustomobject]@{ manifest = $bundle; hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
}

function Test-InstalledRunnerBundle([string] $SourceRoot) {
    $source = Get-RunnerBundle $SourceRoot
    $receipt = Read-RunnerJson (Assert-OwnedPath (Join-Path $script:RunnerRoot 'installed-bundle.json'))
    if ($null -eq $receipt -or $receipt.tag -cne $script:RunnerTag -or $receipt.manifestHash -cne $source.hash -or
        $receipt.version -cne $source.manifest.version) { return $false }
    foreach ($file in $source.manifest.files) {
        $path = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'bin') $file.name)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
        Assert-RunnerProtectedPath $path
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $file.hash) { return $false }
    }
    $manifestPath = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Bundle.json')
    return (Test-Path -LiteralPath $manifestPath -PathType Leaf) -and (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ceq $source.hash
}

function Assert-RunnerBundleCurrent([string] $SourceRoot, [switch] $AllowPendingRetry) {
    Assert-SecureRoot
    if ($AllowPendingRetry) {
        foreach ($name in @('pilot-retry.json', 'update-journal.json')) {
            $journal = Read-RunnerJson (Join-Path $script:RunnerRoot $name)
            if ($null -ne $journal -and ($journal.tag -cne $script:RunnerTag -or
                $journal.phase -cnotin @('pending', 'complete') -or ($name -ceq 'update-journal.json' -and $journal.phase -ceq 'pending'))) {
                throw 'Invalid retry journal or pending update blocks retry control.'
            }
        }
    } else { Assert-RunnerTransitionClear }
    if (-not (Test-InstalledRunnerBundle $SourceRoot)) { throw 'Installed runner bundle differs from this reviewed checkout. Choose option 2 to explicitly update while idle.' }
}

function Invoke-InstalledRunnerStop([string] $RunnerPath = '') {
    $runner = if ($RunnerPath) { Assert-OwnedPath $RunnerPath } else { Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') }
    Assert-RunnerProtectedPath $runner
    $exitCode = Invoke-RunnerNative 'powershell.exe' @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $runner, '-Action', 'Stop')
    if ($exitCode -ne 0) { throw 'Installed supported Stop failed; update was not activated.' }
}

function Get-UpdatePreservedHashes {
    $records = [ordered]@{}
    foreach ($name in @('credential.dpapi', 'pilot-attempt.json', 'pilot-result.json', 'last-error.json', 'pilot-retry.json')) {
        $path = Assert-OwnedPath (Join-Path $script:RunnerRoot $name)
        $records[$name] = if (Test-Path -LiteralPath $path -PathType Leaf) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash } else { 'absent' }
    }
    return [pscustomobject]$records
}

function Assert-UpdatePreservedHashes($Expected) {
    $actual = Get-UpdatePreservedHashes
    foreach ($property in $Expected.PSObject.Properties) {
        if ($actual.($property.Name) -cne $property.Value) { throw 'Protected credential/pilot evidence changed during update; refusing overwrite.' }
    }
}

function Complete-RunnerBundleUpdate($Plan) {
    if ($Plan.tag -cne $script:RunnerTag -or $Plan.schema -ne 1 -or $Plan.updateId -cnotmatch '^[0-9a-f]{32}$' -or $Plan.phase -cne 'pending') {
        throw 'Pending update journal identity is invalid.'
    }
    $bin = Assert-OwnedPath (Join-Path $script:RunnerRoot 'bin')
    $stage = Assert-OwnedPath (Join-Path (Join-Path $bin 'updates') $Plan.updateId)
    Assert-RunnerProtectedPath $bin
    Assert-RunnerProtectedPath $stage
    # Verify the retained manifest and all staged dependencies before overwriting anything.
    $bundle = Get-RunnerBundle $stage
    if ($bundle.hash -cne $Plan.manifestHash -or $bundle.manifest.version -cne $Plan.version) { throw 'Retained update bundle differs from pending intent.' }
    $expectedNames = @($bundle.manifest.files.name) + @('Bundle.json')
    if ($Plan.files.Count -ne $expectedNames.Count -or (Compare-Object @($Plan.files.name | Sort-Object) @($expectedNames | Sort-Object))) {
        throw 'Pending update file plan does not match the verified dependency set.'
    }
    foreach ($file in $Plan.files) {
        $stagedPath = Assert-OwnedPath (Join-Path $stage $file.name)
        Assert-RunnerProtectedPath $stagedPath
        $expectedHash = if ($file.name -ceq 'Bundle.json') { $bundle.hash } else { @($bundle.manifest.files | Where-Object name -CEQ $file.name)[0].hash }
        if ($file.hash -cne $expectedHash -or (Get-FileHash -LiteralPath $stagedPath -Algorithm SHA256).Hash -cne $file.hash) { throw 'Staged update file/hash changed.' }
        $path = Assert-OwnedPath (Join-Path $bin $file.name)
        if (Test-Path -LiteralPath $path) { Assert-RunnerProtectedPath $path }
        if (-not (Test-RunnerEvidence $path $file.old) -and
            (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $file.hash)) {
            throw 'Installed file differs from recorded old/new states; refusing update adoption.'
        }
    }
    Assert-UpdatePreservedHashes $Plan.preserved
    $receiptPath = Join-Path $script:RunnerRoot 'installed-bundle.json'
    $expectedReceipt = Get-RunnerJsonEvidence ([ordered]@{ tag = $script:RunnerTag; version = $Plan.version; manifestHash = $Plan.manifestHash })
    if ($Plan.newReceipt.hash -cne $expectedReceipt.hash -or
        (-not (Test-RunnerEvidence $receiptPath $Plan.oldReceipt) -and -not (Test-RunnerEvidence $receiptPath $Plan.newReceipt))) {
        throw 'Installed bundle receipt changed outside pending update.'
    }
    $disabled = Get-RunnerEvidenceValue $Plan.oldConfig
    $disabled.activation = 'disabled'
    $disabledEvidence = Get-RunnerJsonEvidence $disabled
    if ($Plan.disabledConfig.hash -cne $disabledEvidence.hash -or
        (-not (Test-RunnerEvidence $script:RunnerConfigPath $Plan.oldConfig) -and -not (Test-RunnerEvidence $script:RunnerConfigPath $Plan.disabledConfig))) {
        throw 'Installed config changed outside the recorded update transition.'
    }
    Write-RunnerEvidence $script:RunnerConfigPath $Plan.disabledConfig
    Invoke-RunnerTransitionCheckpoint 'update-disabled'
    foreach ($file in $Plan.files) {
        $destination = Assert-OwnedPath (Join-Path $bin $file.name)
        if (-not (Test-RunnerEvidence $destination $file.old) -and
            (-not (Test-Path -LiteralPath $destination -PathType Leaf) -or (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -cne $file.hash)) {
            throw 'Installed file changed before atomic replacement.'
        }
        Write-RunnerBytes $destination ([IO.File]::ReadAllBytes((Join-Path $stage $file.name)))
        Assert-RunnerProtectedPath $destination
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -cne $file.hash) { throw 'Installed update readback hash failed.' }
        Invoke-RunnerTransitionCheckpoint ('update-file-' + $file.name)
    }
    if (-not (Test-RunnerEvidence $receiptPath $Plan.oldReceipt) -and -not (Test-RunnerEvidence $receiptPath $Plan.newReceipt)) {
        throw 'Installed bundle receipt changed outside pending update.'
    }
    Write-RunnerEvidence $receiptPath $Plan.newReceipt
    Invoke-RunnerTransitionCheckpoint 'update-receipt'
    Assert-UpdatePreservedHashes $Plan.preserved
    if (-not (Test-InstalledRunnerBundle $stage)) { throw 'Coherent installed bundle verification failed; pickup remains disabled.' }
    if (-not (Test-RunnerEvidence $script:RunnerConfigPath $Plan.disabledConfig)) { throw 'Disabled update config changed before restoration.' }
    Write-RunnerEvidence $script:RunnerConfigPath $Plan.oldConfig
    Invoke-RunnerTransitionCheckpoint 'update-restored-config'
    Invoke-RunnerTransitionCheckpoint 'update-before-complete'
    $Plan.phase = 'complete'
    Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') $Plan
    Invoke-RunnerTransitionCheckpoint 'update-complete'
    Write-Host "Runner bundle $($Plan.version) installed and verified. Config/evidence preserved; pickup remains stopped."
}

function Install-RunnerBundle([string] $SourceRoot, [switch] $Resume) {
    Assert-Administrator
    Assert-SecureRoot
    $journalPath = Assert-OwnedPath (Join-Path $script:RunnerRoot 'update-journal.json')
    $pending = Read-RunnerJson $journalPath
    if ($null -ne $pending -and ($pending.tag -cne $script:RunnerTag -or $pending.phase -cnotin @('pending', 'complete'))) { throw 'Installed update journal is invalid.' }
    if ($null -ne $pending -and $pending.phase -ceq 'pending' -and -not $Resume) { throw 'Explicit -Resume is required for the exact retained pending bundle.' }
    if ($Resume -and ($null -eq $pending -or $pending.phase -cne 'pending')) { throw 'There is no pending bundle update to resume.' }
    if (-not $Resume) {
        Assert-RunnerTransitionClear
        $sourceBundle = Get-RunnerBundle $SourceRoot
        if (Test-InstalledRunnerBundle $SourceRoot) { Write-Host 'Installed runner bundle already matches this checkout.'; return }
        $binPath = Assert-OwnedPath (Join-Path $script:RunnerRoot 'bin')
        Assert-RunnerProtectedPath $binPath
        foreach ($name in @($sourceBundle.manifest.files.name) + @('Bundle.json')) {
            $path = Assert-OwnedPath (Join-Path $binPath $name)
            if (Test-Path -LiteralPath $path) { Assert-RunnerProtectedPath $path }
        }
    }
    # Stop is the sole runner mutation before locking. Never update a live session.
    if ((Get-RunnerState) -or @(Get-VM -ErrorAction Stop | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -gt 0) { throw 'Update requires no session or owned-prefix VM.' }
    if ($Resume) {
        # A partially replaced installed Runner may lack its newly required helper.
        # Run supported Stop from the complete, verified retained bundle instead.
        if ($pending.schema -ne 1 -or $pending.updateId -cnotmatch '^[0-9a-f]{32}$') { throw 'Pending update identity is invalid.' }
        $stage = Assert-OwnedPath (Join-Path (Join-Path (Join-Path $script:RunnerRoot 'bin') 'updates') $pending.updateId)
        Assert-RunnerProtectedPath $stage
        $retained = Get-RunnerBundle $stage
        if ($retained.hash -cne $pending.manifestHash -or $retained.manifest.version -cne $pending.version) { throw 'Pending Stop bundle differs from retained update intent.' }
        foreach ($name in @($retained.manifest.files.name) + @('Bundle.json')) { Assert-RunnerProtectedPath (Assert-OwnedPath (Join-Path $stage $name)) }
        Invoke-InstalledRunnerStop (Join-Path $stage 'Runner.ps1')
    } else { Invoke-InstalledRunnerStop }
    $supervisorLock = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1'
    try {
        $mutex = Enter-RunnerLock
        try {
            Assert-RunnerControlIdle
            if (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested') -PathType Leaf)) { throw 'Supported Stop marker is absent.' }
            if ($Resume) { Complete-RunnerBundleUpdate $pending; return }
            $oldConfig = Get-RunnerFileEvidence $script:RunnerConfigPath
            [void](Get-RunnerConfig)
            $disabled = Get-RunnerEvidenceValue $oldConfig; $disabled.activation = 'disabled'
            $bin = Assert-OwnedPath (Join-Path $script:RunnerRoot 'bin'); Assert-RunnerProtectedPath $bin
            $id = [guid]::NewGuid().ToString('N')
            $stage = Assert-OwnedPath (Join-Path (Join-Path $bin 'updates') $id)
            [void][IO.Directory]::CreateDirectory($stage)
            Assert-RunnerProtectedPath $stage
            $files = @()
            foreach ($name in @($sourceBundle.manifest.files.name) + @('Bundle.json')) {
                $destination = Assert-OwnedPath (Join-Path $bin $name)
                if (Test-Path -LiteralPath $destination) { Assert-RunnerProtectedPath $destination }
                $stagedPath = Assert-OwnedPath (Join-Path $stage $name)
                [IO.File]::Copy((Join-Path $SourceRoot $name), $stagedPath, $false)
                $hash = (Get-FileHash -LiteralPath $stagedPath -Algorithm SHA256).Hash
                $expected = if ($name -ceq 'Bundle.json') { $sourceBundle.hash } else { @($sourceBundle.manifest.files | Where-Object name -CEQ $name)[0].hash }
                if ($hash -cne $expected) { throw 'Source bundle changed while staging; no installed script replaced.' }
                $files += [pscustomobject]@{ name = $name; hash = $hash; old = Get-RunnerFileEvidence $destination }
            }
            $receipt = Get-RunnerJsonEvidence ([ordered]@{ tag = $script:RunnerTag; version = $sourceBundle.manifest.version; manifestHash = $sourceBundle.hash })
            $plan = [pscustomobject]@{
                schema = 1; tag = $script:RunnerTag; phase = 'pending'; updateId = $id; version = $sourceBundle.manifest.version
                manifestHash = $sourceBundle.hash; oldConfig = $oldConfig; disabledConfig = Get-RunnerJsonEvidence $disabled
                oldReceipt = Get-RunnerFileEvidence (Join-Path $script:RunnerRoot 'installed-bundle.json'); newReceipt = $receipt
                files = $files; preserved = Get-UpdatePreservedHashes
            }
            Write-RunnerJson $journalPath $plan
            Invoke-RunnerTransitionCheckpoint 'update-pending'
            Complete-RunnerBundleUpdate $plan
        } finally { Exit-RunnerLock $mutex }
    } finally { Exit-RunnerLock $supervisorLock }
}

if ($MyInvocation.InvocationName -ne '.') { Install-RunnerBundle $PSScriptRoot -Resume:$Resume }
