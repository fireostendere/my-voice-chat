'use strict';

/**
 * LiveKit local companion.
 *
 * Polls only the configured global key through a small Windows helper (so it
 * works while a game has focus) and relays `down`/`up` to the browser over a
 * localhost-only WebSocket. It does not install a system-wide keyboard hook.
 *
 * Config (environment variables):
 *   PTT_PORT     WebSocket port (default 7331)
 *   PTT_KEY      Key name to use as the talk button (default "F8")
 *   COMPANION_WEB_APP_URL
 *                Managed HTTPS URL opened by the desktop client.
 *   COMPANION_ORIGINS / PTT_ORIGINS
 *                Comma-separated list of allowed browser origins, e.g.
 *                "https://chat.example.com". Without an explicit list, Windows
 *                asks the user once before trusting each remote origin.
 *
 * Run `npm run keys` to list supported key names.
 */

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

installFileLogger(process.env.COMPANION_LOG_FILE);

const { WebSocketServer } = require('ws');
const { createFileClientConfig, normalizeWebAppUrl } = require('./client-config');
const { CompanionUiServer } = require('./companion-ui');
const { NativeNavigationService } = require('./native-navigation-service');
const { companionDataDir, createFileOriginApprover } = require('./origin-approval');
const { PttKeyListener, SUPPORTED_KEYS, normalizePttKey } = require('./ptt-key-listener');
const { RoomRegistry } = require('./room-registry');
const { TorrentService } = require('./torrent-service');

const DATA_DIR = companionDataDir();
const PID_FILE = path.join(DATA_DIR, 'companion.pid');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.env');
const STOP_FILE = path.join(DATA_DIR, 'stop-requested');
const PORT = Number(process.env.PTT_PORT) || 7331;
let pttKey = loadPttKey();
const TORRENT_PORT = Number(process.env.TORRENT_PORT) || PORT + 1;
const UI_PORT = Number(process.env.COMPANION_UI_PORT) || PORT + 2;
const MANAGED_WEB_APP_URL = normalizeWebAppUrl(process.env.COMPANION_WEB_APP_URL);
const ALLOWED_ORIGINS = (process.env.COMPANION_ORIGINS || process.env.PTT_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (MANAGED_WEB_APP_URL) ALLOWED_ORIGINS.push(new URL(MANAGED_WEB_APP_URL).origin);
const UI_URL = `http://127.0.0.1:${UI_PORT}/`;
const PACKAGED_ICON_PATH = path.join(__dirname, 'ui', 'livekit.ico');
const ICON_PATH = fs.existsSync(PACKAGED_ICON_PATH)
  ? PACKAGED_ICON_PATH
  : path.join(__dirname, 'assets', 'livekit-companion.ico');

const clientConfig = createFileClientConfig({
  configuredUrl: process.env.COMPANION_WEB_APP_URL,
  dataDir: DATA_DIR,
});
const navigationService = new NativeNavigationService({
  uiPort: UI_PORT,
  launcherPath: process.env.COMPANION_LAUNCHER_PATH,
  getWebAppUrl: () => clientConfig.getWebAppUrl(),
});
claimProcess();
const originApprover = createFileOriginApprover({ configuredOrigins: ALLOWED_ORIGINS });

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: PORT,
  // A 2 MB .torrent expands to roughly 2.8 MB as base64 JSON.
  maxPayload: 4 * 1024 * 1024,
  verifyClient: (info, done) => {
    originApprover.isAllowed(info.origin).then((allowed) => {
      if (allowed) {
        done(true);
      } else {
        console.warn(`[companion] rejected connection from origin: ${info.origin || 'unknown'}`);
        done(false, 403, 'Origin not approved');
      }
    });
  },
});
const torrentService = new TorrentService({ port: TORRENT_PORT });
const roomRegistry = new RoomRegistry();
let talking = false;
let shuttingDown = false;
const stopRequestTimer = setInterval(() => {
  if (!fs.existsSync(STOP_FILE)) return;
  try {
    fs.unlinkSync(STOP_FILE);
  } catch {}
  void shutdown(0);
}, 250);
stopRequestTimer.unref();

function broadcast(state) {
  const payload = JSON.stringify({ type: 'ptt', state });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(payload);
    }
  }
}

