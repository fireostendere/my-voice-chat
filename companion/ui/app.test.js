import { fireEvent, waitFor } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installUi() {
  document.body.innerHTML = `
    <meta name="companion-token" content="test-token" />
    <div id="service-state"><strong></strong></div>
    <button id="open-chat-button"></button>
    <select id="room-select"></select>
    <span id="room-count"></span>
    <form id="server-form">
      <input id="server-origin-input" />
      <button id="save-origin-button"><span></span></button>
    </form>
    <div id="approved-origin-list"></div>
    <span id="connection-mode"></span>
    <button id="key-capture-button" disabled>
      <span id="key-capture-state"></span>
      <strong id="key-display"></strong>
      <small id="key-capture-label"></small>
    </button>
    <input id="torrent-file" type="file" />
    <span id="file-label"></span>
    <button id="drop-zone"></button>
    <input id="magnet-input" />
    <button id="play-button"><span></span></button>
    <span id="playback-state"></span>
    <span id="playback-title"></span>
    <span id="playback-detail"></span>
    <input id="playback-seek" />
    <span id="playback-current"></span>
    <span id="playback-duration"></span>
    <button id="playback-toggle"><span></span><b></b></button>
    <button id="playback-stop"></button>
    <span id="footer-status"></span>
    <button id="refresh-button"></button>
    <span id="toast"></span>
  `;
}

beforeEach(() => {
  vi.resetModules();
  installUi();
  vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.chrome;
});

describe('companion talk-key capture', () => {
  it('captures physical keyboard and mouse keys, saves immediately, and lets Esc cancel', async () => {
    let activeKey = 'F8';
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/settings/ptt-key') {
        activeKey = JSON.parse(options.body).key;
        return { ok: true, json: async () => ({ pttKey: activeKey }) };
      }
      return {
        ok: true,
        json: async () => ({
          rooms: [],
          approvedOrigins: [],
          originsManaged: false,
          supportedKeys: ['F8', 'Q', 'XBUTTON1'],
          pttKey: activeKey,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await import('./app.js');
    const capture = document.querySelector('#key-capture-button');
    const display = document.querySelector('#key-display');
    await waitFor(() => expect(capture.disabled).toBe(false));

    fireEvent.click(capture);
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'й' });
    await waitFor(() => expect(display.textContent).toBe('Q'));
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body)).toEqual({ key: 'Q' });

    fireEvent.click(capture);
    fireEvent.mouseDown(window, { button: 3 });
    await waitFor(() => expect(display.textContent).toBe('Mouse 4'));
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body)).toEqual({ key: 'XBUTTON1' });

    const requestCount = fetchMock.mock.calls.length;
    fireEvent.click(capture);
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
    expect(display.textContent).toBe('Mouse 4');
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
  });
});

describe('companion trusted server settings', () => {
  it('selects the voice-chat web app, opens it in the native client, and removes it', async () => {
    let approvedOrigins = [];
    let webAppUrl = null;
    const postMessage = vi.fn();
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: { postMessage } },
    });
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/settings/web-app') {
        const origin = new URL(JSON.parse(options.body).url).origin;
        approvedOrigins = [origin];
        webAppUrl = `${origin}/`;
        return { ok: true, json: async () => ({ webAppUrl, approvedOrigins }) };
      }
      if (path === '/api/settings/origin') {
        const origin = new URL(JSON.parse(options.body).origin).origin;
        approvedOrigins = options.method === 'DELETE' ? [] : [origin];
        if (options.method === 'DELETE') webAppUrl = null;
        return { ok: true, json: async () => ({ origin, approvedOrigins, webAppUrl }) };
      }
      return {
        ok: true,
        json: async () => ({
          rooms: [],
          approvedOrigins,
          originsManaged: false,
          webAppUrl,
          webAppManaged: false,
          supportedKeys: ['F8'],
          pttKey: 'F8',
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await import('./app.js');
    const input = document.querySelector('#server-origin-input');
    const form = document.querySelector('#server-form');
    const list = document.querySelector('#approved-origin-list');
    await waitFor(() => expect(input.disabled).toBe(false));

    fireEvent.input(input, { target: { value: 'https://api.iroslyakov.com/rooms/cinema' } });
    fireEvent.submit(form);
    await waitFor(() => expect(list.textContent).toContain('https://api.iroslyakov.com'));
    expect(list.textContent).toContain('CLIENT');
    expect(postMessage).toHaveBeenCalledWith('open-client');
    const addRequest = fetchMock.mock.calls.find(
      ([path, options]) => path === '/api/settings/web-app' && options.method === 'PUT',
    );
    expect(JSON.parse(addRequest[1].body)).toEqual({
      url: 'https://api.iroslyakov.com/rooms/cinema',
    });

    fireEvent.click(list.querySelector('button[data-origin-action="remove"]'));
    await waitFor(() => expect(list.textContent).toContain('No voice-chat server'));
    expect(fetchMock.mock.calls).toContainEqual([
      '/api/settings/origin',
      expect.objectContaining({ method: 'DELETE' }),
    ]);
  });
});

