import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPANION_EXE_URL, resolveCompanionExeUrl } from './companionDownload';

describe('companion EXE download', () => {
  it('uses the rolling GitHub release by default', () => {
    expect(resolveCompanionExeUrl()).toBe(DEFAULT_COMPANION_EXE_URL);
    expect(DEFAULT_COMPANION_EXE_URL).toContain('/companion-latest/LiveKitCompanionSetup.exe');
  });

  it('accepts a custom HTTPS EXE mirror', () => {
    expect(resolveCompanionExeUrl('https://downloads.example.com/companion/setup.exe')).toBe(
      'https://downloads.example.com/companion/setup.exe',
    );
  });

  it('rejects insecure, authenticated, and non-EXE URLs', () => {
    expect(resolveCompanionExeUrl('http://downloads.example.com/setup.exe')).toBe(
      DEFAULT_COMPANION_EXE_URL,
    );
    expect(resolveCompanionExeUrl('https://user:secret@example.com/setup.exe')).toBe(
      DEFAULT_COMPANION_EXE_URL,
    );
    expect(resolveCompanionExeUrl('https://downloads.example.com/setup.cmd')).toBe(
      DEFAULT_COMPANION_EXE_URL,
    );
  });
});
