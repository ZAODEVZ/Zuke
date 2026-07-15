-- auth_nonces migration #1 (2026-07-14)
--
-- Replay-protection store for SIWF nonces (src/lib/auth/nonce.ts). Nonces
-- were tracked in an in-memory Map, which only replay-protects within a
-- single warm Vercel instance - a captured nonce could theoretically be
-- replayed against a different cold instance within its 15-minute TTL.
-- Flagged in the 2026-07 prod-readiness audit as a real (if low-practical-
-- risk) gap; this closes it with a shared store.
--
-- consumeNonce() falls back to the in-memory Map if this table doesn't
-- exist yet (PGRST205/42P01) or on any other DB error, so merging the code
-- change is safe even before this migration is applied - the exact lesson
-- from the 2026-07 import-x incident (shipped code that assumed a migration
-- had already run). Deploy the code first, apply this whenever convenient;
-- nothing breaks either way, it just runs in degraded (in-memory-only) mode
-- until this is applied.
--
-- No FK to any other table - nonces are ephemeral and unrelated to a user
-- until SIWF verification succeeds.

create table if not exists public.auth_nonces (
  nonce text primary key,
  expires_at timestamptz not null
);

-- Cheap cleanup query support (delete where expires_at < now()) - not cron'd
-- yet, table stays small either way (15-minute TTL, low signin volume).
create index if not exists auth_nonces_expires_at_idx
  on public.auth_nonces (expires_at);

-- RLS: no public access at all - only the service-role client (this app's
-- server-side auth flow) ever touches this table.
alter table public.auth_nonces enable row level security;
