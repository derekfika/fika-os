@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem Named clasp users. Authorise each once with:
rem   npx.cmd --yes @google/clasp login --user hospitality
rem   npx.cmd --yes @google/clasp login --user cpu
set "HOSPITALITY_CLASP_USER=hospitality"
set "CPU_CLASP_USER=cpu"
set "WORKFORCE_CLASP_USER=derek"

echo.
echo ============================================================
echo  Push Hospitality Apps Script projects
echo ============================================================
echo.
echo   1. Angel Court Hospitality Dashboard
echo   2. Client Booking Platform
echo   3. CPU Dashboard
echo   4. Workforce Operations Platform
echo.
echo Enter any combination:
echo   1     Angel Court dashboard only
echo   2     Client booking platform only
echo   3     CPU dashboard only
echo   4     Workforce operations platform only
echo   12    Angel Court + client platform
echo   13    Angel Court + CPU dashboard
echo   23    Client platform + CPU dashboard
echo   123   Original three projects
echo   1234  All four projects
echo.
echo Accounts:
echo   Hospitality projects: %HOSPITALITY_CLASP_USER%
echo   CPU Dashboard:        %CPU_CLASP_USER%
echo   Workforce Platform:   %WORKFORCE_CLASP_USER%
echo.

set "PROJECTS="
set /P "PROJECTS=Projects to push [123]: "
if not defined PROJECTS set "PROJECTS=123"
set "PROJECTS=%PROJECTS: =%"

echo(%PROJECTS%| findstr /R /X "[1234][1234]*" >nul
if errorlevel 1 goto :invalid_selection

echo.
echo Selected: %PROJECTS%
set "CONFIRM="
set /P "CONFIRM=Push selected projects? [Y/N]: "
if /I not "%CONFIRM%"=="Y" goto :cancelled

if not "%PROJECTS:1=%"=="%PROJECTS%" (
  call :push_project "Angel Court Hospitality Dashboard" "%~dp0sites\angel-court\dashboard" "%HOSPITALITY_CLASP_USER%"
  if errorlevel 1 goto :failed
)

if not "%PROJECTS:2=%"=="%PROJECTS%" (
  call :push_project "Client Booking Platform" "%~dp0sites\angel-court\booking-platform" "%HOSPITALITY_CLASP_USER%"
  if errorlevel 1 goto :failed
)

if not "%PROJECTS:3=%"=="%PROJECTS%" (
  call :push_project "CPU Dashboard" "%~dp0shared\cpu-dashboard" "%CPU_CLASP_USER%"
  if errorlevel 1 goto :failed
)

if not "%PROJECTS:4=%"=="%PROJECTS%" (
  call :ensure_clasp_login "%~dp0shared\workforce-operations-platform" "%WORKFORCE_CLASP_USER%"
  if errorlevel 1 goto :failed
  call :push_project "Workforce Operations Platform" "%~dp0shared\workforce-operations-platform" "%WORKFORCE_CLASP_USER%"
  if errorlevel 1 goto :failed
  call :deploy_project "Workforce Operations Platform" "%~dp0shared\workforce-operations-platform" "%WORKFORCE_CLASP_USER%" "AKfycby66hUERHfHe3v1B-Ok66lXp92xpma7nzdwAITzdyNiqtf7uEgSQWEXqOitO5SMBo-f"
  if errorlevel 1 goto :failed
)

echo.
echo ============================================================
echo  Selected Apps Script projects pushed successfully.
echo ============================================================
echo.
pause
exit /b 0

:push_project
echo.
echo ------------------------------------------------------------
echo  Pushing %~1
echo  Clasp user: %~3
echo ------------------------------------------------------------

if not exist "%~2\.clasp.json" (
  echo ERROR: Missing .clasp.json in "%~2".
  exit /b 1
)

pushd "%~2"

set "PUSH_RESULT=1"
set "PUSH_ATTEMPTS=3"

where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  for /L %%R in (1,1,!PUSH_ATTEMPTS!) do (
    if not "!PUSH_RESULT!"=="0" (
      if %%R GTR 1 (
        echo.
        echo Retrying in 5 seconds... attempt %%R of !PUSH_ATTEMPTS!
        timeout /T 5 /NOBREAK >nul
      )
      call clasp.cmd --user "%~3" push --force
      set "PUSH_RESULT=!ERRORLEVEL!"
    )
  )
) else (
  where npx.cmd >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Neither clasp nor npx was found.
    popd
    exit /b 1
  )
  for /L %%R in (1,1,!PUSH_ATTEMPTS!) do (
    if not "!PUSH_RESULT!"=="0" (
      if %%R GTR 1 (
        echo.
        echo Retrying in 5 seconds... attempt %%R of !PUSH_ATTEMPTS!
        timeout /T 5 /NOBREAK >nul
      )
      call npx.cmd --yes @google/clasp --user "%~3" push --force
      set "PUSH_RESULT=!ERRORLEVEL!"
    )
  )
)

