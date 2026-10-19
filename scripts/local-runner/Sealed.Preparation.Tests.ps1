# Actual guardian/watchdog/liveness functions; TEMP proof and provider fixtures.
# No live VM, disk, credential, host network or installed state is modified.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-sealed-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory((Join-Path $root 'bin'))
$script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
$inputs = Read-RunnerJson (Join-Path $PSScriptRoot 'Image.Inputs.json')
Write-RunnerJson (Join-Path (Join-Path $root 'bin') 'Image.Inputs.json') $inputs
$guest = [pscustomobject]@{ schema = 1; recipeId = 'B' * 64; scrubbed = $true; capabilities = @('os-prerequisites', 'node-toolcache', 'npm-cache', 'playwright', 'supabase-images')
    images = @($inputs.images | ForEach-Object { $image = $_; [pscustomobject]@{ source = $image.source; reference = $image.candidates[0]; id = 'sha256:' + ('a' * 64); digests = @('sha256:' + ('b' * 64))
        aliases = @($(if ($image.PSObject.Properties.Name -contains 'aliases') { $image.aliases }) | ForEach-Object { [pscustomobject]@{ reference = $_; id = 'sha256:' + ('a' * 64) } }) } }) }
$script:checks = 0
function Check($Name, [scriptblock] $Work) { & $Work; if ($script:fixtureStateDepth -ne 0 -or $script:locked) { throw 'Integration case leaked state recursion.' }; $script:checks++; Write-Host "PASS $Name" }
function Refuse([scriptblock] $Work) { $rejected = $false; try { & $Work | Out-Null } catch { $rejected = $true }; if (-not $rejected) { throw 'Unsafe sealed supervision accepted.' } }
# Windows state mutex recursion must retain locked=true until the outer release.
$script:fixtureStateDepth = 0
function Enter-RunnerLock { $script:fixtureStateDepth++; $script:locked = $true; return 'fixture' }
function Exit-RunnerLock {
    if ($script:fixtureStateDepth -le 0) { throw 'Unbalanced fixture state release.' }
    $script:fixtureStateDepth--; $script:locked = $script:fixtureStateDepth -gt 0
}
$fixtureOuter = Enter-RunnerLock; $fixtureInner = Enter-RunnerLock
Exit-RunnerLock $fixtureInner
if (-not $script:locked) { throw 'Nested state release exposed locked IO.' }
Exit-RunnerLock $fixtureOuter
if ($script:locked -or $script:fixtureStateDepth -ne 0) { throw 'State fixture did not balance.' }
function Get-RunnerState { return $script:state }
function Write-RunnerJson($Path, $Value) { if ($Path -ceq $script:RunnerStatePath) { $script:state = $Value } }
function Get-RunnerRecoveryNow { $script:now }
function Test-RunnerProcessIdentity($Id, $Started) { return $Id -notin $script:deadPids }
function Assert-Administrator {}
function Assert-SecureRoot {}
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) }
function Get-RunnerConfig { [pscustomobject]@{} }
function Get-RunnerVmInventory { if ($script:inventoryFailed) { throw 'Authoritative inventory unavailable.' }; return $script:vms }
function Get-VMHardDiskDrive($VM) { @($VM.disks | ForEach-Object { [pscustomobject]@{ Path = $_ } }) }
function Get-VM { $script:vmQueries++; throw 'Absent sealed VM must not enter ordinary Get-VM.' }
function Get-RunnerNetworkObservation { $script:observations++; throw 'Sealed copy does not need network inspection.' }
function Remove-RunnerInstance($State) { $script:cleanups++; $script:state = $null }
function Invoke-RunnerSupervisorRecovery {}
function Start-Sleep { throw 'Sealed liveness must not wait for normal network recovery.' }
function New-Fixture {
    if ($script:fixtureStateDepth -ne 0) { throw 'Previous fixture leaked state recursion.' }
    $script:now = [DateTime]::UtcNow; $script:deadPids = @(); $script:locked = $false; $script:inventoryFailed = $false
    $script:vms = @(); $script:vmQueries = 0; $script:observations = 0; $script:cleanups = 0; $script:RunnerRecoveryProbe = $null; $script:RunnerGuardOutcome = $null
    $script:state = [pscustomobject]@{ tag = $script:RunnerTag; vmName = 'ITIR-' + ('a' * 32); vmId = '00000000-0000-0000-0000-000000000001'
        instancePath = Join-Path $root ('ITIR-' + ('a' * 32)); purpose = 'prepare'; phase = 'sealed-off'; supervisorPid = 42; supervisorStartUtc = $script:now.ToString('o')
        guardianPid = $PID; guardianStartUtc = $script:now.ToString('o'); guardianReady = $true; deadlineUtc = $script:now.AddMinutes(10).ToString('o'); heartbeatUtc = $script:now.ToString('o') }
    [void][IO.Directory]::CreateDirectory($script:state.instancePath)
    $script:state | Add-Member imageScrubProof (Get-RunnerJsonEvidence $guest)
    $binding = [pscustomobject]@{ vmId = $script:state.vmId; vmName = $script:state.vmName; claimHash = Get-RunnerRecoveryClaimHash $script:state }
    $r = New-RunnerNetworkRecovery $binding ('a' * 64) $script:now.AddMinutes(10) $script:now
    $r.generation = 3; $r.phase = 'sealed-preparation'
    $script:state | Add-Member networkRecovery $r
    $script:state | Add-Member imageSealBinding (Get-RunnerJsonEvidence ([ordered]@{ schema = 1; generation = 3; bindingHash = 'A' * 64; recipeId = $guest.recipeId; bundleHash = 'F' * 64; scrubProofHash = $script:state.imageScrubProof.hash }))
}
try {
    Check 'liveness evaluates fresh guardian progress after heartbeat and state read' {
        New-Fixture
        $script:originalHeartbeat = (Get-Command Save-Heartbeat).ScriptBlock
        function Save-Heartbeat($State) {
            & $script:originalHeartbeat $State
            $script:state.networkRecovery.progressUtc = $script:now.AddMilliseconds(1).ToString('o')
            $script:now = $script:now.AddMilliseconds(2)
        }
        try {
            Assert-SessionAlive $script:state
            if ($script:cleanups -ne 0 -or $script:locked) { throw 'Fresh sealed progress lost supervision.' }
        } finally { Set-Item Function:Save-Heartbeat $script:originalHeartbeat }
    }
    Check 'fresh evaluation still refuses future progress expiry and cancellation during heartbeat' {
        $script:originalHeartbeat = (Get-Command Save-Heartbeat).ScriptBlock
        foreach ($failure in @('future', 'progress-expired', 'hard-deadline', 'fresh-deadline', 'stop', 'healthy-deadline', 'healthy-stop')) {
            New-Fixture
            if ($failure -clike 'healthy-*') { $script:state.phase = 'owned'; $script:state.networkRecovery.phase = 'healthy' }
            $originalState = $script:state | ConvertTo-Json -Depth 100 | ConvertFrom-Json
            $script:heartbeatFailure = $failure
            function Save-Heartbeat($State) {
                & $script:originalHeartbeat $State
                switch ($script:heartbeatFailure) {
                    'future' { $script:state.networkRecovery.progressUtc = $script:now.AddMilliseconds(1).ToString('o') }
                    'progress-expired' { $script:now = $script:now.AddSeconds(31) }
                    { $_ -cin @('hard-deadline', 'healthy-deadline') } { $script:now = $script:now.AddMinutes(11) }
                    'fresh-deadline' { $script:state.deadlineUtc = $script:now.AddMilliseconds(1).ToString('o'); $script:now = $script:now.AddMilliseconds(2) }
                    { $_ -cin @('stop', 'healthy-stop') } { [IO.File]::WriteAllText((Join-Path $script:state.instancePath 'stop.requested'), '') }
                }
            }
            try {
                Refuse { Assert-SessionAlive $originalState }
                if ($script:locked -or $script:vmQueries -ne 0 -or $script:observations -ne 0) { throw 'Rejected liveness entered ordinary recovery or retained mutex.' }
            } finally {
                Set-Item Function:Save-Heartbeat $script:originalHeartbeat
                $marker = Join-Path $originalState.instancePath 'stop.requested'
                if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
            }
        }
    }
    Check 'repeated actual guardian ticks supervise absent sealed VM and refresh progress' {
        New-Fixture
        foreach ($unused in 1..4) {
            $script:now = $script:now.AddSeconds(5)
            if (-not (Invoke-GuardCheck $script:state.vmName)) { throw 'Sealed guard stopped.' }
            if ($script:state.networkRecovery.progressUtc -cne $script:now.ToString('o') -or -not $script:state.guardianReady) { throw 'Sealed progress/readiness lost.' }
        }
        Assert-SessionAlive $script:state; Invoke-Watchdog
        if ($script:cleanups -ne 0 -or $script:vmQueries -ne 0 -or $script:observations -ne 0 -or $script:locked) { throw 'Sealed supervision looked up removed VM, repaired network or removed instance.' }
    }
    Check 'stale network outcome and probe are fenced by the committed seal' {
        New-Fixture; $r = $script:state.networkRecovery
        if (Test-RunnerRecoveryGeneration $script:state $r.binding $r.generation '') { throw 'Sealed state admitted any provider generation.' }
        $outcome = [pscustomobject]@{ generation = 2; operation = 'resume'; success = $true }
        $tick = Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}) $outcome
        if (-not $tick.continue -or $null -ne $tick.outcome -or $r.generation -ne 3 -or $r.phase -cne 'sealed-preparation') { throw 'Old outcome advanced sealed state.' }
        $script:drained = $false
        $job = [pscustomobject]@{}
        $job | Add-Member ScriptMethod CancelAndDrain { $script:drained = $true }
        $script:RunnerRecoveryProbe = [pscustomobject]@{ binding = $r.binding; generation = 2; job = $job; resultPath = Join-Path $root 'obsolete-probe.json' }
        [void](Invoke-RunnerNetworkRecoveryTick $script:state.vmName ([pscustomobject]@{}))
        if (-not $script:drained -or $null -ne $script:RunnerRecoveryProbe) { throw 'Obsolete probe was not cancelled before sealed supervision.' }
    }
    Check 'invalid sealed identity proof ownership absence or reference fails closed' {
        foreach ($failure in @('job', 'verifier', 'proof', 'binding', 'generation', 'owner', 'guardian', 'deadline', 'progress', 'inventory', 'vm-reappeared', 'reference', 'stop')) {
            New-Fixture; $original = $script:state
            switch ($failure) {
                'job' { $script:state.purpose = 'job' }
                'verifier' { $script:state.purpose = 'verify-image'; $script:state | Add-Member imageCandidate ([pscustomobject]@{ id = 'a' * 32; diskHash = 'A' * 64; bindingHash = 'B' * 64; recipeId = 'C' * 64 }) }
                'proof' { $script:state.imageScrubProof.hash = '0' * 64 }
                'binding' { $script:state.networkRecovery.binding.claimHash = 'b' * 64 }
                'generation' { $script:state.networkRecovery.generation++ }
                'owner' { $script:deadPids = @(42) }
                'guardian' { $script:deadPids = @($PID) }
                'deadline' { $script:now = $script:now.AddMinutes(11) }
                'progress' { $script:now = $script:now.AddSeconds(31) }
                'inventory' { $script:inventoryFailed = $true }
                'vm-reappeared' { $script:vms = @([pscustomobject]@{ Name = $script:state.vmName; Id = [guid]$script:state.vmId }) }
                'reference' { $script:vms = @([pscustomobject]@{ Name = 'other'; Id = [guid]::NewGuid(); Path = Join-Path $root 'other'; disks = @((Join-Path $script:state.instancePath 'guest.vhdx')) }) }
                'stop' { [IO.File]::WriteAllText((Join-Path $script:state.instancePath 'stop.requested'), '') }
            }
            try {
                Refuse { Invoke-RunnerNetworkRecoveryTick $original.vmName ([pscustomobject]@{}) }
                Refuse { Assert-SessionAlive $original }
                Invoke-Watchdog
                if ($script:cleanups -ne 1 -or $null -ne $script:state -or $script:vmQueries -ne 0 -or $script:locked) { throw 'Invalid sealed state bypassed canonical watchdog cleanup.' }
            } finally { $marker = Join-Path $original.instancePath 'stop.requested'; if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker } }
        }
    }
    Check 'actual Guard failure handler cleans up invalid sealed proof' {
        New-Fixture; $script:state.imageScrubProof.hash = '0' * 64
        $SessionName = $script:state.vmName
        $dispatch = $ast.Find({ param($n) $n -is [Management.Automation.Language.SwitchStatementAst] -and $n.Condition.Extent.Text -ceq '$Action' }, $true)
        $body = @($dispatch.Clauses | Where-Object { $_.Item1.Value -ceq 'Guard' })[0].Item2.Extent.Text
        Refuse { & ([scriptblock]::Create($body.Substring(1, $body.Length - 2))) }
        if ($script:cleanups -ne 1 -or $null -ne $script:state -or $script:vmQueries -ne 0 -or $script:locked) { throw 'Guard failure bypassed exact canonical cleanup.' }
    }
    Write-Host "Sealed preparation offline regressions passed: $script:checks groups; no live copy or Hyper-V proof."
} finally {
    $absolute = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($absolute).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($absolute) -cnotmatch '^ITIR-sealed-[0-9a-f]{32}$') { throw 'Sealed fixture cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $absolute -Recurse -Force
}
