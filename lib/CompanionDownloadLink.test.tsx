import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanionDownloadLink } from './CompanionDownloadLink';

afterEach(() => {
  delete window.__LIVEKIT_COMPANION__;
});

describe('CompanionDownloadLink', () => {
  it('shows the installer link in a regular browser', () => {
    render(<CompanionDownloadLink />);

    expect(screen.getByRole('link', { name: /download companion/i })).not.toBeNull();
  });

  it('hides the installer link inside the desktop client', async () => {
    window.__LIVEKIT_COMPANION__ = { host: 'webview2', platform: 'windows', version: 1 };
    render(<CompanionDownloadLink />);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /download companion/i })).toBeNull();
    });
  });
});
