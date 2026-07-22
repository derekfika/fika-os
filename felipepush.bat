@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PROJECT_NAME=Felipe MNK Client Dashboard"
set "PROJECT_DIR=%~dp0sites\mnk\client-dashboard"
set "CLASP_USER=mnk"
set "DEPLOYMENT_ID=AKfycbzWUXyhI0JaUSSi-_bNVkVcZUVpxJaSA9sPWSVt3RYpcR08TaWFmsAd_o0lKS6lbffXrA"

echo.
echo ============================================================
echo  Release %PROJECT_NAME%
echo ============================================================
echo  Apps Script user: %CLASP_USER%
echo  Deployment: %DEPLOYMENT_ID%
echo.

if not exist "%PROJECT_DIR%\appsscript.json" (
  echo ERROR: Missing appsscript.json in "%PROJECT_DIR%".
  goto :failed
)

if not exist "%PROJECT_DIR%\.clasp.json" (
  echo ERROR: Missing .clasp.json in "%PROJECT_DIR%".
  goto :failed
)

set "MESSAGE="
set /P "MESSAGE=Release description [Update Felipe MNK client dashboard]: "
if not defined MESSAGE set "MESSAGE=Update Felipe MNK client dashboard"

choice /C YN /N /M "Push, deploy, commit and Git push? [Y/N]: "
if errorlevel 2 goto :cancelled

call :clasp_command push --force
if errorlevel 1 goto :failed

call :clasp_command deploy --deploymentId "%DEPLOYMENT_ID%" --description "%MESSAGE%"
if errorlevel 1 goto :failed

git add -A -- "sites\mnk\client-dashboard" "felipepush.bat" "README.md"
if errorlevel 1 goto :failed

call :commit_and_push "%MESSAGE% - Felipe MNK client dashboard"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  Felipe portal pushed, deployed and saved to Git.
echo ============================================================
echo.
git status --short
echo.
pause
exit /b 0

:clasp_command
pushd "%PROJECT_DIR%"
where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  call clasp.cmd --user "%CLASP_USER%" %*
) else (
  where npx.cmd >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Neither clasp nor npx was found.
    popd
    exit /b 1
  )
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
if not defined BRANCH (
  echo ERROR: Could not determine the current Git branch.
  exit /b 1
)

git push origin "!BRANCH!"
exit /b !ERRORLEVEL!

:failed
echo.
echo ============================================================
echo  Felipe portal release stopped because a step failed.
echo ============================================================
echo.
git status --short
echo.
pause
exit /b 1

:cancelled
echo.
echo Felipe portal release cancelled.
exit /b 0
