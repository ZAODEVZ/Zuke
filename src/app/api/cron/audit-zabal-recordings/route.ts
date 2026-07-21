import { NextRequest, NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/constantTimeEqual';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * GET /api/cron/audit-zabal-recordings - TEMPORARY. Not a real feature.
 *
 * One-off audit: is anything matching "zabal" already tracked in juke_spaces
 * / juke_recordings? Answers whether the 2 confirmed ZABAL Gamez recordings
 * (X POIDH, Workshop w/Los Fomos) need the native-Juke path (already have a
 * row, just need a recording attached) or the import-x path (space happened
 * outside Zuke's own create-space flow, needs importing from scratch).
 *
 * DELETE THIS ROUTE once the audit is read.
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

  const { data: spaces, error: spacesError } = await supabaseAdmin
    .from('juke_spaces')
    .select('id, title, status, provider, recording_url, created_at, ended_at')
    .ilike('title', '%zabal%')
    .order('created_at', { ascending: false });

  const { data: recordings, error: recordingsError } = await supabaseAdmin
    .from('juke_recordings')
    .select('id, space_id, provider, source, url, title, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({
    ok: true,
    zabal_spaces: spaces ?? [],
    zabal_spaces_error: spacesError?.message ?? null,
    recent_recordings_all_spaces: recordings ?? [],
    recordings_error: recordingsError?.message ?? null,
  });
}
