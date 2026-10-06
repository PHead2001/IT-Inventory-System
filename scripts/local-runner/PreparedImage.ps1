# Trusted installed image lifecycle. Definitions only; no setup or publication on load.
function Get-RunnerImageInputNames {
    return @('Image.Prepare.sh', 'Image.Inputs.json', 'Image.Package.json', 'Image.PackageLock.json', 'Image.Supabase.toml')
}

function Get-RunnerJobCommand([bool] $Prepared) {
    $environment = if ($Prepared) { 'export RUNNER_TOOL_CACHE=/opt/hostedtoolcache AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache; ' } else { '' }
    # Cold generic guests retain the runner's own writable _work/_tool default.
    return 'read -r JIT; ' + $environment + 'cd ~/actions-runner; exec ./run.sh --jitconfig "$JIT" >/dev/null 2>&1'
}

function Get-RunnerImageBinding($Config) {
    $installed = Get-CoherentInstalledRunnerBundle
    $records = @("base|$($Config.baseSha256)", "bundle|$($installed.hash)")
    foreach ($name in Get-RunnerImageInputNames) {
        $path = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'bin') $name)
        Assert-RunnerProtectedPath $path
        $records += "$name|$((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)"
    }
    $recipe = (Get-FileHash -LiteralPath (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Image.Inputs.json') -Algorithm SHA256).Hash
    return [pscustomobject]@{ hash = Get-RunnerBytesHash ([Text.Encoding]::UTF8.GetBytes(($records -join "`n"))); recipeId = $recipe; bundleVersion = $installed.manifest.version; bundleHash = $installed.hash }
}

function Get-RunnerImageRecord {
    $selectorPath = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-image.json')
    if (-not (Test-Path -LiteralPath $selectorPath)) { return $null }
    Assert-RunnerProtectedPath $selectorPath
    $selector = Read-RunnerJson $selectorPath
    if ($selector.schema -ne 1 -or $selector.tag -cne $script:RunnerTag -or $selector.id -cnotmatch '^[0-9a-f]{32}$' -or
        $selector.receiptHash -cnotmatch '^[0-9A-F]{64}$' -or ($selector.previous -and $selector.previous -cnotmatch '^[0-9a-f]{32}$')) { throw 'Prepared image selector is invalid.' }
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    Assert-RunnerProtectedPath $directory
    $receiptPath = Assert-OwnedPath (Join-Path $directory ($selector.id + '.json'))
    $disk = Assert-OwnedPath (Join-Path $directory ($selector.id + '.vhdx'))
    Assert-RunnerProtectedPath $receiptPath
    Assert-RunnerProtectedPath $disk
    if ((Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash -cne $selector.receiptHash) { throw 'Prepared image receipt hash differs from selector.' }
    $receipt = Read-RunnerJson $receiptPath
    if ($receipt.schema -ne 1 -or $receipt.tag -cne $script:RunnerTag -or $receipt.id -cne $selector.id -or
        $receipt.diskHash -cnotmatch '^[0-9A-F]{64}$' -or $receipt.bindingHash -cnotmatch '^[0-9A-F]{64}$' -or
        $receipt.recipeId -cnotmatch '^[0-9A-F]{64}$' -or $receipt.scrubbed -ne $true -or
        @($receipt.capabilities) -cnotcontains 'os-prerequisites') { throw 'Prepared image receipt is invalid.' }
    return [pscustomobject]@{ selector = $selector; receipt = $receipt; path = $disk }
}

function Get-RunnerImageSelection($Config) {
    Assert-SecureRoot
    $record = Get-RunnerImageRecord
    if ($null -eq $record) {
        Write-Host 'Prepared image absent; using the generic base with guest dependency installation.'
        return [pscustomobject]@{ path = $Config.baseVhdx; prepared = $false; reason = 'absent' }
    }
    # Corruption never becomes a cache miss, including when installed pins changed.
    if ((Get-FileHash -LiteralPath $record.path -Algorithm SHA256).Hash -cne $record.receipt.diskHash) { throw 'Prepared image disk hash mismatch; pickup refused.' }
    $binding = Get-RunnerImageBinding $Config
    if ($record.receipt.bindingHash -cne $binding.hash -or $record.receipt.recipeId -cne $binding.recipeId) {
        Write-Host 'Prepared image inputs differ from the installed trusted bundle/base; using the generic base. Prepare image explicitly to refresh.'
        return [pscustomobject]@{ path = $Config.baseVhdx; prepared = $false; reason = 'stale-inputs' }
    }
    Assert-RunnerImageCloneProof $record.receipt $record.receipt.cloneVerification
    Assert-RunnerImageDiskUnreferenced $record.path
    return [pscustomobject]@{ path = $record.path; prepared = $true; reason = 'matching-sealed-image' }
}

function Show-RunnerImageStatus($Config) {
    try {
        $record = Get-RunnerImageRecord
        if ($null -eq $record) { Write-Host 'Prepared image: absent; generic base fallback.'; return }
        $binding = Get-RunnerImageBinding $Config
        $match = $record.receipt.bindingHash -ceq $binding.hash -and $record.receipt.recipeId -ceq $binding.recipeId
        Write-Host "Prepared image: $($record.selector.id); built $($record.receipt.createdUtc); inputs match installed bundle/base: $match."
        Write-Host "Built recipe: $($record.receipt.recipeId); installed recipe: $($binding.recipeId)."
        if ($record.receipt.PSObject.Properties.Name -contains 'cloneVerification') {
            Assert-RunnerImageCloneProof $record.receipt $record.receipt.cloneVerification
            Write-Host "Fresh clone readiness and cleanup verified: $($record.receipt.cloneVerification.readyUtc)."
        } else { Write-Host 'Fresh clone verification: not recorded by this older image.' }
        Write-Host 'Status verifies metadata/ACL only; full disk hash and offline/reference checks run before pickup.'
        if (-not $match) { Write-Host 'Generic base fallback until explicit image preparation.' }
    } catch { Write-Host 'Prepared image metadata/protection invalid; pickup fails closed. Investigate the protected image before starting.' }
}

function Assert-RunnerPreparationAuthorized {
    Assert-Administrator
    Assert-SecureRoot
    if ($script:RunnerPreparationAuthorized -ne $true -or
        -not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))) { throw 'Preparation requires the explicit idle owner control with suspended pickup.' }
}

