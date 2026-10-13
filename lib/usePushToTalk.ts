import React from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { LocalTrackPublication, Room } from 'livekit-client';
import { getPushToTalkWsUrl } from './companion';

export type PushToTalkState = {
  /** True once connected to the local companion app. */
  connected: boolean;
  /** True while the push-to-talk key is held (mic open). */
  talking: boolean;
  /** A previously connected companion is being recovered; the mic stays muted. */
  interrupted?: boolean;
};

/**
 * Bridges the local push-to-talk companion app to the LiveKit room.
 *
 * The companion captures a global key (works even when the browser is not the
 * focused window) and relays `down`/`up` events over a localhost WebSocket.
 * While connected we treat the call as walkie-talkie: the mic is muted and only
 * opened while the key is held.
 *
 * Configure the endpoint with `NEXT_PUBLIC_PTT_WS_URL`; set it to an empty
 * string to disable the companion entirely.
 */
export function usePushToTalk(room: Room): PushToTalkState {
  const [connected, setConnected] = React.useState(false);
  const [talking, setTalking] = React.useState(false);
  const [interrupted, setInterrupted] = React.useState(false);

  React.useEffect(() => {
    setConnected(false);
    setTalking(false);
    setInterrupted(false);
    const url = getPushToTalkWsUrl();
    if (!url) {
      return;
    }

    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let wsConnected = false;
    let keyHeld = false;
    let everConnected = false;

    const setMic = (on: boolean) => {
      room.localParticipant
        .setMicrophoneEnabled(on)
        .then(() => {
          // Key release can arrive while the first microphone capture is pending.
          if (on && (disposed || !wsConnected || !keyHeld)) {
            return room.localParticipant.setMicrophoneEnabled(false);
          }
        })
        .catch((err) => {
          if (!disposed) setTalking(false);
          console.error('Push-to-talk failed to toggle microphone', err);
        });
    };

    // The join flow enables the mic right after connecting; if the companion
    // socket opens before that, its initial mute would lose the race and the
    // mic would stay hot. Re-assert walkie-talkie mute whenever a mic track
    // gets published while the key is up.
    const onLocalTrackPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Microphone && everConnected && !keyHeld) {
        setMic(false);
      }
    };
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);

    const connect = () => {
      if (disposed) {
        return;
      }
      try {
        ws = new WebSocket(url);
      } catch {
        retryTimer = setTimeout(connect, 3000);
        return;
      }

      const socket = ws;
      ws.onopen = () => {
        if (disposed || ws !== socket) return;
        wsConnected = true;
        everConnected = true;
        keyHeld = false;
        setConnected(true);
        setInterrupted(false);
        // Walkie-talkie mode: start muted, open only while the key is held.
        setMic(false);
      };
      ws.onmessage = (event) => {
        let msg: unknown;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (
          !wsConnected ||
          ws !== socket ||
          disposed ||
          !msg ||
          typeof msg !== 'object' ||
          !('type' in msg) ||
          msg.type !== 'ptt' ||
          !('state' in msg) ||
          (msg.state !== 'down' && msg.state !== 'up')
        ) {
          return;
        }
        const open = msg.state === 'down';
        keyHeld = open;
        setTalking(open);
        setMic(open);
      };
      ws.onclose = () => {
        if (disposed || ws !== socket) return;
        wsConnected = false;
        keyHeld = false;
        if (everConnected) setMic(false);
        setConnected(false);
        setTalking(false);
        setInterrupted(everConnected);
        if (!disposed) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      wsConnected = false;
      keyHeld = false;
      if (everConnected) setMic(false);
    };
  }, [room]);

  return { connected, talking, interrupted };
}
