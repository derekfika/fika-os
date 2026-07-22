@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PROJECT_NAME=Hospitality Feedback Reporting Dashboard"
set "PROJECT_DIR=%~dp0shared\feedback-reporting-dashboard"
set "CLASP_USER=derek"
set "DEPLOYMENT_ID=AKfycbwvD4UynRxmDuxKvBZWr-7a3ZQZH2XO3Db1d-L5-2v7Hk9VBKjb0RYZeN-mnIN20cCt"

echo.
echo ============================================================
echo  Release %PROJECT_NAME%
echo ============================================================
echo  Apps Script user: %CLASP_USER%
echo  Deployment: %DEPLOYMENT_ID%
echo.

if not exist "%PROJECT_DIR%\.clasp.json" (
  echo ERROR: Missing .clasp.json in "%PROJECT_DIR%".
  echo Link this folder to a new Apps Script project first, then run again.
  echo Example:
  echo   cd /d "%PROJECT_DIR%"
  echo   clasp create --type webapp --title "%PROJECT_NAME%"
  pause
  exit /b 1
)

if "%DEPLOYMENT_ID%"=="REPLACE_WITH_FEEDBACK_REPORTING_DEPLOYMENT_ID" (
  echo ERROR: Add the deployment ID at the top of feedbackreportpush.bat before deploying.
  pause
  exit /b 1
)

set "MESSAGE="
set /P "MESSAGE=Release description [Update feedback reporting dashboard]: "
if not defined MESSAGE set "MESSAGE=Update feedback reporting dashboard"

choice /C YN /N /M "Push, deploy and commit this release? [Y/N]: "
if errorlevel 2 goto :cancelled

call :clasp_command push --force
if errorlevel 1 goto :failed

call :clasp_command deploy --deploymentId "%DEPLOYMENT_ID%" --description "%MESSAGE%"
if errorlevel 1 goto :failed

git add -A -- "shared\feedback-reporting-dashboard" "feedbackreportpush.bat"
if errorlevel 1 goto :failed

call :commit_and_push "%MESSAGE% - feedback reporting dashboard"
if errorlevel 1 goto :failed

echo.
echo SUCCESS: %PROJECT_NAME% pushed, deployed and saved to Git.
pause
exit /b 0

:clasp_command
pushd "%PROJECT_DIR%"
where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  call clasp.cmd %* --user "%CLASP_USER%"
) else (
  call npx.cmd --yes @google/clasp %* --user "%CLASP_USER%"
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

:cancelled
echo.
echo Release cancelled.
exit /b 0
