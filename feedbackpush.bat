@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PROJECT_NAME=Client Feedback Portal"
set "PROJECT_DIR=%~dp0shared\client-feedback-portal"
set "CLASP_USER=derek"
set "DEPLOYMENT_FILE=%PROJECT_DIR%\.deployment-id"

if not exist "%PROJECT_DIR%\.clasp.json" (
  echo.
  echo This feedback portal has not been linked to Apps Script yet.
  set "SCRIPT_ID="
  set /P "SCRIPT_ID=Paste the Apps Script project Script ID: "
  if not defined SCRIPT_ID (
    echo ERROR: A Script ID is required.
    pause
    exit /b 1
  )
  >"%PROJECT_DIR%\.clasp.json" echo {"scriptId":"!SCRIPT_ID!","rootDir":"."}
)

call :ensure_clasp_login
if errorlevel 1 goto :failed

set "DEPLOYMENT_ID="
if exist "%DEPLOYMENT_FILE%" set /P "DEPLOYMENT_ID="<"%DEPLOYMENT_FILE%"
if not defined DEPLOYMENT_ID (
  echo.
  echo Paste the existing web-app Deployment ID.
  echo You can leave this blank for the first deployment.
  set /P "DEPLOYMENT_ID=Deployment ID: "
)

echo.
echo ============================================================
echo  Release %PROJECT_NAME%
echo ============================================================
echo  Apps Script user: %CLASP_USER%
if defined DEPLOYMENT_ID (
  echo  Deployment: !DEPLOYMENT_ID!
) else (
  echo  Deployment: new deployment
)
echo.

set "MESSAGE="
set /P "MESSAGE=Release description [Update client feedback portal]: "
if not defined MESSAGE set "MESSAGE=Update client feedback portal"

set "CONFIRM="
set /P "CONFIRM=Push, deploy and commit this release? [Y/N]: "
if /I not "%CONFIRM%"=="Y" (
  echo Release cancelled.
  exit /b 0
)

call :clasp_command push --force
if errorlevel 1 goto :failed

if defined DEPLOYMENT_ID (
  call :clasp_command deploy --deploymentId "!DEPLOYMENT_ID!" --description "%MESSAGE%"
  if errorlevel 1 goto :failed
) else (
  set "DEPLOY_OUTPUT=%TEMP%\fika-feedback-deploy-%RANDOM%.txt"
  call :clasp_command deploy --description "%MESSAGE%" >"!DEPLOY_OUTPUT!" 2>&1
  set "RESULT=!ERRORLEVEL!"
  type "!DEPLOY_OUTPUT!"
  if not "!RESULT!"=="0" (
    del /q "!DEPLOY_OUTPUT!" >nul 2>nul
    goto :failed
  )
  for /F "tokens=2" %%D in ('findstr /R /C:"Deployed AKfy" "!DEPLOY_OUTPUT!"') do set "DEPLOYMENT_ID=%%D"
  del /q "!DEPLOY_OUTPUT!" >nul 2>nul
  if not defined DEPLOYMENT_ID (
    echo ERROR: Deployment succeeded, but its ID could not be read.
    echo Copy the Deployment ID into:
    echo %DEPLOYMENT_FILE%
    pause
    exit /b 1
  )
  >"%DEPLOYMENT_FILE%" echo !DEPLOYMENT_ID!
  echo Saved deployment ID: !DEPLOYMENT_ID!
)

git add -A -- "shared\client-feedback-portal"
if errorlevel 1 goto :failed
git add -- "feedbackpush.bat"
if errorlevel 1 goto :failed

call :commit_and_push "%MESSAGE% - client feedback portal"
if errorlevel 1 goto :failed

echo.
echo SUCCESS: %PROJECT_NAME% pushed, deployed and saved to Git.
pause
exit /b 0

:ensure_clasp_login
pushd "%PROJECT_DIR%"
where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  call clasp.cmd --user "%CLASP_USER%" login --status >nul 2>nul
  if errorlevel 1 call clasp.cmd --user "%CLASP_USER%" login
) else (
  call npx.cmd --yes @google/clasp --user "%CLASP_USER%" login --status >nul 2>nul
  if errorlevel 1 call npx.cmd --yes @google/clasp --user "%CLASP_USER%" login
)
set "RESULT=!ERRORLEVEL!"
popd
exit /b !RESULT!

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
