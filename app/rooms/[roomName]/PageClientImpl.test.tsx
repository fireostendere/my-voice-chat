import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageClientImpl } from './PageClientImpl';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@livekit/components-react', () => ({
  PreJoin: ({ onSubmit, joinLabel, defaults }: any) => (
    <button
      data-camera={defaults.videoEnabled}
      onClick={() => onSubmit({ username: 'Alice', videoEnabled: false, audioEnabled: true })}
    >
      {joinLabel}
    </button>
  ),
  RoomContext: { Provider: ({ children }: any) => children },
}));
vi.mock('@/lib/CustomVideoConference', () => ({
  CustomVideoConference: () => <div>In the room</div>,
}));
vi.mock('@/lib/Debug', () => ({ DebugMode: () => null }));
vi.mock('@/lib/KeyboardShortcuts', () => ({ KeyboardShortcuts: () => null }));
vi.mock('@/lib/RecordingIndicator', () => ({ RecordingIndicator: () => null }));
vi.mock('@/lib/SettingsMenu', () => ({ SettingsMenu: () => null }));
vi.mock('@/lib/useSetupE2EE', () => ({ useSetupE2EE: () => ({ e2eeEnabled: false }) }));
vi.mock('@/lib/usePerformanceOptimiser', () => ({ useLowCPUOptimizer: () => false }));
vi.mock('@/lib/useWakeLock', () => ({ useWakeLock: () => {} }));
vi.mock('@/lib/usePushToTalk', () => ({
  usePushToTalk: () => ({ connected: false, talking: false }),
}));
vi.mock('@/lib/useRoomConnection', () => ({ useRoomConnection: () => ({}) }));

const props = { roomName: 'friends', hq: false, codec: 'vp9' as const, singlePeerConnection: true };

describe('room prejoin', () => {
  it('starts with camera off and reports token-server failures without entering the room', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    render(<PageClientImpl {...props} />);
    expect(screen.getByRole('button').getAttribute('data-camera')).toBe('false');
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not get access'),
    );
    expect(screen.queryByText('In the room')).toBeNull();
    expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(false);
  });

  it('prevents repeated submissions and aborts a pending request on unmount', () => {
    const fetchMock = vi.fn((_url: URL, _options: RequestInit) => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<PageClientImpl {...props} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    expect(fetchMock).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[0][1].signal!;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('rejects incomplete successful responses instead of connecting with missing credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ serverUrl: 'wss://server.example' }) }),
    );
    render(<PageClientImpl {...props} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('incomplete room details'),
    );
    expect(screen.queryByText('In the room')).toBeNull();
  });
});
