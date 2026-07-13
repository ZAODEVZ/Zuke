import { NextRequest, NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/constantTimeEqual';
import { supabaseAdmin } from '@/lib/db/supabase';
import { insertImportedSpace } from '@/lib/spaces/jukeSpacesDb';

/**
 * GET /api/cron/debug-write-test — TEMPORARY. Not a real feature.
 *
 * Exists only to diagnose the live POST /api/recordings/import-x 500 without
 * needing a signed-in browser session: attempts the exact same shape of
 * write insertImportedSpace does (juke_spaces insert, status='ended',
 * provider='songjam'), reports the raw error verbatim if it fails, and
 * always cleans up the test row afterward (insert then delete, same
 * request) so nothing lingers in production data either way.
 *
 * Auth: reuses the same CRON_SECRET Bearer scheme as
 * /api/cron/juke-stale-rooms, so the existing GitHub Actions workflow
 * secret can trigger it without a new credential.
 *
 * DELETE THIS ROUTE once the import-x incident is resolved - see
 * .handoffs/session-2026-07-13-zuke-import-x-500-debug/README.md.
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

  const testId = `debug-write-test-${Date.now()}`;

  // Call the REAL function import-x uses (not a re-implementation), so this
  // exercises the actual deployed fallback logic exactly as-is.
  try {
    await insertImportedSpace({
      id: testId,
      title: 'debug write test - safe to ignore/delete',
      provider: 'songjam',
      createdByFid: 0,
      raw: { source: 'debug-write-test' },
    });
  } catch (err: unknown) {
    return NextResponse.json({
      ok: false,
      stage: 'insertImportedSpace',
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  const { error: deleteError } = await supabaseAdmin.from('juke_spaces').delete().eq('id', testId);

  return NextResponse.json({
    ok: true,
    inserted_via_real_function: true,
    deleted: !deleteError,
    delete_error: deleteError ? deleteError.message : null,
  });
}
