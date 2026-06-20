/**
 * Pure parsers for the recording fields of a Juke `recording.ready` webhook
 * body. Kept dependency-free (no `@/` imports) so they are trivially unit-
 * testable and reusable by the webhook handler.
 *
 * Juke now ships MULTI-PART recordings (@nickysap), but the payload schema is
 * not in llms.txt — so everything here is defensive and only consumes the
 * fields we recognise, across snake_case + camelCase aliases.
 */

/** Pull a single recording url from any reasonable place in the body. */
export function readRecordingUrl(body: unknown): string | null {
  const b = (body ?? {}) as {
    recording_url?: unknown;
    recordingUrl?: unknown;
    data?: unknown;
  };
  if (typeof b.recording_url === 'string') return b.recording_url;
  if (typeof b.recordingUrl === 'string') return b.recordingUrl;
  if (b.data && typeof b.data === 'object') {
    const d = b.data as { recording_url?: unknown; recordingUrl?: unknown; url?: unknown };
    if (typeof d.recording_url === 'string') return d.recording_url;
    if (typeof d.recordingUrl === 'string') return d.recordingUrl;
    if (typeof d.url === 'string') return d.url;
  }
  return null;
}

/** One recording part extracted from a recording.ready body. */
export interface RecordingPart {
  url: string;
  title: string | null;
  durationSeconds: number | null;
}

/** Coerce an unknown to a finite, non-negative integer of seconds, or null. */
function readDurationSeconds(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Extract recording PARTS from a recording.ready body. The payload may carry an
 * array of parts under `data.parts` / `data.recordings` (each a url string, or
 * an object with its own url + optional duration + title). Falls back to the
 * single-url shape ({@link readRecordingUrl}) so older deliveries + the test
 * fixtures still resolve to exactly one part. Order is preserved — the first
 * part becomes the primary (juke_spaces.recording_url) for back-compat.
 */
export function readRecordingParts(body: unknown): RecordingPart[] {
  const b = (body ?? {}) as { data?: Record<string, unknown> };
  const data = (b.data ?? {}) as { parts?: unknown; recordings?: unknown };
  const rawArray = Array.isArray(data.parts)
    ? data.parts
    : Array.isArray(data.recordings)
      ? data.recordings
      : null;

  if (rawArray) {
    const parts: RecordingPart[] = [];
    for (const entry of rawArray) {
      if (typeof entry === 'string') {
        parts.push({ url: entry, title: null, durationSeconds: null });
        continue;
      }
      if (typeof entry === 'object' && entry !== null) {
        const e = entry as {
          url?: unknown;
          recording_url?: unknown;
          recordingUrl?: unknown;
          title?: unknown;
          name?: unknown;
          duration?: unknown;
          duration_seconds?: unknown;
        };
        const url =
          typeof e.url === 'string'
            ? e.url
            : typeof e.recording_url === 'string'
              ? e.recording_url
              : typeof e.recordingUrl === 'string'
                ? e.recordingUrl
                : null;
        if (!url) continue;
        const title =
          typeof e.title === 'string' ? e.title : typeof e.name === 'string' ? e.name : null;
        parts.push({
          url,
          title,
          durationSeconds: readDurationSeconds(e.duration ?? e.duration_seconds),
        });
      }
    }
    if (parts.length > 0) return parts;
  }

  const single = readRecordingUrl(body);
  return single ? [{ url: single, title: null, durationSeconds: null }] : [];
}
