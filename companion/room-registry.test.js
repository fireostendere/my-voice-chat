import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { RoomRegistry } from './room-registry.js';

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }
}

describe('RoomRegistry', () => {
  it('registers and removes active room sockets', () => {
    const registry = new RoomRegistry();
    const socket = new FakeSocket();
    registry.attachSocket(socket);

    socket.emit(
      'message',
      JSON.stringify({
        type: 'room-register',
        roomName: 'daily-room',
        participantIdentity: 'alex',
      }),
    );

    expect(registry.listRooms()).toEqual([
      expect.objectContaining({ roomName: 'daily-room', participantIdentity: 'alex' }),
    ]);
    expect(socket.sent[0]).toEqual(
      expect.objectContaining({ type: 'room-registered', roomId: expect.any(String) }),
    );

    socket.readyState = 3;
    socket.emit('close');
    expect(registry.listRooms()).toEqual([]);
  });

  it('delivers a torrent command and waits for room acknowledgement', async () => {
    const registry = new RoomRegistry({ commandTimeoutMs: 100 });
    const socket = new FakeSocket();
    registry.attachSocket(socket);
    socket.emit(
      'message',
      JSON.stringify({ type: 'room-register', roomName: 'cinema', participantIdentity: 'host' }),
    );
    const roomId = registry.listRooms()[0].id;

    const resultPromise = registry.openTorrent(roomId, {
      kind: 'magnet',
      magnet: 'magnet:?xt=urn:btih:0123456789abcdef',
      name: 'Movie',
    });
    const command = socket.sent.find((message) => message.type === 'torrent-open');
    socket.emit(
      'message',
      JSON.stringify({
        type: 'torrent-open-result',
        commandId: command.commandId,
        accepted: true,
        message: 'Torrent started.',
      }),
    );

    await expect(resultPromise).resolves.toEqual({ accepted: true, message: 'Torrent started.' });
  });

  it('tracks playback state and forwards remote player controls', async () => {
    const registry = new RoomRegistry({ commandTimeoutMs: 100 });
    const socket = new FakeSocket();
    registry.attachSocket(socket);
    socket.emit(
      'message',
      JSON.stringify({ type: 'room-register', roomName: 'cinema', participantIdentity: 'host' }),
    );
    socket.emit(
      'message',
      JSON.stringify({
        type: 'room-playback-state',
        playback: {
          active: true,
          name: 'Movie.mp4',
          phase: 'playing',
          status: 'Live · Companion',
          detail: 'Movie.mp4',
          currentTime: 12.5,
          duration: 120,
          paused: false,
          canSeek: true,
        },
      }),
    );

    const room = registry.listRooms()[0];
    expect(room.playback).toEqual(expect.objectContaining({ active: true, currentTime: 12.5 }));

    const resultPromise = registry.controlPlayback(room.id, { action: 'seek', currentTime: 42 });
    const command = socket.sent.find((message) => message.type === 'playback-control');
    expect(command).toEqual(
      expect.objectContaining({ action: 'seek', currentTime: 42, commandId: expect.any(String) }),
    );
    socket.emit(
      'message',
      JSON.stringify({
        type: 'playback-control-result',
        commandId: command.commandId,
        accepted: true,
        message: 'Playback control applied.',
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      accepted: true,
      message: 'Playback control applied.',
    });
  });

  it('rejects commands for rooms that are no longer connected', async () => {
    const registry = new RoomRegistry();
    await expect(
      registry.openTorrent('missing', {
        kind: 'magnet',
        magnet: 'magnet:?xt=urn:btih:0123456789abcdef',
        name: 'Movie',
      }),
    ).rejects.toThrow('no longer connected');
  });

  it('rejects malformed room registration without throwing', () => {
    const registry = new RoomRegistry();
    const socket = new FakeSocket();
    registry.attachSocket(socket);

    expect(() =>
      socket.emit('message', JSON.stringify({ type: 'room-register', roomName: '' })),
    ).not.toThrow();
    expect(registry.listRooms()).toEqual([]);
    expect(socket.sent).toEqual([
      expect.objectContaining({ type: 'room-register-error', message: 'Invalid room name.' }),
    ]);
  });
});
