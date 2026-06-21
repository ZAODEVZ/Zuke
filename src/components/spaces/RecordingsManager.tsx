'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Serializable view of a juke_recordings row (mirror of RecordingRow). */
export interface RecordingView {
  id: string;
  source: 'juke' | 'upload' | 'snippet' | 'import' | 'recap';
  kind: 'audio' | 'video';
  parent_id: string | null;
  title: string | null;
  url: string;
  duration_seconds: number | null;
  start_seconds: number | null;
  end_seconds: number | null;
}

interface RecordingsManagerProps {
  spaceId: string;
  /** Host/admin: can upload, snippet, attach a recap video, and export inputs. */
  canManage: boolean;
  recordings: RecordingView[];
}

const SOURCE_LABEL: Record<RecordingView['source'], string> = {
  juke: 'Juke',
  upload: 'Upload',
  snippet: 'Snippet',
  import: 'X Space',
  recap: 'Recap',
};

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

/**
 * Lists a space's recordings (Juke multi-part, uploads, snippets) with inline
 * players, and — for the host/admin — controls to upload audio, cut a snippet
 * from any full recording, and export the recap-pipeline inputs as JSON.
 *
 * Playback for snippets relies on the media-fragment URL (`...#t=start,end`)
 * the snippet route bakes into `url`, so the same <audio> element seeks the
 * parent file to the clip window with no server-side re-encoding.
 */
