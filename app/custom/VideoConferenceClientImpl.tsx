'use client';

import { formatChatMessageLinks, RoomContext } from '@livekit/components-react';
import { CustomVideoConference } from '@/lib/CustomVideoConference';
import { LogLevel, Room, type VideoCodec } from 'livekit-client';
import { DebugMode } from '@/lib/Debug';
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerformanceOptimiser';
import { useWakeLock } from '@/lib/useWakeLock';
import { usePushToTalk } from '@/lib/usePushToTalk';
import { buildCustomRoomOptions } from '@/lib/roomOptions';
import { useRoomConnection } from '@/lib/useRoomConnection';
import { RoomConnectionError } from '@/lib/RoomConnectionError';

export function VideoConferenceClientImpl(props: {
  liveKitUrl: string;
  token: string;
  codec: VideoCodec | undefined;
  singlePeerConnection: boolean | undefined;
}) {
  const { worker, e2eePassphrase, keyProvider, e2eeEnabled } = useSetupE2EE();

  const roomOptions = useMemo(() => {
    return buildCustomRoomOptions({
      codec: props.codec,
      e2eeEnabled,
      keyProvider,
      singlePeerConnection: props.singlePeerConnection,
      worker,
    });
  }, [e2eeEnabled, props.codec, props.singlePeerConnection, keyProvider, worker]);

  const room = useMemo(() => new Room(roomOptions), [roomOptions]);

  const router = useRouter();
  const handleOnLeave = useCallback(() => router.push('/'), [router]);
  const { error, retry } = useRoomConnection(room, {
    serverUrl: props.liveKitUrl,
    token: props.token,
    audioEnabled: true,
    videoEnabled: false,
    e2eePassphrase,
    keyProvider,
    onLeave: handleOnLeave,
  });

  useLowCPUOptimizer(room);

  useWakeLock();
  const pushToTalk = usePushToTalk(room);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        {error ? (
          <RoomConnectionError error={error} onRetry={retry} onLeave={handleOnLeave} />
        ) : (
          <>
            <KeyboardShortcuts />
            <CustomVideoConference
              pushToTalk={pushToTalk}
              chatMessageFormatter={formatChatMessageLinks}
              SettingsComponent={
                process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU === 'true' ? SettingsMenu : undefined
              }
            />
            <DebugMode logLevel={LogLevel.debug} />
          </>
        )}
      </RoomContext.Provider>
    </div>
  );
}
