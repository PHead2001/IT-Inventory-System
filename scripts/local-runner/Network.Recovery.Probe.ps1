# Fixed read-only worker. Its host process and all SSH descendants are owned by
# the guardian's kernel Job Object; it never dispatches VM/workflow mutations.
param([Parameter(Mandatory)][string] $InstancePath,
    [Parameter(Mandatory)][int] $LayoutVersion,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{32}$')][string] $ProbeId,
    [Parameter(Mandatory)][ValidateRange(0, [long]::MaxValue)][long] $Generation)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$failureExitCode = 61 # common-import
try {
. (Join-Path $PSScriptRoot 'Common.ps1')
$failureExitCode = 62 # instance-containment
$InstancePath = Assert-OwnedPath $InstancePath
$failureExitCode = 63 # instance-identity
if ([IO.Path]::GetDirectoryName($InstancePath) -ine (Join-Path $script:RunnerRoot 'instances') -or [IO.Path]::GetFileName($InstancePath) -cnotmatch '^ITIR-[0-9a-f]{32}$') { throw 'Probe instance identity differs.' }
$paths = Get-RunnerSessionPaths ([pscustomobject]@{ vmName = [IO.Path]::GetFileName($InstancePath); instancePath = $InstancePath; layoutVersion = $LayoutVersion })
$failureExitCode = 64 # instance-acl
$aclFailureStage = 'unknown'
Assert-RunnerProtectedPath $paths.instance -FailureStage ([ref]$aclFailureStage)
Assert-RunnerSessionTrustedPaths ([pscustomobject]@{ vmName = [IO.Path]::GetFileName($InstancePath); instancePath = $InstancePath; layoutVersion = $LayoutVersion })
$failureExitCode = 65 # result-precondition
$resultPath = Assert-OwnedPath (Join-Path $paths.probeRoot ("probe-$ProbeId.json"))
if (Test-Path -LiteralPath $resultPath) { throw 'Probe result already exists.' }
$failureExitCode = 1 # Unexpected non-bootstrap failures remain unclassified.
$args = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', "UserKnownHostsFile=$($paths.knownHosts)", '-i', $paths.privateKey)
$success = $false
$workerCode = 'listener-error'
$probeWatch = [Diagnostics.Stopwatch]::StartNew()
$gateway = [ipaddress]::Parse('172.30.240.1')
$listener = [Net.Sockets.TcpListener]::new($gateway, 0)
try {
    $listener.Start()
    $endpoint = $listener.LocalEndpoint
    if ($endpoint -isnot [Net.IPEndPoint] -or -not $endpoint.Address.Equals($gateway) -or $endpoint.Port -lt 1 -or $endpoint.Port -gt 65535) { throw 'Isolation listener endpoint readback differs.' }
    $port = $endpoint.Port
    $command = 'timeout 4 bash -c "echo probe >/dev/tcp/{0}/{1}" >/dev/null 2>&1; test $? -ne 0' -f $gateway.ToString(), $port
    $workerCode = 'isolation-error'
    $code = Invoke-RunnerNative 'ssh.exe' ($args + @('runner@172.30.240.2', $command)) -TimeoutSeconds 12
    $workerCode = 'isolation-command-failed'
    if ($code -eq 0 -and -not $listener.Pending()) {
        $workerCode = 'github-error'
        $success = (Invoke-RunnerNative 'ssh.exe' ($args + @('runner@172.30.240.2', 'curl --head --fail --silent --show-error --max-time 10 https://api.github.com >/dev/null')) -TimeoutSeconds 12) -eq 0
        $workerCode = if ($success) { 'passed' } else { 'github-command-failed' }
    } elseif ($code -eq 0) { $workerCode = 'isolation-open' }
} catch { $success = $false } finally { $probeWatch.Stop(); $listener.Stop() }
# Additive bounded evidence only. No exception, command, endpoint or output data.
$workerElapsedMs = [long][Math]::Min(86400000, [Math]::Max(0, $probeWatch.ElapsedMilliseconds))
$failureExitCode = 66 # result-publication
Write-RunnerJson $resultPath ([ordered]@{ generation = $Generation; probeId = $ProbeId; success = $success; detail = [ordered]@{ code = $workerCode; elapsedMs = $workerElapsedMs } })
} catch {
    # Fixed numeric evidence only. Never emit caught errors, paths or output.
    if ($failureExitCode -eq 64) {
        try { $failureExitCode = Get-RunnerProbeAclFailureExitCode $_ $aclFailureStage }
        catch { $failureExitCode = 64 }
    }
    exit $failureExitCode
}
exit 0