function Invoke-RunnerPrepareImageCore {
    Assert-Administrator
    Assert-SecureRoot
    Assert-RunnerTransitionClear
    [void](Get-CoherentInstalledRunnerBundle)
    $config = Get-RunnerConfig
    $resumeActive = $config.activation -ceq 'active' -and -not (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'stop.requested'))
    $admission = Get-RunnerMemoryAdmission 'it-inventory-heavy'
    if (-not $admission.ready) { throw 'Insufficient free memory for the fixed heavy preparation profile.' }
    # Existing suspension protocol checks state under the claim lock before
    # setting Stop and waits for an idle supervisor to exit, never terminating it.
    Wait-RunnerUpdateIdle
    $lifetime = Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1' -FailFast
    try {
        Assert-RunnerControlIdle
        $record = Get-RunnerImageRecord
        if (Test-Path -LiteralPath (Join-Path $script:RunnerRoot 'prepared-images')) {
            $retained = if ($null -ne $record) { $record.selector } else { [pscustomobject]@{ id = ''; previous = '' } }
            Remove-RunnerOldImages $retained
        }
        $script:RunnerPreparationAuthorized = $true
        $candidate = $null
        try {
            $candidate = Invoke-RunnerSession $config $null 'it-inventory-heavy' 'prepare'
            Assert-RunnerControlIdle
            Invoke-RunnerTransitionCheckpoint 'image-builder-cleaned'
            [void](Assert-RunnerImageCandidate $candidate $config)
            $verification = Invoke-RunnerSession $config $null 'it-inventory-heavy' 'verify-image' $candidate
            # Invoke-RunnerSession returns only after its finally has proven VM
            # removal and unreferenced instance deletion. Uncertainty throws.
            Assert-RunnerControlIdle
            $verification | Add-Member -NotePropertyName cleanupVerified -NotePropertyValue $true -Force
            Invoke-RunnerTransitionCheckpoint 'image-clone-cleaned'
            Publish-RunnerPreparedImage $candidate $config $verification
        } finally {
            try { if ($null -ne $candidate) { Remove-RunnerImageCandidate $candidate } }
            finally { $script:RunnerPreparationAuthorized = $false }
        }
    } finally { Exit-RunnerLock $lifetime }
    if ($resumeActive) {
        Start-RunnerSupervisorCore
        Write-Host 'Prepared image published; active pickup resumed.'
    } else { Write-Host 'Prepared image published. Previous suspended/inactive pickup remains suspended.' }
}

