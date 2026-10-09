# Offline behavioral tests. All downloads, guest commands and host operations are fixtures.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
$base = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-latency-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($base)
$script:RunnerRoot = $base; $script:RunnerStatePath = Join-Path $base 'state.json'
$script:cacheLock = 'Local\ITIR-cache-' + [guid]::NewGuid().ToString('N')
$script:enterLock = (Get-Command Enter-RunnerLock).ScriptBlock
function Enter-RunnerLock([string] $Name) {
    if ($Name -cne 'Global\ITInventoryLocalRunner-Archive-v1') { throw 'Archive lost its dedicated publication lock.' }
    return & $script:enterLock $script:cacheLock
}
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Latency fixture accepted $Case." }
}
# The unprotected fixture cannot satisfy the real installed security contract.
Assert-Rejected { Get-RunnerArchive $null } 'unprotected cache root'
function Assert-SecureRoot {}
$script:blockedPath = ''
function Assert-RunnerProtectedPath([string] $Path) {
    [void](Assert-OwnedPath $Path)
    if ($Path -ceq $script:blockedPath) { throw 'Fixture ACL refusal.' }
}
$script:releaseVersion = '1.0.0'; $script:apiCalls = 0; $script:downloads = 0
$script:apiFails = $false; $script:badDigest = $false; $script:badUrl = $false
$script:downloadFails = $false; $script:badDownload = $false
function Get-FixtureDigest {
    return Get-RunnerBytesHash ([Text.Encoding]::UTF8.GetBytes("archive-$script:releaseVersion"))
}
function Invoke-GitHub($Uri) {
    if ($Uri -cne 'https://api.github.com/repos/actions/runner/releases/latest') { throw 'Unexpected release metadata request.' }
    $script:apiCalls++
    if ($script:apiFails) { throw 'Fixture metadata unavailable.' }
    $name = "actions-runner-linux-x64-$script:releaseVersion.tar.gz"
    $digest = (Get-FixtureDigest).ToLowerInvariant()
    return [pscustomobject]@{
        tag_name = "v$script:releaseVersion"
        assets = @([pscustomobject]@{
            name = $name
            digest = $(if ($script:badDigest) { 'invalid' } else { "sha256:$digest" })
            browser_download_url = $(if ($script:badUrl) { "https://example.invalid/$name" } else { "https://github.com/actions/runner/releases/download/v$script:releaseVersion/$name" })
        })
    }
}
function Invoke-WebRequest($Uri, $OutFile, [switch] $UseBasicParsing, $TimeoutSec) {
    $script:downloads++
    if ($TimeoutSec -ne 1800 -or -not $UseBasicParsing -or $Uri -cnotlike 'https://github.com/actions/runner/releases/download/*' -or
        [IO.Path]::GetDirectoryName($OutFile) -cne (Join-Path $base 'runner-cache')) { throw 'Download lost its fixed source/path/bound.' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($(if ($script:badDownload) { 'wrong archive' } else { "archive-$script:releaseVersion" }))
    [IO.File]::WriteAllBytes($OutFile, $bytes)
    # A partial download must never appear at its published digest path.
    if (Test-Path -LiteralPath (Join-Path (Split-Path $OutFile) ((Get-FixtureDigest).ToLowerInvariant() + '.tar.gz'))) { throw 'Unverified download was published.' }
    if ($script:downloadFails) { throw 'Fixture interrupted download.' }
}
try {
    $archive = Get-RunnerArchive $null
    if ($script:apiCalls -ne 1 -or $script:downloads -ne 1 -or (Get-FileHash -LiteralPath $archive).Hash -cne (Get-FixtureDigest)) { throw 'Cache miss did not publish the verified archive.' }
    if ((Get-RunnerArchive $null) -cne $archive -or $script:apiCalls -ne 2 -or $script:downloads -ne 1) { throw 'Cache hit bypassed current metadata or downloaded again.' }
    foreach ($failure in @('apiFails', 'badDigest', 'badUrl')) {
        Set-Variable -Scope Script -Name $failure -Value $true
        Assert-Rejected { Get-RunnerArchive $null } $failure
        Set-Variable -Scope Script -Name $failure -Value $false
        if ($script:downloads -ne 1 -or -not (Test-Path -LiteralPath $archive)) { throw 'Invalid metadata used a stale fallback or changed the cache.' }
    }
    $script:blockedPath = $archive
    Assert-Rejected { Get-RunnerArchive $null } 'cache ACL mismatch'
    $script:blockedPath = ''
    [IO.File]::WriteAllText($archive, 'tampered')
    Assert-Rejected { Get-RunnerArchive $null } 'cache content tampering'
    if ($script:downloads -ne 1) { throw 'Tampered archive was silently replaced.' }
    Remove-Item -LiteralPath $archive
    $archive = Get-RunnerArchive $null
    $cache = Join-Path $base 'runner-cache'
    $stray = Join-Path $cache 'unexpected.txt'
    [IO.File]::WriteAllText($stray, 'retain')
    Assert-Rejected { Get-RunnerArchive $null } 'unknown retention entry'
    if (-not (Test-Path -LiteralPath $stray)) { throw 'Cache deleted an unknown entry.' }
    Remove-Item -LiteralPath $stray
    $partial = Join-Path $cache (('a' * 64) + '.' + ('b' * 32) + '.download')
    [IO.File]::WriteAllText($partial, 'interrupted prior publication')
    [void](Get-RunnerArchive $null)
    if (Test-Path -LiteralPath $partial) { throw 'Recognized interrupted download was retained.' }
    $script:releaseVersion = '2.0.0'
    foreach ($failure in @('downloadFails', 'badDownload')) {
        Set-Variable -Scope Script -Name $failure -Value $true
        Assert-Rejected { Get-RunnerArchive $null } $failure
        Set-Variable -Scope Script -Name $failure -Value $false
        if (@(Get-ChildItem -LiteralPath $cache).Count -ne 1 -or -not (Test-Path -LiteralPath $archive)) { throw 'Failed download published bytes, left a partial, or lost previous archive.' }
    }
    [void](Get-RunnerArchive $null)
    $script:releaseVersion = '3.0.0'
    $current = Get-RunnerArchive $null
    if (@(Get-ChildItem -LiteralPath $cache).Count -ne 2 -or -not (Test-Path -LiteralPath $current)) { throw 'Cache retention did not keep the current release and one previous archive.' }
    # Two real PowerShell processes contend for one missing release. The second
    # publisher must reuse the first complete file, without another download.
    $jobs = @()
    try {
        foreach ($index in @(1, 2)) {
            $jobs += Start-Job -ArgumentList $PSScriptRoot, $base, $script:cacheLock -ScriptBlock {
                param($Source, $FixtureRoot, $LockName)
                Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
                . (Join-Path $Source 'Common.ps1')
                . (Join-Path $Source 'Test.Mutex.ps1')
                $definitions = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Source 'Runner.ps1'), [ref]$null, [ref]$null)
                foreach ($definition in $definitions.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $definition.Extent.Text }
                $script:RunnerRoot = $FixtureRoot
                $script:realEnter = (Get-Command Enter-RunnerLock).ScriptBlock
                function Enter-RunnerLock([string] $Name) {
                    if ($Name -cne 'Global\ITInventoryLocalRunner-Archive-v1') { throw 'Concurrent publisher lost its archive lock.' }
                    return & $script:realEnter $LockName
                }
                function Assert-SecureRoot {}
                function Assert-RunnerProtectedPath($Path) { [void](Assert-OwnedPath $Path) }
                function Invoke-GitHub {
                    $digest = (Get-RunnerBytesHash ([Text.Encoding]::UTF8.GetBytes('concurrent-archive'))).ToLowerInvariant()
                    return [pscustomobject]@{ tag_name = 'v4.0.0'; assets = @([pscustomobject]@{ name = 'actions-runner-linux-x64-4.0.0.tar.gz'; digest = "sha256:$digest"; browser_download_url = 'https://github.com/actions/runner/releases/download/v4.0.0/actions-runner-linux-x64-4.0.0.tar.gz' }) }
                }
                function Invoke-WebRequest($Uri, $OutFile, [switch] $UseBasicParsing, $TimeoutSec) {
                    [IO.File]::AppendAllText((Join-Path $FixtureRoot 'downloads.txt'), "download`n")
                    Start-Sleep -Milliseconds 200
                    [IO.File]::WriteAllText($OutFile, 'concurrent-archive', [Text.UTF8Encoding]::new($false))
                }
                Get-RunnerArchive $null
            }
        }
        [void](Wait-Job -Job $jobs -Timeout 20)
        if (@($jobs | Where-Object State -NE 'Completed').Count) { throw 'Concurrent archive publication did not complete.' }
        $paths = @(Receive-Job -Job $jobs -ErrorAction Stop)
        if ($paths.Count -ne 2 -or $paths[0] -cne $paths[1] -or @([IO.File]::ReadAllLines((Join-Path $base 'downloads.txt'))).Count -ne 1) { throw 'Concurrent cache miss downloaded twice or returned different archives.' }
        if (@(Get-ChildItem -LiteralPath $cache).Count -ne 2) { throw 'Concurrent publication exceeded retention.' }
    } finally {
        foreach ($job in $jobs) { if ($job.State -eq 'Running') { Stop-Job -Job $job }; Remove-Job -Job $job -Force }
    }
    # Real owned-path checks reject junction escape before any retention mutation.
    $outside = Join-Path $base 'outside'; [void][IO.Directory]::CreateDirectory($outside)
    $junction = Join-Path $cache 'linked'
    [void](New-Item -ItemType Junction -Path $junction -Target $outside)
    try { Assert-Rejected { Get-RunnerArchive $null } 'reparse-point cache entry' }
    finally { [IO.Directory]::Delete($junction) }

    $pilot = 'it-inventory-pilot-' + ('a' * 40)
    foreach ($label in @('it-inventory-light', 'it-inventory-mid', 'it-inventory-heavy', 'it-inventory-ephemeral', $pilot)) {
        $docker = $label -cnotin @('it-inventory-light', 'it-inventory-mid')
        $prerequisites = Get-RunnerGuestPrerequisites $label
        if ($prerequisites.docker -ne $docker -or ($prerequisites.packages -contains 'docker.io') -ne $docker) { throw 'Guest Docker prerequisite profile mismatch.' }
        foreach ($package in @('ca-certificates', 'curl', 'git', 'openssh-server', 'unzip')) {
            if ($prerequisites.packages -cnotcontains $package) { throw 'Guest omitted a required common prerequisite.' }
        }
        $cloud = Get-GuestCloudConfig 'fixture-public-key' $label
        if ($cloud.Contains('docker.io') -ne $docker -or -not $cloud.Contains('fixture-public-key') -or -not $cloud.Contains('package_update: true')) { throw 'Profile did not reach real cloud-config generation.' }
        function Get-SshArgs { return @() }
        function Assert-SessionAlive {}
        $script:guestCalls = 0; $script:guestSleeps = 0
        function Start-Sleep($Seconds) { if ($Seconds -ne 10) { throw 'Guest retry backoff changed.' }; $script:guestSleeps++ }
        function Invoke-RunnerNative($File, $Arguments) {
            $script:guestCalls++
            $command = $Arguments[-1]
            if ($File -cne 'ssh.exe' -or $command.Contains('docker info') -ne $docker -or -not $command.Contains('cloud-init status --wait') -or
                -not $command.Contains('command -v git') -or -not $command.Contains('test "$(id -un)" = runner')) { throw 'Actual guest readiness skipped its required profile checks.' }
            return $(if ($script:guestCalls -eq 1) { 1 } else { 0 })
        }
        Wait-Guest ([pscustomobject]@{}) ([pscustomobject]@{ guestIp = 'fixture' }) $label
        if ($script:guestCalls -ne 2 -or $script:guestSleeps -ne 1) { throw 'Guest readiness did not retry once then return.' }
    }
    Assert-Rejected { Get-RunnerGuestPrerequisites 'unknown' } 'unknown prerequisite profile'

    # Archive publication assertions above keep their dedicated lock contract.
    # Supervisor reconciliation uses an isolated state lock, never the installed mutex.
    $script:loopStateLocked = $false
    function Enter-RunnerLock {
        if ($script:loopStateLocked) { throw 'Supervisor fixture state lock was reentered.' }
        $script:loopStateLocked = $true
        return 'latency-state-fixture'
    }
    function Exit-RunnerLock { $script:loopStateLocked = $false }
    function Assert-RunnerTransitionClear {}
    function Get-RunnerConfig { return [pscustomobject]@{ activation = 'active'; label = 'it-inventory-ephemeral' } }
    function Get-RunnerState { return $null }
    function Get-OwnerToken { return 'fixture' }
    function Get-RunnerMemoryAdmission {
        if ($script:loopStateLocked) { throw 'Supervisor memory observation ran under its state lock.' }
        return [pscustomobject]@{ ready = $true; availableBytes = 10GB }
    }
    function Write-EventLog {}
    function Get-QueuedRunnerJob {
        $script:queueCalls++
        if ($script:loopCase -eq 'idle') { return $null }
        return [pscustomobject]@{ labels = @('self-hosted', 'it-inventory-light') }
    }
    function Invoke-RunnerSession {
        $script:sessions++
        if ($script:loopCase -eq 'error') { throw 'Fixture session or cleanup failure.' }
        if ($script:loopCase -eq 'completed') {
            if ($script:sessions -eq 2) { [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop') }
            return [pscustomobject]@{ outcome = 'runner-exited' }
        }
        return [pscustomobject]@{ outcome = 'demand-withdrawn' }
    }
    function Start-Sleep($Seconds) {
        if ($Seconds -ne 30) { throw 'Supervisor backoff changed.' }
        $script:loopSleeps++
        [IO.File]::WriteAllText((Join-Path $base 'stop.requested'), 'stop')
    }
    foreach ($script:loopCase in @('completed', 'idle', 'withdrawn', 'error')) {
        $script:loopSleeps = 0; $script:sessions = 0; $script:queueCalls = 0
        Invoke-SupervisorLoop
        $expectedSleeps = if ($script:loopCase -eq 'completed') { 0 } else { 1 }
        if ($script:loopSleeps -ne $expectedSleeps -or ($script:loopCase -eq 'completed' -and ($script:sessions -ne 2 -or $script:queueCalls -ne 2))) { throw 'Supervisor skipped required backoff or waited between completed jobs.' }
        Remove-Item -LiteralPath (Join-Path $base 'stop.requested')
    }
    Write-Host 'Runner latency passed: verified current cache reuse, metadata/ACL/tamper refusal, atomic concurrent publication, partial cleanup, bounded retention, junction refusal, profile cloud-config/readiness and successful-job versus idle/error backoff.'
} finally {
    if ([IO.Path]::GetDirectoryName($base).TrimEnd('\') -cne ([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($base) -cnotmatch '^ITIR-latency-[0-9a-f]{32}$') { throw 'Unexpected latency fixture cleanup path.' }
    Remove-Item -LiteralPath $base -Recurse -Force
}
