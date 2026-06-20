# Recordings, snippets & recap videos

Zuke supports multi-part Juke recordings, host/admin uploads, audio snippets,
and a bridge to the open-source Remotion recap-video pipeline.

## Where recordings come from

A space (`juke_spaces` row) can have many recordings (`juke_recordings` rows):

| `source`  | How it is created                                                    |
| --------- | ------------------------------------------------------------------- |
| `juke`    | Juke's `recording.ready` webhook (now multi-part — one row per part) |
| `upload`  | A host/admin uploads audio via `POST /api/recordings/upload`         |
| `snippet` | A clip of a parent recording via `POST /api/recordings/snippet`      |

The legacy `juke_spaces.recording_url` column is kept in sync with the **first**
part so older queries and the `/live/{id}` ended-state view keep working.

### Snippets

A snippet does **not** re-encode audio (there is no ffmpeg in serverless). It
stores the parent recording's URL plus `start_seconds` / `end_seconds`, and the
player streams it with a media-fragment URL — `…/recording.ogg#t=12,48` — so the
browser seeks the original file to the clip window. Instant and exact.

## The recap video pipeline (offline)

[`99darwin/juke-space-recap`](https://github.com/99darwin/juke-space-recap) is a
Remotion pipeline that turns a long space recording into a 1920×1080 recap video
with per-guest PFPs, rolling captions, and a waveform. It runs **offline**
(Deepgram transcription + a 3–6 hour Remotion render) and is **not** part of the
Zuke web app — a serverless function cannot run a multi-hour render.

Zuke's job is to hand that pipeline the inputs it can't easily get on its own:
the space audio plus the Farcaster identities of everyone who joined.

### Export recap inputs

`GET /api/recordings/recap?spaceId={id}` (host/admin) returns JSON:

```jsonc
{
  "ok": true,
  "space": { "id": "...", "title": "...", "startedAt": "...", "endedAt": "..." },
  "audio": [{ "url": "...", "title": "Part 1", "source": "juke", "durationSeconds": 5400 }],
  "host": { "fid": 123, "username": "zaal", "display_name": "Zaal", "pfp_url": "https://…" },
  "participants": [{ "fid": 456, "username": "…", "display_name": "…", "pfp_url": "…", "role": "speaker" }],
  "pipeline": { "repo": "https://github.com/99darwin/juke-space-recap", "note": "…" }
}
```

`host` + `participants` are resolved from the fids Zuke already tracks
(`created_by_fid` + `participants[].fid`) via Neynar (`NEYNAR_API_KEY`). If the
key is unset or Neynar is unreachable, identities come back without PFPs rather
than failing — the audio export still works.

On the space page, the **Recap inputs** button downloads this as
`recap-inputs-{spaceId}.json`.

### Running the render

1. Download a recording (the `audio[]` URLs above).
2. Clone `99darwin/juke-space-recap`, `npm install`, set `DEEPGRAM_API_KEY` /
   `NEYNAR_API_KEY` / `HOST_USERNAME`, drop the audio in `public/audio.ogg`.
3. Run `transcribe → intros → pfps → waveform`, then `npm run render`. The
   Zuke recap-inputs JSON pre-fills the per-guest `@username` step for everyone
   Zuke already tracked joining, so you only hand-label guests we missed.

## Config

- Apply `scripts/juke-spaces-migration-4.sql` (adds `juke_recordings` + the
  public `recordings` storage bucket).
- Set `NEYNAR_API_KEY` for PFP/username enrichment (optional).
