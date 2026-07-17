import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { NativeNavigationService, navigationPipePath } from './native-navigation-service.js';

class FakeBrowserSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }
}

class FakePipe extends EventEmitter {
  constructor(onWrite) {
    super();
    this.onWrite = onWrite;
    this.writes = [];
    this.destroyed = false;
  }

  setEncoding() {}

  write(payload) {
    this.writes.push(payload);
    this.onWrite?.(this, payload);
  }

  destroy() {
    this.destroyed = true;
  }
}

function connectedPipe(response) {
  const pipe = new FakePipe((current) => {
    if (response !== undefined) {
      queueMicrotask(() => current.emit('data', `${JSON.stringify(response)}\n`));
    }
  });
  queueMicrotask(() => pipe.emit('connect'));
  return pipe;
}

function connectedRawPipe(responseLine) {
  const pipe = new FakePipe((current) => {
    queueMicrotask(() => current.emit('data', `${responseLine}\n`));
  });
  queueMicrotask(() => pipe.emit('connect'));
  return pipe;
}

function unavailablePipe() {
  const pipe = new FakePipe();
  queueMicrotask(() => pipe.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })));
  return pipe;
}

function createService(overrides = {}) {
  return new NativeNavigationService({
    uiPort: 7333,
    launcherPath: 'C:\\LiveKitCompanion\\LiveKitCompanion.exe',
    getWebAppUrl: async () => 'https://chat.example.com/',
    fsImpl: { existsSync: () => true },
    ipcTimeoutMs: 20,
    launchTimeoutMs: 100,
    retryIntervalMs: 1,
    ...overrides,
  });
}

async function waitForResult(socket) {
  await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
  return socket.sent[0];
}

