-- juke_spaces migration #5 (2026-07-17)
--
-- HMS provider support: stale-room sweeper scaffolding + participant JSON
-- column for HMS rooms (Juke already stored participants via webhooks in the
-- jsonb column; HMS uses the same shape populated server-side via 100ms API).
--
-- The `provider` column was added in migration #3. This migration adds:
--   1. A `participants` jsonb column (if not already present from ZAOOS import)
--      so HMS rooms can persist join/leave data from webhooks.
--   2. An index on (provider, status) for the stale-room cron to efficiently
--      find active HMS rooms that may need a peer-count reconciliation.
--
-- Strictly additive. No renames, no drops.

-- Add participants column if not present (Juke already uses it from ZAOOS
-- import; this is a no-op guard for fresh Supabase instances).
alter table public.juke_spaces
  add column if not exists participants jsonb not null default '[]'::jsonb;

-- Composite index for the stale-room cron: "find all active HMS rooms"
-- and "find all active Juke rooms" are both common queries.
create index if not exists juke_spaces_provider_status_idx
  on public.juke_spaces (provider, status);
