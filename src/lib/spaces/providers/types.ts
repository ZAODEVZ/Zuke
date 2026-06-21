/**
 * Provider abstraction for Zuke's live audio (PR 1 of the multi-provider
 * plan).
 *
 * Zuke's primary backend is Juke (juke.audio, Farcaster-native hosted embed),
 * but the product direction is multi-provider: 100ms/HMS (full-control rooms,
 * recording, video), Stream.io, and Songjam (X/Twitter Spaces ingest) as
 * failover + capability options. This module defines the common seam those
 * backends plug into; `providers/juke.ts` wraps the existing Juke code behind
 * it and `providers/index.ts` resolves a provider by id (default `'juke'`).
 *
 * Product decision (locked): listening is OPEN — anyone with the link can
 * listen, with NO token-holder gate on the listener path. Creation stays
 * gated (admin FIDs / JUKE_CREATE_PASSWORD). Providers must not introduce
 * listener gating.
 */

/**
 * Every live-audio backend Zuke knows about. `'juke'` and `'hms'` have
 * implementations (`'hms'` is a stub until the ZAO OS port lands);
 * `'stream'` and `'songjam'` are reserved ids so rows / configs written today
 * stay valid when those providers ship.
 */
export type LiveAudioProviderId = 'juke' | 'hms' | 'stream' | 'songjam';

/**
 * Provider-agnostic create-room input — the superset of what `/live/create`
 * collects today. Field semantics follow the existing Juke shape
 * (`CreateJukeSpaceInput`) so the `'juke'` provider is a pass-through.
 * Providers ignore fields they cannot honour (e.g. `announceCast` is
 * Farcaster-specific; HMS would skip it).
 */
export interface CreateRoomInput {
  /** Human-readable room title, e.g. "ZAOstock Tuesday Standup". */
  title: string;
  /** Optional room description shown inside the embed. */
  description?: string;
  /**
   * ISO-8601 start time for a scheduled room, or null/omitted to open the
   * room immediately.
   */
  scheduledAt?: string | null;
  /** When true, the provider records the room (drives /live/recordings). */
  record?: boolean;
  /** When true, the provider posts an announcement cast (Juke-only today). */
  announceCast?: boolean;
  /** When true, AI agents are permitted to join the room (Juke-only today). */
  allowAgents?: boolean;
}

/** A room successfully created on a provider. */
export interface CreatedRoom {
  /** Which backend hosts the room — persisted on the DB row. */
  provider: LiveAudioProviderId;
  /** Provider room id — validated, safe to interpolate into URLs. */
  id: string;
  /** Embed URL for the room; `/live/{id}` renders this. */
  embedUrl: string;
  /** The raw provider response, for callers that need more. */
  raw: unknown;
}

/** Result of {@link LiveAudioProvider.createRoom} — never throws. */
export type CreateRoomResult =
  | { ok: true; room: CreatedRoom }
  | { ok: false; status: number; error: string };

/**
 * Options for {@link LiveAudioProvider.getEmbed}. Mirrors the existing
 * `JukeEmbedOptions`; providers ignore options they do not support.
 */
export interface GetEmbedOptions {
  /** Passive second-screen view: metadata + participants, no audio. */
  audioOff?: boolean;
  /**
   * Provider SSO token (Juke: partner-SSO JWT from /api/juke/partner-token)
   * so the embed renders already-authenticated. Short-TTL; refetch per mount.
   */
  partnerToken?: string;
}

/**
 * Everything `/live/{id}` needs to render a room for one provider. Nullable
 * fields are surfaces a backend may simply not have (HMS rooms have no
 * native share page or OG image — we render our own).
 */
export interface RoomEmbed {
  provider: LiveAudioProviderId;
  /** Iframe / player URL for the room. */
  embedUrl: string;
  /** Canonical share/permalink URL on the provider, if it has one. */
  pageUrl: string | null;
  /** Native-app deeplink ("Open in Juke app"), if the provider has one. */
  deeplinkUrl: string | null;
  /** Provider-rendered OG image for the room, if it has one. */
  ogImageUrl: string | null;
}

/** Result of {@link LiveAudioProvider.endRoom} — never throws. */
export type EndRoomResult =
  | { ok: true; status: number; raw: unknown }
  | { ok: false; status: number; error: string; raw?: unknown };

/**
 * One live-audio backend. Implementations are SERVER ONLY (they read API
 * keys from the environment) — never import a provider from a client
 * component. Per-provider client SDK components must load via `next/dynamic`
 * so the Juke path never downloads HMS/Stream SDKs.
 */
export interface LiveAudioProvider {
  /** Literal id this provider registers under, e.g. `'juke'`. */
  readonly provider: LiveAudioProviderId;

  /**
   * True when `value` is a structurally valid room id for this backend —
   * the gate before an untrusted path segment may reach {@link getEmbed}.
   */
  isValidRoomId(value: unknown): value is string;

  /**
   * Create a room on the backend. Auth (admin session / create-password) is
   * the calling route's job; the provider only talks to its upstream API.
   * Missing server configuration (no API key) is reported as
   * `{ ok: false, status: 503 }`, never thrown.
   */
  createRoom(input: CreateRoomInput): Promise<CreateRoomResult>;

  /**
   * Build the embed/render information for a room. Async because some
   * backends mint per-view tokens server-side (HMS auth tokens; Juke does
   * its partner-token fetch separately today).
   *
   * @throws if `roomId` is not valid for this backend — callers must check
   *         {@link isValidRoomId} (and 404) first.
   */
  getEmbed(roomId: string, options?: GetEmbedOptions): Promise<RoomEmbed>;

  /**
   * End the room for everyone on the backend. DB lifecycle updates stay with
   * the caller / webhook handlers (see /api/juke/admin/end-space: the
   * inbound `room.finished` webhook is the source of truth, so API ends and
   * natural ends share one code path).
   */
  endRoom(roomId: string): Promise<EndRoomResult>;

  /**
   * Handle one inbound webhook delivery from the backend: verify the
   * signature, dedupe, apply side effects, and return the HTTP response the
   * route should send. Takes a web `Request` (what Next 16 route handlers
   * receive) so a future `/api/live/webhooks/[provider]` route can dispatch
   * here directly.
   */
  handleWebhook(req: Request): Promise<Response>;
}