function Assert-RunnerImageDiskUnreferenced([string] $Path) {
    $Path = Assert-OwnedPath $Path
    if ((Get-VHD -Path $Path -ErrorAction Stop).Attached) { throw 'Prepared image disk is mounted; refusing use/publication/deletion.' }
    foreach ($vm in @(Get-RunnerVmInventory)) {
        foreach ($disk in @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)) {
            if ([string]::IsNullOrEmpty($disk.Path)) { throw 'Cannot verify image disk references.' }
            if ([string]::Equals([IO.Path]::GetFullPath($disk.Path), $Path, [StringComparison]::OrdinalIgnoreCase)) { throw 'A registered VM references the image disk.' }
        }
    }
}

function Assert-RunnerPrepareState($State) {
    Assert-StateIdentity $State
    if ($State.PSObject.Properties.Name -notcontains 'purpose' -or $State.purpose -cne 'prepare' -or
        $State.PSObject.Properties.Name -notcontains 'vmId') { throw 'Only the credential-free preparation session can publish an image.' }
}

function Assert-RunnerImageStorageReceipt($Guest) {
    $path = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Image.Inputs.json')
    Assert-RunnerProtectedPath $path
    $inputs = Read-RunnerJson $path
    $source = 'supabase/storage-api:' + $inputs.storageVersion
    $expected = @($inputs.images | Where-Object source -CEQ $source)
    $observed = @($Guest.images | Where-Object source -CEQ $source)
    if ($expected.Count -ne 1 -or $observed.Count -ne 1 -or @($Guest.images).Count -ne @($inputs.images).Count) { throw 'Prepared Storage image receipt inventory is invalid.' }
    $image = $observed[0]; $aliases = @($image.aliases)
    if ($image.id -cnotmatch '^sha256:[a-f0-9]{64}$' -or @($image.digests).Count -eq 0 -or
        @($expected[0].candidates) -cnotcontains $image.reference -or
        $aliases.Count -ne @($expected[0].aliases).Count -or $aliases.Count -ne 4 -or
        (Compare-Object @($aliases.reference | Sort-Object) @($expected[0].aliases | Sort-Object))) { throw 'Prepared Storage image mirror aliases are invalid.' }
    foreach ($alias in $aliases) {
        if ($alias.id -cne $image.id) { throw 'Prepared Storage image aliases do not identify the verified pulled image.' }
    }
}

