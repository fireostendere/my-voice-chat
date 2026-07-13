'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawn, spawnSync } = require('node:child_process');
const { normalizePttKey, SUPPORTED_KEYS } = require('./app/ptt-key-listener');

async function main() {
  console.log('Supported keys:');
  console.log(SUPPORTED_KEYS.join(', '));
  console.log();

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await prompt.question('Enter the push-to-talk key: ');
  } finally {
    prompt.close();
  }

  let key;
  try {
    key = normalizePttKey(answer);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const dataDir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'LiveKitCompanion');
  const pidFile = path.join(dataDir, 'companion.pid');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'settings.env'), `PTT_KEY=${key}\r\n`, 'ascii');

  stopRunningCompanion(pidFile);
  startCompanion();
  console.log(`Push-to-talk key updated to ${key}.`);
}

function stopRunningCompanion(pidFile) {
  try {
    const pid = fs.readFileSync(pidFile, 'utf8').trim();
    if (/^\d+$/.test(pid)) {
      spawnSync('taskkill.exe', ['/PID', pid, '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    fs.rmSync(pidFile, { force: true });
  } catch {}
}

function startCompanion() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const child = spawn(path.join(systemRoot, 'System32', 'wscript.exe'), [
    path.join(__dirname, 'start-companion.vbs'),
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
