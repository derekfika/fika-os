@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM Commit and push FIKA platform specifications safely
REM Stages ONLY: C:\FIKA\fika-platform-specs
REM ============================================================

set "REPO=C:\FIKA"
set "TARGET=fika-platform-specs"

echo.
echo ============================================================
echo FIKA Platform Specs - Git Commit and Push
echo ============================================================
echo.

if not exist "%REPO%\.git" (
    echo ERROR: No Git repository found at:
    echo %REPO%
    echo.
    pause
    exit /b 1
)

if not exist "%REPO%\%TARGET%" (
    echo ERROR: Folder not found:
    echo %REPO%\%TARGET%
    echo.
    pause
    exit /b 1
)

cd /d "%REPO%" || (
    echo ERROR: Could not open %REPO%
    pause
    exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed or is not available in PATH.
    pause
    exit /b 1
)

echo Repository:
git rev-parse --show-toplevel
echo.

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"

if not defined BRANCH (
    echo ERROR: Could not determine the current Git branch.
    pause
    exit /b 1
)

echo Current branch: %BRANCH%
echo.

echo Current changes inside %TARGET%:
echo ------------------------------------------------------------
git status --short -- "%TARGET%"
echo ------------------------------------------------------------
echo.

git status --porcelain -- "%TARGET%" | findstr . >nul
if errorlevel 1 (
    echo No uncommitted changes were found in %TARGET%.
    echo Nothing to commit.
    echo.
    pause
    exit /b 0
)

echo Staging ONLY %TARGET%...
git add -- "%TARGET%"
if errorlevel 1 (
    echo ERROR: git add failed.
    pause
    exit /b 1
)

echo.
echo Staged files:
echo ------------------------------------------------------------
git diff --cached --stat -- "%TARGET%"
echo ------------------------------------------------------------
echo.

choice /C YN /N /M "Continue with this commit? [Y/N]: "
if errorlevel 2 (
    echo.
    echo Commit cancelled. Staged files remain staged.
    echo To unstage them, run:
    echo git restore --staged -- "%TARGET%"
    echo.
    pause
    exit /b 0
)

echo.
set /p "MESSAGE=Enter commit message [docs: update FIKA platform architecture]: "
if not defined MESSAGE set "MESSAGE=docs: update FIKA platform architecture"

echo.
echo Creating commit...
git commit -m "%MESSAGE%" -- "%TARGET%"
if errorlevel 1 (
    echo.
    echo ERROR: Commit failed.
    echo Review the Git output above.
    pause
    exit /b 1
)

echo.
echo Commit created successfully.
echo.

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo No origin remote is configured.
    echo The commit exists locally but was not pushed.
    echo.
    pause
    exit /b 0
)

choice /C YN /N /M "Push branch '%BRANCH%' to origin now? [Y/N]: "
if errorlevel 2 (
    echo.
    echo Commit saved locally. Push skipped.
    echo.
    pause
    exit /b 0
)

echo.
echo Pushing origin/%BRANCH%...
git push origin "%BRANCH%"
if errorlevel 1 (
    echo.
    echo ERROR: Push failed.
    echo The commit is still safely stored locally.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo SUCCESS
echo Committed and pushed:
echo %REPO%\%TARGET%
echo Branch: %BRANCH%
echo ============================================================
echo.

git log -1 --oneline

echo.
pause
endlocal
