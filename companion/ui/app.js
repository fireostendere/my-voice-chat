'use strict';

const token = document.querySelector('meta[name="companion-token"]').content;
const roomSelect = document.querySelector('#room-select');
const roomCount = document.querySelector('#room-count');
const pttKeySelect = document.querySelector('#ptt-key-select');
const keyDisplay = document.querySelector('#key-display');
const keyCaptureButton = document.querySelector('#key-capture-button');
const keyCaptureLabel = document.querySelector('#key-capture-label');
const saveKeyButton = document.querySelector('#save-key-button');
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
let keyDirty = false;
let capturingKey = false;
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
    footerStatus.textContent = 'Open a voice-chat room to connect it.';
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
  if (pttKeySelect.options.length === 0) {
    for (const key of keys) pttKeySelect.add(new Option(displayKeyName(key), key));
  }
  if (!keyDirty) {
    pttKeySelect.value = currentKey;
    keyDisplay.textContent = displayKeyName(currentKey);
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
      : 'Open a voice-chat room to enable remote playback controls.';
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

async function savePttKey() {
  saveKeyButton.disabled = true;
  try {
    const result = await api('/api/settings/ptt-key', {
      method: 'POST',
      body: JSON.stringify({ key: pttKeySelect.value }),
    });
    keyDirty = false;
    keyDisplay.textContent = displayKeyName(result.pttKey);
    stopKeyCapture();
    showToast(`Push-to-talk key changed to ${displayKeyName(result.pttKey)}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveKeyButton.disabled = false;
  }
}

function toggleKeyCapture() {
  capturingKey = !capturingKey;
  keyCaptureButton.classList.toggle('capturing', capturingKey);
  keyCaptureLabel.textContent = capturingKey
    ? 'Press one key or a mouse side button…'
    : 'Click to capture a key';
}

function stopKeyCapture() {
  capturingKey = false;
  keyCaptureButton.classList.remove('capturing');
  keyCaptureLabel.textContent = 'Click to capture a key';
}

function captureKey(key) {
  if (![...pttKeySelect.options].some((option) => option.value === key)) {
    showToast('That key is not supported for push-to-talk.', true);
    return;
  }
  pttKeySelect.value = key;
  keyDisplay.textContent = displayKeyName(key);
  keyDirty = true;
  stopKeyCapture();
}

function browserKeyName(key) {
  const aliases = {
    ' ': 'SPACE',
    Control: 'CONTROL',
    Escape: 'ESCAPE',
    CapsLock: 'CAPSLOCK',
    PageUp: 'PAGEUP',
    PageDown: 'PAGEDOWN',
    ArrowLeft: 'LEFT',
    ArrowUp: 'UP',
    ArrowRight: 'RIGHT',
    ArrowDown: 'DOWN',
  };
  return aliases[key] || String(key).toUpperCase();
}

function displayKeyName(key) {
  if (key === 'XBUTTON1') return 'Mouse 4';
  if (key === 'XBUTTON2') return 'Mouse 5';
  if (key === 'CONTROL') return 'Ctrl';
  if (key === 'ESCAPE') return 'Esc';
  return key;
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
pttKeySelect.addEventListener('change', () => {
  keyDirty = true;
  keyDisplay.textContent = displayKeyName(pttKeySelect.value);
});
keyCaptureButton.addEventListener('click', toggleKeyCapture);
window.addEventListener('keydown', (event) => {
  if (!capturingKey) return;
  event.preventDefault();
  event.stopPropagation();
  captureKey(browserKeyName(event.key));
});
window.addEventListener('mousedown', (event) => {
  if (!capturingKey || (event.button !== 3 && event.button !== 4)) return;
  event.preventDefault();
  captureKey(event.button === 3 ? 'XBUTTON1' : 'XBUTTON2');
});
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
saveKeyButton.addEventListener('click', savePttKey);
refreshButton.addEventListener('click', () => refreshStatus());

refreshStatus({ quiet: true });
setInterval(() => refreshStatus({ quiet: true }), 1000);
