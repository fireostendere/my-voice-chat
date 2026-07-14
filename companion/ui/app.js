'use strict';

const token = document.querySelector('meta[name="companion-token"]').content;
const roomSelect = document.querySelector('#room-select');
const roomCount = document.querySelector('#room-count');
const keyDisplay = document.querySelector('#key-display');
const keyCaptureButton = document.querySelector('#key-capture-button');
const keyCaptureState = document.querySelector('#key-capture-state');
const keyCaptureLabel = document.querySelector('#key-capture-label');
const fileInput = document.querySelector('#torrent-file');
const fileLabel = document.querySelector('#file-label');
const dropZone = document.querySelector('#drop-zone');
const magnetInput = document.querySelector('#magnet-input');
const playButton = document.querySelector('#play-button');
const playbackState = document.querySelector('#playback-state');
const playbackTitle = document.querySelector('#playback-title');
const playbackDetail = document.querySelector('#playback-detail');
const playbackSeek = document.querySelector('#playback-seek');
const playbackCurrent = document.querySelector('#playback-current');
const playbackDuration = document.querySelector('#playback-duration');
const playbackToggle = document.querySelector('#playback-toggle');
const playbackStop = document.querySelector('#playback-stop');
const footerStatus = document.querySelector('#footer-status');
const refreshButton = document.querySelector('#refresh-button');
const toast = document.querySelector('#toast');

let rooms = [];
let selectedFile = null;
let toastTimer;
let keyCaptureFeedbackTimer;
let supportedPttKeys = new Set();
let configuredPttKey = 'F8';
let capturingKey = false;
let savingKey = false;
let seeking = false;
let playbackBusy = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Companion-Token': token,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body;
}

async function refreshStatus({ quiet = false } = {}) {
  try {
    const status = await api('/api/status');
    rooms = status.rooms;
    renderRooms();
    renderKeys(status.supportedKeys, status.pttKey);
    if (!quiet) showToast('Companion status refreshed.');
  } catch (error) {
    footerStatus.textContent = 'Companion UI lost connection.';
    showToast(error.message, true);
  }
}

function renderRooms() {
  const previous = roomSelect.value;
  roomSelect.replaceChildren();
  if (rooms.length === 0) {
    roomSelect.add(new Option('No active rooms', ''));
    roomSelect.disabled = true;
    footerStatus.textContent =
      'Join a room in the browser and allow its local-network access prompt.';
  } else {
    for (const room of rooms) {
      roomSelect.add(new Option(`${room.roomName} · ${room.participantIdentity}`, room.id));
    }
    roomSelect.disabled = false;
    if (rooms.some((room) => room.id === previous)) roomSelect.value = previous;
    footerStatus.textContent = `${rooms.length} active room${rooms.length === 1 ? '' : 's'} connected.`;
  }
  roomCount.textContent = String(rooms.length);
  updatePlayButton();
  renderPlayback();
}

function renderKeys(keys, currentKey) {
  supportedPttKeys = new Set(keys);
  if (!capturingKey && !savingKey) {
    configuredPttKey = currentKey;
    renderIdleKeyBinding();
  }
}

function renderPlayback() {
  const playback = selectedRoom()?.playback;
  if (!playback?.active) {
    playbackState.textContent = 'IDLE';
    playbackState.dataset.phase = 'idle';
    playbackTitle.textContent = 'Nothing is playing';
    playbackDetail.textContent = rooms.length
      ? 'Choose a torrent above and send it to this room.'
      : 'Join a room in the browser and allow access to this PC when prompted.';
    if (!seeking) playbackSeek.value = '0';
    playbackSeek.disabled = true;
    playbackCurrent.textContent = '0:00';
    playbackDuration.textContent = '0:00';
    setPlaybackButton(playbackToggle, true, 'Play', '▶');
    playbackStop.disabled = true;
    return;
  }

  playbackState.textContent = playback.phase.toUpperCase();
  playbackState.dataset.phase = playback.phase;
  playbackTitle.textContent = playback.name;
  playbackDetail.textContent = [playback.status, playback.detail].filter(Boolean).join(' · ');
  const duration = Number.isFinite(playback.duration) ? playback.duration : 0;
  const currentTime = Number.isFinite(playback.currentTime) ? playback.currentTime : 0;
  if (!seeking) {
    playbackSeek.value = duration > 0 ? String(Math.round((currentTime / duration) * 1000)) : '0';
    playbackCurrent.textContent = formatTime(currentTime);
  }
  playbackDuration.textContent = formatTime(duration);
  playbackSeek.disabled = playbackBusy || !playback.canSeek || duration <= 0;
  const toggleDisabled = playbackBusy || playback.phase === 'loading' || playback.phase === 'error';
  setPlaybackButton(
    playbackToggle,
    toggleDisabled,
    playback.paused ? 'Play' : 'Pause',
    playback.paused ? '▶' : 'Ⅱ',
  );
  playbackStop.disabled = playbackBusy;
}

