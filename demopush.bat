@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "CLASP_USER=derek"
set "DASHBOARD_NAME=Demo Hospitality Dashboard"
set "DASHBOARD_DIR=%~dp0sites\demo\dashboard"
set "DASHBOARD_DEPLOYMENT_ID=AKfycbzz8_F6NJENmXIRmAFZAliGIjTEQpZ5nn107Oq21HfjRx4JcR2GpdQANkvBeVgdcE7x"
set "BOOKING_NAME=Demo Booking Platform"
set "BOOKING_DIR=%~dp0sites\demo\booking-platform"
set "BOOKING_DEPLOYMENT_ID=AKfycbwpG_q6xIaAsKaUrITW4LA1NImALjot8n1i-PqsQYBAMICa2gkiVi5bPdEoeDPjdUoi"

echo.
echo ============================================================
echo  Release demo hospitality projects
echo ============================================================
echo.
echo   1. Demo Hospitality Dashboard
echo   2. Demo Client Booking Platform
echo   12. Both projects
echo.
echo Apps Script user: %CLASP_USER%
echo.

set "PROJECTS="
set /P "PROJECTS=Projects to release [12]: "
if not defined PROJECTS set "PROJECTS=12"
set "PROJECTS=%PROJECTS: =%"

echo(%PROJECTS%| findstr /R /X "[12][12]*" >nul
if errorlevel 1 goto :invalid_selection

set "MESSAGE="
set /P "MESSAGE=Release description [Update demo hospitality platforms]: "
if not defined MESSAGE set "MESSAGE=Update demo hospitality platforms"

echo.
echo Selected: %PROJECTS%
choice /C YN /N /M "Push, deploy, commit and Git push? [Y/N]: "
if errorlevel 2 goto :cancelled

if not "%PROJECTS:1=%"=="%PROJECTS%" (
  call :release_project "%DASHBOARD_NAME%" "%DASHBOARD_DIR%" "%DASHBOARD_DEPLOYMENT_ID%" "%MESSAGE%"
  if errorlevel 1 goto :failed
)

if not "%PROJECTS:2=%"=="%PROJECTS%" (
  call :release_project "%BOOKING_NAME%" "%BOOKING_DIR%" "%BOOKING_DEPLOYMENT_ID%" "%MESSAGE%"
  if errorlevel 1 goto :failed
)

echo.
echo ------------------------------------------------------------
echo  Staging demo files for Git
echo ------------------------------------------------------------
git add -A -- "sites\demo" "demopush.bat"
if errorlevel 1 goto :failed

call :commit_and_push "%MESSAGE% - demo hospitality platforms"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  Demo projects pushed, deployed and saved to Git.
echo ============================================================
echo.
git status --short
echo.
pause
exit /b 0

:release_project
echo.
echo ------------------------------------------------------------
echo  Releasing %~1
echo  Folder: %~2
echo  Deployment: %~3
echo ------------------------------------------------------------

if not exist "%~2\appsscript.json" (
  echo ERROR: Missing appsscript.json in "%~2".
  exit /b 1
)

if not exist "%~2\.clasp.json" (
  echo ERROR: Missing .clasp.json in "%~2".
  echo Link this folder to the new Apps Script project first, then run this again.
  echo Example:
  echo   cd /d "%~2"
  echo   clasp create --type webapp --title "%~1"
  echo or:
  echo   clasp clone SCRIPT_ID
  exit /b 1
)

if "%~3"=="REPLACE_WITH_DEMO_DASHBOARD_DEPLOYMENT_ID" (
  echo ERROR: Set DASHBOARD_DEPLOYMENT_ID at the top of demopush.bat before deploying.
  exit /b 1
)

if "%~3"=="REPLACE_WITH_DEMO_BOOKING_DEPLOYMENT_ID" (
  echo ERROR: Set BOOKING_DEPLOYMENT_ID at the top of demopush.bat before deploying.
  exit /b 1
)

call :clasp_command "%~2" push --force
if errorlevel 1 exit /b 1

call :clasp_command "%~2" deploy --deploymentId "%~3" --description "%~4"
if errorlevel 1 exit /b 1

echo SUCCESS: %~1
exit /b 0

:clasp_command
pushd "%~1"
where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  call clasp.cmd --user "%CLASP_USER%" %2 %3 %4 %5 %6 %7 %8 %9
) else (
  where npx.cmd >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Neither clasp nor npx was found.
    popd
    exit /b 1
  )
  call npx.cmd --yes @google/clasp --user "%CLASP_USER%" %2 %3 %4 %5 %6 %7 %8 %9
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
echo  Demo release stopped because a step failed.
echo ============================================================
echo.
git status --short
echo.
pause
exit /b 1

:cancelled
echo.
echo Demo release cancelled.
exit /b 0

:invalid_selection
echo.
echo ERROR: Enter only project numbers 1 and 2.
echo Examples: 1, 2 or 12.
echo.
pause
exit /b 1
