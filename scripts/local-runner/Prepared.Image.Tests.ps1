# Offline lifecycle regressions. Hyper-V/network/credential calls are fixtures;
# atomic image files and protected-state transitions use the real implementation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
foreach ($file in @('Runner.ps1', 'Update.ps1')) {
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$null, [ref]$null)
    foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
}
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-image-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
$script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1', [switch] $FailFast) {
    return & $script:realEnter ('Local\' + [IO.Path]::GetFileName($base) + '-' + $Name.Replace('\', '-')) -FailFast:$FailFast
}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Prepared-image fixture accepted $Case." }
}
$script:blocked = ''; $script:interrupt = ''; $script:attached = $false; $script:vms = @()
$script:binding = [pscustomobject]@{ hash = ('A' * 64); recipeId = ('B' * 64) }
$script:guest = [pscustomobject]@{ schema = 1; recipeId = $script:binding.recipeId; scrubbed = $true; capabilities = @('os-prerequisites', 'node-toolcache', 'npm-cache', 'playwright', 'supabase-images') }
$config = [pscustomobject]@{ activation = 'disabled'; label = 'it-inventory-ephemeral'; maxMinutes = 120; guestIp = 'fixture'; baseVhdx = (Join-Path $base 'base.vhdx'); baseSha256 = ('C' * 64) }
[IO.File]::WriteAllText($config.baseVhdx, 'generic-clean-base')
function Assert-Administrator {}
function Assert-SecureRoot {}
function Assert-RunnerProtectedPath([string] $Path) { [void](Assert-OwnedPath $Path); if ($Path -ceq $script:blocked) { throw 'Fixture ACL refusal.' } }
function Get-RunnerImageBinding { return $script:binding }
function Get-CoherentInstalledRunnerBundle { return [pscustomobject]@{ fixture = $true } }
function Get-RunnerVmInventory { return $script:vms }
function Get-VHD { return [pscustomobject]@{ Attached = $script:attached } }
function Get-VMHardDiskDrive($VM) { return @($VM.disks | ForEach-Object { [pscustomobject]@{ Path = $_ } }) }
function Invoke-RunnerTransitionCheckpoint([string] $Name) { if ($Name -ceq $script:interrupt) { throw "Fixture interrupted $Name." } }
function New-SealedState {
    $name = 'ITIR-' + [guid]::NewGuid().ToString('N')
    $instance = Join-Path (Join-Path $base 'instances') $name
    [void][IO.Directory]::CreateDirectory($instance)
    [IO.File]::WriteAllText((Join-Path $instance 'guest.vhdx'), ('scrubbed-' + $name))
    $state = [pscustomobject]@{ tag = $script:RunnerTag; vmName = $name; vmId = [guid]::NewGuid().ToString(); instancePath = $instance
        purpose = 'prepare'; phase = 'sealed-off'; imageScrubProof = Get-RunnerJsonEvidence $script:guest
        deadlineUtc = [DateTime]::UtcNow.AddMinutes(2).ToString('o'); heartbeatUtc = [DateTime]::UtcNow.ToString('o') }
    Write-RunnerJson $script:RunnerStatePath $state
    return $state
}
try {
    if ((Get-RunnerImageSelection $config).reason -cne 'absent') { throw 'Absent prepared image did not use generic fallback.' }
    [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop')
    $state = New-SealedState
    Assert-Rejected { Publish-RunnerPreparedImage $state $config $script:binding $script:guest } 'non-owner invocation'
    $script:RunnerPreparationAuthorized = $true
    foreach ($purpose in @('job', 'invalid')) {
        $state.purpose = $purpose
        Assert-Rejected { Publish-RunnerPreparedImage $state $config $script:binding $script:guest } 'job/unknown-purpose publication'
    }
    $state.purpose = 'prepare'
    $state | Add-Member -NotePropertyName claimMode -NotePropertyValue 'active'
    Assert-Rejected { Assert-StateIdentity $state } 'prepare carrying job authorization'
    $state.PSObject.Properties.Remove('claimMode')
    $state.phase = 'owned'; Write-RunnerJson $script:RunnerStatePath $state
    Assert-Rejected { Publish-RunnerPreparedImage $state $config $script:binding $script:guest } 'no committed off/scrub proof'
    $state.phase = 'sealed-off'; Write-RunnerJson $script:RunnerStatePath $state
    Publish-RunnerPreparedImage $state $config $script:binding $script:guest
    $initial = Get-RunnerImageRecord
    if ((Get-RunnerImageSelection $config).prepared -ne $true) { throw 'Matching sealed image was not selected.' }
    $initialSelectorHash = (Get-FileHash -LiteralPath (Join-Path $base 'prepared-image.json')).Hash
    # Recoverable interruption keeps old selection; selector is always the last commit.
    foreach ($point in @('image-copy', 'image-receipt')) {
        $state = New-SealedState; $script:interrupt = $point
        Assert-Rejected { Publish-RunnerPreparedImage $state $config $script:binding $script:guest } $point
        $script:interrupt = ''
        if ((Get-FileHash -LiteralPath (Join-Path $base 'prepared-image.json')).Hash -cne $initialSelectorHash -or
            @(Get-ChildItem -LiteralPath (Join-Path $base 'prepared-images')).Count -ne 2) { throw 'Interrupted publication changed selection or left an unowned candidate.' }
    }
    $state = New-SealedState; $script:interrupt = 'image-selector'
    Assert-Rejected { Publish-RunnerPreparedImage $state $config $script:binding $script:guest } 'post-commit interruption'
    $script:interrupt = ''
    $second = Get-RunnerImageRecord
    if ($second.selector.previous -cne $initial.selector.id -or -not (Test-Path -LiteralPath $second.path)) { throw 'Committed selector interruption removed selected disk/prior history.' }
    $state = New-SealedState
    Publish-RunnerPreparedImage $state $config $script:binding $script:guest
    if (@(Get-ChildItem -LiteralPath (Join-Path $base 'prepared-images')).Count -ne 4 -or (Test-Path -LiteralPath $initial.path)) { throw 'Retention did not keep selected and one prior image.' }
    $current = Get-RunnerImageRecord
    $script:binding = [pscustomobject]@{ hash = ('D' * 64); recipeId = ('E' * 64) }
    if ((Get-RunnerImageSelection $config).reason -cne 'stale-inputs') { throw 'Changed trusted pins did not fall back to generic.' }
    [IO.File]::AppendAllText($current.path, 'tamper')
    Assert-Rejected { Get-RunnerImageSelection $config } 'corrupt stale image cannot fall back'
    [IO.File]::WriteAllText($current.path, [IO.File]::ReadAllText((Join-Path $state.instancePath 'guest.vhdx')))
    $script:binding = [pscustomobject]@{ hash = ('A' * 64); recipeId = ('B' * 64) }
    $script:blocked = $current.path
    Assert-Rejected { Get-RunnerImageSelection $config } 'disk ACL mismatch'
    $script:blocked = ''
    $script:attached = $true
    Assert-Rejected { Get-RunnerImageSelection $config } 'mounted selected image'
    $script:attached = $false
    $script:vms = @([pscustomobject]@{ Name = 'Other'; Id = [guid]::NewGuid(); Path = (Join-Path $base 'other'); disks = @($current.path) })
    Assert-Rejected { Get-RunnerImageSelection $config } 'referenced selected image'
    Assert-Rejected { Publish-RunnerPreparedImage $state $config $script:binding $script:guest } 'referenced retained image'
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
    }

    # Actual preparation session runs creation/guard/readiness and cleanup while
    # all token, runner archive, GitHub and JIT paths are fatal fixture sentinels.
    if (Test-Path -LiteralPath $script:RunnerStatePath) { Remove-Item -LiteralPath $script:RunnerStatePath }
    foreach ($name in @('Set-VMProcessor', 'Set-VMMemory', 'Assert-RunnerVmResources', 'Set-VMFirmware', 'Disable-VMIntegrationService', 'Assert-RunnerGuestMac', 'Assert-AdapterRules', 'Test-GuestIsolation', 'Assert-RunnerVmLifecycle')) { Set-Item -Path "Function:$name" -Value {} }
    function Assert-InstalledHost($Config, [switch] $ForPreparation) { if (-not $ForPreparation) { throw 'Preparation used job host authorization.' } }
    function Get-OwnerToken { throw 'Preparation attempted credential decryption.' }
    function Get-RunnerArchive { throw 'Preparation attempted runner download.' }
    function Invoke-GitHub { throw 'Preparation attempted GitHub/JIT registration.' }
    function Get-VM([string] $Name) { return @($script:vms | Where-Object Name -CEQ $Name)[0] }
    function New-RunnerProfileVm($Name, $Disk, $Instance, $ProfileLabel) {
        if ($ProfileLabel -cne 'it-inventory-heavy') { throw 'Preparation changed fixed resource caps.' }
        $vm = [pscustomobject]@{ Id = [guid]::NewGuid(); Name = $Name; Notes = ''; State = 'Off'; Path = (Join-Path $Instance $Name); disks = @($Disk) }
        $script:vms = @($vm); return $vm
    }
    function Set-VM($Name, $Notes) { (Get-VM $Name).Notes = $Notes }
    function Get-VMIntegrationService { return @() }
    function Set-RunnerGuestMac { return [pscustomobject]@{ rawMac = '020000000001'; seedMac = '02:00:00:00:00:01' } }
    function Get-HostNetworkFingerprint { return 'fixture' }
    function Set-IsolatedAdapter { $script:isolation++; return @() }
    function Start-SessionGuardian { $script:guardians++ }
    function Start-GuardedVm($State) { (Get-VM $State.vmName).State = 'Running' }
    function Wait-Guest { $script:readiness++ }
    function New-RunnerSshKey([string] $Path) { [IO.File]::WriteAllText(($Path + '.pub'), ('key-' + [guid]::NewGuid().ToString('N'))) }
    function New-SeedDisk($Path, $PublicKey, $Mac, $Config, $ProfileLabel, $Prepared) {
        if ($Prepared -or $PublicKey -cnotmatch '^key-[0-9a-f]{32}$') { throw 'Builder reused prepared source/key.' }
        [IO.File]::WriteAllText($Path, 'seed'); $script:keys += $PublicKey
    }
    function Add-VMHardDiskDrive($VMName, $Path) { (Get-VM $VMName).disks += $Path }
    function Remove-VM($VM, [switch] $Force) { $script:vms = @($script:vms | Where-Object Id -NE $VM.Id) }
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
            return [pscustomobject]@{ ExitCode = $(if ($script:buildFails) { 1 } else { 0 }); Output = (ConvertTo-Json -InputObject $script:guest -Compress); ErrorOutput = (('fixture' + [char]1 + ' prepare error ') + ('x' * 5000)) }
        }
        return 0
    }
    $script:keys = @(); $script:forcedStops = 0; $script:guardians = 0; $script:readiness = 0; $script:isolation = 0; $script:natives = 0; $script:buildFails = $false
    foreach ($attempt in @(1, 2)) {
        $outcome = Invoke-RunnerSession $config $null 'it-inventory-heavy' 'prepare'
        if ($outcome.outcome -cne 'image-prepared' -or (Get-RunnerState) -or $script:vms.Count -ne 0) { throw 'Preparation session failed publication/owned cleanup.' }
    }
    if ($script:keys.Count -ne 2 -or $script:keys[0] -ceq $script:keys[1] -or $script:guardians -ne 2 -or
        $script:readiness -ne 2 -or $script:isolation -ne 2 -or $script:natives -ne 6 -or $script:forcedStops -ne 0) { throw 'Builder skipped isolation/readiness/fresh identity or required forced shutdown.' }
    $before = (Get-FileHash -LiteralPath $selectorPath).Hash; $script:buildFails = $true
    $failureDetail = $null
    try { Invoke-RunnerSession $config $null 'it-inventory-heavy' 'prepare' } catch { $failureDetail = $_.Exception.Data['runnerImagePreparation'] }
    if ($null -eq $failureDetail -or $failureDetail.exitCode -ne 1 -or $failureDetail.stderr.Length -gt 4096 -or
        $failureDetail.stderr -match '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]') { throw 'Credential-free builder failure lost bounded/control-cleaned native diagnostics.' }
    if ((Get-FileHash -LiteralPath $selectorPath).Hash -cne $before -or (Get-RunnerState) -or $script:vms.Count -gt 0) { throw 'Failed builder published or bypassed cleanup.' }
    $script:RunnerPreparationAuthorized = $false
    Assert-Rejected { Invoke-RunnerSession $config $null 'it-inventory-heavy' 'prepare' } 'prepare outside explicit owner control'
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
    function Invoke-RunnerSession($Config, $PilotAttempt, $Label, $Purpose) {
        Assert-RunnerPreparationAuthorized
        if ($Purpose -cne 'prepare' -or $Label -cne 'it-inventory-heavy' -or $null -ne $PilotAttempt) { throw 'Owner core changed preparation identity.' }
        if ($script:coreFails) { throw 'Fixture build interruption.' }
    }
    function Start-RunnerSupervisorCore {
        if ($script:RunnerPreparationAuthorized -ne $false) { throw 'Pickup resumed before preparation authority was cleared.' }
        $script:resumes++; Remove-Item -LiteralPath (Join-Path $base 'stop.requested')
    }
    foreach ($mode in @('active', 'stopped', 'disabled', 'failed')) {
        $config.activation = if ($mode -ceq 'disabled') { 'disabled' } else { 'active' }
        $script:coreFails = $mode -ceq 'failed'
        if (Test-Path -LiteralPath (Join-Path $base 'stop.requested')) { Remove-Item -LiteralPath (Join-Path $base 'stop.requested') }
        if ($mode -ceq 'stopped') { [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop') }
        if ($script:coreFails) { Assert-Rejected { Invoke-RunnerPrepareImageCore } 'owner core interrupted build' }
        else { Invoke-RunnerPrepareImageCore }
        if ($script:RunnerPreparationAuthorized -ne $false -or ((Test-Path -LiteralPath (Join-Path $base 'stop.requested')) -ne ($mode -cne 'active'))) { throw 'Owner preparation did not preserve stop state or revoke preparation authority.' }
    }
    if ($script:resumes -ne 1) { throw 'Preparation auto-resumed stopped/inactive/failed pickup.' }
    Write-Host 'Prepared image passed: actual credential-free guarded builder, atomic copy/receipt/selector interruptions, retained old image, corruption/ACL/reparse/offline/reference refusal, stale/absent fallback, fresh seed keys, failed-build cleanup, active-job refusal and original active/stopped/inactive/failure resume behavior.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -cnotmatch '^ITIR-image-[0-9a-f]{32}$') { throw 'Unexpected image fixture cleanup path.' }
    $links = @(Get-ChildItem -LiteralPath $base -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    foreach ($link in $links) { [IO.Directory]::Delete($link.FullName) }
    Remove-Item -LiteralPath $base -Recurse -Force
}
