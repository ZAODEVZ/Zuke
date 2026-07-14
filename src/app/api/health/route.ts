import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * GET /api/health - real uptime-monitor target.
 *
 * /api/juke/status exists but is unsuitable for this: it wraps every
 * dependency call in `.catch(() => null)` so it returns 200 even when
 * Supabase is fully unreachable - an external monitor pointed at it would
 * never detect an outage. This endpoint does one cheap, real DB round trip
 * and returns 503 if it fails, with no `.catch`-and-swallow.
 *
 * No auth - point an external monitor (UptimeRobot, Better Uptime, etc.) at
 * this directly.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const { error } = await supabaseAdmin.from('juke_spaces').select('id').limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, db: 'reachable' });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, db: 'unreachable', error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
