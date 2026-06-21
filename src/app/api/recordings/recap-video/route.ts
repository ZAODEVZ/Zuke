import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionData } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { getJukeSpace } from '@/lib/spaces/jukeSpacesDb';
import { countRecordingsForSpace, insertRecording } from '@/lib/spaces/recordingsDb';
import { isValidSpaceId } from '@/lib/spaces/spaceId';
import { isHttpsUrl } from '@/lib/spaces/urls';

/**
 * POST /api/recordings/recap-video — attach a finished recap VIDEO to a space.
 *
 * This closes the "live room -> recap video" loop. The juke-space-recap
 * pipeline (99darwin/juke-space-recap) renders a 1920x1080 MP4 OFFLINE; the
 * host hosts that file somewhere (Supabase Storage resumable upload, their own
 * CDN, etc.) and posts its https URL here. We do NOT buffer the upload through
 * this route — an 84-min 1080p render is 1-2 GB, far past any serverless
 * request-body limit.
 *
 * The video lands as a juke_recordings row with source='recap', kind='video',
 * so the space page renders it in a <video> player and the recap export keeps
 * treating it as output (never fed back as pipeline audio input).
 *
 * Body: { spaceId, videoUrl, title? }
 * Auth: admin OR the space host.
 */

const bodySchema = z.object({
  spaceId: z.string().refine(isValidSpaceId, { message: 'Invalid space id' }),
  videoUrl: z.string().trim().refine(isHttpsUrl, { message: 'videoUrl must be an https:// URL' }),
  title: z.string().trim().max(200).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionData();
  if (!session?.fid && !session?.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { spaceId, videoUrl, title } = parsed.data;

  const space = await getJukeSpace(spaceId);
  if (!space) {
    return NextResponse.json({ ok: false, error: 'Space not found' }, { status: 404 });
  }
  const isHost = space.created_by_fid === session.fid;
  if (!session.isAdmin && !isHost) {
    return NextResponse.json(
      { ok: false, error: 'Only the host or an admin can attach a recap video' },
      { status: 403 },
    );
  }

  let partIndex = 0;
  try {
    partIndex = await countRecordingsForSpace(spaceId);
  } catch {
    /* default 0 */
  }

  try {
    const recording = await insertRecording({
      spaceId,
      url: videoUrl,
      source: 'recap',
      kind: 'video',
      provider: space.provider ?? 'juke',
      partIndex,
      title: title ?? 'Recap video',
      createdByFid: session.fid ?? 0,
    });
    if (!recording) {
      // null = table missing (migration #4) — can't attach anything yet.
      return NextResponse.json(
        { ok: false, error: 'Recordings are not configured yet (apply migration #4).' },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, recording }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    // kind column missing = migration #5 not applied; a video can't be stored
    // as video, so report it clearly instead of a generic 500.
    if (/column .*kind/i.test(message)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Recap video needs migration #5 (the juke_recordings.kind column). Apply it first.',
        },
        { status: 503 },
      );
    }
    logger.error('[recordings/recap-video] insertRecording failed', err);
    return NextResponse.json(
      { ok: false, error: 'Could not attach the recap video' },
      { status: 500 },
    );
  }
}

export const GET = (): NextResponse =>
  NextResponse.json(
    { ok: false, error: 'POST only — { spaceId, videoUrl, title? }' },
    { status: 405 },
  );
