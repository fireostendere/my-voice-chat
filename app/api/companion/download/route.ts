import {
  renderCompanionInstaller,
  resolveCompanionArchiveUrl,
  resolveCompanionOrigin,
} from '@/lib/companionInstaller';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const appOrigin = resolveCompanionOrigin(request, process.env.COMPANION_PUBLIC_ORIGIN);
  const archiveUrl = resolveCompanionArchiveUrl(process.env.COMPANION_ARCHIVE_URL);
  const installer = renderCompanionInstaller(appOrigin, archiveUrl);

  return new Response(installer, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="livekit-companion-setup.cmd"',
      'Content-Type': 'application/octet-stream; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
