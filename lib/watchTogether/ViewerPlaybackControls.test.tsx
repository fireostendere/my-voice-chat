import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UrlPlayer } from './UrlPlayer';
import { YouTubePlayer } from './YouTubePlayer';

const subscribe = () => () => undefined;

describe('cinema viewer playback controls', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes native video controls and pointer input from viewers', () => {
    const { container, rerender, unmount } = render(
      <UrlPlayer
        src="https://media.example.com/movie.mp4"
        hostIdentity="host"
        isHost={false}
        sendSync={() => undefined}
        subscribe={subscribe}
      />,
    );

    const viewerVideo = container.querySelector('video')!;
    expect(viewerVideo.controls).toBe(false);
    expect(viewerVideo.tabIndex).toBe(-1);
    expect(viewerVideo.classList).toContain('lk-watch-together-viewer-media');

    rerender(
      <UrlPlayer
        src="https://media.example.com/movie.mp4"
        hostIdentity="host"
        isHost
        sendSync={() => undefined}
        subscribe={subscribe}
      />,
    );
    const hostVideo = container.querySelector('video')!;
    expect(hostVideo.controls).toBe(true);
    expect(hostVideo.tabIndex).toBe(0);
    expect(hostVideo.classList).not.toContain('lk-watch-together-viewer-media');
    unmount();
  });

  it('hides YouTube controls and shields the iframe for viewers', async () => {
    class FakePlayer {
      constructor(_iframe: HTMLIFrameElement, options: { events: { onReady: () => void } }) {
        queueMicrotask(options.events.onReady);
      }

      destroy() {}
    }
    window.YT = {
      Player: FakePlayer,
      PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
    };

    const { container, unmount } = render(
      <YouTubePlayer
        videoId="abcdefghijk"
        hostIdentity="host"
        isHost={false}
        sendSync={() => undefined}
        subscribe={subscribe}
      />,
    );

    const iframe = container.querySelector('iframe')!;
    const source = new URL(iframe.src);
    expect(source.searchParams.get('controls')).toBe('0');
    expect(source.searchParams.get('disablekb')).toBe('1');
    expect(source.searchParams.get('fs')).toBe('0');
    expect(iframe.title).toBe('YouTube video player');
    expect(iframe.tabIndex).toBe(-1);
    expect(iframe.inert).toBe(true);
    expect(iframe.allowFullscreen).toBe(false);
    expect(iframe.allow).not.toContain('picture-in-picture');
    expect(iframe.classList).toContain('lk-watch-together-viewer-media');
    expect(container.querySelector('.lk-watch-together-viewer-shield')).not.toBeNull();
    unmount();
  });
});
