export const DEFAULT_COMPANION_WS_URL = 'ws://127.0.0.1:7331';

export function getCompanionWsUrl(): string {
  const companionUrl = process.env.NEXT_PUBLIC_COMPANION_WS_URL;
  if (companionUrl !== undefined) return companionUrl;

  // Keep a legacy custom PTT endpoint working, but an empty PTT override should
  // disable only push-to-talk rather than the companion's other capabilities.
  return process.env.NEXT_PUBLIC_PTT_WS_URL || DEFAULT_COMPANION_WS_URL;
}

// Room URLs may contain a LiveKit JWT in the query and an E2EE secret in the
// fragment. Never inherit the legacy PTT override here: it may intentionally
// point at a remote WebSocket, while native handoff must stay on loopback.
export function getCompanionNavigationWsUrl(): string {
  return process.env.NEXT_PUBLIC_COMPANION_WS_URL ?? DEFAULT_COMPANION_WS_URL;
}

export function getPushToTalkWsUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PTT_WS_URL ??
    process.env.NEXT_PUBLIC_COMPANION_WS_URL ??
    DEFAULT_COMPANION_WS_URL
  );
}
