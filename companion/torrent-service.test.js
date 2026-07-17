import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TorrentService } from './torrent-service.js';

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

describe('TorrentService capability handshake', () => {
  it('advertises PTT and torrent support when a browser connects', () => {
    const service = new TorrentService({ port: 7332 });
    const socket = new FakeSocket();
    service.attachSocket(socket);
    expect(socket.sent).toEqual([{ type: 'hello', version: 3, capabilities: ['ptt', 'torrent'] }]);
  });

  it('answers an explicit capabilities request', () => {
    const service = new TorrentService({ port: 7332 });
    const socket = new FakeSocket();
    service.attachSocket(socket);
    socket.emit('message', JSON.stringify({ type: 'capabilities' }));
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[1].capabilities).toContain('torrent');
  });

  it('advertises only PTT when torrent access is not trusted', () => {
    const service = new TorrentService({ port: 7332 });
    const socket = new FakeSocket();
    service.attachSocket(socket, { enableTorrent: false });
    expect(socket.sent[0].capabilities).toEqual(['ptt']);

    socket.emit(
      'message',
      JSON.stringify({
        type: 'torrent-start',
        requestId: 'blocked',
        input: { kind: 'magnet', magnet: 'magnet:?xt=urn:btih:0123456789abcdef' },
      }),
    );
    expect(service.active).toBeNull();
  });

  it('includes optional capabilities without duplicates', () => {
    const service = new TorrentService({ port: 7332 });
    const socket = new FakeSocket();
    service.attachSocket(socket, {
      extraCapabilities: ['open-room', 'ptt', 'open-room'],
    });

    expect(socket.sent[0]).toEqual({
      type: 'hello',
      version: 3,
      capabilities: ['ptt', 'torrent', 'open-room'],
    });

    socket.emit('message', JSON.stringify({ type: 'capabilities' }));
    expect(socket.sent[1]).toEqual(socket.sent[0]);
  });

  it('waits for asynchronously selected capabilities without losing the socket listener', async () => {
    const service = new TorrentService({ port: 7332 });
    const socket = new FakeSocket();
    let resolveCapabilities;
    const extraCapabilities = new Promise((resolve) => {
      resolveCapabilities = resolve;
    });
    service.attachSocket(socket, { extraCapabilities });
    socket.emit('message', JSON.stringify({ type: 'capabilities' }));

    expect(socket.sent).toEqual([]);
    resolveCapabilities(['open-room']);
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(socket.sent[0].capabilities).toEqual(['ptt', 'torrent', 'open-room']);
  });
});
