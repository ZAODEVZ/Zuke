import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '@/lib/env';

/**
 * Server-side admin Supabase client. Uses the service-role key so RLS is
 * bypassed for trusted writes (webhook handlers, admin routes, cron). Never
 * import this from a client component.
 *
 * Typed as a permissive SupabaseClient so route handlers can call `.from('...')`
 * without needing generated `Database` types. We hand-roll defensive parsing in
 * each consumer (see jukeSpacesDb.ts) so the loose type does not hide bugs.
 */
let supabaseAdminInstance: SupabaseClient | null = null;

function buildClient(): SupabaseClient {
  return createClient(
    ENV.SUPABASE_URL || 'https://placeholder.supabase.co',
    ENV.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdminInstance) supabaseAdminInstance = buildClient();
  return supabaseAdminInstance;
}

// Proxy the export so module-load does not eagerly init the client. First
// access via `.from(...)` triggers the real construction.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// Browser-side anon client for /spaces real-time + public reads. Returns a
// minimal stub if NEXT_PUBLIC_SUPABASE_URL is missing so build does not crash.
export function getSupabaseBrowser(): SupabaseClient {
  return createClient(
    ENV.SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
