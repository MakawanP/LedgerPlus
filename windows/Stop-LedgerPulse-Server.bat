@echo off
title Stop LedgerPulse Background Server
echo Stopping any running LedgerPulse local server on port 3000...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; " ^
  "if ($conns) { " ^
  "  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique; " ^
  "  foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Write-Output ('Stopped process PID ' + $p); } " ^
  "} else { Write-Output 'No LedgerPulse server is currently listening on port 3000.'; }"
timeout /t 2 /nobreak >nul
