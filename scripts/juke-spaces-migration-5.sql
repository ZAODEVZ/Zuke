-- juke_spaces migration #5 (2026-06-21)
--
-- Recap video attachment (close the "live room -> recap video" loop).
--
-- The juke-space-recap Remotion pipeline (99darwin/juke-space-recap) renders a
-- 1920x1080 recap VIDEO from a space's audio. Until now that finished MP4 had
-- nowhere to live in Zuke. This migration lets a juke_recordings row hold a
-- video as well as audio:
--   - a new `kind` column ('audio' | 'video'), default 'audio'
--   - a new source value 'recap' (the rendered recap video; source has no CHECK
--     constraint in migration #4, so no constraint change is needed)
--
-- A recap video is attached by URL, not uploaded through the app: an 84-min
-- 1080p MP4 is 1-2 GB, far past any serverless request-body limit. The host
-- renders locally, hosts the file (Supabase Storage resumable upload, their own
-- CDN, etc.), and POSTs the https URL to /api/recordings/recap-video.
--
-- Strictly additive: existing rows default to kind='audio' and are unchanged.

alter table public.juke_recordings
  add column if not exists kind text not null default 'audio';

-- Constrain kind to the two values we render. Guarded so re-running is a no-op
-- (Postgres has no `add constraint if not exists`).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'juke_recordings_kind_chk'
  ) then
    alter table public.juke_recordings
      add constraint juke_recordings_kind_chk check (kind in ('audio', 'video'));
  end if;
end $$;

-- Helps the space page / shelf find a space's recap video quickly.
create index if not exists juke_recordings_kind_idx
  on public.juke_recordings (space_id, kind);
