import type { StreamControlCommand, TorrentInput } from './types';

const MAX_TORRENT_BYTES = 2 * 1024 * 1024;
const MAX_MAGNET_LENGTH = 32 * 1024;

export type CompanionTorrentCommand = {
  commandId: string;
  input: TorrentInput;
};

export type CompanionPlaybackCommand = {
  commandId: string;
  control: StreamControlCommand;
};

export function parseCompanionTorrentCommand(value: unknown): CompanionTorrentCommand | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type !== 'torrent-open' || !isShortString(message.commandId, 128)) return null;
  if (!message.input || typeof message.input !== 'object') return null;

  const input = message.input as Record<string, unknown>;
  const name = normalizeName(input.name);
  if (!name) return null;

  if (
    input.kind === 'magnet' &&
    typeof input.magnet === 'string' &&
    input.magnet.length <= MAX_MAGNET_LENGTH &&
    /^magnet:\?[^\s]*xt=urn:bt(?:ih|mh):/i.test(input.magnet.trim())
  ) {
    return {
      commandId: message.commandId,
      input: { kind: 'magnet', magnet: input.magnet.trim(), name },
    };
  }

  if (input.kind !== 'torrent-file' || typeof input.base64 !== 'string') return null;
  const bytes = decodeTorrentFile(input.base64);
  if (!bytes) return null;
  return { commandId: message.commandId, input: { kind: 'torrent-file', bytes, name } };
}

export function parseCompanionPlaybackCommand(value: unknown): CompanionPlaybackCommand | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type !== 'playback-control' || !isShortString(message.commandId, 128)) return null;

  if (message.action === 'play' || message.action === 'pause' || message.action === 'stop') {
    return { commandId: message.commandId, control: { action: message.action } };
  }
  if (
    message.action === 'seek' &&
    typeof message.currentTime === 'number' &&
    Number.isFinite(message.currentTime) &&
    message.currentTime >= 0
  ) {
    return {
      commandId: message.commandId,
      control: { action: 'seek', currentTime: message.currentTime },
    };
  }
  return null;
}

function decodeTorrentFile(base64: string): Uint8Array | null {
  if (!base64 || base64.length > Math.ceil(MAX_TORRENT_BYTES / 3) * 4 + 4) return null;
  try {
    const binary = atob(base64);
    if (binary.length === 0 || binary.length > MAX_TORRENT_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 260 ? name : null;
}

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}
