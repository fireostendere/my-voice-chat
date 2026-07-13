@echo off
setlocal
if not defined PTT_KEY set "PTT_KEY=F8"
if not exist "%LOCALAPPDATA%\LiveKitCompanion" mkdir "%LOCALAPPDATA%\LiveKitCompanion"
set "SETTINGS_FILE=%LOCALAPPDATA%\LiveKitCompanion\settings.env"
if exist "%SETTINGS_FILE%" for /f "usebackq tokens=1,* delims==" %%A in ("%SETTINGS_FILE%") do if /I "%%A"=="PTT_KEY" set "PTT_KEY=%%B"
cd /d "%~dp0app"
"%~dp0runtime\node.exe" index.js >> "%LOCALAPPDATA%\LiveKitCompanion\companion.log" 2>&1
