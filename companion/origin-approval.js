'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { isLoopbackOrigin } = require('./origin-core');

function createOriginApprover({ configuredOrigins = [], load, save, prompt }) {
  const configured = new Set(configuredOrigins.map(normalizeOrigin).filter(Boolean));
  const pending = new Map();
  let storedPromise;

  const loadStored = async () => {
    if (!storedPromise) {
      storedPromise = Promise.resolve(load())
        .then((origins) => new Set(origins.map(normalizeOrigin).filter(Boolean)))
        .catch(() => new Set());
    }
    return storedPromise;
  };

  const isAllowed = async (value) => {
    const origin = normalizeOrigin(value);
    if (!origin) return false;

    // An explicit environment allowlist remains authoritative for managed installs.
    if (configured.size > 0) return configured.has(origin);
    if (isLoopbackOrigin(origin)) return true;

    const stored = await loadStored();
    if (stored.has(origin)) return true;
    if (pending.has(origin)) return pending.get(origin);

    const approval = Promise.resolve(prompt(origin))
      .then(async (allowed) => {
        if (!allowed) return false;
        stored.add(origin);
        try {
          await save([...stored].sort());
        } catch (error) {
          console.warn('[companion] could not save approved origins:', error.message);
        }
        return true;
      })
      .catch(() => false)
      .finally(() => pending.delete(origin));

    pending.set(origin, approval);
    return approval;
  };

  const listAllowed = async () =>
    [...(configured.size > 0 ? configured : await loadStored())].sort();

  const allow = async (value) => {
    const origin = normalizeOrigin(value);
    if (!origin) throw new Error('Enter a valid HTTP or HTTPS voice-chat address.');
    if (configured.size > 0) {
      if (configured.has(origin)) return origin;
      throw new Error('Trusted sites are managed by COMPANION_ORIGINS.');
    }
    if (isLoopbackOrigin(origin)) return origin;

    const stored = await loadStored();
    if (!stored.has(origin)) {
      stored.add(origin);
      await save([...stored].sort());
    }
    return origin;
  };

  const revoke = async (value) => {
    const origin = normalizeOrigin(value);
    if (!origin) throw new Error('Invalid voice-chat address.');
    if (configured.size > 0) {
      throw new Error('Trusted sites are managed by COMPANION_ORIGINS.');
    }

    const stored = await loadStored();
    if (stored.delete(origin)) await save([...stored].sort());
    return origin;
  };

  return { allow, isAllowed, listAllowed, managed: configured.size > 0, revoke };
}

function createFileOriginApprover({ configuredOrigins = [], dataDir = companionDataDir() } = {}) {
  const configFile = path.join(dataDir, 'allowed-origins.json');

  return createOriginApprover({
    configuredOrigins,
    load: async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(configFile, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn('[companion] could not read approved origins:', error.message);
        }
        return [];
      }
    },
    save: async (origins) => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(configFile, `${JSON.stringify(origins, null, 2)}\n`, 'utf8');
    },
    prompt: promptForOrigin,
  });
}

function promptForOrigin(origin) {
  if (process.platform !== 'win32') return Promise.resolve(false);

  const helperPath = path.join(__dirname, 'bin', 'LiveKitCompanionNative.exe');

  return new Promise((resolve) => {
    execFile(helperPath, ['--approve-origin', origin], { windowsHide: true }, (error) =>
      resolve(!error),
    );
  });
}

function companionDataDir() {
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'LiveKitCompanion')
    : path.join(os.homedir(), '.livekit-companion');
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password || url.origin === 'null') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

module.exports = {
  companionDataDir,
  createFileOriginApprover,
  createOriginApprover,
  normalizeOrigin,
};
