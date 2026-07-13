import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readInstallerFile = (name) =>
  readFileSync(path.join(process.cwd(), 'companion', 'installer', name), 'utf8');

describe('companion installer lifecycle', () => {
  it('registers an uninstaller and exposes support shortcuts', () => {
    const manifest = readInstallerFile('companion.iss');

    expect(manifest).toContain('CreateUninstallRegKey=yes');
    expect(manifest).toContain('Uninstallable=yes');
    expect(manifest).toContain('Status and diagnostics');
    expect(manifest).toContain('Uninstall {#AppName}');
    expect(manifest).toContain('SetupIconFile=..\\..\\public\\favicon.ico');
    expect(manifest).toContain('companion-ui.js');
    expect(manifest).toContain('room-registry.js');
    expect(manifest).toContain('launch-companion.vbs');
  });

  it('logs startup failures and reports them to the user', () => {
    const startScript = readInstallerFile('start-companion.cmd');
    const launcher = readInstallerFile('launch-companion.vbs');

    expect(startScript).toContain('companion.log');
    expect(startScript).toContain('--startup-error');
    expect(startScript).toContain('Companion exited with code');
    expect(launcher).toContain('--app=');
    expect(launcher).toContain('127.0.0.1:7333');
    expect(launcher).toContain('could not start');
  });
});
