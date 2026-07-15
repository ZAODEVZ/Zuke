import { NextRequest, NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/constantTimeEqual';

/**
 * GET /api/cron/env-check — TEMPORARY. Not a real feature.
 *
 * Diagnoses a live "SESSION_SECRET must be set and at least 32 characters"
 * 500 seen on /api/recordings/import-x (2026-07-15) - reports only
 * presence/length of critical env vars, never their actual values, so it's
 * safe to leave CRON_SECRET-gated in the meantime.
 *
 * DELETE THIS ROUTE once the incident is resolved.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (!constantTimeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  function report(name: string) {
    const v = process.env[name];
    return { set: !!v, length: v?.length ?? 0 };
  }

  return NextResponse.json({
    ok: true,
    SESSION_SECRET: report('SESSION_SECRET'),
    SUPABASE_SERVICE_ROLE_KEY: report('SUPABASE_SERVICE_ROLE_KEY'),
    NEXT_PUBLIC_SUPABASE_URL: report('NEXT_PUBLIC_SUPABASE_URL'),
    JUKE_API_KEY: report('JUKE_API_KEY'),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}
