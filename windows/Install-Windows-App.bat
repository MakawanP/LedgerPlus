@echo off
setlocal
title LedgerPulse — Windows 10/11 Desktop Shortcut Installer
echo ============================================================================
echo   LedgerPulse for Windows — Desktop ^& Start Menu Installer
echo ============================================================================
echo.

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%LedgerPulse.vbs" (
  set "APP_ROOT=%SCRIPT_DIR%"
  set "VBS_PATH=%SCRIPT_DIR%LedgerPulse.vbs"
) else (
  for %%I in ("%SCRIPT_DIR%..") do set "APP_ROOT=%%~fI\"
  set "VBS_PATH=%SCRIPT_DIR%LedgerPulse.vbs"
)

if exist "%APP_ROOT%ledgerpulse.ico" (
  set "ICON_PATH=%APP_ROOT%ledgerpulse.ico"
) else if exist "%APP_ROOT%public\ledgerpulse.ico" (
  set "ICON_PATH=%APP_ROOT%public\ledgerpulse.ico"
) else (
  set "ICON_PATH=%SystemRoot%\System32\shell32.dll,23"
)

if not exist "%APP_ROOT%data\inbox" (
  mkdir "%APP_ROOT%data\inbox"
)

if not exist "%APP_ROOT%.env" (
  if exist "%APP_ROOT%.env.example" (
    copy /Y "%APP_ROOT%.env.example" "%APP_ROOT%.env" >nul
  )
)

echo [1/2] Creating Desktop and Start Menu shortcuts for LedgerPulse...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$startMenu = [Environment]::GetFolderPath('Programs'); " ^
  "foreach ($dir in @($desktop, $startMenu)) { " ^
  "  $lnk = $ws.CreateShortcut((Join-Path $dir 'LedgerPulse.lnk')); " ^
  "  $lnk.TargetPath = 'wscript.exe'; " ^
  "  $lnk.Arguments = '\"%VBS_PATH%\"'; " ^
  "  $lnk.WorkingDirectory = '%APP_ROOT%'; " ^
  "  $lnk.IconLocation = '%ICON_PATH%'; " ^
  "  $lnk.Description = 'LedgerPulse — Personal Finance, Split Bills & Multi-Device Ledger'; " ^
  "  $lnk.Save(); " ^
  "}"

echo [2/2] Shortcuts installed! Launching LedgerPulse Desktop App...
start "" wscript.exe "%VBS_PATH%"
timeout /t 2 /nobreak >nul
exit /b 0
