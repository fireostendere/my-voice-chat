'use strict';

const http = require('node:http');

const DEFAULT_PORT = 7340;
const port = parsePort(process.argv[2] || process.env.COMPANION_SMOKE_PORT || DEFAULT_PORT);
const TARGET_PATH = '/rooms/native-handoff-smoke';
const TARGET_SEARCH = '?codec=vp9&handoff=1';
const TARGET_HASH = '#handoff-secret';
const TARGET_URL = `http://127.0.0.1:${port}${TARGET_PATH}${TARGET_SEARCH}${TARGET_HASH}`;
const smokeState = {
  status: 'pending',
  message: 'Waiting for the external native handoff smoke client.',
  expectedUrl: TARGET_URL,
  observedUrl: null,
};
let targetRequestSeen = false;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LiveKit Companion WebView Smoke Running</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { margin: 2rem; background: #11100f; color: #f5f2ed; }
      pre { padding: 1rem; border-radius: .5rem; background: #211f1d; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>LiveKit Companion WebView smoke test</h1>
    <pre id="status">Running browser capability checks…</pre>
    <script>
      'use strict';

      const status = document.querySelector('#status');

      run().catch((error) => void failSmoke(error));

      async function failSmoke(error) {
        const message = error instanceof Error ? error.message : String(error);
        document.title = 'LiveKit Companion WebView Smoke FAILED';
        document.documentElement.dataset.smokeStatus = 'failed';
        status.textContent = message;
        try {
          await reportSmokeResult({ status: 'failed', message });
        } catch (reportError) {
          status.textContent += '\\nCould not report the failure: ' + String(reportError);
        }
      }

      async function run() {
        assert(window.isSecureContext, 'The fixture is not a secure context.');
        assert(window.crossOriginIsolated, 'COOP/COEP did not enable cross-origin isolation.');
        assert(
          window.__LIVEKIT_COMPANION__?.host === 'webview2' &&
            window.__LIVEKIT_COMPANION__?.platform === 'windows' &&
            window.__LIVEKIT_COMPANION__?.version === 1,
          'The native Companion marker is missing.',
        );
        assert(navigator.mediaDevices?.getUserMedia, 'getUserMedia is unavailable.');
        assert(typeof window.RTCPeerConnection === 'function', 'RTCPeerConnection is unavailable.');
        assert(
          typeof HTMLMediaElement.prototype.captureStream === 'function',
          'HTMLMediaElement.captureStream is unavailable.',
        );

        const stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({ audio: true, video: true }),
          10_000,
          'Timed out acquiring the fake camera and microphone.',
        );
        try {
          assert(stream.getAudioTracks().length > 0, 'The fake microphone track is missing.');
          assert(stream.getVideoTracks().length > 0, 'The fake camera track is missing.');
          assert(
            stream.getTracks().every((track) => track.readyState === 'live'),
            'A fake media track is not live.',
          );
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }

        const peer = new RTCPeerConnection();
        try {
          peer.createDataChannel('smoke');
          const offer = await withTimeout(
            peer.createOffer(),
            10_000,
            'Timed out creating a WebRTC offer.',
          );
          await peer.setLocalDescription(offer);
          assert(peer.localDescription?.type === 'offer', 'The WebRTC offer was not installed.');
        } finally {
          peer.close();
        }

        const hello = await companionHello();
        assert(hello.version === 3, 'The companion protocol version is not 3.');
        assert(hello.capabilities.includes('ptt'), 'The companion did not advertise PTT.');
        assert(hello.capabilities.includes('torrent'), 'The companion did not advertise torrent.');
        assert(
          hello.capabilities.includes('open-room'),
          'The companion did not advertise native room handoff.',
        );

        window.__companionSmoke = {
          capabilities: hello.capabilities,
          crossOriginIsolated: window.crossOriginIsolated,
          nativeHost: window.__LIVEKIT_COMPANION__,
          secureContext: window.isSecureContext,
        };

        if (window.location.pathname !== ${JSON.stringify(TARGET_PATH)}) {
          status.textContent =
            'Browser capabilities passed. Waiting for the external native handoff request…';
          return;
        }

        assert(
          window.location.search === ${JSON.stringify(TARGET_SEARCH)},
          'The native handoff lost the room query string.',
        );
        assert(
          window.location.hash === ${JSON.stringify(TARGET_HASH)},
          'The native handoff lost the room fragment.',
        );
        assert(
          window.location.href === ${JSON.stringify(TARGET_URL)},
          'The native handoff loaded an unexpected room URL.',
        );
        await reportSmokeResult({ status: 'passed', url: window.location.href });
        document.documentElement.dataset.smokeStatus = 'ok';
        status.textContent = 'Native cold-start handoff preserved path, query, and hash.';
        document.title = 'LiveKit Companion WebView Smoke OK';
      }

      async function reportSmokeResult(payload) {
        const response = await fetch('/smoke-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('The smoke fixture rejected the browser result.');
      }

      function companionHello() {
        return new Promise((resolve, reject) => {
          const socket = new WebSocket('ws://127.0.0.1:7331');
          const timer = window.setTimeout(() => {
            socket.close();
            reject(new Error('Timed out waiting for companion capabilities.'));
          }, 10_000);

          socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ type: 'capabilities' }));
          });
          socket.addEventListener('message', (event) => {
            let message;
            try {
              message = JSON.parse(String(event.data));
            } catch {
              return;
            }
            if (message.type !== 'hello' || !Array.isArray(message.capabilities)) return;
            window.clearTimeout(timer);
            socket.close();
            resolve(message);
          });
          socket.addEventListener('error', () => {
            window.clearTimeout(timer);
            reject(new Error('Could not connect to the companion WebSocket.'));
          });
        });
      }

      function assert(condition, message) {
        if (!condition) throw new Error(message);
      }

      function withTimeout(promise, timeoutMs, message) {
        return Promise.race([
          promise,
          new Promise((_, reject) => window.setTimeout(() => reject(new Error(message)), timeoutMs)),
        ]);
      }
    </script>
  </body>
