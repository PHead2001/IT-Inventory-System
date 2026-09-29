# Owner-invoked read-only diagnostic. It never installs or changes host resources.
[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'Common.ps1')
Invoke-ConverterDiagnostics
