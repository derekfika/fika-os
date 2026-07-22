@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PROJECT_NAME=Workforce Operations Platform"
set "PROJECT_DIR=%~dp0shared\workforce-operations-platform"
set "CLASP_USER=derek"
set "DEPLOYMENT_ID=AKfycby66hUERHfHe3v1B-Ok66lXp92xpma7nzdwAITzdyNiqtf7uEgSQWEXqOitO5SMBo-f"

echo.
echo ============================================================
echo  Release %PROJECT_NAME%
echo ============================================================
echo  Apps Script user: %CLASP_USER%
echo  Deployment: %DEPLOYMENT_ID%
echo.

set "MESSAGE="
set /P "MESSAGE=Release description [Update workforce operations platform]: "
if not defined MESSAGE set "MESSAGE=Update workforce operations platform"

set "CONFIRM="
set /P "CONFIRM=Push, deploy and commit this release? [Y/N]: "
if /I not "%CONFIRM%"=="Y" (
  echo Release cancelled.
  exit /b 0
)

call :ensure_clasp_login
if errorlevel 1 goto :failed

call :clasp_command push --force
if errorlevel 1 goto :failed

call :clasp_command deploy --deploymentId "%DEPLOYMENT_ID%" --description "%MESSAGE%"
if errorlevel 1 goto :failed

git add -A -- "shared\workforce-operations-platform"
if errorlevel 1 goto :failed
git add -- "workforcepush.bat" "push-apps-script.bat" "push-git-projects.bat"
if errorlevel 1 goto :failed

call :commit_and_push "%MESSAGE% - workforce operations platform"
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
