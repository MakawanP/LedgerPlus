@echo off
setlocal
title LedgerPulse — Windows Desktop Application
echo ============================================================================
echo   LedgerPulse for Windows (Desktop ^& Multi-Device Finance Tracker)
echo   Local Disk Vault : %~dp0data\local-ledger-vault.json
echo   Watched Auto-Drop: %~dp0data\inbox\
echo ============================================================================
echo.

cd /d "%~dp0"

if not exist "%~dp0data\inbox" (
  mkdir "%~dp0data\inbox"
)

:: 1. Standalone Release Mode (Bundled runtime\node.exe + server.cjs — Zero Prerequisites)
if exist "%~dp0runtime\node.exe" if exist "%~dp0server.cjs" (
  echo [1/2] Launching LedgerPulse Desktop Window on http://localhost:3000 ...
  start "" cmd /c "timeout /t 2 /nobreak >nul && (start msedge --app=http://localhost:3000 || start chrome --app=http://localhost:3000 || start http://localhost:3000)"
  echo [2/2] Starting bundled LedgerPulse Production Server...
  set NODE_ENV=production
  "%~dp0runtime\node.exe" "%~dp0server.cjs"
  exit /b 0
)

:: Verify system Node.js is installed for Portable Release or Source Dev Mode
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed. Install Node.js 20+ from https://nodejs.org/
  echo         or download LedgerPulse-Windows-x64-Standalone.zip from GitHub Releases.
  pause
  exit /b 1
)

:: 2. Portable Built Release Mode (Prebuilt dist\ + server.cjs — No npm install required)
if exist "%~dp0server.cjs" if exist "%~dp0dist\index.html" (
  echo [1/2] Launching LedgerPulse Desktop Window on http://localhost:3000 ...
  start "" cmd /c "timeout /t 2 /nobreak >nul && (start msedge --app=http://localhost:3000 || start chrome --app=http://localhost:3000 || start http://localhost:3000)"
  echo [2/2] Starting LedgerPulse Production Server...
  set NODE_ENV=production
  node "%~dp0server.cjs"
  exit /b 0
)

:: 3. Developer Source Mode
if not exist "%~dp0node_modules" (
  echo [1/3] Installing local dependencies...
  call npm install
)

echo [2/3] Launching native Windows Desktop Window on http://localhost:3000 ...
start "" cmd /c "timeout /t 3 /nobreak >nul && (start msedge --app=http://localhost:3000 || start chrome --app=http://localhost:3000 || start http://localhost:3000)"

echo [3/3] Starting local LedgerPulse Server (Keep minimized while using the app)...
call npm run dev
