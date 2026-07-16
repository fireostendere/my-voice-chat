import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVkVideoPlayer, VK_PLAYER_ORIGIN } from './vkVideoPlayerApi';

const iframes: HTMLIFrameElement[] = [];

afterEach(() => {
  iframes.splice(0).forEach((iframe) => iframe.remove());
});

describe('VK Video Player adapter', () => {
  it('queues commands until a trusted inited event and tracks playback state', () => {
    const iframe = createIframe();
    const postMessage = vi
      .spyOn(iframe.contentWindow!, 'postMessage')
      .mockImplementation(() => undefined);
    const player = createVkVideoPlayer(iframe);
    const onInited = vi.fn();
    player.on('inited', onInited);

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenLastCalledWith({ method: 'init' }, VK_PLAYER_ORIGIN);
    iframe.dispatchEvent(new Event('load'));
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith({ method: 'init' }, VK_PLAYER_ORIGIN);
    player.play();
    player.seek(12.5);
    expect(postMessage).toHaveBeenCalledTimes(2);

    dispatchPlayerEvent(iframe, 'https://evil.test', {
      event: 'inited',
      state: 'unstarted',
      time: 0,
      duration: 100,
    });
    expect(onInited).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(2);

    dispatchPlayerEvent(iframe, VK_PLAYER_ORIGIN, {
      event: 'inited',
      state: 'unstarted',
      time: 0,
      duration: 100,
    });
    expect(onInited).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenNthCalledWith(3, { method: 'play' }, VK_PLAYER_ORIGIN);
    expect(postMessage).toHaveBeenNthCalledWith(
      4,
      { method: 'seek', time: 12.5 },
      VK_PLAYER_ORIGIN,
    );

    dispatchPlayerEvent(iframe, VK_PLAYER_ORIGIN, {
      event: 'started',
      state: 'playing',
      time: 12.5,
      duration: 100,
    });
    expect(player.getState()).toBe('playing');
    expect(player.getCurrentTime()).toBe(12.5);
    expect(player.getDuration()).toBe(100);
    player.destroy();
  });

  it('rejects spoofed sources and malformed event state, then removes its listener', () => {
    const iframe = createIframe();
    const otherIframe = createIframe();
    vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const player = createVkVideoPlayer(iframe);
    const onPaused = vi.fn();
    player.on('paused', onPaused);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: VK_PLAYER_ORIGIN,
        source: otherIframe.contentWindow,
        data: { event: 'paused', state: 'paused', time: 5 },
      }),
    );
    dispatchPlayerEvent(iframe, VK_PLAYER_ORIGIN, {
      event: 'paused',
      state: 'paused',
      time: -1,
    });
    expect(onPaused).not.toHaveBeenCalled();

    player.destroy();
    dispatchPlayerEvent(iframe, VK_PLAYER_ORIGIN, {
      event: 'paused',
      state: 'paused',
      time: 5,
    });
    expect(onPaused).not.toHaveBeenCalled();
  });

  it('rejects a non-VK iframe even when it has a js_api query', () => {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://evil.test/video_ext.php?js_api=1';
    document.body.appendChild(iframe);
    iframes.push(iframe);

    expect(() => createVkVideoPlayer(iframe)).toThrow(/trusted VK Video embed/);
  });
});

function createIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = 'https://vk.ru/video_ext.php?oid=-10&id=20&js_api=1';
  document.body.appendChild(iframe);
  iframes.push(iframe);
  return iframe;
}

function dispatchPlayerEvent(
  iframe: HTMLIFrameElement,
  origin: string,
  data: Record<string, unknown>,
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: iframe.contentWindow,
      data,
    }),
  );
}
