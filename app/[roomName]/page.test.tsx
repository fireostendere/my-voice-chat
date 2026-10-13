import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoomPage from '../rooms/[roomName]/page';
import Page from './page';

vi.mock('../rooms/[roomName]/page', () => ({ default: vi.fn().mockResolvedValue(null) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

beforeEach(() => vi.mocked(RoomPage).mockClear());

describe('short room route', () => {
  it('uses the existing managed room page with the same name and options', async () => {
    const props = {
      params: Promise.resolve({ roomName: 'dota' }),
      searchParams: Promise.resolve({ codec: 'vp8', hq: 'true', singlePC: 'false' }),
    };
    await Page(props);
    expect(RoomPage).toHaveBeenCalledWith(props);
  });

  it('keeps reserved paths out of the room flow', async () => {
    await expect(
      Page({ params: Promise.resolve({ roomName: 'api' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NOT_FOUND');
    expect(RoomPage).not.toHaveBeenCalled();
  });
});
