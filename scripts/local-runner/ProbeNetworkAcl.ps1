# Reviewed owner diagnostic only: one disposable, never-booted, diskless VM.
# It does not read credentials, contact GitHub or alter the consumed pilot.
[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
Assert-SecureRoot
$config = Get-RunnerConfig
$attempt = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-attempt.json')
if ($config.activation -ne 'pilot' -or $null -eq $attempt -or $attempt.tag -ne $script:RunnerTag) {
    throw 'ACL reproduction requires the existing consumed pilot; it will not reset or enable pickup.'
}
if (Get-RunnerState) { throw 'A runner session is recorded; ACL reproduction is refused.' }
if (@(Get-VM -ErrorAction Stop | Where-Object Name -Like "$($script:RunnerPrefix)*").Count -ne 0) {
    throw 'An owned-prefix VM exists; investigate it before ACL reproduction.'
}
$switch = Get-VMSwitch -Name $script:RunnerSwitch -ErrorAction Stop
$nat = Get-NetNat -Name $script:RunnerNat -ErrorAction Stop
if ($switch.SwitchType -ne 'Internal' -or $nat.InternalIPInterfaceAddressPrefix -ne '172.30.240.0/29') {
    throw 'The exact dedicated switch/NAT contract is not present.'
}

# Load only the policy definitions, never Runner.ps1's credential/action dispatch.
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Runner.ps1'), [ref]$null, [ref]$null)
foreach ($name in @('Set-IsolatedAdapter', 'Get-RuleFingerprint', 'Assert-AdapterRules')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $definition) { throw 'ACL policy definition is missing.' }
    Invoke-Expression $definition.Extent.Text
}

$script:AclProbeName = "$($script:RunnerPrefix)$([guid]::NewGuid().ToString('N'))"
$instance = Assert-OwnedPath (Join-Path (Join-Path $script:RunnerRoot 'instances') $script:AclProbeName)
if (Test-Path -LiteralPath $instance) { throw 'Fresh diagnostic path already exists; refusing adoption.' }
$paths = Get-RunnerSessionPaths ([pscustomobject]@{ vmName = $script:AclProbeName; instancePath = $instance; layoutVersion = 2 })
$probeTag = "$($script:RunnerTag)-acl-probe"
$vmId = $null
$phase = 'creating'
$script:AclProbeRuleIndex = 0
$script:AclProbeRule = $null
$script:AclProbeOperation = 'creation'
$script:AclProbeDeadline = [DateTime]::UtcNow.AddMinutes(2)
$report = [ordered]@{
    kind = 'diskless-never-booted-acl-probe'; vmName = $script:AclProbeName
    vmId = $null; stage = 'creation'; consumedJobId = $attempt.jobId
    succeeded = $false; errorType = $null; errorId = $null; error = $null
    failedRuleIndex = $null; failedRule = $null; cleanupVerified = $false; cleanupError = $null
}

function Add-VMNetworkAdapterExtendedAcl {
    [CmdletBinding()]
    param([string]$VMName, $Action, $Direction, $Weight, [switch]$Passthru,
        $RemoteIPAddress, $RemotePort, $Protocol, $Stateful, $LocalPort)
    if ($VMName -cne $script:AclProbeName) { throw 'Diagnostic rule target changed.' }
    if ([DateTime]::UtcNow -ge $script:AclProbeDeadline) { throw 'ACL reproduction exceeded its two-minute operation deadline.' }
    $script:AclProbeRuleIndex++
    $script:AclProbeOperation = 'acl-add'
    $script:AclProbeRule = [ordered]@{
        action = $Action; direction = $Direction; weight = $Weight
        remoteIp = $RemoteIPAddress; remotePort = $RemotePort; localPort = $LocalPort
        protocol = $Protocol; stateful = $Stateful
    }
    # Module qualification avoids recursion and preserves the exact policy args.
    Hyper-V\Add-VMNetworkAdapterExtendedAcl @PSBoundParameters
}

function Get-VMNetworkAdapterExtendedAcl {
    [CmdletBinding()]
    param([string]$VMName)
    if ($VMName -cne $script:AclProbeName) { throw 'Diagnostic readback target changed.' }
    $script:AclProbeOperation = 'acl-readback'
    Hyper-V\Get-VMNetworkAdapterExtendedAcl @PSBoundParameters
}

