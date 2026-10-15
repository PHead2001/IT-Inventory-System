# Actual source functions, protected TEMP journal, synthetic API/provider data.
# No credentials, GitHub calls, installed host, Hyper-V or guest writes.
param([string] $CandidateRoot = $PSScriptRoot, [switch] $ControllerRestartOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $CandidateRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Network.Recovery.ps1')
. (Join-Path $CandidateRoot 'Update.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $CandidateRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-jit-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$script:RunnerRoot = $root; $script:RunnerStatePath = Join-Path $root 'state.json'
$config = [pscustomobject]@{ repo = 'example/fixture'; activation = 'active'; label = 'it-inventory-ephemeral'; runnerGroupId = 1 }
$script:checks = 0; $script:locked = $false
function Check($Name, [scriptblock] $Work) { if ($ControllerRestartOnly -and $Name -cne 'native process exit after durable intent retains barrier through restart cleanup') { return }; & $Work; if ($script:fixtureStateDepth -ne 0 -or $script:locked) { throw 'JIT case leaked state recursion.' }; $script:checks++; Write-Host "PASS $Name" }
function Refuse([scriptblock] $Work) { $rejected = $false; try { & $Work | Out-Null } catch { $rejected = $true }; if (-not $rejected) { throw 'Unsafe JIT registration accepted.' } }
function Refuse-Barrier([scriptblock] $Work) { $message = ''; try { & $Work | Out-Null } catch { $message = $_.Exception.Message }; if ($message -cnotmatch '^Unresolved JIT registration blocks') { throw 'Expected durable registration admission refusal was not observed.' } }
$script:fixtureStateDepth = 0
function Enter-RunnerLock([string] $Name = 'Global\ITInventoryLocalRunner-v1') {
    if ($Name -ceq 'Global\ITInventoryLocalRunner-Supervisor-v1') {
        if ($script:fixtureStateDepth -gt 0) { throw 'Lifetime acquisition inside state lock.' }
        return 'lifetime'
    }
    $script:fixtureStateDepth++; $script:locked = $true; return 'fixture'
}
function Exit-RunnerLock($Mutex) {
    if ($Mutex -ceq 'fixture') {
        if ($script:fixtureStateDepth -le 0) { throw 'Unbalanced JIT state release.' }
        $script:fixtureStateDepth--; $script:locked = $script:fixtureStateDepth -gt 0
    }
}
$fixtureOuter = Enter-RunnerLock; $fixtureInner = Enter-RunnerLock
Exit-RunnerLock $fixtureInner
if (-not $script:locked) { throw 'Nested state release exposed remote IO.' }
Refuse { Enter-RunnerLock 'Global\ITInventoryLocalRunner-Supervisor-v1' }
Exit-RunnerLock $fixtureOuter
if ($script:locked -or $script:fixtureStateDepth -ne 0) { throw 'JIT state fixture did not balance.' }
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) }
function Assert-Administrator {}
function Assert-SecureRoot {}
function Assert-RunnerControlIdle {}
function Get-OwnerToken { return 'SENTINEL_PAT' }
function Get-RunnerConfig {
    if ($script:liveRepo) { $fresh = $config | ConvertTo-Json | ConvertFrom-Json; $fresh.repo = $script:liveRepo; return $fresh }
    return $config
}
function Get-CoherentInstalledRunnerBundle { $script:coherenceChecks++; return [pscustomobject]@{} }
function Get-ScheduledTask { return $script:task }
function Start-ScheduledTask { $script:starts++; $script:task.State = 'Running' }
function Start-Sleep { $script:pollBoundary++; throw 'Bounded fixture poll boundary.' }
function Get-RunnerMemoryAdmission { throw 'Unresolved registration reached memory/demand admission.' }
function Get-RunnerVmInventory { if ($script:inventoryFailed) { throw 'Provider uncertain.' }; return $script:vms }
function Get-VMHardDiskDrive($VM) { return @($VM.disks | ForEach-Object { [pscustomobject]@{ Path = $_ } }) }
function Get-VHD($Path) {
    if ($null -eq $script:state -or $Path -ine (Join-Path $script:state.instancePath 'guest.vhdx')) { throw 'Disk lookup escaped the fixed reconciliation fixture.' }
    return [pscustomobject]@{ VhdType = 'Dynamic'; ParentPath = '' }
}
function Invoke-RunnerTransitionCheckpoint($Name) { if ($Name -ceq $script:interrupt) { throw 'Simulated process interruption.' } }
function Invoke-GitHub($Uri, $Method, $Body, $Token) {
    if ($script:locked -or $null -ne $Body -or $Token -cne 'SENTINEL_PAT') { throw 'Remote IO escaped its fixed reconciliation contract.' }
    if ($script:apiError) { throw 'SENTINEL_API_SECRET: transport unavailable.' }
    if ($Method -ceq 'GET' -and $Uri -ceq 'https://api.github.com/repos/example/fixture/actions/runners?per_page=100') {
        $script:reads++
        if ($script:readEffect -and $script:reads -eq 1) { & $script:readEffect }
        $snapshot = [pscustomobject]@{ total_count = $script:total; runners = $script:runners } | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        # Remote state advances independently after the first returned snapshot.
        # The old caller retains that stale copy through local proof work.
        if ($script:afterSnapshotEffect -and $script:reads -eq 1) { & $script:afterSnapshotEffect }
        return $snapshot
    }
    if ($Method -ceq 'DELETE' -and $Uri -ceq 'https://api.github.com/repos/example/fixture/actions/runners/123') {
        $script:deletes++
        $script:runners = @(); $script:total = 0
        if ($script:deleteLost) { throw 'SENTINEL_API_SECRET: DELETE response lost.' }
        if ($script:deleteEffect) { & $script:deleteEffect }
        return $null
    }
    throw 'Unexpected API operation.'
}
function New-Fixture {
    if ($script:fixtureStateDepth -ne 0) { throw 'Previous JIT fixture leaked state recursion.' }
    foreach ($name in @('jit-registration.json', 'state.json', 'stop.requested', 'pilot-attempt.json')) {
        $path = Join-Path $root $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
    $script:locked = $false; $script:interrupt = ''; $script:vms = @(); $script:inventoryFailed = $false
    $script:runners = @(); $script:total = 0; $script:reads = 0; $script:deletes = 0; $script:apiError = $false; $script:deleteLost = $false; $script:readEffect = $null; $script:deleteEffect = $null
    $script:afterSnapshotEffect = $null; $script:starts = 0; $script:coherenceChecks = 0; $script:pollBoundary = 0; $script:task = [pscustomobject]@{ State = 'Ready' }
    $script:liveRepo = ''
    Write-RunnerJson (Join-Path $root 'credential.dpapi') ([ordered]@{ tag = $script:RunnerTag; scope = 'LocalMachine'; ciphertext = 'ZmFrZQ==' })
    $now = [DateTime]::UtcNow; $started = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    $script:state = [pscustomobject]@{ tag = $script:RunnerTag; purpose = 'job'; claimMode = 'active'; resourceLabel = 'it-inventory-heavy'
        vmName = 'ITIR-' + ('a' * 32); vmId = '00000000-0000-0000-0000-000000000001'; instancePath = Join-Path $root ('ITIR-' + ('a' * 32))
        supervisorPid = $PID; supervisorStartUtc = $started; guardianPid = $PID; guardianStartUtc = $started; guardianReady = $true; deadlineUtc = $now.AddMinutes(5).ToString('o') }
    $binding = [pscustomobject]@{ vmId = $script:state.vmId; vmName = $script:state.vmName; claimHash = Get-RunnerRecoveryClaimHash $script:state }
    $script:state | Add-Member networkRecovery (New-RunnerNetworkRecovery $binding ('a' * 64) $now.AddMinutes(5) $now)
    [void][IO.Directory]::CreateDirectory($script:state.instancePath)
    Write-RunnerJson $script:RunnerStatePath $script:state
    [void](Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state) -Config $config)
}
function Abandon-Fixture { Remove-RunnerInstance (Get-RunnerState) }
function Add-OfflineRunner {
    $script:runners = @([pscustomobject]@{ id = 123; name = $script:state.vmName; status = 'offline'; busy = $false; labels = @('self-hosted', 'Linux', 'X64', 'it-inventory-heavy' | ForEach-Object { [pscustomobject]@{ name = $_ } }) })
    $script:total = 1
}
function Commit-Registered {
    [void](Save-RunnerLaunchEvent $script:state 'registered' 123)
    if ((Get-RunnerJitRegistration).phase -cne 'registered') { throw 'Registration lacks durable known ID.' }
}
function Commit-Handoff {
    Commit-Registered
    [void](Save-RunnerLaunchEvent $script:state 'dispatch')
    if ((Get-RunnerJitRegistration).phase -cne 'handed-off') { throw 'Dispatch lacks durable handoff.' }
}
try {
    Check 'unknown POST survives exact cleanup and empty inventory until delayed exact registration appears' {
        New-Fixture; Abandon-Fixture
        Refuse { Assert-RunnerClaimOpen }
        if (Invoke-RunnerJitReconciliation $config) { throw 'Empty unknown-ID snapshot cleared a late POST barrier.' }
        if ($script:deletes -ne 0 -or (Get-RunnerJitRegistration).phase -cne 'intent') { throw 'Unknown absence mutated registration.' }
        Add-OfflineRunner
        if (-not (Invoke-RunnerJitReconciliation $config)) { throw 'Exact delayed registration did not retire.' }
        Assert-RunnerClaimOpen
        if ($script:deletes -ne 1 -or (Get-RunnerJitRegistration).phase -cne 'complete' -or (Get-RunnerJitRegistration).runnerId -ne 123 -or $script:locked) { throw 'Retirement lost sole ID, phase or lock discipline.' }
    }
    Check 'fresh remote eligibility after local proof refuses changed activity labels and ID before DELETE' {
        foreach ($failure in @('online', 'busy', 'labels', 'id', 'name')) {
            New-Fixture; Abandon-Fixture; Add-OfflineRunner; $script:remoteChange = $failure
            $script:afterSnapshotEffect = {
                switch ($script:remoteChange) {
                    'online' { $script:runners[0].status = 'online' }
                    'busy' { $script:runners[0].busy = $true }
                    'labels' { $script:runners[0].labels[3].name = 'it-inventory-mid' }
                    'id' { $script:runners[0].id = 124 }
                    'name' { $script:runners[0].name = 'different' }
                }
            }
            if (Invoke-RunnerJitReconciliation $config) { throw 'Stale first eligibility snapshot authorized DELETE.' }
            if ($script:reads -ne 2 -or $script:deletes -ne 0 -or (Get-RunnerJitRegistration).phase -cne 'removal-intent') { throw 'Changed remote evidence was not checked immediately before DELETE.' }
            Refuse-Barrier { Assert-RunnerClaimOpen }
        }
    }
    Check 'lost DELETE reply leaves known removal intent and authoritative absence completes next bounded tick' {
        New-Fixture; Abandon-Fixture; Add-OfflineRunner; $script:deleteLost = $true
        if (Invoke-RunnerJitReconciliation $config) { throw 'Lost DELETE was claimed complete.' }
        if ((Get-RunnerJitRegistration).phase -cne 'removal-intent' -or (Get-RunnerJitRegistration).runnerId -ne 123) { throw 'Known deletion identity was not durable before IO.' }
        $script:deleteLost = $false
        if (-not (Invoke-RunnerJitReconciliation $config) -or $script:deletes -ne 1) { throw 'Known absence required a duplicate DELETE or failed reconciliation.' }
    }
    Check 'replacement name after deletion cannot clear known ID barrier or delete the replacement' {
        New-Fixture; Abandon-Fixture; Add-OfflineRunner
        $script:deleteEffect = { Add-OfflineRunner; $script:runners[0].id = 124 }
        if (Invoke-RunnerJitReconciliation $config) { throw 'Replacement name was accepted as absence.' }
        $script:deleteEffect = $null
        if (Invoke-RunnerJitReconciliation $config) { throw 'Replacement name retired known ID on next tick.' }
        if ($script:deletes -ne 1 -or (Get-RunnerJitRegistration).runnerId -ne 123 -or (Get-RunnerJitRegistration).phase -cne 'removal-intent') { throw 'Replacement identity was adopted or removed.' }
    }
    Check 'unsafe API identity activity completeness and transport evidence keep claims blocked' {
        foreach ($failure in @('duplicate-name', 'duplicate-id', 'online', 'busy', 'string-busy', 'labels', 'duplicate-label', 'zero-id', 'missing-count', 'overflow', 'api-error', 'repo')) {
            New-Fixture; Abandon-Fixture; Add-OfflineRunner
            switch ($failure) {
                'duplicate-name' { $other = $script:runners[0] | ConvertTo-Json -Depth 10 | ConvertFrom-Json; $other.id = 124; $script:runners += $other; $script:total = 2 }
                'duplicate-id' { $script:runners += $script:runners[0]; $script:total = 2 }
                'online' { $script:runners[0].status = 'online' }
                'busy' { $script:runners[0].busy = $true }
                'string-busy' { $script:runners[0].busy = 'false' }
                'labels' { $script:runners[0].labels[3].name = 'it-inventory-mid' }
                'duplicate-label' { $script:runners[0].labels += $script:runners[0].labels[0] }
                'zero-id' { $script:runners[0].id = 0 }
                'missing-count' { $script:total = 0 }
                'overflow' { $script:total = 101 }
                'api-error' { $script:apiError = $true }
                'repo' { $record = Get-RunnerJitRegistration; $record.repo = 'other/fixture'; Write-RunnerJitRegistration $record }
            }
            if (Invoke-RunnerJitReconciliation $config) { throw "Unsafe $failure evidence retired barrier." }
            Refuse { Assert-RunnerClaimOpen }
            if ($script:deletes -ne 0 -or $script:locked) { throw 'Unsafe evidence sent DELETE or held lock.' }
        }
    }
    Check 'cleanup proof and IO-time journal Stop or VM changes prohibit retirement' {
        foreach ($failure in @('state', 'vm', 'reference', 'provider', 'journal-during-read', 'vm-during-read', 'stop-during-read', 'journal-during-delete')) {
            New-Fixture
            if ($failure -cne 'state') { Abandon-Fixture }
            Add-OfflineRunner
            $other = [pscustomobject]@{ Name = 'other'; Id = [guid]::NewGuid(); Path = Join-Path $root 'other'; disks = @() }
            switch ($failure) {
                'vm' { $other.Name = $script:state.vmName; $other.Id = [guid]$script:state.vmId; $script:vms = @($other) }
                'reference' { $other.disks = @((Join-Path $script:state.instancePath 'guest.vhdx')); $script:vms = @($other) }
                'provider' { $script:inventoryFailed = $true }
                'journal-during-read' { $script:readEffect = { $record = Get-RunnerJitRegistration; $record.operationId = 'd' * 32; Write-RunnerJitRegistration $record } }
                'vm-during-read' { $script:readEffect = { $script:vms = @([pscustomobject]@{ Name = $script:state.vmName; Id = [guid]$script:state.vmId; Path = $script:state.instancePath; disks = @() }) } }
                'stop-during-read' { $script:readEffect = { [IO.File]::WriteAllText((Join-Path $root 'stop.requested'), '') } }
                'journal-during-delete' { $script:deleteEffect = { $record = Get-RunnerJitRegistration; $record.operationId = 'd' * 32; Write-RunnerJitRegistration $record } }
            }
            if (Invoke-RunnerJitReconciliation $config) { throw "Changed $failure evidence retired barrier." }
            if ($script:deletes -ne $(if ($failure -ceq 'journal-during-delete') { 1 } else { 0 }) -or $script:locked) { throw 'Changed proof bypassed final admission.' }
            Refuse { Assert-RunnerClaimOpen }
        }
    }
    Check 'late POST response after session cleanup cannot persist ID or authorize SSH' {
        New-Fixture; Abandon-Fixture
        Refuse { Save-RunnerLaunchEvent $script:state 'registered' 123 }
        Refuse { Save-RunnerLaunchEvent $script:state 'dispatch' }
        if ((Get-RunnerJitRegistration).phase -cne 'intent' -or (Get-RunnerJitRegistration).runnerId -ne 0) { throw 'Late reply changed abandoned intent.' }
    }
    Check 'partial intent registered and dispatch writes fail closed before handoff' {
        foreach ($checkpoint in @('jit-registration-intent', 'jit-registration-registered', 'jit-dispatch-state')) {
            New-Fixture
            if ($checkpoint -ceq 'jit-registration-intent') {
                Remove-Item -LiteralPath (Join-Path $root 'jit-registration.json')
                $current = Get-RunnerState; $current.PSObject.Properties.Remove('runnerLaunch'); Write-RunnerJson $script:RunnerStatePath $current
                $script:interrupt = $checkpoint
                Refuse { Save-RunnerLaunchEvent $script:state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $script:state) -Config $config }
                if ((Get-RunnerState).PSObject.Properties.Name -contains 'runnerLaunch') { throw 'Interrupted intent advanced session launch.' }
                Refuse { Assert-RunnerClaimOpen }
            } else {
                $script:interrupt = $checkpoint
                if ($checkpoint -ceq 'jit-registration-registered') { Refuse { Save-RunnerLaunchEvent $script:state 'registered' 123 } }
                else { $script:interrupt = ''; [void](Save-RunnerLaunchEvent $script:state 'registered' 123); $script:interrupt = $checkpoint; Refuse { Save-RunnerLaunchEvent $script:state 'dispatch' } }
                if ((Get-RunnerJitRegistration).phase -ceq 'handed-off') { throw 'Partial write published a handoff.' }
                Refuse { Assert-RunnerClaimOpen }
            }
        }
    }
    Check 'handed-off barrier blocks claims pilot retry and activation until authoritative retirement' {
        New-Fixture; Commit-Handoff; Abandon-Fixture
        Write-RunnerJson (Join-Path $root 'pilot-attempt.json') ([ordered]@{ tag = $script:RunnerTag; jobId = 999 })
        Refuse-Barrier { Assert-RunnerClaimOpen }
        Refuse-Barrier { Enable-RunnerPilotCore ('a' * 40) 'investigated' -Retry }
        Refuse-Barrier { Complete-PilotRetry ([pscustomobject]@{}) }
        Refuse-Barrier { Enable-RunnerActiveCore }
        if ((Read-RunnerJson (Join-Path $root 'pilot-attempt.json')).jobId -ne 999) { throw 'Handoff barrier discarded pilot consumption.' }
        if (-not (Invoke-RunnerJitReconciliation $config) -or $script:reads -ne 1 -or $script:deletes -ne 0 -or (Get-RunnerJitRegistration).phase -cne 'complete') { throw 'Known handed-off ID/name absence was not authoritatively reconciled.' }
        Assert-RunnerClaimOpen
    }
    Check 'registered and handed-off offline registration removal and lost DELETE reconcile once' {
        foreach ($registrationPhase in @('registered', 'handed-off')) {
        foreach ($lost in @($false, $true)) {
            New-Fixture
            if ($registrationPhase -ceq 'registered') { Commit-Registered } else { Commit-Handoff }
            Abandon-Fixture; Add-OfflineRunner
            $script:deleteLost = $lost
            $completed = Invoke-RunnerJitReconciliation $config
            if ($completed -eq $lost -or $script:deletes -ne 1) { throw 'Known registration retirement outcome or delete count changed.' }
            if ($lost) {
                if ((Get-RunnerJitRegistration).phase -cne 'removal-intent') { throw 'Lost registration DELETE erased known intent.' }
                $script:deleteLost = $false
                if (-not (Invoke-RunnerJitReconciliation $config) -or $script:deletes -ne 1) { throw 'Lost registration DELETE replayed removal.' }
            }
            if ((Get-RunnerJitRegistration).phase -cne 'complete' -or (Get-RunnerJitRegistration).runnerId -ne 123) { throw 'Known registration retirement lost identity.' }
        }
        }
    }
    Check 'registered and handed-off collision uncertainty and local changes never authorize replacement' {
        foreach ($registrationPhase in @('registered', 'handed-off')) {
        foreach ($failure in @('state', 'vm', 'reference', 'provider-uncertain', 'online', 'busy', 'name-collision', 'id-collision', 'labels', 'incomplete', 'transport', 'stop-read', 'journal-read', 'config-read', 'vm-read', 'fresh-online')) {
            New-Fixture
            if ($registrationPhase -ceq 'registered') { Commit-Registered } else { Commit-Handoff }
            if ($failure -cne 'state') { Abandon-Fixture }
            Add-OfflineRunner
            switch ($failure) {
                'vm' { $script:vms = @([pscustomobject]@{ Name = $script:state.vmName; Id = [guid]$script:state.vmId; Path = $script:state.instancePath; disks = @() }) }
                'reference' { $script:vms = @([pscustomobject]@{ Name = 'other'; Id = [guid]::NewGuid(); Path = Join-Path $root 'other'; disks = @((Join-Path $script:state.instancePath 'guest.vhdx')) }) }
                'provider-uncertain' { $script:inventoryFailed = $true }
                'online' { $script:runners[0].status = 'online' }
                'busy' { $script:runners[0].busy = $true }
                'name-collision' { $script:runners[0].id = 124 }
                'id-collision' { $script:runners[0].name = 'different' }
                'labels' { $script:runners[0].labels[3].name = 'it-inventory-mid' }
                'incomplete' { $script:total = 2 }
                'transport' { $script:apiError = $true }
                'stop-read' { $script:runners = @(); $script:total = 0; $script:readEffect = { [IO.File]::WriteAllText((Join-Path $root 'stop.requested'), '') } }
                'journal-read' { $script:runners = @(); $script:total = 0; $script:readEffect = { $record = Get-RunnerJitRegistration; $record.operationId = 'd' * 32; Write-RunnerJitRegistration $record } }
                'config-read' { $script:runners = @(); $script:total = 0; $script:readEffect = { $script:liveRepo = 'other/fixture' } }
                'vm-read' { $script:runners = @(); $script:total = 0; $script:readEffect = { $script:vms = @([pscustomobject]@{ Name = $script:state.vmName; Id = [guid]$script:state.vmId; Path = $script:state.instancePath; disks = @() }) } }
                'fresh-online' { $script:afterSnapshotEffect = { $script:runners[0].status = 'online' } }
            }
            if (Invoke-RunnerJitReconciliation $config) { throw "Unsafe $registrationPhase $failure evidence cleared the barrier." }
            if ($script:deletes -ne 0) { throw 'Unsafe known registration retirement issued DELETE.' }
            Refuse-Barrier { Assert-RunnerJitRegistrationClear }
            Refuse { Assert-RunnerClaimOpen } # Explicit Stop may refuse even earlier.
            $config.repo = 'example/fixture'
        }
        }
    }
    Check 'native process exit after durable intent retains barrier through restart cleanup' {
        foreach ($crashPhase in @('intent', 'registered', 'handed-off')) {
        New-Fixture
        Remove-Item -LiteralPath (Join-Path $root 'jit-registration.json')
        $current = Get-RunnerState; $current.PSObject.Properties.Remove('runnerLaunch'); Write-RunnerJson $script:RunnerStatePath $current
        $childPath = Join-Path $root 'intent-crash.ps1'
        $childSource = @'
param([string] $Source, [string] $Root, [string] $CrashPhase)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $Source 'Common.ps1')
. (Join-Path $Source 'Network.Recovery.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Source 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$script:RunnerRoot = $Root; $script:RunnerStatePath = Join-Path $Root 'state.json'
function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) }
function Enter-RunnerLock { 'fixture' }
function Exit-RunnerLock {}
$state = Get-RunnerState
$state.supervisorPid = $PID; $state.guardianPid = $PID
$state.supervisorStartUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o'); $state.guardianStartUtc = $state.supervisorStartUtc
$state.networkRecovery.binding.claimHash = Get-RunnerRecoveryClaimHash $state
Write-RunnerJson $script:RunnerStatePath $state
$config = [pscustomobject]@{ repo = 'example/fixture'; activation = 'active'; label = 'it-inventory-ephemeral'; runnerGroupId = 1 }
[void](Save-RunnerLaunchEvent $state 'intent' 0 ('c' * 32) -Admission (Get-RunnerJitAdmission $state) -Config $config)
if ($CrashPhase -cin @('registered', 'handed-off')) {
    [void](Save-RunnerLaunchEvent $state 'registered' 123)
    if ($CrashPhase -ceq 'handed-off') { [void](Save-RunnerLaunchEvent $state 'dispatch') }
}
[Environment]::Exit(73) # No catch/finally/POST/SSH; abrupt owned fixture exit.
'@
        [IO.File]::WriteAllText($childPath, $childSource, [Text.UTF8Encoding]::new($false))
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $childPath -Source $CandidateRoot -Root $root -CrashPhase $crashPhase
        if ($LASTEXITCODE -ne 73) { throw 'Owned native crash fixture did not reach its post-intent boundary.' }
        $abandoned = Get-RunnerState
        if (Test-RunnerProcessIdentity $abandoned.supervisorPid $abandoned.supervisorStartUtc) { throw 'Crash fixture owner remained alive.' }
        Invoke-Watchdog
        if ($script:starts -ne 1 -or $script:coherenceChecks -ne 1 -or $script:task.State -cne 'Running') { throw 'Watchdog failed to restart sole reconciler behind unresolved JIT barrier.' }
        Invoke-Watchdog
        if ($script:starts -ne 1) { throw 'Watchdog restarted an already running reconciler.' }
        Refuse { Assert-RunnerClaimOpen }
        if ($crashPhase -ceq 'registered') {
            if (-not (Invoke-RunnerJitReconciliation $config) -or $script:reads -ne 1 -or $script:deletes -ne 0 -or (Get-RunnerJitRegistration).phase -cne 'complete') { throw 'Crashed registered owner with known ID and authoritative ID/name absence remained blocked.' }
            Assert-RunnerClaimOpen
        } else {
            if ($crashPhase -ceq 'handed-off') { Add-OfflineRunner; $script:runners[0].status = 'online'; $script:runners[0].busy = $true }
            Refuse { Invoke-SupervisorLoop }
            if ($script:pollBoundary -ne 1 -or $script:reads -ne 1 -or $script:deletes -ne 0) { throw 'Restarted supervisor reached demand before authoritative reconciliation.' }
            if ((Get-RunnerJitRegistration).phase -cne $crashPhase -or $null -ne (Get-RunnerState)) { throw 'Restart cleanup erased protected registration.' }
        }
        $record = Get-RunnerJitRegistration; $record.phase = 'malformed'; Write-RunnerJson (Join-Path $root 'jit-registration.json') $record
        $script:task.State = 'Ready'
        Refuse { Invoke-RunnerSupervisorRecovery }
        [IO.File]::WriteAllText((Join-Path $root 'stop.requested'), '')
        Refuse { Start-RunnerSupervisorCore }
        if ($script:starts -ne 1 -or -not (Test-Path -LiteralPath (Join-Path $root 'stop.requested'))) { throw 'Malformed journal started controller or cleared explicit Stop.' }
        }
    }
    Check 'pilot retry and update retain unresolved nonsecret journal even across cleanup' {
        New-Fixture; Abandon-Fixture
        $receipt = [ordered]@{ tag = $script:RunnerTag; jobId = 999 }
        Write-RunnerJson (Join-Path $root 'pilot-attempt.json') $receipt
        Refuse-Barrier { Enable-RunnerPilotCore ('a' * 40) 'investigated' -Retry }
        Refuse-Barrier { Complete-PilotRetry ([pscustomobject]@{}) }
        if ((Read-RunnerJson (Join-Path $root 'pilot-attempt.json')).jobId -ne 999) { throw 'Retry bypass discarded pilot consumption.' }
        $hashes = Get-UpdatePreservedHashes
        if ($hashes.'jit-registration.json' -cne (Get-FileHash (Join-Path $root 'jit-registration.json') -Algorithm SHA256).Hash) { throw 'Update omitted protected JIT barrier.' }
        $record = Get-RunnerJitRegistration; $record.operationId = 'e' * 32; Write-RunnerJitRegistration $record
        Refuse { Assert-UpdatePreservedHashes $hashes }
        $record | Add-Member encoded_jit_config 'SENTINEL_JIT'
        Refuse { Write-RunnerJitRegistration $record }
        foreach ($file in Get-ChildItem -LiteralPath $root -Filter '*.json') {
            if ((Get-Content -LiteralPath $file.FullName -Raw) -match 'SENTINEL_(PAT|JIT|API_SECRET)') { throw 'Secret leaked into durable lifecycle evidence.' }
        }
    }
    Check 'actual supervisor reconciles before consumed pilot return and never polls demand while unresolved' {
        New-Fixture; Abandon-Fixture
        Write-RunnerJson (Join-Path $root 'pilot-attempt.json') ([ordered]@{ tag = $script:RunnerTag; jobId = 999 })
        $script:pollBoundary = 0
        foreach ($activation in @('active', 'pilot')) {
            $config.activation = $activation; $beforeReads = $script:reads
            Refuse { Invoke-SupervisorLoop }
            if ($script:reads -ne ($beforeReads + 1)) { throw 'Consumed pilot return bypassed abandoned registration reconciliation.' }
        }
        $config.activation = 'active'
        if ($script:pollBoundary -ne 2 -or $script:deletes -ne 0 -or (Read-RunnerJson (Join-Path $root 'pilot-attempt.json')).jobId -ne 999) { throw 'Unresolved supervisor polled demand or changed consumption.' }
    }
    Write-Host "JIT registration offline regressions passed: $script:checks groups; no live GitHub/provider proof."
} finally {
    $absolute = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($absolute).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($absolute) -cnotmatch '^ITIR-jit-[0-9a-f]{32}$') { throw 'JIT fixture cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $absolute -Recurse -Force
}
