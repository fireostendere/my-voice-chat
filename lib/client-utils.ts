export function encodePassphrase(passphrase: string) {
  return encodeURIComponent(passphrase);
}

export function decodePassphrase(base64String: string) {
  return decodeURIComponent(base64String);
}

export function generateRoomId(): string {
  return `${randomString(4)}-${randomString(4)}`;
}

export function isShortRoomName(name: string): boolean {
  return (
    /^[\p{L}\p{N}_-]{1,128}$/u.test(name) &&
    !['api', 'custom', 'rooms', '_next', 'rtc', 'twirp'].includes(name)
  );
}

export function managedRoomPathname(pathname: string): string | null {
  if (/^\/rooms\/[^/]+\/?$/.test(pathname)) return pathname;
  const match = /^\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]);
    return isShortRoomName(name) ? `/rooms/${encodeURIComponent(name)}` : null;
  } catch {
    return null;
  }
}

export function roomHrefFromInput(input: string, origin: string): string | null {
  const value = input.trim();
  if (/^[\p{L}\p{N}_-]{1,128}$/u.test(value)) return `/rooms/${encodeURIComponent(value)}`;
  try {
    const url = new URL(value, origin);
    const pathname = managedRoomPathname(url.pathname);
    if (url.origin !== origin || url.username || url.password || !pathname) return null;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function randomString(length: number): string {
  let result = '';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function isLowPowerDevice() {
  return navigator.hardwareConcurrency < 6;
}

export function isMeetStaging() {
  return new URL(location.origin).host === 'meet.staging.livekit.io';
}
