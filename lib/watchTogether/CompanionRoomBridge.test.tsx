import React from 'react';
import { act, render } from '@testing-library/react';
import { RoomEvent } from 'livekit-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionRoomBridge } from './CompanionRoomBridge';

const context = vi.hoisted(() => ({
  room: null as any,
  watchTogether: {
    embed: { active: false },
    startTorrent: vi.fn(),
    streamPlayback: { active: false },
    controlStream: vi.fn(),
  },
}));

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => context.room,
}));

vi.mock('./WatchTogetherContext', () => ({
  useWatchTogether: () => context.watchTogether,
}));

type Handler = ((event: any) => void) | null;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({});
  });

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }
}

function makeRoom(name = '', identity = '') {
  const handlers = new Map<string, Set<() => void>>();
  const room = {
    name,
    localParticipant: { identity },
    on: vi.fn((event: string, handler: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return room;
    }),
    off: vi.fn((event: string, handler: () => void) => {
      handlers.get(event)?.delete(handler);
      return room;
    }),
    emit(event: string) {
      handlers.get(event)?.forEach((handler) => handler());
    },
  };
  return room;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as any);
});

describe('CompanionRoomBridge', () => {
  it('waits for LiveKit to connect before registering the room', () => {
    const room = makeRoom();
    context.room = room;
    render(<CompanionRoomBridge />);

    expect(FakeWebSocket.instances).toHaveLength(0);

    act(() => {
      room.name = 'cinema';
      room.localParticipant.identity = 'alice';
      room.emit(RoomEvent.Connected);
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:7331');

    act(() => FakeWebSocket.instances[0].open());
    expect(FakeWebSocket.instances[0].send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({
        type: 'room-register',
        roomName: 'cinema',
        participantIdentity: 'alice',
      }),
    );
  });

  it('connects immediately when the room is already ready', () => {
    context.room = makeRoom('cinema', 'alice');
    render(<CompanionRoomBridge />);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
