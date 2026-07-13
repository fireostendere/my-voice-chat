import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CompanionUiServer, validateUiTorrentInput } from './companion-ui.js';

describe('companion UI torrent input', () => {
  it('accepts ordinary magnet links', () => {
    expect(
      validateUiTorrentInput({
        kind: 'magnet',
        magnet: 'magnet:?xt=urn:btih:0123456789abcdef',
        name: 'Movie',
      }),
    ).toEqual({
      kind: 'magnet',
      magnet: 'magnet:?xt=urn:btih:0123456789abcdef',
      name: 'Movie',
    });
  });

  it('accepts a small base64 torrent file', () => {
    expect(
      validateUiTorrentInput({
        kind: 'torrent-file',
        base64: Buffer.from('torrent').toString('base64'),
        name: 'movie.torrent',
      }),
    ).toEqual({
      kind: 'torrent-file',
      base64: Buffer.from('torrent').toString('base64'),
      name: 'movie.torrent',
    });
  });

  it('rejects malformed or oversized input metadata', () => {
    expect(() => validateUiTorrentInput({ kind: 'magnet', magnet: 'nope', name: 'x' })).toThrow(
      'Invalid magnet link',
    );
    expect(() =>
      validateUiTorrentInput({
        kind: 'torrent-file',
        base64: Buffer.from('torrent').toString('base64'),
        name: 'x'.repeat(300),
      }),
    ).toThrow('Invalid torrent name');
  });
});

describe('companion UI server', () => {
  it('serves the local UI and protects its API with a token and origin check', async () => {
    const setPttKey = vi.fn((key) => key);
    const server = new CompanionUiServer({
      port: 7333,
      getPttKey: () => 'F8',
      setPttKey,
      supportedKeys: ['F8', 'F9'],
      roomRegistry: { listRooms: () => [], openTorrent: vi.fn() },
      uiDir: path.join(process.cwd(), 'companion', 'ui'),
    });
    const page = await dispatch(server, '/');
    const token = page.body.match(/name="companion-token" content="([^"]+)"/)?.[1];
    expect(page.statusCode).toBe(200);
    expect(token).toBeTruthy();

    await expect(dispatch(server, '/api/status')).rejects.toThrow('Invalid companion token');
    const status = await dispatch(server, '/api/status', { 'X-Companion-Token': token });
    expect(JSON.parse(status.body)).toEqual({
      pttKey: 'F8',
      supportedKeys: ['F8', 'F9'],
      rooms: [],
    });

    await expect(
      dispatch(
        server,
        '/api/settings/ptt-key',
        { 'X-Companion-Token': token, Origin: 'https://example.com' },
        JSON.stringify({ key: 'F9' }),
      ),
    ).rejects.toThrow('Invalid origin');
    expect(setPttKey).not.toHaveBeenCalled();
  });
});

async function dispatch(server, pathname, headers = {}, body) {
  const request = Readable.from(body === undefined ? [] : [body]);
  request.method = body === undefined ? 'GET' : 'POST';
  request.url = pathname;
  request.headers = Object.fromEntries([
    ['host', `127.0.0.1:${server.port}`],
    ...Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  ]);
  const response = {
    statusCode: 0,
    body: '',
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(content = '') {
      this.body += String(content);
    },
  };
  await server.handle(request, response);
  return response;
}
