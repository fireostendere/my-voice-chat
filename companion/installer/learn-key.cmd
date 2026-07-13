@echo off
setlocal
call "%~dp0stop-companion.cmd"
echo Press the desired push-to-talk key. Close this window when finished.
echo.
cd /d "%~dp0app"
"%~dp0runtime\node.exe" index.js --learn
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0start-companion.vbs"
