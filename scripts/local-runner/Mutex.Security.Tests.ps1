# In-memory production descriptor policy; kernel contention uses isolated user fixtures.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
function Assert-Rejected([scriptblock] $Work, [string] $Case) {
    $rejected = $false; try { & $Work } catch { $rejected = $true }
    if (-not $rejected) { throw "Mutex policy accepted $Case." }
}
function Security([string] $Sddl) {
    $acl = [Security.AccessControl.MutexSecurity]::new()
    $acl.SetSecurityDescriptorSddlForm($Sddl)
    return $acl
}
$descriptor = New-RunnerMutexSecurity 'Global\ITInventoryLocalRunner-v1'
Assert-RunnerMutexSecurity $descriptor 'Global\ITInventoryLocalRunner-v1'
if (-not $descriptor.AreAccessRulesProtected -or @($descriptor.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])).Count -ne 2) { throw 'New mutex descriptor omitted protected dual-principal grants.' }
$full = [int][Security.AccessControl.MutexRights]::FullControl
Assert-RunnerMutexSecurity (Security "O:SYD:(A;;$full;;;SY)") 'legacy'
Assert-RunnerMutexSecurity (Security "O:BAD:P(A;;$full;;;SY)(A;;$full;;;BA)") 'administrator'
$scheduleSid = 'S-1-5-80-4125092361-1567024937-842823819-2091237918-836075745'
$captured = "O:SYD:(A;;RC;;;OW)(A;;0x1f0001;;;SY)(A;;0x1f0001;;;$scheduleSid)"
$canonicalNames = @('Global\ITInventoryLocalRunner-v1', 'Global\ITInventoryLocalRunner-Control-v1', 'Global\ITInventoryLocalRunner-Supervisor-v1', 'Global\ITInventoryLocalRunner-Archive-v1')
foreach ($canonical in $canonicalNames) { Assert-RunnerMutexSecurity (Security $captured) $canonical }
foreach ($entry in @(
    @{ sddl = $captured.Replace($scheduleSid, 'S-1-5-80-1-2-3-4-5'); name = 'another service SID' },
    @{ sddl = $captured.Replace('O:SY', 'O:BA'); name = 'another legacy owner' },
    @{ sddl = $captured.Replace('(A;;RC;;;OW)', '(A;;RCWD;;;OW)'); name = 'owner rights include write' },
    @{ sddl = $captured.Replace('(A;;RC;;;OW)', '(A;ID;RC;;;OW)'); name = 'inherited owner rights' },
    @{ sddl = $captured.Replace('(A;;RC;;;OW)', '(D;;RC;;;OW)'); name = 'legacy deny' },
    @{ sddl = $captured + '(A;;RC;;;WD)'; name = 'additional legacy grant' },
    @{ sddl = $captured.Replace('(A;;0x1f0001;;;SY)', '(A;;RC;;;SY)'); name = 'restricted legacy SYSTEM' },
    @{ sddl = $captured.Replace("(A;;0x1f0001;;;$scheduleSid)", "(A;;RC;;;$scheduleSid)"); name = 'restricted Schedule' },
    @{ sddl = $captured.Replace('(A;;RC;;;OW)', ''); name = 'missing owner rights' }
)) { Assert-Rejected { Assert-RunnerMutexSecurity (Security $entry.sddl) $canonicalNames[2] } $entry.name }
foreach ($name in @('legacy', 'Global\ITInventoryLocalRunner-Supervisor-v1-extra', 'Local\ITInventoryLocalRunner-v1', 'Global\ITIR-fixture')) {
    Assert-Rejected { Assert-RunnerMutexSecurity (Security $captured) $name } 'Schedule legacy descriptor outside exact names'
}
foreach ($entry in @(
    @{ sddl = "O:WDD:P(A;;$full;;;SY)(A;;$full;;;BA)"; name = 'outside owner' },
    @{ sddl = "O:SYD:P(A;;$full;;;SY)(A;;$full;;;BA)(A;;$full;;;WD)"; name = 'outside grant' },
    @{ sddl = "O:SYD:P(D;;1;;;BA)(A;;$full;;;SY)(A;;$full;;;BA)"; name = 'deny' },
    @{ sddl = "O:SYD:P(A;ID;$full;;;SY)(A;;$full;;;BA)"; name = 'inherited grant' },
    @{ sddl = "O:SYD:P(A;;$full;;;SY)(A;;1;;;BA)"; name = 'restricted admin' },
    @{ sddl = "O:SYD:(A;;$full;;;SY)(A;;$full;;;BA)"; name = 'unprotected dual ACL' },
    @{ sddl = "O:BAD:P(A;;$full;;;SY)"; name = 'admin-owned legacy shape' },
    @{ sddl = 'O:SYD:P'; name = 'empty DACL' }
)) { Assert-Rejected { Assert-RunnerMutexSecurity (Security $entry.sddl) $entry.name } $entry.name }
# Ordinary-user native constructor still exercises the real lock implementation.
# The injection is restricted to a GUID test namespace and never ships in Bundle.
. (Join-Path $PSScriptRoot 'Test.Mutex.ps1')
Assert-Rejected { New-RunnerMutexSecurity 'Global\ITInventoryLocalRunner-v1' } 'runtime namespace through fixture factory'
$name = 'Local\ITIR-security-' + [guid]::NewGuid().ToString('N')
$lock = Enter-RunnerLock $name -FailFast
try {
    Assert-RunnerMutexSecurity ($lock.GetAccessControl()) $name
    # Reentrant ownership remains legal; real cross-process contention/abandon
    # stays covered by Contract/Lifecycle.Atomicity/Runner.Latency suites.
    $second = Enter-RunnerLock $name -FailFast
    Exit-RunnerLock $second
} finally { Exit-RunnerLock $lock }
Write-Host 'Runner mutex security policy checks passed (cross-principal kernel proof requires elevated bridge).'
