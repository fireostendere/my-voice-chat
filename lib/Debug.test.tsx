import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogLevel, setLogExtension, setLogLevel } from 'livekit-client';
import { datadogLogs } from '@datadog/browser-logs';
import { DebugMode } from './Debug';

vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  return { ...actual, setLogExtension: vi.fn(), setLogLevel: vi.fn() };
});

vi.mock('@datadog/browser-logs', () => ({
  datadogLogs: {
    init: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => room,
}));

const setLogExtensionMock = vi.mocked(setLogExtension);
const setLogLevelMock = vi.mocked(setLogLevel);
const datadogInitMock = vi.mocked(datadogLogs.init);

let room: {
  getSid: ReturnType<typeof vi.fn>;
  name: string;
  localParticipant: Record<string, unknown>;
  remoteParticipants: Map<string, unknown>;
};

beforeEach(() => {
  setLogExtensionMock.mockReset();
  setLogLevelMock.mockReset();
  datadogInitMock.mockReset();
  room = {
    getSid: vi.fn().mockResolvedValue('RM_test'),
    name: 'room',
    localParticipant: { identity: 'me', trackPublications: new Map() },
    remoteParticipants: new Map(),
  };
});

function mountAndUnmountRooms(count: number) {
  for (let index = 0; index < count; index += 1) {
    const { unmount } = render(<DebugMode />);
    unmount();
  }
}

describe('DebugMode logging setup', () => {
  it('never installs a LiveKit log extension without a Datadog configuration', () => {
    mountAndUnmountRooms(3);
    expect(setLogExtensionMock).not.toHaveBeenCalled();
    expect(datadogInitMock).not.toHaveBeenCalled();
  });

  it('installs the Datadog log extension once for the whole page lifetime', () => {
    vi.stubEnv('NEXT_PUBLIC_DATADOG_CLIENT_TOKEN', 'token');
    vi.stubEnv('NEXT_PUBLIC_DATADOG_SITE', 'datadoghq.eu');
    // setLogExtension only wraps the previous logger factory and has no way to
    // unwrap, so every extra call would leak another closure layer per room.
    mountAndUnmountRooms(3);
    expect(datadogInitMock).toHaveBeenCalledOnce();
    expect(setLogExtensionMock).toHaveBeenCalledOnce();

    const extension = setLogExtensionMock.mock.calls[0][0];
    extension(LogLevel.warn, 'after unmount', undefined);
    expect(datadogLogs.logger.warn).not.toHaveBeenCalled();

    render(<DebugMode />);
    extension(LogLevel.warn, 'while mounted', { a: 1 });
    expect(datadogLogs.logger.warn).toHaveBeenCalledWith('while mounted', { a: 1 });
    expect(setLogExtensionMock).toHaveBeenCalledOnce();
  });

  it('restores the LiveKit log level when the room unmounts', () => {
    const { unmount } = render(<DebugMode logLevel={LogLevel.debug} />);
    expect(setLogLevelMock).toHaveBeenLastCalledWith(LogLevel.debug);
    unmount();
    expect(setLogLevelMock).toHaveBeenLastCalledWith(LogLevel.info);
  });

  it('ignores a room that leaves before its server id is known', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let reject!: (error: Error) => void;
    room.getSid.mockImplementation(
      () =>
        new Promise<string>((_, settle) => {
          reject = settle;
        }),
    );
    const { unmount } = render(<DebugMode />);
    unmount();
    reject(new Error('Room disconnected before room server id was available'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
