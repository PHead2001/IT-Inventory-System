# Durable owner-controlled installed bundle update. Never activates or starts pickup.
[CmdletBinding()]
param([switch] $Resume)
. (Join-Path $PSScriptRoot 'Common.ps1')

function Get-RunnerBundleVersion([string] $Version) {
    if ($Version -cnotmatch '^([0-9]{4}-[0-9]{2}-[0-9]{2})\.([0-9]+)$') { throw 'Runner bundle version is invalid.' }
    try {
        $date = [DateTime]::ParseExact($Matches[1], 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        $revision = [long]::Parse($Matches[2], [Globalization.CultureInfo]::InvariantCulture)
    } catch { throw 'Runner bundle version date/revision is invalid.' }
    return [pscustomobject]@{ date = $date; revision = $revision }
}

function Get-RunnerBundleNames {
    return @('Common.ps1', 'Runner.ps1', 'Guest.Network.ps1', 'Network.Recovery.ps1', 'Network.Recovery.Probe.ps1', 'Probe.Job.ps1', 'PreparedImage.ps1', 'Image.Prepare.sh', 'Image.Inputs.json', 'Image.Package.json', 'Image.PackageLock.json', 'Image.Supabase.toml', 'SetupMenu.ps1', 'Setup.ps1', 'Setup.Download.ps1', 'Update.ps1',
        'Setup.cmd', 'Start.cmd', 'Restart.cmd', 'Stop.cmd', 'Status.cmd')
}

function Get-RunnerPreRecoveryBundleNames {
    return @(Get-RunnerBundleNames | Where-Object { $_ -cnotin @('Network.Recovery.ps1', 'Network.Recovery.Probe.ps1', 'Probe.Job.ps1') })
}

function Get-RunnerLegacyBundleNames {
    return @('Common.ps1', 'Runner.ps1', 'Guest.Network.ps1', 'SetupMenu.ps1', 'Setup.ps1', 'Setup.Download.ps1', 'Update.ps1',
        'Setup.cmd', 'Start.cmd', 'Restart.cmd', 'Stop.cmd', 'Status.cmd')
}

function Get-RunnerBundle([string] $SourceRoot, [switch] $AllowLegacyInstalled) {
    $path = Join-Path $SourceRoot 'Bundle.json'
    $bundle = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $names = Get-RunnerBundleNames
    # Only a verified old installed bundle can use the historical dependency set.
    # New source/updates always require image inputs and the current host module.
    if ($AllowLegacyInstalled -and
        [string]::Equals([IO.Path]::GetFullPath($SourceRoot), [IO.Path]::GetFullPath((Join-Path $script:RunnerRoot 'bin')), [StringComparison]::OrdinalIgnoreCase) -and
        $bundle.version -cmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$') {
        $version = Get-RunnerBundleVersion $bundle.version
        $preRecovery = Get-RunnerPreRecoveryBundleNames
        if ($bundle.version -cin @('2026-10-06.7', '2026-10-06.8') -and
            $bundle.files.Count -eq $preRecovery.Count -and -not (Compare-Object @($bundle.files.name | Sort-Object) @($preRecovery | Sort-Object))) { $names = $preRecovery }
        $cutoff = Get-RunnerBundleVersion '2026-10-06.1'
        $legacy = Get-RunnerLegacyBundleNames
        if (($version.date -lt $cutoff.date -or ($version.date -eq $cutoff.date -and $version.revision -le $cutoff.revision)) -and
            $bundle.files.Count -eq $legacy.Count -and -not (Compare-Object @($bundle.files.name | Sort-Object) @($legacy | Sort-Object))) { $names = $legacy }
    }
    if ($bundle.schema -ne 1 -or $bundle.tag -cne $script:RunnerTag -or $bundle.version -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$' -or
        $bundle.files.Count -ne $names.Count -or (Compare-Object @($bundle.files.name | Sort-Object) @($names | Sort-Object))) {
        throw 'Runner bundle manifest identity/version/dependency list is invalid.'
    }
    [void](Get-RunnerBundleVersion $bundle.version)
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

# Initial setup publication is recoverable even after config becomes visible.
# The journal contains the exact reviewed bytes; resume never reads a later checkout.
function Complete-RunnerSetupPublication($Plan) {
    if ($Plan.schema -ne 1 -or $Plan.tag -cne $script:RunnerTag -or $Plan.phase -cnotin @('pending', 'complete')) { throw 'Setup publication identity is invalid.' }
    $config = Get-RunnerEvidenceValue $Plan.config
    $receipt = Get-RunnerEvidenceValue $Plan.receipt
    $stage = Get-RunnerEvidenceValue $Plan.stage
    if ($null -eq $config -or $config.tag -cne $script:RunnerTag -or $config.schema -ne 1 -or $config.activation -cne 'disabled' -or
        $null -eq $stage -or $stage.tag -cne $script:RunnerTag -or $stage.repo -cne $config.repo -or $stage.group -ne $config.runnerGroupId) {
        throw 'Setup publication does not match its owned setup stage/disabled config.'
    }
    $stagePath = Assert-OwnedPath (Join-Path $script:RunnerRoot 'setup-stage.json')
    if (-not (Test-RunnerEvidence $stagePath $Plan.stage) -and -not ($Plan.phase -ceq 'complete' -and -not (Test-Path -LiteralPath $stagePath))) { throw 'Owned setup stage changed outside publication.' }
    $names = @(Get-RunnerBundleNames) + @('Bundle.json')
    if ($Plan.files.Count -ne $names.Count -or (Compare-Object @($Plan.files.name | Sort-Object) @($names | Sort-Object))) { throw 'Setup publication dependency set is invalid.' }
    $manifestRecord = @($Plan.files | Where-Object name -CEQ 'Bundle.json')[0]
    $manifest = Get-RunnerEvidenceValue $manifestRecord.evidence
    if ($manifest.schema -ne 1 -or $manifest.tag -cne $script:RunnerTag -or
        $manifest.files.Count -ne ($names.Count - 1) -or (Compare-Object @($manifest.files.name | Sort-Object) @(Get-RunnerBundleNames | Sort-Object)) -or
        $receipt.tag -cne $script:RunnerTag -or $receipt.version -cne $manifest.version -or $receipt.manifestHash -cne $manifestRecord.evidence.hash) { throw 'Setup publication bundle/receipt is incoherent.' }
    [void](Get-RunnerBundleVersion $manifest.version)
    $bin = Assert-OwnedPath (Join-Path $script:RunnerRoot 'bin')
    Assert-RunnerProtectedPath $bin
    $artifacts = @()
    foreach ($file in $Plan.files) {
        $bytes = [Convert]::FromBase64String($file.evidence.content)
        $expected = if ($file.name -ceq 'Bundle.json') { $receipt.manifestHash } else { @($manifest.files | Where-Object name -CEQ $file.name)[0].hash }
        if (-not $file.evidence.exists -or $expected -cnotmatch '^[0-9A-F]{64}$' -or $file.evidence.hash -cne $expected -or (Get-RunnerBytesHash $bytes) -cne $expected) { throw 'Setup publication bytes differ from its manifest.' }
        $artifacts += [pscustomobject]@{ path = Assert-OwnedPath (Join-Path $bin $file.name); evidence = $file.evidence; checkpoint = ('setup-file-' + $file.name) }
    }
    $artifacts += [pscustomobject]@{ path = Join-Path $script:RunnerRoot 'installed-bundle.json'; evidence = $Plan.receipt; checkpoint = 'setup-receipt' }
    $artifacts += [pscustomobject]@{ path = $script:RunnerConfigPath; evidence = $Plan.config; checkpoint = 'setup-config' }
    # Validate every target before the first write. Existing bytes must be exact;
    # missing artifacts are recoverable only through this durable intent.
    foreach ($artifact in $artifacts) {
        if (Test-Path -LiteralPath $artifact.path) {
            Assert-RunnerProtectedPath $artifact.path
            if (-not (Test-RunnerEvidence $artifact.path $artifact.evidence)) { throw 'Setup target differs from exact publication intent; refusing adoption.' }
        } elseif ($Plan.phase -ceq 'complete') { throw 'Completed setup has missing artifacts; publication cannot repair arbitrary damage.' }
    }
    foreach ($artifact in $artifacts) {
        if (-not (Test-Path -LiteralPath $artifact.path)) { Write-RunnerBytes $artifact.path ([Convert]::FromBase64String($artifact.evidence.content)) }
        if (-not (Test-RunnerEvidence $artifact.path $artifact.evidence)) { throw 'Setup publication readback failed.' }
        Assert-RunnerProtectedPath $artifact.path
        Invoke-RunnerTransitionCheckpoint $artifact.checkpoint
    }
    [void](Get-CoherentInstalledRunnerBundle)
    $Plan.phase = 'complete'
    Write-RunnerJson (Join-Path $script:RunnerRoot 'setup-publication.json') $Plan
    Invoke-RunnerTransitionCheckpoint 'setup-complete'
    if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Force }
    Invoke-RunnerTransitionCheckpoint 'setup-stage-removed'
}

function Resume-RunnerSetupPublication {
    Invoke-RunnerControl {
        Assert-Administrator
        Assert-SecureRoot
        $mutex = Enter-RunnerLock
        try {
            $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'setup-publication.json')
            Assert-RunnerProtectedPath $path
            $plan = Read-RunnerJson $path
            if ($null -eq $plan) { throw 'No recorded setup publication exists.' }
            Assert-RunnerControlIdle
            Complete-RunnerSetupPublication $plan
        } finally { Exit-RunnerLock $mutex }
    }
}

