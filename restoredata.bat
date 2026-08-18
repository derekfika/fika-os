@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Restore FIKA OS Data
color 0A

set "FIKA_ROOT=C:\FIKA"
set "APP_DIR=C:\FIKA\apps\integration-hub"
set "RECOVERY_DIR=C:\FIKA\recovery\integration-hub-restore"

echo.
echo ==================================================
echo             FIKA OS DATA RESTORE
echo ==================================================
echo.
echo This will NOT delete or overwrite existing data.
echo It will create a new dated restored-data folder.
echo.

if not exist "%APP_DIR%\firebase.json" (
    echo ERROR: %APP_DIR%\firebase.json was not found.
    goto :failed
)

if not exist "%APP_DIR%\package.json" (
    echo ERROR: The Integration Hub was not found.
    goto :failed
)

if not exist "%RECOVERY_DIR%" (
    echo ERROR: The extracted recovery folder was not found.
    echo.
    echo Extract integration-hub(1).zip to:
    echo %RECOVERY_DIR%
    goto :failed
)

where firebase.cmd >nul 2>&1
if errorlevel 1 (
    echo ERROR: firebase.cmd was not found.
    goto :failed
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm.cmd was not found.
    goto :failed
)

echo Finding the recovered Firebase export...

set "RESTORE_METADATA="

for /f "usebackq delims=" %%F in (`powershell.exe -NoProfile -Command "$f = Get-ChildItem -LiteralPath '%RECOVERY_DIR%' -Recurse -File -Filter 'firebase-export-metadata.json' -ErrorAction SilentlyContinue ^| Sort-Object LastWriteTimeUtc -Descending ^| Select-Object -First 1; if ($f) { $f.FullName }"`) do (
    set "RESTORE_METADATA=%%F"
)

if not defined RESTORE_METADATA (
    echo.
    echo ERROR: No Firebase export was found inside:
    echo %RECOVERY_DIR%
    goto :failed
)

for %%D in ("!RESTORE_METADATA!") do set "RESTORE_PATH=%%~dpD"
if "!RESTORE_PATH:~-1!"=="\" set "RESTORE_PATH=!RESTORE_PATH:~0,-1!"

for /f "delims=" %%T in ('powershell.exe -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HHmmss'"') do (
    set "STAMP=%%T"
)

set "NEW_LOCAL_DATA=%FIKA_ROOT%\local-data-restored-!STAMP!"

echo.
echo Recovery export found:
echo !RESTORE_PATH!
echo.
echo Restored data will be saved to:
echo !NEW_LOCAL_DATA!
echo.
echo Your existing C:\FIKA\local-data will remain untouched.
echo.

choice /C YN /N /M "Start the restore? [Y/N]: "
if errorlevel 2 goto :cancelled

echo !NEW_LOCAL_DATA!>"%FIKA_ROOT%\RESTORED_DATA_PATH.txt"

echo.
echo Starting the Integration Hub in another window...
start "FIKA Integration Hub" cmd.exe /k "cd /d ""%APP_DIR%"" && npm.cmd run dev"

echo.
echo Starting Firebase with the recovered data...
echo.
echo Refresh FIKA OS and check:
echo   - Legends
echo   - OPLOCs
echo   - Munich RE
echo.
echo When everything is confirmed, press Ctrl+C in this window.
echo Wait for Firebase to finish saving before closing it.
echo.

cd /d "%APP_DIR%"

call firebase.cmd emulators:start ^
  --import="!RESTORE_PATH!" ^
  --export-on-exit="!NEW_LOCAL_DATA!"

echo.
if exist "!NEW_LOCAL_DATA!\firebase-export-metadata.json" (
    echo SUCCESS!
    echo.
    echo The restored data has been saved to:
    echo !NEW_LOCAL_DATA!
    echo.
    echo This location is also recorded in:
    echo %FIKA_ROOT%\RESTORED_DATA_PATH.txt
) else (
    echo WARNING:
    echo Firebase stopped, but the completed export was not found.
    echo Keep the original recovery ZIP and extracted folder.
)

echo.
pause
exit /b 0

:cancelled
echo.
echo Restore cancelled. Nothing was changed.
pause
exit /b 0

:failed
echo.
echo Nothing was changed.
pause
exit /b 1