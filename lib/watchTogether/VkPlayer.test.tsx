import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS, type WatchSyncMessage } from './types';
import { VkPlayer } from './VkPlayer';
import { VK_PLAYER_ORIGIN } from './vkVideoPlayerApi';

afterEach(() => {
  vi.useRealTimers();
});

describe('VkPlayer', () => {
  it('creates a credentialless VK iframe and broadcasts host playback', () => {
    vi.useFakeTimers();
    const sendSync = vi.fn();
    const { container, unmount } = render(
      <VkPlayer
        videoId="-176915579_456248111"
        hostIdentity="host"
        isHost
        sendSync={sendSync}
        subscribe={() => () => undefined}
      />,
    );
    const iframe = container.querySelector('iframe')!;
    vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined);

    expect(iframe.getAttribute('credentialless')).toBe('');
    expect(iframe.allow).toContain('autoplay');
    expect(iframe.allowFullscreen).toBe(true);
    const embedUrl = new URL(iframe.src);
    expect(embedUrl.origin).toBe(VK_PLAYER_ORIGIN);
    expect(embedUrl.searchParams.get('oid')).toBe('-176915579');
    expect(embedUrl.searchParams.get('id')).toBe('456248111');
    expect(embedUrl.searchParams.get('js_api')).toBe('1');

    dispatchPlayerEvent(iframe, {
      event: 'inited',
      state: 'unstarted',
      time: 0,
      duration: 100,
    });
    dispatchPlayerEvent(iframe, {
      event: 'started',
      state: 'playing',
      time: 3,
      duration: 100,
    });
    expect(sendSync).toHaveBeenCalledWith({ type: 'play', currentTime: 3, ts: expect.any(Number) });

    act(() => vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS));
    expect(sendSync).toHaveBeenCalledWith({
      type: 'heartbeat',
      kind: 'vk',
      src: '-176915579_456248111',
      hostIdentity: 'host',
      currentTime: 3,
      isPlaying: true,
      ts: expect.any(Number),
    });

    unmount();
    const callsAtUnmount = sendSync.mock.calls.length;
    act(() => vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS));
    expect(sendSync).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it('applies viewer sync commands and exposes the autoplay gesture fallback', () => {
    let listener: ((message: WatchSyncMessage) => void) | undefined;
    const subscribe = vi.fn((next: (message: WatchSyncMessage) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    });
    const { container } = render(
      <VkPlayer
        videoId="-176915579_456248111"
        hostIdentity="host"
        isHost={false}
        sendSync={() => undefined}
        subscribe={subscribe}
      />,
    );
    const iframe = container.querySelector('iframe')!;
    const postMessage = vi
      .spyOn(iframe.contentWindow!, 'postMessage')
      .mockImplementation(() => undefined);
    dispatchPlayerEvent(iframe, {
      event: 'inited',
      state: 'paused',
      time: 0,
      duration: 100,
    });
    expect(listener).toBeTypeOf('function');

    act(() => {
      listener?.({ type: 'play', currentTime: 12, ts: 1 });
    });
    expect(postMessage).toHaveBeenCalledWith({ method: 'seek', time: 12 }, VK_PLAYER_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith({ method: 'play' }, VK_PLAYER_ORIGIN);

    dispatchPlayerEvent(iframe, {
      event: 'autoplaySoundProhibited',
      state: 'paused',
      time: 12,
      duration: 100,
    });
    fireEvent.click(screen.getByRole('button', { name: /start playback/i }));
    expect(postMessage).toHaveBeenLastCalledWith({ method: 'play' }, VK_PLAYER_ORIGIN);
  });

  it('does not create an iframe for an invalid data-channel source', () => {
    const { container } = render(
      <VkPlayer
        videoId="https://evil.test/video"
        hostIdentity="host"
        isHost={false}
        sendSync={() => undefined}
        subscribe={() => () => undefined}
      />,
    );

    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText(/VK Video link is invalid/i)).not.toBeNull();
  });
});

function dispatchPlayerEvent(iframe: HTMLIFrameElement, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: VK_PLAYER_ORIGIN,
        source: iframe.contentWindow,
        data,
      }),
    );
  });
}