popd

if not "%PUSH_RESULT%"=="0" (
  echo ERROR: %~1 failed to push.
  echo.
  echo If the error contains:
  echo   getaddrinfo ENOTFOUND script.googleapis.com
  echo then this is a DNS or internet connection problem, not a code error.
  echo.
  echo Try:
  echo   1. Check that websites open normally.
  echo   2. Disconnect and reconnect Wi-Fi or VPN.
  echo   3. Run: ipconfig /flushdns
  echo   4. Run: nslookup script.googleapis.com
  echo   5. Retry this batch file.
  exit /b %PUSH_RESULT%
)

echo SUCCESS: %~1
exit /b 0

:ensure_clasp_login
echo.
echo ------------------------------------------------------------
echo  Checking clasp login for %~2
echo ------------------------------------------------------------

pushd "%~1"
where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  call clasp.cmd --user "%~2" login --status >nul 2>nul
  if errorlevel 1 call clasp.cmd --user "%~2" login
) else (
  where npx.cmd >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Neither clasp nor npx was found.
    popd
    exit /b 1
  )
  call npx.cmd --yes @google/clasp --user "%~2" login --status >nul 2>nul
  if errorlevel 1 call npx.cmd --yes @google/clasp --user "%~2" login
)
set "LOGIN_RESULT=!ERRORLEVEL!"
popd
exit /b !LOGIN_RESULT!

:deploy_project
echo.
echo ------------------------------------------------------------
echo  Deploying %~1
echo  Clasp user: %~3
echo  Deployment: %~4
echo ------------------------------------------------------------

if not exist "%~2\.clasp.json" (
  echo ERROR: Missing .clasp.json in "%~2".
  exit /b 1
)

pushd "%~2"

set "DEPLOY_RESULT=1"
where clasp.cmd >nul 2>nul
if not errorlevel 1 (
  call clasp.cmd --user "%~3" deploy --deploymentId "%~4" --description "Batch deploy %DATE% %TIME%"
  set "DEPLOY_RESULT=!ERRORLEVEL!"
) else (
  where npx.cmd >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Neither clasp nor npx was found.
    popd
    exit /b 1
  )
  call npx.cmd --yes @google/clasp --user "%~3" deploy --deploymentId "%~4" --description "Batch deploy %DATE% %TIME%"
  set "DEPLOY_RESULT=!ERRORLEVEL!"
)

popd

if not "%DEPLOY_RESULT%"=="0" (
  echo ERROR: %~1 failed to deploy.
  exit /b %DEPLOY_RESULT%
)

echo SUCCESS: %~1 deployed
exit /b 0

:failed
echo.
echo ============================================================
echo  Push stopped because a project failed.
echo  Later projects were not pushed.
echo ============================================================
echo.
pause
exit /b 1

:cancelled
echo.
echo Push cancelled.
exit /b 0

:invalid_selection
echo.
echo ERROR: Enter only project numbers 1, 2, 3 and 4.
echo Examples: 1, 12, 23, 4 or 1234.
echo.
pause
exit /b 1
