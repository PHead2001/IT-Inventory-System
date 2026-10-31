# Definitions only; no installed imports, VM, credential or network providers.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
trap { Write-Host ('IMAGE_FAILURE_TEST_FAILED checks='+$script:checks+' lines='+(($_.ScriptStackTrace -split '\r?\n' | ForEach-Object {if($_ -match 'line (\d+)'){$Matches[1]}}) -join ','));exit 1 }
$names=@('Assert-RunnerCloudInitFields','Get-RunnerImageFailureStages','Assert-RunnerImageFailureArtifact','ConvertTo-RunnerDiagnosticText','Write-RunnerJson','Assert-RunnerCloudInitPreparationIdentity','Write-RunnerImagePreparationFailure')
foreach($file in @('Common.ps1','Runner.ps1','PreparedImage.ps1')) {
    $errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file),[ref]$null,[ref]$errors)
    if($errors.Count){throw 'IMAGE_FAILURE_SOURCE_PARSE'}
    foreach($node in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {if($node.Name -cin $names){Invoke-Expression $node.Extent.Text}}
}
$script:RunnerRoot=Join-Path $env:TEMP ('ITIR-image-failure-'+[guid]::NewGuid().ToString('N'))
$script:path=Join-Path $script:RunnerRoot 'preparation-image.json'
$script:checks=0
$realWrite=(Get-Command Write-RunnerJson).ScriptBlock
function Require([bool]$Value){$script:checks++;if(-not $Value){throw 'IMAGE_FAILURE_ASSERTION'}}
function Refuses([scriptblock]$Work){$refused=$false;try{& $Work}catch{$refused=$true};Require $refused}
function Copy-Fixture($Value){$Value | ConvertTo-Json -Depth 8 -Compress | ConvertFrom-Json}
function Reset {
    $script:state=[pscustomobject]@{purpose='prepare';vmName=('ITIR-'+('1'*32));vmId='22222222-2222-2222-2222-222222222222'}
    $script:auth=$true;$script:hash='A'*64;$script:depth=0;$script:reads=0;$script:race=$false;$script:failWrite=$false
}
function Assert-RunnerPreparationAuthorized {if(-not $script:auth){throw 'PRIVATE_AUTH'}}
function Assert-SessionAlive {}
function Assert-StateIdentity($State){if($null -eq $State){throw 'PRIVATE_STATE'}}
function Enter-RunnerLock {$script:depth++;return 'fixture'}
function Exit-RunnerLock {$script:depth--}
function Get-RunnerState {$script:reads++;if($script:race -and $script:reads -eq 2){$script:state | Add-Member runnerId 1};return $script:state}
function Get-CoherentInstalledRunnerBundle {return [pscustomobject]@{hash=$script:hash}}
function Assert-OwnedPath($Path){Require ($Path -ceq $script:path);return $Path}
function Assert-RunnerProtectedPath {Require ($script:depth -gt 0)}
function Write-RunnerJson($Path,$Value){if($script:failWrite){throw 'PRIVATE_WRITE'};& $realWrite $Path $Value}
try {
    [void][IO.Directory]::CreateDirectory($script:RunnerRoot)
    foreach($stage in (Get-RunnerImageFailureStages)) {
        Reset;$detail=[ordered]@{exitCode=1;receiptBytes=0;stderr="PRIVATE_LOCAL_ONLY https://user:password@example.test/path`nITIR_IMAGE_FAILURE_STAGE=$stage"}
        Write-RunnerImagePreparationFailure (Copy-Fixture $script:state) ('A'*64) $detail
        $record=[IO.File]::ReadAllText($script:path) | ConvertFrom-Json
        Assert-RunnerImageFailureArtifact $record
        Require ($record.stage -ceq $stage -and $record.stderr.Contains('PRIVATE_LOCAL_ONLY') -and -not $record.stderr.Contains('user:password') -and $script:depth -eq 0)
    }
    foreach($text in @('legacy stderr','ITIR_IMAGE_FAILURE_STAGE=PRIVATE_UNKNOWN','ITIR_IMAGE_FAILURE_STAGE=node PRIVATE_TAIL')) {
        Reset;Write-RunnerImagePreparationFailure (Copy-Fixture $script:state) ('A'*64) ([ordered]@{exitCode=1;receiptBytes=0;stderr=$text})
        Require (([IO.File]::ReadAllText($script:path) | ConvertFrom-Json).stage -ceq 'unknown')
    }
    Reset
    $text=([string][char]0x4e00)*4000+"`nITIR_IMAGE_FAILURE_STAGE=node"
    Write-RunnerImagePreparationFailure (Copy-Fixture $script:state) ('A'*64) ([ordered]@{exitCode=1;receiptBytes=0;stderr=$text})
    $record=[IO.File]::ReadAllText($script:path) | ConvertFrom-Json
    Assert-RunnerImageFailureArtifact $record
    Require ((Get-Item -LiteralPath $script:path).Length -le 8192 -and $record.stage -ceq 'node' -and $record.truncated)
    $saved=[IO.File]::ReadAllText($script:path)
    foreach($case in @('job','verify-image','runnerId','runnerLaunch','claimMode','pilotClaim','imageCandidate','unauthorized','wrong-bundle','stale','race','write-failure','bad-detail')) {
        Reset;$frozen=Copy-Fixture $script:state;$detail=[ordered]@{exitCode=1;receiptBytes=0;stderr='PRIVATE_NEW'}
        switch($case) {
            job {$script:state.purpose='job'}
            verify-image {$script:state.purpose='verify-image'}
            unauthorized {$script:auth=$false}
            wrong-bundle {$script:hash='B'*64}
            stale {$script:state.vmId='33333333-3333-3333-3333-333333333333'}
            race {$script:race=$true}
            write-failure {$script:failWrite=$true}
            bad-detail {$detail.receiptBytes=@(0)}
            default {$script:state | Add-Member $case 1}
        }
        Write-RunnerImagePreparationFailure $frozen ('A'*64) $detail
        Require ([IO.File]::ReadAllText($script:path) -ceq $saved -and $script:depth -eq 0)
    }
    foreach($field in @('stage','exitCode','receiptBytes','stderr','truncated')) {$bad=Copy-Fixture $record;$bad.$field=@($bad.$field);Refuses {Assert-RunnerImageFailureArtifact $bad}}
    $bad=Copy-Fixture $record;$bad | Add-Member private 'PRIVATE';Refuses {Assert-RunnerImageFailureArtifact $bad}
    $bad=Copy-Fixture $record;$bad.stderr="PRIVATE`0";Refuses {Assert-RunnerImageFailureArtifact $bad}
    $bad=Copy-Fixture $record;$bad.exitCode=0;Refuses {Assert-RunnerImageFailureArtifact $bad}
    $bad.receiptBytes=16385;Assert-RunnerImageFailureArtifact $bad;Require $true
    Write-Host "PASS image preparation failure $script:checks assertions; no protected/VM/network providers."
} finally {
    if(Test-Path -LiteralPath $script:RunnerRoot){Remove-Item -LiteralPath $script:RunnerRoot -Recurse -Force}
}
