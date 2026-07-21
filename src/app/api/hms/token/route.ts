import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionData } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { mintHmsAppToken } from '@/lib/spaces/providers/hms';

/**
 * POST /api/hms/token
 *
 * Mint a short-lived 100ms app token for the current session user to join
 * one HMS room. Auth token minting is session-gated — any authed Zuke user
 * can join any HMS room as a listener (OPEN — no token gate). The `role`
 * parameter controls speaker vs listener capabilities within the room.
 *
 * Body: { roomId: string, role: 'listener' | 'speaker' | 'host' }
 * Response: { token: string }
 *
 * Required env: HMS_ACCESS_KEY, HMS_APP_SECRET
 */
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  roomId: z.string().min(1),
  role: z.enum(['listener', 'speaker', 'host']).default('listener'),
});

export async function POST(req: Request) {
  const session = await getSessionData();
  if (!session?.fid) {
    return NextResponse.json({ ok: false, error: 'Sign in to join an HMS room' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { roomId, role } = parsed.data;
  const userId = String(session.fid);
  const token = mintHmsAppToken(roomId, userId, role);

  if (!token) {
    logger.error('[hms-token] HMS_ACCESS_KEY or HMS_APP_SECRET missing');
    return NextResponse.json({ ok: false, error: 'HMS provider not configured' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, token }, { headers: { 'Cache-Control': 'no-store' } });
}
