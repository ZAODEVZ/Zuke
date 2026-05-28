import { NextResponse } from 'next/server';
import { getSessionData } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSessionData();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    fid: session.fid,
    username: session.username,
    displayName: session.displayName,
    pfpUrl: session.pfpUrl,
    isAdmin: session.isAdmin,
  });
}
