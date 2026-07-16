'use client';
import * as React from 'react';
import { useWatchTogether } from './WatchTogetherContext';
import { UrlPlayer } from './UrlPlayer';
import { YouTubePlayer } from './YouTubePlayer';
import { VkPlayer } from './VkPlayer';

export function EmbedTile() {
  const { embed, stopEmbed, sendSync, subscribe } = useWatchTogether();
  const tileRef = React.useRef<HTMLDivElement>(null);
  if (!embed.active) return null;

  const enterFullscreen = () => {
    tileRef.current?.requestFullscreen?.().catch((error) => {
      console.warn('Could not enter cinema fullscreen mode', error);
    });
  };

  return (
    <div ref={tileRef} className="lk-watch-together-tile">
      {embed.kind === 'youtube' ? (
        <YouTubePlayer
          videoId={embed.src}
          hostIdentity={embed.hostIdentity}
          isHost={embed.isHost}
          sendSync={sendSync}
          subscribe={subscribe}
        />
      ) : embed.kind === 'vk' ? (
        <VkPlayer
          videoId={embed.src}
          hostIdentity={embed.hostIdentity}
          isHost={embed.isHost}
          sendSync={sendSync}
          subscribe={subscribe}
        />
      ) : (
        <UrlPlayer
          src={embed.src}
          hostIdentity={embed.hostIdentity}
          isHost={embed.isHost}
          sendSync={sendSync}
          subscribe={subscribe}
        />
      )}
      <div className="lk-watch-together-overlay">
        <span className="lk-watch-together-source">
          <span className="lk-cinema-live-dot" />
          {embed.kind === 'youtube'
            ? 'YouTube'
            : embed.kind === 'vk'
              ? 'VK Video'
              : 'Direct stream'}
        </span>
        <span className="lk-watch-together-role">
          {embed.isHost ? 'You control playback' : `Host: ${embed.hostIdentity}`}
        </span>
        <button
          type="button"
          className="lk-button lk-watch-together-action"
          onClick={enterFullscreen}
          title="Fullscreen"
        >
          ⛶
        </button>
        {embed.isHost && (
          <button type="button" className="lk-button lk-watch-together-stop" onClick={stopEmbed}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
