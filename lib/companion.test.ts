import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_COMPANION_WS_URL,
  getCompanionNavigationWsUrl,
  getCompanionWsUrl,
  getPushToTalkWsUrl,
} from './companion';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('companion URL configuration', () => {
  it('uses the localhost companion by default', () => {
    vi.stubEnv('NEXT_PUBLIC_COMPANION_WS_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_PTT_WS_URL', undefined);
    expect(getCompanionWsUrl()).toBe(DEFAULT_COMPANION_WS_URL);
    expect(getCompanionNavigationWsUrl()).toBe(DEFAULT_COMPANION_WS_URL);
    expect(getPushToTalkWsUrl()).toBe(DEFAULT_COMPANION_WS_URL);
  });

  it('can disable PTT without disabling torrent capabilities', () => {
    vi.stubEnv('NEXT_PUBLIC_COMPANION_WS_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_PTT_WS_URL', '');
    expect(getPushToTalkWsUrl()).toBe('');
    expect(getCompanionWsUrl()).toBe(DEFAULT_COMPANION_WS_URL);
    expect(getCompanionNavigationWsUrl()).toBe(DEFAULT_COMPANION_WS_URL);
  });

  it('never inherits a legacy remote PTT endpoint for room navigation', () => {
    vi.stubEnv('NEXT_PUBLIC_COMPANION_WS_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_PTT_WS_URL', 'wss://ptt.example.com/socket');

    expect(getPushToTalkWsUrl()).toBe('wss://ptt.example.com/socket');
    expect(getCompanionWsUrl()).toBe('wss://ptt.example.com/socket');
    expect(getCompanionNavigationWsUrl()).toBe(DEFAULT_COMPANION_WS_URL);
  });

  it('can disable the companion explicitly', () => {
    vi.stubEnv('NEXT_PUBLIC_COMPANION_WS_URL', '');
    expect(getCompanionWsUrl()).toBe('');
    expect(getCompanionNavigationWsUrl()).toBe('');
  });
});
