/**
 * Per-event handlers for the Juke outbound webhooks. The route in
 * `/api/juke/webhooks/route.ts` parses + HMAC-verifies the delivery, then
 * dispatches the parsed body here.
 *
 * Juke event vocabulary (per the 2026-05-23 PR):
 *
 *   - room.started        the host opened the room
 *   - room.finished       the room ended for everyone
 *   - participant.joined  someone joined the room
 *   - participant.left    someone left the room
 *   - recording.ready     the host had recording on and the file is ready
 *
 * Body shape is best-effort - we treat the inbound JSON defensively and only
 * consume the fields we recognise. Extra fields are stored verbatim in
 * `juke_webhook_events.body`.
 */
import { autoCastToZao } from '@/lib/publish/auto-cast';
import { ENV } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/zuke.config';
import { isAutoAgentJoinEnabled, joinAgentInJukeRoom } from './jukeAgentJoin';
import { getJukeRoomDetail } from './juke-api-reads';
import {
  addParticipant,
  bumpParticipantCount,
  getJukeSpace,
  insertNativeJukeSpace,
  removeParticipant,
  updateJukeSpace,
  type JukeParticipantEntry,
  type JukeSpaceStatus,
} from './jukeSpacesDb';
import { countRecordingsForSpace, insertRecording } from './recordingsDb';
import { readRecordingParts } from './recordingParts';

interface JukeWebhookBody {
  // Juke 2026-05-23 shape uses snake_case `event_type` + `event_id` at top level
  // and nests details under `data` (with `room_id`, `host_fid`, etc.). The
  // aliases below cover earlier-doc / alternative shapes we still see in tests
  // so the parser is defensive across versions.
  event?: string;
  type?: string;
  event_type?: string;
  event_id?: string;
  eventId?: string;
  data?: Record<string, unknown>;
  space?: Record<string, unknown>;
  space_id?: string;
  spaceId?: string;
  recording_url?: string;
  recordingUrl?: string;
  occurred_at?: string;
  occurredAt?: string;
}

export interface ParsedWebhookEvent {
  /** Normalised event name, e.g. `room.finished`. */
  eventType: string;
  /** Juke space id this event is for, when extractable from the body. */
  spaceId: string | null;
  /** Optional Juke-side event id, when present in the body. */
  eventId: string | null;
}

/**
 * Extract `eventType` + `spaceId` + `eventId` from the Juke body without
 * assuming a single shape. Juke's PR description names the events but the
 * payload schema is not yet in llms.txt — be defensive.
 */
export function parseWebhookEvent(body: unknown): ParsedWebhookEvent {
  const b = (body ?? {}) as JukeWebhookBody;
  const eventType = (b.event_type ?? b.event ?? b.type ?? '').toString();
  const data = (typeof b.data === 'object' && b.data !== null
    ? (b.data as { space_id?: string; spaceId?: string; id?: string; room_id?: string; roomId?: string })
    : null);
  const spaceId =
    b.space_id ??
    b.spaceId ??
    data?.room_id ??
    data?.roomId ??
    data?.space_id ??
    data?.spaceId ??
    data?.id ??
    (typeof b.space === 'object' && b.space !== null
      ? ((b.space as { id?: string }).id ?? null)
      : null) ??
    null;
  const eventId =
    b.event_id ??
    b.eventId ??
    (typeof b.data === 'object' && b.data !== null
      ? ((b.data as { id?: string; event_id?: string }).event_id ??
        (b.data as { id?: string; event_id?: string }).id ??
        null)
      : null) ??
    null;
  return { eventType, spaceId, eventId };
}

function readOccurredAt(body: unknown): string {
  const b = (body ?? {}) as JukeWebhookBody;
  return b.occurred_at ?? b.occurredAt ?? new Date().toISOString();
}

/**
 * Extract `ended_via` from a room.finished body. Lives on `data.ended_via`
 * per Nicky 2026-05-24 ship, with `endedVia` as a defensive camelCase alias.
 * `host` = iOS host-end, `api` = developer-API end (e.g. our End-space
 * button), undefined = LiveKit empty-room timeout.
 */
