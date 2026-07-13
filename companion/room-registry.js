'use strict';

const crypto = require('node:crypto');

class RoomRegistry {
  constructor({ commandTimeoutMs = 5000 } = {}) {
    this.commandTimeoutMs = commandTimeoutMs;
    this.roomsBySocket = new Map();
    this.pendingCommands = new Map();
  }

  attachSocket(socket) {
    socket.on('message', (raw) => this.handleMessage(socket, raw));
    socket.on('close', () => this.removeSocket(socket));
  }

  handleMessage(socket, raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === 'room-register') {
      let roomName;
      let participantIdentity;
      try {
        roomName = validLabel(message.roomName, 'room name');
        participantIdentity = validLabel(message.participantIdentity, 'participant identity');
      } catch (error) {
        this.send(socket, {
          type: 'room-register-error',
          message: error instanceof Error ? error.message : 'Invalid room registration.',
        });
        return;
      }
      const existing = this.roomsBySocket.get(socket);
      const room = {
        id: existing?.id || crypto.randomUUID(),
        roomName,
        participantIdentity,
        connectedAt: existing?.connectedAt || Date.now(),
        playback: existing?.playback || { active: false },
        socket,
      };
      this.roomsBySocket.set(socket, room);
      this.send(socket, { type: 'room-registered', roomId: room.id });
      return;
    }

    if (message.type === 'room-playback-state') {
      const room = this.roomsBySocket.get(socket);
      const playback = validPlaybackState(message.playback);
      if (room && playback) room.playback = playback;
      return;
    }

    if (message.type === 'torrent-open-result' || message.type === 'playback-control-result') {
      const pending = this.pendingCommands.get(message.commandId);
      if (!pending || pending.socket !== socket || pending.resultType !== message.type) return;
      clearTimeout(pending.timer);
      this.pendingCommands.delete(message.commandId);
      pending.resolve({
        accepted: message.accepted === true,
        message:
          typeof message.message === 'string' && message.message.length <= 512
            ? message.message
            : message.accepted === true
              ? pending.resultType === 'torrent-open-result'
                ? 'Torrent sent to the room.'
                : 'Playback control applied.'
              : pending.resultType === 'torrent-open-result'
                ? 'The room rejected the torrent.'
                : 'The room rejected the playback control.',
      });
    }
  }

  listRooms() {
    return [...this.roomsBySocket.values()]
      .filter(({ socket }) => socket.readyState === 1)
      .map(({ id, roomName, participantIdentity, connectedAt, playback }) => ({
        id,
        roomName,
        participantIdentity,
        connectedAt,
        playback,
      }))
      .sort((left, right) => left.roomName.localeCompare(right.roomName));
  }

  openTorrent(roomId, input) {
    return this.sendCommand(roomId, { type: 'torrent-open', input }, 'torrent-open-result');
  }

  controlPlayback(roomId, control) {
    const command = validPlaybackControl(control);
    return this.sendCommand(
      roomId,
      { type: 'playback-control', ...command },
      'playback-control-result',
    );
  }

  sendCommand(roomId, message, resultType) {
    const room = [...this.roomsBySocket.values()].find(
      (candidate) => candidate.id === roomId && candidate.socket.readyState === 1,
    );
    if (!room) return Promise.reject(new Error('The selected room is no longer connected.'));

    const commandId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error('The room did not acknowledge the companion command.'));
      }, this.commandTimeoutMs);
      this.pendingCommands.set(commandId, {
        socket: room.socket,
        resolve,
        reject,
        timer,
        resultType,
      });
      this.send(room.socket, { ...message, commandId });
    });
  }

  removeSocket(socket) {
    this.roomsBySocket.delete(socket);
    for (const [commandId, pending] of this.pendingCommands) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      this.pendingCommands.delete(commandId);
      pending.reject(new Error('The selected room disconnected.'));
    }
  }

  close() {
    for (const [commandId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Companion is stopping.'));
      this.pendingCommands.delete(commandId);
    }
    this.roomsBySocket.clear();
  }

  send(socket, message) {
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  }
}

function validLabel(value, label) {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function validPlaybackState(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.active === false) return { active: false };
  if (value.active !== true) return null;

  const phases = new Set(['loading', 'playing', 'paused', 'ended', 'error']);
  if (!phases.has(value.phase)) return null;
  if (!isText(value.name, 260) || !isText(value.status, 512) || !isText(value.detail, 512)) {
    return null;
  }
  if (!isNonNegativeNumber(value.currentTime)) return null;
  if (value.duration !== null && !isNonNegativeNumber(value.duration)) return null;
  if (typeof value.paused !== 'boolean' || typeof value.canSeek !== 'boolean') return null;

  return {
    active: true,
    name: value.name.trim(),
    phase: value.phase,
    status: value.status.trim(),
    detail: value.detail.trim(),
    currentTime: value.currentTime,
    duration: value.duration,
    paused: value.paused,
    canSeek: value.canSeek,
  };
}

function validPlaybackControl(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid playback command.');
  if (value.action === 'play' || value.action === 'pause' || value.action === 'stop') {
    return { action: value.action };
  }
  if (value.action === 'seek' && isNonNegativeNumber(value.currentTime)) {
    return { action: 'seek', currentTime: value.currentTime };
  }
  throw new Error('Invalid playback command.');
}

function isText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

module.exports = { RoomRegistry, validLabel, validPlaybackControl, validPlaybackState };
