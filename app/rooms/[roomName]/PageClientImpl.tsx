'use client';

import React from 'react';
import Link from 'next/link';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
} from '@livekit/components-react';
import { CustomVideoConference } from '@/lib/CustomVideoConference';
import { VideoCodec, Room } from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerformanceOptimiser';
import { useWakeLock } from '@/lib/useWakeLock';
import { usePushToTalk } from '@/lib/usePushToTalk';
import { buildManagedRoomOptions } from '@/lib/roomOptions';
import { useRoomConnection } from '@/lib/useRoomConnection';
import { RoomConnectionError } from '@/lib/RoomConnectionError';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: false,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const [joining, setJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState<string>();
  const joinRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => joinRequest.current?.abort(), []);

  const handlePreJoinSubmit = React.useCallback(
    async (values: LocalUserChoices) => {
      if (joinRequest.current) return;
      const controller = new AbortController();
      joinRequest.current = controller;
      setJoining(true);
      setJoinError(undefined);
      try {
        const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
        url.searchParams.set('roomName', props.roomName);
        url.searchParams.set('participantName', values.username);
        if (props.region) url.searchParams.set('region', props.region);
        const response = await fetch(url, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error('Could not get access to the room. Please try again.');
        const details: ConnectionDetails = await response.json();
        if (
          !details ||
          typeof details.serverUrl !== 'string' ||
          !details.serverUrl ||
          typeof details.participantToken !== 'string' ||
          !details.participantToken
        )
          throw new Error('The server returned incomplete room details. Please try again.');
        if (controller.signal.aborted) return;
        setPreJoinChoices(values);
        setConnectionDetails(details);
      } catch (error) {
        if (!controller.signal.aborted) {
          setJoinError(error instanceof Error ? error.message : 'Could not join the room.');
        }
      } finally {
        if (!controller.signal.aborted) setJoining(false);
        if (joinRequest.current === controller) joinRequest.current = null;
      }
    },
    [props.region, props.roomName],
  );
  const handlePreJoinError = React.useCallback(() => {
    setJoinError('Could not access your devices. Check permissions, or join with them turned off.');
  }, []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div className="lk-prejoin-screen">
          <header>
            <Link href="/">← Home</Link>
            <span>VOICE ROOM</span>
            <h1>{props.roomName}</h1>
            <p>Check your microphone, choose a name, and come on in.</p>
          </header>
          {joinError && (
            <p className="lk-prejoin-error" role="alert">
              {joinError}
            </p>
          )}
          <fieldset disabled={joining} aria-busy={joining}>
            <PreJoin
              defaults={preJoinDefaults}
              joinLabel={joining ? 'Joining…' : 'Join room'}
              onSubmit={handlePreJoinSubmit}
              onError={handlePreJoinError}
            />
          </fieldset>
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          onRetry={() => {
            setConnectionDetails(undefined);
            void handlePreJoinSubmit(preJoinChoices);
          }}
          options={{
            codec: props.codec,
            hq: props.hq,
            singlePeerConnection: props.singlePeerConnection,
          }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  onRetry: () => void;
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
    singlePeerConnection: boolean;
  };
}) {
  const { worker, e2eePassphrase, keyProvider, e2eeEnabled } = useSetupE2EE();

  const roomOptions = React.useMemo(() => {
    return buildManagedRoomOptions({
      audioDeviceId: props.userChoices.audioDeviceId,
      codec: props.options.codec,
      e2eeEnabled,
      hq: props.options.hq,
      keyProvider,
      singlePeerConnection: props.options.singlePeerConnection,
      videoDeviceId: props.userChoices.videoDeviceId,
      worker,
    });
  }, [
    props.userChoices,
    props.options.hq,
    props.options.codec,
    props.options.singlePeerConnection,
    e2eeEnabled,
    keyProvider,
    worker,
  ]);

  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const { error } = useRoomConnection(room, {
    serverUrl: props.connectionDetails.serverUrl,
    token: props.connectionDetails.participantToken,
    audioEnabled: props.userChoices.audioEnabled,
    videoEnabled: props.userChoices.videoEnabled,
    e2eePassphrase,
    keyProvider,
    onLeave: handleOnLeave,
  });

  const lowPowerMode = useLowCPUOptimizer(room);

  useWakeLock();
  const pushToTalk = usePushToTalk(room);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        {error ? (
          <RoomConnectionError error={error} onRetry={props.onRetry} onLeave={handleOnLeave} />
        ) : (
          <>
            <KeyboardShortcuts />
            <CustomVideoConference
              pushToTalk={pushToTalk}
              chatMessageFormatter={formatChatMessageLinks}
              SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
            />
            <DebugMode />
            <RecordingIndicator />
          </>
        )}
      </RoomContext.Provider>
    </div>
  );
}
