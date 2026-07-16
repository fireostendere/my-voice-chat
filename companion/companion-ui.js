'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { normalizeWebAppUrl } = require('./client-config');
const { parseTorrentInput } = require('./torrent-core');

const MAX_BODY_BYTES = 3 * 1024 * 1024;

class CompanionUiServer {
  constructor({
    port,
    getPttKey,
    setPttKey,
    supportedKeys,
    roomRegistry,
    listApprovedOrigins = async () => [],
    approveOrigin,
    revokeOrigin,
    originsManaged = false,
    getWebAppUrl = async () => null,
    setWebAppUrl,
    clearWebAppUrl,
    webAppManaged = false,
    uiDir,
  }) {
    this.port = port;
    this.getPttKey = getPttKey;
    this.setPttKey = setPttKey;
    this.supportedKeys = supportedKeys;
    this.roomRegistry = roomRegistry;
    this.listApprovedOrigins = listApprovedOrigins;
    this.approveOrigin = approveOrigin;
    this.revokeOrigin = revokeOrigin;
    this.originsManaged = originsManaged;
    this.getWebAppUrl = getWebAppUrl;
    this.setWebAppUrl = setWebAppUrl;
    this.clearWebAppUrl = clearWebAppUrl;
    this.webAppManaged = webAppManaged;
    this.uiDir = uiDir;
    this.token = crypto.randomBytes(24).toString('base64url');
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        if (!response.headersSent) {
          this.sendJson(response, error.statusCode || 500, { error: error.message });
        } else {
          response.end();
        }
      });
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        this.server.off('error', reject);
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  close() {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  async handle(request, response) {
    if (!this.isLocalHost(request.headers.host)) throw httpError(403, 'Invalid host.');
    const url = new URL(request.url || '/', `http://127.0.0.1:${this.port}`);

    if (request.method === 'GET' && url.pathname === '/') {
      const html = await fs.readFile(path.join(this.uiDir, 'index.html'), 'utf8');
      this.send(response, 200, html.replace('__COMPANION_TOKEN__', this.token), 'text/html');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      this.send(
        response,
        200,
        await fs.readFile(path.join(this.uiDir, 'app.js')),
        'text/javascript',
      );
      return;
    }
    if (request.method === 'GET' && url.pathname === '/styles.css') {
      this.send(response, 200, await fs.readFile(path.join(this.uiDir, 'styles.css')), 'text/css');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/livekit.ico') {
      const icon = await fs
        .readFile(path.join(this.uiDir, 'livekit.ico'))
        .catch(() => fs.readFile(path.join(__dirname, 'assets', 'livekit-companion.ico')));
      this.send(response, 200, icon, 'image/x-icon');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/livekit.png') {
      const image = await fs
        .readFile(path.join(this.uiDir, 'livekit.png'))
        .catch(() =>
          fs.readFile(path.join(__dirname, '..', 'public', 'images', 'livekit-apple-touch.png')),
        );
      this.send(response, 200, image, 'image/png');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/client-config') {
      this.sendJson(response, 200, { webAppUrl: await this.getWebAppUrl() });
      return;
    }

    this.requireApiToken(request);
    if (request.method === 'GET' && url.pathname === '/api/status') {
      this.sendJson(response, 200, {
        pttKey: this.getPttKey(),
        supportedKeys: this.supportedKeys,
        rooms: this.roomRegistry.listRooms(),
        approvedOrigins: await this.listApprovedOrigins(),
        originsManaged: this.originsManaged,
        webAppUrl: await this.getWebAppUrl(),
        webAppManaged: this.webAppManaged,
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/settings/ptt-key') {
      this.requireSameOrigin(request);
      const body = await readJson(request, 4096);
      const key = await this.setPttKey(body.key);
      this.sendJson(response, 200, { pttKey: key });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/settings/origin') {
      this.requireSameOrigin(request);
      if (!this.approveOrigin) throw httpError(501, 'Manual server configuration is unavailable.');
      const body = await readJson(request, 4096);
      const origin = await this.approveOrigin(body.origin);
      this.sendJson(response, 200, {
        origin,
        approvedOrigins: await this.listApprovedOrigins(),
      });
      return;
    }
    if (request.method === 'PUT' && url.pathname === '/api/settings/web-app') {
      this.requireSameOrigin(request);
      if (!this.setWebAppUrl || !this.approveOrigin) {
        throw httpError(501, 'Web app configuration is unavailable.');
      }
      if (this.webAppManaged) {
        throw httpError(409, 'The web app URL is managed by COMPANION_WEB_APP_URL.');
      }
      const body = await readJson(request, 4096);
      const webAppUrl = normalizeWebAppUrl(body.url);
      if (!webAppUrl) throw httpError(400, 'Enter a valid HTTPS voice-chat address.');
      await this.approveOrigin(webAppUrl);
      await this.setWebAppUrl(webAppUrl);
      this.sendJson(response, 200, {
        webAppUrl,
        approvedOrigins: await this.listApprovedOrigins(),
      });
      return;
    }
    if (request.method === 'DELETE' && url.pathname === '/api/settings/web-app') {
      this.requireSameOrigin(request);
      if (!this.clearWebAppUrl) throw httpError(501, 'Web app configuration is unavailable.');
      if (this.webAppManaged) {
        throw httpError(409, 'The web app URL is managed by COMPANION_WEB_APP_URL.');
      }
      await this.clearWebAppUrl();
      this.sendJson(response, 200, {
        webAppUrl: null,
        approvedOrigins: await this.listApprovedOrigins(),
      });
      return;
    }
    if (request.method === 'DELETE' && url.pathname === '/api/settings/origin') {
      this.requireSameOrigin(request);
      if (!this.revokeOrigin) throw httpError(501, 'Manual server configuration is unavailable.');
      const body = await readJson(request, 4096);
      const origin = await this.revokeOrigin(body.origin);
      let webAppUrl = await this.getWebAppUrl();
      if (
        !this.webAppManaged &&
        this.clearWebAppUrl &&
        webAppUrl &&
        new URL(webAppUrl).origin === origin
      ) {
        await this.clearWebAppUrl();
        webAppUrl = null;
      }
      this.sendJson(response, 200, {
        origin,
        approvedOrigins: await this.listApprovedOrigins(),
        webAppUrl,
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/torrent') {
      this.requireSameOrigin(request);
      const body = await readJson(request, MAX_BODY_BYTES);
      const input = validateUiTorrentInput(body.input);
      const result = await this.roomRegistry.openTorrent(body.roomId, input);
      this.sendJson(response, result.accepted ? 200 : 409, result);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/playback') {
      this.requireSameOrigin(request);
      const body = await readJson(request, 4096);
      const control = validateUiPlaybackCommand(body);
      const result = await this.roomRegistry.controlPlayback(body.roomId, control);
      this.sendJson(response, result.accepted ? 200 : 409, result);
      return;
    }

    throw httpError(404, 'Not found.');
  }

  requireApiToken(request) {
    if (request.headers['x-companion-token'] !== this.token) {
      throw httpError(403, 'Invalid companion token.');
    }
  }

  requireSameOrigin(request) {
    if (request.headers.origin !== `http://127.0.0.1:${this.port}`) {
      throw httpError(403, 'Invalid origin.');
    }
  }

  isLocalHost(host) {
    return host === `127.0.0.1:${this.port}`;
  }

  sendJson(response, statusCode, value) {
    this.send(response, statusCode, JSON.stringify(value), 'application/json');
  }

  send(response, statusCode, body, contentType) {
    const responseType = /^(?:text\/|application\/(?:json|javascript))/.test(contentType)
      ? `${contentType}; charset=utf-8`
      : contentType;
    response.writeHead(statusCode, {
      'Content-Type': responseType,
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(body);
  }
}

function validateUiTorrentInput(value) {
  if (!value || typeof value !== 'object') throw httpError(400, 'Choose a torrent first.');
  const name = validFileName(value.name);
  if (value.kind === 'magnet') {
    const magnet = parseTorrentInput({ kind: 'magnet', magnet: value.magnet });
    return { kind: 'magnet', magnet, name };
  }
  if (value.kind === 'torrent-file') {
    parseTorrentInput({ kind: 'torrent-file', base64: value.base64 });
    return { kind: 'torrent-file', base64: value.base64, name };
  }
  throw httpError(400, 'Unsupported torrent source.');
}

function validFileName(value) {
  if (typeof value !== 'string') throw httpError(400, 'Invalid torrent name.');
  const name = value.trim();
  if (!name || name.length > 260) throw httpError(400, 'Invalid torrent name.');
  return name;
}

function validateUiPlaybackCommand(value) {
  if (!value || typeof value !== 'object') throw httpError(400, 'Invalid playback command.');
  if (typeof value.roomId !== 'string' || value.roomId.length < 1 || value.roomId.length > 128) {
    throw httpError(400, 'Choose an active room first.');
  }
  if (value.action === 'play' || value.action === 'pause' || value.action === 'stop') {
    return { action: value.action };
  }
  if (
    value.action === 'seek' &&
    typeof value.currentTime === 'number' &&
    Number.isFinite(value.currentTime) &&
    value.currentTime >= 0
  ) {
    return { action: 'seek', currentTime: value.currentTime };
  }
  throw httpError(400, 'Invalid playback command.');
}

function readJson(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let failed = false;
    request.on('data', (chunk) => {
      if (failed) return;
      length += chunk.length;
      if (length > limit) {
        failed = true;
        reject(httpError(413, 'Request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Invalid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = { CompanionUiServer, validateUiPlaybackCommand, validateUiTorrentInput };
