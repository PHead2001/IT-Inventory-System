# Test-only descriptor injection for real contention under an ordinary user.
# Not bundled or loaded by runtime. Production trust stays SYSTEM/Admin only.
function Assert-FixtureMutexName([string] $Name) {
    if ($Name.Length -gt 240 -or $Name -cnotmatch '^(Local|Global)\\ITIR-[A-Za-z0-9.-]+$' -or $Name -cnotmatch '[0-9a-f]{32}') { throw "Fixture mutex name escaped its unique test namespace: $Name" }
}
function New-RunnerMutexSecurity([string] $Name) {
    Assert-FixtureMutexName $Name
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $security = [Security.AccessControl.MutexSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($sid)
    $security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new($sid,
        [Security.AccessControl.MutexRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    return $security
}
function Assert-RunnerMutexSecurity($Security, [string] $Name) {
    Assert-FixtureMutexName $Name
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rules = @($Security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -ceq $sid -and $_.AccessControlType -eq 'Allow' })
    if ($rules.Count -eq 0 -or @($rules | Where-Object { ([int]$_.MutexRights -band [int][Security.AccessControl.MutexRights]::FullControl) -eq [int][Security.AccessControl.MutexRights]::FullControl }).Count -eq 0) { throw 'Fixture mutex omitted its ordinary-user access.' }
}
