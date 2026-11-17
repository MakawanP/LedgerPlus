@echo off
title LedgerPulse — Local Windows Finance App
echo ============================================================================
echo   LedgerPulse for Windows (Local-First Desktop App)
echo   Local Disk Vault : %~dp0data\local-ledger-vault.json
echo   Watched Auto-Drop: %~dp0data\inbox\
echo ============================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed. Please install Node.js 20+ from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo [1/3] Installing local dependencies...
  call npm install
)

if not exist "%~dp0data\inbox" (
  mkdir "%~dp0data\inbox"
)

echo [2/3] Launching native Windows Desktop Window on http://localhost:3000 ...
start "" cmd /c "timeout /t 3 /nobreak >nul && (start msedge --app=http://localhost:3000 || start chrome --app=http://localhost:3000 || start http://localhost:3000)"

echo [3/3] Starting local LedgerPulse Vault Server (Keep this window minimized while using the app)...
call npm run dev
