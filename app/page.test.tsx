import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const { push, replace, params } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: { tab: '' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => ({ get: () => params.tab }),
}));
vi.mock('@/lib/CompanionDownloadLink', () => ({
  CompanionDownloadLink: () => <a href="/api/companion/download">Download companion</a>,
}));

beforeEach(() => {
  push.mockClear();
  params.tab = '';
});

describe('voice-room launcher', () => {
  it('creates an encrypted room and preserves the key in its fragment', () => {
    render(<Page />);
    fireEvent.click(screen.getByLabelText('End-to-end encryption'));
    fireEvent.change(screen.getByLabelText('Shared passphrase'), {
      target: { value: 'friends & movies' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /Create voice room/ }).closest('form')!);
    expect(push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/rooms\/[a-z0-9]{4}-[a-z0-9]{4}#friends%20%26%20movies$/),
    );
  });

  it('joins by name and rejects invitations from another site', () => {
    render(<Page />);
    const field = screen.getByLabelText('Room link or name');
    fireEvent.change(field, { target: { value: 'https://other.example/rooms/friends' } });
    fireEvent.submit(field.closest('form')!);
    expect(screen.getByRole('alert').textContent).toContain('from this site');
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'friends' } });
    fireEvent.submit(field.closest('form')!);
    expect(push).toHaveBeenCalledWith('/rooms/friends');
  });

  it('keeps custom server and token connections available', () => {
    params.tab = 'custom';
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'wss://server.example' },
    });
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'my-token' } });
    fireEvent.submit(screen.getByLabelText('Access token').closest('form')!);
    const url = new URL(push.mock.calls[0][0], 'https://chat.example');
    expect(url.pathname).toBe('/custom');
    expect(url.searchParams.get('liveKitUrl')).toBe('wss://server.example');
    expect(url.searchParams.get('token')).toBe('my-token');
  });
});
