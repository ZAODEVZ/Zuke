import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionData } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { isValidJukeSpaceId } from '@/lib/spaces/juke';
import { getLiveAudioProvider } from '@/lib/spaces/providers';
import { getJukeSpace, updateJukeSpace } from '@/lib/spaces/jukeSpacesDb';

/**
 * POST /api/juke/admin/end-space
 *
 * Calls Juke's developer end-space endpoint to terminate a room the host or
 * an admin owns. Confirmed shape by Nicky 2026-05-24:
 *
 *   POST https://api.juke.audio/v1/developer/spaces/{room_id}/end
 *   X-Juke-Api-Key: <JUKE_API_KEY>
 *   -> 200 {"status": "ended"}
 *
 * Ownership: must be a room we (ZAO) created via POST /v1/developer/spaces.
 * Cross-app + iOS-native rooms 404 with the same shape (no enumeration
 * oracle). Idempotent on already-ended rooms. Fires `room.finished` to our
 * webhook handler immediately with `ended_via: "api"` - no 5min LiveKit
 * empty-timeout wait. We do NOT proactively flip our DB status here; the
 * inbound webhook handler is the source of truth for the lifecycle update,
 * which keeps the dispatch path identical to natural ends.
 *
 * Auth: signed-in user must be the original host (created_by_fid === fid) OR
 * an admin. If you want a manual override that updates our DB without
 * touching Juke (e.g. ghost rooms where Juke is unreachable), use
 * /api/juke/admin/mark-ended instead.
 *
 * Body: { spaceId }
 * Returns:
 *   200 { ok: true, spaceId, provider, raw }
 *   202 { ok: true, spaceId, fallback: 'mark-ended' } when Juke 404s the
 *       endpoint - this endpoint has shipped since PR #174, so a 404 here
 *       means a cross-app / iOS-native room we don't own, not a missing
 *       endpoint. We flip our DB status locally as an interim manual fix.
 */

const BodySchema = z.object({
  spaceId: z.string().refine(isValidJukeSpaceId, { message: 'Invalid Juke space id' }),
});

export async function POST(request: NextRequest) {
  const session = await getSessionData();
  if (!session?.fid) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { spaceId } = parsed.data;

  const row = await getJukeSpace(spaceId);
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Space not found' }, { status: 404 });
  }

  const isAdmin = Boolean(session.isAdmin);
  const isHost = row.created_by_fid === session.fid;
  if (!isAdmin && !isHost) {
    return NextResponse.json(
      { ok: false, error: 'Only the host or an admin can end this space' },
      { status: 403 },
    );
  }

  if (row.status === 'ended') {
    return NextResponse.json({ ok: true, spaceId, alreadyEnded: true });
  }

  // Dispatch end-room to whichever backend owns this space. Defaults to
  // 'juke' for rows written before migration #3 added the provider column.
  const provider = getLiveAudioProvider(row.provider ?? 'juke');
  const result = await provider.endRoom(spaceId);

  if (!result.ok) {
    // Juke-specific fallback: 404 = a cross-app / iOS-native room we don't own
    // (the end-space endpoint itself has shipped since PR #174). Flip our DB
    // to ended so the listing stops showing it as Live; a natural
    // room.finished may still arrive.
    if ((row.provider ?? 'juke') === 'juke' && result.status === 404) {
      logger.warn(
        '[juke/admin/end-space] Juke 404 - cross-app / iOS-native room we do not own',
        { spaceId },
      );
      try {
        await updateJukeSpace(spaceId, {
          status: 'ended',
          ended_at: new Date().toISOString(),
        });
      } catch (err: unknown) {
        logger.error('[juke/admin/end-space] fallback mark-ended DB update failed', err);
        return NextResponse.json(
          { ok: false, error: 'Juke end-space 404 + local fallback failed' },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          ok: true,
          spaceId,
          fallback: 'mark-ended',
          note: 'Juke returned 404 for this room (cross-app / iOS-native, not one we own); flipped local status to ended. A real room.finished may still arrive later.',
        },
        { status: 202 },
      );
    }
    logger.warn('[juke/admin/end-space] provider rejected', result.status, result.error);
    return NextResponse.json(
      { ok: false, error: result.error ?? `Provider returned ${result.status}` },
      { status: result.status >= 500 ? 502 : result.status },
    );
  }

  // Success path: provider accepted. We do NOT flip our DB here — the inbound
  // room.finished webhook (ended_via: "api") is the source of truth for the
  // lifecycle update, keeping natural ends and API ends on the same code path.
  return NextResponse.json({ ok: true, spaceId, provider: provider.provider, raw: result.raw });
}

export const GET = () =>
  NextResponse.json(
    { ok: false, error: 'POST only - send { spaceId } as JSON' },
    { status: 405 },
  );
