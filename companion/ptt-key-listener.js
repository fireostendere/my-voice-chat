'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const NAMED_KEYS = [
  'BACKSPACE',
  'TAB',
  'ENTER',
  'SHIFT',
  'CONTROL',
  'ALT',
  'CAPSLOCK',
  'ESCAPE',
  'SPACE',
  'PAGEUP',
  'PAGEDOWN',
  'END',
  'HOME',
  'LEFT',
  'UP',
  'RIGHT',
  'DOWN',
  'INSERT',
  'DELETE',
  'XBUTTON1',
  'XBUTTON2',
];
const SUPPORTED_KEYS = [
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  ...Array.from({ length: 10 }, (_, index) => String(index)),
  ...NAMED_KEYS,
];
const KEY_ALIASES = new Map([
  ['CTRL', 'CONTROL'],
  ['ESC', 'ESCAPE'],
  ['RETURN', 'ENTER'],
  ['MOUSE4', 'XBUTTON1'],
  ['MOUSE5', 'XBUTTON2'],
]);

class PttKeyListener {
  constructor({
    key,
    helperPath,
    uiUrl,
    iconPath,
    onState,
    onExit = () => {},
    onError = () => {},
  }) {
    this.key = normalizePttKey(key);
    this.helperPath = helperPath || path.join(__dirname, 'bin', 'LiveKitCompanionNative.exe');
    this.uiUrl = uiUrl;
    this.iconPath = iconPath;
    this.onState = onState;
    this.onExit = onExit;
    this.onError = onError;
    this.child = null;
  }

  start() {
    if (process.platform !== 'win32') {
      this.onError(new Error('Global PTT is available on Windows only.'));
      return;
    }
    if (this.child) return;

    const args = [this.key];
    if (this.uiUrl) args.push('--ui-url', this.uiUrl);
    if (this.iconPath) args.push('--icon', this.iconPath);
    const child = spawn(this.helperPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    const parse = createLineParser((line) => {
      if (line === 'DOWN') this.onState(true);
      if (line === 'UP') this.onState(false);
      if (line === 'EXIT') this.onExit();
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', parse);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (message) => this.onError(new Error(message.trim())));
    child.on('error', this.onError);
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (code && code !== 0) this.onError(new Error(`PTT helper exited with code ${code}.`));
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  setKey(value) {
    const nextKey = normalizePttKey(value);
    if (nextKey === this.key) return this.key;
    const wasRunning = Boolean(this.child);
    this.stop();
    this.key = nextKey;
    if (wasRunning) this.start();
    return this.key;
  }
}

function createLineParser(onLine) {
  let buffered = '';
  return (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) onLine(line.trim().toUpperCase());
  };
}

function normalizePttKey(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  const normalized = KEY_ALIASES.get(raw) || raw;
  if (!SUPPORTED_KEYS.includes(normalized)) {
    throw new Error(`Unsupported PTT key: ${value || '(empty)'}.`);
  }
  return normalized;
}

if (require.main === module && process.argv.includes('--list')) {
  console.log(SUPPORTED_KEYS.join(', '));
}

module.exports = { PttKeyListener, SUPPORTED_KEYS, createLineParser, normalizePttKey };