function readEndedVia(body: unknown): 'host' | 'api' | null {
  const b = (body ?? {}) as { data?: Record<string, unknown> };
  const d = (b.data ?? {}) as { ended_via?: unknown; endedVia?: unknown };
  const raw = d.ended_via ?? d.endedVia;
  if (raw === 'host' || raw === 'api') return raw;
  return null;
}

/** Pull a JukeParticipantEntry from a participant.joined/left body. Returns
 * null if no usable fid is present (Juke filters anon listeners + virtual
 * participants out, so an event without an fid is unexpected but possible). */
function readParticipant(body: unknown, occurredAt: string): JukeParticipantEntry | null {
  const b = (body ?? {}) as { data?: Record<string, unknown> };
  const d = (b.data ?? {}) as {
    fid?: unknown;
    host_fid?: unknown;
    participant_fid?: unknown;
    user_fid?: unknown;
    display_name?: unknown;
    displayName?: unknown;
    username?: unknown;
    role?: unknown;
  };
  // Juke's 2026-05-23 room.started used `host_fid`; participant events likely
  // use `participant_fid` or `fid`. Be defensive across aliases.
  const fidRaw = d.fid ?? d.participant_fid ?? d.user_fid ?? d.host_fid;
  const fid = typeof fidRaw === 'number' ? fidRaw : typeof fidRaw === 'string' ? Number(fidRaw) : null;
  if (fid === null || !Number.isFinite(fid)) return null;
  const display_name =
    typeof d.display_name === 'string'
      ? d.display_name
      : typeof d.displayName === 'string'
        ? d.displayName
        : typeof d.username === 'string'
          ? d.username
          : null;
  const role = typeof d.role === 'string' ? d.role : null;
  return { fid, display_name, role, joined_at: occurredAt };
}

/** Extra fields Juke's docs say only native-room webhook payloads carry:
 * https://juke.audio/SKILL.md - "Webhooks for native rooms: room.started and
 * room.finished fire with extra fields is_farcaster_native, farcaster_room_id,
 * host_mode, farcaster_host_fid." participant.joined/left and recording.ready
 * do NOT fire for native rooms at all - see the recording poll in
 * room.finished below for the workaround. */
interface NativeRoomMeta {
  isNative: boolean;
  hostMode: string | null;
  hostFid: number | null;
  farcasterRoomId: string | null;
}

function readNativeRoomMeta(body: unknown): NativeRoomMeta {
  const b = (body ?? {}) as { data?: Record<string, unknown> };
  const d = (b.data ?? {}) as {
    is_farcaster_native?: unknown;
    host_mode?: unknown;
    farcaster_host_fid?: unknown;
    farcaster_room_id?: unknown;
  };
  const hostFidRaw = d.farcaster_host_fid;
  const hostFid =
    typeof hostFidRaw === 'number' ? hostFidRaw : typeof hostFidRaw === 'string' ? Number(hostFidRaw) : null;
  return {
    isNative: d.is_farcaster_native === true,
    hostMode: typeof d.host_mode === 'string' ? d.host_mode : null,
    hostFid: hostFid !== null && Number.isFinite(hostFid) ? hostFid : null,
    farcasterRoomId: typeof d.farcaster_room_id === 'string' ? d.farcaster_room_id : null,
  };
}

/**
 * Backfill a juke_spaces row the first time Zuke sees ANY event for a
 * Farcaster-native room (one Zuke did not create via its own
 * POST /v1/developer/spaces call - e.g. a space hosted directly in Warpcast).
 * Without this, updateJukeSpace() below silently no-ops on every native-room
 * event forever, since there is no row for it to update. No-ops if a row
 * already exists, or if the event isn't tagged native at all.
 */
