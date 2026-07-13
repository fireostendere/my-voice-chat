import { describe, expect, it } from 'vitest';
import { parseCompanionTorrentCommand } from './companionRoomProtocol';

describe('parseCompanionTorrentCommand', () => {
  it('accepts a standard magnet command', () => {
    expect(
      parseCompanionTorrentCommand({
        type: 'torrent-open',
        commandId: 'command-1',
        input: {
          kind: 'magnet',
          magnet: 'magnet:?xt=urn:btih:0123456789abcdef',
          name: 'Movie',
        },
      }),
    ).toEqual({
      commandId: 'command-1',
      input: {
        kind: 'magnet',
        magnet: 'magnet:?xt=urn:btih:0123456789abcdef',
        name: 'Movie',
      },
    });
  });

  it('decodes a torrent file command', () => {
    const result = parseCompanionTorrentCommand({
      type: 'torrent-open',
      commandId: 'command-2',
      input: { kind: 'torrent-file', base64: btoa('torrent'), name: 'movie.torrent' },
    });

    expect(result?.commandId).toBe('command-2');
    expect(Array.from(result?.input.kind === 'torrent-file' ? result.input.bytes : [])).toEqual(
      Array.from(new TextEncoder().encode('torrent')),
    );
  });

  it('rejects malformed commands', () => {
    expect(
      parseCompanionTorrentCommand({ type: 'torrent-open', commandId: '', input: {} }),
    ).toBeNull();
    expect(
      parseCompanionTorrentCommand({
        type: 'torrent-open',
        commandId: 'command-3',
        input: { kind: 'magnet', magnet: 'https://example.com', name: 'Movie' },
      }),
    ).toBeNull();
  });
});
