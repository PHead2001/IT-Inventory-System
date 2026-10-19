# Nonadmin native-process fixtures only. No network, credentials, VM, scheduler,
# installed runner or production workflow is touched.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Probe.Job.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('ITIR-probejob-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$workers = @(); $jobs = @(); $count = 0
function Await-File([string] $Path) {
    $limit = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $Path)) {
        if ([DateTime]::UtcNow -ge $limit) { throw 'Native probe fixture did not signal.' }
        Start-Sleep -Milliseconds 50
    }
}
function Arguments([string] $Script, [string] $Signal) {
    return (@('-NoProfile', '-NonInteractive', '-File', $Script, '-Root', $Signal) | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
}
try {
    $leaf = Join-Path $root 'leaf.ps1'
    [IO.File]::WriteAllText($leaf, 'param($Root); [IO.File]::WriteAllText((Join-Path $Root ''leaf-pid''), [string]$PID); Start-Sleep -Seconds 60')
    $tree = Join-Path $root 'tree.ps1'
    [IO.File]::WriteAllText($tree, @'
param($Root)
$args = '-NoProfile -NonInteractive -File "' + (Join-Path $Root 'leaf.ps1') + '" -Root "' + $Root + '"'
$child = Start-Process (Join-Path $PSHOME 'powershell.exe') -ArgumentList $args -WindowStyle Hidden -PassThru
try { $child.WaitForExit() } finally { $child.Dispose() }
'@)
    $exe = Join-Path $PSHOME 'powershell.exe'
    $job = [ITIR.ProbeJob]::new($exe, (Arguments $tree $root)); $jobs += $job
    Await-File (Join-Path $root 'leaf-pid')
    $leafProcess = Get-Process -Id ([int][IO.File]::ReadAllText((Join-Path $root 'leaf-pid'))); $workers += $leafProcess
    $job.CancelAndDrain()
    if (-not $leafProcess.WaitForExit(2000)) { throw 'Job cancellation leaked a native descendant.' }
    $count++; Write-Host "PASS cancellation drains descendant process tree: worker PID $($job.ProcessId), descendant PID $($leafProcess.Id) exited."
    Remove-Item -LiteralPath (Join-Path $root 'leaf-pid')

    $owner = Join-Path $root 'owner.ps1'
    [IO.File]::WriteAllText($owner, @'
param($Root, $Helper, $Tree)
. $Helper
$args = '-NoProfile -NonInteractive -File "' + $Tree + '" -Root "' + $Root + '"'
$job = [ITIR.ProbeJob]::new((Join-Path $PSHOME 'powershell.exe'), $args)
[IO.File]::WriteAllText((Join-Path $Root 'owner-ready'), [string]$job.ProcessId)
Start-Sleep -Seconds 60
'@)
    $ownerArgs = @('-NoProfile', '-NonInteractive', '-File', $owner, '-Root', $root, '-Helper', (Join-Path $PSScriptRoot 'Probe.Job.ps1'), '-Tree', $tree)
    $start = [Diagnostics.ProcessStartInfo]::new(); $start.FileName = $exe; $start.Arguments = ($ownerArgs | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $ownerProcess = [Diagnostics.Process]::Start($start); $workers += $ownerProcess
    Await-File (Join-Path $root 'owner-ready'); Await-File (Join-Path $root 'leaf-pid')
    $parentProcess = Get-Process -Id ([int][IO.File]::ReadAllText((Join-Path $root 'owner-ready'))); $workers += $parentProcess
    $leafProcess = Get-Process -Id ([int][IO.File]::ReadAllText((Join-Path $root 'leaf-pid'))); $workers += $leafProcess
    $ownerProcess.Kill()
    if (-not $ownerProcess.WaitForExit(2000) -or -not $parentProcess.WaitForExit(2000) -or -not $leafProcess.WaitForExit(2000)) { throw 'Guardian death did not close the sole job handle and kill descendants.' }
    $count++; Write-Host "PASS guardian death: owner PID $($ownerProcess.Id), worker PID $($parentProcess.Id), descendant PID $($leafProcess.Id) exited."

    $failed = $false
    try { [void][ITIR.ProbeJob]::new((Join-Path $root 'missing.exe'), '') } catch { $failed = $true }
    if (-not $failed) { throw 'Native create failure executed a probe.' }
    $count++; Write-Host 'PASS native process creation failure is closed'

    # Force only the Assign native return false in a separately compiled fixture
    # type. Exercise the real suspended-create/cleanup path, not production flags.
    $text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Probe.Job.ps1'))
    $begin = $text.IndexOf("using System;"); $end = $text.LastIndexOf("'@"); $code = $text.Substring($begin, $end - $begin)
    $code = $code.Replace('namespace ITIR {', 'namespace ITIR.AssignmentFixture {')
    $code = $code.Replace('static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);', 'static extern bool UnusedAssignProcessToJobObject(IntPtr job, IntPtr process); static bool AssignProcessToJobObject(IntPtr job, IntPtr process) { return false; }')
    Add-Type -TypeDefinition $code
    $signal = Join-Path $root 'must-not-execute.ps1'; $ran = Join-Path $root 'assignment-escaped'
    [IO.File]::WriteAllText($signal, '[IO.File]::WriteAllText(''' + $ran.Replace("'", "''") + ''', ''escaped'')')
    $failed = $false
    try { [void][ITIR.AssignmentFixture.ProbeJob]::new($exe, ((@('-NoProfile', '-File', $signal) | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')) } catch { $failed = $true }
    if (-not $failed -or (Test-Path -LiteralPath $ran)) { throw 'Assignment failure allowed suspended worker execution.' }
    $count++; Write-Host 'PASS injected assignment refusal never resumes worker'
    Write-Host "Probe Job Object fixtures passed: $count. Assignment refusal is injected; network/provider continuity is untested."
} finally {
    foreach ($job in $jobs) { $job.Dispose() }
    foreach ($process in $workers) { try { if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(2000) } } finally { $process.Dispose() } }
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ine [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -cnotmatch '^ITIR-probejob-[0-9a-f]{32}$') { throw 'Fixture cleanup escaped TEMP.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
