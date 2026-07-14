import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionData } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { getJukeSpace } from '@/lib/spaces/jukeSpacesDb';
import { countRecordingsForSpace, getRecording, insertRecording } from '@/lib/spaces/recordingsDb';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * POST /api/recordings/snippet — create a snippet (clip) of an existing
 * recording. This is the "multi-part recordings make it easy to create audio
 * snippets" flow (@nickysap): pick a start/end window of a parent recording
 * and save it as its own shelf item.
 *
 * No server-side re-encoding (no ffmpeg in serverless): a snippet stores the
 * parent's URL plus start/end seconds, and the player streams it via a media-
 * fragment URL (`{parentUrl}#t=start,end`). Cheap, instant, and exact.
 *
 * Body: { parentId, startSeconds, endSeconds, title? }
 * Auth: admin OR the parent space's host.
 */

const bodySchema = z
  .object({
    parentId: z.string().uuid({ message: 'parentId must be a recording id' }),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    title: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.endSeconds > v.startSeconds, {
    message: 'endSeconds must be greater than startSeconds',
    path: ['endSeconds'],
  });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimit = checkRateLimit(request, 'recordings/snippet', { max: 20, windowMs: 60_000 });
  if (rateLimit.limited) {
    return NextResponse.json(
      { ok: false, error: 'Too many snippets, slow down' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

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
  const { parentId, startSeconds, endSeconds, title } = parsed.data;

  const parent = await getRecording(parentId);
  if (!parent) {
    return NextResponse.json({ ok: false, error: 'Parent recording not found' }, { status: 404 });
  }
  // Snippets are clips of real recordings, not clips of clips.
  if (parent.source === 'snippet') {
    return NextResponse.json(
      { ok: false, error: 'Cannot snippet a snippet — use the original recording' },
      { status: 400 },
    );
  }
  if (parent.duration_seconds != null && startSeconds >= parent.duration_seconds) {
    return NextResponse.json(
      { ok: false, error: 'startSeconds is past the end of the recording' },
      { status: 400 },
    );
  }

  // Ownership: admin or the host of the parent's space.
  const space = await getJukeSpace(parent.space_id);
  const isHost = space?.created_by_fid === session.fid;
  if (!session.isAdmin && !isHost) {
    return NextResponse.json(
      { ok: false, error: 'Only the host or an admin can create a snippet' },
      { status: 403 },
    );
  }

  // Media-fragment URL: the player seeks the parent file to [start,end].
  const fragmentUrl = `${parent.url}#t=${startSeconds},${endSeconds}`;

  let partIndex = 0;
  try {
    partIndex = await countRecordingsForSpace(parent.space_id);
  } catch {
    /* default 0 */
  }

  try {
    const recording = await insertRecording({
      spaceId: parent.space_id,
      url: fragmentUrl,
      source: 'snippet',
      provider: parent.provider,
      parentId: parent.id,
      partIndex,
      title: title ?? null,
      startSeconds,
      endSeconds,
      durationSeconds: Math.round(endSeconds - startSeconds),
      createdByFid: session.fid,
    });
    return NextResponse.json({ ok: true, recording }, { status: 201 });
  } catch (err: unknown) {
    logger.error('[recordings/snippet] insertRecording failed', err);
    return NextResponse.json(
      { ok: false, error: 'Could not create snippet' },
      { status: 500 },
    );
  }
}

export const GET = (): NextResponse =>
  NextResponse.json(
    { ok: false, error: 'POST only — { parentId, startSeconds, endSeconds, title? }' },
    { status: 405 },
  );
