function parseFidList(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const ENV = {
  JUKE_API_KEY: process.env.JUKE_API_KEY ?? '',
  JUKE_WEBHOOK_SECRET: process.env.JUKE_WEBHOOK_SECRET ?? '',
  JUKE_CREATE_PASSWORD: process.env.JUKE_CREATE_PASSWORD ?? '',
  ZUKE_ADMIN_PASSWORD: process.env.ZUKE_ADMIN_PASSWORD ?? '',
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  SESSION_SECRET: process.env.SESSION_SECRET ?? '',
  /**
   * Neynar API key — resolves Farcaster usernames + PFPs. Two independent
   * consumers: the recap pipeline bridge (GET /api/recordings/recap, reads
   * this ENV field) and SIWF admin login (POST /api/auth/verify, reads
   * process.env.NEYNAR_API_KEY directly rather than through this object).
   * Server-only. Unset = both fall back gracefully rather than failing: the
   * recap endpoint returns participants without enriched PFPs, and admin
   * login sessions store `fid:{fid}` as the display name instead of a real
   * username/PFP.
   */
  NEYNAR_API_KEY: process.env.NEYNAR_API_KEY ?? '',
  ZUKE_ADMIN_FIDS: parseFidList(process.env.ZUKE_ADMIN_FIDS ?? ''),
  OPTIMISM_RPC_URL: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL ?? 'https://optimism-rpc.publicnode.com',
};
