'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import React, { Suspense, useState } from 'react';
import {
  encodePassphrase,
  generateRoomId,
  randomString,
  roomHrefFromInput,
} from '@/lib/client-utils';
import { CompanionDownloadLink } from '@/lib/CompanionDownloadLink';
import styles from '../styles/Home.module.css';

function RoomLauncher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const custom = searchParams?.get('tab') === 'custom';
  const [e2ee, setE2ee] = useState(false);
  const [passphrase, setPassphrase] = useState(() => randomString(64));
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string>();
  const encryptionHash = e2ee ? `#${encodePassphrase(passphrase)}` : '';

  function createRoom(event: React.FormEvent) {
    event.preventDefault();
    router.push(`/rooms/${generateRoomId()}${encryptionHash}`);
  }

  function joinRoom(event: React.FormEvent) {
    event.preventDefault();
    const href = roomHrefFromInput(invite, window.location.origin);
    if (!href) {
      setError('Paste a room invitation from this site, or enter a room name.');
      return;
    }
    router.push(href);
  }

  function connectCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams({
      liveKitUrl: String(data.get('serverUrl') ?? '').trim(),
      token: String(data.get('token') ?? '').trim(),
    });
    router.push(`/custom?${params}${encryptionHash}`);
  }

  return (
    <section className={styles.launcher} aria-label="Join voice chat">
      <div className={styles.tabs} aria-label="Connection mode">
        <button aria-pressed={!custom} onClick={() => router.replace('/')}>
          Voice room
        </button>
        <button aria-pressed={custom} onClick={() => router.replace('/?tab=custom')}>
          Custom server
        </button>
      </div>

      <form className={styles.createForm} onSubmit={custom ? connectCustom : createRoom}>
        <span className={styles.eyebrow}>{custom ? 'YOUR LIVEKIT SERVER' : 'MAKE SOME ROOM'}</span>
        <h2>{custom ? 'Connect your server' : 'Start a conversation'}</h2>
        <p>
          {custom
            ? 'Use your server address and access token.'
            : 'Create a room, share the link, and talk. Camera is optional.'}
        </p>
        {custom && (
          <>
            <label className={styles.field} htmlFor="serverUrl">
              Server address
              <input
                id="serverUrl"
                name="serverUrl"
                type="url"
                placeholder="wss://your-server.livekit.cloud"
                required
              />
            </label>
            <label className={styles.field} htmlFor="token">
              Access token
              <textarea
                id="token"
                name="token"
                placeholder="Paste your access token"
                rows={3}
                required
                spellCheck={false}
              />
            </label>
          </>
        )}
        <details className={styles.privacy}>
          <summary>Privacy options{e2ee ? ' · encryption on' : ''}</summary>
          <label className={styles.checkbox} htmlFor="use-e2ee">
            <input
              id="use-e2ee"
              type="checkbox"
              checked={e2ee}
              onChange={(event) => setE2ee(event.target.checked)}
            />
            End-to-end encryption
          </label>
          {e2ee && (
            <label className={styles.field} htmlFor="passphrase">
              Shared passphrase
              <input
                id="passphrase"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                required
              />
            </label>
          )}
          <p>
            Share the full invitation to include the encryption key. Encrypted rooms cannot be
            recorded.
          </p>
        </details>
        <button className={styles.primary} type="submit">
          {custom ? 'Connect to server' : 'Create voice room'} <span aria-hidden="true">↗</span>
        </button>
      </form>

      {!custom && (
        <form className={styles.joinForm} onSubmit={joinRoom}>
          <h3>Already have an invitation?</h3>
          <label className={styles.field} htmlFor="room-invite">
            Room link or name
            <input
              id="room-invite"
              value={invite}
              placeholder="Paste an invitation or room name"
              required
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'invite-error' : undefined}
              onChange={(event) => {
                setInvite(event.target.value);
                setError(undefined);
              }}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert" id="invite-error">
              {error}
            </p>
          )}
          <button className={styles.secondary} type="submit">
            Join room <span aria-hidden="true">→</span>
          </button>
        </form>
      )}
    </section>
  );
}

export default function Page() {
  return (
    <main className={styles.main} data-lk-theme="default">
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            <span aria-hidden="true">◖</span> LiveKit <b>voice</b>
          </Link>
          <span className={styles.headerNote}>A place to catch up.</span>
        </header>
        <div className={styles.workspace}>
          <div className={styles.intro}>
            <span className={styles.eyebrow}>VOICE · VIDEO · WATCH TOGETHER</span>
            <h1>
              Good company.
              <br />
              <em>One room away.</em>
            </h1>
            <p>
              A voice room for your people. Drop in, share your screen, or settle in for a movie
              together.
            </p>
            <div className={styles.roomPreview} aria-hidden="true">
              <div className={styles.previewHeader}>
                <span className={styles.liveDot} /> YOUR SPACE TO TALK <span>03</span>
              </div>
              <div className={styles.people}>
                <span>A</span>
                <span>M</span>
                <span>You</span>
              </div>
              <div className={styles.waveform}>
                {Array.from({ length: 25 }, (_, index) => (
                  <i key={index} style={{ height: `${12 + ((index * 17) % 36)}px` }} />
                ))}
              </div>
              <p>Games, late-night chats, and everything between.</p>
            </div>
            <section className={styles.companionCard} aria-labelledby="companion-title">
              <span className={styles.eyebrow}>TAKE THE ROOM WITH YOU</span>
              <h2 id="companion-title">Your Windows companion</h2>
              <p>
                Talk with a global key while gaming. Watch torrents together. Adjust settings
                without leaving the call.
              </p>
              <CompanionDownloadLink />
            </section>
          </div>
          <Suspense
            fallback={
              <div className={styles.launcher} role="status">
                Loading rooms…
              </div>
            }
          >
            <RoomLauncher />
          </Suspense>
        </div>
        <footer className={styles.footer}>
          <span>Built for conversation.</span>
          <span>Powered by LiveKit</span>
        </footer>
      </div>
    </main>
  );
}
