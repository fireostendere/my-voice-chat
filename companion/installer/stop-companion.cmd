@echo off
setlocal
set "DATA_DIR=%LOCALAPPDATA%\LiveKitCompanion"
set "PID_FILE=%DATA_DIR%\companion.pid"
set "STOP_FILE=%DATA_DIR%\stop-requested"
if not exist "%PID_FILE%" exit /b 0
set /p COMPANION_PID=<"%PID_FILE%"
if not defined COMPANION_PID exit /b 0
for /f "delims=0123456789" %%A in ("%COMPANION_PID%") do exit /b 1
> "%STOP_FILE%" echo stop
taskkill /PID %COMPANION_PID% /T /F >nul 2>&1
del /q "%PID_FILE%" >nul 2>&1
ping 127.0.0.1 -n 2 >nul
