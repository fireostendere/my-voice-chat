'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isLoopbackOrigin } = require('./origin-core');

const MAX_URL_LENGTH = 2048;

function normalizeWebAppUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.origin === 'null') return undefined;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackOrigin(url.origin))) {
      return undefined;
    }
    return `${url.origin}/`;
  } catch {
    return undefined;
  }
}

function createClientConfig({ configuredUrl, load, save }) {
  const configured = configuredUrl?.trim();
  const managed = Boolean(configured);
  const managedUrl = managed ? normalizeWebAppUrl(configured) : undefined;
  if (managed && !managedUrl) {
    throw new Error(
      'COMPANION_WEB_APP_URL must be an HTTPS URL (HTTP is allowed only for loopback).',
    );
  }

  let storedPromise;
  const loadStored = () => {
    if (!storedPromise) {
      storedPromise = Promise.resolve(load())
        .then((value) => normalizeWebAppUrl(value) || null)
        .catch(() => null);
    }
    return storedPromise;
  };

  const getWebAppUrl = async () => managedUrl || (await loadStored());

  const setWebAppUrl = async (value) => {
    if (managed) throw new Error('The web app URL is managed by COMPANION_WEB_APP_URL.');
    const webAppUrl = normalizeWebAppUrl(value);
    if (!webAppUrl) {
      throw new Error('Enter a valid HTTPS voice-chat address.');
    }
    await save(webAppUrl);
    storedPromise = Promise.resolve(webAppUrl);
    return webAppUrl;
  };

  const clearWebAppUrl = async () => {
    if (managed) throw new Error('The web app URL is managed by COMPANION_WEB_APP_URL.');
    await save(null);
    storedPromise = Promise.resolve(null);
  };

  return { clearWebAppUrl, getWebAppUrl, managed, setWebAppUrl };
}

function createFileClientConfig({ configuredUrl, dataDir }) {
  const configFile = path.join(dataDir, 'client-config.json');
  return createClientConfig({
    configuredUrl,
    load: async () => {
      const parsed = JSON.parse(await fs.readFile(configFile, 'utf8'));
      return parsed?.webAppUrl;
    },
    save: async (webAppUrl) => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(configFile, `${JSON.stringify({ webAppUrl }, null, 2)}\n`, 'utf8');
    },
  });
}

module.exports = { createClientConfig, createFileClientConfig, normalizeWebAppUrl };