function Invoke-RunnerImageBuild($State, $Config) {
    Assert-RunnerPreparationAuthorized
    $binding = Get-RunnerImageBinding $Config
    $args = Get-SshArgs $State
    $target = "runner@$($Config.guestIp)"
    if ((Invoke-RunnerNative 'ssh.exe' ($args + @($target, 'mkdir -p /home/runner/image-inputs'))) -ne 0) { throw 'Image input directory creation failed.' }
    $inputs = @(Get-RunnerImageInputNames | ForEach-Object { Join-Path (Join-Path $script:RunnerRoot 'bin') $_ })
    if ((Invoke-RunnerNative 'scp.exe' ($args + $inputs + @($target + ':/home/runner/image-inputs/'))) -ne 0) { throw 'Trusted image input transfer failed.' }
    Assert-SessionAlive $State
    # Only a fixed trusted builder can return host-readable data. Job execution
    # retains discarded output and never calls the publication path.
    $result = Invoke-RunnerNative 'ssh.exe' ($args + @($target, 'bash -o pipefail -c ''sudo bash /home/runner/image-inputs/Image.Prepare.sh 2> >(tail -c 4096 >&2) | head -c 16385''')) -CaptureOutput -CaptureError -TimeoutSeconds 3600
    if ($result.ExitCode -ne 0 -or $result.Output.Length -gt 16384) {
        $diagnostics = ConvertTo-RunnerDiagnosticText $result.ErrorOutput
        $diagnostics = $diagnostics.Substring(0, [Math]::Min(4096, $diagnostics.Length))
        $failure = [InvalidOperationException]::new('IMAGE_PREPARATION_COMMAND_FAILED')
        $failure.Data['runnerImagePreparation'] = [ordered]@{ exitCode = $result.ExitCode; stderr = $diagnostics; receiptBytes = $result.Output.Length }
        throw $failure
    }
    $guest = $result.Output | ConvertFrom-Json
    if ($guest.schema -ne 1 -or $guest.recipeId -cne $binding.recipeId -or $guest.scrubbed -ne $true -or
        (Compare-Object @($guest.capabilities | Sort-Object) @('os-prerequisites', 'node-toolcache', 'npm-cache', 'playwright', 'supabase-images' | Sort-Object))) { throw 'Image scrub/capability receipt is invalid.' }
    Assert-RunnerImageStorageReceipt $guest
    $limit = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Assert-SessionAlive $State
        $vm = Get-VM -Name $State.vmName -ErrorAction Stop
        if ($vm.State -ceq 'Off') { break }
        if ([DateTime]::UtcNow -ge $limit) { throw 'Prepared guest did not shut down gracefully; publication refused.' }
        Start-Sleep -Milliseconds 500
    } while ($true)
    $mutex = Enter-RunnerLock
    try {
        $current = Get-RunnerState
        Assert-RunnerPrepareState $current
        if ($current.vmName -cne $State.vmName -or [guid]$current.vmId -ne [guid]$vm.Id -or
            $vm.Notes -cne $script:RunnerTag -or $vm.State -cne 'Off' -or
            [IO.Path]::GetFullPath($vm.Path) -ine (Join-Path $current.instancePath $current.vmName)) { throw 'Prepared VM identity/off state changed.' }
        Assert-RunnerVmLifecycle $current.vmName
        $disks = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
        $expected = @((Join-Path $current.instancePath 'guest.vhdx'), (Join-Path $current.instancePath 'cidata.vhdx'))
        if ($disks.Count -ne 2 -or (Compare-Object @($disks.Path | Sort-Object) @($expected | Sort-Object))) { throw 'Prepared VM disks differ from the owned fresh copy/seed.' }
        Remove-VM -VM $vm -Force -ErrorAction Stop
        Assert-RunnerInstanceUnreferenced $current
        $current.phase = 'sealed-off'
        $current | Add-Member -NotePropertyName imageScrubProof -NotePropertyValue (Get-RunnerJsonEvidence $guest) -Force
        Write-RunnerJson $script:RunnerStatePath $current
    } finally { Exit-RunnerLock $mutex }
    return New-RunnerPreparedImageCandidate $current $Config $binding $guest
}

