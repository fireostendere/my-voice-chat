'use strict';

const http = require('node:http');
const WebSocket = require('ws');

const fixtureUrl = parseFixtureUrl(process.argv[2] || 'http://127.0.0.1:7340/');
const socketUrl = process.env.COMPANION_SMOKE_WS_URL || 'ws://127.0.0.1:7331';
const requestId = `installed-cold-handoff-${process.pid}`;
const destination = new URL('/rooms/native-handoff-smoke', fixtureUrl);
destination.search = '?codec=vp9&handoff=1';
destination.hash = '#handoff-secret';

run().catch((error) => {
  console.error(`[native-handoff-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function run() {
  await requestNativeHandoff();
  const result = await waitForBrowserResult(30_000);
  if (result.observedUrl !== destination.href) {
    throw new Error(`The WebView reported an unexpected target: ${result.observedUrl || 'none'}`);
  }
  console.log(`[native-handoff-smoke] accepted and loaded ${result.observedUrl}`);
}

function requestNativeHandoff() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let commandSent = false;
    const socket = new WebSocket(socketUrl, {
      origin: fixtureUrl.origin,
      handshakeTimeout: 10_000,
    });
    const timeout = setTimeout(
      () => finish(reject, new Error('Timed out waiting for the native handoff response.')),
      130_000,
    );

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else socket.terminate();
      callback(value);
    };

    socket.on('open', () => socket.send(JSON.stringify({ type: 'capabilities' })));
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (message?.type === 'hello') {
        if (commandSent) return;
        if (
          message.version !== 3 ||
          !Array.isArray(message.capabilities) ||
          !message.capabilities.includes('open-room')
        ) {
          finish(reject, new Error('The companion did not advertise native room handoff.'));
          return;
        }
        commandSent = true;
        socket.send(
          JSON.stringify({
            type: 'open-room',
            requestId,
            url: destination.href,
          }),
        );
        return;
      }

      if (message?.type !== 'open-room-result' || message.requestId !== requestId) return;
      if (message.accepted !== true) {
        finish(reject, new Error(message.message || 'The native handoff was rejected.'));
        return;
      }
      finish(resolve);
    });
    socket.on('error', (error) => finish(reject, error));
    socket.on('close', () => {
      finish(reject, new Error('The companion socket closed before accepting the handoff.'));
    });
  });
}

async function waitForBrowserResult(timeoutMs) {
  const statusUrl = new URL('/smoke-status', fixtureUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getJson(statusUrl);
    if (result?.status === 'failed') {
      throw new Error(result.message || 'The WebView smoke fixture failed.');
    }
    if (result?.status === 'passed') return result;
    await delay(200);
  }
  throw new Error('The native handoff was accepted, but the exact room target did not load.');
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 5_000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > 8192) request.destroy();
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`The smoke fixture returned HTTP ${response.statusCode}.`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('The smoke fixture returned invalid JSON.'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('The smoke fixture timed out.')));
    request.on('error', reject);
  });
}

function parseFixtureUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('The smoke fixture must be a credential-free loopback HTTP URL.');
  }
  return new URL('/', url);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