async function ensureNativeJukeSpaceExists(
  spaceId: string,
  meta: NativeRoomMeta,
  status: JukeSpaceStatus,
  occurredAt: string,
): Promise<void> {
  if (!meta.isNative) return;
  const existing = await getJukeSpace(spaceId);
  if (existing) return;

  let title = 'Farcaster live space';
  try {
    const detail = await getJukeRoomDetail(spaceId, ENV.JUKE_API_KEY);
    if (detail.ok && detail.data?.title) title = detail.data.title;
  } catch (err: unknown) {
    logger.warn('[juke/webhooks] getJukeRoomDetail failed while backfilling native space (non-fatal):', err);
  }

  await insertNativeJukeSpace({
    id: spaceId,
    title,
    createdByFid: meta.hostFid ?? 0,
    status,
    startedAt: status === 'active' ? occurredAt : null,
    raw: {
      is_farcaster_native: true,
      host_mode: meta.hostMode,
      farcaster_room_id: meta.farcasterRoomId,
      farcaster_host_fid: meta.hostFid,
    },
  });
}

/**
 * Apply the side effects for one verified, deduplicated webhook event.
 *
 * Errors are surfaced to the caller — the route persists the error message
 * on the corresponding `juke_webhook_events` row but always returns 200 so
 * Juke does not retry a handler bug forever.
 */