function setPlaybackButton(button, disabled, label, icon) {
  button.disabled = disabled;
  button.querySelector('span').textContent = label;
  button.querySelector('b').textContent = icon;
}

function selectedRoom() {
  return rooms.find((room) => room.id === roomSelect.value);
}

function updatePlayButton() {
  const hasSource = Boolean(selectedFile || magnetInput.value.trim());
  playButton.disabled = !roomSelect.value || !hasSource;
}

function chooseFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.torrent')) {
    showToast('Choose a .torrent file.', true);
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('The .torrent file exceeds the 2 MB limit.', true);
    return;
  }
  selectedFile = file;
  magnetInput.value = '';
  fileLabel.textContent = file.name;
  updatePlayButton();
}

async function playTorrent() {
  const roomId = roomSelect.value;
  if (!roomId) return;
  playButton.disabled = true;
  playButton.querySelector('span').textContent = 'Sending…';
  try {
    const input = selectedFile
      ? {
          kind: 'torrent-file',
          name: selectedFile.name,
          base64: arrayBufferToBase64(await selectedFile.arrayBuffer()),
        }
      : {
          kind: 'magnet',
          name: magnetDisplayName(magnetInput.value.trim()),
          magnet: magnetInput.value.trim(),
        };
    const result = await api('/api/torrent', {
      method: 'POST',
      body: JSON.stringify({ roomId, input }),
    });
    showToast(result.message || 'Torrent started in the room.');
    selectedFile = null;
    fileInput.value = '';
    fileLabel.textContent = 'Choose a .torrent file';
    magnetInput.value = '';
    await refreshStatus({ quiet: true });
  } catch (error) {
    showToast(error.message, true);
  } finally {
    playButton.querySelector('span').textContent = 'Send to active room';
    updatePlayButton();
  }
}

