'use client';
import * as React from 'react';
import { GestureOverlay } from './GestureOverlay';
import { DRIFT_TOLERANCE_S, HEARTBEAT_INTERVAL_MS, type WatchSyncMessage } from './types';
import { buildVkEmbedUrl } from './vkVideoUrl';
import { createVkVideoPlayer, type VkVideoPlayerApi } from './vkVideoPlayerApi';

type Props = {
  videoId: string;
  hostIdentity: string;
  isHost: boolean;
  sendSync: (msg: WatchSyncMessage) => void;
  subscribe: (listener: (msg: WatchSyncMessage) => void) => () => void;
};

export function VkPlayer({ videoId, hostIdentity, isHost, sendSync, subscribe }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<VkVideoPlayerApi | null>(null);
  const sendSyncRef = React.useRef(sendSync);
  sendSyncRef.current = sendSync;
  const lastSyncTimeRef = React.useRef(0);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [shouldPlay, setShouldPlay] = React.useState(false);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError(null);
    setReady(false);
    setPlaying(false);
    setShouldPlay(false);
    const embedUrl = buildVkEmbedUrl(videoId, window.location.origin);
    if (!embedUrl) {
      setError('The VK Video link is invalid.');
      return;
    }

    let cancelled = false;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('credentialless', '');
    (iframe as HTMLIFrameElement & { credentialless: boolean }).credentialless = true;
    iframe.src = embedUrl;
    iframe.title = 'VK Video player';
    iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    container.appendChild(iframe);

    let player: VkVideoPlayerApi;
    try {
      player = createVkVideoPlayer(iframe);
    } catch (caught) {
      iframe.remove();
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    playerRef.current = player;

    player.on('inited', () => {
      if (cancelled) return;
      setReady(true);
      setError(null);
    });
    const onPlaying = () => {
      if (cancelled) return;
      setPlaying(true);
      if (isHost) {
        sendSyncRef.current({
          type: 'play',
          currentTime: player.getCurrentTime(),
          ts: Date.now(),
        });
      }
    };
    player.on('started', onPlaying);
    player.on('resumed', onPlaying);
    player.on('paused', () => {
      if (cancelled) return;
      setPlaying(false);
      if (isHost) {
        sendSyncRef.current({
          type: 'pause',
          currentTime: player.getCurrentTime(),
          ts: Date.now(),
        });
      }
    });
    player.on('seeked', () => {
      if (cancelled || !isHost) return;
      sendSyncRef.current({
        type: 'seek',
        currentTime: player.getCurrentTime(),
        ts: Date.now(),
      });
    });
    player.on('ended', () => {
      if (!cancelled) setPlaying(false);
    });
    player.on('autoplaySoundProhibited', () => {
      if (!cancelled && !isHost) setShouldPlay(true);
    });
    player.on('error', (event) => {
      if (cancelled) return;
      setPlaying(false);
      setError(`VK Video could not play this video (error ${event.errorCode}).`);
    });

    return () => {
      cancelled = true;
      player.destroy();
      playerRef.current = null;
      iframe.remove();
      setReady(false);
      setPlaying(false);
      setShouldPlay(false);
    };
  }, [videoId, isHost]);

  React.useEffect(() => {
    if (!ready || isHost) return;
    return subscribe((message) => {
      const player = playerRef.current;
      if (!player) return;
      const currentTime = player.getCurrentTime();
      if (message.type === 'play') {
        if (Math.abs(currentTime - message.currentTime) > DRIFT_TOLERANCE_S) {
          player.seek(message.currentTime);
        }
        lastSyncTimeRef.current = message.currentTime;
        setShouldPlay(true);
        player.play();
      } else if (message.type === 'pause') {
        player.pause();
        if (Math.abs(currentTime - message.currentTime) > DRIFT_TOLERANCE_S) {
          player.seek(message.currentTime);
        }
        lastSyncTimeRef.current = message.currentTime;
        setShouldPlay(false);
      } else if (message.type === 'seek') {
        player.seek(message.currentTime);
        lastSyncTimeRef.current = message.currentTime;
      } else if (message.type === 'heartbeat') {
        if (Math.abs(currentTime - message.currentTime) > DRIFT_TOLERANCE_S) {
          player.seek(message.currentTime);
        }
        lastSyncTimeRef.current = message.currentTime;
        setShouldPlay(message.isPlaying);
        const isPlaying = player.getState() === 'playing';
        if (message.isPlaying && !isPlaying) player.play();
        if (!message.isPlaying && isPlaying) player.pause();
      }
    });
  }, [ready, isHost, subscribe]);

  React.useEffect(() => {
    if (!ready || !isHost) return;
    const heartbeat = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      sendSyncRef.current({
        type: 'heartbeat',
        kind: 'vk',
        src: videoId,
        hostIdentity,
        currentTime: player.getCurrentTime(),
        isPlaying: player.getState() === 'playing',
        ts: Date.now(),
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(heartbeat);
  }, [ready, isHost, videoId, hostIdentity]);

  const handleGesture = () => {
    const player = playerRef.current;
    if (!player) return;
    player.seek(lastSyncTimeRef.current);
    player.play();
  };

  const needsGesture = ready && !isHost && shouldPlay && !playing;

  return (
    <div className="lk-watch-together-embed-wrap">
      <div ref={containerRef} className="lk-watch-together-embed-frame" />
      {needsGesture && <GestureOverlay onClick={handleGesture} delayed />}
      {!ready && !error && <div className="lk-watch-together-status">Connecting to VK Video…</div>}
      {error && <div className="lk-watch-together-status lk-watch-together-error">{error}</div>}
    </div>
  );
}
