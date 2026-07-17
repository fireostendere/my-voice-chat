import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isCompanionWebView, openRoomInCompanion } from './companionNavigation';

type Handler = ((event: any) => void) | null;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  onopen: Handler = null;
  onmessage: Handler = null;
  onerror: Handler = null;
  onclose: Handler = null;
  sent: string[] = [];
  close = vi.fn(() => {
    this.readyState = 3;
  });

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  send(value: string) {
    this.sent.push(value);
  }

  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

function socketOptions(timeoutMs = 100) {
  return { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket, timeoutMs };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  FakeWebSocket.instances = [];
  delete window.__LIVEKIT_COMPANION__;
  window.history.replaceState({}, '', '/');
});

describe('openRoomInCompanion', () => {
  it('opens an absolute same-origin room after the advertised handshake', async () => {
    const result = openRoomInCompanion('/rooms/cinema?hq=true#secret', socketOptions());
    const socket = FakeWebSocket.instances[0];

    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'capabilities' });

    socket.receive({ type: 'hello', version: 3, capabilities: ['ptt', 'open-room'] });
    const command = JSON.parse(socket.sent[1]);
    expect(command).toMatchObject({
      type: 'open-room',
      url: `${window.location.origin}/rooms/cinema?hq=true#secret`,
    });
    socket.receive({ type: 'hello', version: 3, capabilities: ['ptt', 'open-room'] });
    expect(socket.sent).toHaveLength(2);

    socket.receive({
      type: 'open-room-result',
      requestId: command.requestId,
      accepted: true,
    });

    await expect(result).resolves.toBe('accepted');
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('rejects old capabilities without sending an open command', async () => {
    const result = openRoomInCompanion('/custom?token=abc', socketOptions());
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'hello', version: 2, capabilities: ['ptt', 'torrent'] });

    await expect(result).resolves.toBe('unavailable');
    expect(socket.sent).toHaveLength(1);
  });

  it('rejects protocol v2 even if it advertises open-room', async () => {
    const result = openRoomInCompanion('/custom?token=abc#secret', socketOptions());
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'hello', version: 2, capabilities: ['open-room'] });

    await expect(result).resolves.toBe('unavailable');
    expect(socket.sent).toHaveLength(1);
  });

  it('stays relinquished when the acknowledgement is lost after sending the command', async () => {
    vi.useFakeTimers();
    const result = openRoomInCompanion('/rooms/cinema', socketOptions(25));
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'hello', version: 3, capabilities: ['open-room'] });
    socket.receive({ type: 'open-room-result', requestId: 'another-request', accepted: true });

    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toBe('relinquished');
    vi.useRealTimers();
  });

  it('stays relinquished after an explicit native rejection', async () => {
    const result = openRoomInCompanion('/rooms/cinema', socketOptions());
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'hello', version: 3, capabilities: ['open-room'] });
    const command = JSON.parse(socket.sent[1]);
    socket.receive({
      type: 'open-room-result',
      requestId: command.requestId,
      accepted: false,
    });

    await expect(result).resolves.toBe('relinquished');
  });

  it('stays relinquished when the socket closes after sending the command', async () => {
    const result = openRoomInCompanion('/rooms/cinema', socketOptions());
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'hello', version: 3, capabilities: ['open-room'] });

    socket.onclose?.({});

    await expect(result).resolves.toBe('relinquished');
  });

  it('closes the probe when its route is aborted', async () => {
    const controller = new AbortController();
    const result = openRoomInCompanion('/rooms/cinema', {
      ...socketOptions(),
      signal: controller.signal,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    controller.abort();

    await expect(result).resolves.toBe('unavailable');
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('rejects cross-origin destinations without connecting', async () => {
    await expect(
      openRoomInCompanion('https://example.com/rooms/cinema', socketOptions()),
    ).resolves.toBe('unavailable');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('rejects same-origin pages that are not room routes', async () => {
    await expect(openRoomInCompanion('/settings', socketOptions())).resolves.toBe('unavailable');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it.each([
    'wss://remote.example/companion',
    'ws://user:secret@127.0.0.1:7331',
    'https://127.0.0.1:7331',
  ])('never sends room secrets to a non-local Companion endpoint: %s', async (endpoint) => {
    vi.stubEnv('NEXT_PUBLIC_COMPANION_WS_URL', endpoint);

    await expect(openRoomInCompanion('/custom?token=jwt#e2ee', socketOptions())).resolves.toBe(
      'unavailable',
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('does not reconnect from inside the native WebView', async () => {
    window.__LIVEKIT_COMPANION__ = { host: 'webview2', platform: 'windows', version: 1 };

    expect(isCompanionWebView()).toBe(true);
    await expect(openRoomInCompanion('/rooms/cinema', socketOptions())).resolves.toBe(
      'unavailable',
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
