@echo off
setlocal

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERR PowerShell is required to run the Spore Code installer.
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
