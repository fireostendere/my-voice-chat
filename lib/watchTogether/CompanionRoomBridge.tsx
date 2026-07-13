'use client';
import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { getCompanionWsUrl } from '../companion';
import {
  parseCompanionPlaybackCommand,
  parseCompanionTorrentCommand,
} from './companionRoomProtocol';
import { useWatchTogether } from './WatchTogetherContext';
import type { StreamPlaybackState } from './types';

const RECONNECT_DELAY_MS = 3000;

export function CompanionRoomBridge() {
  const room = useRoomContext();
  const { embed, startTorrent, streamPlayback, controlStream } = useWatchTogether();
  const embedRef = React.useRef(embed);
  const startTorrentRef = React.useRef(startTorrent);
  const streamPlaybackRef = React.useRef(streamPlayback);
  const controlStreamRef = React.useRef(controlStream);
  const socketRef = React.useRef<WebSocket | null>(null);
  embedRef.current = embed;
  startTorrentRef.current = startTorrent;
  streamPlaybackRef.current = streamPlayback;
  controlStreamRef.current = controlStream;

  React.useEffect(() => {
    sendPlaybackState(socketRef.current, streamPlayback);
  }, [streamPlayback]);

  React.useEffect(() => {
    const wsUrl = getCompanionWsUrl();
    const roomName = room.name;
    const participantIdentity = room.localParticipant.identity;
    if (!wsUrl || !roomName || !participantIdentity) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const reply = (type: string, commandId: string, accepted: boolean, message: string) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type, commandId, accepted, message }));
    };

    const handleMessage = async (value: unknown) => {
      const torrentCommand = parseCompanionTorrentCommand(value);
      if (torrentCommand) {
        if (embedRef.current.active && !embedRef.current.isHost) {
          reply(
            'torrent-open-result',
            torrentCommand.commandId,
            false,
            'Another participant controls cinema in this room.',
          );
          return;
        }
        try {
          startTorrentRef.current(torrentCommand.input);
          reply(
            'torrent-open-result',
            torrentCommand.commandId,
            true,
            `Torrent started in ${roomName}.`,
          );
        } catch (error) {
          reply(
            'torrent-open-result',
            torrentCommand.commandId,
            false,
            error instanceof Error ? error.message : 'Could not start the torrent.',
          );
        }
        return;
      }

      const playbackCommand = parseCompanionPlaybackCommand(value);
      if (!playbackCommand) return;
      try {
        await controlStreamRef.current(playbackCommand.control);
        reply(
          'playback-control-result',
          playbackCommand.commandId,
          true,
          playbackCommand.control.action === 'stop'
            ? 'Playback stopped.'
            : 'Playback control applied.',
        );
      } catch (error) {
        reply(
          'playback-control-result',
          playbackCommand.commandId,
          false,
          error instanceof Error ? error.message : 'Could not control playback.',
        );
      }
    };

    const connect = () => {
      if (stopped) return;
      let connection: WebSocket;
      try {
        connection = new WebSocket(wsUrl);
      } catch {
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      socket = connection;
      socketRef.current = connection;
      connection.onopen = () => {
        connection.send(JSON.stringify({ type: 'room-register', roomName, participantIdentity }));
        sendPlaybackState(connection, streamPlaybackRef.current);
      };
      connection.onmessage = (event) => {
        let value: unknown;
        try {
          value = JSON.parse(String(event.data));
        } catch {
          return;
        }
        void handleMessage(value);
      };
      connection.onclose = () => {
        if (socketRef.current === connection) socketRef.current = null;
        if (socket === connection) socket = null;
        if (!stopped) reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socketRef.current = null;
      socket?.close();
    };
  }, [room]);

  return null;
}

function sendPlaybackState(socket: WebSocket | null, playback: StreamPlaybackState) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'room-playback-state', playback }));
}
