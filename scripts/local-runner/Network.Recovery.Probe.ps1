# Fixed read-only worker. Its host process and all SSH descendants are owned by
# the guardian's kernel Job Object; it never dispatches VM/workflow mutations.
param([Parameter(Mandatory)][string] $InstancePath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{32}$')][string] $ProbeId,
    [Parameter(Mandatory)][ValidateRange(0, [long]::MaxValue)][long] $Generation)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$InstancePath = Assert-OwnedPath $InstancePath
if ([IO.Path]::GetDirectoryName($InstancePath) -ine (Join-Path $script:RunnerRoot 'instances') -or [IO.Path]::GetFileName($InstancePath) -cnotmatch '^ITIR-[0-9a-f]{32}$') { throw 'Probe instance identity differs.' }
Assert-RunnerProtectedPath $InstancePath
$resultPath = Assert-OwnedPath (Join-Path $InstancePath ("probe-$ProbeId.json"))
if (Test-Path -LiteralPath $resultPath) { throw 'Probe result already exists.' }
$args = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', "UserKnownHostsFile=$InstancePath\known_hosts", '-i', "$InstancePath\id_ed25519")
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
Write-RunnerJson $resultPath ([ordered]@{ generation = $Generation; probeId = $ProbeId; success = $success; detail = [ordered]@{ code = $workerCode; elapsedMs = $workerElapsedMs } })
exit 0
