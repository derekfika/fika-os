@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PROJECT_NAME=Angel Court Booking Platform"
set "PROJECT_DIR=%~dp0sites\angel-court\booking-platform"
set "CLASP_USER=hospitality"
set "DEPLOYMENT_ID=AKfycbzPU_s9PqvJnVKXT1LAi9ApoIM3SYDbkPkhzACkjis2hso8ZnKTCpRCR7E-3XG4uzAN"

call :release
exit /b %ERRORLEVEL%

:release
echo.
echo ============================================================
echo  Release %PROJECT_NAME%
echo ============================================================
echo  Apps Script user: %CLASP_USER%
echo  Deployment: %DEPLOYMENT_ID%
echo.

set "MESSAGE="
set /P "MESSAGE=Release description [Update Angel Court booking platform]: "
if not defined MESSAGE set "MESSAGE=Update Angel Court booking platform"

set "CONFIRM="
set /P "CONFIRM=Push, deploy and commit this release? [Y/N]: "
if /I not "%CONFIRM%"=="Y" (
  echo Release cancelled.
  exit /b 0
)

call :clasp_command push --force
if errorlevel 1 goto :failed

call :clasp_command deploy --deploymentId "%DEPLOYMENT_ID%" --description "%MESSAGE%"
if errorlevel 1 goto :failed

git add -A -- "sites\angel-court\booking-platform"
if errorlevel 1 goto :failed
git add -- "clientpush.bat"
if errorlevel 1 goto :failed

call :commit_and_push "%MESSAGE% - Angel Court booking platform"
if errorlevel 1 goto :failed

echo.
echo SUCCESS: %PROJECT_NAME% pushed, deployed and saved to Git.
pause
exit /b 0

:clasp_command
pushd "%PROJECT_DIR%"
where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  call clasp.cmd --user "%CLASP_USER%" %*
) else (
  call npx.cmd --yes @google/clasp --user "%CLASP_USER%" %*
)
set "RESULT=!ERRORLEVEL!"
popd
exit /b !RESULT!

:commit_and_push
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "%~1"
  if errorlevel 1 exit /b 1
) else (
  echo No Git changes to commit.
)
for /F "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not defined BRANCH exit /b 1
git push origin "!BRANCH!"
exit /b !ERRORLEVEL!

:failed
echo.
echo ERROR: %PROJECT_NAME% release stopped. Review the error above.
pause
exit /b 1
