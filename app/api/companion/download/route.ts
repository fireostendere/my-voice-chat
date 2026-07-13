import { resolveCompanionExeUrl } from '@/lib/companionDownload';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.redirect(resolveCompanionExeUrl(process.env.COMPANION_EXE_URL), 307);
}
