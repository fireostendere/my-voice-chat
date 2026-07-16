'use client';

import React, { useEffect, useState } from 'react';
import styles from '../styles/CompanionDownloadLink.module.css';

declare global {
  interface Window {
    __LIVEKIT_COMPANION__?: true | { host: 'webview2'; platform: 'windows'; version: number };
  }
}

export function CompanionDownloadLink({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const [runningInCompanion, setRunningInCompanion] = useState(false);

  useEffect(() => {
    const nativeHost = window.__LIVEKIT_COMPANION__;
    setRunningInCompanion(
      nativeHost === true ||
        nativeHost?.host === 'webview2' ||
        navigator.userAgent.includes('LiveKitCompanion/'),
    );
  }, []);

  if (runningInCompanion) return null;

  return (
    <a
      className={[styles.link, compact ? styles.compact : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      href="/api/companion/download"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18h14" />
      </svg>
      <span>
        <small>WINDOWS .EXE</small>
        <strong>Download companion</strong>
      </span>
    </a>
  );
}
