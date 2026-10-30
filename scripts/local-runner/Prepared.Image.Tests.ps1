# Offline lifecycle regressions. Hyper-V/network/credential calls are fixtures;
# atomic image files and protected-state transitions use the real implementation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Test.FileHash.ps1')
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
. (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
foreach ($file in @('Runner.ps1', 'Update.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$null, [ref]$null)
    foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
}
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-image-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
$script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
$script:realControlIdle = (Get-Command Assert-RunnerControlIdle).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    return & $script:realEnter ('Local\' + [IO.Path]::GetFileName($base) + '-' + $Name.Replace('\', '-')) -FailFast:$FailFast
}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Prepared-image fixture accepted $Case." }
}
$script:missingMtuProof = $false
$script:blocked = ''; $script:interrupt = ''; $script:attached = $false; $script:vms = @()
$script:RunnerGuardOutcome = $null; $script:RunnerRecoveryProbe = $null
$script:binding = [pscustomobject]@{ hash = ('A' * 64); recipeId = ('B' * 64); bundleHash = ('F' * 64) }
$script:guest = [pscustomobject]@{ schema = 1; recipeId = $script:binding.recipeId; scrubbed = $true; capabilities = @('os-prerequisites', 'node-toolcache', 'npm-cache', 'playwright', 'supabase-images') }
$fixtureInputs = Read-RunnerJson (Join-Path $PSScriptRoot 'Image.Inputs.json')
[void][IO.Directory]::CreateDirectory((Join-Path $base 'bin'))
Write-RunnerJson (Join-Path (Join-Path $base 'bin') 'Image.Inputs.json') $fixtureInputs
$script:guest | Add-Member -NotePropertyName images -NotePropertyValue @($fixtureInputs.images | ForEach-Object {
    $entry = $_
    [pscustomobject]@{ source = $entry.source; reference = $entry.candidates[0]; id = ('sha256:' + ('a' * 64)); digests = @($entry.candidates[0] + '@sha256:' + ('b' * 64))
        aliases = @($(if ($entry.PSObject.Properties.Name -contains 'aliases') { $entry.aliases }) | ForEach-Object { [pscustomobject]@{ reference = $_; id = ('sha256:' + ('a' * 64)) } }) }
})
$config = [pscustomobject]@{ activation = 'disabled'; label = 'it-inventory-ephemeral'; maxMinutes = 120; guestIp = 'fixture'; baseVhdx = (Join-Path $base 'base.vhdx'); baseSha256 = ('C' * 64) }
function Get-RunnerConfig { return $config }
[IO.File]::WriteAllText($config.baseVhdx, 'generic-clean-base')
function Assert-Administrator {}
function Assert-SecureRoot {}
$script:nativeParentReaders = @{}
$script:nativeAclFault = ''
$script:actualPreparedAcl = (Get-Command Assert-RunnerPreparedImagePath).ScriptBlock
function Assert-RunnerProtectedPath([string] $Path) {
    [void](Assert-OwnedPath $Path)
    if ($Path -ceq $script:blocked -or $script:nativeParentReaders.ContainsKey($Path)) { throw 'Fixture ACL refusal.' }
}
function Assert-RunnerPreparedImagePath([string] $Path) {
    if ($Path -ceq $script:blocked) { throw 'Fixture ACL refusal.' }
    & $script:actualPreparedAcl $Path
}
function Get-Acl([string] $LiteralPath) {
    # Descriptor fixtures only: native attachment is modeled without assigning
    # permissions to real files. Production's scoped validator runs unchanged.
    $rules = @()
    if ($script:nativeParentReaders.ContainsKey($LiteralPath)) {
        $rules = @('S-1-5-83-0', 'S-1-15-3-1024-2268835264-3721307629-241982045-173645152-1490879176-104643441-2915960892-1612460704' | ForEach-Object {
            [pscustomobject]@{ IdentityReference = [Security.Principal.SecurityIdentifier]::new($_); AccessControlType = 'Allow'; FileSystemRights = 1179785
                IsInherited = $false; InheritanceFlags = 0; PropagationFlags = 0 }
        })
        switch ($script:nativeAclFault) {
            'inherited-read' { $rules[0].IsInherited = $true }
            'inherited-full' { $rules[0].IsInherited = $true; $rules[0].FileSystemRights = 2032127 }
            'write' { $rules[0].FileSystemRights = 1179787 }
            'unknown-reader' { $rules[0].IdentityReference = [Security.Principal.SecurityIdentifier]::new('S-1-1-0') }
        }
    }
    $acl = [pscustomobject]@{ Access = $rules }
    $acl | Add-Member ScriptMethod GetOwner { param($type) return [Security.Principal.SecurityIdentifier]::new('S-1-5-18') }
    return $acl
}
function Get-RunnerImageBinding { return $script:binding }
function Get-CoherentInstalledRunnerBundle { return [pscustomobject]@{ fixture = $true; hash = ('F'*64) } }
function Get-RunnerVmInventory { return $script:vms }
$script:childParents = @{}
function Get-VHD($Path) {
    if ($script:childParents.ContainsKey($Path)) { return [pscustomobject]@{ Attached = $script:attached; VhdType = 'Differencing'; ParentPath = $script:childParents[$Path] } }
    return [pscustomobject]@{ Attached = $script:attached; VhdType = 'Dynamic'; ParentPath = '' }
}
function New-VHD($Path, $ParentPath, [switch] $Differencing) {
    if (-not $Differencing) { throw 'Verifier did not use a differencing child.' }
    $script:childParents[$Path] = $ParentPath
    [IO.File]::WriteAllText($Path, 'fresh child')
    $blocked = $false; try { [IO.File]::AppendAllText($ParentPath, 'unexpected-write') } catch { $blocked = $true }
    if (-not $blocked) { throw 'Verifier parent lacked its restrictive lease.' }
}
function Get-VMHardDiskDrive($VM) { return @($VM.disks | ForEach-Object { [pscustomobject]@{ Path = $_ } }) }
function Invoke-RunnerTransitionCheckpoint([string] $Name) {
    if ($Name -ceq 'image-copy-created' -and $script:copyProbe -ceq 'source-sharing') {
        $refused = $false; try { [IO.File]::AppendAllText($script:copyProbeSource, 'changed') } catch { $refused = $true }
        if (-not $refused) { throw 'Candidate byte copy allowed a concurrent source writer.' }
        $refused = $false; try { [IO.File]::Delete($script:copyProbeSource) } catch { $refused = $true }
        if (-not $refused) { throw 'Candidate byte copy allowed concurrent source deletion.' }
        $script:copyProbeObserved = $true
    }
    if ($Name -ceq 'image-copy-created') { Invoke-FixtureCandidateCopyCheckpoint }
    if ($Name -ceq $script:interrupt) { throw "Fixture interrupted $Name." }
    if ($Name -ceq 'image-clone-ready' -and $script:verifyFailure -ceq 'guardian-after-ready') {
        $fresh = Get-RunnerState; $fresh.guardianPid = 999999; Write-RunnerJson $script:RunnerStatePath $fresh
    }
}
function Assert-RunnerControlIdle {}
$script:observationFingerprint = 'a' * 64
function Get-RunnerNetworkObservation { return [pscustomobject]@{ fingerprint = $script:observationFingerprint; rules = @(); observedUtc = [DateTime]::UtcNow.ToString('o') } }
function New-FixtureVerification($Candidate) {
    $script:nativeParentReaders[$Candidate.path] = $true
    $receipt = Read-RunnerJson $Candidate.receiptPath
    return [pscustomobject]@{ schema = 1; candidateId = $Candidate.id; diskHash = $receipt.diskHash; bindingHash = $receipt.bindingHash; recipeId = $receipt.recipeId; bundleHash = $receipt.bundleHash
        purpose = 'verify-image'; diskType = 'Differencing'; parentLease = 'read-only-same-handle'; parentIdentity = '00000001:0000000000000001'; markerProof = 'absent-then-written'; sessionSeconds = 1; cleanupVerified = $true; vmName = ('ITIR-' + [guid]::NewGuid().ToString('N')); vmId = [guid]::NewGuid().ToString(); guestMac = ('02' + [guid]::NewGuid().ToString('N').Substring(0,10).ToUpperInvariant())
        sshPublicKeyHash = (([guid]::NewGuid().ToString('N') * 2).ToUpperInvariant()); networkFingerprint = ('a' * 64); readiness = 'cloud-init-and-runner-prerequisites'; guestMtu = (Get-RunnerGuestMtu); readyUtc = [DateTime]::UtcNow.ToString('o'); readinessSeconds = 1 }
}
function Publish-FixtureImage($State, $Config, $Binding, $Guest) {
    $candidate = $null
    try {
        Write-RunnerJson $script:RunnerStatePath $State
        $candidate = New-RunnerPreparedImageCandidate $State $Config $Binding $Guest
        # Production Invoke-RunnerSession performs cleanup before returning the
        # candidate. This publication fixture retains source files for races,
        # but must model the same absence of a recorded running session.
        if (Test-Path -LiteralPath $script:RunnerStatePath) { Remove-Item -LiteralPath $script:RunnerStatePath }
        Close-RunnerImageLeases
        $proof = New-FixtureVerification $candidate
        $proof | Add-Member successiveChild (New-FixtureVerification $candidate)
        if ($script:missingMtuProof) { $proof.successiveChild.PSObject.Properties.Remove('guestMtu') }
        Publish-RunnerPreparedImage $candidate $Config $proof
    } finally { if ($null -ne $candidate) { Remove-RunnerImageCandidate $candidate } }
}
$script:sealedFixtureStates = [Collections.Generic.List[object]]::new()
function New-SealedState {
    $name = 'ITIR-' + [guid]::NewGuid().ToString('N')
    $instance = Join-Path (Join-Path $base 'instances') $name
    [void][IO.Directory]::CreateDirectory((Join-Path $instance 'vm-data'))
    [IO.File]::WriteAllText((Join-Path $instance 'vm-data\guest.vhdx'), ('scrubbed-' + $name))
    [IO.File]::WriteAllText((Join-Path $instance 'id_ed25519.pub'), ('builder-key-' + $name))
    $state = [pscustomobject]@{ layoutVersion = 2; tag = $script:RunnerTag; vmName = $name; vmId = [guid]::NewGuid().ToString(); instancePath = $instance
        purpose = 'prepare'; guestMac = '020000000001'; phase = 'sealed-off'; imageScrubProof = Get-RunnerJsonEvidence $script:guest
        deadlineUtc = [DateTime]::UtcNow.AddMinutes(2).ToString('o'); heartbeatUtc = [DateTime]::UtcNow.ToString('o') }
    Set-FixtureGuardian $state
    $state.networkRecovery.generation++; $state.networkRecovery.phase = 'sealed-preparation'
    $state | Add-Member imageSealBinding (Get-RunnerJsonEvidence ([ordered]@{ schema = 1; generation = $state.networkRecovery.generation
        bindingHash = $script:binding.hash; recipeId = $script:binding.recipeId; bundleHash = $script:binding.bundleHash; scrubProofHash = $state.imageScrubProof.hash }))
    Write-RunnerJson $script:RunnerStatePath $state
    # Keep immutable cleanup identities for only this factory's disposable
    # builder trees. Individual publication/race cases still reuse their bytes.
    [void]$script:sealedFixtureStates.Add([pscustomobject]@{ tag=$state.tag; vmName=$state.vmName; vmId=$state.vmId
        instancePath=$state.instancePath; layoutVersion=$state.layoutVersion; purpose='prepare'; phase='sealed-off' })
    return $state
}
function Set-FixtureGuardian($State) {
    foreach ($field in @('supervisor', 'guardian')) {
        $State | Add-Member ($field + 'Pid') $PID -Force
        $State | Add-Member ($field + 'StartUtc') ((Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')) -Force
    }
    $State | Add-Member guardianReady $true -Force
    $binding = [pscustomobject]@{ vmId = $State.vmId; vmName = $State.vmName; claimHash = Get-RunnerRecoveryClaimHash $State }
    $State | Add-Member networkRecovery (New-RunnerNetworkRecovery $binding ('a' * 64) ([DateTime]::Parse($State.deadlineUtc).ToUniversalTime()) ([DateTime]::UtcNow)) -Force
}
$script:copyRace = ''; $script:copyProbe = ''; $script:copyProbeObserved = $false
function Invoke-FixtureCandidateCopyCheckpoint {
    if ($script:copyRace -ceq 'observe') {
        # Actual guardian ticks interleave after sealing and before/during bulk
        # copy while the preparation registration is authoritatively absent.
        $current = Get-RunnerState
        foreach ($unused in 1..3) { if (-not (Invoke-GuardCheck $current.vmName)) { throw 'Sealed preparation guardian stopped during copy.' } }
    }
    if ($script:copyRace) {
        $lockName = 'Local\' + [IO.Path]::GetFileName($base) + '-Global-ITInventoryLocalRunner-v1'
        $job = Start-Job -ArgumentList $PSScriptRoot, $base, $lockName, $script:copyRace -ScriptBlock {
            param($source, $root, $lockName, $race)
            $ErrorActionPreference = 'Stop'
. (Join-Path $source 'Test.FileHash.ps1')
            . (Join-Path $source 'Common.ps1')
            . (Join-Path $source 'Test.Mutex.ps1')
            $script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
            # Nested production state reads must reacquire this same private lock.
            $script:fixtureStateLock = $lockName
            $script:fixtureEnter = (Get-Command Enter-RunnerLock).ScriptBlock
            function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
                if ($Name -cne 'Global\ITInventoryLocalRunner-v1' -and $Name -cne $script:fixtureStateLock) { throw 'Fixture child requested an unrelated mutex.' }
                & $script:fixtureEnter $script:fixtureStateLock -FailFast:$FailFast
            }
            $mutex = Enter-RunnerLock $lockName -FailFast
            try {
                $state = Get-RunnerState
                switch ($race) {
                    'cleanup' { Remove-Item -LiteralPath $script:RunnerStatePath }
                    'guid' { $state.vmId = [guid]::NewGuid().ToString(); Write-RunnerJson $script:RunnerStatePath $state }
                    'proof' { $proof = Get-RunnerEvidenceValue $state.imageScrubProof; $proof.scrubbed = $false; $state.imageScrubProof = Get-RunnerJsonEvidence $proof; Write-RunnerJson $script:RunnerStatePath $state }
                    'stop' { [IO.File]::WriteAllText((Join-Path $state.instancePath 'stop.requested'), '') }
                }
                [IO.File]::WriteAllText((Join-Path $root 'copy-guardian-acquired'), 'ready')
            } finally { Exit-RunnerLock $mutex }
        }
        try {
            [void](Wait-Job $job -Timeout 15)
            if ($job.State -ne 'Completed') { throw 'Image-copy guardian could not acquire state mutex.' }
            [void](Receive-Job $job -ErrorAction Stop)
        } finally { if ($job.State -in @('Completed', 'Failed', 'Stopped')) { Remove-Job $job } }
    }
}
try {
    # Native byte-copy regressions deliberately avoid ACL mutation. The source
    # descriptor is never assigned to the newly inherited destination descriptor.
    $state = New-SealedState
    $copyFixture = Join-Path $base 'byte-copy-fixture'; [void][IO.Directory]::CreateDirectory($copyFixture)
    $copySource = (Get-RunnerSessionPaths $state).guestDisk
    $copyDestination = Join-Path $copyFixture 'candidate.vhdx'
    $script:copyProbe = 'source-sharing'; $script:copyProbeSource = $copySource
    try { Copy-RunnerPreparedImageBytes $copySource $copyDestination $state } finally { $script:copyProbe = '' }
    if (-not $script:copyProbeObserved -or (Get-FileHash -LiteralPath $copySource).Hash -cne (Get-FileHash -LiteralPath $copyDestination).Hash) { throw 'Native byte-copy content/source-sharing proof failed.' }
    $existingHash = (Get-FileHash -LiteralPath $copyDestination).Hash
    Assert-Rejected { Copy-RunnerPreparedImageBytes $copySource $copyDestination $state } 'CreateNew refuses an existing candidate'
    if ((Get-FileHash -LiteralPath $copyDestination).Hash -cne $existingHash) { throw 'CreateNew refusal overwrote existing candidate bytes.' }
    $script:blocked = Join-Path $copyFixture 'acl-refused.vhdx'
    Assert-Rejected { Copy-RunnerPreparedImageBytes $copySource $script:blocked $state } 'new destination ACL refusal'
    if ((Get-Item -LiteralPath $script:blocked).Length -ne 0) { throw 'Destination ACL was checked after copying bytes.' }
    $script:blocked = ''
    $script:interrupt = 'image-copy-created'
    Assert-Rejected { Copy-RunnerPreparedImageBytes $copySource (Join-Path $copyFixture 'interrupted.vhdx') $state } 'copy interruption disposes streams'
    $script:interrupt = ''
    [IO.File]::AppendAllText($copySource, 'released')
    $expired = (ConvertTo-Json $state -Depth 10) | ConvertFrom-Json; $expired.deadlineUtc = [DateTime]::UtcNow.AddSeconds(-1).ToString('o')
    Assert-Rejected { Copy-RunnerPreparedImageBytes $copySource (Join-Path $copyFixture 'expired.vhdx') $expired } 'copy deadline expiry'
    $copyDefinition = (Get-Command Copy-RunnerPreparedImageBytes).ScriptBlock.ToString()
    $copyAst = [Management.Automation.Language.Parser]::ParseInput($copyDefinition, [ref]$null, [ref]$null)
    $copyCommands = @($copyAst.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] }, $false) | ForEach-Object { $_.GetCommandName() })
    if (@($copyCommands | Where-Object { $_ -cin @('Copy-Item', 'Set-Acl') }).Count -or $copyDefinition -match 'SetAccessControl' -or $copyDefinition -notmatch 'FileMode\]::CreateNew') { throw 'Candidate byte copy carries source security metadata or overwrites files.' }
    # Inject only the two stream opens into the actual function body. An output
    # disposal fault must still release the restrictive source handle.
    $script:inputDisposed = $false
    $script:faultInput = [pscustomobject]@{}
    $script:faultInput | Add-Member ScriptMethod Read { param($buffer, $offset, $count) return 0 }
    $script:faultInput | Add-Member ScriptMethod Dispose { $script:inputDisposed = $true }
    $script:faultOutput = [pscustomobject]@{}
    $script:faultOutput | Add-Member ScriptMethod Flush { param($flushToDisk) }
    $script:faultOutput | Add-Member ScriptMethod Dispose { throw 'Fixture output disposal I/O failure.' }
    $faultDefinition = $copyDefinition.Replace('[IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)', '$script:faultInput').Replace('[IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)', '$script:faultOutput')
    if ($faultDefinition -ceq $copyDefinition -or $faultDefinition -match '\[IO.File\]::Open') { throw 'Copy fault fixture did not replace exactly its stream opens.' }
    Assert-Rejected { & ([scriptblock]::Create($faultDefinition)) $copySource (Join-Path $copyFixture 'dispose-fault.vhdx') $state } 'output disposal I/O failure'
    if (-not $script:inputDisposed) { throw 'Output disposal failure retained the restrictive source handle.' }
    Remove-Item -LiteralPath $script:RunnerStatePath -Force
    Write-Host 'Prepared candidate CreateNew bytes/source sharing/ACL-before-copy/deadline/stream cleanup regressions passed.'
    Assert-RunnerImageStorageReceipt $script:guest
    $guestBytes = ConvertTo-Json -InputObject $script:guest -Depth 10
    foreach ($invalid in @('missing-alias', 'wrong-id', 'wrong-version', 'other-registry', 'duplicate', 'unpulled-reference', 'no-digests')) {
        $badGuest = $guestBytes | ConvertFrom-Json
        $storage = @($badGuest.images | Where-Object source -CEQ 'supabase/storage-api:v1.77.9')[0]
        switch ($invalid) {
            'missing-alias' { $storage.aliases = @($storage.aliases | Select-Object -Skip 1) }
            'wrong-id' { $storage.aliases[0].id = 'sha256:' + ('c' * 64) }
            'wrong-version' { $storage.aliases[0].reference = 'public.ecr.aws/supabase/storage-api:v1.77.0' }
            'other-registry' { $storage.aliases[0].reference = 'other.example/supabase/storage-api:v1.77.9' }
            'duplicate' { $storage.aliases[0].reference = $storage.aliases[1].reference }
            'unpulled-reference' { $storage.reference = 'other.example/supabase/storage-api:v1.77.9' }
            'no-digests' { $storage.digests = @() }
        }
        Assert-Rejected { Assert-RunnerImageStorageReceipt $badGuest } "storage-$invalid"
    }
    if ((Get-RunnerImageSelection $config).reason -cne 'absent') { throw 'Absent prepared image did not use generic fallback.' }
    [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop')
    $state = New-SealedState
    Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } 'non-owner invocation'
    $script:RunnerPreparationAuthorized = $true
    foreach ($purpose in @('job', 'verify-image', 'invalid')) {
        $state.purpose = $purpose
        Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } 'job/unknown-purpose publication'
    }
    $state.purpose = 'prepare'
    $state | Add-Member -NotePropertyName claimMode -NotePropertyValue 'active'
    Assert-Rejected { Assert-StateIdentity $state } 'prepare carrying job authorization'
    $state.PSObject.Properties.Remove('claimMode')
    $state.phase = 'owned'; Write-RunnerJson $script:RunnerStatePath $state
    Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } 'no committed off/scrub proof'
    $state.phase = 'sealed-off'; Write-RunnerJson $script:RunnerStatePath $state
    $script:observationFingerprint = 'b' * 64
    Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } 'network change after clone verification'
    $script:observationFingerprint = 'a' * 64
    Publish-FixtureImage $state $config $script:binding $script:guest
    $initial = Get-RunnerImageRecord
    if ((Get-RunnerImageSelection $config).differencing -ne $true) { throw 'Matching new clone proof did not authorize prepared differencing.' }
    foreach ($fault in @('inherited-read', 'inherited-full', 'write', 'unknown-reader')) {
        $script:nativeAclFault = $fault
        try {
            Assert-Rejected { Get-RunnerImageRecord } "record-$fault"
            Assert-Rejected { Get-RunnerImageSelection $config } "selection-$fault"
        } finally { $script:nativeAclFault = '' }
    }
    $legacyProof = (ConvertTo-Json $initial.receipt.cloneVerification -Depth 8) | ConvertFrom-Json
    $legacyProof.PSObject.Properties.Remove('diskType'); $legacyProof.PSObject.Properties.Remove('parentLease')
    $legacyProof.PSObject.Properties.Remove('successiveChild')
    Assert-RunnerImageCloneProof $initial.receipt $legacyProof # Legacy proof remains valid for full-copy only.
    $verificationBytes = ConvertTo-Json -InputObject $initial.receipt.cloneVerification -Depth 8
    # Legacy missing MTU remains readable, never usable as a current/fresh proof.
    $withoutMtu = $verificationBytes | ConvertFrom-Json
    $withoutMtu.PSObject.Properties.Remove('guestMtu')
    $withoutMtu.successiveChild.PSObject.Properties.Remove('guestMtu')
    Assert-RunnerImageCloneProof $initial.receipt $withoutMtu
    Assert-Rejected { Assert-RunnerImageCloneProof $initial.receipt $withoutMtu -RequireGuestMtu } 'missing measured guest MTU'
    $childWithoutMtu = $verificationBytes | ConvertFrom-Json
    $childWithoutMtu.successiveChild.PSObject.Properties.Remove('guestMtu')
    Assert-Rejected { Assert-RunnerImageCloneProof $initial.receipt $childWithoutMtu -RequireGuestMtu } 'successive child missing measured MTU'
    foreach ($badMtu in @($null,1500,'1400',[long]1400,@(1400))) {
        foreach ($child in @($false,$true)) {
            $proof = $verificationBytes | ConvertFrom-Json
            if ($child) { $proof.successiveChild.guestMtu=$badMtu } else { $proof.guestMtu=$badMtu }
            Assert-Rejected { Assert-RunnerImageCloneProof $initial.receipt $proof } 'malformed MTU is invalid even for legacy readback'
            Assert-Rejected { Assert-RunnerImageCloneProof $initial.receipt $proof -RequireGuestMtu } 'malformed MTU cannot qualify fresh proof'
        }
    }
    foreach ($bad in @('job-purpose', 'not-cleaned', 'wrong-candidate', 'wrong-bundle', 'builder-vm', 'builder-mac', 'builder-key', 'wrong-readiness')) {
        $proof = $verificationBytes | ConvertFrom-Json
        switch ($bad) {
            'job-purpose' { $proof.purpose = 'job' }
            'not-cleaned' { $proof.cleanupVerified = $false }
            'wrong-candidate' { $proof.candidateId = [guid]::NewGuid().ToString('N') }
            'wrong-bundle' { $proof.bundleHash = ('0' * 64) }
            'builder-vm' { $proof.vmId = $initial.receipt.builder.vmId }
            'builder-mac' { $proof.guestMac = $initial.receipt.builder.guestMac }
            'builder-key' { $proof.sshPublicKeyHash = $initial.receipt.builder.sshPublicKeyHash }
            'wrong-readiness' { $proof.readiness = 'ssh-only' }
        }
        Assert-Rejected { Assert-RunnerImageCloneProof $initial.receipt $proof } $bad
    }
    Assert-Rejected { Assert-RunnerImageCloneProof $initial.receipt $null } 'missing clone proof'
    foreach ($bad in @('same-vm','same-guid-case','same-mac','same-key','parent-identity','marker','not-cleaned','nested-child')) {
        $proof = $verificationBytes | ConvertFrom-Json
        switch ($bad) {
            'same-vm' { $proof.successiveChild.vmId = $proof.vmId }
            'same-guid-case' { $proof.vmId = 'abcdefab-cdef-abcd-efab-cdefabcdefab'; $proof.successiveChild.vmId = $proof.vmId.ToUpperInvariant() }
            'same-mac' { $proof.successiveChild.guestMac = $proof.guestMac }
            'same-key' { $proof.successiveChild.sshPublicKeyHash = $proof.sshPublicKeyHash }
            'parent-identity' { $proof.successiveChild.parentIdentity = '00000002:0000000000000002' }
            'marker' { $proof.successiveChild.markerProof = 'present' }
            'not-cleaned' { $proof.successiveChild.cleanupVerified = $false }
            'nested-child' { $proof.successiveChild | Add-Member successiveChild $proof }
        }
        Assert-Rejected { Assert-RunnerImageCloneProof $initial.receipt $proof } "successive-$bad"
    }
    $initialReceiptPath = Join-Path (Join-Path $base 'prepared-images') ($initial.selector.id + '.json')
    $initialSelectorPath = Join-Path $base 'prepared-image.json'
    $savedReceipt = [IO.File]::ReadAllBytes($initialReceiptPath); $savedSelector = [IO.File]::ReadAllBytes($initialSelectorPath)
    try {
        $legacyReceipt = (ConvertTo-Json -InputObject $initial.receipt -Depth 12) | ConvertFrom-Json
        $legacyReceipt.cloneVerification = $legacyProof
        Write-RunnerJson $initialReceiptPath $legacyReceipt
        $legacySelector = (ConvertTo-Json -InputObject $initial.selector) | ConvertFrom-Json
        $legacySelector.receiptHash = (Get-FileHash -LiteralPath $initialReceiptPath).Hash
        Write-RunnerJson $initialSelectorPath $legacySelector
        $legacySelection = Get-RunnerImageSelection $config
        if (-not $legacySelection.prepared -or $legacySelection.differencing) { throw 'Legacy clone proof must select only the existing prepared full-copy path.' }
        $legacyReceipt.cloneVerification=$withoutMtu
        Write-RunnerJson $initialReceiptPath $legacyReceipt
        $legacySelector.receiptHash=(Get-FileHash -LiteralPath $initialReceiptPath).Hash
        Write-RunnerJson $initialSelectorPath $legacySelector
        [void](Get-RunnerImageRecord)
        Assert-Rejected { Get-RunnerImageSelection $config } 'current-binding legacy image has no measured MTU'
        $legacyReceipt.bindingHash=('E'*64)
        Write-RunnerJson $initialReceiptPath $legacyReceipt
        $legacySelector.receiptHash=(Get-FileHash -LiteralPath $initialReceiptPath).Hash
        Write-RunnerJson $initialSelectorPath $legacySelector
        Assert-Rejected { Get-RunnerImageRecord } 'inconsistent stale receipt and clone binding cannot become a cache miss'
        $legacyReceipt.cloneVerification.bindingHash=$legacyReceipt.bindingHash
        $legacyReceipt.cloneVerification.successiveChild.bindingHash=$legacyReceipt.bindingHash
        Write-RunnerJson $initialReceiptPath $legacyReceipt
        $legacySelector.receiptHash=(Get-FileHash -LiteralPath $initialReceiptPath).Hash
        Write-RunnerJson $initialSelectorPath $legacySelector
        if ((Get-RunnerImageSelection $config).reason -cne 'stale-inputs') { throw 'Legacy stale inputs lost the generic fallback.' }
        $legacyReceipt.bindingHash=$initial.receipt.bindingHash
        $legacyReceipt.PSObject.Properties.Remove('cloneVerification')
        Write-RunnerJson $initialReceiptPath $legacyReceipt
        $legacySelector = (ConvertTo-Json -InputObject $initial.selector) | ConvertFrom-Json
        $legacySelector.receiptHash = (Get-FileHash -LiteralPath $initialReceiptPath).Hash
        Write-RunnerJson $initialSelectorPath $legacySelector
        Assert-Rejected { Get-RunnerImageSelection $config } 'matching image with no clone verification cannot qualify'
    } finally { [IO.File]::WriteAllBytes($initialReceiptPath, $savedReceipt); [IO.File]::WriteAllBytes($initialSelectorPath, $savedSelector) }
    $initialSelectorHash = (Get-FileHash -LiteralPath (Join-Path $base 'prepared-image.json')).Hash
    $script:missingMtuProof = $true
    try { Assert-Rejected { Publish-FixtureImage (New-SealedState) $config $script:binding $script:guest } 'fresh publication missing successive MTU proof' } finally { $script:missingMtuProof = $false }
    if ((Get-FileHash -LiteralPath (Join-Path $base 'prepared-image.json')).Hash -cne $initialSelectorHash) { throw 'Missing MTU publication changed image selection.' }
    # Recoverable interruption keeps old selection; selector is always the last commit.
    foreach ($point in @('image-copy', 'image-receipt')) {
        $state = New-SealedState; $script:interrupt = $point
        Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } $point
        $script:interrupt = ''
        if ((Get-FileHash -LiteralPath (Join-Path $base 'prepared-image.json')).Hash -cne $initialSelectorHash -or
            @(Get-ChildItem -LiteralPath (Join-Path $base 'prepared-images')).Count -ne 2) { throw 'Interrupted publication changed selection or left an unowned candidate.' }
    }
    foreach ($race in @('cleanup', 'guid', 'proof', 'stop')) {
        $state = New-SealedState; $script:copyRace = $race
        if (Test-Path (Join-Path $base 'copy-guardian-acquired')) { Remove-Item -LiteralPath (Join-Path $base 'copy-guardian-acquired') }
        Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } "copy-$race"
        $script:copyRace = ''
        if (-not (Test-Path (Join-Path $base 'copy-guardian-acquired')) -or
            (Get-FileHash -LiteralPath (Join-Path $base 'prepared-image.json')).Hash -cne $initialSelectorHash -or
            @(Get-ChildItem -LiteralPath (Join-Path $base 'prepared-images')).Count -ne 2) { throw 'Image copy blocked guardian, selected cancelled candidate, or leaked its candidate.' }
    }
    $state = New-SealedState; $script:interrupt = 'image-selector'
    Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } 'post-commit interruption'
    $script:interrupt = ''
    $second = Get-RunnerImageRecord
    if ($second.selector.previous -cne $initial.selector.id -or -not (Test-Path -LiteralPath $second.path)) { throw 'Committed selector interruption removed selected disk/prior history.' }
    $state = New-SealedState
    Publish-FixtureImage $state $config $script:binding $script:guest
    if (@(Get-ChildItem -LiteralPath (Join-Path $base 'prepared-images')).Count -ne 4 -or (Test-Path -LiteralPath $initial.path)) { throw 'Retention did not keep selected and one prior image.' }
    $current = Get-RunnerImageRecord
    $script:binding = [pscustomobject]@{ hash = ('D' * 64); recipeId = ('E' * 64); bundleHash = ('F' * 64) }
    if ((Get-RunnerImageSelection $config).reason -cne 'stale-inputs') { throw 'Changed trusted pins did not fall back to generic.' }
    $writeBlocked = $false; try { [IO.File]::AppendAllText($current.path, 'tamper') } catch { $writeBlocked = $true }
    if (-not $writeBlocked) { throw 'Verified stale selected image could be modified under its lease.' }
    Close-RunnerImageLeases # Model a supervisor restart before offline corruption.
    [IO.File]::AppendAllText($current.path, 'tamper')
    Assert-Rejected { Get-RunnerImageSelection $config } 'corrupt stale image cannot fall back'
    [IO.File]::WriteAllText($current.path, [IO.File]::ReadAllText(((Get-RunnerSessionPaths $state).guestDisk)))
    $script:binding = [pscustomobject]@{ hash = ('A' * 64); recipeId = ('B' * 64); bundleHash = ('F' * 64) }
    $script:blocked = $current.path
    Assert-Rejected { Get-RunnerImageSelection $config } 'disk ACL mismatch'
    $script:blocked = ''
    $script:attached = $true
    Assert-Rejected { Get-RunnerImageSelection $config } 'mounted selected image'
    $script:attached = $false
    $script:vms = @([pscustomobject]@{ Name = 'Other'; Id = [guid]::NewGuid(); Path = (Join-Path $base 'other'); disks = @($current.path) })
    Assert-Rejected { Get-RunnerImageSelection $config } 'referenced selected image'
    Assert-Rejected { Publish-FixtureImage $state $config $script:binding $script:guest } 'referenced retained image'
    $script:vms = @()
    $selectorPath = Join-Path $base 'prepared-image.json'
    $selectorBytes = [IO.File]::ReadAllBytes($selectorPath)
    [IO.File]::WriteAllText($selectorPath, '{}')
    Assert-Rejected { Get-RunnerImageSelection $config } 'invalid selector'
    [IO.File]::WriteAllBytes($selectorPath, $selectorBytes)
    $receiptPath = Join-Path (Join-Path $base 'prepared-images') ($current.selector.id + '.json')
    $receiptBytes = [IO.File]::ReadAllBytes($receiptPath)
    [IO.File]::AppendAllText($receiptPath, ' ')
    Assert-Rejected { Get-RunnerImageSelection $config } 'receipt corruption'
    [IO.File]::WriteAllBytes($receiptPath, $receiptBytes)
    # A reparse point in any ancestor is rejected before ACL/content trust.
    $link = Join-Path $base 'linked-images'
    & cmd.exe /c mklink /J $link (Join-Path $base 'prepared-images') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Image reparse fixture creation failed.' }
    Assert-Rejected { Assert-OwnedPath (Join-Path $link ($current.selector.id + '.vhdx')) } 'image reparse path'
    [IO.Directory]::Delete($link)
    # New key and instance ID are regenerated by the same seed path for all profiles.
    foreach ($label in @('it-inventory-light', 'it-inventory-mid', 'it-inventory-heavy')) {
        $cold = Get-GuestCloudConfig 'fresh-public-key' $label $false
        $warm = Get-GuestCloudConfig 'different-fresh-public-key' $label $true
        if ($cold -notmatch 'package_update: true' -or $warm -match 'packages:' -or $warm -notmatch 'package_update: false' -or
            $warm -notmatch 'different-fresh-public-key' -or $warm -match 'fresh-public-key\s+package_update: true') { throw 'Prepared seed lost fresh SSH identity or retained apt install.' }
        if ($cold -notmatch '(?m)^groups:\r?\n  - docker\r?\nusers:' -or $warm -match '(?m)^groups:' -or
            $cold -notmatch '(?m)^    groups: \[sudo, docker\]$' -or $warm -notmatch '(?m)^    groups: \[sudo, docker\]$') {
            throw 'Rendered generic/prepared seeds lost Docker membership or redeclared an existing prepared group.'
        }
    }

    # Publication/reference/reparse assertions above deliberately reused sealed
    # builder bytes. Retire those exact factory-owned trees before exercising
    # fresh sessions, as the real session finally does after publication.
    Write-Host 'PREPARED_TEST_BEGIN sealed-fixture-cleanup'
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or
        [IO.Path]::GetFileName($base) -cnotmatch '^ITIR-image-[0-9a-f]{32}$' -or
        $script:sealedFixtureStates.Count -ne 11 -or $script:vms.Count -ne 0 -or @(Get-RunnerVmInventory).Count -ne 0) { throw 'Sealed fixture cleanup lacks its exact idle namespace.' }
    $selectedBefore = Get-RunnerImageRecord
    $selectionHashBefore = (Get-FileHash -LiteralPath $selectorPath).Hash
    $selectedDiskHashBefore = (Get-FileHash -LiteralPath $selectedBefore.path).Hash
    $recorded = Get-RunnerState
    if ($null -ne $recorded) {
        Assert-StateIdentity $recorded
        if (@($script:sealedFixtureStates | Where-Object { $_.vmName -ceq $recorded.vmName -and $_.vmId -ceq $recorded.vmId -and $_.instancePath -ceq $recorded.instancePath }).Count -ne 1) { throw 'Sealed cleanup state was not created by its fixture factory.' }
    }
    foreach ($owned in $script:sealedFixtureStates) {
        $ownedPaths = Get-RunnerSessionPaths $owned
        if ([IO.Path]::GetDirectoryName($ownedPaths.instance) -ine (Join-Path $base 'instances') -or
            $ownedPaths.instance -cne $owned.instancePath -or @(Get-RunnerVmInventory).Count -ne 0) { throw 'Sealed cleanup target or idle inventory changed.' }
        Remove-RunnerInstance $owned
        if (Test-Path -LiteralPath $ownedPaths.instance) { throw 'Canonical cleanup retained a factory-owned sealed tree.' }
    }
    $script:sealedFixtureStates.Clear()
    if ($script:sealedFixtureStates.Count -ne 0 -or (Get-RunnerState) -or $script:vms.Count -ne 0 -or
        @(Get-ChildItem -LiteralPath (Join-Path $base 'instances') -Directory).Count -ne 0 -or
        (Get-RunnerImageRecord).selector.id -cne $selectedBefore.selector.id -or
        (Get-FileHash -LiteralPath $selectorPath).Hash -cne $selectionHashBefore -or
        (Get-FileHash -LiteralPath $selectedBefore.path).Hash -cne $selectedDiskHashBefore -or
        @(Get-ChildItem -LiteralPath (Join-Path $base 'prepared-images')).Count -ne 4) { throw 'Sealed fixture retirement changed image selection or left session resources.' }
    Write-Host 'PREPARED_TEST_END sealed-fixture-cleanup'

    # Actual preparation session runs creation/guard/readiness and cleanup while
    # all token, runner archive, GitHub and JIT paths are fatal fixture sentinels.
    if (Test-Path -LiteralPath $script:RunnerStatePath) { Remove-Item -LiteralPath $script:RunnerStatePath }
    foreach ($name in @('Set-VMProcessor', 'Set-VMMemory', 'Assert-RunnerVmResources', 'Set-VMFirmware', 'Disable-VMIntegrationService', 'Assert-RunnerGuestMac', 'Assert-AdapterRules', 'Test-GuestIsolation', 'Assert-RunnerVmLifecycle')) { Set-Item -Path "Function:$name" -Value {} }
    function Assert-InstalledHost($Config, [switch] $ForPreparation) { if (-not $ForPreparation) { throw 'Preparation used job host authorization.' } }
    function Get-OwnerToken { throw 'Preparation attempted credential decryption.' }
    function Get-RunnerArchive { throw 'Preparation attempted runner download.' }
    function Invoke-GitHub { throw 'Preparation attempted GitHub/JIT registration.' }
    function Get-VM([string] $Name, $Id) { if ($null -ne $Id) { return @($script:vms | Where-Object Id -EQ $Id)[0] }; return @($script:vms | Where-Object Name -CEQ $Name)[0] }
    function New-RunnerProfileVm($Name, $Disk, $Instance, $ProfileLabel) {
        if ($ProfileLabel -cne 'it-inventory-heavy') { throw 'Preparation changed fixed resource caps.' }
        if ($script:childParents.ContainsKey($Disk)) { $script:nativeParentReaders[$script:childParents[$Disk]] = $true }
        $vm = [pscustomobject]@{ Id = [guid]::NewGuid(); Name = $Name; Notes = ''; State = 'Off'; Path = (Join-Path $Instance $Name); disks = @($Disk) }
        $script:vms = @($vm); return $vm
    }
    function Set-VM($Name, $Notes) { (Get-VM $Name).Notes = $Notes }
    function Get-VMIntegrationService { return @() }
    $script:macSequence = 1
    function Set-RunnerGuestMac { $script:macSequence++; return [pscustomobject]@{ rawMac = ('02' + $script:macSequence.ToString('X10')); seedMac = '02:00:00:00:00:01' } }
    function Assert-CurrentRunnerNetworkRules {}
    function Set-IsolatedAdapter { $script:isolation++; return @() }
    function Start-SessionGuardian {
        $script:guardians++
        $fresh = Get-RunnerState
        Set-FixtureGuardian $fresh
        Write-RunnerJson $script:RunnerStatePath $fresh
    }
    function Start-GuardedVm($State) { (Get-VM $State.vmName).State = 'Running' }
    $script:verifyFailure = ''
    function Wait-Guest($State) {
        $script:readiness++
        if ($State.purpose -ceq 'verify-image') {
            if ($script:verifyFailure -ceq 'mtu') { return 1500 }
            if ($script:verifyFailure -ceq 'missing-mtu') { return }
            if ($script:verifyFailure -in @('cloud-init', 'docker')) { throw "Fixture $($script:verifyFailure) readiness refused." }
            [IO.File]::AppendAllText(((Get-RunnerSessionPaths $State).guestDisk), 'booted-clone-marker')
            if ($script:verifyFailure -ceq 'guardian') {
                $fresh = Get-RunnerState
                $fresh | Add-Member -NotePropertyName guardianReady -NotePropertyValue $true -Force
                $fresh | Add-Member -NotePropertyName guardianPid -NotePropertyValue 999999 -Force
                $fresh | Add-Member -NotePropertyName guardianStartUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
                Write-RunnerJson $script:RunnerStatePath $fresh
            }
            if ($script:verifyFailure -ceq 'candidate-tamper') { [IO.File]::AppendAllText((Join-Path (Join-Path $base 'prepared-images') ($State.imageCandidate.id + '.vhdx')), 'unexpected-write') }
        }
        return Get-RunnerGuestMtu
    }
    function New-RunnerSshKey([string] $Path) { [IO.File]::WriteAllText(($Path + '.pub'), ('key-' + [guid]::NewGuid().ToString('N'))) }
    function New-SeedDisk($Path, $PublicKey, $Mac, $Config, $ProfileLabel, $Prepared) {
        if ($Prepared -ne ((Get-RunnerState).purpose -ceq 'verify-image') -or $PublicKey -cnotmatch '^key-[0-9a-f]{32}$') { throw 'Builder/verifier reused SSH key or selected the wrong seed path.' }
        [IO.File]::WriteAllText($Path, 'seed'); $script:keys += $PublicKey
    }
    function Add-VMHardDiskDrive($VMName, $Path) { (Get-VM $VMName).disks += $Path }
    function Remove-VM($VM, [switch] $Force) {
        if ($script:verifyFailure -ceq 'cleanup' -and (Get-RunnerState).purpose -ceq 'verify-image') { return }
        $script:vms = @($script:vms | Where-Object Id -NE $VM.Id)
    }
    function Stop-VM($VM, [switch] $TurnOff, [switch] $Force) { $script:forcedStops++; $VM.State = 'Off' }
    function Invoke-RunnerNative($Executable, $Arguments, $InputText = $null, [switch] $CaptureOutput, [switch] $CaptureError, $TimeoutSeconds = 0) {
        if ($null -ne $InputText -or ($Arguments -join ' ') -match 'jitconfig|run.sh|runner.tar.gz') { throw 'Builder received job data or executed runner code.' }
        $script:natives++
        if ($Executable -ceq 'scp.exe') {
            $sent = @($Arguments | Where-Object { $_ -like '*.json' -or $_ -like '*.sh' -or $_ -like '*.toml' })
            if ($sent.Count -ne 5 -or (Compare-Object @($sent | ForEach-Object { Split-Path $_ -Leaf } | Sort-Object) @(Get-RunnerImageInputNames | Sort-Object))) { throw 'Builder received non-recipe host files.' }
        }
        if ($CaptureOutput) {
            if ($TimeoutSeconds -ne 3600 -or -not $CaptureError -or $Arguments[-1] -cne 'bash -o pipefail -c ''sudo bash /home/runner/image-inputs/Image.Prepare.sh 2> >(tail -c 4096 >&2) | head -c 16385''') { throw 'Builder execution lost fixed command/output/deadline.' }
            $script:vms[0].State = 'Off'
            [IO.File]::WriteAllText($script:vms[0].disks[0], ('scrubbed-builder-' + $script:vms[0].Name))
            return [pscustomobject]@{ ExitCode = $(if ($script:buildFails) { 1 } else { 0 }); Output = (ConvertTo-Json -InputObject $script:guest -Depth 8 -Compress); ErrorOutput = (('fixture' + [char]1 + ' prepare error ') + ('x' * 5000)) }
        }
        if ($Arguments[-1] -cmatch 'it-inventory-clone-probe') {
            if ($TimeoutSeconds -ne 15 -or $Arguments[-1] -cne 'sudo test ! -e /var/lib/it-inventory-clone-probe && sudo touch /var/lib/it-inventory-clone-probe && sudo test -f /var/lib/it-inventory-clone-probe') { throw 'Verifier marker command/bound changed.' }
            $disk = (Get-RunnerSessionPaths (Get-RunnerState)).guestDisk
            if ([IO.File]::ReadAllText($disk).Contains('marker-written')) { return 1 }
            [IO.File]::AppendAllText($disk, 'marker-written')
            $script:markers++
        }
        return 0
    }
    $script:keys = @(); $script:forcedStops = 0; $script:guardians = 0; $script:readiness = 0; $script:isolation = 0; $script:natives = 0; $script:markers = 0; $script:buildFails = $false
    $script:copyRace = 'observe'
    foreach ($attempt in @(1, 2)) {
        Write-Host "PREPARED_TEST_BEGIN prepare-verify-pair-$attempt"
        $candidate = Invoke-RunnerSession $config $null 'it-inventory-heavy' 'prepare'
        $verification = Invoke-RunnerSession $config $null 'it-inventory-heavy' 'verify-image' $candidate
        $verification | Add-Member -NotePropertyName cleanupVerified -NotePropertyValue $true
        foreach ($fault in @('inherited-read', 'inherited-full', 'write', 'unknown-reader')) {
            $script:nativeAclFault = $fault
            try { Assert-Rejected { Assert-RunnerImageCandidate $candidate $config } "candidate-$fault" }
            finally { $script:nativeAclFault = '' }
        }
        Publish-RunnerPreparedImage $candidate $config $verification
        Remove-RunnerImageCandidate $candidate
        if ((Get-RunnerState) -or $script:vms.Count -ne 0) { throw 'Builder/verifier session failed publication/owned cleanup.' }
        if (@(Get-ChildItem -LiteralPath (Join-Path $base 'instances') -Directory).Count -ne 0) { throw 'Successful builder/verifier pair retained an instance tree.' }
        Write-Host "PREPARED_TEST_END prepare-verify-pair-$attempt"
    }
    $script:copyRace = ''
    if ($script:keys.Count -ne 4 -or @($script:keys | Select-Object -Unique).Count -ne 4 -or $script:guardians -ne 4 -or
        $script:readiness -ne 4 -or $script:isolation -ne 4 -or $script:natives -ne 8 -or $script:markers -ne 2 -or $script:forcedStops -ne 2) { throw 'Builder/verifier skipped isolation/readiness/fresh identity or used job code.' }
    $before = (Get-FileHash -LiteralPath $selectorPath).Hash; $script:buildFails = $true
    $failureDetail = $null
    try { Invoke-RunnerSession $config $null 'it-inventory-heavy' 'prepare' } catch { $failureDetail = $_.Exception.Data['runnerImagePreparation'] }
    if ($null -eq $failureDetail -or $failureDetail.exitCode -ne 1 -or $failureDetail.stderr.Length -gt 4096 -or
        $failureDetail.stderr -match '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]') { throw 'Credential-free builder failure lost bounded/control-cleaned native diagnostics.' }
    if ((Get-FileHash -LiteralPath $selectorPath).Hash -cne $before -or (Get-RunnerState) -or $script:vms.Count -gt 0) { throw 'Failed builder published or bypassed cleanup.' }
    $retainedFailure=Read-RunnerJson (Join-Path $base 'preparation-image.json')
    Assert-RunnerImageFailureArtifact $retainedFailure
    if ($retainedFailure.exitCode -ne 1 -or $retainedFailure.bundleHash -cne ('F'*64) -or -not $retainedFailure.stderr.StartsWith('fixture prepare error')) { throw 'Builder evidence did not survive cleanup.' }
    $script:buildFails = $false
    function Get-RunnerConfig { return $config }
    function Get-RunnerMemoryAdmission { return [pscustomobject]@{ ready = $true } }
    function Get-ScheduledTask { return [pscustomobject]@{ State = 'Ready' } }
    Set-Item -Path Function:Assert-RunnerControlIdle -Value $script:realControlIdle
    # Execute the actual owner core with both complete credential-free sessions.
    # A verifier boot writes its copy; only the original unbooted candidate wins.
    $config.activation = 'disabled'
    Write-Host 'PREPARED_TEST_BEGIN owner-core-success'
    Invoke-RunnerPrepareImageCore
    $verifiedImage = Get-RunnerImageRecord
    if ([IO.File]::ReadAllText($verifiedImage.path) -match 'booted-clone-marker' -or
        $verifiedImage.receipt.cloneVerification.cleanupVerified -ne $true -or
        $verifiedImage.receipt.cloneVerification.vmId -ceq $verifiedImage.receipt.builder.vmId -or
        $verifiedImage.receipt.cloneVerification.sshPublicKeyHash -ceq $verifiedImage.receipt.builder.sshPublicKeyHash) { throw 'Clone gate selected booted bytes or reused builder identity.' }
    if ($verifiedImage.receipt.cloneVerification.successiveChild.cleanupVerified -ne $true -or
        $verifiedImage.receipt.cloneVerification.successiveChild.markerProof -cne 'absent-then-written' -or
        $verifiedImage.receipt.cloneVerification.successiveChild.parentIdentity -cne $verifiedImage.receipt.cloneVerification.parentIdentity) { throw 'Prepared owner gate omitted successive child isolation under the same parent lease.' }
    $before = (Get-FileHash -LiteralPath $selectorPath).Hash
    Write-Host 'PREPARED_TEST_END owner-core-success'
    if ((Get-RunnerState) -or $script:vms.Count -ne 0 -or @(Get-ChildItem -LiteralPath (Join-Path $base 'instances') -Directory).Count -ne 0) { throw 'Successful owner preparation retained session resources.' }
    foreach ($failure in @('cloud-init', 'docker', 'mtu', 'missing-mtu', 'guardian', 'guardian-after-ready', 'cleanup', 'candidate-tamper')) {
        Write-Host "PREPARED_TEST_BEGIN clone-failure-$failure"
        $script:verifyFailure = $failure
        Assert-Rejected { Invoke-RunnerPrepareImageCore } "clone-$failure"
        if ((Get-FileHash -LiteralPath $selectorPath).Hash -cne $before -or -not (Test-Path (Join-Path $base 'stop.requested'))) { throw 'Failed clone changed selector or resumed pickup.' }
        if ($failure -ceq 'cleanup') {
            if (-not (Get-RunnerState) -or $script:vms.Count -ne 1) { throw 'Uncertain verifier removal did not retain canonical state/VM.' }
            $script:verifyFailure = ''; Remove-RunnerInstance (Get-RunnerState)
        } elseif ((Get-RunnerState) -or $script:vms.Count) { throw 'Verifier failure did not complete canonical cleanup.' }
        # In the cleanup-failure case this runs only after the explicit recovery
        # cleanup above; the retained-state/VM assertion remains authoritative.
        if ((Get-RunnerState) -or $script:vms.Count -ne 0 -or @(Get-ChildItem -LiteralPath (Join-Path $base 'instances') -Directory).Count -ne 0) { throw 'Verifier failure/recovery cleanup retained an instance tree.' }
        $script:verifyFailure = ''
        Write-Host "PREPARED_TEST_END clone-failure-$failure"
    }
    foreach ($point in @('image-builder-cleaned', 'image-clone-ready', 'image-clone-cleaned', 'image-successive-clone-cleaned', 'image-verified-receipt')) {
        Write-Host "PREPARED_TEST_BEGIN clone-interrupt-$point"
        $script:interrupt = $point
        Assert-Rejected { Invoke-RunnerPrepareImageCore } "clone-interrupt-$point"
        $script:interrupt = ''
        if ((Get-FileHash -LiteralPath $selectorPath).Hash -cne $before -or (Get-RunnerState) -or $script:vms.Count -or
            @(Get-ChildItem -LiteralPath (Join-Path $base 'instances') -Directory).Count -ne 0 -or
            @(Get-ChildItem -LiteralPath (Join-Path $base 'prepared-images')).Count -ne 4) { throw 'Interrupted clone gate selected/leaked a candidate or skipped cleanup.' }
        Write-Host "PREPARED_TEST_END clone-interrupt-$point"
    }
    $script:RunnerPreparationAuthorized = $false
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' 'prepare' } 'prepare outside explicit owner control'
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' 'verify-image' $candidate } 'verifier outside explicit owner control'
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' 'verify-image' } 'verifier without candidate'
    Assert-Rejected { Invoke-RunnerSession $config ([pscustomobject]@{ jobId = 1 }) 'it-inventory-heavy' 'verify-image' $candidate } 'verifier carrying pilot claim'
    $verificationState = [pscustomobject]@{ layoutVersion = 2; tag = $script:RunnerTag; purpose = 'verify-image'; vmName = ('ITIR-' + ('a' * 32)); instancePath = (Join-Path (Join-Path $base 'instances') ('ITIR-' + ('a' * 32)))
        imageCandidate = [pscustomobject]@{ id = ('a' * 32); diskHash = ('A' * 64); bindingHash = ('B' * 64); recipeId = ('C' * 64) } }
    Assert-StateIdentity $verificationState
    $verificationState | Add-Member -NotePropertyName claimMode -NotePropertyValue 'active'
    Assert-Rejected { Assert-StateIdentity $verificationState } 'verifier carrying job authorization'
    $verificationState.PSObject.Properties.Remove('claimMode'); $verificationState.PSObject.Properties.Remove('imageCandidate')
    Assert-Rejected { Assert-StateIdentity $verificationState } 'verifier missing protected binding'
    # Same graceful idle protocol refuses an active session before writing Stop;
    # no production task stop API is involved in this path.
    Remove-Item -LiteralPath (Join-Path $base 'stop.requested')
    $active = New-SealedState; $active.purpose = 'job'; Write-RunnerJson $script:RunnerStatePath $active
    Assert-Rejected { Wait-RunnerUpdateIdle } 'active session preparation suspension'
    if (Test-Path -LiteralPath (Join-Path $base 'stop.requested')) { throw 'Preparation suspended an active job before refusal.' }
    Remove-Item -LiteralPath $script:RunnerStatePath
    $script:resumes = 0; $script:coreFails = $false
    function Get-RunnerConfig { return $config }
    function Get-RunnerMemoryAdmission { return [pscustomobject]@{ ready = $true } }
    function Get-ScheduledTask { return [pscustomobject]@{ State = 'Ready' } }
    function Assert-RunnerImageCandidate {}
    function Publish-RunnerPreparedImage {}
    function Remove-RunnerImageCandidate {}
    function Invoke-RunnerSession($Config, $PilotAttempt, $Label, $Purpose, $Candidate) {
        Assert-RunnerPreparationAuthorized
        if ($Purpose -cnotin @('prepare', 'verify-image') -or $Label -cne 'it-inventory-heavy' -or $null -ne $PilotAttempt) { throw 'Owner core changed preparation identity.' }
        if ($script:coreFails) { throw 'Fixture build interruption.' }
        return [pscustomobject]@{ fixture = $true }
    }
    function Start-RunnerSupervisorCore {
        if ($script:RunnerPreparationAuthorized -ne $false) { throw 'Pickup resumed before preparation authority was cleared.' }
        $script:resumes++; Remove-Item -LiteralPath (Join-Path $base 'stop.requested')
    }
    foreach ($mode in @('active', 'stopped', 'disabled', 'failed')) {
        Write-Host "PREPARED_TEST_BEGIN owner-intent-$mode"
        $config.activation = if ($mode -ceq 'disabled') { 'disabled' } else { 'active' }
        $script:coreFails = $mode -ceq 'failed'
        if (Test-Path -LiteralPath (Join-Path $base 'stop.requested')) { Remove-Item -LiteralPath (Join-Path $base 'stop.requested') }
        if ($mode -ceq 'stopped') { [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop') }
        if ($script:coreFails) { Assert-Rejected { Invoke-RunnerPrepareImageCore } 'owner core interrupted build' }
        else { Invoke-RunnerPrepareImageCore }
        if ($script:RunnerPreparationAuthorized -ne $false -or ((Test-Path -LiteralPath (Join-Path $base 'stop.requested')) -ne ($mode -cne 'active'))) { throw 'Owner preparation did not preserve stop state or revoke preparation authority.' }
        Write-Host "PREPARED_TEST_END owner-intent-$mode"
    }
    if ($script:resumes -ne 1) { throw 'Preparation auto-resumed stopped/inactive/failed pickup.' }
    Write-Host 'Prepared image passed: credential-free guarded builder plus fresh prepared clone gate; original unbooted selection; readiness/guardian/cleanup/hash failure and interruption refusal; proof/purpose/claim boundaries; old selector/Stop preservation; copy mutex races, corruption/ACL/reparse/offline/reference checks and original resume behavior.'
} finally {
    Close-RunnerImageLeases
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -cnotmatch '^ITIR-image-[0-9a-f]{32}$') { throw 'Unexpected image fixture cleanup path.' }
    $links = @(Get-ChildItem -LiteralPath $base -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    foreach ($link in $links) { [IO.Directory]::Delete($link.FullName) }
    Remove-Item -LiteralPath $base -Recurse -Force
}
