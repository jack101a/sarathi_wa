@echo off
setlocal

rem Get the parent folder of scripts (which is the project root)
for %%i in ("%~dp0..") do set "ROOT=%%~fi"
cd /d "%ROOT%"

echo [restart] Working directory: %ROOT%
echo [restart] Stopping existing server processes...

REM Stop node processes that were started with server.js
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=[IO.Path]::GetFullPath('%ROOT%').ToLower();" ^
  "$procs=Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('server.js') -and $_.CommandLine.ToLower().Contains($root.TrimEnd('\').ToLower()) };" ^
  "foreach($p in $procs){ try{ Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output ('[restart] Stopped node PID ' + $p.ProcessId) } catch{} }"

REM If port 3000 is still occupied, force-kill that PID
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  echo [restart] Port 3000 in use by PID %%P. Stopping...
  taskkill /F /PID %%P >nul 2>&1
)

timeout /t 2 /nobreak >nul

echo [restart] Starting server with live logs...
echo [restart] Press Ctrl+C to stop.
node server.js

endlocal