function Test-InstalledRunnerBundle([string] $SourceRoot, [switch] $AllowLegacyInstalled) {
    $source = Get-RunnerBundle $SourceRoot -AllowLegacyInstalled:$AllowLegacyInstalled
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
    if (Test-Path -LiteralPath $manifestPath) { Assert-RunnerProtectedPath $manifestPath }
    return (Test-Path -LiteralPath $manifestPath -PathType Leaf) -and (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ceq $source.hash
}

function Get-CoherentInstalledRunnerBundle {
    $bin = Assert-OwnedPath (Join-Path $script:RunnerRoot 'bin')
    Assert-RunnerProtectedPath $bin
    foreach ($name in @('Bundle.json', 'installed-bundle.json')) {
        $path = if ($name -ceq 'Bundle.json') { Join-Path $bin $name } else { Join-Path $script:RunnerRoot $name }
        Assert-RunnerProtectedPath (Assert-OwnedPath $path)
    }
    $bundle = Get-RunnerBundle $bin -AllowLegacyInstalled
    if (-not (Test-InstalledRunnerBundle $bin -AllowLegacyInstalled)) { throw 'Installed manifest, receipt or dependencies are not coherent.' }
    return $bundle
}

function Assert-RunnerBundleUpgrade($SourceBundle) {
    $bin = Assert-OwnedPath (Join-Path $script:RunnerRoot 'bin')
    $manifestExists = Test-Path -LiteralPath (Join-Path $bin 'Bundle.json')
    $receiptExists = Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'installed-bundle.json')
    if ($manifestExists -or $receiptExists) {
        $installed = Get-CoherentInstalledRunnerBundle
        $oldVersion = Get-RunnerBundleVersion $installed.manifest.version
        $newVersion = Get-RunnerBundleVersion $SourceBundle.manifest.version
        if ($newVersion.date -lt $oldVersion.date -or ($newVersion.date -eq $oldVersion.date -and $newVersion.revision -le $oldVersion.revision)) {
            throw 'Changed runner bundles require a strictly increasing date/numeric revision; downgrade or equal-version replacement refused.'
        }
    } # Only installations predating both manifest and receipt use the legacy upgrade window.
}

