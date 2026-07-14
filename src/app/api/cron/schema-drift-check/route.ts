import { NextRequest, NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/constantTimeEqual';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * GET /api/cron/schema-drift-check
 *
 * Migrations in scripts/juke-spaces-migration-*.sql are applied manually
 * (see setup-zuke.md) - there is no CI or runtime step that guarantees a
 * merged migration actually ran against production. That gap is exactly
 * what caused the 2026-07 import-x incident: migration #3 (adds the
 * `provider` column) sat in the repo unapplied for weeks with zero
 * detection, and every import silently 500'd until a user reported it.
 *
 * This can't apply migrations (no direct Postgres connection string is
 * configured, only the PostgREST/service-role client, which can't run DDL)
 * - it can only detect drift. For each migration, it does a zero-row select
 * of the columns/tables it introduces; PostgREST returns PGRST204 (column)
 * or 42P01 (relation) if the schema is missing something the code expects.
 * Run on a schedule (see .github/workflows/schema-drift-check.yml) so a gap
 * surfaces as a failed Action run instead of a silent 500 in prod.
 *
 * Auth: same CRON_SECRET Bearer scheme as the other /api/cron/* routes.
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

  const checks: Array<{ migration: string; check: () => Promise<{ error: unknown }> }> = [
    {
      migration: 'migration-2 (juke_spaces.participants)',
      check: async () => supabaseAdmin.from('juke_spaces').select('participants').limit(0),
    },
    {
      migration: 'migration-3 (juke_spaces.provider)',
      check: async () => supabaseAdmin.from('juke_spaces').select('provider').limit(0),
    },
    {
      migration: 'migration-4 (juke_recordings table)',
      check: async () =>
        supabaseAdmin
          .from('juke_recordings')
          .select('id, space_id, provider, source, parent_id, part_index, storage_path')
          .limit(0),
    },
  ];

  const results = await Promise.all(
    checks.map(async ({ migration, check }) => {
      const { error } = await check();
      return {
        migration,
        applied: !error,
        error_message: error ? (error as { message?: string }).message : null,
      };
    }),
  );

  const drift = results.filter((r) => !r.applied);
  return NextResponse.json(
    { ok: drift.length === 0, drift_detected: drift.length > 0, results },
    { status: drift.length === 0 ? 200 : 500 },
  );
}
