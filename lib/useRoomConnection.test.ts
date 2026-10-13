import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DisconnectReason,
  RoomEvent,
  type Room,
  type ExternalE2EEKeyProvider,
} from 'livekit-client';
import { useRoomConnection } from './useRoomConnection';

function fixture() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const room = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    setE2EEEnabled: vi.fn().mockResolvedValue(undefined),
    localParticipant: {
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
    },
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    off: vi.fn((event) => handlers.delete(event)),
  };
  const options = {
    serverUrl: 'wss://server.example',
    token: 'test-token',
    audioEnabled: true,
    videoEnabled: false,
    keyProvider: {
      setKey: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExternalE2EEKeyProvider,
    onLeave: vi.fn(),
  };
  const render = (overrides = {}) =>
    renderHook(() => useRoomConnection(room as unknown as Room, { ...options, ...overrides }));
  return { room, options, handlers, render };
}

describe('room connection lifecycle', () => {
  it('waits for encryption before connecting and for connection before enabling devices', async () => {
    const { room, render } = fixture();
    let finishEncryption!: () => void;
    let finishConnection!: () => void;
    room.setE2EEEnabled.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishEncryption = resolve;
        }),
    );
    room.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishConnection = resolve;
        }),
    );
    render({ e2eePassphrase: 'secret' });
    await waitFor(() => expect(room.setE2EEEnabled).toHaveBeenCalledWith(true));
    expect(room.connect).not.toHaveBeenCalled();
    await act(async () => finishEncryption());
    expect(room.connect).toHaveBeenCalledOnce();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    await act(async () => finishConnection());
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it('never connects without encryption when encrypted-room setup fails', async () => {
    const { room, render } = fixture();
    room.setE2EEEnabled.mockRejectedValue(new Error('Unsupported encryption'));
    const { result } = render({ e2eePassphrase: 'secret' });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(room.connect).not.toHaveBeenCalled();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('shows a failed join and can retry it', async () => {
    const { room, render, options } = fixture();
    room.connect.mockRejectedValueOnce(new Error('Network unavailable'));
    const { result } = render();
    await waitFor(() => expect(result.current.error).toContain('Could not join'));
    act(() => result.current.retry());
    await waitFor(() => expect(room.connect).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeUndefined();
    expect(options.onLeave).not.toHaveBeenCalled();
  });

  it('waits for a previous connection to close before a retry can connect again', async () => {
    const { room, handlers, render, options } = fixture();
    const { result } = render();
    await waitFor(() => expect(room.connect).toHaveBeenCalledOnce());
    let finishDisconnect!: () => void;
    const disconnecting = new Promise<void>((resolve) => {
      finishDisconnect = resolve;
    });
    room.disconnect.mockReturnValue(disconnecting);
    act(() => result.current.retry());
    expect(room.connect).toHaveBeenCalledOnce();
    expect(handlers.has(RoomEvent.Disconnected)).toBe(false);
    await act(async () => {
      handlers.get(RoomEvent.Disconnected)?.(DisconnectReason.CLIENT_INITIATED);
      room.disconnect.mockResolvedValue(undefined);
      finishDisconnect();
    });
    await waitFor(() => expect(room.connect).toHaveBeenCalledTimes(2));
    expect(options.onLeave).not.toHaveBeenCalled();
  });

  it('stops a late connection and never starts devices after the page unmounts', async () => {
    const { room, render, options } = fixture();
    let finishConnection!: () => void;
    room.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishConnection = resolve;
        }),
    );
    const { unmount } = render();
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    unmount();
    await act(async () => finishConnection());
    expect(room.disconnect).toHaveBeenCalled();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(options.onLeave).not.toHaveBeenCalled();
  });

  it('returns home on an intentional leave and offers recovery for a dropped connection', async () => {
    const { room, handlers, render, options } = fixture();
    const { result } = render();
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    act(() => handlers.get(RoomEvent.Disconnected)?.(DisconnectReason.SERVER_SHUTDOWN));
    expect(result.current.error).toContain('connection to the room was lost');
    expect(options.onLeave).not.toHaveBeenCalled();
    act(() => handlers.get(RoomEvent.Disconnected)?.(DisconnectReason.CLIENT_INITIATED));
    expect(options.onLeave).toHaveBeenCalledOnce();
  });
});
