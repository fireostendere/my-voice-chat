@echo off
setlocal EnableExtensions
set "DATA_DIR=%LOCALAPPDATA%\LiveKitCompanion"
set "LOG_FILE=%DATA_DIR%\companion.log"
set "STOP_FILE=%DATA_DIR%\stop-requested"
set "NODE_EXE=%~dp0runtime\node.exe"
set "APP_ENTRY=%~dp0app\index.js"
set "NATIVE_HELPER=%~dp0app\bin\LiveKitCompanionNative.exe"
if not defined PTT_KEY set "PTT_KEY=F8"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if exist "%STOP_FILE%" del /q "%STOP_FILE%" >nul 2>&1
> "%LOG_FILE%" echo [%date% %time%] Starting LiveKit Companion
set "SETTINGS_FILE=%DATA_DIR%\settings.env"
if exist "%SETTINGS_FILE%" for /f "usebackq tokens=1,* delims==" %%A in ("%SETTINGS_FILE%") do if /I "%%A"=="PTT_KEY" set "PTT_KEY=%%B"

if not exist "%NODE_EXE%" (
  >> "%LOG_FILE%" echo ERROR: Bundled Node.js runtime is missing: %NODE_EXE%
  set "EXIT_CODE=2"
  goto failed
)
if not exist "%APP_ENTRY%" (
  >> "%LOG_FILE%" echo ERROR: Companion entry point is missing: %APP_ENTRY%
  set "EXIT_CODE=2"
  goto failed
)

cd /d "%~dp0app"
"%NODE_EXE%" index.js >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

if exist "%STOP_FILE%" (
  del /q "%STOP_FILE%" >nul 2>&1
  >> "%LOG_FILE%" echo [%date% %time%] Companion stopped by request.
  exit /b 0
)
if "%EXIT_CODE%"=="0" exit /b 0
>> "%LOG_FILE%" echo [%date% %time%] Companion exited with code %EXIT_CODE%.

:failed
if not defined EXIT_CODE set "EXIT_CODE=1"
if /I "%COMPANION_INTERACTIVE%"=="1" exit /b %EXIT_CODE%
if exist "%NATIVE_HELPER%" "%NATIVE_HELPER%" --startup-error "%LOG_FILE%"
exit /b %EXIT_CODE%