describe('NativeNavigationService', () => {
  it('advertises open-room only when the launcher exists and the origin is selected', async () => {
    const available = createService();
    const missing = createService({ fsImpl: { existsSync: () => false } });

    await expect(
      available.attachSocket(new FakeBrowserSocket(), { origin: 'https://chat.example.com' }),
    ).resolves.toEqual(['open-room']);
    await expect(
      available.attachSocket(new FakeBrowserSocket(), { origin: 'https://other.example.com' }),
    ).resolves.toEqual([]);
    await expect(
      missing.attachSocket(new FakeBrowserSocket(), { origin: 'https://chat.example.com' }),
    ).resolves.toEqual([]);
  });

  it('forwards the exact room URL through bounded JSONL pipe IPC', async () => {
    const pipes = [];
    const connectImpl = vi.fn(() => {
      const pipe = connectedPipe({ accepted: true });
      pipes.push(pipe);
      return pipe;
    });
    const service = createService({ connectImpl });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });
    const url = 'https://chat.example.com/rooms/daily?codec=vp9#secret';

    socket.emit('message', JSON.stringify({ type: 'open-room', requestId: 'request-1', url }));

    await expect(waitForResult(socket)).resolves.toEqual({
      type: 'open-room-result',
      requestId: 'request-1',
      accepted: true,
    });
    expect(connectImpl).toHaveBeenCalledWith('\\\\.\\pipe\\LiveKitCompanion.Navigation.7333');
    expect(pipes[0].writes).toEqual([
      `${JSON.stringify({ version: 1, requestId: 'request-1', url })}\n`,
    ]);
  });

  it('allows only one in-flight navigation globally across browser sockets', async () => {
    const pipe = new FakePipe();
    const connectImpl = vi.fn(() => {
      queueMicrotask(() => pipe.emit('connect'));
      return pipe;
    });
    const service = createService({ connectImpl, ipcTimeoutMs: 5000 });
    const firstSocket = new FakeBrowserSocket();
    const secondSocket = new FakeBrowserSocket();
    service.attachSocket(firstSocket, { origin: 'https://chat.example.com' });
    service.attachSocket(secondSocket, { origin: 'https://chat.example.com' });

    firstSocket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'first',
        url: 'https://chat.example.com/rooms/first',
      }),
    );
    secondSocket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'second',
        url: 'https://chat.example.com/rooms/second',
      }),
    );

    await vi.waitFor(() =>
      expect(secondSocket.sent).toContainEqual(
        expect.objectContaining({ requestId: 'second', accepted: false }),
      ),
    );
    await vi.waitFor(() => expect(connectImpl).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(pipe.writes).toHaveLength(1));

    pipe.emit('data', `${JSON.stringify({ accepted: true })}\n`);
    await vi.waitFor(() =>
      expect(firstSocket.sent).toContainEqual({
        type: 'open-room-result',
        requestId: 'first',
        accepted: true,
      }),
    );
  });

  it.each(['close', 'error'])('cancels connected pipe work on browser %s', async (event) => {
    const pipe = new FakePipe();
    const connectImpl = vi.fn(() => {
      queueMicrotask(() => pipe.emit('connect'));
      return pipe;
    });
    const spawnImpl = vi.fn();
    const service = createService({ connectImpl, spawnImpl, ipcTimeoutMs: 5000 });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'cancel-connected',
        url: 'https://chat.example.com/rooms/cancelled',
      }),
    );
    await vi.waitFor(() => expect(pipe.writes).toHaveLength(1));

    socket.readyState = 3;
    socket.emit(event, ...(event === 'error' ? [new Error('disconnected')] : []));

    await vi.waitFor(() => expect(pipe.destroyed).toBe(true));
    await vi.waitFor(() => expect(service.activeNavigation).toBeNull());
    expect(connectImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([]);
  });

  it('cancels the launcher retry delay without another pipe attempt', async () => {
    const connectImpl = vi.fn(() => unavailablePipe());
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnImpl = vi.fn(() => child);
    const service = createService({
      connectImpl,
      spawnImpl,
      launchTimeoutMs: 5000,
      retryIntervalMs: 5000,
    });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'cancel-retry',
        url: 'https://chat.example.com/rooms/cancelled',
      }),
    );
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1));

    socket.readyState = 3;
    socket.emit('close');

    await vi.waitFor(() => expect(service.activeNavigation).toBeNull());
    expect(connectImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(socket.sent).toEqual([]);
  });

  it('releases the global handoff promptly when config loading is cancelled', async () => {
    let resolveConfig;
    const config = new Promise((resolve) => {
      resolveConfig = resolve;
    });
    const connectImpl = vi.fn();
    const service = createService({
      connectImpl,
      getWebAppUrl: () => config,
    });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'cancel-config',
        url: 'https://chat.example.com/rooms/cancelled',
      }),
    );
    await vi.waitFor(() => expect(service.activeNavigation?.socket).toBe(socket));

    socket.readyState = 3;
    socket.emit('close');

    await vi.waitFor(() => expect(service.activeNavigation).toBeNull());
    expect(connectImpl).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([]);
    resolveConfig('https://chat.example.com/');
  });

  it.each([
    ['a different origin', 'https://other.example.com/rooms/daily'],
    ['remote HTTP', 'http://chat.example.com/rooms/daily'],
    ['credentials', 'https://user:secret@chat.example.com/rooms/daily'],
    ['a relative URL', '/rooms/daily'],
    ['the home page', 'https://chat.example.com/'],
    ['an API route', 'https://chat.example.com/api/connection-details'],
    ['a nested room path', 'https://chat.example.com/rooms/daily/extra'],
  ])('rejects %s before contacting the native client', async (_label, url) => {
    const connectImpl = vi.fn();
    const service = createService({ connectImpl });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit('message', JSON.stringify({ type: 'open-room', requestId: 'request-2', url }));

    await expect(waitForResult(socket)).resolves.toEqual(
      expect.objectContaining({
        type: 'open-room-result',
        requestId: 'request-2',
        accepted: false,
      }),
    );
    expect(connectImpl).not.toHaveBeenCalled();
  });

  it('rejects a URL longer than 8192 characters', async () => {
    const connectImpl = vi.fn();
    const service = createService({ connectImpl });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'request-too-long',
        url: `https://chat.example.com/rooms/${'a'.repeat(8192)}`,
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual(
      expect.objectContaining({ requestId: 'request-too-long', accepted: false }),
    );
    expect(connectImpl).not.toHaveBeenCalled();
  });

  it('accepts HTTP only when both origins are loopback', async () => {
    const pipes = [];
    const service = createService({
      getWebAppUrl: async () => 'http://127.0.0.1:3000/',
      connectImpl: () => {
        const pipe = connectedPipe({ accepted: true });
        pipes.push(pipe);
        return pipe;
      },
    });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'http://127.0.0.1:3000' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'loopback',
        url: 'http://127.0.0.1:3000/rooms/local?hq=true#key',
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual(
      expect.objectContaining({ requestId: 'loopback', accepted: true }),
    );
    expect(pipes[0].writes[0]).toContain('/rooms/local?hq=true#key');
  });

  it('accepts the custom room route and preserves its query and hash', async () => {
    const pipes = [];
    const service = createService({
      connectImpl: () => {
        const pipe = connectedPipe({ accepted: true });
        pipes.push(pipe);
        return pipe;
      },
    });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'custom',
        url: 'https://chat.example.com/custom/?token=value#key',
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual(
      expect.objectContaining({ requestId: 'custom', accepted: true }),
    );
    expect(pipes[0].writes[0]).toContain('/custom/?token=value#key');
  });

  it('rejects a configured-origin mismatch and keeps the upgrade Origin immutable', async () => {
    const connectImpl = vi.fn();
    let configuredUrl = 'https://other.example.com/';
    const service = createService({
      connectImpl,
      getWebAppUrl: async () => configuredUrl,
    });
    const socket = new FakeBrowserSocket();
    const request = { headers: { origin: 'https://chat.example.com' } };
    service.attachSocket(socket, { origin: request.headers.origin });
    request.headers.origin = 'https://other.example.com';
    configuredUrl = 'https://other.example.com/';

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'request-3',
        url: 'https://other.example.com/rooms/daily',
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual(
      expect.objectContaining({ requestId: 'request-3', accepted: false }),
    );
    expect(connectImpl).not.toHaveBeenCalled();
  });

  it('spawns --open without the URL and retries when the pipe is unavailable', async () => {
    const connectImpl = vi
      .fn()
      .mockImplementationOnce(() => unavailablePipe())
      .mockImplementationOnce(() => connectedPipe({ accepted: true, message: 'Opened.' }));
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnImpl = vi.fn(() => child);
    const service = createService({ connectImpl, spawnImpl });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'request-4',
        url: 'https://chat.example.com/rooms/private#passphrase',
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual({
      type: 'open-room-result',
      requestId: 'request-4',
      accepted: true,
      message: 'Opened.',
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      'C:\\LiveKitCompanion\\LiveKitCompanion.exe',
      ['--open'],
      expect.objectContaining({ shell: false }),
    );
    expect(JSON.stringify(spawnImpl.mock.calls)).not.toContain('passphrase');
    expect(connectImpl).toHaveBeenCalledTimes(2);
  });

  it('forwards a native rejection with the matching requestId', async () => {
    const service = createService({
      connectImpl: () => connectedPipe({ accepted: false, message: 'Navigation denied.' }),
    });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'request-5',
        url: 'https://chat.example.com/rooms/daily',
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual({
      type: 'open-room-result',
      requestId: 'request-5',
      accepted: false,
      message: 'Navigation denied.',
    });
  });

  it('fails closed when a connected native client times out', async () => {
    const spawnImpl = vi.fn();
    const service = createService({
      connectImpl: () => connectedPipe(),
      spawnImpl,
      ipcTimeoutMs: 5,
    });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'request-6',
        url: 'https://chat.example.com/rooms/daily',
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual(
      expect.objectContaining({ requestId: 'request-6', accepted: false }),
    );
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('rejects a native response that exceeds the bounded JSONL frame', async () => {
    const service = createService({
      connectImpl: () =>
        connectedRawPipe(JSON.stringify({ accepted: true, padding: 'x'.repeat(5000) })),
    });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'oversized-response',
        url: 'https://chat.example.com/rooms/daily',
      }),
    );

    await expect(waitForResult(socket)).resolves.toEqual(
      expect.objectContaining({ requestId: 'oversized-response', accepted: false }),
    );
  });

  it('ignores an invalid requestId without opening the native client', async () => {
    const connectImpl = vi.fn();
    const service = createService({ connectImpl });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: '',
        url: 'https://chat.example.com/rooms/daily',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.sent).toEqual([]);
    expect(connectImpl).not.toHaveBeenCalled();
  });

  it('ignores a requestId longer than 128 characters', async () => {
    const connectImpl = vi.fn();
    const service = createService({ connectImpl });
    const socket = new FakeBrowserSocket();
    service.attachSocket(socket, { origin: 'https://chat.example.com' });

    socket.emit(
      'message',
      JSON.stringify({
        type: 'open-room',
        requestId: 'x'.repeat(129),
        url: 'https://chat.example.com/rooms/daily',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.sent).toEqual([]);
    expect(connectImpl).not.toHaveBeenCalled();
  });
});

describe('navigationPipePath', () => {
  it('names the Windows pipe after the Settings UI port', () => {
    expect(navigationPipePath(7333)).toBe('\\\\.\\pipe\\LiveKitCompanion.Navigation.7333');
  });
});
