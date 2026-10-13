import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState } from 'livekit-client';
import { RoomToolbar } from './RoomToolbar';

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ name: 'friends' }),
  useConnectionState: () => ConnectionState.Connected,
  useParticipants: () => [{ identity: 'me' }, { identity: 'friend' }],
}));

afterEach(() => window.history.replaceState({}, '', '/'));

describe('room invitation', () => {
  it.each(['/rooms/friends', '/friends'])(
    'copies the full invitation at %s, including room options and encryption',
    async (pathname) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      window.history.replaceState({}, '', `${pathname}?codec=vp8#secret`);
      render(<RoomToolbar />);
      expect(screen.getByRole('status').textContent).toContain('2 in room');
      fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    },
  );

  it('never copies a custom participant token as a shared invitation', () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    window.history.replaceState({}, '', '/custom?token=secret');
    render(<RoomToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(writeText).not.toHaveBeenCalled();
  });
});
