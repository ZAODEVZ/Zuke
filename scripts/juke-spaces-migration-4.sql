-- juke_spaces migration #4 (2026-06-20)
--
-- Multi-part recordings + uploads + snippets (recap feature, PR 2).
--
-- Juke now supports MULTI-PART recordings ("multi-part recordings make it easy
-- to create audio snippets" — @nickysap). Until now Zuke stored a single
-- juke_spaces.recording_url set by the recording.ready webhook. That column
-- stays (back-compat: existing queries + the /live ended-state view keep
-- working) but it can only hold one URL. This migration adds a one-to-many
-- juke_recordings table so a space can have:
--   - multiple Juke-delivered parts  (source = 'juke')
--   - host/admin uploaded audio       (source = 'upload')
--   - snippets cut from a parent      (source = 'snippet', parent_id set)
--
-- Strictly additive: no existing table/column/row is renamed or dropped, and
-- the recording.ready handler still sets juke_spaces.recording_url to the
-- first part for back-compat. A future PR may rename juke_spaces -> spaces and
-- juke_recordings -> recordings once the HMS provider lands.

create table if not exists public.juke_recordings (
  id uuid primary key default gen_random_uuid(),
  space_id text not null references public.juke_spaces (id) on delete cascade,
  provider text not null default 'juke',               -- LiveAudioProviderId
  -- 'juke'   : delivered by Juke's recording.ready webhook
  -- 'upload' : a file a host/admin uploaded into Zuke storage
  -- 'snippet': a clip of a parent recording (parent_id + start/end set)
  source text not null default 'juke',
  -- For source='snippet', the recording this clip is cut from. Snippets are
  -- played client-side via a media-fragment URL (#t=start,end) — Zuke does not
  -- re-encode audio server-side (no ffmpeg in serverless).
  parent_id uuid references public.juke_recordings (id) on delete cascade,
  part_index integer not null default 0,               -- ordering of parts within a space
  title text,
  url text not null,                                   -- playable audio URL (Juke CDN or Supabase Storage public URL)
  storage_path text,                                   -- set for source='upload': path inside the 'recordings' bucket
  duration_seconds integer,                            -- whole-recording length, when known
  start_seconds numeric,                               -- snippet start offset into the parent
  end_seconds numeric,                                 -- snippet end offset into the parent
  created_by_fid integer not null default 0,           -- 0 for webhook-delivered parts
  created_at timestamptz not null default now()
);

create index if not exists juke_recordings_space_id_idx
  on public.juke_recordings (space_id, part_index);
create index if not exists juke_recordings_parent_id_idx
  on public.juke_recordings (parent_id);
create index if not exists juke_recordings_source_idx
  on public.juke_recordings (source);

-- Idempotency for the recording.ready webhook: the same Juke part URL must not
-- insert twice if a delivery is retried. Partial unique index so uploads /
-- snippets (which may legitimately repeat a URL, e.g. two snippets of one
-- parent) are unaffected.
create unique index if not exists juke_recordings_juke_url_uq
  on public.juke_recordings (space_id, url)
  where source = 'juke';

-- RLS: recordings are publicly readable (the /live + /live/recordings surfaces
-- are public read, same posture as juke_spaces). Writes are service-role only
-- (upload/snippet routes + webhook handler use the service-role client).
alter table public.juke_recordings enable row level security;

drop policy if exists "juke_recordings_read_all" on public.juke_recordings;
create policy "juke_recordings_read_all"
  on public.juke_recordings
  for select
  using (true);

-- Storage bucket for uploaded audio. Create it via the Supabase dashboard or:
--   insert into storage.buckets (id, name, public) values ('recordings', 'recordings', true)
--   on conflict (id) do nothing;
-- Public bucket so the <audio> player can stream the file without a signed URL;
-- the upload ROUTE is gated (admin/host) so only authorized users can add files.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', true)
on conflict (id) do nothing;