try {
    New-Item -ItemType Directory -Path $instance -ErrorAction Stop | Out-Null
    Assert-RunnerProtectedPath $instance
    New-Item -ItemType Directory -Path $paths.vmData -ErrorAction Stop | Out-Null
    Write-RunnerJson (Join-Path $instance 'probe-identity.json') ([ordered]@{
        tag = $probeTag; vmName = $script:AclProbeName; instancePath = $instance; layoutVersion = 2
        expectedVmPath = $paths.vmPath; phase = $phase
    })
    $vm = New-VM -Name $script:AclProbeName -Generation 2 -NoVHD -Path $paths.vmData -MemoryStartupBytes 512MB -SwitchName $script:RunnerSwitch -ErrorAction Stop
    $vmId = $vm.Id
    $report.vmId = [string]$vmId
    Assert-RunnerProtectedPath $paths.instance
    $phase = 'created'
    Write-RunnerJson (Join-Path $instance 'probe-identity.json') ([ordered]@{
        tag = $probeTag; vmName = $script:AclProbeName; vmId = [string]$vmId; instancePath = $instance; layoutVersion = 2
        expectedVmPath = $paths.vmPath; phase = $phase
    })
    Set-VM -VM $vm -Notes $probeTag -AutomaticStartAction Nothing -AutomaticStopAction TurnOff -AutomaticCheckpointsEnabled $false -CheckpointType Disabled -ErrorAction Stop
    $phase = 'owned'
    $report.stage = 'network-fingerprint'
    [void](Get-HostNetworkFingerprint)
    $report.stage = 'acl-add-or-readback'
    [void](Set-IsolatedAdapter $script:AclProbeName)
    $report.succeeded = $true
} catch {
    if ($report.stage -eq 'acl-add-or-readback') { $report.stage = $script:AclProbeOperation }
    $report.errorType = $_.Exception.GetType().FullName
    $report.errorId = ConvertTo-RunnerDiagnosticText ([string]$_.FullyQualifiedErrorId)
    $report.error = ConvertTo-RunnerDiagnosticText $_.Exception.Message
    if ($report.stage -eq 'acl-add') {
        $report.failedRuleIndex = $script:AclProbeRuleIndex
        $report.failedRule = $script:AclProbeRule
    }
} finally {
    try {
        if ($null -ne $vmId) {
            $owned = Get-VM -Id $vmId -ErrorAction Stop
            $exactPath = Assert-OwnedPath ($paths.vmPath)
            $actualPath = [IO.Path]::GetFullPath($owned.Path).TrimEnd('\')
            $tagMatches = $owned.Notes -eq $probeTag -or ($phase -eq 'created' -and [string]::IsNullOrEmpty($owned.Notes))
            if ($owned.Id -ne $vmId -or $owned.Name -cne $script:AclProbeName -or $owned.State -ne 'Off' -or
                -not $actualPath.Equals($exactPath, [StringComparison]::OrdinalIgnoreCase) -or -not $tagMatches -or
                @(Get-VMHardDiskDrive -VM $owned -ErrorAction Stop).Count -ne 0) {
                throw 'Diagnostic VM identity/off/path/tag/diskless proof failed; deletion refused.'
            }
            Remove-VM -VM $owned -Force -ErrorAction Stop
            if (Get-VM -Id $vmId -ErrorAction SilentlyContinue) { throw 'Diagnostic VM removal readback failed.' }
        } elseif (Get-VM -Name $script:AclProbeName -ErrorAction SilentlyContinue) {
            throw 'VM creation returned no recorded ID; deletion is refused pending investigation.'
        }
        $resolved = Assert-OwnedPath $instance
        if (Test-Path -LiteralPath $resolved) {
            $links = @(Get-ChildItem -LiteralPath $resolved -Recurse -Force -ErrorAction Stop |
                Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
            if ($links.Count -ne 0) { throw 'Diagnostic folder contains a reparse point; recursive deletion refused.' }
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
        }
        $report.cleanupVerified = $true
    } catch { $report.cleanupError = ConvertTo-RunnerDiagnosticText $_.Exception.Message }
    ConvertTo-Json -InputObject $report -Depth 5 -Compress
}
