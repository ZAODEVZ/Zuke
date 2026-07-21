import { NextRequest, NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/constantTimeEqual';
import { getLiveAudioProvider } from '@/lib/spaces/providers';
import { insertJukeSpace, updateJukeSpace } from '@/lib/spaces/jukeSpacesDb';

/**
 * GET /api/cron/verify-juke-create - TEMPORARY. Not a real feature.
 *
 * Exercises the EXACT same code path POST /api/juke/space uses
 * (provider.createRoom + insertJukeSpace) to confirm space creation
 * actually works end to end in production, without needing a real admin
 * session or the shared create-password. Creates one minimal, unannounced,
 * unrecorded test room, confirms it landed, then ends it immediately -
 * same insert-then-clean-up-in-one-request posture as debug-write-test
 * earlier this session.
 *
 * DELETE THIS ROUTE once verified.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (!constantTimeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const provider = getLiveAudioProvider('juke');
  const created = await provider.createRoom({
    title: 'zuke-create-verify (safe to ignore, auto-ended)',
    announceCast: false,
    record: false,
  });

  if (!created.ok) {
    return NextResponse.json({
      ok: false,
      stage: 'createRoom',
      status: created.status,
      error: created.error,
    });
  }

  try {
    await insertJukeSpace({
      id: created.room.id,
      title: 'zuke-create-verify (safe to ignore, auto-ended)',
      createdByFid: 0,
      embedUrl: created.room.embedUrl,
      raw: created.room.raw,
    });
  } catch (dbErr: unknown) {
    return NextResponse.json({
      ok: false,
      stage: 'insertJukeSpace',
      created_room_id: created.room.id,
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }

  const ended = await provider.endRoom(created.room.id);
  try {
    await updateJukeSpace(created.room.id, { status: 'ended', ended_at: new Date().toISOString() });
  } catch (dbErr: unknown) {
    return NextResponse.json({
      ok: true,
      created: true,
      room_id: created.room.id,
      ended_via_juke: ended.ok,
      db_end_update_error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }

  return NextResponse.json({
    ok: true,
    created: true,
    room_id: created.room.id,
    embed_url: created.room.embedUrl,
    ended_via_juke: ended.ok,
    ended_status: ended.status,
  });
}
