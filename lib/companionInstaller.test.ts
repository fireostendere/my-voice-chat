import { describe, expect, it } from 'vitest';
import {
  renderCompanionInstaller,
  resolveCompanionArchiveUrl,
  resolveCompanionOrigin,
} from './companionInstaller';

function request(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

describe('resolveCompanionOrigin', () => {
  it('uses the public reverse-proxy origin', () => {
    expect(
      resolveCompanionOrigin(
        request('http://127.0.0.1:3000/api/companion/download', {
          'x-forwarded-host': 'voice.example.com',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://voice.example.com');
  });

  it('uses the request origin locally and rejects non-http overrides', () => {
    expect(resolveCompanionOrigin(request('http://localhost:3000/api/companion/download'))).toBe(
      'http://localhost:3000',
    );
    expect(
      resolveCompanionOrigin(
        request('https://voice.example.com/api/companion/download'),
        'file:///tmp/companion',
      ),
    ).toBe('https://voice.example.com');
  });
});

describe('renderCompanionInstaller', () => {
  it('builds a portable installer tied to the voice-chat origin', () => {
    const installer = renderCompanionInstaller(
      'https://voice.example.com',
      'https://downloads.example.com/source.zip',
    );

    expect(installer).toContain('set "COMPANION_ORIGINS=https://voice.example.com"');
    expect(installer).toContain('https://nodejs.org/dist/index.json');
    expect(installer).toContain("'https://downloads.example.com/source.zip'");
    expect(installer).toContain('%LOCALAPPDATA%\\LiveKitCompanion');
  });

  it('falls back from an unsafe archive URL', () => {
    expect(resolveCompanionArchiveUrl('file:///tmp/source.zip')).toContain(
      'github.com/fireostendere/my-voice-chat',
    );
  });
});
