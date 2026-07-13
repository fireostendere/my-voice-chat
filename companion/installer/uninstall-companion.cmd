@echo off
setlocal
for %%U in ("%~dp0unins*.exe") do if exist "%%~fU" (
  start "" "%%~fU"
  exit /b 0
)
echo The LiveKit Companion uninstaller is missing.
echo Expected location: %~dp0unins*.exe
echo Reinstall LiveKit Companion, then remove it from Windows Settings ^> Apps.
pause
exit /b 1
