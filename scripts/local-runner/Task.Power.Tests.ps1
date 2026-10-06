# Offline task power policy: no scheduler or host power changes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Update.ps1')
$script:RunnerRoot = 'C:\ITIR-task-power-fixture'
$script:tasks = @(); $script:writes = 0; $script:readbackFailure = $false; $script:checks = 0
function New-FixtureTasks {
    $script:writes = 0; $script:readbackFailure = $false
    $script:tasks = @(foreach ($role in @('Watchdog', 'Supervisor')) {
        $action = if ($role -ceq 'Watchdog') { 'Watchdog' } else { 'Supervise' }
        [pscustomobject]@{
            TaskName = 'ITInventoryLocalRunner-' + $role; TaskPath = '\'
            Principal = [pscustomobject]@{UserId='SYSTEM';LogonType='ServiceAccount';RunLevel='Highest'}
            Actions = @([pscustomobject]@{Execute='powershell.exe';Arguments="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script:RunnerRoot\bin\Runner.ps1`" -Action $action";WorkingDirectory=''})
            Settings = [pscustomobject]@{DisallowStartIfOnBatteries=$true;StopIfGoingOnBatteries=$true;ExecutionTimeLimit='PT72H';Enabled=$true;Priority=7;MultipleInstances='IgnoreNew';IdleDuration='PT10M'}
        }
    })
}
function Get-ScheduledTask { param($TaskName) @($script:tasks | Where-Object TaskName -CEQ $TaskName) }
function Set-ScheduledTask {
    param($TaskPath,$TaskName,$Settings)
    if ($TaskPath -cne '\') { throw 'Unexpected task namespace.' }
    $script:writes++
    if ($script:readbackFailure) { $Settings.StopIfGoingOnBatteries = $true }
}
function Assert-Case([bool]$Condition,[string]$Label){if(-not $Condition){throw "Task power regression: $Label"};$script:checks++}
function Reject-Case([scriptblock]$Work,[string]$Label){$failed=$false;try{&$Work}catch{$failed=$true};Assert-Case $failed $Label}
New-FixtureTasks
Set-RunnerBatteryTaskSettings
Assert-Case ($script:writes -eq 2) 'both existing tasks updated'
foreach($task in $script:tasks){
    Assert-Case (-not $task.Settings.DisallowStartIfOnBatteries -and -not $task.Settings.StopIfGoingOnBatteries) 'both battery gates disabled'
    Assert-Case ($task.Settings.ExecutionTimeLimit -ceq 'PT72H' -and $task.Settings.Enabled -and $task.Settings.Priority -eq 7 -and $task.Settings.MultipleInstances -ceq 'IgnoreNew' -and $task.Settings.IdleDuration -ceq 'PT10M') 'unrelated settings preserved'
}
foreach($fault in @('principal','logon','level','path','action','extra-action','working-directory','missing','ambiguous')){
    New-FixtureTasks
    switch($fault){
        'principal'{$script:tasks[1].Principal.UserId='ordinary-user'}
        'logon'{$script:tasks[1].Principal.LogonType='Interactive'}
        'level'{$script:tasks[1].Principal.RunLevel='Limited'}
        'path'{$script:tasks[1].TaskPath='\Other\'}
        'action'{$script:tasks[1].Actions[0].Arguments+=' -Extra'}
        'extra-action'{$script:tasks[1].Actions+= $script:tasks[1].Actions[0]}
        'working-directory'{$script:tasks[1].Actions[0].WorkingDirectory='C:\Other'}
        'missing'{$script:tasks=@($script:tasks[0])}
        'ambiguous'{$script:tasks+= $script:tasks[1]}
    }
    Reject-Case {Set-RunnerBatteryTaskSettings} $fault
    Assert-Case ($script:writes -eq 0) ($fault+' rejected before first settings write')
}
New-FixtureTasks; $script:readbackFailure=$true
Reject-Case {Set-RunnerBatteryTaskSettings} 'provider did not retain power settings'
# Execute the actual fresh-Setup settings expressions with offline command mocks.
function New-ScheduledTaskSettingsSet {
    param([switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,$MultipleInstances,$ExecutionTimeLimit)
    [pscustomobject]@{DisallowStartIfOnBatteries=(-not $AllowStartIfOnBatteries);StopIfGoingOnBatteries=(-not $DontStopIfGoingOnBatteries);MultipleInstances=$MultipleInstances;ExecutionTimeLimit=$ExecutionTimeLimit}
}
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Setup.ps1'),[ref]$null,[ref]$null)
$commands=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'New-ScheduledTaskSettingsSet'},$true))
Assert-Case ($commands.Count -eq 2) 'fresh setup defines both settings'
$fresh=@(foreach($command in $commands){Invoke-Expression $command.Extent.Text})
foreach($settings in $fresh){Assert-Case (-not $settings.DisallowStartIfOnBatteries -and -not $settings.StopIfGoingOnBatteries) 'fresh setup battery gates disabled'}
Assert-Case ($fresh[1].MultipleInstances -ceq 'IgnoreNew' -and $fresh[1].ExecutionTimeLimit -eq [TimeSpan]::Zero) 'supervisor unlimited duration preserved'
Write-Host "$script:checks task power regressions passed (offline)."
