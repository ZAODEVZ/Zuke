import { createClient } from '@supabase/supabase-js';
import { ENV } from '@/lib/env';

let supabaseAdminInstance: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(
      ENV.SUPABASE_URL,
      ENV.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return supabaseAdminInstance;
}

export const supabaseAdmin = getSupabaseAdmin();
