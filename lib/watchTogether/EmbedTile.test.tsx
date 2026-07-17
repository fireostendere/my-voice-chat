import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedTile } from './EmbedTile';
import { useWatchTogether } from './WatchTogetherContext';

vi.mock('./WatchTogetherContext', () => ({ useWatchTogether: vi.fn() }));
vi.mock('./UrlPlayer', () => ({ UrlPlayer: () => <div>Direct player</div> }));
vi.mock('./YouTubePlayer', () => ({ YouTubePlayer: () => <div>YouTube player</div> }));
vi.mock('./VkPlayer', () => ({ VkPlayer: () => <div>VK player</div> }));

const useWatchTogetherMock = vi.mocked(useWatchTogether);

beforeEach(() => {
  useWatchTogetherMock.mockReset();
});

describe('EmbedTile controls', () => {
  it('does not expose playback actions to viewers', () => {
    useWatchTogetherMock.mockReturnValue(contextValue(false));
    render(<EmbedTile />);

    expect(screen.queryByTitle('Fullscreen')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByText('Host: host')).not.toBeNull();
  });

  it('keeps fullscreen and stop actions for the participant who started playback', () => {
    useWatchTogetherMock.mockReturnValue(contextValue(true));
    render(<EmbedTile />);

    expect(screen.getByTitle('Fullscreen')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).not.toBeNull();
    expect(screen.getByText('You control playback')).not.toBeNull();
  });
});

function contextValue(isHost: boolean): ReturnType<typeof useWatchTogether> {
  return {
    embed: {
      active: true,
      kind: 'url',
      src: 'https://media.example.com/movie.mp4',
      hostIdentity: 'host',
      isHost,
    },
    stopEmbed: vi.fn(),
    sendSync: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as ReturnType<typeof useWatchTogether>;
}
