import { useEffect, useState } from 'react';
import { DisconnectReason, Room, RoomEvent, type ExternalE2EEKeyProvider } from 'livekit-client';
import toast from 'react-hot-toast';

export function useRoomConnection(
  room: Room,
  {
    serverUrl,
    token,
    audioEnabled,
    videoEnabled,
    e2eePassphrase,
    keyProvider,
    onLeave,
  }: {
    serverUrl: string;
    token: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
    e2eePassphrase?: string;
    keyProvider: ExternalE2EEKeyProvider;
    onLeave: () => void;
  },
) {
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    setError(undefined);
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) onLeave();
      else setError('The connection to the room was lost. Try joining again.');
    };
    const onMediaError = () => {
      toast.error('Could not access your microphone or camera. Check device permissions.');
    };
    const onEncryptionError = () => {
      setError('Encryption failed. Rejoin the room to continue securely.');
      disposed = true;
      room.off(RoomEvent.Disconnected, onDisconnected);
      void room.disconnect().catch(() => {});
    };
    async function connect() {
      try {
        // Finish the previous attempt before a retry registers its leave listener.
        await room.disconnect();
        if (disposed) return;
        room.on(RoomEvent.Disconnected, onDisconnected);
        room.on(RoomEvent.MediaDevicesError, onMediaError);
        room.on(RoomEvent.EncryptionError, onEncryptionError);
        if (e2eePassphrase) {
          await keyProvider.setKey(e2eePassphrase);
          if (disposed) return;
          await room.setE2EEEnabled(true);
        }
        if (disposed) return;
        await room.connect(serverUrl, token, { autoSubscribe: true });
        if (disposed) {
          await room.disconnect();
          return;
        }
      } catch {
        if (!disposed) {
          setError('Could not join the room. Check your connection and invitation, then retry.');
        }
        return;
      }

      // Device permission failures should leave the user in the room to listen.
      await Promise.allSettled([
        audioEnabled ? room.localParticipant.setMicrophoneEnabled(true) : Promise.resolve(),
        videoEnabled ? room.localParticipant.setCameraEnabled(true) : Promise.resolve(),
      ]);
    }
    void connect();

    return () => {
      disposed = true;
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.MediaDevicesError, onMediaError);
      room.off(RoomEvent.EncryptionError, onEncryptionError);
      void room.disconnect().catch(() => {});
    };
  }, [
    room,
    serverUrl,
    token,
    audioEnabled,
    videoEnabled,
    e2eePassphrase,
    keyProvider,
    onLeave,
    attempt,
  ]);

  return { error, retry: () => setAttempt((value) => value + 1) };
}
