@echo off
setlocal
title FIKA OS Deploy Control
cd /d "%~dp0"
echo Starting FIKA OS Deploy Control on http://127.0.0.1:4180 ^(production deploys disabled^)
start "" http://127.0.0.1:4180
node.exe tools\deploy-dashboard\server.mjs %*
pause