function Assert-RunnerBundleCurrent([string] $SourceRoot, [switch] $AllowPendingRetry) {
    Assert-SecureRoot
    if ($AllowPendingRetry) {
        foreach ($name in @('pilot-retry.json', 'update-journal.json', 'setup-publication.json')) {
            $journal = Read-RunnerJson (Join-Path $script:RunnerRoot $name)
            if ($null -ne $journal -and ($journal.tag -cne $script:RunnerTag -or
                $journal.phase -cnotin @('pending', 'complete') -or ($name -cne 'pilot-retry.json' -and $journal.phase -ceq 'pending'))) {
                throw 'Invalid retry journal or pending update blocks retry control.'
            }
        }
        $retry = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json')
        if ($null -ne $retry -and $retry.phase -ceq 'pending') {
            if ($retry.retryId -cnotmatch '^[0-9a-f]{32}$' -or $retry.nextSha -cnotmatch '^[0-9a-f]{40}$' -or
                [string]::IsNullOrWhiteSpace($retry.reason) -or $retry.reason.Length -gt 256 -or $retry.reason -match '[\x00-\x1f\x7f]') {
                throw 'Pending retry identity/SHA/reason is invalid.'
            }
            [void](Get-CoherentInstalledRunnerBundle)
            return # Recovery belongs to the recorded installed bundle, not a later checkout.
        }
    } else { Assert-RunnerTransitionClear }
    if (-not (Test-InstalledRunnerBundle $SourceRoot)) { throw 'Installed runner bundle differs from this reviewed checkout. Choose option 2 to explicitly update while idle.' }
}

