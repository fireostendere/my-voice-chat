'use client';
import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import {
  LocalAudioTrack,
  LocalVideoTrack,
  Track,
  VideoPresets,
  type LocalTrackPublication,
} from 'livekit-client';
import { useWatchTogether } from './WatchTogetherContext';
import {
  formatTorrentSpeed,
  prepareTorrentSource,
  type TorrentEngine,
  type TorrentSourceStatus,
} from './torrentSource';

export function StreamHostController() {
  const room = useRoomContext();
  const { stream, stopStream, reportStreamPlayback, registerStreamController } = useWatchTogether();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const publishedRef = React.useRef<{
    video?: LocalTrackPublication;
    audio?: LocalTrackPublication;
  }>({});
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState('Preparing file…');
  const [detail, setDetail] = React.useState('');
  const streamSource = stream.active ? stream.source : null;

  const reportPlayback = React.useCallback(() => {
    const video = videoRef.current;
    if (!streamSource || !video) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const currentTime = Number.isFinite(video.currentTime)
      ? Math.round(Math.max(0, video.currentTime) * 2) / 2
      : 0;
    const phase = error
      ? 'error'
      : !isLiveStatus(status)
        ? 'loading'
        : video.ended
          ? 'ended'
          : video.paused
            ? 'paused'
            : 'playing';
    const sourceName =
      isLiveStatus(status) && detail
        ? detail
        : streamSource.kind === 'file'
          ? streamSource.file.name
          : streamSource.input.name;
    reportStreamPlayback({
      active: true,
      name: limitLabel(sourceName, 260, 'Media'),
      phase,
      status: limitLabel(error ? 'Stream error' : status, 512, 'Playback'),
      detail: limitLabel(error ?? detail, 512, sourceName),
      currentTime,
      duration,
      paused: video.paused,
      canSeek: duration !== null,
    });
  }, [detail, error, reportStreamPlayback, status, streamSource]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!streamSource || !video) return;
    const events = [
      'loadedmetadata',
      'durationchange',
      'timeupdate',
      'play',
      'pause',
      'ended',
      'seeking',
      'seeked',
      'waiting',
    ];
    events.forEach((event) => video.addEventListener(event, reportPlayback));
    reportPlayback();
    return () => events.forEach((event) => video.removeEventListener(event, reportPlayback));
  }, [reportPlayback, streamSource]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!streamSource || !video) return;
    return registerStreamController(async (command) => {
      if (command.action === 'play') {
        await video.play();
      } else if (command.action === 'pause') {
        video.pause();
      } else if (command.action === 'seek') {
        const maximum = Number.isFinite(video.duration) ? video.duration : command.currentTime;
        video.currentTime = Math.min(Math.max(0, command.currentTime), Math.max(0, maximum));
      }
    });
  }, [registerStreamController, streamSource]);

  React.useEffect(() => {
    if (!streamSource || !videoRef.current) return;
    const video = videoRef.current;
    setError(null);
    setStatus('Preparing file…');
    setDetail(streamSource.kind === 'file' ? streamSource.file.name : streamSource.input.name);

    let cancelled = false;
    let objectUrl: string | null = null;
    let sourceCleanup = () => {};
    const abortController = new AbortController();

    const publish = async () => {
      try {
        let torrentEngine: TorrentEngine | null = null;
        let sourceName: string;
        if (streamSource.kind === 'file') {
          sourceName = streamSource.file.name;
          objectUrl = URL.createObjectURL(streamSource.file);
          video.src = objectUrl;
        } else {
          const prepared = await prepareTorrentSource(
            video,
            streamSource.input,
            (torrentStatus) => {
              if (!cancelled) updateTorrentStatus(torrentStatus, setStatus, setDetail);
            },
            abortController.signal,
          );
          sourceCleanup = prepared.cleanup;
          torrentEngine = prepared.engine;
          sourceName = prepared.fileName;
        }

        await waitForMetadata(video);
        if (cancelled) return;

        setStatus('Starting playback…');
        setDetail(sourceName);
        await video.play().catch(() => {
          /* autoplay may be blocked, but captureStream still works */
        });
        if (cancelled) return;

        const mediaStream = (video as any).captureStream
          ? (video as any).captureStream()
          : (video as any).mozCaptureStream?.();
        if (!mediaStream) {
          throw new Error('This browser cannot stream local video with captureStream().');
        }

        const videoTrack = mediaStream.getVideoTracks()[0];
        const audioTrack = mediaStream.getAudioTracks()[0];

        if (videoTrack) {
          setStatus('Publishing video to the room…');
          const lvt = new LocalVideoTrack(videoTrack, undefined, true);
          const pub = await room.localParticipant.publishTrack(lvt, {
            source: Track.Source.ScreenShare,
            videoEncoding: { maxBitrate: 5_000_000, maxFramerate: 30 },
            videoSimulcastLayers: [VideoPresets.h1440, VideoPresets.h1080, VideoPresets.h720],
            simulcast: true,
          });
          // Cleanup may have run while publishTrack was in flight; the track
          // would otherwise stay published with nobody left to unpublish it.
          if (cancelled) {
            room.localParticipant.unpublishTrack(lvt, true).catch(() => {});
            return;
          }
          publishedRef.current.video = pub;
        }
        if (audioTrack) {
          setStatus('Connecting audio…');
          const lat = new LocalAudioTrack(audioTrack, undefined, true);
          const pub = await room.localParticipant.publishTrack(lat, {
            source: Track.Source.ScreenShareAudio,
          });
          if (cancelled) {
            room.localParticipant.unpublishTrack(lat, true).catch(() => {});
            return;
          }
          publishedRef.current.audio = pub;
        }
        if (!videoTrack) throw new Error('The selected file does not contain a video track.');
        setStatus(torrentEngine ? `Live · ${engineLabel(torrentEngine)}` : 'Live');
        setDetail(sourceName);
      } catch (err: any) {
        if (!cancelled && err?.name !== 'AbortError') setError(err?.message ?? String(err));
      }
    };

    publish();

    return () => {
      cancelled = true;
      abortController.abort();
      sourceCleanup();
      const { video: vp, audio: ap } = publishedRef.current;
      publishedRef.current = {};
      if (vp?.track) room.localParticipant.unpublishTrack(vp.track, true).catch(() => {});
      if (ap?.track) room.localParticipant.unpublishTrack(ap.track, true).catch(() => {});
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {}
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [streamSource, room]);

  if (!stream.active) return null;

  return (
    <div className="lk-watch-together-host-panel">
      <video ref={videoRef} className="lk-watch-together-host-video" controls playsInline />
      <div className="lk-watch-together-host-controls">
        <span className="lk-watch-together-host-label">
          <strong>{error ? 'Stream error' : status}</strong>
          <span>{error ?? detail}</span>
        </span>
        <button type="button" className="lk-button" onClick={stopStream}>
          Stop
        </button>
      </div>
    </div>
  );
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not open the torrent video stream.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

function updateTorrentStatus(
  torrentStatus: TorrentSourceStatus,
  setStatus: (value: string) => void,
  setDetail: (value: string) => void,
) {
  const engine = engineLabel(torrentStatus.engine);
  if (torrentStatus.phase === 'error') {
    setStatus(`Error · ${engine}`);
  } else if (torrentStatus.phase === 'ready') {
    setStatus(`Buffer ready · ${engine}`);
  } else {
    setStatus(`Downloading · ${engine}`);
  }
  const metrics = [
    torrentStatus.peers !== undefined ? `${torrentStatus.peers} peers` : null,
    torrentStatus.downloadSpeed !== undefined
      ? formatTorrentSpeed(torrentStatus.downloadSpeed)
      : null,
  ].filter(Boolean);
  setDetail([torrentStatus.detail, ...metrics].join(' · '));
}

function engineLabel(engine: TorrentEngine): string {
  return engine === 'companion' ? 'Companion' : 'WebTorrent';
}

function isLiveStatus(status: string): boolean {
  return status === 'Live' || status.startsWith('Live ·');
}

function limitLabel(value: string, maxLength: number, fallback: string): string {
  return value.trim().slice(0, maxLength) || fallback.slice(0, maxLength);
}