async function sendPlaybackCommand(action, currentTime) {
  const roomId = roomSelect.value;
  if (!roomId || playbackBusy) return;
  playbackBusy = true;
  renderPlayback();
  try {
    const payload = { roomId, action };
    if (action === 'seek') payload.currentTime = currentTime;
    const result = await api('/api/playback', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (action === 'stop') showToast(result.message || 'Playback stopped.');
    await refreshStatus({ quiet: true });
  } catch (error) {
    showToast(error.message, true);
  } finally {
    playbackBusy = false;
    renderPlayback();
  }
}

async function applyCapturedKey(key) {
  if (!capturingKey || savingKey) return;
  if (!supportedPttKeys.has(key)) {
    showUnsupportedKey();
    return;
  }

  clearTimeout(keyCaptureFeedbackTimer);
  capturingKey = false;
  savingKey = true;
  keyCaptureButton.classList.remove('capturing', 'capture-error');
  keyCaptureButton.classList.add('saving');
  keyCaptureButton.setAttribute('aria-pressed', 'false');
  keyCaptureButton.setAttribute('aria-busy', 'true');
  keyCaptureButton.disabled = true;
  keyCaptureState.textContent = 'APPLYING';
  keyDisplay.textContent = displayKeyName(key);
  keyCaptureLabel.textContent = 'Switching the global listener…';

  try {
    const result = await api('/api/settings/ptt-key', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    configuredPttKey = result.pttKey;
    showToast(`Push-to-talk key changed to ${displayKeyName(result.pttKey)}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    savingKey = false;
    renderIdleKeyBinding();
  }
}

function toggleKeyCapture() {
  if (savingKey) return;
  if (capturingKey) {
    cancelKeyCapture(true);
    return;
  }

  clearTimeout(keyCaptureFeedbackTimer);
  capturingKey = true;
  keyCaptureButton.classList.remove('capture-error', 'saving');
  keyCaptureButton.classList.add('capturing');
  keyCaptureButton.setAttribute('aria-pressed', 'true');
  keyCaptureButton.removeAttribute('aria-busy');
  keyCaptureState.textContent = 'LISTENING';
  keyDisplay.textContent = '…';
  keyCaptureLabel.textContent = 'Press a key or Mouse 4 / 5';
}

function cancelKeyCapture(announce = false) {
  if (!capturingKey) return;
  capturingKey = false;
  renderIdleKeyBinding();
  if (announce) showToast('Talk key change cancelled.');
}

function renderIdleKeyBinding() {
  clearTimeout(keyCaptureFeedbackTimer);
  keyCaptureButton.classList.remove('capturing', 'saving', 'capture-error');
  keyCaptureButton.setAttribute('aria-pressed', 'false');
  keyCaptureButton.removeAttribute('aria-busy');
  keyCaptureButton.disabled = supportedPttKeys.size === 0;
  keyCaptureState.textContent = 'ACTIVE BIND';
  keyDisplay.textContent = displayKeyName(configuredPttKey);
  keyCaptureLabel.textContent = 'Click, then press a key';
}

function showUnsupportedKey() {
  clearTimeout(keyCaptureFeedbackTimer);
  keyCaptureButton.classList.add('capture-error');
  keyCaptureState.textContent = 'NOT SUPPORTED';
  keyCaptureLabel.textContent = 'Try another key · Esc cancels';
  keyCaptureFeedbackTimer = setTimeout(() => {
    if (!capturingKey) return;
    keyCaptureButton.classList.remove('capture-error');
    keyCaptureState.textContent = 'LISTENING';
    keyCaptureLabel.textContent = 'Press a key or Mouse 4 / 5';
  }, 1100);
}

function browserKeyName(event) {
  const code = String(event.code || '');
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  const codeAliases = {
    Backspace: 'BACKSPACE',
    Tab: 'TAB',
    Enter: 'ENTER',
    NumpadEnter: 'ENTER',
    ShiftLeft: 'SHIFT',
    ShiftRight: 'SHIFT',
    ControlLeft: 'CONTROL',
    ControlRight: 'CONTROL',
    AltLeft: 'ALT',
    AltRight: 'ALT',
    CapsLock: 'CAPSLOCK',
    Space: 'SPACE',
    PageUp: 'PAGEUP',
    PageDown: 'PAGEDOWN',
    End: 'END',
    Home: 'HOME',
    ArrowLeft: 'LEFT',
    ArrowUp: 'UP',
    ArrowRight: 'RIGHT',
    ArrowDown: 'DOWN',
    Insert: 'INSERT',
    Delete: 'DELETE',
  };
  if (codeAliases[code]) return codeAliases[code];

  const keyAliases = {
    ' ': 'SPACE',
    Control: 'CONTROL',
    Shift: 'SHIFT',
    Alt: 'ALT',
    CapsLock: 'CAPSLOCK',
    PageUp: 'PAGEUP',
    PageDown: 'PAGEDOWN',
    ArrowLeft: 'LEFT',
    ArrowUp: 'UP',
    ArrowRight: 'RIGHT',
    ArrowDown: 'DOWN',
  };
  return keyAliases[event.key] || String(event.key || '').toUpperCase();
}

function displayKeyName(key) {
  const names = {
    XBUTTON1: 'Mouse 4',
    XBUTTON2: 'Mouse 5',
    CONTROL: 'Ctrl',
    ESCAPE: 'Esc',
    BACKSPACE: 'Backspace',
    CAPSLOCK: 'Caps Lock',
    PAGEUP: 'Page Up',
    PAGEDOWN: 'Page Down',
    INSERT: 'Insert',
    DELETE: 'Delete',
    SPACE: 'Space',
    LEFT: '←',
    UP: '↑',
    RIGHT: '→',
    DOWN: '↓',
  };
  return names[key] || key;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function magnetDisplayName(magnet) {
  try {
    return new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1)).get('dn') || 'Torrent';
  } catch {
    return 'Torrent';
  }
}

function formatTime(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  chooseFile(event.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
magnetInput.addEventListener('input', () => {
  if (magnetInput.value.trim()) {
    selectedFile = null;
    fileInput.value = '';
    fileLabel.textContent = 'Choose a .torrent file';
  }
  updatePlayButton();
});
roomSelect.addEventListener('change', () => {
  seeking = false;
  updatePlayButton();
  renderPlayback();
});
keyCaptureButton.addEventListener('click', toggleKeyCapture);
window.addEventListener(
  'keydown',
  (event) => {
    if (!capturingKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code === 'Escape' || event.key === 'Escape') {
      cancelKeyCapture(true);
      return;
    }
    void applyCapturedKey(browserKeyName(event));
  },
  true,
);
window.addEventListener(
  'mousedown',
  (event) => {
    if (!capturingKey || (event.button !== 3 && event.button !== 4)) return;
    event.preventDefault();
    event.stopPropagation();
    void applyCapturedKey(event.button === 3 ? 'XBUTTON1' : 'XBUTTON2');
  },
  true,
);
window.addEventListener('blur', () => cancelKeyCapture());
playbackToggle.addEventListener('click', () => {
  const playback = selectedRoom()?.playback;
  if (playback?.active) void sendPlaybackCommand(playback.paused ? 'play' : 'pause');
});
playbackStop.addEventListener('click', () => void sendPlaybackCommand('stop'));
playbackSeek.addEventListener('input', () => {
  seeking = true;
  const duration = selectedRoom()?.playback?.duration;
  if (Number.isFinite(duration)) {
    playbackCurrent.textContent = formatTime((Number(playbackSeek.value) / 1000) * duration);
  }
});
playbackSeek.addEventListener('change', () => {
  const duration = selectedRoom()?.playback?.duration;
  const currentTime = Number.isFinite(duration)
    ? (Number(playbackSeek.value) / 1000) * duration
    : 0;
  seeking = false;
  void sendPlaybackCommand('seek', currentTime);
});
playButton.addEventListener('click', playTorrent);
refreshButton.addEventListener('click', () => refreshStatus());

refreshStatus({ quiet: true });
setInterval(() => refreshStatus({ quiet: true }), 1000);
