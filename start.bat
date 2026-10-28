@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
start "" http://localhost:3000
node --env-file-if-exists=.env server.js
pause
