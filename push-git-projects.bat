@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ============================================================
echo  Commit projects separately and push to Git
echo ============================================================
echo.
echo Separate commits will be created for:
echo   1. Client Booking Platform
echo   2. CPU Dashboard
echo   3. Workforce Operations Platform
echo   4. Angel Court Hospitality Dashboard and root scripts
echo.
echo Existing unstaged changes inside those project folders will
echo be included. Nothing outside this workspace will be touched.
echo.
choice /C YN /N /M "Continue? [Y/N]: "
if errorlevel 2 goto :cancelled

set "MESSAGE="
set /P "MESSAGE=Commit description [Update hospitality platforms]: "
if not defined MESSAGE set "MESSAGE=Update hospitality platforms"

call :commit_folder "Client Booking Platform" "sites\angel-court\booking-platform" "%MESSAGE% - booking platform"
if errorlevel 1 goto :failed

call :commit_folder "CPU Dashboard" "shared\cpu-dashboard" "%MESSAGE% - CPU dashboard"
if errorlevel 1 goto :failed

call :commit_folder "Workforce Operations Platform" "shared\workforce-operations-platform" "%MESSAGE% - workforce operations platform"
if errorlevel 1 goto :failed

echo.
echo ------------------------------------------------------------
echo  Staging Angel Court Hospitality Dashboard
echo ------------------------------------------------------------
git add -A -- "sites\angel-court\dashboard" ^
  "push-apps-script.bat" "push-git-projects.bat" "workforcepush.bat"
if errorlevel 1 goto :failed

call :commit_staged "%MESSAGE% - Angel Court dashboard"
if errorlevel 1 goto :failed

for /F "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not defined BRANCH (
  echo ERROR: Could not determine the current Git branch.
  goto :failed
)

echo.
echo ------------------------------------------------------------
echo  Pushing branch %BRANCH%
echo ------------------------------------------------------------
git push origin "%BRANCH%"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  Project commits and Git push completed successfully.
echo ============================================================
echo.
git status --short
echo.
pause
exit /b 0

:commit_folder
echo.
echo ------------------------------------------------------------
echo  Staging %~1
echo ------------------------------------------------------------
git add -A -- "%~2"
if errorlevel 1 exit /b 1
call :commit_staged "%~3"
exit /b %ERRORLEVEL%

:commit_staged
git diff --cached --quiet
if not errorlevel 1 (
  echo No changes to commit for this project.
  exit /b 0
)

git commit -m "%~1"
if errorlevel 1 exit /b 1
exit /b 0

:failed
echo.
echo ============================================================
echo  Git operation stopped because a step failed.
echo  Review the message above before running the file again.
echo ============================================================
echo.
git status --short
echo.
pause
exit /b 1

:cancelled
echo.
echo Git operation cancelled.
exit /b 0
