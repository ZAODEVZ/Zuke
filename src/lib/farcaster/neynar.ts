/**
 * Minimal Neynar client for Farcaster identity enrichment — SERVER ONLY.
 *
 * Used by the recap bridge (GET /api/recordings/recap) to turn the fids Zuke
 * already stores (juke_spaces.created_by_fid + participants[].fid) into the
 * username + display_name + PFP the juke-space-recap Remotion pipeline renders.
 * Direct REST (no SDK coupling) mirroring the pipeline's own scripts/lib/neynar.ts.
 *
 * Never import from a client component — the API key is server-only.
 */
const NEYNAR_BASE = 'https://api.neynar.com/v2';
const REQUEST_TIMEOUT_MS = 10_000;

/** A resolved Farcaster profile, in the shape the recap pipeline consumes. */
export interface FarcasterProfile {
  fid: number;
  username: string | null;
  display_name: string | null;
  pfp_url: string | null;
}

interface NeynarBulkUser {
  fid: number;
  username?: string;
  display_name?: string;
  pfp_url?: string;
}

/**
 * Resolve a batch of fids to profiles via Neynar's bulk endpoint. Best-effort:
 * returns an empty map (rather than throwing) when the key is unset or Neynar
 * is unreachable, so the recap endpoint still returns audio + bare participants.
 * Neynar caps bulk lookups at 100 fids/request; we chunk accordingly.
 */
export async function fetchProfilesByFids(
  fids: number[],
  apiKey: string,
): Promise<Map<number, FarcasterProfile>> {
  const out = new Map<number, FarcasterProfile>();
  const unique = [...new Set(fids.filter((f) => Number.isFinite(f) && f > 0))];
  if (unique.length === 0 || !apiKey) return out;

  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const url = `${NEYNAR_BASE}/farcaster/user/bulk?fids=${chunk.join(',')}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network/timeout — skip this chunk, return what we have.
      continue;
    }
    if (!res.ok) continue;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      continue;
    }
    const users = (body as { users?: NeynarBulkUser[] }).users;
    if (!Array.isArray(users)) continue;
    for (const u of users) {
      if (typeof u.fid !== 'number') continue;
      out.set(u.fid, {
        fid: u.fid,
        username: u.username ?? null,
        display_name: u.display_name ?? null,
        pfp_url: u.pfp_url ?? null,
      });
    }
  }
  return out;
}
