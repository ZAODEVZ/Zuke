/**
 * Juke developer API client — SERVER ONLY (Path B of doc 695).
 *
 * Creates branded Juke spaces for recurring ZAO events via the Juke developer
 * API (`api.juke.audio`). Path A (the iframe embed in `juke.ts`) needs no
 * keys; Path B sends `X-Juke-Api-Key` ONLY (per juke.audio/llms.txt, verified
 * 2026-05-22): "`/v1/developer/spaces` — key only. Send `X-Juke-Api-Key`; do
 * not send a bearer JWT. The room owner is derived from the key's owning
 * developer app's `owner_fid`."
 *
 * The juke.audio/developers landing page still shows a stale example with a
 * Bearer `JUKE_USER_TOKEN` — llms.txt (the canonical agent-facing spec) is
 * authoritative. See research docs 695 + 710 + the supersession note in the
 * 2026-05-22 patch.
 *
 * IMPORTANT: never import this module from a client component. The api key is
 * passed in by the caller (the API route reads it from the environment), so
 * this file holds no secret literal — but the Juke developer API surface is
 * server-only regardless.
 *
 * The Juke developer API is in beta; its create-space *response* shape is not
 * publicly documented. `createJukeSpace` parses the response defensively and
 * only trusts a space id that passes `isValidJukeSpaceId`.
 */
import { isValidJukeSpaceId, jukeEmbedUrl } from './juke';

/** Base origin of the Juke REST API (distinct from the juke.audio web app). */
export const JUKE_API_ORIGIN = 'https://api.juke.audio';

/** Path of the developer create-space endpoint. */
const CREATE_SPACE_PATH = '/v1/developer/spaces';

/** Abort the Juke request if it has not responded within this many ms. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Input for creating a Juke space — the ZAO-facing, camelCase shape. */
export interface CreateJukeSpaceInput {
  /** Human-readable space title, e.g. "ZAOstock Tuesday Standup". */
  title: string;
  /**
   * ISO-8601 start time for a scheduled space, or null/omitted to open the
   * space immediately.
   */
  scheduledAt?: string | null;
  /** When true, Juke posts an announcement cast for the space. */
  announceCast?: boolean;
  /** When true, AI agents are permitted to join the room. */
  allowAgents?: boolean;
  /**
   * NOT SENT to Juke's create-space body anymore - kept on this type only so
   * the field doesn't disappear from the wider CreateRoomInput/route contract
   * (a bigger, separate change). Juke's API used to accept `record` at create
   * time; as of 2026-07 it now 422s with "extra_forbidden" on ANY unrecognised
   * body field, which was silently breaking every single space creation
   * (found while verifying create-space works end to end in prod). Juke's
   * current docs (juke.audio/SKILL.md, "Can users record the space?") say
   * recording is now a host-side toggle via a separate
   * `POST /v1/rooms/{spaceId}/recording/start|stop` call after the room
   * exists - NOT wired up here, since that endpoint's auth model isn't
   * documented with a code example the way create-space is, and guessing at
   * it risks shipping another broken integration silently. Passing `record`
   * here is a harmless no-op until that follow-up lands.
   */
  record?: boolean;
  /** Optional space description shown inside the Juke embed. */
  description?: string;
}

/** A Juke space created through the developer API. */
export interface JukeSpace {
  /** Juke space id — validated, safe to interpolate into URLs. */
  id: string;
  /** Embed URL for the space; `/live/{id}` renders this iframe. */
  embedUrl: string;
  /** The raw, undocumented Juke response, for callers that need more. */
  raw: unknown;
}

/** Result of {@link createJukeSpace} — a discriminated union; never throws. */
export type CreateJukeSpaceResult =
  | { ok: true; space: JukeSpace }
  | { ok: false; status: number; error: string };

/**
 * Credentials for a Juke developer API call. `POST /v1/developer/spaces` is
 * key-only per llms.txt: `X-Juke-Api-Key` authorises the app and the room
 * owner is derived from `app.owner_fid` — no bearer JWT is sent.
 */
