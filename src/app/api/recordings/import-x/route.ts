import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionData } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { insertImportedSpace } from '@/lib/spaces/jukeSpacesDb';
import { insertRecording } from '@/lib/spaces/recordingsDb';
import { parseXSpaceUrl, X_SPACE_PROVIDER } from '@/lib/spaces/xSpaces';

/**
 * POST /api/recordings/import-x — import a past X (Twitter) Space into Zuke.
 *
 * Zuke does not re-broadcast a live X Space (that is real-time ingest). This
 * imports a FINISHED Space as an ended room: it creates a juke_spaces row
 * tagged with the 'songjam' provider (the X/Twitter ingest backend) and, if an
 * audio URL is supplied, attaches it as a recording. The host downloads the
 * Space audio first (yt-dlp / SpacesDown / Flowjin) and either passes the URL
 * here or uploads the file via /api/recordings/upload afterward.
 *
 * Once imported, the Space shows on /live/recordings, can be snippeted, and can
 * be exported to the recap pipeline like any other recording.
 *
 * Body: { url, title, audioUrl? }
 * Auth: any signed-in ZAO user (SIWF session) or admin. Looser than
 * /live/create's real gate (`POST /api/juke/space`), which requires an admin
 * session OR the shared JUKE_CREATE_PASSWORD - importing a past X Space
 * carries no live-room cost/abuse surface, so it doesn't need that gate.
 */

const bodySchema = z.object({
  url: z.string().trim().min(1, 'X Space URL or id required'),
  title: z.string().trim().min(1).max(200),
  // https-only: the URL is stored and rendered in <audio src> / <a href>;
  // restricting the scheme prevents javascript: or file: from reaching the DOM.
  audioUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'audioUrl must be an https:// URL' })
    .optional(),
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
  const { url, title, audioUrl } = parsed.data;

  const space = parseXSpaceUrl(url);
  if (!space) {
    return NextResponse.json(
      { ok: false, error: 'Not a recognizable X Space link (expected x.com/i/spaces/…)' },
      { status: 400 },
    );
  }

  try {
    await insertImportedSpace({
      id: space.zukeId,
      title,
      provider: X_SPACE_PROVIDER,
      createdByFid: session.fid ?? 0,
      recordingUrl: audioUrl ?? null,
      raw: {
        source: 'x',
        x_url: space.url,
        x_space_id: space.xSpaceId,
        imported_by_fid: session.fid ?? 0,
        imported_at: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    logger.error('[recordings/import-x] insertImportedSpace failed', err);
    // Surface the real DB error to admins only - this route swallowed it
    // entirely before, which made a live production 500 undebuggable without
    // Vercel log access. Non-admin signed-in users still get the generic
    // message so raw Postgres internals never leak to a random FID.
    const detail = session.isAdmin && err instanceof Error ? err.message : undefined;
    return NextResponse.json(
      { ok: false, error: 'Could not import the Space', ...(detail ? { detail } : {}) },
      { status: 500 },
    );
  }

  // Attach the audio as a recording if a URL was provided. Best-effort: the
  // space already exists, so a recording failure should not fail the import.
  if (audioUrl) {
    try {
      await insertRecording({
        spaceId: space.zukeId,
        url: audioUrl,
        source: 'import',
        provider: X_SPACE_PROVIDER,
        partIndex: 0,
        title: 'X Space audio',
      });
    } catch (err: unknown) {
      logger.warn('[recordings/import-x] insertRecording failed (non-fatal):', err);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      spaceId: space.zukeId,
      xSpaceId: space.xSpaceId,
      url: space.url,
      hasAudio: Boolean(audioUrl),
    },
    { status: 201 },
  );
}

export const GET = (): NextResponse =>
  NextResponse.json(
    { ok: false, error: 'POST only — { url, title, audioUrl? }' },
    { status: 405 },
  );
