import { describe, expect, it, vi } from 'vitest';
import { createClientConfig, normalizeWebAppUrl } from './client-config.js';

describe('companion web app URL normalization', () => {
  it('keeps only an HTTPS origin and adds a trailing slash', () => {
    expect(normalizeWebAppUrl('https://chat.example.com/rooms/demo?codec=vp9#secret')).toBe(
      'https://chat.example.com/',
    );
    expect(normalizeWebAppUrl('https://chat.example.com:8443')).toBe(
      'https://chat.example.com:8443/',
    );
  });

  it('allows HTTP only for loopback development URLs', () => {
    expect(normalizeWebAppUrl('http://localhost:3000/rooms/demo')).toBe('http://localhost:3000/');
    expect(normalizeWebAppUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
    expect(normalizeWebAppUrl('http://[::1]:3000')).toBe('http://[::1]:3000/');
    expect(normalizeWebAppUrl('http://chat.example.com')).toBeUndefined();
  });

  it('rejects credentials, non-HTTP schemes, and malformed values', () => {
    expect(normalizeWebAppUrl('https://user:secret@chat.example.com')).toBeUndefined();
    expect(normalizeWebAppUrl('ws://chat.example.com')).toBeUndefined();
    expect(normalizeWebAppUrl('not a URL')).toBeUndefined();
    expect(normalizeWebAppUrl(undefined)).toBeUndefined();
  });
});

describe('companion client config', () => {
  it('loads, updates, and clears a persisted web app URL', async () => {
    let persisted = 'https://saved.example.com/rooms/old';
    const save = vi.fn(async (value) => {
      persisted = value;
    });
    const config = createClientConfig({
      load: async () => persisted,
      save,
    });

    await expect(config.getWebAppUrl()).resolves.toBe('https://saved.example.com/');
    await expect(config.setWebAppUrl('https://new.example.com/room')).resolves.toBe(
      'https://new.example.com/',
    );
    expect(save).toHaveBeenLastCalledWith('https://new.example.com/');
    await expect(config.getWebAppUrl()).resolves.toBe('https://new.example.com/');

    await config.clearWebAppUrl();
    expect(save).toHaveBeenLastCalledWith(null);
    await expect(config.getWebAppUrl()).resolves.toBeNull();
  });

  it('uses COMPANION_WEB_APP_URL as an immutable managed override', async () => {
    const load = vi.fn(async () => 'https://saved.example.com/');
    const save = vi.fn();
    const config = createClientConfig({
      configuredUrl: 'https://managed.example.com/rooms/demo',
      load,
      save,
    });

    expect(config.managed).toBe(true);
    await expect(config.getWebAppUrl()).resolves.toBe('https://managed.example.com/');
    expect(load).not.toHaveBeenCalled();
    await expect(config.setWebAppUrl('https://other.example.com')).rejects.toThrow(
      'COMPANION_WEB_APP_URL',
    );
    await expect(config.clearWebAppUrl()).rejects.toThrow('COMPANION_WEB_APP_URL');
    expect(save).not.toHaveBeenCalled();
  });

  it('fails fast for an unsafe managed override and rejects unsafe updates', async () => {
    expect(() =>
      createClientConfig({
        configuredUrl: 'http://chat.example.com',
        load: vi.fn(),
        save: vi.fn(),
      }),
    ).toThrow('COMPANION_WEB_APP_URL');

    const config = createClientConfig({ load: vi.fn(async () => null), save: vi.fn() });
    await expect(config.setWebAppUrl('javascript:alert(1)')).rejects.toThrow('valid HTTPS');
  });
});