function activeStatus() {
  return {
    rooms: [
      {
        id: 'room-1',
        roomName: 'friends',
        participantIdentity: 'Alice',
        playback: {
          active: true,
          phase: 'playing',
          name: 'Movie',
          paused: false,
          duration: 120,
          currentTime: 10,
          canSeek: true,
        },
      },
    ],
    approvedOrigins: ['https://chat.example'],
    webAppUrl: 'https://chat.example/',
    supportedKeys: ['F8'],
    pttKey: 'F8',
  };
}

function response(body, status = 200) {
  return { ok: status === 200, status, json: async () => body };
}

describe('companion service recovery', () => {
  it('disables stale controls on an outage, preserves input, and recovers on the next refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(activeStatus()));
    vi.stubGlobal('fetch', fetchMock);
    await import('./app.js');
    const state = document.querySelector('#service-state');
    const magnet = document.querySelector('#magnet-input');
    const play = document.querySelector('#play-button');
    await waitFor(() => expect(state.dataset.state).toBe('online'));
    fireEvent.input(magnet, {
      target: { value: 'magnet:?xt=urn:btih:0123456789012345678901234567890123456789' },
    });
    expect(play.disabled).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
    fireEvent.click(document.querySelector('#refresh-button'));
    await waitFor(() => expect(state.dataset.state).toBe('offline'));
    expect(play.disabled).toBe(true);
    expect(document.querySelector('#playback-toggle').disabled).toBe(true);
    expect(document.querySelector('#key-capture-button').disabled).toBe(true);
    expect(magnet.value).toContain('magnet:');
    fireEvent.click(document.querySelector('#refresh-button'));
    await waitFor(() => expect(state.dataset.state).toBe('online'));
    expect(play.disabled).toBe(false);
  });

  it('keeps focused settings and the selected room intact during status polling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(activeStatus())));
    await import('./app.js');
    await waitFor(() =>
      expect(document.querySelector('#service-state').dataset.state).toBe('online'),
    );
    const originButton = document.querySelector('[data-origin-action="open"]');
    const roomOption = document.querySelector('#room-select option');
    originButton.focus();
    fireEvent.click(document.querySelector('#refresh-button'));
    await waitFor(() =>
      expect(document.querySelector('#toast').textContent).toContain('refreshed'),
    );
    expect(document.activeElement).toBe(originButton);
    expect(document.querySelector('#room-select option')).toBe(roomOption);
  });

  it('keeps torrent sending disabled while a request is pending, even after a refresh', async () => {
    let finishSend;
    const fetchMock = vi.fn((path) =>
      path === '/api/torrent'
        ? new Promise((resolve) => {
            finishSend = resolve;
          })
        : Promise.resolve(response(activeStatus())),
    );
    vi.stubGlobal('fetch', fetchMock);
    await import('./app.js');
    await waitFor(() =>
      expect(document.querySelector('#service-state').dataset.state).toBe('online'),
    );
    fireEvent.input(document.querySelector('#magnet-input'), {
      target: { value: 'magnet:?xt=urn:btih:0123456789012345678901234567890123456789' },
    });
    fireEvent.click(document.querySelector('#play-button'));
    fireEvent.click(document.querySelector('#refresh-button'));
    await waitFor(() =>
      expect(document.querySelector('#toast').textContent).toContain('refreshed'),
    );
    expect(document.querySelector('#play-button').disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/torrent')).toHaveLength(1);
    finishSend(response({ message: 'Sent.' }));
    await waitFor(() => expect(document.querySelector('#magnet-input').disabled).toBe(false));
  });

  it('asks for a page reload when the service has replaced its settings token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ error: 'Invalid companion token.' }, 403)),
    );
    await import('./app.js');
    await waitFor(() =>
      expect(document.querySelector('#refresh-button').textContent).toBe('Reload settings'),
    );
    expect(document.querySelector('#footer-status').textContent).toContain('service restarted');
  });
});
