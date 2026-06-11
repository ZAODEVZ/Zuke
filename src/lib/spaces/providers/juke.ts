/**
 * The `'juke'` live-audio provider — Zuke's primary backend, wrapped behind
 * the {@link LiveAudioProvider} seam.
 *
 * This file is glue only: every behavior lives in the existing Juke modules
 * (`../juke`, `../juke-api`, the `/api/juke/webhooks` route) and is reused
 * verbatim so this PR changes nothing observable. SERVER ONLY — `createRoom`
 * and `endRoom` read `JUKE_API_KEY` from the environment.
 */
import { ENV } from '../../env';
import { logger } from '../../logger';
import {
  isValidJukeSpaceId,
  jukeAppDeeplinkUrl,
  jukeEmbedUrl,
  jukeSpaceOgImageUrl,
  jukeSpaceUrl,
} from '../juke';
import { createJukeSpace, JUKE_API_ORIGIN } from '../juke-api';
import type {
  CreateRoomInput,
  CreateRoomResult,
  EndRoomResult,
  GetEmbedOptions,
  LiveAudioProvider,
  RoomEmbed,
} from './types';

/** Abort upstream Juke calls after this long — matches `../juke-api`. */
const REQUEST_TIMEOUT_MS = 10_000;

export const jukeProvider: LiveAudioProvider = {
  provider: 'juke',

  isValidRoomId(value: unknown): value is string {
    return isValidJukeSpaceId(value);
  },

  /**
   * Create a Juke space via `POST /v1/developer/spaces` (key-only auth per
   * llms.txt). Same upstream call + error shapes as /api/juke/space, which
   * keeps owning auth, validation, and the juke_spaces insert.
   */
  async createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
    const apiKey = ENV.JUKE_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        status: 503,
        error:
          'Juke developer API is not configured (missing JUKE_API_KEY). Apply at juke.audio/developers.',
      };
    }
    const result = await createJukeSpace(
      {
        title: input.title,
        description: input.description,
        scheduledAt: input.scheduledAt ?? null,
        announceCast: input.announceCast,
        allowAgents: input.allowAgents,
        record: input.record,
      },
      { apiKey },
    );
    if (!result.ok) {
      return { ok: false, status: result.status, error: result.error };
    }
    return {
      ok: true,
      room: {
        provider: 'juke',
        id: result.space.id,
        embedUrl: result.space.embedUrl,
        raw: result.space.raw,
      },
    };
  },

  /**
   * All four Juke URL surfaces come from the pure helpers in `../juke`.
   * Async only to satisfy the provider interface (HMS mints tokens here);
   * Juke's partner-SSO token is fetched separately and passed in via
   * `options.partnerToken`.
   */
  async getEmbed(roomId: string, options: GetEmbedOptions = {}): Promise<RoomEmbed> {
    return {
      provider: 'juke',
      embedUrl: jukeEmbedUrl(roomId, {
        audioOff: options.audioOff,
        partnerToken: options.partnerToken,
      }),
      pageUrl: jukeSpaceUrl(roomId),
      deeplinkUrl: jukeAppDeeplinkUrl(roomId),
      ogImageUrl: jukeSpaceOgImageUrl(roomId),
    };
  },

  /**
   * End the room for everyone via `POST /v1/developer/spaces/{id}/end`
   * (Nicky PR #174) — the same upstream call /api/juke/admin/end-space
   * makes. Deliberately NO DB writes here: the inbound `room.finished`
   * webhook (ended_via: "api") is the source of truth for the lifecycle
   * update, so API ends and natural ends share one code path. The 404
   * fallback (flip local status when Juke does not know the room) stays in
   * the route, next to the auth + DB context it needs.
   */
  async endRoom(roomId: string): Promise<EndRoomResult> {
    if (!isValidJukeSpaceId(roomId)) {
      return { ok: false, status: 400, error: 'Invalid Juke space id' };
    }
    const apiKey = ENV.JUKE_API_KEY;
    if (!apiKey) {
      return { ok: false, status: 503, error: 'JUKE_API_KEY not configured on the server' };
    }

    const endpoint = `${JUKE_API_ORIGIN}/v1/developer/spaces/${encodeURIComponent(roomId)}/end`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-Juke-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      logger.error('[providers/juke] end-room fetch failed', err);
      return { ok: false, status: 502, error: 'Juke end-space API unreachable' };
    }

    const text = await res.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = text;
    }

    if (!res.ok) {
      return { ok: false, status: res.status, error: `Juke returned ${res.status}`, raw };
    }
    return { ok: true, status: res.status, raw };
  },

  /**
   * Delegate to the existing `/api/juke/webhooks` route handler — the
   * verify → dedupe → apply pipeline stays in one place with zero drift.
   * Dynamic import keeps this lib module free of a static dependency on the
   * app directory (and of the route's transitive Supabase imports) until a
   * provider-generic webhook route replaces this delegation.
   */
  async handleWebhook(req: Request): Promise<Response> {
    const { POST } = await import('../../../app/api/juke/webhooks/route');
    // The route only uses `text()` + `headers` from NextRequest, both of
    // which the web Request it extends already provides.
    return POST(req as Parameters<typeof POST>[0]);
  },
};
