@echo off
setlocal EnableExtensions
title LiveKit Companion - Status and diagnostics
set "DATA_DIR=%LOCALAPPDATA%\LiveKitCompanion"
set "PID_FILE=%DATA_DIR%\companion.pid"
set "LOG_FILE=%DATA_DIR%\companion.log"

echo LiveKit Companion
echo =================
echo Install directory: %~dp0
echo Log file: %LOG_FILE%
echo.

if not exist "%PID_FILE%" goto stopped
set /p COMPANION_PID=<"%PID_FILE%"
if not defined COMPANION_PID goto stopped
for /f "delims=0123456789" %%A in ("%COMPANION_PID%") do goto stale
tasklist /FI "PID eq %COMPANION_PID%" /NH 2>nul | findstr /R /C:"[ ]%COMPANION_PID%[ ]" >nul
if errorlevel 1 goto stale
echo Status: RUNNING ^(PID %COMPANION_PID%^)
goto showlog

:stale
echo Status: STOPPED ^(stale PID file^)
goto showlog

:stopped
echo Status: STOPPED

:showlog
echo.
echo Last launch log
echo ---------------
if exist "%LOG_FILE%" (
  type "%LOG_FILE%"
) else (
  echo No log has been created yet.
)
echo.
echo Uninstall from Windows Settings ^> Apps ^> Installed apps ^> LiveKit Companion,
echo or use the "Uninstall LiveKit Companion" Start menu shortcut.
echo.
pause
