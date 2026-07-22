@echo off
setlocal

REM =====================================================
REM FIKA Platform Specs Backup + Git Sync
REM =====================================================

REM -------- CONFIGURATION --------

set "SOURCE=C:\FIKA\fika-platform-specs"
set "BACKUP=C:\FIKA\Backups"

REM -------- CREATE TIMESTAMP --------

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%i"

set "ZIPFILE=%BACKUP%\fika-platform-specs_%STAMP%.zip"

echo.
echo ==========================================
echo FIKA Platform Backup
echo ==========================================
echo.

REM -------- CREATE BACKUP FOLDER --------

if not exist "%BACKUP%" (
    mkdir "%BACKUP%"
)

REM -------- CREATE ZIP --------

echo Creating ZIP archive...
powershell -NoProfile -Command ^
"Compress-Archive -Path '%SOURCE%\*' -DestinationPath '%ZIPFILE%' -Force"

if errorlevel 1 (
    echo.
    echo ERROR: ZIP creation failed.
    pause
    exit /b 1
)

echo.
echo ZIP created successfully:
echo %ZIPFILE%

REM -------- GIT COMMIT --------

echo.
echo ==========================================
echo Git Commit
echo ==========================================
echo.

cd /d "%SOURCE%"

git add -A

git diff --cached --quiet
if %errorlevel% equ 0 (
    echo No repository changes detected.
    goto END
)

set "COMMIT_MESSAGE=Repository backup %STAMP%"

git commit -m "%COMMIT_MESSAGE%"

if errorlevel 1 (
    echo.
    echo ERROR: Git commit failed.
    pause
    exit /b 1
)

REM -------- GIT PUSH --------

echo.
echo Pushing to GitHub...

git push

if errorlevel 1 (
    echo.
    echo ERROR: Git push failed.
    pause
    exit /b 1
)

echo.
echo GitHub push successful.

:END

echo.
echo ==========================================
echo Backup and Git sync completed successfully.
echo ==========================================
echo.

pause