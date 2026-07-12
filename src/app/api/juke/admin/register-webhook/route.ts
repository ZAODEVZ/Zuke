import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionData } from '@/lib/auth/session';
import { ENV } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/zuke.config';

/**
 * POST /api/juke/admin/register-webhook
 *
 * Server-side wrapper around `POST https://api.juke.audio/v1/developer/webhooks`.
 *
 * Juke generates the HMAC secret server-side (it rejects with `extra_forbidden`
 * if we try to send our own) and returns it ONCE in the response body. The
 * admin who calls this route must immediately copy `juke.secret` from the
 * response into the JUKE_WEBHOOK_SECRET env var on Vercel (Production +
 * Preview + Development), then redeploy. The verifier in /api/juke/webhooks
 * reads JUKE_WEBHOOK_SECRET to validate every inbound signature; without the
 * copy the receiver 401s every delivery.
 *
 * Admin-only. Idempotent in practice: Juke caps webhook subs at max 5 per app
 * + uniques by (app_id, url), so re-running with the same URL returns the
 * existing subscription rather than duplicating. Whether that re-run response
 * includes a fresh `secret` is not documented, so this route branches on
 * whatever Juke actually sends back: `status: "created"` when a secret is
 * present, `status: "already_registered"` when it isn't (nothing to copy -
 * an existing subscription already covers this URL).
 *
 * Body (optional):
 *   { url?: string }   defaults to `${getBaseUrl()}/api/juke/webhooks`
 *
 * Response:
 *   201 + { ok: true, status: "created" | "already_registered", juke: <Juke response>, action_required: "..." }
 *   401 if not admin
 *   503 if JUKE_API_KEY is unset
 *   502 if Juke rejects (juke_status carries the upstream status code)
 */

const BodySchema = z.object({
  url: z.string().url().optional(),
});

function defaultWebhookUrl(): string {
  return `${getBaseUrl()}/api/juke/webhooks`;
}
const EVENTS = [
  'room.started',
  'room.finished',
  'participant.joined',
  'participant.left',
  'recording.ready',
];

export async function POST(request: NextRequest) {
  const session = await getSessionData();
  if (!session?.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 401 });
  }

  const apiKey = ENV.JUKE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Missing JUKE_API_KEY on the server.' },
      { status: 503 },
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const url = parsed.data.url ?? defaultWebhookUrl();

  try {
    // No `secret` in the body - Juke generates and returns it.
    const res = await fetch('https://api.juke.audio/v1/developer/webhooks', {
      method: 'POST',
      headers: {
        'X-Juke-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, events: EVENTS }),
    });
    const text = await res.text();
    let jukeBody: unknown;
    try {
      jukeBody = JSON.parse(text);
    } catch {
      jukeBody = text;
    }
    if (!res.ok) {
      logger.error('[juke/admin/register-webhook] Juke rejected', res.status, jukeBody);
      return NextResponse.json(
        { ok: false, error: `Juke returned ${res.status}`, juke_status: res.status, juke: jukeBody },
        { status: 502 },
      );
    }
    // Server log records the registration (without the secret) so the action
    // trail exists. The secret value lives only in the response body the
    // admin sees in their browser.
    const safeForLog = (() => {
      if (typeof jukeBody !== 'object' || jukeBody === null) return jukeBody;
      const clone = { ...(jukeBody as Record<string, unknown>) };
      if ('secret' in clone) clone.secret = '<redacted>';
      return clone;
    })();
    const returnedSecret =
      typeof jukeBody === 'object' && jukeBody !== null && 'secret' in jukeBody
        ? (jukeBody as { secret?: unknown }).secret
        : undefined;
    const status = typeof returnedSecret === 'string' && returnedSecret.length > 0
      ? ('created' as const)
      : ('already_registered' as const);
    logger.info('[juke/admin/register-webhook] registered', { url, status, juke: safeForLog });

    return NextResponse.json(
      {
        ok: true,
        status,
        url,
        events: EVENTS,
        juke: jukeBody,
        action_required:
          status === 'created'
            ? 'COPY the value of juke.secret into JUKE_WEBHOOK_SECRET on Vercel (Production + Preview + Development), then redeploy. The webhook receiver verifies every inbound delivery against this secret; without it every delivery 401s. Then close this tab - do not leave the secret on screen.'
            : 'No action needed - a webhook subscription for this URL already exists on Juke and no new secret was issued. If deliveries are currently 401ing (JUKE_WEBHOOK_SECRET missing or stale), delete the existing subscription via /api/juke/admin/delete-webhook and re-run this registration to get a fresh secret.',
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    logger.error('[juke/admin/register-webhook] unexpected', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export const GET = () =>
  NextResponse.json(
    { ok: false, error: 'POST only - this is a one-shot admin registration endpoint.' },
    { status: 405 },
  );
