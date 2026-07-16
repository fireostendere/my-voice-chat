import { describe, expect, it } from 'vitest';
import { parseVideoUrl } from './parseVideoUrl';

describe('parseVideoUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtu.be/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('extracts a YouTube id from %s', (url, videoId) => {
    expect(parseVideoUrl(url)).toEqual({ kind: 'youtube', videoId });
  });

  it('accepts a direct video URL without an explicit protocol', () => {
    expect(parseVideoUrl('media.example.com/movie.mp4')).toEqual({
      kind: 'url',
      url: 'https://media.example.com/movie.mp4',
    });
  });

  it.each([
    ['https://vk.com/video-176915579_456248111', '-176915579_456248111'],
    ['vk.ru/video653990375_456241243', '653990375_456241243'],
    ['https://m.vk.com/clip-196847650_456239575?c=1', '-196847650_456239575'],
    ['https://vkvideo.ru/video-229807713_456239871', '-229807713_456239871'],
    ['https://vk.com/feed?z=video-177082369_456239638%2Fpl_cat_updates', '-177082369_456239638'],
    [
      'https://vk.ru/clips-57274055?z=clip-57274055_456239788%2Fclub57274055',
      '-57274055_456239788',
    ],
    [
      'https://vk.ru/video_ext.php?oid=-229807713&id=456239871&hash=f1928d8b1a7a5b11&hd=2',
      '-229807713_456239871_f1928d8b1a7a5b11',
    ],
  ])('normalizes a VK Video URL from %s', (url, videoId) => {
    expect(parseVideoUrl(url)).toEqual({ kind: 'vk', videoId });
  });

  it.each([
    'https://evil@vk.com/video-1_2',
    'https://vk.ru:444/video-1_2',
    'https://vk.ru/video/@channel',
    'https://vk.ru/video-0_2',
    'https://vk.ru/video--1_2',
    'https://vk.ru/video-1_2?z=video-3_4',
    'https://vk.ru/video_ext.php?oid=-1&oid=-2&id=3',
    `https://vk.ru/video_ext.php?oid=-1&id=3&hash=${'x'.repeat(129)}`,
  ])('rejects a malformed or ambiguous VK URL: %s', (url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });

  it.each(['https://vk.com.evil.test/video-1_2', 'https://vkvideo.com/video-1_2'])(
    'does not treat a lookalike domain as VK: %s',
    (url) => expect(parseVideoUrl(url)).toEqual({ kind: 'url', url }),
  );

  it.each([
    'file:///movie.mp4',
    'javascript:alert(1)',
    'not a url',
    '//vk.ru/video-1_2',
    'https://youtube.com/watch',
  ])('rejects an unsupported or malformed URL: %s', (url) => expect(parseVideoUrl(url)).toBeNull());
});