</html>`;

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    send(response, 200, 'ok\n', 'text/plain; charset=utf-8');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/smoke-status') {
    sendJson(response, 200, smokeState);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/smoke-result') {
    receiveSmokeResult(request, response);
    return;
  }
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === TARGET_PATH)) {
    if (url.pathname === TARGET_PATH) {
      if (url.search === TARGET_SEARCH) {
        targetRequestSeen = true;
      } else {
        recordFailure(`The native handoff requested an unexpected query string: ${url.search}`);
      }
    }
    send(response, 200, html, 'text/html; charset=utf-8');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/favicon.ico') {
    response.writeHead(204, commonHeaders());
    response.end();
    return;
  }
  send(response, 404, 'not found\n', 'text/plain; charset=utf-8');
});

server.on('error', (error) => {
  console.error(`[webview-smoke] ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[webview-smoke] listening on http://127.0.0.1:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, { ...commonHeaders(), 'Content-Type': contentType });
  response.end(body);
}

function sendJson(response, statusCode, value) {
  send(response, statusCode, `${JSON.stringify(value)}\n`, 'application/json; charset=utf-8');
}

function receiveSmokeResult(request, response) {
  let body = '';
  let tooLarge = false;
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > 8192) {
      tooLarge = true;
      body = '';
    }
  });
  request.on('end', () => {
    if (tooLarge) {
      recordFailure('The browser smoke result was too large.');
      sendJson(response, 413, smokeState);
      return;
    }

    let result;
    try {
      result = JSON.parse(body);
    } catch {
      recordFailure('The browser smoke result was not valid JSON.');
      sendJson(response, 400, smokeState);
      return;
    }

    if (result?.status === 'failed') {
      recordFailure(normalizeMessage(result.message));
    } else if (result?.status === 'passed' && targetRequestSeen && result.url === TARGET_URL) {
      if (smokeState.status !== 'failed') {
        smokeState.status = 'passed';
        smokeState.message = 'The native room target loaded with its exact path, query, and hash.';
        smokeState.observedUrl = result.url;
      }
    } else {
      recordFailure('The browser reported an invalid native handoff result.');
    }
    sendJson(response, smokeState.status === 'failed' ? 400 : 200, smokeState);
  });
  request.on('error', (error) => {
    recordFailure(`Could not read the browser smoke result: ${error.message}`);
    if (!response.headersSent) sendJson(response, 400, smokeState);
  });
}

function recordFailure(message) {
  if (smokeState.status === 'failed') return;
  smokeState.status = 'failed';
  smokeState.message = message;
}

function normalizeMessage(value) {
  if (typeof value !== 'string') return 'The WebView smoke page reported a failure.';
  const message = value.trim();
  return message ? message.slice(0, 1024) : 'The WebView smoke page reported a failure.';
}

function commonHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:7331; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid smoke server port: ${value}`);
  }
  return parsed;
}
