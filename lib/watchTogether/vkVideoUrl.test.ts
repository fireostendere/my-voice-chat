import { describe, expect, it } from 'vitest';
import {
  buildVkEmbedUrl,
  isVkVideoSource,
  parseVkVideoSource,
  parseVkVideoUrl,
} from './vkVideoUrl';

describe('VK Video URL helpers', () => {
  it('preserves an explicit access key but drops untrusted player parameters', () => {
    const source = parseVkVideoUrl(
      new URL(
        'https://www.vk.com/video_ext.php?oid=-10&id=20&hash=abc_DEF-123&origin=https://evil.test&js_api=0&autoplay=1',
      ),
    );

    expect(source).toBe('-10_20_abc_DEF-123');
    const embedUrl = buildVkEmbedUrl(source!, 'https://meet.example.com');
    const embed = new URL(embedUrl!);
    expect(embed.origin).toBe('https://vk.ru');
    expect(embed.pathname).toBe('/video_ext.php');
    expect(Object.fromEntries(embed.searchParams)).toEqual({
      oid: '-10',
      id: '20',
      hash: 'abc_DEF-123',
      js_api: '1',
      origin: 'https://meet.example.com',
    });
  });

  it('omits an invalid or opaque parent origin from the embed URL', () => {
    expect(new URL(buildVkEmbedUrl('-10_20', 'null')!).searchParams.has('origin')).toBe(false);
    expect(
      new URL(buildVkEmbedUrl('-10_20', 'https://meet.example.com/path')!).searchParams.has(
        'origin',
      ),
    ).toBe(false);
  });

  it('parses and validates compact data-channel sources', () => {
    expect(parseVkVideoSource('-10_20_abc_DEF-123')).toEqual({
      ownerId: '-10',
      videoId: '20',
      accessKey: 'abc_DEF-123',
    });
    expect(isVkVideoSource('10_20')).toBe(true);
    expect(isVkVideoSource('-0_20')).toBe(false);
    expect(isVkVideoSource('https://vk.ru/video-10_20')).toBe(false);
  });
});
