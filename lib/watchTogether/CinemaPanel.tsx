'use client';
import * as React from 'react';
import { useWatchTogether } from './WatchTogetherContext';
import { parseVideoUrl } from './parseVideoUrl';
import { isMagnetUri } from './torrentSource';
import type { TorrentInput } from './types';

type Tab = 'link' | 'file' | 'torrent';

const MAX_TORRENT_FILE_BYTES = 2 * 1024 * 1024;

export function CinemaPanel() {
  const { embed, stream, startEmbed, startStream, startTorrent } = useWatchTogether();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('link');
  const [url, setUrl] = React.useState('');
  const [magnet, setMagnet] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const torrentInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const launchUrl = (event: React.FormEvent) => {
    event.preventDefault();
    if (embed.active && !embed.isHost) {
      setError('Another participant controls playback. Wait until the current stream ends.');
      return;
    }
    const parsed = parseVideoUrl(url.trim());
    if (!parsed) {
      setError('Enter a direct HTTP(S) video URL, a YouTube URL, or a VK Video URL.');
      return;
    }
    if (parsed.kind === 'youtube' || parsed.kind === 'vk') {
      startEmbed(parsed.kind, parsed.videoId);
    } else startEmbed('url', parsed.url);
    setError(null);
    setOpen(false);
  };

  const launchFile = (file: File | undefined) => {
    if (!file) return;
    if (embed.active && !embed.isHost) {
      setError('Another participant controls playback. Wait until the current stream ends.');
      return;
    }
    if (file.type && !file.type.startsWith('video/')) {
      setError('Select a video file. MP4 (H.264/AAC) and WebM work best.');
      return;
    }
    startStream(file);
    setError(null);
    setOpen(false);
  };

  const launchTorrent = (input: TorrentInput) => {
    if (embed.active && !embed.isHost) {
      setError('Another participant controls playback. Wait until the current stream ends.');
      return;
    }
    startTorrent(input);
    setError(null);
    setOpen(false);
  };

  const launchMagnet = (event: React.FormEvent) => {
    event.preventDefault();
    const value = magnet.trim();
    if (!isMagnetUri(value)) {
      setError('Enter a valid BitTorrent magnet link.');
      return;
    }
    launchTorrent({ kind: 'magnet', magnet: value, name: magnetDisplayName(value) });
  };

  const launchTorrentFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_TORRENT_FILE_BYTES) {
      setError('The .torrent file is too large. The limit is 2 MB.');
      return;
    }
    try {
      launchTorrent({
        kind: 'torrent-file',
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
      });
    } catch {
      setError('Could not read the .torrent file.');
    }
  };

  const active = embed.active || stream.active;
  const activeLabel = stream.active
    ? stream.source.kind === 'file'
      ? stream.source.file.name
      : stream.source.input.name
    : embed.active
      ? embed.kind === 'youtube'
        ? 'YouTube'
        : embed.kind === 'vk'
          ? 'VK Video'
          : 'Linked video'
      : null;

  return (
    <div className="lk-cinema-launcher">
      <button
        type="button"
        className={`lk-cinema-launcher-button${active ? ' lk-cinema-launcher-active' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="lk-cinema-launcher-icon" aria-hidden="true">
          ▶
        </span>
        <span>{activeLabel ?? 'Cinema'}</span>
        {active && <span className="lk-cinema-live-dot" aria-label="Now playing" />}
      </button>

      {open && (
        <div className="lk-cinema-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="lk-cinema-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cinema-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="lk-cinema-panel-header">
              <div>
                <span className="lk-cinema-eyebrow">WATCH TOGETHER</span>
                <h2 id="cinema-title">Room cinema</h2>
                <p>Start a video and everyone in the room will watch it together.</p>
              </div>
              <button
                type="button"
                className="lk-cinema-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="lk-cinema-tabs" role="tablist" aria-label="Video source">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'link'}
                onClick={() => {
                  setTab('link');
                  setError(null);
                }}
              >
                Link, YouTube or VK
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'file'}
                onClick={() => {
                  setTab('file');
                  setError(null);
                }}
              >
                Device file
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'torrent'}
                onClick={() => {
                  setTab('torrent');
                  setError(null);
                }}
              >
                Torrent
              </button>
            </div>

            {tab === 'link' ? (
              <form className="lk-cinema-link-form" onSubmit={launchUrl}>
                <label htmlFor="cinema-url">Video URL</label>
                <div className="lk-cinema-url-row">
                  <input
                    id="cinema-url"
                    value={url}
                    type="text"
                    inputMode="url"
                    autoFocus
                    placeholder="https://vk.ru/video-…_… or https://youtu.be/…"
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setError(null);
                    }}
                  />
                  <button type="submit" className="lk-button" disabled={!url.trim()}>
                    Start
                  </button>
                </div>
                <p className="lk-cinema-hint">
                  MP4, WebM, Ogg, HLS (.m3u8), YouTube, and VK Video links from vk.ru, vk.com, or
                  vkvideo.ru. Direct video servers must allow browser playback.
                </p>
              </form>
            ) : tab === 'file' ? (
              <div
                className={`lk-cinema-dropzone${dragging ? ' lk-cinema-dropzone-active' : ''}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  launchFile(event.dataTransfer.files[0]);
                }}
              >
                <div className="lk-cinema-file-mark" aria-hidden="true">
                  +
                </div>
                <strong>Drop a video here</strong>
                <span>The file stays on this device and streams through LiveKit</span>
                <button
                  type="button"
                  className="lk-button"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose file
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/*,.mkv,.m4v"
                  hidden
                  onChange={(event) => {
                    launchFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </div>
            ) : (
              <div className="lk-cinema-torrent">
                <form className="lk-cinema-link-form" onSubmit={launchMagnet}>
                  <label htmlFor="cinema-magnet">Magnet link</label>
                  <div className="lk-cinema-url-row">
                    <input
                      id="cinema-magnet"
                      value={magnet}
                      type="text"
                      autoFocus
                      spellCheck={false}
                      placeholder="magnet:?xt=urn:btih:…"
                      onChange={(event) => {
                        setMagnet(event.target.value);
                        setError(null);
                      }}
                    />
                    <button type="submit" className="lk-button" disabled={!magnet.trim()}>
                      Start
                    </button>
                  </div>
                </form>
                <div className="lk-cinema-torrent-divider">
                  <span>or</span>
                </div>
                <button
                  type="button"
                  className="lk-button lk-cinema-torrent-file"
                  onClick={() => torrentInputRef.current?.click()}
                >
                  Choose .torrent file
                </button>
                <input
                  ref={torrentInputRef}
                  type="file"
                  accept=".torrent,application/x-bittorrent"
                  hidden
                  onChange={(event) => {
                    void launchTorrentFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <div className="lk-cinema-engine-route" aria-label="Automatic engine selection">
                  <span>1</span>
                  <strong>Companion</strong>
                  <i>standard BitTorrent peers</i>
                  <b>→</b>
                  <span>2</span>
                  <strong>WebTorrent</strong>
                  <i>browser fallback</i>
                </div>
                <p className="lk-cinema-hint">
                  The local companion is preferred. If it is not installed or running, cinema
                  automatically falls back to WebTorrent. The application server never receives the
                  torrent file.
                </p>
              </div>
            )}

            {error && <div className="lk-cinema-error">{error}</div>}
            {active && (
              <p className="lk-cinema-replace-note">
                {embed.active && !embed.isHost
                  ? `${embed.hostIdentity} is hosting now. Only the host can replace the source.`
                  : 'Starting a new source replaces the current one for the entire room.'}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function magnetDisplayName(magnet: string): string {
  try {
    const displayName = new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1)).get('dn');
    return displayName?.trim() || 'Torrent';
  } catch {
    return 'Torrent';
  }
}
