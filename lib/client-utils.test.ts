import { describe, expect, it, vi } from 'vitest';
import {
  decodePassphrase,
  encodePassphrase,
  generateRoomId,
  isLowPowerDevice,
  isMeetStaging,
  managedRoomPathname,
  randomString,
  roomHrefFromInput,
} from './client-utils';

describe('randomString', () => {
  it('returns a string of the requested length', () => {
    expect(randomString(16)).toHaveLength(16);
    expect(randomString(0)).toBe('');
  });

  it('only uses lowercase alphanumerics', () => {
    expect(randomString(256)).toMatch(/^[a-z0-9]*$/);
  });
});

describe('managedRoomPathname', () => {
  it.each([
    ['/dota', '/rooms/dota'],
    ['/dota/', '/rooms/dota'],
    ['/party_2-3', '/rooms/party_2-3'],
    [`/${encodeURIComponent('дота')}`, `/rooms/${encodeURIComponent('дота')}`],
    ['/rooms/dota', '/rooms/dota'],
    ['/rooms/dota/', '/rooms/dota/'],
    ['/rooms/custom', '/rooms/custom'],
  ])('maps %s to the existing managed room %s', (pathname, expected) => {
    expect(managedRoomPathname(pathname)).toBe(expected);
  });

  it.each([
    '/',
    '/api',
    '/custom',
    '/rooms',
    '/_next',
    '/rtc',
    '/twirp',
    '/favicon.ico',
    '/nested/room',
    '/dota%2Fother',
    '/dota%20',
    '/%invalid',
    `/${'a'.repeat(129)}`,
  ])('does not turn an invalid name or application route into a room: %s', (pathname) => {
    expect(managedRoomPathname(pathname)).toBeNull();
  });
});

describe('roomHrefFromInput', () => {
  const origin = 'https://chat.example.com';
  it('joins by name or same-site invitation and preserves encryption and room options', () => {
    expect(roomHrefFromInput(' friends ', origin)).toBe('/rooms/friends');
    expect(roomHrefFromInput(`${origin}/rooms/friends?codec=vp8#my%20key`, origin)).toBe(
      '/rooms/friends?codec=vp8#my%20key',
    );
    expect(roomHrefFromInput(`${origin}/dota?codec=vp8#my%20key`, origin)).toBe(
      '/rooms/dota?codec=vp8#my%20key',
    );
    expect(roomHrefFromInput('/dota', origin)).toBe('/rooms/dota');
  });
  it('rejects unrelated routes, other origins, and URLs containing credentials', () => {
    for (const input of [
      '',
      '/',
      '/custom?token=secret',
      '/api',
      '/nested/room',
      '//other.example/rooms/friends',
      'javascript:alert(1)',
      'https://user:password@chat.example.com/rooms/friends',
      'https://user:password@chat.example.com/dota',
    ]) {
      expect(roomHrefFromInput(input, origin)).toBeNull();
    }
  });
});

describe('generateRoomId', () => {
  it('produces two 4-character groups joined by a dash', () => {
    expect(generateRoomId()).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
  });
});

describe('passphrase encoding', () => {
  it('round-trips strings including special characters', () => {
    const phrase = 'hunter2 % / # ? & =';
    expect(decodePassphrase(encodePassphrase(phrase))).toBe(phrase);
  });
});

describe('isLowPowerDevice', () => {
  it('is true when the CPU reports fewer than 6 logical cores', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    expect(isLowPowerDevice()).toBe(true);
  });

  it('is false with 6 or more cores', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    expect(isLowPowerDevice()).toBe(false);
  });
});

describe('isMeetStaging', () => {
  it('detects the staging host', () => {
    vi.stubGlobal('location', { origin: 'https://meet.staging.livekit.io' });
    expect(isMeetStaging()).toBe(true);
  });

  it('is false for other hosts', () => {
    vi.stubGlobal('location', { origin: 'https://example.com' });
    expect(isMeetStaging()).toBe(false);
  });
});
