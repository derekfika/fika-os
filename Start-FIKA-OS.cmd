@echo off
setlocal
title Start FIKA OS
cd /d "%~dp0"
if /i "%~1"=="--dry-run" (
  node.exe "%~dp0FIKA-Data-Launcher.cjs" dry-run
  exit /b %ERRORLEVEL%
)
node.exe "%~dp0FIKA-Data-Launcher.cjs" start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo FIKA OS was not started. Read the message above before trying again.
pause
exit /b %EXIT_CODE%
