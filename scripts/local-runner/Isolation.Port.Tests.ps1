# Offline source execution with mocked SSH; one real loopback-only ephemeral bind.
# No elevation, installed paths, VM/provider calls or guest commands are executed.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:checks = 0
function Require([bool] $Condition, [string] $Message) { if (-not $Condition) { throw $Message }; $script:checks++ }
function Get-SourceAst([string] $Name) {
    $errors = $null; $tokens = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $Name), [ref]$tokens, [ref]$errors)
    Require ($errors.Count -eq 0) 'Probe source must parse in Windows PowerShell.'
    return $ast
}
function Replace-ListenerConstructor($Ast, [string] $Text) {
    # Replace only the constructor, preserving the real start/readback/SSH/finally.
    $constructors = @($Ast.FindAll({ param($node)
        $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
        $node.Expression -is [Management.Automation.Language.TypeExpressionAst] -and
        $node.Expression.TypeName.FullName -ceq 'Net.Sockets.TcpListener' -and $node.Member.Value -ceq 'new'
    }, $true))
    Require ($constructors.Count -eq 1) 'Expected one owned isolation listener.'
    Require ($constructors[0].Arguments.Count -eq 2 -and $constructors[0].Arguments[1].Value -eq 0) 'OS must assign the listener port.'
    Require ($Text.Contains($constructors[0].Extent.Text)) 'Constructor must belong to the executed probe.'
    return $Text.Replace($constructors[0].Extent.Text, '(New-FixtureIsolationListener $gateway 0)')
}
$runnerAst = Get-SourceAst 'Runner.ps1'
$commonAst = Get-SourceAst 'Common.ps1'
foreach ($name in @('New-RunnerIsolationProbeFailure','Assert-RunnerIsolationProbeDiagnostic')) {
    . ([ScriptBlock]::Create(($commonAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $false)).Extent.Text))
}
$isolation = $runnerAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-GuestIsolation' }, $false)
Require ($null -ne $isolation) 'Canonical guest isolation function is required.'
$realIsolation = [ScriptBlock]::Create($isolation.Extent.Text)
. ([ScriptBlock]::Create((Replace-ListenerConstructor $isolation $isolation.Extent.Text)))
$workerAst = Get-SourceAst 'Network.Recovery.Probe.ps1'
$statements = @($workerAst.EndBlock.Statements)
$start = -1
for ($i = 0; $i -lt $statements.Count; $i++) {
    if ($statements[$i] -is [Management.Automation.Language.AssignmentStatementAst] -and $statements[$i].Left.Extent.Text -ceq '$success') { $start = $i; break }
}
Require ($start -ge 0 -and $statements[-1] -is [Management.Automation.Language.ExitStatementAst]) 'Fixed worker must retain its result publication and terminal exit.'
$workerBody = ($statements[$start..($statements.Count - 2)] | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine
$worker = [ScriptBlock]::Create((Replace-ListenerConstructor $workerAst $workerBody))
function Get-SshArgs($State) { return @('-o', 'fixture-ssh-arguments') }
function New-FixtureIsolationListener([ipaddress] $Address, [int] $Port) {
    Require ($Address.Equals([ipaddress]::Parse('172.30.240.1')) -and $Port -eq 0) 'Listener must bind only the configured gateway with OS assignment.'
    $script:listenerFixture = [pscustomobject]@{ started = $false; stopped = 0 }
    $script:listenerFixture | Add-Member ScriptMethod Start {
        if ($script:scenario -ceq 'start-failure') { throw 'synthetic startup failure' }
        $this.started = $true
    }
    $script:listenerFixture | Add-Member ScriptProperty LocalEndpoint {
        if ($script:scenario -ceq 'readback-failure') { throw 'synthetic readback failure' }
        if ($script:scenario -ceq 'wrong-type') { return [pscustomobject]@{ Port = 42037 } }
        $address = if ($script:scenario -ceq 'wrong-address') { '0.0.0.0' } else { '172.30.240.1' }
        $port = if ($script:scenario -ceq 'zero-port') { 0 } else { 42037 }
        return [Net.IPEndPoint]::new([ipaddress]::Parse($address), $port)
    }
    $script:listenerFixture | Add-Member ScriptMethod Pending {
        $script:pendingCalls++
        if ($script:scenario -cin @('pending-failure','both-observation-failure')) { throw 'synthetic pending failure' }
        if ($script:scenario -ceq 'pending-invalid') { return 'SECRET_PENDING' }
        return $script:scenario -cin @('pending-connection','both-failure')
    }
    $script:listenerFixture | Add-Member ScriptMethod Stop { $this.started = $false; $this.stopped++ }
    return $script:listenerFixture
}
function Invoke-RunnerNative([string] $File, [string[]] $Arguments, $InputText, [int] $TimeoutSeconds) {
    $script:sshCalls++
    Require ($File -ceq 'ssh.exe' -and $Arguments[-2] -ceq 'runner@172.30.240.2') 'Guest test must retain its exact SSH target.'
    if ($script:path -ceq 'recovery') { Require ($TimeoutSeconds -eq 12) 'Recovery worker deadline must remain bounded.' }
    if ($script:sshCalls -eq 1) {
        Require ($script:listenerFixture.started -and $script:listenerFixture.stopped -eq 0) 'Listener must remain bound throughout the guest deny probe.'
        Require ($Arguments[-1] -ceq 'timeout 4 bash -c "echo probe >/dev/tcp/172.30.240.1/42037" >/dev/null 2>&1; test $? -ne 0') 'Guest deny test must use the actual read-back port and retain exit-code meaning.'
        if ($script:scenario -cin @('ssh-failure','both-observation-failure')) { throw 'synthetic SSH failure' }
        if ($script:scenario -ceq 'ssh-invalid') { return [pscustomobject]@{ secret='SECRET_SSH' } }
        if ($script:scenario -cin @('deny-failure','both-failure')) { return 1 }
        return 0
    }
    Require ($Arguments[-1] -ceq 'curl --head --fail --silent --show-error --max-time 10 https://api.github.com >/dev/null') 'Public TLS/DNS probe must remain unchanged.'
    if ($script:scenario -ceq 'public-throw') { throw 'synthetic public probe failure' }
    if ($script:scenario -ceq 'public-failure') { return 1 }
    return 0
}
function Write-RunnerJson([string] $Path, $Value) {
    Require ($Path -ceq 'offline-result' -and $Value.generation -eq 17 -and $Value.probeId -ceq ('c' * 32)) 'Recovery result attribution must remain exact.'
    $script:published = $Value
}
foreach ($script:path in @('startup', 'recovery')) {
    foreach ($script:scenario in @('success', 'start-failure', 'readback-failure', 'wrong-type', 'wrong-address', 'zero-port', 'ssh-failure', 'deny-failure', 'pending-connection', 'pending-failure', 'both-failure', 'both-observation-failure', 'ssh-invalid', 'pending-invalid', 'public-failure', 'public-throw')) {
        $script:sshCalls = 0; $script:pendingCalls = 0; $script:published = $null; $thrown = $false; $fixtureError = ''; $fixtureFailure = $null
        try {
            if ($script:path -ceq 'startup') { Test-GuestIsolation ([pscustomobject]@{}) ([pscustomobject]@{ gatewayIp = '172.30.240.1'; guestIp = '172.30.240.2' }) }
            else { $args = @('-o', 'fixture-ssh-arguments'); $resultPath = 'offline-result'; $Generation = 17; $ProbeId = 'c' * 32; & $worker }
        } catch { $thrown = $true; $fixtureError = $_.Exception.Message; $fixtureFailure = $_ }
        $expectedCalls = if ($script:scenario -cin @('start-failure', 'readback-failure', 'wrong-type', 'wrong-address', 'zero-port')) { 0 } elseif ($script:scenario -cin @('ssh-failure', 'deny-failure', 'pending-connection', 'pending-failure', 'both-failure', 'both-observation-failure', 'ssh-invalid', 'pending-invalid')) { 1 } else { 2 }
        Require ($script:sshCalls -eq $expectedCalls) "Probe admission/order failed in $script:path/$script:scenario ($script:sshCalls/$expectedCalls): $fixtureError"
        Require (-not $script:listenerFixture.started -and $script:listenerFixture.stopped -eq 1) 'Every owned listener must stop exactly once, including failed Start/readback/SSH.'
        if ($script:path -ceq 'startup') {
            Require ($thrown -eq ($script:scenario -cne 'success')) 'Startup isolation must fail closed.'
            if ($expectedCalls -gt 0) { Require ($script:pendingCalls -eq 1) 'Startup must independently observe Pending once even after failed SSH.' }
            if ($expectedCalls -eq 1) {
                $probe = $fixtureFailure.Exception.Data['runnerIsolationProbe']
                Assert-RunnerIsolationProbeDiagnostic $probe
                $expectedExit = if ($script:scenario -cin @('ssh-failure','both-observation-failure','ssh-invalid')) { $null } elseif ($script:scenario -cin @('deny-failure','both-failure')) { 1 } else { 0 }
                $expectedListener = if ($script:scenario -cin @('pending-connection','both-failure')) { 'pending' } elseif ($script:scenario -cin @('pending-failure','both-observation-failure','pending-invalid')) { 'unavailable' } else { 'clear' }
                Require ($probe.exitCode -eq $expectedExit -and $probe.listener -ceq $expectedListener -and $probe.kind -ceq 'guest-to-host') 'Independent isolation observations changed or were dropped.'
                Require (($probe | ConvertTo-Json -Compress) -cnotmatch 'SECRET|synthetic|172\.30|ssh.exe') 'Isolation diagnostic retained raw output or arguments.'
            }
        }
        else { Require (-not $thrown -and $null -ne $script:published -and $script:published.success -eq ($script:scenario -ceq 'success')) 'Recovery must publish attributed false on all probe failures.' }
    }
}

# Execute the unmodified canonical constructor/start/readback/finally on loopback.
# SSH stays mocked: the VM/guest, configured gateway and installed runner are untouched.
& {
    . $realIsolation
    $script:liveCalls = 0; $script:liveListener = $null
    function Invoke-RunnerNative([string] $File, [string[]] $Arguments) {
        $script:liveCalls++
        if ($script:liveCalls -eq 1) {
            $script:liveListener = $listener
            $endpoint = $listener.LocalEndpoint
            Require ($listener.Server.IsBound -and $endpoint.Address.Equals([ipaddress]::Loopback) -and $endpoint.Port -gt 0 -and $endpoint.Port -le 65535) 'Real listener must be bound to an assigned loopback port.'
            Require ($Arguments[-1].Contains('/dev/tcp/127.0.0.1/' + $endpoint.Port + '"')) 'Real assigned port must reach the guest command unchanged.'
        } else { Require (-not $script:liveListener.Server.IsBound) 'Startup listener must be stopped before the public probe.' }
        return 0
    }
    Test-GuestIsolation ([pscustomobject]@{}) ([pscustomobject]@{ gatewayIp = '127.0.0.1'; guestIp = '127.0.0.2' })
    Require ($script:liveCalls -eq 2 -and -not $script:liveListener.Server.IsBound) 'Live ephemeral bind must complete and release its socket.'
}
Write-Host "Isolation port checks passed: $checks; 32 mocked failure/success cases and one real loopback ephemeral bind. No VM/provider/installed runner access."
