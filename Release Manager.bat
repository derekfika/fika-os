@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell could not be found on this computer.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0tools\release-manager\ReleaseManager.ps1"
set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" (
  echo.
  echo Release Manager closed with an error. Exit code: %RESULT%
  pause
)

exit /b %RESULT%
