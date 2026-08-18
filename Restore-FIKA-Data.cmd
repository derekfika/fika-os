@echo off
setlocal
title Restore and Verify FIKA OS Data
cd /d "%~dp0"
if /i "%~1"=="--dry-run" (
  node.exe "%~dp0FIKA-Data-Launcher.cjs" dry-run
  exit /b %ERRORLEVEL%
)
node.exe "%~dp0FIKA-Data-Launcher.cjs" restore
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo Recovery did not complete. No source data was deleted or overwritten.
pause
exit /b %EXIT_CODE%