export async function applyWebhookEvent(
  eventType: string,
  spaceId: string | null,
  body: unknown,
): Promise<void> {
  if (!spaceId) {
    // Without a space id there is nothing to update. Acknowledge silently.
    return;
  }
  switch (eventType) {
    case 'room.started': {
      const startedAt = readOccurredAt(body);
      await ensureNativeJukeSpaceExists(spaceId, readNativeRoomMeta(body), 'active', startedAt);
      await updateJukeSpace(spaceId, { status: 'active', started_at: startedAt });
      // Optional: drop ZOE into the room as a partner-scoped agent. Gated
      // by ZAO_AUTO_AGENT_JOIN=true env var since agents are data-publish
      // only in Juke v1 (no audio yet) and we don't have a VPS consumer
      // for the session token yet. Flag exists so the wiring is in place
      // the moment ZOE-on-the-VPS is ready to consume sessions.
      if (isAutoAgentJoinEnabled()) {
        try {
          const join = await joinAgentInJukeRoom({ spaceId, agentName: 'ZOE' });
          if (join.ok && join.sessionToken) {
            logger.info('[juke/webhooks] auto agent-join ok', {
              spaceId,
              token_len: join.sessionToken.length,
            });
          } else if (!join.ok) {
            logger.warn('[juke/webhooks] auto agent-join failed', {
              spaceId,
              status: join.status,
              error: join.error,
            });
          }
        } catch (err: unknown) {
          logger.warn('[juke/webhooks] auto agent-join threw (non-fatal):', err);
        }
      }
      return;
    }
    case 'room.finished':
    case 'room.ended': {
      // Juke 2026-05-24 ship (Nicky PR #174): room.finished carries
      // `ended_via: "host" | "api"` on the payload. Omitted means LiveKit's
      // empty-room timeout fired (no human action). We log it so future
      // analysis can branch on it; the raw body also persists in
      // `juke_webhook_events`.
      const endedVia = readEndedVia(body);
      const occurredAt = readOccurredAt(body);
      const nativeMeta = readNativeRoomMeta(body);
      if (endedVia) {
        logger.info('[juke/webhooks] room.finished ended_via=' + endedVia, { spaceId });
      }
      await ensureNativeJukeSpaceExists(spaceId, nativeMeta, 'ended', occurredAt);
      await updateJukeSpace(spaceId, { status: 'ended', ended_at: occurredAt });

      // Native rooms never fire recording.ready (Juke's docs are explicit
      // about this) - poll once for a recording instead. This only catches a
      // recording that's already ready by the time room.finished arrives; a
      // recording Juke is still processing needs a later recheck (not built
      // yet - a natural extension of the juke-stale-rooms cron).
      if (nativeMeta.isNative) {
        try {
          const detail = await getJukeRoomDetail(spaceId, ENV.JUKE_API_KEY);
          if (detail.ok && detail.data?.recording_url) {
            const nextIndex = await countRecordingsForSpace(spaceId).catch(() => 0);
            if (nextIndex === 0) {
              await updateJukeSpace(spaceId, { recording_url: detail.data.recording_url });
            }
            await insertRecording({
              spaceId,
              url: detail.data.recording_url,
              source: 'juke',
              provider: 'juke',
              partIndex: nextIndex,
              title: null,
              durationSeconds: null,
            });
          } else {
            logger.info('[juke/webhooks] native room finished, no recording yet - needs a later recheck', {
              spaceId,
            });
          }
        } catch (err: unknown) {
          logger.warn('[juke/webhooks] native-room recording poll failed (non-fatal):', err);
        }
      }

      // Recap cast: fire only for real session ends (host or api). Idle
      // empty-room timeouts (endedVia=null) had nobody to recap to so we
      // stay quiet there. recording.ready emits a separate "Recording up"
      // follow-up cast with the link if recording was on, so this first
      // cast intentionally does NOT speculate about a recording.
      if (endedVia === 'host' || endedVia === 'api') {
        try {
          const row = await getJukeSpace(spaceId);
          const title = row?.title ?? 'A ZAO space';
          const liveUrl = `${getBaseUrl()}/live/${spaceId}`;
          const participants = Array.isArray(row?.participants)
            ? row.participants.length
            : 0;
          const lines = [`Just wrapped: ${title}`];
          if (participants > 0) {
            lines.push(
              `${participants} ZAO ${participants === 1 ? 'member' : 'members'} joined.`,
            );
          }
          lines.push(liveUrl);
          await autoCastToZao(lines.join('\n\n'), liveUrl);
        } catch (err: unknown) {
          logger.warn('[juke/webhooks] room.finished recap cast failed (non-fatal):', err);
        }
      }
      return;
    }
    case 'participant.joined': {
      await bumpParticipantCount(spaceId, +1);
      const p = readParticipant(body, readOccurredAt(body));
      if (p) await addParticipant(spaceId, p);
      return;
    }
    case 'participant.left': {
      await bumpParticipantCount(spaceId, -1);
      const p = readParticipant(body, readOccurredAt(body));
      if (p) await removeParticipant(spaceId, p.fid);
      return;
    }
    case 'recording.ready': {
      // Juke ships multi-part recordings, so a single delivery may carry
      // several parts. Persist every part as a juke_recordings row (idempotent
      // on the space_id+url unique index) and keep the legacy single
      // recording_url pointed at the FIRST part for back-compat.
      const parts = readRecordingParts(body);
      if (parts.length === 0) return;

      // part_index continues from whatever is already attached so a later
      // delivery (another part) appends rather than colliding.
      let nextIndex = 0;
      try {
        nextIndex = await countRecordingsForSpace(spaceId);
      } catch (err: unknown) {
        logger.warn('[juke/webhooks] countRecordingsForSpace failed (non-fatal):', err);
      }

      // Only this space's true first part should ever set the legacy
      // recording_url - a later delivery's parts[0] is not the first part
      // overall, so gate on nextIndex to avoid clobbering it.
      if (nextIndex === 0) {
        await updateJukeSpace(spaceId, { recording_url: parts[0].url });
      }

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        try {
          await insertRecording({
            spaceId,
            url: part.url,
            source: 'juke',
            provider: 'juke',
            partIndex: nextIndex + i,
            title: part.title ?? (parts.length > 1 ? `Part ${nextIndex + i + 1}` : null),
            durationSeconds: part.durationSeconds,
          });
        } catch (err: unknown) {
          logger.warn('[juke/webhooks] insertRecording failed (non-fatal):', err);
        }
      }

      // Best-effort recap cast - autoCastToZao is currently a stub (no
      // @thezao signer wired up yet; see src/lib/publish/auto-cast.ts), so
      // this always no-ops for now. Call stays in place so casting goes live
      // the moment that function has a real implementation.
      try {
        const row = await getJukeSpace(spaceId);
        const title = row?.title ?? 'A ZAO space';
        const liveUrl = `${getBaseUrl()}/live/${spaceId}`;
        await autoCastToZao(
          `Recording up: ${title}\n\nListen back: ${liveUrl}`,
          liveUrl,
        );
      } catch (err: unknown) {
        logger.warn('[juke/webhooks] recap cast failed (non-fatal):', err);
      }
      return;
    }
    default: {
      // Unknown event - record only (the route already inserted the audit row).
      return;
    }
  }
}
