import { getCompanionNavigationWsUrl } from './companion';
import { isCompanionWebView } from './companionMarker';

export { isCompanionWebView } from './companionMarker';

// A cold WebView2 profile may need up to a minute for runtime creation and the
// initial page load. Keep this above the native and Node IPC deadlines so the
// browser does not cancel a handoff that is still legitimately starting.
const OPEN_ROOM_TIMEOUT_MS = 130_000;
const COMPANION_HANDSHAKE_TIMEOUT_MS = 10_000;

type WebSocketConstructor = new (url: string | URL, protocols?: string | string[]) => WebSocket;

export type OpenRoomInCompanionOptions = {
  timeoutMs?: number;
  WebSocketImpl?: WebSocketConstructor;
  signal?: AbortSignal;
};

export type CompanionHandoffResult = 'unavailable' | 'accepted' | 'relinquished';

export function openRoomInCompanion(
  targetUrl: string,
  options: OpenRoomInCompanionOptions = {},
): Promise<CompanionHandoffResult> {
  if (typeof window === 'undefined' || isCompanionWebView() || options.signal?.aborted) {
    return Promise.resolve('unavailable');
  }

  let url: URL;
  try {
    url = new URL(targetUrl, window.location.href);
  } catch {
    return Promise.resolve('unavailable');
  }
  if (url.origin !== window.location.origin || !isRoomRoute(url.pathname)) {
    return Promise.resolve('unavailable');
  }

  const wsUrl = getLocalCompanionWsUrl(getCompanionNavigationWsUrl());
  if (!wsUrl) return Promise.resolve('unavailable');

  const WebSocketImpl = options.WebSocketImpl ?? window.WebSocket;
  if (typeof WebSocketImpl !== 'function') return Promise.resolve('unavailable');
  const requestId = createRequestId();

  return new Promise((resolve) => {
    let socket: WebSocket | undefined;
    let settled = false;
    let commandSent = false;
    let timer: ReturnType<typeof setTimeout>;

    // Once the command has been handed to a protocol-compatible Companion,
    // fail closed. A lost acknowledgement must never mount a second room in
    // this tab while the native client may still complete the navigation.
    const finish = (
      result: CompanionHandoffResult = commandSent ? 'relinquished' : 'unavailable',
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      socket?.close();
      resolve(result);
    };

    const onAbort = () => finish();
    timer = setTimeout(() => finish(), options.timeoutMs ?? COMPANION_HANDSHAKE_TIMEOUT_MS);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    try {
      socket = new WebSocketImpl(wsUrl);
    } catch {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve('unavailable');
      return;
    }

    socket.onopen = () => {
      try {
        socket?.send(JSON.stringify({ type: 'capabilities' }));
      } catch {
        finish('unavailable');
      }
    };
    socket.onerror = () => finish();
    socket.onclose = () => finish();
    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (message.type === 'hello') {
        if (message.version !== 3) {
          finish('unavailable');
          return;
        }
        const capabilities = Array.isArray(message.capabilities) ? message.capabilities : [];
        if (!capabilities.includes('open-room')) {
          finish('unavailable');
          return;
        }
        if (commandSent) return;
        try {
          socket?.send(
            JSON.stringify({
              type: 'open-room',
              requestId,
              url: url.href,
            }),
          );
          commandSent = true;
          clearTimeout(timer);
          timer = setTimeout(() => finish(), options.timeoutMs ?? OPEN_ROOM_TIMEOUT_MS);
        } catch {
          finish('unavailable');
        }
        return;
      }

      if (message.type !== 'open-room-result' || message.requestId !== requestId) return;
      finish(message.accepted === true ? 'accepted' : 'relinquished');
    };
  });
}

function createRequestId(): string {
  return `open-room-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRoomRoute(pathname: string): boolean {
  return /^\/rooms\/[^/]+\/?$/.test(pathname) || pathname === '/custom' || pathname === '/custom/';
}

function getLocalCompanionWsUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (
    (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
    !loopbackHosts.has(url.hostname.toLowerCase()) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    return null;
  }
  return url.href;
}