function Wait-RunnerUpdateIdle([int] $TimeoutSeconds = 35) {
    $marker = Assert-OwnedPath (Join-Path $script:RunnerRoot 'stop.requested')
    if (Test-Path -LiteralPath $marker) { Assert-RunnerProtectedPath $marker }
    $claimLock = Enter-RunnerLock
    try {
        Invoke-RunnerTransitionCheckpoint 'update-before-marker'
        if ((Get-RunnerState) -or @(Get-RunnerVmInventory | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -gt 0) {
            throw 'Update requires no session or owned-prefix VM; no job was stopped.'
        }
        Write-RunnerBytes $marker ([Text.Encoding]::UTF8.GetBytes('stop'))
        Assert-RunnerProtectedPath $marker
        Invoke-RunnerTransitionCheckpoint 'update-marker'
    } finally { Exit-RunnerLock $claimLock }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        Invoke-RunnerTransitionCheckpoint 'update-wait'
        if ((Get-RunnerState) -or @(Get-RunnerVmInventory | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -gt 0) {
            throw 'A session or VM appeared during graceful suspension; update refused without stopping it.'
        }
        if ((Get-ScheduledTask -TaskName $script:RunnerSupervisorTask -ErrorAction Stop).State -ne 'Running') {
            Invoke-RunnerTransitionCheckpoint 'update-acknowledged'
            return
        }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Supervisor did not exit gracefully before the update deadline; no job was stopped.' }
        Start-Sleep -Milliseconds 250
    } while ($true)
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

function Get-OwnedRunnerScheduledTasks {
    $installed = Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1'
    foreach ($role in @('Watchdog', 'Supervisor')) {
        $name = 'ITInventoryLocalRunner-' + $role
        $tasks = @(Get-ScheduledTask -TaskName $name -ErrorAction Stop)
        if ($tasks.Count -ne 1) { throw 'RUNNER_TASK_IDENTITY_AMBIGUOUS' }
        $task = $tasks[0]
        $action = if ($role -ceq 'Watchdog') { 'Watchdog' } else { 'Supervise' }
        $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installed`" -Action $action"
        $actions = @($task.Actions)
        if ($task.TaskName -cne $name -or $task.TaskPath -cne '\' -or
            $task.Principal.UserId -notin @('SYSTEM', 'S-1-5-18', 'NT AUTHORITY\SYSTEM') -or
            [string]$task.Principal.LogonType -cne 'ServiceAccount' -or [string]$task.Principal.RunLevel -cne 'Highest' -or
            $actions.Count -ne 1 -or $actions[0].Execute -ine 'powershell.exe' -or
            $actions[0].Arguments -cne $arguments -or -not [string]::IsNullOrEmpty($actions[0].WorkingDirectory)) {
            throw 'RUNNER_TASK_IDENTITY_UNEXPECTED'
        }
        $task
    }
}

function Set-RunnerBatteryTaskSettings {
    # Validate BOTH identities before the first write. Keep every other existing
    # setting, trigger and action: only these two task power conditions change.
    $tasks = @(Get-OwnedRunnerScheduledTasks)
    foreach ($task in $tasks) {
        $settings = $task.Settings
        $settings.DisallowStartIfOnBatteries = $false
        $settings.StopIfGoingOnBatteries = $false
        Set-ScheduledTask -TaskPath '\' -TaskName $task.TaskName -Settings $settings -ErrorAction Stop | Out-Null
    }
    foreach ($task in @(Get-OwnedRunnerScheduledTasks)) {
        if ($task.Settings.DisallowStartIfOnBatteries -or $task.Settings.StopIfGoingOnBatteries) {
            throw 'RUNNER_TASK_BATTERY_SETTINGS_READBACK_FAILED'
        }
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
    [void]@(Get-OwnedRunnerScheduledTasks) # Reject unexpected tasks before publication writes.
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
    Set-RunnerBatteryTaskSettings
    Invoke-RunnerTransitionCheckpoint 'update-task-power-settings'
    if (-not (Test-RunnerEvidence $script:RunnerConfigPath $Plan.disabledConfig)) { throw 'Disabled update config changed before restoration.' }
    Write-RunnerEvidence $script:RunnerConfigPath $Plan.oldConfig
    Invoke-RunnerTransitionCheckpoint 'update-restored-config'
    Invoke-RunnerTransitionCheckpoint 'update-before-complete'
    $Plan.phase = 'complete'
    Write-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json') $Plan
    Invoke-RunnerTransitionCheckpoint 'update-complete'
    Write-Host "Runner bundle $($Plan.version) installed and verified. Config/evidence preserved; pickup remains stopped."
}

function Install-RunnerBundleCore([string] $SourceRoot, [switch] $Resume) {
    Assert-Administrator
    Assert-SecureRoot
    [void]@(Get-OwnedRunnerScheduledTasks)
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
        Assert-RunnerBundleUpgrade $sourceBundle
    }
    if ($Resume) {
        if ($pending.schema -ne 1 -or $pending.updateId -cnotmatch '^[0-9a-f]{32}$') { throw 'Pending update identity is invalid.' }
        $stage = Assert-OwnedPath (Join-Path (Join-Path (Join-Path $script:RunnerRoot 'bin') 'updates') $pending.updateId)
        Assert-RunnerProtectedPath $stage
        $retained = Get-RunnerBundle $stage
        if ($retained.hash -cne $pending.manifestHash -or $retained.manifest.version -cne $pending.version) { throw 'Pending bundle differs from retained update intent.' }
        foreach ($name in @($retained.manifest.files.name) + @('Bundle.json')) { Assert-RunnerProtectedPath (Assert-OwnedPath (Join-Path $stage $name)) }
    }
    # Never invoke destructive Stop: an idle precheck can race a legacy job claim.
    Wait-RunnerUpdateIdle
    $supervisorLock = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1'
    try {
        $mutex = Enter-RunnerLock
        try {
            Assert-RunnerControlIdle
            if (-not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested') -PathType Leaf)) { throw 'Graceful suspension marker was removed; update refused.' }
            if ($Resume) { Complete-RunnerBundleUpdate $pending; return }
            # Another updater/retry may have completed while we waited for ownership.
            Assert-RunnerTransitionClear
            if (Test-InstalledRunnerBundle $SourceRoot) { Write-Host 'Installed runner bundle already matches this checkout.'; return }
            Assert-RunnerBundleUpgrade $sourceBundle
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

function Install-RunnerBundle([string] $SourceRoot, [switch] $Resume) {
    Invoke-RunnerControl { Install-RunnerBundleCore $SourceRoot -Resume:$Resume }
}

if ($MyInvocation.InvocationName -ne '.') { Install-RunnerBundle $PSScriptRoot -Resume:$Resume }
