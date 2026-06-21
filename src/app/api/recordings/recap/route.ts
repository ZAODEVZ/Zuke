import { NextRequest, NextResponse } from 'next/server';
import { getSessionData } from '@/lib/auth/session';
import { ENV } from '@/lib/env';
import { logger } from '@/lib/logger';
import { isValidJukeSpaceId } from '@/lib/spaces/juke';
import { getJukeSpace } from '@/lib/spaces/jukeSpacesDb';
import { listRecordingsForSpace } from '@/lib/spaces/recordingsDb';
import { fetchProfilesByFids, type FarcasterProfile } from '@/lib/farcaster/neynar';

/**
 * GET /api/recordings/recap?spaceId={id} — the bridge to the OSS recap tool.
 *
 * The juke-space-recap Remotion pipeline (99darwin/juke-space-recap) renders a
 * 1920×1080 recap video from a space's audio + per-guest PFPs. That render is
 * OFFLINE (Deepgram transcription + a 3–6 hour Remotion render) and cannot run
 * in Zuke's serverless functions — so this endpoint hands the pipeline exactly
 * the inputs Zuke uniquely has, pre-resolved:
 *
 *   - audio[]        the space's recording parts / uploads (download + drop in
 *                    public/audio.ogg, or stitch multi-part)
 *   - host           created_by_fid resolved to username + display_name + PFP
 *   - participants[] every known participant fid, likewise resolved via Neynar
 *
 * That lets the human skip the manual "fill in @username per intro" step for
 * anyone we already tracked joining. See docs/recap.md.
 *
 * Auth: admin OR the space host. Read-only.
 */

interface RecapAudioPart {
  url: string;
  title: string | null;
  source: string;
  durationSeconds: number | null;
}

interface RecapResponse {
  ok: true;
  generatedAt: string;
  space: {
    id: string;
    title: string;
    startedAt: string | null;
    endedAt: string | null;
  };
  audio: RecapAudioPart[];
  host: FarcasterProfile | null;
  participants: Array<FarcasterProfile & { role: string | null }>;
  pipeline: {
    repo: string;
    note: string;
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionData();
  if (!session?.fid && !session?.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 });
  }

  const spaceId = request.nextUrl.searchParams.get('spaceId');
  if (!spaceId || !isValidJukeSpaceId(spaceId)) {
    return NextResponse.json({ ok: false, error: 'Invalid or missing spaceId' }, { status: 400 });
  }

  const space = await getJukeSpace(spaceId);
  if (!space) {
    return NextResponse.json({ ok: false, error: 'Space not found' }, { status: 404 });
  }
  const isHost = space.created_by_fid === session.fid;
  if (!session.isAdmin && !isHost) {
    return NextResponse.json(
      { ok: false, error: 'Only the host or an admin can export recap inputs' },
      { status: 403 },
    );
  }

  // Audio: prefer the multi-part juke_recordings rows; fall back to the legacy
  // single recording_url so this works even before migration #4 backfills.
  const recordings = await listRecordingsForSpace(spaceId).catch((err: unknown) => {
    logger.warn('[recordings/recap] listRecordingsForSpace failed (non-fatal):', err);
    return [];
  });
  const audio: RecapAudioPart[] =
    recordings.length > 0
      ? recordings
          .filter((r) => r.source !== 'snippet')
          .map((r) => ({
            url: r.url,
            title: r.title,
            source: r.source,
            durationSeconds: r.duration_seconds,
          }))
      : space.recording_url
        ? [{ url: space.recording_url, title: null, source: 'juke', durationSeconds: null }]
        : [];

  // Identity enrichment: the host fid + every participant fid we tracked.
  const participantEntries = Array.isArray(space.participants) ? space.participants : [];
  const fids = [
    ...(space.created_by_fid ? [space.created_by_fid] : []),
    ...participantEntries.map((p) => p.fid),
  ];
  const profiles = await fetchProfilesByFids(fids, ENV.NEYNAR_API_KEY);

  function profileFor(fid: number, fallbackDisplayName?: string | null): FarcasterProfile {
    return (
      profiles.get(fid) ?? {
        fid,
        username: null,
        display_name: fallbackDisplayName ?? null,
        pfp_url: null,
      }
    );
  }

  const host: FarcasterProfile | null =
    space.created_by_fid > 0 ? profileFor(space.created_by_fid) : null;

  const participants = participantEntries.map((p) => ({
    ...profileFor(p.fid, p.display_name),
    role: p.role,
  }));

  const payload: RecapResponse = {
    ok: true,
    generatedAt: new Date().toISOString(),
    space: {
      id: space.id,
      title: space.title,
      startedAt: space.started_at,
      endedAt: space.ended_at,
    },
    audio,
    host,
    participants,
    pipeline: {
      repo: 'https://github.com/99darwin/juke-space-recap',
      note: 'Offline render: download the audio, run the pipeline (transcribe → intros → pfps → render). These profiles pre-fill the per-guest username step for participants Zuke already tracked.',
    },
  };

  return NextResponse.json(payload);
}
