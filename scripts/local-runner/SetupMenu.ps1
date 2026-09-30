param([switch] $Elevated)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = "-NoProfile -NoExit -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments
    return
}

. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Update.ps1')

function Install-ControlLinks {
    Assert-SecureRoot
    [void](Get-RunnerConfig)
    $desktop = [Environment]::GetFolderPath('Desktop')
    if (-not $desktop) { throw 'Windows Desktop location is unavailable.' }
    $folder = Join-Path $desktop 'IT Inventory Runner'
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    foreach ($name in @('Start', 'Restart', 'Stop', 'Status')) {
        $link = $shell.CreateShortcut((Join-Path $folder "$name.lnk"))
        $link.TargetPath = Join-Path (Join-Path $script:RunnerRoot 'bin') "$name.cmd"
        $link.WorkingDirectory = Join-Path $script:RunnerRoot 'bin'
        $link.Description = "IT Inventory local runner: $name"
        $link.Save()
    }
    Write-Host "Control shortcuts are in $folder"
}

while ($true) {
    Write-Host ''
    Write-Host 'IT Inventory local runner setup'
    Write-Host '1. Enable Hyper-V (one time; never restarts Windows automatically)'
    Write-Host '2. Install/resume setup or explicitly update the stopped installed bundle'
    Write-Host '3. Store the repository-scoped GitHub token locally'
    Write-Host '4. Status (activation, consumed pilot, safe failure stage/code)'
    Write-Host '5. Enable one-job pilot and start (only after independent review)'
    Write-Host '6. Enable active pickup and start (requires successful recorded pilot proof)'
    Write-Host '7. Exit'
    Write-Host '8. Diagnose recorded converter (read-only; no install)'
    Write-Host '9. Maintainer retry/resume (archives evidence; exact recorded SHA/reason resumes interruption)'
    $choice = Read-Host 'Choose 1-9'
    try {
        switch ($choice) {
            '1' { & (Join-Path $PSScriptRoot 'Setup.ps1') -EnableHyperV }
            '2' {
                if (-not (Test-Path -LiteralPath $script:RunnerConfigPath)) {
                    & (Join-Path $PSScriptRoot 'Setup.ps1')
                } else {
                    $update = Read-RunnerJson (Join-Path $script:RunnerRoot 'update-journal.json')
                    if ($null -ne $update -and $update.phase -ceq 'pending') { Install-RunnerBundle $PSScriptRoot -Resume }
                    else { Install-RunnerBundle $PSScriptRoot }
                }
                Install-ControlLinks
            }
            '3' {
                Assert-RunnerBundleCurrent $PSScriptRoot
                & (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') -Action StoreCredential
            }
            '4' { & (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') -Action Status }
            '5' {
                Assert-RunnerBundleCurrent $PSScriptRoot
                $pilotSha = Read-Host 'Reviewed pilot head SHA (full 40-character lowercase SHA)'
                & (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') -Action EnablePilot -ExpectedPilotSha $pilotSha
                & (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') -Action Start
            }
            '6' {
                Assert-RunnerBundleCurrent $PSScriptRoot
                & (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') -Action EnableActive
                & (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') -Action Start
            }
            '7' { return }
            '8' {
                . (Join-Path $PSScriptRoot 'Common.ps1')
                Invoke-ConverterDiagnostics
            }
            '9' {
                Assert-RunnerBundleCurrent $PSScriptRoot -AllowPendingRetry
                $retry = Read-RunnerJson (Join-Path $script:RunnerRoot 'pilot-retry.json')
                if ($null -ne $retry -and $retry.phase -ceq 'pending') {
                    $pilotSha = $retry.nextSha
                    $reason = $retry.reason
                    Write-Host 'Resuming the recorded retry using its verified installed bundle and exact recorded SHA/reason.'
                } else {
                    $pilotSha = Read-Host 'New reviewed SHA (40 lowercase characters)'
                    $reason = Read-Host 'Investigation reason (nonsecret)'
                }
                & (Join-Path (Join-Path $script:RunnerRoot 'bin') 'Runner.ps1') -Action RetryPilot -ExpectedPilotSha $pilotSha -RetryReason $reason
            }
            default { Write-Host 'Choose a number from 1 to 9.' }
        }
    } catch {
        Write-Host "Setup stopped safely: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host 'Use option 1 if Hyper-V is missing; otherwise correct the reported prerequisite and retry option 2.'
    }
    [void](Read-Host 'Press Enter to return to the setup menu')
}
