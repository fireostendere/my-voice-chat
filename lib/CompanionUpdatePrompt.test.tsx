import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanionUpdatePrompt } from './CompanionUpdatePrompt';

afterEach(() => {
  delete window.__LIVEKIT_COMPANION__;
  sessionStorage.clear();
});

describe('CompanionUpdatePrompt', () => {
  it('offers the installer when the installed app is older', async () => {
    window.__LIVEKIT_COMPANION__ = {
      host: 'webview2',
      platform: 'windows',
      version: 1,
      appVersion: '0.7.0',
    };

    render(<CompanionUpdatePrompt latestVersion="0.8.0" />);

    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(screen.getByText(/you have 0\.7\.0/i)).not.toBeNull();
    expect(screen.getByRole('link', { name: /download update/i }).getAttribute('href')).toBe(
      '/api/companion/download',
    );
  });

  it('stays hidden when the installed app is current or newer', async () => {
    window.__LIVEKIT_COMPANION__ = {
      host: 'webview2',
      platform: 'windows',
      version: 1,
      appVersion: '0.8.0',
    };

    render(<CompanionUpdatePrompt latestVersion="0.8.0" />);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('offers an update to a legacy app without a reported version', async () => {
    window.__LIVEKIT_COMPANION__ = { host: 'webview2', platform: 'windows', version: 1 };

    render(<CompanionUpdatePrompt latestVersion="0.8.0" />);

    expect(await screen.findByText(/installed version needs to be refreshed/i)).not.toBeNull();
  });

  it('remembers a dismissal for the current browser session', async () => {
    window.__LIVEKIT_COMPANION__ = {
      host: 'webview2',
      platform: 'windows',
      version: 1,
      appVersion: '0.7.0',
    };
    const firstRender = render(<CompanionUpdatePrompt latestVersion="0.8.0" />);
    fireEvent.click(await screen.findByRole('button', { name: /not now/i }));
    expect(screen.queryByRole('dialog')).toBeNull();

    firstRender.unmount();
    render(<CompanionUpdatePrompt latestVersion="0.8.0" />);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
