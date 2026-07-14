import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  CompanionUiServer,
  validateUiPlaybackCommand,
  validateUiTorrentInput,
} from './companion-ui.js';

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

describe('companion UI playback controls', () => {
  it('accepts supported controls and rejects invalid seek positions', () => {
    expect(validateUiPlaybackCommand({ roomId: 'room-1', action: 'pause' })).toEqual({
      action: 'pause',
    });
    expect(
      validateUiPlaybackCommand({ roomId: 'room-1', action: 'seek', currentTime: 18.5 }),
    ).toEqual({ action: 'seek', currentTime: 18.5 });
    expect(() =>
      validateUiPlaybackCommand({ roomId: 'room-1', action: 'seek', currentTime: -1 }),
    ).toThrow('Invalid playback command');
  });
});

describe('companion UI server', () => {
  it('serves the local UI and protects its API with a token and origin check', async () => {
    const setPttKey = vi.fn((key) => key);
    const approvedOrigins = [];
    const approveOrigin = vi.fn(async (origin) => {
      const normalized = new URL(origin).origin;
      approvedOrigins.push(normalized);
      return normalized;
    });
    const revokeOrigin = vi.fn(async (origin) => {
      const normalized = new URL(origin).origin;
      approvedOrigins.splice(approvedOrigins.indexOf(normalized), 1);
      return normalized;
    });
    const controlPlayback = vi.fn().mockResolvedValue({
      accepted: true,
      message: 'Playback control applied.',
    });
    const server = new CompanionUiServer({
      port: 7333,
      getPttKey: () => 'F8',
      setPttKey,
      supportedKeys: ['F8', 'F9'],
      roomRegistry: { listRooms: () => [], openTorrent: vi.fn(), controlPlayback },
      listApprovedOrigins: async () => approvedOrigins,
      approveOrigin,
      revokeOrigin,
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
      approvedOrigins: [],
      originsManaged: false,
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

    const approved = await dispatch(
      server,
      '/api/settings/origin',
      {
        'X-Companion-Token': token,
        Origin: 'http://127.0.0.1:7333',
      },
      JSON.stringify({ origin: 'https://api.iroslyakov.com/room/cinema' }),
    );
    expect(JSON.parse(approved.body)).toEqual({
      origin: 'https://api.iroslyakov.com',
      approvedOrigins: ['https://api.iroslyakov.com'],
    });
    expect(approveOrigin).toHaveBeenCalledWith('https://api.iroslyakov.com/room/cinema');

    const revoked = await dispatch(
      server,
      '/api/settings/origin',
      {
        'X-Companion-Token': token,
        Origin: 'http://127.0.0.1:7333',
      },
      JSON.stringify({ origin: 'https://api.iroslyakov.com' }),
      'DELETE',
    );
    expect(JSON.parse(revoked.body)).toEqual({
      origin: 'https://api.iroslyakov.com',
      approvedOrigins: [],
    });

    const playback = await dispatch(
      server,
      '/api/playback',
      {
        'X-Companion-Token': token,
        Origin: 'http://127.0.0.1:7333',
      },
      JSON.stringify({ roomId: 'room-1', action: 'seek', currentTime: 24 }),
    );
    expect(playback.statusCode).toBe(200);
    expect(controlPlayback).toHaveBeenCalledWith('room-1', {
      action: 'seek',
      currentTime: 24,
    });
  });
});

async function dispatch(server, pathname, headers = {}, body, method) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  request.method = method || (body === undefined ? 'GET' : 'POST');
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