wss.on('listening', () => {
  console.log(`[companion] WebSocket listening on ws://127.0.0.1:${PORT}`);
  console.log(`[companion] Torrent stream will use http://127.0.0.1:${TORRENT_PORT}`);
  console.log(`[companion] UI available at ${UI_URL}`);
  console.log(`[companion] Talk key: "${pttKey}"`);
  console.log('[companion] Hold it to talk. Run `npm run keys` to list supported keys.');
});
wss.on('connection', (socket, req) => {
  const origin = req.headers.origin;
  console.log(`[companion] browser connected: ${origin}`);
  const extraCapabilities = navigationService.attachSocket(socket, { origin });
  torrentService.attachSocket(socket, { enableTorrent: true, extraCapabilities });
  roomRegistry.attachSocket(socket);
});
wss.on('error', (err) => {
  console.error('[companion] WebSocket server error:', err.message);
  if (err.code === 'EADDRINUSE') shutdown(1);
});

const keyboard = new PttKeyListener({
  key: pttKey,
  uiUrl: UI_URL,
  iconPath: ICON_PATH,
  onState: (next) => {
    if (next !== talking) broadcast(next ? 'down' : 'up');
    talking = next;
  },
  onExit: () => shutdown(0),
  onError: (error) => console.error('[companion] PTT helper:', error.message),
});
keyboard.start();

const uiServer = new CompanionUiServer({
  port: UI_PORT,
  getPttKey: () => pttKey,
  setPttKey: (value) => {
    if (talking) {
      talking = false;
      broadcast('up');
    }
    pttKey = keyboard.setKey(value);
    fs.writeFileSync(SETTINGS_FILE, `PTT_KEY=${pttKey}\r\n`, 'ascii');
    return pttKey;
  },
  supportedKeys: SUPPORTED_KEYS,
  roomRegistry,
  listApprovedOrigins: () => originApprover.listAllowed(),
  approveOrigin: (value) => originApprover.allow(value),
  revokeOrigin: (value) => originApprover.revoke(value),
  originsManaged: originApprover.managed,
  getWebAppUrl: () => clientConfig.getWebAppUrl(),
  setWebAppUrl: (value) => clientConfig.setWebAppUrl(value),
  clearWebAppUrl: () => clientConfig.clearWebAppUrl(),
  webAppManaged: clientConfig.managed,
  uiDir: path.join(__dirname, 'ui'),
});
uiServer.start().catch((error) => {
  console.error('[companion] UI server error:', error.message);
  shutdown(1);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', releaseProcess);

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(stopRequestTimer);
  const forceExitTimer = setTimeout(() => process.exit(exitCode), 1500);
  forceExitTimer.unref();
  console.log('\n[companion] shutting down');
  roomRegistry.close();
  await uiServer.close();
  await torrentService.close();
  keyboard.stop();
  for (const client of wss.clients) client.close(1001, 'Companion stopping');
  wss.close(() => {
    clearTimeout(forceExitTimer);
    process.exit(exitCode);
  });
}

function claimProcess() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const existingPid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    if (existingPid && existingPid !== process.pid) {
      process.kill(existingPid, 0);
      console.error(`[companion] already running with PID ${existingPid}`);
      process.exit(0);
    }
  } catch {}
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function releaseProcess() {
  try {
    if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.unlinkSync(PID_FILE);
  } catch {}
}

function loadPttKey() {
  const environmentKey = process.env.PTT_KEY;
  if (environmentKey) return normalizePttKey(environmentKey);
  try {
    const settings = fs.readFileSync(SETTINGS_FILE, 'ascii');
    const storedKey = settings
      .split(/\r?\n/)
      .map((line) => line.split('=', 2))
      .find(([name]) => name?.trim().toUpperCase() === 'PTT_KEY')?.[1];
    if (storedKey) return normalizePttKey(storedKey);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[companion] could not load saved PTT key:', error.message);
    }
  }
  return 'F8';
}

function installFileLogger(logFile) {
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Starting LiveKit Companion\n`);
  } catch {
    return;
  }

  const append = (level, values) => {
    try {
      fs.appendFileSync(
        logFile,
        `[${new Date().toISOString()}] ${level} ${util.format(...values)}\n`,
      );
    } catch {}
  };
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      original(...values);
      append(level.toUpperCase(), values);
    };
  }
  process.on('uncaughtExceptionMonitor', (error) => append('FATAL', [error.stack || error]));
}
