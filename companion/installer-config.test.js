import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  COMPANION_VERSION_PATTERN_SOURCE,
  html: renderedSmokeHtml,
} = require('./scripts/webview-smoke-server.js');
const readInstallerFile = (name) =>
  readFileSync(path.join(process.cwd(), 'companion', 'installer', name), 'utf8');
const readRepoFile = (...parts) => readFileSync(path.join(process.cwd(), ...parts), 'utf8');

describe('companion installer lifecycle', () => {
  it('keeps the fallback installer version aligned with the site version source', () => {
    const manifest = readInstallerFile('companion.iss');
    const companionPackage = JSON.parse(readRepoFile('companion', 'package.json'));

    expect(manifest).toContain(`#define AppVersion "${companionPackage.version}"`);
  });

  it('installs a real application entry point instead of script shortcuts', () => {
    const manifest = readInstallerFile('companion.iss');

    expect(manifest).toContain('CreateUninstallRegKey=yes');
    expect(manifest).toContain('Uninstallable=yes');
    expect(manifest).toContain('Uninstall {#AppName}');
    expect(manifest).toContain('SetupIconFile=..\\assets\\livekit-companion.ico');
    expect(manifest).toContain('build\\app-launcher\\*');
    expect(manifest).toContain('Source: "..\\client-config.js"');
    expect(manifest).toContain('Source: "..\\native-navigation-service.js"');
    expect(manifest).toContain('MicrosoftEdgeWebview2Setup.exe');
    expect(manifest).toContain('/silent /install');
    expect(manifest).toContain('WebView2RuntimeMissing');
    expect(manifest).toContain('Filename: "{app}\\LiveKitCompanion.exe"');
    expect(manifest).toContain('Parameters: "--startup"');
    expect(manifest).toContain('Parameters: "--stop"');
    expect(manifest).not.toContain('Filename: "{sys}\\wscript.exe"');
    expect(manifest).not.toContain('Source: "launch-companion.vbs"');
    expect(manifest).not.toContain('Source: "start-companion.cmd"');
  });

  it('starts the packaged service and owns a full WebView2 client with the LK icon', () => {
    const launcher = readRepoFile('companion', 'app-launcher', 'Program.cs');
    const appProject = readRepoFile('companion', 'app-launcher', 'LiveKitCompanion.csproj');
    const tray = readRepoFile('companion', 'ptt-helper', 'TrayIcon.cs');

    expect(launcher).toContain('StartBackend()');
    expect(launcher).toContain('COMPANION_LOG_FILE');
    expect(launcher).toContain('COMPANION_WEB_APP_URL');
    expect(launcher).toContain('COMPANION_LAUNCHER_PATH');
    expect(launcher).toContain('LiveKitCompanion.Navigation.');
    expect(launcher).toContain('NamedPipeServerStream');
    expect(launcher).toContain('PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly');
    expect(launcher).toContain('MaxNavigationRequestBytes = 16 * 1024');
    expect(launcher).toContain('protocolVersion != 1');
    expect(launcher).toContain('IsSameOrigin(destination, webAppUri)');
    expect(launcher).toContain('Program.SetForegroundWindow(Handle)');
    expect(launcher).toContain('CompanionWindow');
    expect(launcher).toContain('clientConfigUri = new Uri(uiUri, "api/client-config")');
    expect(launcher).toContain('COMPANION_SMOKE_EXPECTED_TITLE');
    expect(launcher).toContain('command == "--open"');
    expect(launcher).toContain('--use-fake-ui-for-media-stream');
    expect(launcher).toContain('--use-fake-device-for-media-stream');
    expect(launcher).toContain('__LIVEKIT_COMPANION__');
    expect(launcher).toContain('appVersion:');
    expect(launcher).toContain('Program.ReadAssemblyMetadata("CompanionAppVersion")');
    expect(launcher).toContain('Application.Run(window)');
    expect(launcher).toContain('Icon.ExtractAssociatedIcon');
    expect(launcher).not.toContain('--app=');
    expect(appProject).toContain('Microsoft.Web.WebView2');
    expect(appProject).toContain('<UseWindowsForms>true</UseWindowsForms>');
    expect(appProject).toContain('AssemblyMetadata Include="CompanionWebAppUrl"');
    expect(appProject).toContain('Include="CompanionAppVersion"');
    expect(tray).toContain('LiveKitCompanion.exe');
    expect(tray).toContain('startInfo.ArgumentList.Add("--open")');
    expect(tray).not.toContain('--app=');
    expect(launcher).toContain('WaitForUi');
    expect(launcher).toContain('StopCompanion');
  });

  it('runs the installed WebView2 client against an isolated browser-capability fixture', () => {
    const fixture = readRepoFile('companion', 'scripts', 'webview-smoke-server.js');
    const handoff = readRepoFile('companion', 'scripts', 'native-handoff-smoke-client.js');
    const workflow = readRepoFile('.github', 'workflows', 'companion-release.yaml');

    expect(fixture).toContain("'Cross-Origin-Embedder-Policy': 'credentialless'");
    expect(fixture).toContain("'Cross-Origin-Opener-Policy': 'same-origin'");
    expect(fixture).toContain('window.isSecureContext');
    expect(fixture).toContain('window.crossOriginIsolated');
    expect(fixture).toContain('navigator.mediaDevices.getUserMedia');
    expect(fixture).toContain('new RTCPeerConnection()');
    expect(fixture).toContain('HTMLMediaElement.prototype.captureStream');
    expect(fixture).toContain("new WebSocket('ws://127.0.0.1:7331')");
    expect(fixture).toContain("companionMarker?.host === 'webview2'");
    expect(fixture).toContain("companionMarker?.platform === 'windows'");
    expect(fixture).toContain('companionMarker?.version === 1');
    expect(fixture).toContain("typeof companionMarker.appVersion === 'string'");
    expect(renderedSmokeHtml).toContain(
      `new RegExp(${JSON.stringify(COMPANION_VERSION_PATTERN_SOURCE)})`,
    );
    expect(new RegExp(COMPANION_VERSION_PATTERN_SOURCE).test('0.8.0')).toBe(true);
    expect(new RegExp(COMPANION_VERSION_PATTERN_SOURCE).test('0.8.0+build.1')).toBe(true);
    expect(fixture).toContain("hello.capabilities.includes('open-room')");
    expect(fixture).not.toContain("type: 'open-room'");
    expect(fixture).toContain("url.pathname === '/smoke-status'");
    expect(fixture).toContain("url.pathname === '/smoke-result'");
    expect(fixture).toContain("if (smokeState.status === 'failed') return;");
    expect(fixture).toContain("document.title = 'LiveKit Companion WebView Smoke OK'");

    expect(handoff).toContain('origin: fixtureUrl.origin');
    expect(handoff).toContain("type: 'open-room'");
    expect(handoff).toContain("new URL('/rooms/native-handoff-smoke', fixtureUrl)");
    expect(handoff).toContain("destination.search = '?codec=vp9&handoff=1'");
    expect(handoff).toContain("destination.hash = '#handoff-secret'");
    expect(handoff).toContain("message?.type !== 'open-room-result'");
    expect(handoff).toContain('message.accepted !== true');
    expect(handoff).toContain("result?.status === 'passed'");

    expect(workflow).toContain('"-p:CompanionWebAppUrl=$webAppUrl"');
    expect(workflow).toContain('-p:Version=$version');
    expect(workflow).toContain('-p:CompanionAppVersion=$version');
    expect(workflow).toContain('companion/scripts/webview-smoke-server.js');
    expect(workflow).toContain('companion/scripts/native-handoff-smoke-client.js');
    expect(workflow).toContain('$env:COMPANION_WEB_APP_URL = $fixtureUrl');
    expect(workflow).toContain("$start = Start-Process $app -ArgumentList '--startup'");
    expect(workflow).toContain('if ($existingWindow)');
    expect(workflow).not.toContain("-ArgumentList '--window-smoke-test'");
    expect(workflow).toContain('http://127.0.0.1:7333/api/client-config');
    expect(workflow).toContain(
      "$env:COMPANION_SMOKE_EXPECTED_TITLE = 'LiveKit Companion WebView Smoke OK'",
    );
  });

  it('ships a multi-resolution LiveKit icon through 256 px', () => {
    const appProject = readRepoFile('companion', 'app-launcher', 'LiveKitCompanion.csproj');
    const helperProject = readRepoFile('companion', 'ptt-helper', 'PttKeyState.csproj');
    const icon = readFileSync(
      path.join(process.cwd(), 'companion', 'assets', 'livekit-companion.ico'),
    );
    expect(appProject).toContain('..\\assets\\livekit-companion.ico');
    expect(helperProject).toContain('..\\assets\\livekit-companion.ico');
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBeGreaterThanOrEqual(8);
    const widths = Array.from({ length: icon.readUInt16LE(4) }, (_, index) => icon[6 + index * 16]);
    expect(widths).toContain(16);
    expect(widths).toContain(32);
    expect(widths).toContain(48);
    expect(widths).toContain(0);
  });
});
