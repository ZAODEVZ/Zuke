/**
 * X (Twitter) Spaces import helpers.
 *
 * Zuke cannot re-broadcast a live X Space (that is real-time ingest — Songjam
 * territory). What it CAN do is IMPORT a past X Space as an ended recording:
 * the host downloads the Space audio (yt-dlp / SpacesDown / Flowjin / ...) and
 * brings it in, where it joins the recordings shelf, snippets, and the recap
 * pipeline. Imported Spaces are tagged with the `'songjam'` provider — the
 * X/Twitter ingest backend reserved in the multi-provider plan.
 *
 * Pure module (no `@/` imports) so the URL parsing is unit-testable.
 */
import type { LiveAudioProviderId } from './providers/types';

/** Provider tag every imported X Space row carries. */
export const X_SPACE_PROVIDER: LiveAudioProviderId = 'songjam';

/** An X Space id is the base62-ish token after `/spaces/`, e.g. 1YpKkZWBplYxj. */
const X_SPACE_ID_PATTERN = /^[A-Za-z0-9]{6,32}$/;

/** Hosts whose `/i/spaces/{id}` (or `/spaces/{id}`) links we recognise. */
const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);

export interface ParsedXSpace {
  /** The raw X Space id, e.g. `1YpKkZWBplYxj`. */
  xSpaceId: string;
  /** Stable Zuke space id derived from it (`x-{id}`) — a valid Juke space id. */
  zukeId: string;
  /** Canonical X Space URL we store + link back to. */
  url: string;
}

/** True when `value` is a structurally valid X Space id. */
export function isValidXSpaceId(value: unknown): value is string {
  return typeof value === 'string' && X_SPACE_ID_PATTERN.test(value);
}

/** The Zuke space id we mint for an imported X Space. `x-` prefix keeps it
 * namespaced + collision-free against Juke ids, and it satisfies the Juke
 * space-id charset (`[A-Za-z0-9_-]`) so /live/{id} routes to it unchanged. */
export function zukeIdForXSpace(xSpaceId: string): string {
  return `x-${xSpaceId}`;
}

/**
 * Parse a pasted X Space link (or a bare Space id) into the ids + canonical
 * URL Zuke stores. Returns `null` for anything that is not an X Spaces link or
 * a valid bare id, so the import route can 400 with a clear message instead of
 * minting a dead space.
 */
export function parseXSpaceUrl(input: string): ParsedXSpace | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare id pasted directly.
  if (isValidXSpaceId(trimmed)) {
    return {
      xSpaceId: trimmed,
      zukeId: zukeIdForXSpace(trimmed),
      url: `https://x.com/i/spaces/${trimmed}`,
    };
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!X_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  // Accept /i/spaces/{id} and /spaces/{id}; the id is the segment after spaces.
  const segments = parsed.pathname.split('/').filter(Boolean);
  const spacesIdx = segments.indexOf('spaces');
  if (spacesIdx === -1 || spacesIdx === segments.length - 1) return null;
  const xSpaceId = segments[spacesIdx + 1];
  if (!isValidXSpaceId(xSpaceId)) return null;

  return {
    xSpaceId,
    zukeId: zukeIdForXSpace(xSpaceId),
    url: `https://x.com/i/spaces/${xSpaceId}`,
  };
}
