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
 *   COMPANION_ORIGINS / PTT_ORIGINS
 *                Comma-separated list of allowed browser origins, e.g.
 *                "https://chat.example.com". Without an explicit list, Windows
 *                asks the user once before trusting each remote origin.
 *
 * Run `npm run keys` to list supported key names.
 */

const { WebSocketServer } = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const { companionDataDir, createFileOriginApprover } = require('./origin-approval');
const { PttKeyListener, normalizePttKey } = require('./ptt-key-listener');
const { TorrentService } = require('./torrent-service');

const PORT = Number(process.env.PTT_PORT) || 7331;
const PTT_KEY = normalizePttKey(process.env.PTT_KEY || 'F8');
const TORRENT_PORT = Number(process.env.TORRENT_PORT) || PORT + 1;
const ALLOWED_ORIGINS = (process.env.COMPANION_ORIGINS || process.env.PTT_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DATA_DIR = companionDataDir();
const PID_FILE = path.join(DATA_DIR, 'companion.pid');

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
let talking = false;
let shuttingDown = false;

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
  console.log(`[companion] Talk key: "${PTT_KEY}"  (change with the PTT_KEY env var)`);
  console.log('[companion] Hold it to talk. Run `npm run keys` to list supported keys.');
});
wss.on('connection', (socket, req) => {
  const origin = req.headers.origin;
  console.log(`[companion] browser connected: ${origin}`);
  torrentService.attachSocket(socket, { enableTorrent: true });
});
wss.on('error', (err) => {
  console.error('[companion] WebSocket server error:', err.message);
  if (err.code === 'EADDRINUSE') shutdown(1);
});

const keyboard = new PttKeyListener({
  key: PTT_KEY,
  onState: (next) => {
    if (next !== talking) broadcast(next ? 'down' : 'up');
    talking = next;
  },
  onError: (error) => console.error('[companion] PTT helper:', error.message),
});
keyboard.start();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', releaseProcess);

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[companion] shutting down');
  await torrentService.close();
  keyboard.stop();
  for (const client of wss.clients) client.close(1001, 'Companion stopping');
  wss.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 1000).unref();
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
