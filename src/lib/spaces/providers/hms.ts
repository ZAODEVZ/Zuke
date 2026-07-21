/**
 * The `'hms'` (100ms) live-audio provider.
 *
 * Server-only. Uses the 100ms Management REST API via fetch + HS256 JWTs
 * signed with the native Node.js `crypto` module (no extra npm dep).
 *
 * Required env vars:
 *   HMS_ACCESS_KEY      — 100ms app access key (App Settings → Developer)
 *   HMS_APP_SECRET      — 100ms app secret (App Settings → Developer)
 *   HMS_WEBHOOK_SECRET  — shared secret set in 100ms Dashboard → Webhooks
 *
 * Optional:
 *   HMS_TEMPLATE_ID     — 100ms room template ID (uses default if absent)
 *
 * Session-integrity guarantees carried from ZAOOS:
 *   - Webhook dedup via `juke_webhook_events.signature_hash` (event id hash)
 *   - One-open-session-per-room enforced by the createRoom guard (check active
 *     sessions before creating; 503 if one is running)
 *   - Stale-room sweep: existing /api/cron/juke-stale-rooms can be extended
 *     to sweep HMS rooms using the same management token
 *
 * Explicitly NOT ported: holder-gate. Listening on Zuke is OPEN — no ZAO
 * token required on any listener path (locked product decision).
 *
 * When HMS client components land, they MUST load via `next/dynamic` so the
 * Juke path never downloads the @100mslive/react-sdk bundle.
 */
import { createHmac } from 'crypto';
import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/constantTimeEqual';
import type {
  CreateRoomInput,
  CreateRoomResult,
  EndRoomResult,
  GetEmbedOptions,
  LiveAudioProvider,
  RoomEmbed,
} from './types';

const HMS_API = 'https://api.100ms.live/v2';

// ---- JWT helpers (native crypto, no jsonwebtoken dep) -----------------------

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Sign an HS256 JWT using Node's built-in `crypto` module. */
function signHs256(payload: Record<string, unknown>, secret: string, expiresIn: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({ ...payload, iat: now, nbf: now, exp: now + expiresIn, jti: crypto.randomUUID() }),
  );
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Mint a short-lived management token, or null when creds are absent. */
function mintMgmtToken(): string | null {
  const accessKey = process.env.HMS_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) return null;
  return signHs256({ access_key: accessKey, type: 'management', version: 2 }, secret, 600); // 10 min
}

/**
 * Mint a short-lived app token for one user joining one room.
 * `role` is a 100ms role name configured in the dashboard template.
 */
export function mintHmsAppToken(roomId: string, userId: string, role: string): string | null {
  const accessKey = process.env.HMS_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) return null;
  return signHs256(
    { access_key: accessKey, room_id: roomId, user_id: userId, role, type: 'app', version: 2 },
    secret,
    86400, // 24h
  );
}

// ---- Room ID validation -----------------------------------------------------

/** 100ms room IDs are 24-char lowercase hex strings. */
const HMS_ROOM_ID_RE = /^[0-9a-f]{24}$/;

// ---- Provider implementation ------------------------------------------------

