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

/** Where a recording came from. */
export type RecordingSource = 'juke' | 'upload' | 'snippet';

export interface RecordingRow {
  id: string;
  space_id: string;
  provider: LiveAudioProviderId;
  source: RecordingSource;
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
  const { data, error } = await sb
    .from('juke_recordings')
    .insert({
      space_id: input.spaceId,
      url: input.url,
      source: input.source,
      provider: input.provider ?? 'juke',
      parent_id: input.parentId ?? null,
      part_index: input.partIndex ?? 0,
      title: input.title ?? null,
      storage_path: input.storagePath ?? null,
      duration_seconds: input.durationSeconds ?? null,
      start_seconds: input.startSeconds ?? null,
      end_seconds: input.endSeconds ?? null,
      created_by_fid: input.createdByFid ?? 0,
    })
    .select('*')
    .single();
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
