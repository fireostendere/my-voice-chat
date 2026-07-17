import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionRouteGate } from './CompanionRouteGate';
import { openRoomInCompanion } from './companionNavigation';

vi.mock('./companionNavigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./companionNavigation')>();
  return { ...actual, openRoomInCompanion: vi.fn() };
});

const openRoomMock = vi.mocked(openRoomInCompanion);

beforeEach(() => {
  openRoomMock.mockReset();
  delete window.__LIVEKIT_COMPANION__;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CompanionRouteGate', () => {
  it('blocks the room while Companion detection is pending', () => {
    openRoomMock.mockReturnValue(new Promise(() => {}));
    render(
      <CompanionRouteGate>
        <div>Browser room</div>
      </CompanionRouteGate>,
    );

    expect(screen.getByText('Looking for Companion…')).not.toBeNull();
    expect(screen.queryByText('Browser room')).toBeNull();
  });

  it('renders the room without probing localhost inside the native WebView', async () => {
    window.__LIVEKIT_COMPANION__ = { host: 'webview2', platform: 'windows', version: 1 };
    render(
      <CompanionRouteGate>
        <div>Browser room</div>
      </CompanionRouteGate>,
    );

    expect(await screen.findByText('Browser room')).not.toBeNull();
    expect(openRoomMock).not.toHaveBeenCalled();
  });

  it('keeps the browser room permanently unmounted after handoff', async () => {
    openRoomMock.mockResolvedValue('accepted');
    render(
      <CompanionRouteGate>
        <div>Browser room</div>
      </CompanionRouteGate>,
    );

    expect(await screen.findByText('Room opened in Companion')).not.toBeNull();
    expect(screen.queryByText('Browser room')).toBeNull();
    expect(openRoomMock).toHaveBeenCalledWith(
      window.location.href,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.queryByText('Browser room')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the browser room when Companion is unavailable', async () => {
    openRoomMock.mockResolvedValue('unavailable');
    render(
      <CompanionRouteGate>
        <div>Browser room</div>
      </CompanionRouteGate>,
    );

    await waitFor(() => expect(screen.getByText('Browser room')).not.toBeNull());
  });

  it('keeps the room blocked without claiming success when confirmation is lost', async () => {
    openRoomMock.mockResolvedValue('relinquished');
    render(
      <CompanionRouteGate>
        <div>Browser room</div>
      </CompanionRouteGate>,
    );

    expect(await screen.findByText('Browser room paused')).not.toBeNull();
    expect(screen.queryByText('Room opened in Companion')).toBeNull();
    expect(screen.queryByText('Browser room')).toBeNull();
  });

  it('aborts an unfinished handoff when the route unmounts', () => {
    openRoomMock.mockReturnValue(new Promise(() => {}));
    const view = render(
      <CompanionRouteGate>
        <div>Browser room</div>
      </CompanionRouteGate>,
    );
    const signal = openRoomMock.mock.calls[0][1]?.signal;

    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
