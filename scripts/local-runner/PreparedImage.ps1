# Trusted installed image lifecycle. Definitions only; no setup or publication on load.
function Initialize-RunnerImageIdentity {
    if ('ITInventory.RunnerImageIdentity' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace ITInventory {
    public static class RunnerImageIdentity {
        [StructLayout(LayoutKind.Sequential)] struct Information {
            public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle handle, out Information info);
        public static string Read(FileStream stream) {
            Information info;
            if (!GetFileInformationByHandle(stream.SafeFileHandle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return info.Volume.ToString("X8") + ":" + info.IndexHigh.ToString("X8") + info.IndexLow.ToString("X8");
        }
    }
}
'@
}

function Start-RunnerImagePreflight([string] $Purpose) {
    $script:RunnerImagePreflight = [pscustomobject]@{ purpose = $Purpose; startedUtc = [DateTime]::UtcNow; deadlineUtc = [DateTime]::UtcNow.AddMinutes(10); lastObservationUtc = [DateTime]::MinValue }
}

function Assert-RunnerImagePreflight {
    if (-not (Get-Variable RunnerImagePreflight -Scope Script -ErrorAction SilentlyContinue) -or $null -eq $script:RunnerImagePreflight) { return }
    if ([DateTime]::UtcNow -ge $script:RunnerImagePreflight.deadlineUtc) { throw 'Image preflight deadline reached.' }
    if ($script:RunnerImagePreflight.purpose -ceq 'job') { Assert-RunnerPickupInspectionActive }
    else { Assert-RunnerPreparationAuthorized }
}

function Write-RunnerImageProgress([ValidateSet('demand-inspection','host-inspection','base-verification','image-verification','clone-create','complete')][string] $Phase, [long] $ProcessedBytes = 0, [long] $TotalBytes = 0) {
    Assert-RunnerImagePreflight
    if (-not (Get-Variable RunnerImagePreflight -Scope Script -ErrorAction SilentlyContinue) -or $null -eq $script:RunnerImagePreflight) { return }
    $now = [DateTime]::UtcNow
    if (($now - $script:RunnerImagePreflight.lastObservationUtc).TotalSeconds -lt 1 -and $ProcessedBytes -ne $TotalBytes) { return }
    Write-RunnerJson (Join-Path $script:RunnerRoot 'preflight-observation.json') ([ordered]@{
        schema = 1; tag = $script:RunnerTag; supervisorPid = $PID; supervisorStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
        phase = $Phase; startedUtc = $script:RunnerImagePreflight.startedUtc.ToString('o'); deadlineUtc = $script:RunnerImagePreflight.deadlineUtc.ToString('o'); observedUtc = $now.ToString('o')
        processedBytes = $ProcessedBytes; totalBytes = $TotalBytes
    })
    $script:RunnerImagePreflight.lastObservationUtc = $now
}

function Get-RunnerImageStreamHash([IO.FileStream] $Stream, [string] $Phase = 'image-verification') {
    $Stream.Position = 0
    $sha = [Security.Cryptography.SHA256]::Create()
    $buffer = New-Object byte[] (4MB)
    try {
        Write-RunnerImageProgress $Phase 0 $Stream.Length
        while ($true) {
            Assert-RunnerImagePreflight
            $count = $Stream.Read($buffer, 0, $buffer.Length)
            Assert-RunnerImagePreflight
            if ($count -eq 0) { break }
            [void]$sha.TransformBlock($buffer, 0, $count, $null, 0)
            Write-RunnerImageProgress $Phase $Stream.Position $Stream.Length
        }
        [void]$sha.TransformFinalBlock($buffer, 0, 0)
        return ([BitConverter]::ToString($sha.Hash)).Replace('-', '')
    } finally { $sha.Dispose(); $Stream.Position = 0 }
}

function Close-RunnerImageLeases {
    if (-not (Get-Variable RunnerImageLeases -Scope Script -ErrorAction SilentlyContinue)) { return }
    # A live owner never deliberately releases a failed child's parent while
    # its state remains. Process death closes OS handles; restart must recover
    # that state and independently hash before another claim.
    try { if (Get-RunnerState) { return } } catch { return }
    foreach ($lease in @($script:RunnerImageLeases.Values)) { $lease.stream.Dispose() }
    $script:RunnerImageLeases = @{}
}

function Show-RunnerImageProgress {
    try {
        $path = Assert-OwnedPath (Join-Path $script:RunnerRoot 'preflight-observation.json')
        if (-not (Test-Path -LiteralPath $path)) { return }
        Assert-RunnerProtectedPath $path
        $r = Read-RunnerJson $path
        if ($r.schema -ne 1 -or $r.tag -cne $script:RunnerTag -or $r.phase -cnotin @('demand-inspection','host-inspection','base-verification','image-verification','clone-create','complete') -or
            [string]$r.supervisorPid -cnotmatch '^[1-9][0-9]*$' -or $r.processedBytes -lt 0 -or $r.totalBytes -lt $r.processedBytes) { throw 'Invalid preflight observation.' }
        $started = [DateTime]::Parse($r.startedUtc).ToUniversalTime()
        $deadline = [DateTime]::Parse($r.deadlineUtc).ToUniversalTime()
        $observed = [DateTime]::Parse($r.observedUtc).ToUniversalTime()
        if ($deadline -le $started -or $observed -lt $started -or $observed -gt [DateTime]::UtcNow.AddMinutes(1)) { throw 'Invalid preflight observation clock.' }
        Write-Host ("Last image preflight: {0}; {1}/{2} bytes; started {3:o}; deadline {4:o}; observed {5:o}. Historical progress is not proof of current process health." -f $r.phase, $r.processedBytes, $r.totalBytes, $started, $deadline, $observed)
    } catch { Write-Host 'Image preflight observation is unavailable or invalid.' }
}

function Assert-RunnerPreparedImagePath([string] $Path) {
    $Path = Assert-OwnedPath $Path
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    if ([IO.Path]::GetDirectoryName($Path) -ine $directory -or [IO.Path]::GetFileName($Path) -cnotmatch '^[0-9a-f]{32}\.vhdx$') { throw 'Prepared image path is outside its fixed identity namespace.' }
    Assert-RunnerProtectedPath $directory
    if (-not (Get-Item -LiteralPath $directory -Force).PSIsContainer -or (Get-Item -LiteralPath $Path -Force).PSIsContainer) { throw 'Prepared image must be a file under its protected directory.' }
    $acl = Get-Acl -LiteralPath $Path
    $owners = @('S-1-5-18', 'S-1-5-32-544')
    if ($owners -cnotcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Prepared image owner is unexpected.' }
    # Add-VMHardDiskDrive grants these two native principals read access to a
    # differencing parent. This exception applies only to sealed image files;
    # directories, receipts, credentials, tools and the generic base stay strict.
    $nativeReaders = @('S-1-5-83-0', 'S-1-15-3-1024-2268835264-3721307629-241982045-173645152-1490879176-104643441-2915960892-1612460704')
    $readMask = [long]([Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Synchronize)
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne 'Allow') { continue }
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($owners -ccontains $sid) { continue }
        $rights = [long]$rule.FileSystemRights
        if ($nativeReaders -cnotcontains $sid -or $rule.IsInherited -or
            $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::None -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
            $rights -le 0 -or $rights -gt $readMask -or ($rights -band (-bnot $readMask)) -ne 0) { throw 'Prepared image grants unexpected access.' }
    }
}

function Assert-RunnerImageLeasePath([string] $Path, [bool] $Prepared) {
    if ($Prepared) { Assert-RunnerPreparedImagePath $Path }
    else { Assert-RunnerProtectedPath $Path }
}

function Get-RunnerVerifiedImageLease([string] $Path, [string] $ExpectedHash, [string] $Binding, [string] $Phase = 'image-verification', [switch] $Prepared) {
    if ($ExpectedHash -cnotmatch '^[0-9A-Fa-f]{64}$' -or [string]::IsNullOrEmpty($Binding)) { throw 'Image lease binding is invalid.' }
    $Path = Assert-OwnedPath $Path
    Assert-RunnerImageLeasePath $Path $Prepared.IsPresent
    Initialize-RunnerImageIdentity
    if (-not (Get-Variable RunnerImageLeases -Scope Script -ErrorAction SilentlyContinue)) { $script:RunnerImageLeases = @{} }
    $owner = "$PID|$((Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'))"
    # No Inheritable sharing flag: guests/native children never inherit this handle.
    $stream = [IO.FileStream]::new($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $identity = [ITInventory.RunnerImageIdentity]::Read($stream)
        $key = $Path.ToUpperInvariant()
        if ($script:RunnerImageLeases.ContainsKey($key)) {
            $existing = $script:RunnerImageLeases[$key]
            if ($existing.owner -ceq $owner -and $existing.identity -ceq $identity -and $existing.expectedHash -ieq $ExpectedHash -and $existing.binding -ceq $Binding -and $existing.prepared -eq $Prepared.IsPresent -and $existing.stream.CanRead) {
                Assert-RunnerImagePreflight
                return $existing
            }
            if (Get-RunnerState) { throw 'Image lease changed during a recorded session; retain its parent.' }
            Close-RunnerImageLeases
        }
        if ((Get-RunnerImageStreamHash $stream $Phase) -ine $ExpectedHash) { throw 'Immutable image digest mismatch; pickup refused.' }
        Assert-RunnerImageLeasePath $Path $Prepared.IsPresent
        $lease = [pscustomobject]@{ path = $Path; stream = $stream; identity = $identity; owner = $owner; expectedHash = $ExpectedHash; binding = $Binding; prepared = $Prepared.IsPresent }
        $script:RunnerImageLeases[$key] = $lease
        $stream = $null
        return $lease
    } finally { if ($null -ne $stream) { $stream.Dispose() } }
}

function New-RunnerImageChild([string] $Path, $Lease) {
    Assert-RunnerImagePreflight
    if ($null -eq $Lease -or -not $Lease.stream.CanRead -or $Lease.owner -cne "$PID|$((Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'))") { throw 'A live process-owned image lease is required.' }
    Assert-RunnerImageLeasePath $Lease.path $Lease.prepared
    $probe = [IO.FileStream]::new($Lease.path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ([ITInventory.RunnerImageIdentity]::Read($probe) -cne $Lease.identity) { throw 'Parent path no longer identifies its verified lease.' }
    } finally { $probe.Dispose() }
    $Path = Assert-OwnedPath $Path
    if (Test-Path -LiteralPath $Path) { throw 'Fresh child disk already exists.' }
    Write-RunnerImageProgress 'clone-create'
    [void](New-VHD -Path $Path -ParentPath $Lease.path -Differencing -ErrorAction Stop)
    $disk = Get-VHD -Path $Path -ErrorAction Stop
    if ($disk.VhdType -cne 'Differencing' -or -not [string]::Equals([IO.Path]::GetFullPath($disk.ParentPath), $Lease.path, [StringComparison]::OrdinalIgnoreCase)) { throw 'Differencing disk parent/type readback differs.' }
    Assert-RunnerImagePreflight
    return $Path
}

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
    Assert-RunnerPreparedImagePath $disk
    if ((Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash -cne $selector.receiptHash) { throw 'Prepared image receipt hash differs from selector.' }
    $receipt = Read-RunnerJson $receiptPath
    if ($receipt.schema -ne 1 -or $receipt.tag -cne $script:RunnerTag -or $receipt.id -cne $selector.id -or
        $receipt.diskHash -cnotmatch '^[0-9A-F]{64}$' -or $receipt.bindingHash -cnotmatch '^[0-9A-F]{64}$' -or
        $receipt.recipeId -cnotmatch '^[0-9A-F]{64}$' -or $receipt.scrubbed -ne $true -or
        @($receipt.capabilities) -cnotcontains 'os-prerequisites') { throw 'Prepared image receipt is invalid.' }
    if ($receipt.PSObject.Properties.Name -contains 'cloneVerification') { Assert-RunnerImageCloneProof $receipt $receipt.cloneVerification }
    return [pscustomobject]@{ selector = $selector; receipt = $receipt; path = $disk }
}

function Get-RunnerImageSelection($Config) {
    Assert-SecureRoot
    $record = Get-RunnerImageRecord
    $selection = if ($null -eq $record) { 'absent' } else { (Get-RunnerJsonEvidence $record.selector).hash }
    if ((Get-Variable RunnerImageSelectionIdentity -Scope Script -ErrorAction SilentlyContinue) -and $script:RunnerImageSelectionIdentity -cne $selection) {
        if (Get-RunnerState) { throw 'Image selector changed during a recorded session.' }
        Close-RunnerImageLeases
    }
    $script:RunnerImageSelectionIdentity = $selection
    if ($null -eq $record) {
        Write-Host 'Prepared image absent; using the generic base with guest dependency installation.'
        return [pscustomobject]@{ path = $Config.baseVhdx; prepared = $false; reason = 'absent' }
    }
    # Corruption never becomes a cache miss, including when installed pins changed.
    $lease = Get-RunnerVerifiedImageLease $record.path $record.receipt.diskHash ((Get-RunnerJsonEvidence ([ordered]@{ selector = $record.selector; receipt = $record.receipt; binding = (Get-RunnerImageBinding $Config) })).hash) -Prepared
    $binding = Get-RunnerImageBinding $Config
    if ($record.receipt.bindingHash -cne $binding.hash -or $record.receipt.recipeId -cne $binding.recipeId) {
        Write-Host 'Prepared image inputs differ from the installed trusted bundle/base; using the generic base. Prepare image explicitly to refresh.'
        return [pscustomobject]@{ path = $Config.baseVhdx; prepared = $false; reason = 'stale-inputs' }
    }
    Assert-RunnerImageCloneProof $record.receipt $record.receipt.cloneVerification -RequireGuestMtu
    Assert-RunnerImageDiskUnreferenced $record.path
    $differencing = $record.receipt.cloneVerification.PSObject.Properties.Name -contains 'diskType' -and
        $record.receipt.cloneVerification.diskType -ceq 'Differencing' -and $record.receipt.cloneVerification.parentLease -ceq 'read-only-same-handle' -and
        $record.receipt.cloneVerification.PSObject.Properties.Name -contains 'successiveChild'
    return [pscustomobject]@{ path = $record.path; prepared = $true; reason = 'matching-sealed-image'; lease = $lease; differencing = $differencing }
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
        Close-RunnerImageLeases
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
            $nextVerification = Invoke-RunnerSession $config $null 'it-inventory-heavy' 'verify-image' $candidate
            Assert-RunnerControlIdle
            $nextVerification | Add-Member -NotePropertyName cleanupVerified -NotePropertyValue $true -Force
            $verification | Add-Member -NotePropertyName successiveChild -NotePropertyValue $nextVerification -Force
            Invoke-RunnerTransitionCheckpoint 'image-successive-clone-cleaned'
            # The verifier's parent lease survives its child cleanup. Drain it
            # while idle before publication/retention can replace image files.
            Close-RunnerImageLeases
            Publish-RunnerPreparedImage $candidate $config $verification
        } finally {
            try { if ($null -ne $candidate) { Remove-RunnerImageCandidate $candidate } }
            finally { Close-RunnerImageLeases; $script:RunnerPreparationAuthorized = $false }
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
    Assert-RunnerDiskReferencesAbsent $Path
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

function Write-RunnerImagePreparationFailure($State, [string] $BundleHash, $Detail) {
    # Private local evidence only. The sanitizer is not a general secret scrubber;
    # never copy stderr into generic journals, owner receipts or public output.
    try {
        Assert-RunnerCloudInitPreparationIdentity $State
        if ((Get-CoherentInstalledRunnerBundle).hash -cne $BundleHash) { throw 'Image failure bundle changed.' }
        if ($Detail.exitCode -isnot [int] -or $Detail.receiptBytes -isnot [int] -or $Detail.receiptBytes -lt 0 -or $Detail.receiptBytes -gt 65540 -or
            $Detail.stderr -isnot [string] -or $Detail.stderr.Length -gt 4096) { throw 'Image failure detail is invalid.' }
        $text=ConvertTo-RunnerDiagnosticText $Detail.stderr
        $stage='unknown'
        foreach($match in [regex]::Matches($text,'(?m)^ITIR_IMAGE_FAILURE_STAGE=([a-z-]+)\r?$')) {
            if ($match.Groups[1].Value -cin (Get-RunnerImageFailureStages)) { $stage=$match.Groups[1].Value }
        }
        $record=[pscustomobject][ordered]@{schema=1;sessionId=$State.vmName.Substring(5);vmId=$State.vmId;purpose='prepare';bundleHash=$BundleHash;atUtc=[DateTime]::UtcNow.ToString('o');stage=$stage;exitCode=$Detail.exitCode;receiptBytes=$Detail.receiptBytes;stderr=$text;truncated=([Text.Encoding]::UTF8.GetByteCount($text) -ge 4096)}
        # JSON escaping/UTF-8 can expand text. Preserve the decisive tail while
        # bounding the complete serialized artifact before any filesystem write.
        while ($record.stderr.Length -gt 4096 -or [Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $record -Depth 4 -Compress)) -gt 8192) {
            $record.stderr=$record.stderr.Substring([Math]::Min(128,$record.stderr.Length)).Trim();$record.truncated=$true
        }
        Assert-RunnerImageFailureArtifact $record
        $mutex=Enter-RunnerLock
        try {
            Assert-RunnerCloudInitPreparationIdentity $State
            if ((Get-CoherentInstalledRunnerBundle).hash -cne $BundleHash) { throw 'Image failure bundle changed.' }
            $path=Assert-OwnedPath (Join-Path $script:RunnerRoot 'preparation-image.json')
            if (Test-Path -LiteralPath $path) { Assert-RunnerProtectedPath $path }
            Write-RunnerJson $path $record
            Assert-RunnerProtectedPath $path
        } finally { Exit-RunnerLock $mutex }
    } catch { } # Evidence failure must not replace the builder failure/cleanup.
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
        $failure.Data['runnerImagePreparation'] = [ordered]@{ exitCode = $result.ExitCode; stderr = $diagnostics; receiptBytes = [Text.Encoding]::UTF8.GetByteCount($result.Output) }
        Write-RunnerImagePreparationFailure $State $binding.bundleHash $failure.Data['runnerImagePreparation']
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
        # The guardian remains alive throughout the copy. Invalidate every old
        # network/probe completion before committing absent-VM supervision.
        $r = $current.networkRecovery
        $r.generation++; $r.phase = 'sealed-preparation'; $r.operation = ''; $r.resumeRequired = $false
        $r.episodeDeadlineUtc = ''; $r.episodeStartedUtc = ''; $r.candidateRules = @(); $r.verifiedRules = @()
        $r.progressUtc = (Get-RunnerRecoveryNow).ToString('o')
        $current | Add-Member imageSealBinding (Get-RunnerJsonEvidence ([ordered]@{ schema = 1; generation = $r.generation
            bindingHash = $binding.hash; recipeId = $binding.recipeId; bundleHash = $binding.bundleHash; scrubProofHash = $current.imageScrubProof.hash })) -Force
        Assert-RunnerSealedPreparation $current (Get-RunnerRecoveryNow)
        Write-RunnerJson $script:RunnerStatePath $current
    } finally { Exit-RunnerLock $mutex }
    return New-RunnerPreparedImageCandidate $current $Config $binding $guest
}

function Copy-RunnerPreparedImageBytes([string] $Source, [string] $Destination, $State) {
    # Copy-Item can carry a detached Hyper-V disk's explicit access entries.
    # Create a fresh file under the checked protected directory instead; copy
    # only bytes, leaving the destination's inherited security descriptor intact.
    $Source = Assert-OwnedPath $Source
    $Destination = Assert-OwnedPath $Destination
    Assert-RunnerProtectedPath ([IO.Path]::GetDirectoryName($Destination))
    $inputStream = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $outputStream = $null
    try {
        $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        Assert-RunnerProtectedPath $Destination
        Invoke-RunnerTransitionCheckpoint 'image-copy-created'
        $buffer = [byte[]]::new(1048576)
        $checks = [Diagnostics.Stopwatch]::StartNew()
        Assert-SessionAlive $State
        do {
            if ([DateTime]::UtcNow -ge [DateTime]::Parse($State.deadlineUtc).ToUniversalTime()) { throw 'Prepared image copy reached its session deadline.' }
            if ($checks.Elapsed.TotalSeconds -ge 1) {
                Assert-SessionAlive $State
                $current = Get-RunnerState
                Assert-RunnerSealedPreparation $current (Get-RunnerRecoveryNow)
                $checks.Restart()
            }
            $count = $inputStream.Read($buffer, 0, $buffer.Length)
            if ($count -gt 0) { $outputStream.Write($buffer, 0, $count) }
        } while ($count -gt 0)
        $outputStream.Flush($true)
        Assert-SessionAlive $State
        Assert-RunnerSealedPreparation (Get-RunnerState) (Get-RunnerRecoveryNow)
        Assert-RunnerProtectedPath $Destination
    } finally {
        try { if ($null -ne $outputStream) { $outputStream.Dispose() } }
        finally { $inputStream.Dispose() }
    }
}

function New-RunnerPreparedImageCandidate($State, $Config, $Binding, $Guest) {
    Assert-RunnerPreparationAuthorized
    Assert-RunnerPrepareState $State
    Assert-SessionAlive $State
    $current = Get-RunnerState
    Assert-RunnerPrepareState $current
    Assert-RunnerSealedPreparation $current (Get-RunnerRecoveryNow)
    $sealBinding = Get-RunnerEvidenceValue $current.imageSealBinding
    if ($sealBinding.bindingHash -cne $Binding.hash -or $sealBinding.bundleHash -cne $Binding.bundleHash -or $sealBinding.recipeId -cne $Binding.recipeId) { throw 'Sealed preparation image binding differs from the candidate.' }
    $sealEvidenceHash = $current.imageSealBinding.hash
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
        # The owner already pruned while idle before launching this builder.
        # Defer subsequent retention until idle publication; never drain a
        # live preparation session's parent leases to make room here.
    }
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    [void](New-Item -ItemType Directory -Path $directory -Force)
    Assert-RunnerProtectedPath $directory
    $id = [guid]::NewGuid().ToString('N')
    $candidate = Assert-OwnedPath (Join-Path $directory ($id + '.vhdx'))
    $receiptPath = Assert-OwnedPath (Join-Path $directory ($id + '.json'))
    $retained = $false
    try {
        Copy-RunnerPreparedImageBytes $source $candidate $State
        Assert-RunnerPreparedImagePath $candidate
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
            Assert-RunnerSealedPreparation $current (Get-RunnerRecoveryNow)
            if ($current.imageSealBinding.hash -cne $sealEvidenceHash) { throw 'Sealed preparation binding changed during image copy.' }
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

function Assert-RunnerImageCandidate($Candidate, $Config, [switch] $Rehash) {
    Assert-RunnerPreparationAuthorized
    if ($null -eq $Candidate -or $Candidate.id -cnotmatch '^[0-9a-f]{32}$' -or $Candidate.receiptHash -cnotmatch '^[0-9A-F]{64}$') { throw 'Image candidate identity is invalid.' }
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    $disk = Join-Path $directory ($Candidate.id + '.vhdx'); $receiptPath = Join-Path $directory ($Candidate.id + '.json')
    if ($Candidate.path -cne $disk -or $Candidate.receiptPath -cne $receiptPath) { throw 'Image candidate paths differ from its protected identity.' }
    foreach ($path in @($directory, $receiptPath)) { Assert-RunnerProtectedPath $path }
    Assert-RunnerPreparedImagePath $disk
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
    $lease = Get-RunnerVerifiedImageLease $disk $receipt.diskHash ((Get-RunnerJsonEvidence $receipt).hash) -Prepared
    # Publication obtains independent content proof after verifier cleanup,
    # rather than promoting a cached verification flag.
    if ($Rehash -and (Get-RunnerImageStreamHash $lease.stream) -cne $receipt.diskHash) { throw 'Unbooted candidate disk changed.' }
    return $receipt
}

function Assert-RunnerImageCloneProof($Receipt, $Verification, [switch] $RequireGuestMtu) {
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
    if ($Verification.PSObject.Properties.Name -contains 'guestMtu') {
        if ($Verification.guestMtu -isnot [int] -or $Verification.guestMtu -ne (Get-RunnerGuestMtu)) { throw 'Fresh clone guest MTU proof is invalid.' }
    } elseif ($RequireGuestMtu) { throw 'Fresh clone guest MTU proof is missing.' }
    if ($Verification.PSObject.Properties.Name -contains 'diskType' -or $Verification.PSObject.Properties.Name -contains 'parentLease') {
        if ($Verification.diskType -cne 'Differencing' -or $Verification.parentLease -cne 'read-only-same-handle') { throw 'Clone disk/parent lease proof is invalid.' }
    }
    if ($Verification.PSObject.Properties.Name -contains 'successiveChild') {
        $next = $Verification.successiveChild
        if ($null -eq $next -or $next.PSObject.Properties.Name -contains 'successiveChild') { throw 'Successive clone proof must contain exactly one next child.' }
        Assert-RunnerImageCloneProof $Receipt $next -RequireGuestMtu:$RequireGuestMtu
        if ($Verification.diskType -cne 'Differencing' -or $next.diskType -cne 'Differencing' -or
            $Verification.parentLease -cne 'read-only-same-handle' -or $next.parentLease -cne 'read-only-same-handle' -or
            $Verification.parentIdentity -cnotmatch '^[0-9A-F]{8}:[0-9A-F]{16}$' -or $next.parentIdentity -cne $Verification.parentIdentity -or
            $Verification.markerProof -cne 'absent-then-written' -or $next.markerProof -cne 'absent-then-written' -or
            $Verification.vmName -ceq $next.vmName -or [guid]$Verification.vmId -eq [guid]$next.vmId -or $Verification.guestMac -ceq $next.guestMac -or $Verification.sshPublicKeyHash -ceq $next.sshPublicKeyHash -or
            $Verification.sessionSeconds -lt 0 -or $next.sessionSeconds -lt 0 -or
            [double]::IsNaN($Verification.sessionSeconds) -or [double]::IsInfinity($Verification.sessionSeconds) -or [double]::IsNaN($next.sessionSeconds) -or [double]::IsInfinity($next.sessionSeconds)) { throw 'Two successive isolated child proofs differ from the image contract.' }
    }
}

function Publish-RunnerPreparedImage($Candidate, $Config, $Verification) {
    Assert-RunnerPreparationAuthorized
    Assert-RunnerControlIdle
    $receipt = Assert-RunnerImageCandidate $Candidate $Config -Rehash
    Assert-RunnerImageCloneProof $receipt $Verification -RequireGuestMtu
    if ((Get-RunnerNetworkObservation).fingerprint -cne $Verification.networkFingerprint) { throw 'Host network changed after clone verification; publication refused.' }
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
    # A failed builder may still be recorded while its unselected candidate is
    # discarded. Never drain a live session's parent leases here; any leased or
    # referenced candidate remains protected and deletion fails closed.
    if (-not (Get-RunnerState)) { Close-RunnerImageLeases }
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    foreach ($extension in @('vhdx', 'json')) {
        $path = Join-Path $directory ($Candidate.id + '.' + $extension)
        if (Test-Path -LiteralPath $path) {
            if ($extension -ceq 'vhdx') { Assert-RunnerPreparedImagePath $path; Assert-RunnerImageDiskUnreferenced $path }
            else { Assert-RunnerProtectedPath $path }
            Remove-Item -LiteralPath $path -Force -ErrorAction Stop
        }
    }
}

function Remove-RunnerOldImages($Selector) {
    if (Get-RunnerState) { throw 'Image retention requires no recorded session.' }
    Close-RunnerImageLeases
    $directory = Assert-OwnedPath (Join-Path $script:RunnerRoot 'prepared-images')
    Assert-RunnerProtectedPath $directory
    foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
        if ($entry.Name -cnotmatch '^([0-9a-f]{32})\.(vhdx|json)$' -or $entry.PSIsContainer) { throw 'Unrecognized prepared-image retention entry; investigate without deleting it.' }
        $id = $Matches[1]
        [void](Assert-OwnedPath $entry.FullName)
        if ($entry.Extension -ceq '.vhdx') { Assert-RunnerPreparedImagePath $entry.FullName }
        else { Assert-RunnerProtectedPath $entry.FullName }
        if ($id -ceq $Selector.id -or $id -ceq $Selector.previous) { continue }
        $disk = Join-Path $directory ($id + '.vhdx')
        if (Test-Path -LiteralPath $disk) { Assert-RunnerPreparedImagePath $disk; Assert-RunnerImageDiskUnreferenced $disk }
        Remove-Item -LiteralPath $entry.FullName -Force -ErrorAction Stop
    }
}

function Get-RunnerDetachedCommand([bool] $Prepared, [string] $LaunchId, [long] $RunnerId) {
    if ($LaunchId -cnotmatch '^[0-9a-f]{32}$' -or $RunnerId -le 0) { throw 'Detached runner requires its one recorded launch identity.' }
    $directory = "/home/runner/.itir-session/$LaunchId"
    $job = Get-RunnerJobCommand $Prepared
    # Same fixed run.sh and prepared environment. The private JIT file exists
    # only until the service reads it; no JIT enters receipt/stdout/journal.
    $wrapper = @'
#!/bin/bash
set -u
umask 077
cd __DIRECTORY__ || exit 125
trap 'code=$?; unset JIT; printf "__LAUNCH__|__RUNNER__|exited|%s\n" "$code" >receipt.tmp && mv receipt.tmp receipt' EXIT
printf '__LAUNCH__|__RUNNER__|running|-\n' >receipt.tmp && mv receipt.tmp receipt
IFS= read -r JIT <jit || exit 125
rm -f jit
printf '%s\n' "$JIT" | bash -c '__JOB__'
code=$?
unset JIT
exit "$code"
'@
    $wrapper = $wrapper.Replace('__DIRECTORY__', $directory).Replace('__LAUNCH__', $LaunchId).Replace('__RUNNER__', [string]$RunnerId).Replace('__JOB__', $job)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($wrapper.Replace("`r`n", "`n") + "`n"))
    # mkdir is the deliberate no-relaunch guard. Never retry this command after
    # any transport ambiguity; reconnect only to the separate receipt command.
    return 'set -eu; umask 077; IFS= read -r JIT; mkdir -p /home/runner/.itir-session; chmod 700 /home/runner/.itir-session; mkdir ' + $directory +
        '; printf ''%s\n'' "$JIT" >' + $directory + '/jit; unset JIT; printf ''%s'' ' + $encoded + ' | base64 -d >' + $directory +
        '/run; chmod 700 ' + $directory + '/run; sudo -n systemd-run --quiet --unit=itir-' + $LaunchId +
        ' --uid=runner --setenv=HOME=/home/runner --working-directory=/home/runner/actions-runner --property=Type=exec --property=Restart=no --property=KillMode=control-group --property=StandardOutput=null --property=StandardError=null /bin/bash ' + $directory + '/run'
}

function Get-RunnerReceiptCommand([string] $LaunchId) {
    if ($LaunchId -cnotmatch '^[0-9a-f]{32}$') { throw 'Receipt query requires the sole launch identity.' }
    return 'test -f /home/runner/.itir-session/' + $LaunchId + '/receipt && head -c 256 /home/runner/.itir-session/' + $LaunchId + '/receipt'
}

function ConvertFrom-RunnerGuestReceipt([string] $Text, $Journal) {
    if ($Text -cmatch '^([0-9a-f]{32})\|([1-9][0-9]*)\|(running|exited)\|(-|[0-9]{1,3})\r?\n?$') {
        $launch = $Matches[1]; $runner = $Matches[2]; $phase = $Matches[3]; $code = $Matches[4]
        if ($launch -cne $Journal.launchId -or $runner -cne [string]$Journal.runnerId -or
            ($phase -ceq 'running' -and $code -cne '-') -or ($phase -ceq 'exited' -and ($code -ceq '-' -or [int]$code -gt 255))) { throw 'Guest receipt does not match the sole runner launch.' }
        return [pscustomobject]@{ phase = $phase; exitCode = if ($phase -ceq 'exited') { [int]$code } else { $null } }
    }
    throw 'Guest receipt is malformed; workflow results remain GitHub authoritative.'
}
