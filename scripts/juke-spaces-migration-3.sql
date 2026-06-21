-- juke_spaces migration #3 (2026-06-11)
--
-- Multi-provider groundwork (provider abstraction, PR 1): tag every row with
-- the live-audio backend that owns it. Values are the LiveAudioProviderId
-- string-literal union from src/lib/spaces/providers/types.ts:
--   'juke' | 'hms' | 'stream' | 'songjam'
--
-- Strictly additive: every existing row was created through the Juke
-- developer API, so the DEFAULT backfills them correctly and no existing
-- query, route, or RLS policy changes this PR.
--
-- NOTE: a future PR may rename juke_spaces -> spaces (and juke_webhook_events
-- -> webhook_events) once the 100ms/HMS provider lands; this migration
-- deliberately renames NOTHING so existing rows + queries keep working.

alter table public.juke_spaces
  add column if not exists provider text not null default 'juke';

-- Cheap per-backend filter for status dashboards ("active HMS rooms").
create index if not exists juke_spaces_provider_idx
  on public.juke_spaces (provider);
