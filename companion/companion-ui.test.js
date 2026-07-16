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
      if (!approvedOrigins.includes(normalized)) approvedOrigins.push(normalized);
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
    let webAppUrl = null;
    const setWebAppUrl = vi.fn(async (value) => {
      webAppUrl = value;
      return value;
    });
    const clearWebAppUrl = vi.fn(async () => {
      webAppUrl = null;
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
      getWebAppUrl: async () => webAppUrl,
      setWebAppUrl,
      clearWebAppUrl,
      uiDir: path.join(process.cwd(), 'companion', 'ui'),
    });
    const page = await dispatch(server, '/');
    const token = page.body.match(/name="companion-token" content="([^"]+)"/)?.[1];
    expect(page.statusCode).toBe(200);
    expect(token).toBeTruthy();

    const clientConfig = await dispatch(server, '/api/client-config');
    expect(JSON.parse(clientConfig.body)).toEqual({ webAppUrl: null });

    await expect(dispatch(server, '/api/status')).rejects.toThrow('Invalid companion token');
    const status = await dispatch(server, '/api/status', { 'X-Companion-Token': token });
    expect(JSON.parse(status.body)).toEqual({
      pttKey: 'F8',
      supportedKeys: ['F8', 'F9'],
      rooms: [],
      approvedOrigins: [],
      originsManaged: false,
      webAppUrl: null,
      webAppManaged: false,
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

    const configured = await dispatch(
      server,
      '/api/settings/web-app',
      {
        'X-Companion-Token': token,
        Origin: 'http://127.0.0.1:7333',
      },
      JSON.stringify({ url: 'https://api.iroslyakov.com/rooms/cinema?codec=vp9' }),
      'PUT',
    );
    expect(JSON.parse(configured.body)).toEqual({
      webAppUrl: 'https://api.iroslyakov.com/',
      approvedOrigins: ['https://api.iroslyakov.com'],
    });
    expect(setWebAppUrl).toHaveBeenCalledWith('https://api.iroslyakov.com/');
    expect(approveOrigin).toHaveBeenLastCalledWith('https://api.iroslyakov.com/');
    expect(JSON.parse((await dispatch(server, '/api/client-config')).body)).toEqual({
      webAppUrl: 'https://api.iroslyakov.com/',
    });

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
      webAppUrl: null,
    });
    expect(clearWebAppUrl).toHaveBeenCalledOnce();
    expect(webAppUrl).toBeNull();

    await dispatch(
      server,
      '/api/settings/web-app',
      {
        'X-Companion-Token': token,
        Origin: 'http://127.0.0.1:7333',
      },
      JSON.stringify({ url: 'http://localhost:3000/rooms/dev' }),
      'PUT',
    );
    const cleared = await dispatch(
      server,
      '/api/settings/web-app',
      {
        'X-Companion-Token': token,
        Origin: 'http://127.0.0.1:7333',
      },
      undefined,
      'DELETE',
    );
    expect(JSON.parse(cleared.body)).toEqual({
      webAppUrl: null,
      approvedOrigins: ['http://localhost:3000'],
    });
    expect(clearWebAppUrl).toHaveBeenCalledTimes(2);

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

  it('does not allow the local UI to replace a managed web app URL', async () => {
    const setWebAppUrl = vi.fn();
    const clearWebAppUrl = vi.fn();
    const server = new CompanionUiServer({
      port: 7333,
      getPttKey: () => 'F8',
      setPttKey: vi.fn(),
      supportedKeys: ['F8'],
      roomRegistry: { listRooms: () => [] },
      getWebAppUrl: async () => 'https://managed.example.com/',
      setWebAppUrl,
      clearWebAppUrl,
      webAppManaged: true,
      approveOrigin: vi.fn(),
      uiDir: path.join(process.cwd(), 'companion', 'ui'),
    });
    const page = await dispatch(server, '/');
    const token = page.body.match(/name="companion-token" content="([^"]+)"/)?.[1];
    const headers = {
      'X-Companion-Token': token,
      Origin: 'http://127.0.0.1:7333',
    };

    await expect(
      dispatch(
        server,
        '/api/settings/web-app',
        headers,
        JSON.stringify({ url: 'https://other.example.com' }),
        'PUT',
      ),
    ).rejects.toThrow('COMPANION_WEB_APP_URL');
    await expect(
      dispatch(server, '/api/settings/web-app', headers, undefined, 'DELETE'),
    ).rejects.toThrow('COMPANION_WEB_APP_URL');
    expect(setWebAppUrl).not.toHaveBeenCalled();
    expect(clearWebAppUrl).not.toHaveBeenCalled();
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