export const hmsProvider: LiveAudioProvider = {
  provider: 'hms',

  isValidRoomId(value: unknown): value is string {
    return typeof value === 'string' && HMS_ROOM_ID_RE.test(value);
  },

  async createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
    const mgmt = mintMgmtToken();
    if (!mgmt) {
      return {
        ok: false,
        status: 503,
        error:
          'HMS provider not configured (missing HMS_ACCESS_KEY / HMS_APP_SECRET). ' +
          'Add them in Vercel → Environment Variables.',
      };
    }

    const templateId = process.env.HMS_TEMPLATE_ID ?? '';
    const body: Record<string, unknown> = {
      name: `zuke-${Date.now()}`, // unique name; Zuke's own id is the primary key
      description: input.title,
      region: 'us',
    };
    if (templateId) body.template_id = templateId;
    if (input.record) {
      // Recording is enabled per-room via a 100ms recording template; if a
      // generic template is used, recording.enabled can be set at create time.
      body.recording = { enabled: true };
    }

    let res: Response;
    try {
      res = await fetch(`${HMS_API}/rooms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      return { ok: false, status: 503, error: `HMS API unreachable: ${String(err)}` };
    }

    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data && typeof data === 'object' && 'message' in data ? String((data as Record<string, unknown>).message) : res.statusText;
      return { ok: false, status: res.status, error: `HMS createRoom failed: ${msg}` };
    }

    const d = data as Record<string, unknown>;
    const roomId = typeof d.id === 'string' ? d.id : '';
    if (!roomId) {
      return { ok: false, status: 500, error: 'HMS createRoom: missing id in response' };
    }

    return {
      ok: true,
      room: {
        provider: 'hms',
        id: roomId,
        // HMS has no hosted embed; the /live/hms/[id] route renders our own player.
        embedUrl: `/live/hms/${roomId}`,
        raw: data,
      },
    };
  },

  async getEmbed(roomId: string, _options: GetEmbedOptions = {}): Promise<RoomEmbed> {
    if (!this.isValidRoomId(roomId)) {
      throw new Error(`Invalid HMS room id: ${roomId}`);
    }
    // HMS has no hosted share page or OG image — Zuke renders its own.
    return {
      provider: 'hms',
      embedUrl: `/live/hms/${roomId}`,
      pageUrl: null,
      deeplinkUrl: null,
      ogImageUrl: null,
    };
  },

  async endRoom(roomId: string): Promise<EndRoomResult> {
    if (!this.isValidRoomId(roomId)) {
      return { ok: false, status: 400, error: `Invalid HMS room id: ${roomId}` };
    }
    const mgmt = mintMgmtToken();
    if (!mgmt) {
      return { ok: false, status: 503, error: 'HMS_ACCESS_KEY / HMS_APP_SECRET not configured' };
    }

    let res: Response;
    try {
      res = await fetch(`${HMS_API}/active-rooms/${roomId}/end-active-session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'host ended room', lock: false }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      return { ok: false, status: 503, error: `HMS API unreachable: ${String(err)}` };
    }

    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = raw && typeof raw === 'object' && 'message' in raw ? String((raw as Record<string, unknown>).message) : res.statusText;
      return { ok: false, status: res.status, error: `HMS endRoom failed: ${msg}`, raw };
    }
    return { ok: true, status: res.status, raw };
  },

  async handleWebhook(req: Request): Promise<Response> {
    const secret = process.env.HMS_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'HMS_WEBHOOK_SECRET not configured' }, { status: 500 });
    }

    // 100ms webhooks send Authorization: <secret> or Bearer <secret>.
    const auth = req.headers.get('authorization') ?? '';
    const matches = constantTimeEqual(auth, secret) || constantTimeEqual(auth, `Bearer ${secret}`);
    if (!matches) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let event: { id?: string; type?: string; data?: Record<string, unknown> };
    try {
      event = await req.json();
    } catch {
      return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
    }

    const eventId = event.id ?? '';
    const type = event.type ?? '';
    const data = event.data ?? {};
    const roomId = typeof data.room_id === 'string' ? data.room_id : undefined;

    if (!roomId) {
      return NextResponse.json({ ok: true, ignored: 'no room_id' });
    }

    // Idempotency: dedupe by 100ms event id. If the same event is delivered
    // twice, the second delivery hits a unique-constraint error on
    // juke_webhook_events.signature_hash and returns 200 (already processed).
    // We use the event id (not a signature header, which 100ms doesn't always
    // send) as the dedup key, hashed to fit the text column.
    if (eventId) {
      try {
        const { supabaseAdmin } = await import('@/lib/db/supabase');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabaseAdmin as any;
        const hash = createHmac('sha256', 'hms-event-id').update(eventId).digest('hex');
        const { error } = await sb.from('juke_webhook_events').insert({
          event_type: type,
          juke_event_id: eventId,
          signature_hash: hash,
          space_id: roomId,
          body: event,
        });
        if (error?.code === '23505') {
          // Duplicate delivery — already processed.
          return NextResponse.json({ ok: true, deduplicated: true });
        }
      } catch {
        // If the insert fails for any other reason, still process the event
        // (best-effort dedup; correctness > idempotency on failure).
      }
    }

    // Lifecycle side effects — mirror the Juke webhook pattern so DB lifecycle
    // updates flow from webhooks, not API calls.
    try {
      const { supabaseAdmin } = await import('@/lib/db/supabase');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabaseAdmin as any;

      if (type.startsWith('peer.join') || type.startsWith('peer.leave')) {
        // Re-fetch live peer count from the 100ms API for accuracy.
        const mgmt = mintMgmtToken();
        if (mgmt) {
          const countRes = await fetch(`${HMS_API}/active-rooms/${roomId}`, {
            headers: { Authorization: `Bearer ${mgmt}` },
          }).catch(() => null);
          if (countRes?.ok) {
            const countData = await countRes.json().catch(() => null) as Record<string, unknown> | null;
            const count = countData && typeof countData.peers === 'object' && countData.peers !== null
              ? Object.keys(countData.peers as object).length
              : null;
            if (count !== null) {
              await sb.from('juke_spaces').update({ participant_count: count }).eq('id', roomId).eq('provider', 'hms');
            }
          }
        }
      } else if (type.startsWith('session.close')) {
        await sb.from('juke_spaces').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', roomId).eq('provider', 'hms');
      } else if (type.includes('recording') && type.includes('success')) {
        const url =
          typeof data.recording_path === 'string' ? data.recording_path :
          typeof data.recording_presigned_url === 'string' ? data.recording_presigned_url :
          undefined;
        if (url) {
          await sb.from('juke_spaces').update({ recording_url: url }).eq('id', roomId).eq('provider', 'hms');
        }
      }
    } catch (err) {
      console.error('[hms-webhook] handler error', err);
      return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, type });
  },
};
