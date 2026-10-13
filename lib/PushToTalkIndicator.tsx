import * as React from 'react';
import type { PushToTalkState } from './usePushToTalk';

/**
 * Small badge shown while the push-to-talk companion is connected, so the user
 * knows the call is in walkie-talkie mode and whether the mic is currently open.
 */
export function PushToTalkIndicator({ connected, talking, interrupted }: PushToTalkState) {
  if (!connected && !interrupted) {
    return null;
  }
  return (
    <div className="lk-ptt-indicator" data-talking={talking} role="status">
      <span aria-hidden>🎙️</span>
      <span>
        {interrupted
          ? 'PTT reconnecting · microphone muted'
          : talking
            ? 'Talking…'
            : 'Push-to-talk connected · hold the talk key'}
      </span>
    </div>
  );
}
