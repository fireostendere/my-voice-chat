import { fireEvent, waitFor } from '@testing-library/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function installUi() {
  document.body.innerHTML = `
    <meta name="companion-token" content="test-token" />
    <select id="room-select"></select>
    <span id="room-count"></span>
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
