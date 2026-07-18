import type { NextRequest } from 'next/server';
import { hmsProvider } from '@/lib/spaces/providers/hms';

/**
 * POST /api/hms/webhook
 *
 * Receives 100ms server webhooks, verifies the Authorization header against
 * HMS_WEBHOOK_SECRET, deduplicates by event id, and applies lifecycle side
 * effects (participant count, session end, recording URL).
 *
 * Configure the webhook URL in the 100ms dashboard:
 *   https://dashboard.100ms.live → Developer → Webhooks → <your-url>/api/hms/webhook
 *   Authorization header: <value of HMS_WEBHOOK_SECRET>
 */
export async function POST(req: NextRequest) {
  return hmsProvider.handleWebhook(req);
}
