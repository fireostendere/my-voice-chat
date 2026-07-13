@echo off
setlocal
set "PID_FILE=%LOCALAPPDATA%\LiveKitCompanion\companion.pid"
if not exist "%PID_FILE%" exit /b 0
set /p COMPANION_PID=<"%PID_FILE%"
if not defined COMPANION_PID exit /b 0
for /f "delims=0123456789" %%A in ("%COMPANION_PID%") do exit /b 1
taskkill /PID %COMPANION_PID% /T /F >nul 2>&1
del /q "%PID_FILE%" >nul 2>&1
