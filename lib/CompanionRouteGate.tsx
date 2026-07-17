'use client';

import * as React from 'react';
import { isCompanionWebView, openRoomInCompanion } from './companionNavigation';

type GateState = 'checking' | 'browser' | 'accepted' | 'relinquished';

export function CompanionRouteGate({ children }: React.PropsWithChildren) {
  const [state, setState] = React.useState<GateState>('checking');

  React.useEffect(() => {
    if (state !== 'checking') return;
    if (isCompanionWebView()) {
      setState('browser');
      return;
    }
    let active = true;
    const controller = new AbortController();

    void openRoomInCompanion(window.location.href, { signal: controller.signal }).then((result) => {
      if (active) setState(result === 'unavailable' ? 'browser' : result);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [state]);

  if (state === 'browser') return <>{children}</>;

  return (
    <main
      data-lk-theme="default"
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <section aria-live="polite">
        <h2>
          {state === 'accepted'
            ? 'Room opened in Companion'
            : state === 'relinquished'
              ? 'Browser room paused'
              : 'Looking for Companion…'}
        </h2>
        <p>
          {state === 'accepted'
            ? 'This tab will stay inactive to avoid duplicate audio. Continue in the desktop app. To use the browser instead, exit Companion from its tray menu and reopen this link in a new tab.'
            : state === 'relinquished'
              ? 'Companion received the handoff, but opening was not confirmed. This tab remains inactive; exit Companion from its tray menu and reopen the link in a new tab to use the browser.'
              : 'The room will open here if the desktop app is unavailable.'}
        </p>
      </section>
    </main>
  );
}