export function RecordingsManager({ spaceId, canManage, recordings }: RecordingsManagerProps) {
  const router = useRouter();

  if (recordings.length === 0 && !canManage) return null;

  return (
    <section className="w-full max-w-md flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">
          Recordings{recordings.length > 0 ? ` (${recordings.length})` : ''}
        </h2>
        {canManage && recordings.length > 0 && <RecapExportButton spaceId={spaceId} />}
      </div>

      {recordings.length === 0 ? (
        <p className="text-xs text-gray-500">
          No recordings yet. Upload one below, or they appear here when Juke delivers a recording.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {recordings.map((rec) => (
            <li
              key={rec.id}
              className="flex flex-col gap-2 rounded-2xl border border-white/[0.08] bg-[#0d1b2a] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-gray-200">
                  {rec.title ?? (rec.source === 'snippet' ? 'Snippet' : 'Recording')}
                </span>
                <span className="flex-shrink-0 rounded-full border border-white/[0.1] bg-[#1a2a3a] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {SOURCE_LABEL[rec.source]}
                  {rec.source === 'snippet' &&
                    rec.start_seconds != null &&
                    rec.end_seconds != null &&
                    ` ${fmtClock(rec.start_seconds)}–${fmtClock(rec.end_seconds)}`}
                </span>
              </div>
              {rec.kind === 'video' ? (
                <video
                  controls
                  preload="none"
                  src={rec.url}
                  className="w-full rounded-lg bg-black"
                >
                  Your browser does not support inline video playback.
                </video>
              ) : (
                <audio
                  controls
                  preload="none"
                  src={rec.url}
                  className="h-9 w-full [&::-webkit-media-controls-panel]:bg-[#0a1628]"
                >
                  Your browser does not support inline audio playback.
                </audio>
              )}
              {/* Snippets are cut from full AUDIO recordings only (not clips,
                  not the recap video). */}
              {canManage && rec.source !== 'snippet' && rec.kind === 'audio' && (
                <SnippetCreator
                  parentId={rec.id}
                  maxSeconds={rec.duration_seconds}
                  onDone={() => router.refresh()}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && <RecordingUploader spaceId={spaceId} onDone={() => router.refresh()} />}
      {canManage && <RecapVideoAttacher spaceId={spaceId} onDone={() => router.refresh()} />}
    </section>
  );
}

function RecordingUploader({ spaceId, onDone }: { spaceId: string; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'uploading' } | { status: 'error'; message: string }
  >({ status: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setState({ status: 'error', message: 'Choose an audio file first' });
      return;
    }
    setState({ status: 'uploading' });
    const form = new FormData();
    form.set('file', file);
    form.set('spaceId', spaceId);
    if (title.trim()) form.set('title', title.trim());
    try {
      const res = await fetch('/api/recordings/upload', { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setState({ status: 'error', message: body.error ?? `Upload failed (${res.status})` });
        return;
      }
      setState({ status: 'idle' });
      setTitle('');
      if (inputRef.current) inputRef.current.value = '';
      onDone();
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/[0.12] bg-[#0d1b2a] p-4"
    >
      <span className="text-xs font-semibold text-gray-300">Upload a recording</span>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-[#1a2a3a] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-gray-200 hover:file:bg-[#22364a]"
      />
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        maxLength={200}
        className="w-full rounded-xl border border-white/[0.08] bg-[#0a1628] px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:border-[#f5a623]/50 focus:outline-none"
      />
      {state.status === 'error' && <span className="text-[11px] text-red-400">{state.message}</span>}
      <button
        type="submit"
        disabled={state.status === 'uploading'}
        className="self-start rounded-xl border border-[#f5a623]/30 bg-[#f5a623]/10 px-4 py-1.5 text-xs font-bold text-[#f5a623] transition-colors hover:bg-[#f5a623]/20 disabled:opacity-50"
      >
        {state.status === 'uploading' ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}

/**
 * Attach a finished recap VIDEO by URL. The juke-space-recap pipeline renders a
 * 1080p MP4 offline (1–2 GB for a long space) which is far too big to upload
 * through a serverless route — so the host hosts it (Supabase Storage, their
 * own CDN, etc.) and pastes the https URL here. It lands as a kind='video'
 * recap row and plays inline in a <video> above.
 */
function RecapVideoAttacher({ spaceId, onDone }: { spaceId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [title, setTitle] = useState('');
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string }
  >({ status: 'idle' });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-[11px] font-semibold text-gray-400 underline underline-offset-2 hover:text-[#f5a623]"
      >
        Attach a recap video
      </button>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = videoUrl.trim();
    if (!url.startsWith('https://')) {
      setState({ status: 'error', message: 'Paste an https:// URL to the recap video' });
      return;
    }
    setState({ status: 'saving' });
    try {
      const res = await fetch('/api/recordings/recap-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, videoUrl: url, title: title.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setState({ status: 'error', message: body.error ?? `Failed (${res.status})` });
        return;
      }
      setState({ status: 'idle' });
      setOpen(false);
      setVideoUrl('');
      setTitle('');
      onDone();
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-2xl border border-dashed border-[#855dcd]/30 bg-[#0d1b2a] p-4"
    >
      <span className="text-xs font-semibold text-gray-300">Attach a recap video</span>
      <p className="text-[11px] leading-relaxed text-gray-500">
        Rendered the{' '}
        <a
          href="https://github.com/99darwin/juke-space-recap"
          target="_blank"
          rel="noreferrer noopener"
          className="text-[#a78bfa] hover:underline"
        >
          juke-space-recap
        </a>{' '}
        MP4? Host it (Supabase Storage, your CDN) and paste the https link — it plays inline here.
      </p>
      <input
        type="url"
        inputMode="url"
        value={videoUrl}
        onChange={(e) => setVideoUrl(e.target.value)}
        placeholder="https://…/recap.mp4"
        className="w-full rounded-xl border border-white/[0.08] bg-[#0a1628] px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:border-[#855dcd]/50 focus:outline-none"
      />
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        maxLength={200}
        className="w-full rounded-xl border border-white/[0.08] bg-[#0a1628] px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:border-[#855dcd]/50 focus:outline-none"
      />
      {state.status === 'error' && <span className="text-[11px] text-red-400">{state.message}</span>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={state.status === 'saving'}
          className="rounded-xl border border-[#855dcd]/40 bg-[#855dcd]/10 px-4 py-1.5 text-xs font-bold text-[#a78bfa] transition-colors hover:bg-[#855dcd]/20 disabled:opacity-50"
        >
          {state.status === 'saving' ? 'Attaching…' : 'Attach video'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setState({ status: 'idle' });
          }}
          className="rounded-xl border border-white/[0.12] bg-[#1a2a3a] px-4 py-1.5 text-xs font-semibold text-gray-400 hover:bg-[#22364a]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SnippetCreator({
  parentId,
  maxSeconds,
  onDone,
}: {
  parentId: string;
  maxSeconds: number | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [title, setTitle] = useState('');
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string }
  >({ status: 'idle' });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-[11px] font-semibold text-gray-400 underline underline-offset-2 hover:text-[#f5a623]"
      >
        Create snippet
      </button>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const startSeconds = Number(start);
    const endSeconds = Number(end);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      setState({ status: 'error', message: 'Start and end must be numbers (seconds)' });
      return;
    }
    if (endSeconds <= startSeconds) {
      setState({ status: 'error', message: 'End must be after start' });
      return;
    }
    setState({ status: 'saving' });
    try {
      const res = await fetch('/api/recordings/snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId,
          startSeconds,
          endSeconds,
          title: title.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setState({ status: 'error', message: body.error ?? `Failed (${res.status})` });
        return;
      }
      setState({ status: 'idle' });
      setOpen(false);
      setStart('');
      setEnd('');
      setTitle('');
      onDone();
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-xl bg-[#0a1628] p-3">
      <span className="text-[11px] font-semibold text-gray-300">
        New snippet{maxSeconds != null ? ` (recording is ${fmtClock(maxSeconds)} long)` : ''}
      </span>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          step="0.1"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="Start (s)"
          className="w-full rounded-lg border border-white/[0.08] bg-[#0d1b2a] px-2 py-1.5 text-xs text-white placeholder:text-gray-600 focus:border-[#f5a623]/50 focus:outline-none"
        />
        <input
          type="number"
          min={0}
          step="0.1"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          placeholder="End (s)"
          className="w-full rounded-lg border border-white/[0.08] bg-[#0d1b2a] px-2 py-1.5 text-xs text-white placeholder:text-gray-600 focus:border-[#f5a623]/50 focus:outline-none"
        />
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Snippet title (optional)"
        maxLength={200}
        className="w-full rounded-lg border border-white/[0.08] bg-[#0d1b2a] px-2 py-1.5 text-xs text-white placeholder:text-gray-600 focus:border-[#f5a623]/50 focus:outline-none"
      />
      {state.status === 'error' && <span className="text-[11px] text-red-400">{state.message}</span>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={state.status === 'saving'}
          className="rounded-lg border border-[#f5a623]/30 bg-[#f5a623]/10 px-3 py-1 text-[11px] font-bold text-[#f5a623] hover:bg-[#f5a623]/20 disabled:opacity-50"
        >
          {state.status === 'saving' ? 'Saving…' : 'Save snippet'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setState({ status: 'idle' });
          }}
          className="rounded-lg border border-white/[0.12] bg-[#1a2a3a] px-3 py-1 text-[11px] font-semibold text-gray-400 hover:bg-[#22364a]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function RecapExportButton({ spaceId }: { spaceId: string }) {
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string }
  >({ status: 'idle' });

  async function onClick() {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`/api/recordings/recap?spaceId=${encodeURIComponent(spaceId)}`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setState({ status: 'error', message: body.error ?? `Failed (${res.status})` });
        return;
      }
      // Download the recap inputs as a JSON file the offline pipeline can use.
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `recap-inputs-${spaceId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setState({ status: 'idle' });
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state.status === 'loading'}
      title="Download the inputs (audio URLs + Farcaster host/guests) for the juke-space-recap Remotion pipeline"
      className="flex-shrink-0 rounded-lg border border-white/[0.12] bg-[#1a2a3a] px-3 py-1 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-[#22364a] disabled:opacity-50"
    >
      {state.status === 'loading' ? 'Preparing…' : 'Recap inputs'}
      {state.status === 'error' && <span className="ml-1 text-red-400">!</span>}
    </button>
  );
}
