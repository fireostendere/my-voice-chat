'use strict';

const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { isLoopbackOrigin } = require('./origin-core');

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_URL_LENGTH = 8192;
const MAX_RESPONSE_BYTES = 4096;
const MAX_MESSAGE_LENGTH = 512;

class NativeNavigationService {
  constructor({
    uiPort,
    launcherPath,
    getWebAppUrl,
    fsImpl = fs,
    spawnImpl = spawn,
    connectImpl = net.createConnection,
    timers = {},
    ipcTimeoutMs = 110000,
    launchTimeoutMs = 120000,
    retryIntervalMs = 100,
  }) {
    if (!Number.isInteger(uiPort) || uiPort < 1 || uiPort > 65535) {
      throw new Error('Invalid companion UI port.');
    }
    if (typeof getWebAppUrl !== 'function') {
      throw new Error('getWebAppUrl must be a function.');
    }

    this.pipePath = navigationPipePath(uiPort);
    this.launcherPath = typeof launcherPath === 'string' && launcherPath ? launcherPath : null;
    this.getWebAppUrl = getWebAppUrl;
    this.fs = fsImpl;
    this.spawn = spawnImpl;
    this.connect = connectImpl;
    this.setTimeout = timers.setTimeout || setTimeout;
    this.clearTimeout = timers.clearTimeout || clearTimeout;
    this.now = timers.now || Date.now;
    this.ipcTimeoutMs = ipcTimeoutMs;
    this.launchTimeoutMs = launchTimeoutMs;
    this.retryIntervalMs = retryIntervalMs;
    this.activeNavigation = null;
  }

  isAvailable() {
    if (!this.launcherPath) return false;
    try {
      return this.fs.existsSync(this.launcherPath);
    } catch {
      return false;
    }
  }

  attachSocket(socket, { origin } = {}) {
    if (!this.isAvailable()) return Promise.resolve([]);

    // Capture the HTTP upgrade Origin as a primitive. Never consult mutable
    // socket/request state when a later command arrives.
    const socketOrigin = typeof origin === 'string' ? origin : '';
    socket.on('message', (raw) => void this.handleMessage(socket, socketOrigin, raw));
    const cancelNavigation = () => this.cancelSocket(socket);
    socket.on('close', cancelNavigation);
    socket.on('error', cancelNavigation);
    return this.capabilitiesForOrigin(socketOrigin);
  }

  async capabilitiesForOrigin(socketOrigin) {
    try {
      const configured = new URL(await this.getWebAppUrl());
      return configured.origin === socketOrigin ? ['open-room'] : [];
    } catch {
      return [];
    }
  }

  cancelSocket(socket) {
    if (this.activeNavigation?.socket === socket) {
      this.activeNavigation.controller.abort();
    }
  }

  async handleMessage(socket, socketOrigin, raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message || message.type !== 'open-room') return;

    let requestId;
    try {
      requestId = validRequestId(message.requestId);
    } catch {
      return;
    }

    if (socket?.readyState !== 1) return;
    if (this.activeNavigation) {
      this.sendResult(socket, requestId, {
        accepted: false,
        message: 'Another room is already being opened.',
      });
      return;
    }
    const activeNavigation = { socket, controller: new AbortController() };
    this.activeNavigation = activeNavigation;
    const { signal } = activeNavigation.controller;

