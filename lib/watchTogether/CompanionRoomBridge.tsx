'use client';
import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { getCompanionWsUrl } from '../companion';
import { parseCompanionTorrentCommand } from './companionRoomProtocol';
import { useWatchTogether } from './WatchTogetherContext';

const RECONNECT_DELAY_MS = 3000;

export function CompanionRoomBridge() {
  const room = useRoomContext();
  const { embed, startTorrent } = useWatchTogether();
  const embedRef = React.useRef(embed);
  const startTorrentRef = React.useRef(startTorrent);
  embedRef.current = embed;
  startTorrentRef.current = startTorrent;

  React.useEffect(() => {
    const wsUrl = getCompanionWsUrl();
    const roomName = room.name;
    const participantIdentity = room.localParticipant.identity;
    if (!wsUrl || !roomName || !participantIdentity) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const reply = (commandId: string, accepted: boolean, message: string) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'torrent-open-result', commandId, accepted, message }));
    };

    const connect = () => {
      if (stopped) return;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'room-register', roomName, participantIdentity }));
      };
      socket.onmessage = (event) => {
        let value: unknown;
        try {
          value = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const command = parseCompanionTorrentCommand(value);
        if (!command) return;
        if (embedRef.current.active && !embedRef.current.isHost) {
          reply(command.commandId, false, 'Another participant controls cinema in this room.');
          return;
        }
        try {
          startTorrentRef.current(command.input);
          reply(command.commandId, true, `Torrent started in ${roomName}.`);
        } catch (error) {
          reply(
            command.commandId,
            false,
            error instanceof Error ? error.message : 'Could not start the torrent.',
          );
        }
      };
      socket.onclose = () => {
        socket = null;
        if (!stopped) reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [room]);

  return null;
}
