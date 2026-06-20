import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionData } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { isValidJukeSpaceId } from '@/lib/spaces/juke';
import { getJukeSpace } from '@/lib/spaces/jukeSpacesDb';
import { countRecordingsForSpace, insertRecording } from '@/lib/spaces/recordingsDb';
import {
  ALLOWED_AUDIO_TYPES,
  MAX_UPLOAD_BYTES,
  uploadRecordingFile,
} from '@/lib/spaces/recordingsStorage';

/**
 * POST /api/recordings/upload — attach an uploaded audio file to a space.
 *
 * Multipart form-data:
 *   file     the audio file (mp3 / m4a / ogg / wav / webm, <= 200 MB)
 *   spaceId  the juke_spaces id to attach it to
 *   title    optional label (e.g. "Part 2", "Guest intro clip")
 *
 * Auth: admin OR the space host (created_by_fid === session.fid). This is the
 * "upload and use Juke recordings" path — for spaces recorded outside Juke's
 * auto-recording (e.g. a local capture, a multi-part export) or extra audio a
 * host wants on the recap shelf. The file goes to the public `recordings`
 * Supabase Storage bucket; the route is gated so only authorized users write.
 */

const ACCEPTED = new Set<string>(ALLOWED_AUDIO_TYPES);

const fieldsSchema = z.object({
  spaceId: z.string().refine(isValidJukeSpaceId, { message: 'Invalid space id' }),
  title: z.string().trim().max(200).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionData();
  if (!session?.fid && !session?.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Body must be multipart/form-data' },
      { status: 400 },
    );
  }

  const parsed = fieldsSchema.safeParse({
    spaceId: form.get('spaceId'),
    title: form.get('title') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid fields', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { spaceId, title } = parsed.data;

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 });
  }
  if (!ACCEPTED.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported audio type: ${file.type || 'unknown'}` },
      { status: 415 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: 'File is empty' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'File exceeds the 200 MB limit' },
      { status: 413 },
    );
  }

  // The space must exist, and the caller must own it (or be an admin).
  const row = await getJukeSpace(spaceId);
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Space not found' }, { status: 404 });
  }
  const isHost = row.created_by_fid === session.fid;
  if (!session.isAdmin && !isHost) {
    return NextResponse.json(
      { ok: false, error: 'Only the host or an admin can add a recording' },
      { status: 403 },
    );
  }

  const bytes = await file.arrayBuffer();
  const upload = await uploadRecordingFile({ spaceId, bytes, contentType: file.type });
  if (!upload.ok) {
    logger.error('[recordings/upload] storage failed', upload.status, upload.error);
    return NextResponse.json({ ok: false, error: upload.error }, { status: upload.status });
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
      url: upload.stored.publicUrl,
      source: 'upload',
      provider: 'juke',
      partIndex,
      title: title ?? null,
      storagePath: upload.stored.path,
      createdByFid: session.fid,
    });
    return NextResponse.json({ ok: true, recording }, { status: 201 });
  } catch (err: unknown) {
    logger.error('[recordings/upload] insertRecording failed', err);
    return NextResponse.json(
      { ok: false, error: 'Uploaded the file but could not record it' },
      { status: 500 },
    );
  }
}

export const GET = (): NextResponse =>
  NextResponse.json(
    { ok: false, error: 'POST only — multipart/form-data with file + spaceId' },
    { status: 405 },
  );
