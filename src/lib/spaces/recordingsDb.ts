/**
 * Supabase helpers for the `juke_recordings` table — multi-part recordings,
 * host/admin uploads, and snippets. See `scripts/juke-spaces-migration-4.sql`.
 *
 * A space (juke_spaces row) has many recordings:
 *   - source 'juke'    : parts delivered by the recording.ready webhook
 *   - source 'upload'  : audio a host/admin uploaded into Zuke storage
 *   - source 'snippet' : a clip of a parent recording (parent_id + start/end)
 *
 * The legacy single `juke_spaces.recording_url` is kept in sync (primary part)
 * for back-compat; this table is the multi-part source of truth.
 *
 * Helpers are best-effort about a MISSING table: if migration #4 has not been
 * applied yet they degrade (empty list / silent skip) instead of 500-ing, the
 * same posture jukeSpacesDb.ts takes for the participants column.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import type { LiveAudioProviderId } from './providers/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabaseAdmin as any;

/** Where a recording came from. 'recap' is the rendered recap VIDEO (output of
 * the juke-space-recap pipeline), attached back to its space by URL. */
export type RecordingSource = 'juke' | 'upload' | 'snippet' | 'import' | 'recap';

/** Whether the row points at an audio file or a video (the recap render). */
export type RecordingKind = 'audio' | 'video';

export interface RecordingRow {
  id: string;
  space_id: string;
  provider: LiveAudioProviderId;
  source: RecordingSource;
  kind: RecordingKind;
  parent_id: string | null;
  part_index: number;
  title: string | null;
  url: string;
  storage_path: string | null;
  duration_seconds: number | null;
  start_seconds: number | null;
  end_seconds: number | null;
  created_by_fid: number;
  created_at: string;
}

/** True when the error is "relation juke_recordings does not exist" (migration
 * #4 not applied yet). Used to degrade gracefully rather than throw. */
function isMissingTable(message: string): boolean {
  return /juke_recordings/i.test(message) && /(does not exist|not find|schema cache)/i.test(message);
}

export interface InsertRecordingInput {
  spaceId: string;
  url: string;
  source: RecordingSource;
  kind?: RecordingKind;
  provider?: LiveAudioProviderId;
  parentId?: string | null;
  partIndex?: number;
  title?: string | null;
  storagePath?: string | null;
  durationSeconds?: number | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  createdByFid?: number;
}

/**
 * Insert one recording row and return it. Returns `null` when the table is
 * missing (migration not applied) so webhook/route callers can no-op without
 * blocking their primary work.
 */
export async function insertRecording(input: InsertRecordingInput): Promise<RecordingRow | null> {
  const row: Record<string, unknown> = {
    space_id: input.spaceId,
    url: input.url,
    source: input.source,
    kind: input.kind ?? 'audio',
    provider: input.provider ?? 'juke',
    parent_id: input.parentId ?? null,
    part_index: input.partIndex ?? 0,
    title: input.title ?? null,
    storage_path: input.storagePath ?? null,
    duration_seconds: input.durationSeconds ?? null,
    start_seconds: input.startSeconds ?? null,
    end_seconds: input.endSeconds ?? null,
    created_by_fid: input.createdByFid ?? 0,
  };

  let { data, error } = await sb.from('juke_recordings').insert(row).select('*').single();

  // `kind` column missing = migration #5 not applied yet. Retry without it ONLY
  // for audio (the column default) so audio uploads keep working on a partially-
  // migrated DB. A 'video' recap must NOT silently downgrade to audio, so we let
  // its error propagate — the recap-video route turns that into a 503 telling
  // the caller to apply migration #5.
  const desiredKind = input.kind ?? 'audio';
  if (error && desiredKind === 'audio' && /column .*kind/i.test(error.message)) {
    const withoutKind = { ...row };
    delete withoutKind.kind;
    ({ data, error } = await sb.from('juke_recordings').insert(withoutKind).select('*').single());
  }

  if (error) {
    // 23505 = unique_violation — a retried recording.ready for a URL we already
    // stored. Treat as an idempotent no-op, not an error.
    if ((error as { code?: string }).code === '23505') return null;
    if (isMissingTable(error.message)) return null;
    throw new Error(`insertRecording failed: ${error.message}`);
  }
  return data as RecordingRow;
}

/** All recordings for a space, parts first then snippets, oldest part first. */
export async function listRecordingsForSpace(spaceId: string): Promise<RecordingRow[]> {
  const { data, error } = await sb
    .from('juke_recordings')
    .select('*')
    .eq('space_id', spaceId)
    .order('part_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error.message)) return [];
    throw new Error(`listRecordingsForSpace failed: ${error.message}`);
  }
  return (data ?? []) as RecordingRow[];
}

/** Read one recording by id — used to validate a snippet's parent. */
export async function getRecording(id: string): Promise<RecordingRow | null> {
  const { data, error } = await sb
    .from('juke_recordings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(`getRecording failed: ${error.message}`);
  }
  return (data as RecordingRow | null) ?? null;
}

/**
 * Distinct space IDs that have at least one non-snippet recording in
 * juke_recordings, ordered by most-recently created. Powers the recordings
 * shelf so upload-only and X-import spaces appear alongside juke auto-recordings.
 * Falls back to [] when the table is missing (migration #4 not applied yet).
 */
export async function listRecentRecordedSpaceIds(limit = 25): Promise<string[]> {
  const { data, error } = await sb
    .from('juke_recordings')
    .select('space_id, created_at')
    .neq('source', 'snippet')
    .order('created_at', { ascending: false })
    .limit(limit * 4); // over-fetch to account for dupes
  if (error) {
    if (isMissingTable(error.message)) return [];
    throw new Error(`listRecentRecordedSpaceIds failed: ${error.message}`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of (data ?? []) as Array<{ space_id: string }>) {
    if (!seen.has(row.space_id)) {
      seen.add(row.space_id);
      ids.push(row.space_id);
      if (ids.length >= limit) break;
    }
  }
  return ids;
}

/** Count recordings already attached to a space — used to assign part_index. */
export async function countRecordingsForSpace(spaceId: string): Promise<number> {
  const { count, error } = await sb
    .from('juke_recordings')
    .select('*', { count: 'exact', head: true })
    .eq('space_id', spaceId);
  if (error) {
    if (isMissingTable(error.message)) return 0;
    throw new Error(`countRecordingsForSpace failed: ${error.message}`);
  }
  return count ?? 0;
}
