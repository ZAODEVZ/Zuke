/**
 * The `'hms'` (100ms) live-audio provider — STUB.
 *
 * Exists to prove the {@link LiveAudioProvider} interface fits a
 * full-control second backend; every method is a typed TODO and no 100ms SDK
 * is installed yet. The real implementation will be ported from the old
 * ZAO OS monorepo and must carry its session-integrity guarantees:
 *
 *   TODO(hms-port): webhook event dedup (idempotency table, like
 *                   juke_webhook_events.signature_hash).
 *   TODO(hms-port): one-open-session-per-room unique index in the DB.
 *   TODO(hms-port): stale-room sweeper (cron reconcile against the 100ms
 *                   API, like /api/cron/juke-stale-rooms).
 *
 * Explicitly NOT ported: the old holder-gate. Listening on Zuke is OPEN —
 * do not add ZAO-token gating to any listener path (locked product
 * decision).
 *
 * When the SDK lands, its client components must load via `next/dynamic` so
 * the Juke path never downloads the 100ms bundle.
 */
import { NextResponse } from 'next/server';
import type {
  CreateRoomInput,
  CreateRoomResult,
  EndRoomResult,
  GetEmbedOptions,
  LiveAudioProvider,
  RoomEmbed,
} from './types';

const NOT_IMPLEMENTED = 'The 100ms (hms) provider is not implemented yet';

export const hmsProvider: LiveAudioProvider = {
  provider: 'hms',

  isValidRoomId(value: unknown): value is string {
    // TODO(hms-port): 100ms room ids are hex strings; validate the real
    // shape once the port lands. Reject everything until then so no route
    // can accidentally render an HMS embed.
    void value;
    return false;
  },

  async createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
    // TODO(hms-port): create the room via the 100ms management API
    // (HMS_ACCESS_KEY / HMS_SECRET server-side), honouring `record` via a
    // room template with recording enabled. `announceCast` / `allowAgents`
    // are Juke-specific and ignored here.
    void input;
    return { ok: false, status: 501, error: NOT_IMPLEMENTED };
  },

  async getEmbed(roomId: string, options: GetEmbedOptions = {}): Promise<RoomEmbed> {
    // TODO(hms-port): mint a short-TTL 100ms auth token server-side (this is
    // why the interface is async) and return our own /live player URL —
    // 100ms has no hosted share page / OG image, so pageUrl/ogImageUrl stay
    // null and we render our own surfaces.
    void roomId;
    void options;
    throw new Error(NOT_IMPLEMENTED);
  },

  async endRoom(roomId: string): Promise<EndRoomResult> {
    // TODO(hms-port): end the room via the 100ms management API, then let
    // the session-end webhook drive the DB lifecycle update (same
    // webhook-is-source-of-truth pattern as the Juke provider).
    void roomId;
    return { ok: false, status: 501, error: NOT_IMPLEMENTED };
  },

  async handleWebhook(req: Request): Promise<Response> {
    // TODO(hms-port): verify the 100ms webhook (shared-secret header),
    // dedupe on event id (session-integrity guarantee #1), and apply
    // session lifecycle side effects. Until then, refuse deliveries.
    void req;
    return NextResponse.json({ ok: false, error: NOT_IMPLEMENTED }, { status: 501 });
  },
};
