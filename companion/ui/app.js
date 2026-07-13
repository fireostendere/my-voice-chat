'use strict';

const token = document.querySelector('meta[name="companion-token"]').content;
const roomSelect = document.querySelector('#room-select');
const roomCount = document.querySelector('#room-count');
const pttKeySelect = document.querySelector('#ptt-key-select');
const keyDisplay = document.querySelector('#key-display');
const saveKeyButton = document.querySelector('#save-key-button');
const fileInput = document.querySelector('#torrent-file');
const fileLabel = document.querySelector('#file-label');
const dropZone = document.querySelector('#drop-zone');
const magnetInput = document.querySelector('#magnet-input');
const playButton = document.querySelector('#play-button');
const footerStatus = document.querySelector('#footer-status');
const refreshButton = document.querySelector('#refresh-button');
const toast = document.querySelector('#toast');

let rooms = [];
let selectedFile = null;
let toastTimer;
let keyDirty = false;

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
}

function renderKeys(keys, currentKey) {
  if (pttKeySelect.options.length === 0) {
    for (const key of keys) pttKeySelect.add(new Option(key, key));
  }
  if (!keyDirty) {
    pttKeySelect.value = currentKey;
    keyDisplay.textContent = currentKey;
  }
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
  } catch (error) {
    showToast(error.message, true);
  } finally {
    playButton.querySelector('span').textContent = 'Send to active room';
    updatePlayButton();
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
    keyDisplay.textContent = result.pttKey;
    showToast(`Push-to-talk key changed to ${result.pttKey}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveKeyButton.disabled = false;
  }
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
roomSelect.addEventListener('change', updatePlayButton);
pttKeySelect.addEventListener('change', () => {
  keyDirty = true;
  keyDisplay.textContent = pttKeySelect.value;
});
playButton.addEventListener('click', playTorrent);
saveKeyButton.addEventListener('click', savePttKey);
refreshButton.addEventListener('click', () => refreshStatus());

refreshStatus({ quiet: true });
setInterval(() => refreshStatus({ quiet: true }), 2000);
