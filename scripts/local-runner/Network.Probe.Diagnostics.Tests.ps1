# Offline worker-body proof only. No installed imports, sockets, SSH, VM, provider or credential IO.
param([string] $CandidateRoot = $PSScriptRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $CandidateRoot 'Network.Recovery.Probe.ps1'), [ref]$null, [ref]$null)
$outer = $ast.Find({ param($node) $node -is [Management.Automation.Language.TryStatementAst] -and $node.Body.Extent.Text.Contains(". (Join-Path `$PSScriptRoot 'Common.ps1')") }, $false)
if ($null -eq $outer) { throw 'Worker outer stage guard is missing.' }
$statements = @($outer.Body.Statements)
$start = -1
for ($i = 0; $i -lt $statements.Count; $i++) { if ($statements[$i] -is [Management.Automation.Language.AssignmentStatementAst] -and $statements[$i].Left.Extent.Text -ceq '$success') { $start = $i; break } }
$factory = '$listener = [Net.Sockets.TcpListener]::new($gateway, 0)'
if ($start -lt 0) { throw 'Worker source witness changed.' }
$body = ($statements[$start..($statements.Count-1)] | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine
if (([regex]::Matches($body, [regex]::Escape($factory))).Count -ne 1) { throw 'Worker listener source witness changed.' }
$body = $body.Replace($factory, '$listener = $script:listener')
$worker = [scriptblock]::Create($body)
$script:checks = 0
function Require([bool] $Value) { if (-not $Value) { throw 'Probe diagnostic regression failed.' } }
function Invoke-RunnerNative([string] $Executable, [string[]] $Arguments, [int] $TimeoutSeconds) {
    $script:calls++
    Require ($Executable -ceq 'ssh.exe' -and $TimeoutSeconds -eq 12)
    if (($script:mode -ceq 'isolation-error' -and $script:calls -eq 1) -or ($script:mode -ceq 'github-error' -and $script:calls -eq 2)) { throw 'SECRET raw transport error URL credential' }
    if ($script:mode -ceq 'isolation-command-failed' -and $script:calls -eq 1) { return 255 }
    if ($script:mode -ceq 'github-command-failed' -and $script:calls -eq 2) { return 22 }
    return 0
}
function Write-RunnerJson($Path, $Value) { $script:record = $Value | ConvertTo-Json -Depth 5 -Compress | ConvertFrom-Json }
foreach ($mode in @('passed', 'listener-error', 'isolation-error', 'isolation-command-failed', 'isolation-open', 'github-error', 'github-command-failed')) {
    $script:mode = $mode; $script:calls = 0; $script:starts = 0; $script:stops = 0; $script:pending = 0; $script:record = $null
    $script:listener = [pscustomobject]@{ LocalEndpoint = [Net.IPEndPoint]::new([ipaddress]::Parse('172.30.240.1'), 40000) }
    $script:listener | Add-Member ScriptMethod Start { $script:starts++; if ($script:mode -ceq 'listener-error') { throw 'SECRET listener error' } }
    $script:listener | Add-Member ScriptMethod Pending { $script:pending++; return $script:mode -ceq 'isolation-open' }
    $script:listener | Add-Member ScriptMethod Stop { $script:stops++ }
    $Generation = [long]::MaxValue; $ProbeId = 'a' * 32; $resultPath = 'synthetic-result'; $args = @()
    & $worker
    Require ($script:record.detail.code -ceq $mode -and $script:record.success -eq ($mode -ceq 'passed'))
    Require ($script:starts -eq 1 -and $script:stops -eq 1)
    $expectedCalls = if ($mode -ceq 'listener-error') { 0 } elseif ($mode -cin @('isolation-error', 'isolation-command-failed', 'isolation-open')) { 1 } else { 2 }
    Require ($script:calls -eq $expectedCalls)
    $json = ConvertTo-Json -InputObject $script:record -Depth 5 -Compress
    Require ([Text.Encoding]::UTF8.GetByteCount($json) -le 256 -and $json -cnotmatch 'SECRET|credential|https|172\.|ssh|Arguments|Output')
    Require ($script:record.detail.elapsedMs -ge 0 -and $script:record.detail.elapsedMs -le 86400000)
    $script:record.detail.elapsedMs = 86400000
    Require ([Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json -InputObject $script:record -Depth 5 -Compress)) -le 256)
    $script:checks++; Write-Host "PASS sanitized worker stage $mode preserves command and listener actions"
}
Write-Host "Probe worker offline diagnostics passed: $script:checks cases. No live network or recovery-cause proof."
