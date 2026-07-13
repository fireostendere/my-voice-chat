@echo off
setlocal
set "PTT_KEY=F8"
if not exist "%LOCALAPPDATA%\LiveKitCompanion" mkdir "%LOCALAPPDATA%\LiveKitCompanion"
cd /d "%~dp0app"
"%~dp0runtime\node.exe" index.js >> "%LOCALAPPDATA%\LiveKitCompanion\companion.log" 2>&1
