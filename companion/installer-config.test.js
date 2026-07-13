import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readInstallerFile = (name) =>
  readFileSync(path.join(process.cwd(), 'companion', 'installer', name), 'utf8');

describe('companion installer lifecycle', () => {
  it('installs a real application entry point instead of script shortcuts', () => {
    const manifest = readInstallerFile('companion.iss');

    expect(manifest).toContain('CreateUninstallRegKey=yes');
    expect(manifest).toContain('Uninstallable=yes');
    expect(manifest).toContain('Uninstall {#AppName}');
    expect(manifest).toContain('SetupIconFile=..\\assets\\livekit-companion.ico');
    expect(manifest).toContain('build\\app-launcher\\LiveKitCompanion.exe');
    expect(manifest).toContain('Filename: "{app}\\LiveKitCompanion.exe"');
    expect(manifest).toContain('Parameters: "--startup"');
    expect(manifest).toContain('Parameters: "--stop"');
    expect(manifest).not.toContain('Filename: "{sys}\\wscript.exe"');
    expect(manifest).not.toContain('Source: "launch-companion.vbs"');
    expect(manifest).not.toContain('Source: "start-companion.cmd"');
  });

  it('starts the packaged service and opens its app window from the native EXE', () => {
    const launcher = readFileSync(
      path.join(process.cwd(), 'companion', 'app-launcher', 'Program.cs'),
      'utf8',
    );

    expect(launcher).toContain('StartBackend()');
    expect(launcher).toContain('COMPANION_LOG_FILE');
    expect(launcher).toContain('--app={UiUrl}');
    expect(launcher).toContain('WaitForUi');
    expect(launcher).toContain('StopCompanion');
  });

  it('ships a multi-resolution LiveKit icon through 256 px', () => {
    const appProject = readFileSync(
      path.join(process.cwd(), 'companion', 'app-launcher', 'LiveKitCompanion.csproj'),
      'utf8',
    );
    const helperProject = readFileSync(
      path.join(process.cwd(), 'companion', 'ptt-helper', 'PttKeyState.csproj'),
      'utf8',
    );
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
