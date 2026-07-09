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
| `import`  | Audio of an imported X Space (`POST /api/recordings/import-x`)       |

## Importing an X (Twitter) Space

Zuke cannot re-broadcast a **live** X Space (real-time ingest is a separate
problem). It can import a **finished** one as a recording:

1. Download the Space audio with any X Spaces downloader (yt-dlp, SpacesDown,
   Flowjin, …).
2. Go to `/live/import`, paste the Space link (`x.com/i/spaces/{id}`) and a
   title. Optionally paste a direct audio URL, or upload the file on the next
   screen.
3. `POST /api/recordings/import-x` (host/admin) creates an ended space tagged
   with the `songjam` provider (the X/Twitter ingest backend) and a derived id
   `x-{spaceId}`. From there it behaves like any recording — snippet it, export
   recap inputs, etc.

Caveat: recap PFP/username enrichment resolves **Farcaster** identities, so
X-only guests won't be pictured. Many crypto-X hosts are also on Farcaster, so
the host card usually resolves.

The legacy `juke_spaces.recording_url` column is kept in sync with the **first**
part so older queries and the `/live/{id}` ended-state view keep working.

### Snippets

A snippet does **not** re-encode audio (there is no ffmpeg in serverless). It
stores the parent recording's URL plus `start_seconds` / `end_seconds`, and the
player streams it with a media-fragment URL — `…/recording.ogg#t=12,48` — so the
browser seeks the original file to the clip window. Instant and exact.

## Two render paths

Both run **offline**. A serverless function cannot run a multi-hour render, and
there is no ffmpeg in serverless, so Zuke's job in both cases is the same: hand
the pipeline the inputs it cannot easily get on its own — the space audio plus
the Farcaster identities of everyone who joined. Zuke itself renders nothing.

| Want | Use | Cost |
| --- | --- | --- |
| A YouTube upload (1080p mp4 + captions + title/description/chapters/tags) | [`bettercallzaal/ZAOVideoEditor`](https://github.com/bettercallzaal/ZAOVideoEditor) | minutes |
| A recap video with per-guest PFPs | [`99darwin/juke-space-recap`](https://github.com/99darwin/juke-space-recap) | 3–6 hours |

### YouTube (ZAOVideoEditor)

A space has no video track, so ZAOVideoEditor renders an *audiogram* — a branded
1920×1080 card plus a live waveform, muxed with the audio — then transcribes it
and writes the YouTube metadata beside the mp4. One command, straight off a
space id:

```bash
python scripts/space_to_youtube.py --space-id {id} --zuke-base https://zuke.thezao.com
```

It reads the same `/api/recordings/recap` payload documented below, so no Zuke
changes were needed. Captions ship as an `.srt` sidecar, which YouTube ingests
natively. Nothing is uploaded automatically.

### Per-guest PFP recap (Remotion)

[`99darwin/juke-space-recap`](https://github.com/99darwin/juke-space-recap) is a
Remotion pipeline that turns a long space recording into a 1920×1080 recap video
with per-guest PFPs, rolling captions, and a waveform. It uses Deepgram
transcription and a 3–6 hour Remotion render, and has a human-in-the-loop step
for matching spoken names to `@handles`.

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

### Running the YouTube render

Clone `bettercallzaal/ZAOVideoEditor`, then point it at the space id — it fetches
the audio and metadata from the recap endpoint itself:

```bash
python scripts/space_to_youtube.py --space-id {id} --minutes 3   # smoke render first
python scripts/space_to_youtube.py --space-id {id} --quality best
```

Outputs `<slug>.mp4`, `<slug>.srt`, and `<slug>.youtube.txt`. Upload is manual.

### Running the PFP recap render

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
