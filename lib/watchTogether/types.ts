import { isVkVideoSource } from './vkVideoUrl';

export const WATCH_TOGETHER_TOPIC = 'watch-together';

// Hosts broadcast a heartbeat on this cadence while an embed is active.
export const HEARTBEAT_INTERVAL_MS = 2500;
// Viewers treat three missed beats (plus slack) as "host gone".
export const HEARTBEAT_TIMEOUT_MS = 3 * HEARTBEAT_INTERVAL_MS + 1000;
// Viewers only re-seek when they drift further than this from the host.
export const DRIFT_TOLERANCE_S = 0.6;

export type EmbedKind = 'url' | 'youtube' | 'vk';

export type WatchSyncMessage =
  | { type: 'start-embed'; kind: EmbedKind; src: string; hostIdentity: string; ts: number }
  | { type: 'play'; currentTime: number; ts: number }
  | { type: 'pause'; currentTime: number; ts: number }
  | { type: 'seek'; currentTime: number; ts: number }
  | {
      type: 'heartbeat';
      kind: EmbedKind;
      src: string;
      hostIdentity: string;
      currentTime: number;
      isPlaying: boolean;
      ts: number;
    }
  | { type: 'stop'; ts: number };

export function isWatchSyncMessage(value: unknown): value is WatchSyncMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== 'string' || !isFiniteNumber(message.ts)) return false;

  if (message.type === 'stop') return true;
  if (message.type === 'play' || message.type === 'pause' || message.type === 'seek') {
    return isFiniteNumber(message.currentTime) && message.currentTime >= 0;
  }
  if (message.type === 'start-embed') {
    return (
      isEmbedKind(message.kind) &&
      isEmbedSource(message.kind, message.src) &&
      typeof message.hostIdentity === 'string' &&
      message.hostIdentity.length > 0
    );
  }
  if (message.type === 'heartbeat') {
    return (
      isEmbedKind(message.kind) &&
      isEmbedSource(message.kind, message.src) &&
      typeof message.hostIdentity === 'string' &&
      message.hostIdentity.length > 0 &&
      isFiniteNumber(message.currentTime) &&
      message.currentTime >= 0 &&
      typeof message.isPlaying === 'boolean'
    );
  }
  return false;
}

function isEmbedKind(value: unknown): value is EmbedKind {
  return value === 'url' || value === 'youtube' || value === 'vk';
}

function isEmbedSource(kind: EmbedKind, value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) return false;
  if (kind === 'youtube') return /^[A-Za-z0-9_-]{6,128}$/.test(value);
  if (kind === 'vk') return isVkVideoSource(value);
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export type WatchTogetherEmbedState =
  | { active: false }
  | {
      active: true;
      kind: EmbedKind;
      src: string;
      hostIdentity: string;
      isHost: boolean;
    };

export type TorrentInput =
  | { kind: 'magnet'; magnet: string; name: string }
  | { kind: 'torrent-file'; bytes: Uint8Array; name: string };

export type WatchTogetherStreamSource =
  | { kind: 'file'; file: File }
  | { kind: 'torrent'; input: TorrentInput };

export type WatchTogetherStreamState =
  | { active: false }
  | { active: true; source: WatchTogetherStreamSource };

export type StreamPlaybackPhase = 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export type StreamPlaybackState =
  | { active: false }
  | {
      active: true;
      name: string;
      phase: StreamPlaybackPhase;
      status: string;
      detail: string;
      currentTime: number;
      duration: number | null;
      paused: boolean;
      canSeek: boolean;
    };

export type StreamControlCommand =
  | { action: 'play' | 'pause' | 'stop' }
  | { action: 'seek'; currentTime: number };
