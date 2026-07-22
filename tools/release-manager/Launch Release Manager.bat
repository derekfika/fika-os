@echo off
setlocal EnableExtensions
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0ReleaseManager.ps1"
set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" (
  echo.
  echo Release Manager closed with an error. Exit code: %RESULT%
  pause
)

exit /b %RESULT%