export interface JukeCredentials {
  /** `JUKE_API_KEY` — the app's static developer secret (juke.audio/developers). */
  apiKey: string;
}

/** Id fields the Juke response is most likely to use, in priority order. */
const ID_KEYS = ['id', 'space_id', 'spaceId', 'room_id', 'roomId'] as const;
/** Nested objects the space id may live under one level deep. */
const NESTED_KEYS = ['space', 'room', 'data'] as const;

/**
 * Pull a Juke space id out of the (undocumented) create-space response.
 * Checks the id fields Juke is most likely to use, at the top level and one
 * level deep, and returns the first that is a structurally valid space id.
 *
 * Exported for unit testing — the defensive parsing is the part most likely
 * to break when Juke finalises its response shape.
 */
export function extractSpaceId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;

  for (const key of ID_KEYS) {
    if (isValidJukeSpaceId(record[key])) return record[key];
  }

  for (const nestedKey of NESTED_KEYS) {
    const nested = record[nestedKey];
    if (typeof nested === 'object' && nested !== null) {
      const nestedRecord = nested as Record<string, unknown>;
      for (const key of ID_KEYS) {
        if (isValidJukeSpaceId(nestedRecord[key])) return nestedRecord[key];
      }
    }
  }

  return null;
}

/**
 * Create a Juke space through the developer API.
 *
 * @param input       The space to create.
 * @param credentials The `JUKE_API_KEY` (key-only per llms.txt), passed in by
 *                    the caller — this module never reads it from the
 *                    environment itself.
 * @returns A {@link CreateJukeSpaceResult}. This function does not throw:
 *          network, timeout, and parse failures are returned as
 *          `{ ok: false }` so callers handle one shape.
 */
export async function createJukeSpace(
  input: CreateJukeSpaceInput,
  credentials: JukeCredentials,
): Promise<CreateJukeSpaceResult> {
  // Translate the camelCase ZAO shape into Juke's documented snake_case body.
  // `record` is deliberately NOT included - see CreateJukeSpaceInput's
  // `record` field doc for why (Juke's schema now 422s on any unrecognised
  // field, which was breaking every single create-space call).
  const body = JSON.stringify({
    title: input.title,
    description: input.description ?? undefined,
    scheduled_at: input.scheduledAt ?? null,
    announce_cast: input.announceCast ?? false,
    allow_agents: input.allowAgents ?? false,
  });

  let response: Response;
  try {
    response = await fetch(`${JUKE_API_ORIGIN}${CREATE_SPACE_PATH}`, {
      method: 'POST',
      headers: {
        // Key-only per llms.txt; the room owner is app.owner_fid.
        'X-Juke-Api-Key': credentials.apiKey,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      status: 502,
      error: timedOut ? 'Juke API timed out' : 'Could not reach the Juke API',
    };
  }

  if (!response.ok) {
    // Surface Juke's actual response body instead of discarding it - a
    // generic "Juke API returned 422" gives no way to diagnose a real
    // validation failure without this. Also surface a few response headers
    // (content-type, server) since an empty body on an error status can mean
    // an intermediary (CDN/WAF) rejected the request before it ever reached
    // Juke's own application code.
    const bodyText = (await response.text().catch(() => '')).slice(0, 500);
    const contentType = response.headers.get('content-type') ?? '';
    const server = response.headers.get('server') ?? '';
    const via = response.headers.get('via') ?? '';
    const headerHint = !bodyText ? ` [content-type=${contentType} server=${server} via=${via}]` : '';
    return {
      ok: false,
      status: response.status,
      error: `Juke API returned ${response.status}${bodyText ? `: ${bodyText}` : headerHint}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502, error: 'Juke API returned invalid JSON' };
  }

  const spaceId = extractSpaceId(payload);
  if (!spaceId) {
    return {
      ok: false,
      status: 502,
      error: 'Juke API response did not include a usable space id',
    };
  }

  return {
    ok: true,
    space: { id: spaceId, embedUrl: jukeEmbedUrl(spaceId), raw: payload },
  };
}
