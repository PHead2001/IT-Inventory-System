@echo off
powershell.exe -NoProfile -Command "Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\ProgramData\ITInventoryLocalRunner\bin\Runner.ps1 -Action Start'"
