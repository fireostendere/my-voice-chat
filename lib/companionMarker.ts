export type CompanionMarker = {
  host: 'webview2';
  platform: 'windows';
  version: 1;
  appVersion?: string;
};

declare global {
  interface Window {
    __LIVEKIT_COMPANION__?: true | CompanionMarker;
  }
}

export function getCompanionMarker(): CompanionMarker | undefined {
  if (typeof window === 'undefined') return undefined;
  const marker = window.__LIVEKIT_COMPANION__;
  if (
    typeof marker !== 'object' ||
    marker === null ||
    marker.host !== 'webview2' ||
    marker.platform !== 'windows' ||
    marker.version !== 1
  ) {
    return undefined;
  }
  return marker;
}

export function isCompanionWebView(): boolean {
  return getCompanionMarker() !== undefined;
}
