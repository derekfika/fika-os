@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "CLASP_USER=derek"
set "TALLY_NAME=Munich RE Hot Drinks Tally"
set "TALLY_DIR=%~dp0shared\munich-hot-drinks"
set "TALLY_SCRIPT_ID=1vIRzFCKT0z9ISnBkpAydOuKypmOrdqk9ZV3EWcCyOp9WROZPBgLdAQyJ"
set "TALLY_DEPLOYMENT_ID=AKfycbzYVXfF7lnCf3PKJpie5aZTkbwytgf0Y_6vUrukQAELMkefT-zrb0fOry2Q5gLrJ3Ov"
set "REPORTING_NAME=Munich RE Hot Drinks Reporting"
set "REPORTING_DIR=%~dp0shared\munich-hot-drinks-reporting"
set "REPORTING_SCRIPT_ID=1KH67PvOzVlnwnYpQBFqcyDqW_EJHkyitNCg8IflZOdTikY-wnPBuLDgj"
set "REPORTING_DEPLOYMENT_ID=AKfycbywwS2A0pULd5ml33wT_BDeCUAZzQJn2duRm5E6SabxiMUcLhsg719TAJu8Y983QQhc"

echo.
echo ============================================================
echo  Release Munich RE hot drinks apps
echo ============================================================
echo.
echo   1. Hot Drinks Tally
echo   2. Hot Drinks Reporting
echo   12. Both apps
echo.
echo Apps Script user: %CLASP_USER%
echo.

set "PROJECTS="
set /P "PROJECTS=Apps to release [12]: "
if not defined PROJECTS set "PROJECTS=12"
set "PROJECTS=%PROJECTS: =%"

echo(%PROJECTS%| findstr /R /X "[12][12]*" >nul
if errorlevel 1 goto :invalid_selection

set "MESSAGE="
set /P "MESSAGE=Release description [Update Munich RE hot drinks apps]: "
if not defined MESSAGE set "MESSAGE=Update Munich RE hot drinks apps"

echo.
echo Selected: %PROJECTS%
choice /C YN /N /M "Push, deploy, commit and Git push? [Y/N]: "
if errorlevel 2 goto :cancelled

if not "%PROJECTS:1=%"=="%PROJECTS%" (
  call :release_project "%TALLY_NAME%" "%TALLY_DIR%" "%TALLY_SCRIPT_ID%" "%TALLY_DEPLOYMENT_ID%" "%MESSAGE%"
  if errorlevel 1 goto :failed
)

if not "%PROJECTS:2=%"=="%PROJECTS%" (
  call :release_project "%REPORTING_NAME%" "%REPORTING_DIR%" "%REPORTING_SCRIPT_ID%" "%REPORTING_DEPLOYMENT_ID%" "%MESSAGE%"
  if errorlevel 1 goto :failed
)

echo.
echo ------------------------------------------------------------
echo  Staging Munich RE hot drinks files for Git
echo ------------------------------------------------------------
git add -A -- "shared\munich-hot-drinks" "shared\munich-hot-drinks-reporting" "hotdrinkspush.bat"
if errorlevel 1 goto :failed

call :commit_and_push "%MESSAGE% - Munich RE hot drinks apps"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  Munich RE hot drinks apps pushed, deployed and saved to Git.
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
echo  Script: %~3
echo  Deployment: %~4
echo ------------------------------------------------------------

if not exist "%~2\appsscript.json" (
  echo ERROR: Missing appsscript.json in "%~2".
  exit /b 1
)

if not exist "%~2\.clasp.json" (
  echo ERROR: Missing .clasp.json in "%~2".
  exit /b 1
)

findstr /C:"%~3" "%~2\.clasp.json" >nul
if errorlevel 1 (
  echo ERROR: "%~2\.clasp.json" does not contain the expected script ID.
  exit /b 1
)

call :clasp_command "%~2" push --force
if errorlevel 1 exit /b 1

call :clasp_command "%~2" deploy --deploymentId "%~4" --description "%~5"
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
echo  Munich RE hot drinks release stopped because a step failed.
echo ============================================================
echo.
git status --short
echo.
pause
exit /b 1

:cancelled
echo.
echo Munich RE hot drinks release cancelled.
exit /b 0

:invalid_selection
echo.
echo ERROR: Enter only app numbers 1 and 2.
echo Examples: 1, 2 or 12.
echo.
pause
exit /b 1
