const DEFAULT_ARCHIVE_URL =
  'https://github.com/fireostendere/my-voice-chat/archive/refs/heads/main.zip';
const DEFAULT_APP_ORIGIN = 'http://localhost:3000';
const CMD_UNSAFE_VALUE = /[%!^&|<>"\r\n]/;

type DownloadRequest = {
  url: string;
  headers: { get(name: string): string | null };
};

export function resolveCompanionOrigin(
  request: DownloadRequest,
  configuredOrigin?: string,
): string {
  const requestUrl = new URL(request.url);
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const forwardedOrigin = forwardedHost
    ? `${forwardedProto === 'https' ? 'https' : requestUrl.protocol.slice(0, -1)}://${forwardedHost}`
    : undefined;

  return (
    normalizeHttpOrigin(configuredOrigin) ??
    normalizeHttpOrigin(forwardedOrigin) ??
    normalizeHttpOrigin(requestUrl.origin) ??
    DEFAULT_APP_ORIGIN
  );
}

export function resolveCompanionArchiveUrl(configuredUrl?: string): string {
  if (!configuredUrl) return DEFAULT_ARCHIVE_URL;
  try {
    const url = new URL(configuredUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      /['%\r\n]/.test(configuredUrl)
    ) {
      return DEFAULT_ARCHIVE_URL;
    }
    return url.toString();
  } catch {
    return DEFAULT_ARCHIVE_URL;
  }
}

export function renderCompanionInstaller(appOrigin: string, archiveUrl: string): string {
  const origin = normalizeHttpOrigin(appOrigin) ?? DEFAULT_APP_ORIGIN;
  const sourceUrl = resolveCompanionArchiveUrl(archiveUrl);

  return [
    '@echo off',
    'setlocal EnableExtensions DisableDelayedExpansion',
    'chcp 65001 >nul',
    'title LiveKit Companion Installer',
    'set "INSTALL_DIR=%LOCALAPPDATA%\\LiveKitCompanion"',
    'set "WORK_DIR=%TEMP%\\livekit-companion-install-%RANDOM%%RANDOM%"',
    'set "SOURCE_ZIP=%WORK_DIR%\\source.zip"',
    'set "NODE_ZIP=%WORK_DIR%\\node.zip"',
    'set "NODE_VERSION_FILE=%WORK_DIR%\\node-version.txt"',
    'set "NODE_ARCH=x64"',
    'if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=arm64"',
    '',
    'echo LiveKit Companion setup',
    'echo This installs the companion only for the current Windows user.',
    'echo.',
    'mkdir "%WORK_DIR%" >nul 2>&1',
    'if errorlevel 1 goto :fail',
    '',
    'echo [1/6] Downloading companion...',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '${sourceUrl}' -OutFile $env:SOURCE_ZIP"`,
    'if errorlevel 1 goto :fail',
    '',
    'echo [2/6] Selecting portable Node.js LTS...',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$releases=Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'; $file='win-' + $env:NODE_ARCH + '-zip'; $release=$releases.Where({$_.lts -ne $false -and $_.files -contains $file}, 'First'); if (-not $release) { exit 1 }; [IO.File]::WriteAllText($env:NODE_VERSION_FILE, $release.version)"`,
    'if errorlevel 1 goto :fail',
    'set /p NODE_VERSION=<"%NODE_VERSION_FILE%"',
    'if not defined NODE_VERSION goto :fail',
    'set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-%NODE_ARCH%.zip"',
    '',
    'echo [3/6] Downloading portable Node.js %NODE_VERSION%...',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:NODE_URL -OutFile $env:NODE_ZIP"`,
    'if errorlevel 1 goto :fail',
    '',
    'echo [4/6] Unpacking application...',
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -LiteralPath $env:SOURCE_ZIP -DestinationPath (Join-Path $env:WORK_DIR 'source') -Force; Expand-Archive -LiteralPath $env:NODE_ZIP -DestinationPath (Join-Path $env:WORK_DIR 'node') -Force\"",
    'if errorlevel 1 goto :fail',
    'set "SOURCE_DIR="',
    'set "NODE_DIR="',
    'for /d %%D in ("%WORK_DIR%\\source\\my-voice-chat-*") do set "SOURCE_DIR=%%~fD\\companion"',
    'for /d %%D in ("%WORK_DIR%\\node\\node-*-win-*") do set "NODE_DIR=%%~fD"',
    'if not exist "%SOURCE_DIR%\\package.json" goto :fail',
    'if not exist "%NODE_DIR%\\node.exe" goto :fail',
    '',
    'taskkill /FI "WINDOWTITLE eq LiveKit Companion" /T /F >nul 2>&1',
    'if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"',
    'mkdir "%INSTALL_DIR%\\app" >nul 2>&1',
    'mkdir "%INSTALL_DIR%\\runtime" >nul 2>&1',
    'xcopy "%SOURCE_DIR%\\*" "%INSTALL_DIR%\\app\\" /E /I /H /Y >nul',
    'if errorlevel 1 goto :fail',
    'xcopy "%NODE_DIR%\\*" "%INSTALL_DIR%\\runtime\\" /E /I /H /Y >nul',
    'if errorlevel 1 goto :fail',
    '',
    'echo [5/6] Installing companion dependencies...',
    'pushd "%INSTALL_DIR%\\app"',
    'call "%INSTALL_DIR%\\runtime\\npm.cmd" install --omit=dev --no-audit --no-fund',
    'set "NPM_EXIT=%ERRORLEVEL%"',
    'popd',
    'if not "%NPM_EXIT%"=="0" goto :fail',
    '',
    'echo [6/6] Creating launcher...',
    '>"%INSTALL_DIR%\\start-companion.cmd" echo @echo off',
    '>>"%INSTALL_DIR%\\start-companion.cmd" echo title LiveKit Companion',
    `>>"%INSTALL_DIR%\\start-companion.cmd" echo set "COMPANION_ORIGINS=${origin}"`,
    '>>"%INSTALL_DIR%\\start-companion.cmd" echo set "PTT_KEY=F8"',
    '>>"%INSTALL_DIR%\\start-companion.cmd" echo cd /d "%%~dp0app"',
    '>>"%INSTALL_DIR%\\start-companion.cmd" echo "%%~dp0runtime\\node.exe" index.js',
    '>>"%INSTALL_DIR%\\start-companion.cmd" echo pause',
    '>"%INSTALL_DIR%\\learn-key.cmd" echo @echo off',
    '>>"%INSTALL_DIR%\\learn-key.cmd" echo title LiveKit Companion - Learn key',
    '>>"%INSTALL_DIR%\\learn-key.cmd" echo cd /d "%%~dp0app"',
    '>>"%INSTALL_DIR%\\learn-key.cmd" echo "%%~dp0runtime\\node.exe" index.js --learn',
    '>>"%INSTALL_DIR%\\learn-key.cmd" echo pause',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=Join-Path $env:LOCALAPPDATA 'LiveKitCompanion'; $shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'LiveKit Companion.lnk')); $shortcut.TargetPath=(Join-Path $root 'start-companion.cmd'); $shortcut.WorkingDirectory=$root; $shortcut.Save()"`,
    'if errorlevel 1 goto :fail',
    '',
    'rmdir /s /q "%WORK_DIR%" >nul 2>&1',
    'echo.',
    'echo Companion installed successfully.',
    'echo Desktop shortcut: LiveKit Companion',
    'echo Default push-to-talk key: F8',
    'start "" "%INSTALL_DIR%\\start-companion.cmd"',
    'exit /b 0',
    '',
    ':fail',
    'echo.',
    'echo Installation failed. Check your internet connection and try again.',
    'echo Temporary files: %WORK_DIR%',
    'pause',
    'exit /b 1',
    '',
  ].join('\r\n');
}

function normalizeHttpOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      CMD_UNSAFE_VALUE.test(url.origin)
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(',')[0]?.trim() || undefined;
}
