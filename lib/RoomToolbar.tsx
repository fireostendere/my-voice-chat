'use client';

import React, { useState } from 'react';
import { useConnectionState, useParticipants, useRoomContext } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import toast from 'react-hot-toast';

export function RoomToolbar() {
  const room = useRoomContext();
  const participants = useParticipants();
  const state = useConnectionState();
  const [copying, setCopying] = useState(false);
  const connected = state === ConnectionState.Connected;

  async function copyInvite() {
    if (copying) return;
    // Custom room URLs carry a participant token and must never become invitations.
    if (!/^\/rooms\/[^/]+\/?$/.test(window.location.pathname)) {
      toast.error('Use a separate access token for each participant on a custom server.');
      return;
    }
    setCopying(true);
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Room invitation copied.');
    } catch {
      toast.error('Could not copy the invitation. Copy the room link from the address bar.');
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="lk-room-heading">
      <div className="lk-room-details">
        <strong title={room.name}>{room.name || 'Voice room'}</strong>
        <span role="status" className="lk-room-state" data-connected={connected}>
          <i aria-hidden="true" />
          {connected
            ? `${participants.length} in room`
            : state === ConnectionState.Disconnected
              ? 'Disconnected'
              : 'Connecting…'}
        </span>
      </div>
      <button className="lk-button lk-invite-button" onClick={copyInvite} disabled={copying}>
        {copying ? 'Copying…' : 'Invite'}
      </button>
    </div>
  );
}
