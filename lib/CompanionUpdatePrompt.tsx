'use client';

import React, { useEffect, useState } from 'react';
import styles from '../styles/CompanionUpdatePrompt.module.css';
import { getCompanionMarker } from './companionMarker';
import { shouldOfferCompanionUpdate } from './companionVersion';

type AvailableUpdate = {
  installedVersion?: string;
};

export function CompanionUpdatePrompt({ latestVersion }: { latestVersion: string }) {
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    const marker = getCompanionMarker();
    if (!marker) return;

    const installedVersion =
      typeof marker.appVersion === 'string' ? marker.appVersion.trim() : undefined;
    if (!shouldOfferCompanionUpdate(latestVersion, installedVersion)) return;

    try {
      if (sessionStorage.getItem(dismissalKey(latestVersion)) === '1') return;
    } catch {
      // The prompt should still work when storage is disabled.
    }
    setAvailableUpdate({ installedVersion });
  }, [latestVersion]);

  if (!availableUpdate) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(dismissalKey(latestVersion), '1');
    } catch {
      // Hiding the current prompt does not depend on storage access.
    }
    setAvailableUpdate(null);
  };

  return (
    <aside
      className={styles.prompt}
      role="dialog"
      aria-live="polite"
      aria-labelledby="companion-update-title"
      aria-describedby="companion-update-description"
    >
      <div className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />
        </svg>
      </div>
      <div className={styles.content}>
        <strong id="companion-update-title">Companion update available</strong>
        <p id="companion-update-description">
          Version {latestVersion} is ready
          {availableUpdate.installedVersion
            ? ` — you have ${availableUpdate.installedVersion}.`
            : '. Your installed version needs to be refreshed.'}
        </p>
        <div className={styles.actions}>
          <a href="/api/companion/download" onClick={dismiss}>
            Download update
          </a>
          <button type="button" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
}

function dismissalKey(latestVersion: string): string {
  return `companion-update-dismissed:${latestVersion}`;
}
