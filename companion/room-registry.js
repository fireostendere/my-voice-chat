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
        socket,
      };
      this.roomsBySocket.set(socket, room);
      this.send(socket, { type: 'room-registered', roomId: room.id });
      return;
    }

    if (message.type === 'torrent-open-result') {
      const pending = this.pendingCommands.get(message.commandId);
      if (!pending || pending.socket !== socket) return;
      clearTimeout(pending.timer);
      this.pendingCommands.delete(message.commandId);
      pending.resolve({
        accepted: message.accepted === true,
        message:
          typeof message.message === 'string' && message.message.length <= 512
            ? message.message
            : message.accepted === true
              ? 'Torrent sent to the room.'
              : 'The room rejected the torrent.',
      });
    }
  }

  listRooms() {
    return [...this.roomsBySocket.values()]
      .filter(({ socket }) => socket.readyState === 1)
      .map(({ id, roomName, participantIdentity, connectedAt }) => ({
        id,
        roomName,
        participantIdentity,
        connectedAt,
      }))
      .sort((left, right) => left.roomName.localeCompare(right.roomName));
  }

  openTorrent(roomId, input) {
    const room = [...this.roomsBySocket.values()].find(
      (candidate) => candidate.id === roomId && candidate.socket.readyState === 1,
    );
    if (!room) return Promise.reject(new Error('The selected room is no longer connected.'));

    const commandId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error('The room did not acknowledge the torrent command.'));
      }, this.commandTimeoutMs);
      this.pendingCommands.set(commandId, { socket: room.socket, resolve, reject, timer });
      this.send(room.socket, { type: 'torrent-open', commandId, input });
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

module.exports = { RoomRegistry, validLabel };