function New-RunnerPreparedImageCandidate($State, $Config, $Binding, $Guest) {
    Assert-RunnerPreparationAuthorized
    Assert-RunnerPrepareState $State
    Assert-SessionAlive $State
    $current = Get-RunnerState
    Assert-RunnerPrepareState $current
    if ($current.vmName -cne $State.vmName -or [guid]$current.vmId -ne [guid]$State.vmId -or $current.instancePath -cne $State.instancePath -or $current.phase -cne 'sealed-off' -or
        $current.PSObject.Properties.Name -notcontains 'imageScrubProof') { throw 'Preparation has no committed graceful shutdown/scrub proof.' }
    $proof = Get-RunnerEvidenceValue $current.imageScrubProof
    if ($proof.schema -ne 1 -or $proof.recipeId -cne $Binding.recipeId -or $proof.scrubbed -ne $true -or
        (Compare-Object @($proof.capabilities | Sort-Object) @('os-prerequisites', 'node-toolcache', 'npm-cache', 'playwright', 'supabase-images' | Sort-Object))) { throw 'Committed preparation scrub proof is invalid.' }
    Assert-RunnerImageStorageReceipt $proof
    if (@(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $State.vmName -or [guid]$_.Id -eq [guid]$State.vmId }).Count -gt 0) { throw 'Preparation VM is still registered; publication refused.' }
    Assert-RunnerInstanceUnreferenced $State
    $source = Assert-OwnedPath (Join-Path $State.instancePath 'guest.vhdx')
    Assert-RunnerImageDiskUnreferenced $source
    if ((Get-RunnerImageBinding $Config).hash -cne $Binding.hash -or $Guest.recipeId -cne $Binding.recipeId -or $Guest.scrubbed -ne $true) { throw 'Trusted inputs or scrub proof changed before publication.' }
    $old = Get-RunnerImageRecord
    $selectorBefore = Get-RunnerFileEvidence (Join-Path $script:RunnerRoot 'prepared-image.json')
    if ($null -ne $old) {
        Assert-RunnerImageDiskUnreferenced $old.path
        if ((Get-FileHash -LiteralPath $old.path -Algorithm SHA256).Hash -cne $old.receipt.diskHash) { throw 'Previous prepared image is corrupt; publication refused.' }
        Remove-RunnerOldImages $old.selector
    }
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    [void](New-Item -ItemType Directory -Path $directory -Force)
    Assert-RunnerProtectedPath $directory
    $id = [guid]::NewGuid().ToString('N')
    $candidate = Assert-OwnedPath (Join-Path $directory ($id + '.vhdx'))
    $receiptPath = Assert-OwnedPath (Join-Path $directory ($id + '.json'))
    $retained = $false
    try {
        Copy-Item -LiteralPath $source -Destination $candidate -ErrorAction Stop
        Assert-RunnerProtectedPath $candidate
        Assert-RunnerImageDiskUnreferenced $candidate
        Invoke-RunnerTransitionCheckpoint 'image-copy'
        $receipt = [ordered]@{ schema = 1; tag = $script:RunnerTag; id = $id; createdUtc = [DateTime]::UtcNow.ToString('o')
            diskHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash; baseHash = $Config.baseSha256
            bindingHash = $Binding.hash; recipeId = $Binding.recipeId; bundleHash = $Binding.bundleHash; scrubbed = $true; capabilities = @($Guest.capabilities); guest = $proof
            builder = [ordered]@{ vmName = $State.vmName; vmId = $State.vmId; guestMac = $current.guestMac
                sshPublicKeyHash = (Get-FileHash -LiteralPath (Join-Path $State.instancePath 'id_ed25519.pub') -Algorithm SHA256).Hash }; selectorBefore = $selectorBefore }
        Write-RunnerJson $receiptPath $receipt
        Assert-RunnerProtectedPath $receiptPath
        Invoke-RunnerTransitionCheckpoint 'image-receipt'
        Assert-SessionAlive $State
        # Bulk copy and all full-disk hashes run outside the guardian's mutex.
        # Cleanup may win while copying; only a fresh proof can retain a candidate.
        $mutex = Enter-RunnerLock
        try {
            Assert-SessionAlive $State
            $current = Get-RunnerState
            Assert-RunnerPrepareState $current
            if ($current.vmName -cne $State.vmName -or [guid]$current.vmId -ne [guid]$State.vmId -or $current.instancePath -cne $State.instancePath -or $current.phase -cne 'sealed-off' -or
                (Get-RunnerJsonEvidence (Get-RunnerEvidenceValue $current.imageScrubProof)).hash -cne (Get-RunnerJsonEvidence $proof).hash) { throw 'Preparation proof changed during image copy; selection refused.' }
            if ((Get-RunnerImageBinding $Config).hash -cne $Binding.hash) { throw 'Trusted image binding changed during image copy.' }
            $latest = Get-RunnerImageRecord
            if (($null -eq $old) -ne ($null -eq $latest) -or ($null -ne $old -and (Get-RunnerJsonEvidence $latest.selector).hash -cne (Get-RunnerJsonEvidence $old.selector).hash)) { throw 'Prepared image selection changed during publication.' }
            if (@(Get-RunnerVmInventory | Where-Object { $_.Name -ceq $State.vmName -or [guid]$_.Id -eq [guid]$State.vmId }).Count -gt 0) { throw 'Preparation VM was registered during publication.' }
            Assert-RunnerInstanceUnreferenced $current
            Assert-RunnerImageDiskUnreferenced $source
            Assert-RunnerImageDiskUnreferenced $candidate
            if (-not (Test-RunnerEvidence (Join-Path $script:RunnerRoot 'prepared-image.json') $selectorBefore)) { throw 'Selection changed during candidate creation.' }
            $retained = $true
        } finally { Exit-RunnerLock $mutex }
        return [pscustomobject]@{ id = $id; path = $candidate; receiptPath = $receiptPath; receiptHash = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash }
    } finally {
        if (-not $retained) {
            Remove-RunnerImageCandidate ([pscustomobject]@{ id = $id })
        }
    }
}