    try {
      if (!this.isAvailable()) {
        throw new NavigationError('The desktop client is not available.');
      }
      const url = await this.validateTarget(message.url, socketOrigin, signal);
      const result = await this.openNative({ version: 1, requestId, url }, signal);
      throwIfAborted(signal);
      this.sendResult(socket, requestId, result);
    } catch (error) {
      if (error instanceof NavigationAbortError) return;
      this.sendResult(socket, requestId, {
        accepted: false,
        message:
          error instanceof NavigationError
            ? error.message
            : 'The desktop client could not open this room.',
      });
    } finally {
      if (this.activeNavigation === activeNavigation) this.activeNavigation = null;
    }
  }

  async validateTarget(value, socketOrigin, signal) {
    throwIfAborted(signal);
    if (
      typeof value !== 'string' ||
      value.length < 1 ||
      value.length > MAX_URL_LENGTH ||
      value !== value.trim()
    ) {
      throw new NavigationError('Invalid room URL.');
    }

    let target;
    try {
      target = new URL(value);
    } catch {
      throw new NavigationError('Invalid room URL.');
    }
    if (
      target.href.length > MAX_URL_LENGTH ||
      (target.protocol !== 'http:' && target.protocol !== 'https:') ||
      target.origin === 'null' ||
      hasCredentials(value, target) ||
      (target.protocol === 'http:' && !isLoopbackOrigin(target.origin)) ||
      !isRoomRoute(target.pathname)
    ) {
      throw new NavigationError('Invalid room URL.');
    }

    let configured;
    try {
      configured = new URL(await withAbort(Promise.resolve(this.getWebAppUrl()), signal));
    } catch (error) {
      if (error instanceof NavigationAbortError) throw error;
      throw new NavigationError('The companion web app is not configured.');
    }
    throwIfAborted(signal);
    if (target.origin !== socketOrigin || target.origin !== configured.origin) {
      throw new NavigationError('The room URL does not match the configured web app.');
    }

    // Forward the parser's canonical URL while retaining its path, query, and hash.
    return target.href;
  }

  async openNative(request, signal) {
    throwIfAborted(signal);
    try {
      return await this.exchange(request, this.ipcTimeoutMs, signal);
    } catch (error) {
      if (error instanceof NavigationAbortError) throw error;
      if (!(error instanceof PipeError) || error.kind !== 'unavailable') {
        throw mapPipeError(error);
      }
    }

    throwIfAborted(signal);
    this.launchClient();
    const deadline = this.now() + this.launchTimeoutMs;
    while (this.now() < deadline) {
      throwIfAborted(signal);
      const delayMs = Math.min(this.retryIntervalMs, Math.max(0, deadline - this.now()));
      if (delayMs > 0) await this.delay(delayMs, signal);
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) break;
      try {
        return await this.exchange(request, Math.min(this.ipcTimeoutMs, remainingMs), signal);
      } catch (error) {
        if (error instanceof NavigationAbortError) throw error;
        if (!(error instanceof PipeError) || error.kind !== 'unavailable') {
          throw mapPipeError(error);
        }
      }
    }
    throw new NavigationError('The desktop client did not become ready.');
  }

  launchClient() {
    try {
      const child = this.spawn(this.launcherPath, ['--open'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      child?.on?.('error', () => {});
      child?.unref?.();
    } catch {}
  }

  exchange(request, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let pipe;
      let connected = false;
      let settled = false;
      let buffered = '';
      let timeout;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) this.clearTimeout(timeout);
        pipe?.off?.('connect', onConnect);
        pipe?.off?.('data', onData);
        pipe?.off?.('error', onError);
        pipe?.off?.('close', onClose);
        signal?.removeEventListener('abort', onAbort);
        pipe?.destroy?.();
        callback(value);
      };
      const fail = (kind) => finish(reject, new PipeError(kind));
      const onAbort = () => finish(reject, new NavigationAbortError());
      const onConnect = () => {
        connected = true;
        try {
          pipe.write(`${JSON.stringify(request)}\n`);
        } catch {
          fail('invalid');
        }
      };
      const onData = (chunk) => {
        buffered += String(chunk);
        const newline = buffered.indexOf('\n');
        if (newline === -1) {
          if (Buffer.byteLength(buffered, 'utf8') > MAX_RESPONSE_BYTES) fail('invalid');
          return;
        }

        const line = buffered.slice(0, newline).replace(/\r$/, '');
        if (Buffer.byteLength(line, 'utf8') > MAX_RESPONSE_BYTES) {
          fail('invalid');
          return;
        }
        let response;
        try {
          response = JSON.parse(line);
        } catch {
          fail('invalid');
          return;
        }
        if (!response || typeof response.accepted !== 'boolean') {
          fail('invalid');
          return;
        }
        const message = validNativeMessage(response.message);
        if (response.message !== undefined && message === undefined) {
          fail('invalid');
          return;
        }
        finish(resolve, { accepted: response.accepted, ...(message ? { message } : {}) });
      };
      const onError = () => fail(connected ? 'invalid' : 'unavailable');
      const onClose = () => fail(connected ? 'invalid' : 'unavailable');
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timeout = this.setTimeout(
        () => fail(connected ? 'timeout' : 'unavailable'),
        Math.max(1, timeoutMs),
      );

      try {
        pipe = this.connect(this.pipePath);
        pipe.setEncoding?.('utf8');
        pipe.once('connect', onConnect);
        pipe.on('data', onData);
        pipe.once('error', onError);
        pipe.once('close', onClose);
      } catch {
        fail('unavailable');
      }
    });
  }

  delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      let timeout;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) this.clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, new NavigationAbortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timeout = this.setTimeout(() => finish(resolve), milliseconds);
    });
  }

  sendResult(socket, requestId, result) {
    if (socket?.readyState !== 1) return;
    const message = validNativeMessage(result.message);
    const payload = {
      type: 'open-room-result',
      requestId,
      accepted: result.accepted === true,
      ...(message ? { message } : {}),
    };
    try {
      socket.send(JSON.stringify(payload));
    } catch {}
  }
}

class NavigationError extends Error {}

class NavigationAbortError extends Error {}

class PipeError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

function navigationPipePath(uiPort) {
  return `\\\\.\\pipe\\LiveKitCompanion.Navigation.${uiPort}`;
}

function validRequestId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_REQUEST_ID_LENGTH ||
    value.trim().length === 0
  ) {
    throw new NavigationError('Invalid requestId.');
  }
  return value;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new NavigationAbortError();
}

function withAbort(promise, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, new NavigationAbortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function hasCredentials(value, url) {
  if (url.username || url.password) return true;
  const schemeEnd = value.indexOf('://');
  if (schemeEnd === -1) return false;
  const authority = value.slice(schemeEnd + 3).split(/[/?#]/, 1)[0];
  return authority.includes('@');
}

function isRoomRoute(pathname) {
  return /^\/rooms\/[^/]+\/?$/.test(pathname) || pathname === '/custom' || pathname === '/custom/';
}

function validNativeMessage(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_MESSAGE_LENGTH) {
    return undefined;
  }
  return value;
}

function mapPipeError(error) {
  if (error instanceof PipeError && error.kind === 'timeout') {
    return new NavigationError('The desktop client did not respond.');
  }
  return new NavigationError('The desktop client returned an invalid response.');
}

module.exports = { NativeNavigationService, navigationPipePath };
