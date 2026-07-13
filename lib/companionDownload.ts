export const DEFAULT_COMPANION_EXE_URL =
  'https://github.com/fireostendere/my-voice-chat/releases/download/companion-latest/LiveKitCompanionSetup.exe';

export function resolveCompanionExeUrl(configuredUrl?: string): string {
  if (!configuredUrl) return DEFAULT_COMPANION_EXE_URL;
  try {
    const url = new URL(configuredUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.pathname.toLowerCase().endsWith('.exe')
    ) {
      return DEFAULT_COMPANION_EXE_URL;
    }
    return url.toString();
  } catch {
    return DEFAULT_COMPANION_EXE_URL;
  }
}