function Assert-RunnerImageCandidate($Candidate, $Config) {
    Assert-RunnerPreparationAuthorized
    if ($null -eq $Candidate -or $Candidate.id -cnotmatch '^[0-9a-f]{32}$' -or $Candidate.receiptHash -cnotmatch '^[0-9A-F]{64}$') { throw 'Image candidate identity is invalid.' }
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    $disk = Join-Path $directory ($Candidate.id + '.vhdx'); $receiptPath = Join-Path $directory ($Candidate.id + '.json')
    if ($Candidate.path -cne $disk -or $Candidate.receiptPath -cne $receiptPath) { throw 'Image candidate paths differ from its protected identity.' }
    foreach ($path in @($directory, $disk, $receiptPath)) { Assert-RunnerProtectedPath $path }
    if ((Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash -cne $Candidate.receiptHash) { throw 'Image candidate receipt changed.' }
    $receipt = Read-RunnerJson $receiptPath
    $binding = Get-RunnerImageBinding $Config
    if ($receipt.schema -ne 1 -or $receipt.tag -cne $script:RunnerTag -or $receipt.id -cne $Candidate.id -or
        $receipt.scrubbed -ne $true -or $receipt.baseHash -cne $Config.baseSha256 -or $receipt.bindingHash -cne $binding.hash -or $receipt.recipeId -cne $binding.recipeId -or
        $receipt.bundleHash -cne $binding.bundleHash -or $receipt.bundleHash -cnotmatch '^[0-9A-F]{64}$' -or $receipt.diskHash -cnotmatch '^[0-9A-F]{64}$' -or
        $receipt.builder.vmName -cnotmatch '^ITIR-[0-9a-f]{32}$' -or [guid]$receipt.builder.vmId -eq [guid]::Empty -or
        $receipt.builder.sshPublicKeyHash -cnotmatch '^[0-9A-F]{64}$' -or $receipt.builder.guestMac -cnotmatch '^02[0-9A-F]{10}$') { throw 'Image candidate proof/binding is invalid.' }
    [void](Get-RunnerEvidenceValue $receipt.selectorBefore)
    if (-not (Test-RunnerEvidence (Join-Path $script:RunnerRoot 'prepared-image.json') $receipt.selectorBefore)) { throw 'Selected image changed while preparing a candidate.' }
    Assert-RunnerImageStorageReceipt $receipt.guest
    Assert-RunnerImageDiskUnreferenced $disk
    # The candidate itself is never booted. Both verifier admission and final
    # publication hash this original, outside the guardian's state lock.
    if ((Get-FileHash -LiteralPath $disk -Algorithm SHA256).Hash -cne $receipt.diskHash) { throw 'Unbooted candidate disk changed.' }
    return $receipt
}

function Assert-RunnerImageCloneProof($Receipt, $Verification) {
    if ($null -eq $Verification -or $Verification.schema -ne 1 -or $Verification.purpose -cne 'verify-image' -or
        $Verification.candidateId -cne $Receipt.id -or $Verification.diskHash -cne $Receipt.diskHash -or
        $Verification.bindingHash -cne $Receipt.bindingHash -or $Verification.recipeId -cne $Receipt.recipeId -or
        $Verification.bundleHash -cne $Receipt.bundleHash -or $Verification.cleanupVerified -ne $true -or
        $Verification.readiness -cne 'cloud-init-and-runner-prerequisites' -or
        $Verification.vmName -cnotmatch '^ITIR-[0-9a-f]{32}$' -or $Verification.vmName -ceq $Receipt.builder.vmName -or
        [guid]$Verification.vmId -eq [guid]::Empty -or [guid]$Verification.vmId -eq [guid]$Receipt.builder.vmId -or
        $Verification.guestMac -cnotmatch '^02[0-9A-F]{10}$' -or $Verification.guestMac -ceq $Receipt.builder.guestMac -or
        $Verification.sshPublicKeyHash -cnotmatch '^[0-9A-F]{64}$' -or $Verification.sshPublicKeyHash -ceq $Receipt.builder.sshPublicKeyHash -or
        $Verification.readinessSeconds -lt 0 -or [double]::IsNaN($Verification.readinessSeconds) -or [double]::IsInfinity($Verification.readinessSeconds) -or
        [DateTime]::Parse($Verification.readyUtc).ToUniversalTime() -gt [DateTime]::UtcNow.AddMinutes(1)) { throw 'Fresh clone readiness/cleanup proof is invalid.' }
}

function Publish-RunnerPreparedImage($Candidate, $Config, $Verification) {
    Assert-RunnerPreparationAuthorized
    Assert-RunnerControlIdle
    $receipt = Assert-RunnerImageCandidate $Candidate $Config
    Assert-RunnerImageCloneProof $receipt $Verification
    if ((Get-HostNetworkFingerprint) -cne $Verification.networkFingerprint) { throw 'Host network changed after clone verification; publication refused.' }
    $receipt | Add-Member -NotePropertyName cloneVerification -NotePropertyValue $Verification -Force
    Write-RunnerJson $Candidate.receiptPath $receipt
    Invoke-RunnerTransitionCheckpoint 'image-verified-receipt'
    $old = Get-RunnerEvidenceValue $receipt.selectorBefore
    $selector = [ordered]@{ schema = 1; tag = $script:RunnerTag; id = $Candidate.id
        previous = $(if ($null -ne $old) { $old.id } else { '' }); receiptHash = (Get-FileHash -LiteralPath $Candidate.receiptPath -Algorithm SHA256).Hash }
    $mutex = Enter-RunnerLock
    try {
        Assert-RunnerPreparationAuthorized
        Assert-RunnerControlIdle
        if ((Get-RunnerImageBinding $Config).hash -cne $receipt.bindingHash -or
            -not (Test-RunnerEvidence (Join-Path $script:RunnerRoot 'prepared-image.json') $receipt.selectorBefore)) { throw 'Trusted inputs/selection changed before verified image publication.' }
        Assert-RunnerImageDiskUnreferenced $Candidate.path
        Assert-RunnerProtectedPath $Candidate.receiptPath
        if ((Get-FileHash -LiteralPath $Candidate.receiptPath -Algorithm SHA256).Hash -cne $selector.receiptHash) { throw 'Verified receipt changed before selector commit.' }
        Write-RunnerJson (Join-Path $script:RunnerRoot 'prepared-image.json') $selector
        Invoke-RunnerTransitionCheckpoint 'image-selector'
    } finally { Exit-RunnerLock $mutex }
    Remove-RunnerOldImages ([pscustomobject]$selector)
}

function Remove-RunnerImageCandidate($Candidate) {
    if ($Candidate.id -cnotmatch '^[0-9a-f]{32}$') { throw 'Candidate cleanup identity is invalid.' }
    $selected = Get-RunnerImageRecord
    if ($null -ne $selected -and ($selected.selector.id -ceq $Candidate.id -or $selected.selector.previous -ceq $Candidate.id)) { return }
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    foreach ($extension in @('vhdx', 'json')) {
        $path = Join-Path $directory ($Candidate.id + '.' + $extension)
        if (Test-Path -LiteralPath $path) {
            Assert-RunnerProtectedPath $path
            if ($extension -ceq 'vhdx') { Assert-RunnerImageDiskUnreferenced $path }
            Remove-Item -LiteralPath $path -Force -ErrorAction Stop
        }
    }
}

function Remove-RunnerOldImages($Selector) {
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
        if ($entry.Name -cnotmatch '^([0-9a-f]{32})\.(vhdx|json)$' -or $entry.PSIsContainer) { throw 'Unrecognized prepared-image retention entry; investigate without deleting it.' }
        $id = $Matches[1]
        if ($id -ceq $Selector.id -or $id -ceq $Selector.previous) { continue }
        [void](Assert-OwnedPath $entry.FullName); Assert-RunnerProtectedPath $entry.FullName
        $disk = Join-Path $directory ($id + '.vhdx')
        if (Test-Path -LiteralPath $disk) { Assert-RunnerImageDiskUnreferenced $disk }
        Remove-Item -LiteralPath $entry.FullName -Force -ErrorAction Stop
    }
}
