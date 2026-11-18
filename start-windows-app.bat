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

set "CLOUD_APP_URL=https://ais-pre-htcfj44ymcyxj7dcndkfx2-860080216343.us-east1.run.app"
set "TARGET_URL=http://localhost:3000"

if /i not "%~1"=="--local" if /i not "%~1"=="/local" (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%CLOUD_APP_URL%' -Method Head -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    set "TARGET_URL=%CLOUD_APP_URL%"
  )
)

:: 1. Standalone Release Mode (Bundled runtime\node.exe + server.cjs — Zero Prerequisites)
if exist "%~dp0runtime\node.exe" if exist "%~dp0server.cjs" (
  echo [1/2] Launching LedgerPulse Desktop Window ^(%TARGET_URL%^) ...
  start "" cmd /c "timeout /t 2 /nobreak >nul && (start msedge --app=%TARGET_URL% || start chrome --app=%TARGET_URL% || start %TARGET_URL%)"
  echo [2/2] Starting bundled LedgerPulse Local Vault Server ^(port 3000^)...
  set NODE_ENV=production
  "%~dp0runtime\node.exe" "%~dp0server.cjs"
  exit /b 0
)

:: Verify system Node.js is installed for Portable Release or Source Dev Mode
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed. Opening Cloud-Authorized Desktop Window directly...
  start msedge --app=%CLOUD_APP_URL% || start chrome --app=%CLOUD_APP_URL% || start %CLOUD_APP_URL%
  exit /b 0
)

:: 2. Portable Built Release Mode (Prebuilt dist\ + server.cjs — No npm install required)
if exist "%~dp0server.cjs" if exist "%~dp0dist\index.html" (
  echo [1/2] Launching LedgerPulse Desktop Window ^(%TARGET_URL%^) ...
  start "" cmd /c "timeout /t 2 /nobreak >nul && (start msedge --app=%TARGET_URL% || start chrome --app=%TARGET_URL% || start %TARGET_URL%)"
  echo [2/2] Starting LedgerPulse Local Vault Server ^(port 3000^)...
  set NODE_ENV=production
  node "%~dp0server.cjs"
  exit /b 0
)

:: 3. Developer Source Mode
if not exist "%~dp0node_modules" (
  echo [1/3] Installing local dependencies...
  call npm install
)

echo [2/3] Launching native Windows Desktop Window ^(%TARGET_URL%^) ...
start "" cmd /c "timeout /t 3 /nobreak >nul && (start msedge --app=%TARGET_URL% || start chrome --app=%TARGET_URL% || start %TARGET_URL%)"

echo [3/3] Starting local LedgerPulse Server (Keep minimized while using the app)...
call npm run dev
