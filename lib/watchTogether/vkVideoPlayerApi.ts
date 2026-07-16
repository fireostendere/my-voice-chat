export const VK_PLAYER_ORIGIN = 'https://vk.ru';

const VK_PLAYER_EVENTS = new Set([
  'inited',
  'timeupdate',
  'volumechange',
  'qualitychange',
  'started',
  'resumed',
  'paused',
  'seeked',
  'ended',
  'error',
  'adStarted',
  'adCompleted',
  'autoplaySoundProhibited',
  'fullscreenEnter',
  'fullscreenExit',
]);

const VK_PLAYER_STATES = new Set(['uninited', 'unstarted', 'playing', 'paused', 'ended', 'error']);

export type VkPlayerEvent = {
  event: string;
  state: string;
  time: number;
  duration: number;
  errorCode: number;
};

type VkPlayerListener = (event: VkPlayerEvent) => void;
type VkPlayerCommand = { method: 'init' | 'play' | 'pause' } | { method: 'seek'; time: number };

export type VkVideoPlayerApi = {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getState: () => string;
  on: (event: string, listener: VkPlayerListener) => void;
  off: (event: string, listener: VkPlayerListener) => void;
  destroy: () => void;
};

/**
 * A small, origin-strict adapter for VK's documented Video Player postMessage API.
 * It mirrors the official wrapper while avoiding another remote script dependency.
 */
export function createVkVideoPlayer(iframe: HTMLIFrameElement): VkVideoPlayerApi {
  const iframeUrl = new URL(iframe.src);
  if (iframeUrl.origin !== VK_PLAYER_ORIGIN || iframeUrl.pathname !== '/video_ext.php') {
    throw new Error('iframe src is not a trusted VK Video embed');
  }
  if (iframeUrl.searchParams.get('js_api') !== '1') {
    throw new Error('VK Video embed is missing js_api=1');
  }

  let destroyed = false;
  let ready = false;
  let state = 'uninited';
  let currentTime = 0;
  let duration = 0;
  let errorCode = 0;
  const queue: VkPlayerCommand[] = [];
  const listeners = new Map<string, Set<VkPlayerListener>>();

  const post = (command: VkPlayerCommand) => {
    if (destroyed) return;
    const target = iframe.contentWindow;
    if (!target) return;
    if (!ready && command.method !== 'init') {
      queue.push(command);
      return;
    }
    target.postMessage(command, VK_PLAYER_ORIGIN);
  };

  const onMessage = (message: MessageEvent) => {
    if (
      destroyed ||
      message.origin !== VK_PLAYER_ORIGIN ||
      message.source !== iframe.contentWindow
    ) {
      return;
    }
    const event = sanitizeVkPlayerEvent(message.data, {
      state,
      time: currentTime,
      duration,
      errorCode,
    });
    if (!event) return;

    state = event.state;
    currentTime = event.time;
    duration = event.duration;
    errorCode = event.errorCode;
    if (event.event === 'inited' && !ready) {
      ready = true;
      while (queue.length > 0) post(queue.shift()!);
    }
    listeners.get(event.event)?.forEach((listener) => listener(event));
  };

  // The first init can race the iframe's navigation away from about:blank.
  // Sending it again on load mirrors the official wrapper while making a
  // dynamically created iframe deterministic on slower connections.
  const onLoad = () => post({ method: 'init' });
  iframe.addEventListener('load', onLoad);
  window.addEventListener('message', onMessage);
  post({ method: 'init' });

  return {
    play: () => post({ method: 'play' }),
    pause: () => post({ method: 'pause' }),
    seek: (time: number) => {
      if (Number.isFinite(time) && time >= 0) post({ method: 'seek', time });
    },
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    getState: () => state,
    on: (event, listener) => {
      if (!VK_PLAYER_EVENTS.has(event)) return;
      const eventListeners = listeners.get(event) ?? new Set<VkPlayerListener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    off: (event, listener) => listeners.get(event)?.delete(listener),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      queue.length = 0;
      listeners.clear();
      iframe.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
    },
  };
}

function sanitizeVkPlayerEvent(
  value: unknown,
  previous: { state: string; time: number; duration: number; errorCode: number },
): VkPlayerEvent | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.event !== 'string' || !VK_PLAYER_EVENTS.has(data.event)) return null;
  if (data.state !== undefined && !VK_PLAYER_STATES.has(String(data.state))) return null;
  if (data.time !== undefined && !isNonNegativeFiniteNumber(data.time)) return null;
  if (data.duration !== undefined && !isNonNegativeFiniteNumber(data.duration)) return null;
  if (data.errorCode !== undefined && !isNonNegativeFiniteNumber(data.errorCode)) return null;

  let nextState = typeof data.state === 'string' ? data.state : previous.state;
  if (data.event === 'started' || data.event === 'resumed') nextState = 'playing';
  if (data.event === 'paused') nextState = 'paused';
  if (data.event === 'ended') nextState = 'ended';
  if (data.event === 'error') nextState = 'error';

  return {
    event: data.event,
    state: nextState,
    time: typeof data.time === 'number' ? data.time : previous.time,
    duration: typeof data.duration === 'number' ? data.duration : previous.duration,
    errorCode: typeof data.errorCode === 'number' ? data.errorCode : previous.errorCode,
  };
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
