'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type FormState =
  | { status: 'idle' }
  | { status: 'importing' }
  | { status: 'done'; spaceId: string }
  | { status: 'error'; message: string };

/**
 * Import a past X (Twitter) Space into Zuke. Posts to /api/recordings/import-x,
 * which creates an ended 'songjam'-provider space and optionally attaches the
 * audio URL as a recording. On success it routes to the new /live/{id} page,
 * where the host can also upload the downloaded audio file, snippet it, and
 * export recap inputs.
 */
export function ImportXSpaceForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [state, setState] = useState<FormState>({ status: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: 'importing' });
    try {
      const res = await fetch('/api/recordings/import-x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          title: title.trim(),
          audioUrl: audioUrl.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        spaceId?: string;
      };
      if (!res.ok || !body.ok || !body.spaceId) {
        setState({ status: 'error', message: body.error ?? `Import failed (${res.status})` });
        return;
      }
      setState({ status: 'done', spaceId: body.spaceId });
      router.push(`/live/${body.spaceId}`);
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-300">X Space link</span>
        <input
          type="text"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://x.com/i/spaces/1YpKkZWBplYxj"
          className="w-full rounded-xl border border-white/[0.08] bg-[#0d1b2a] px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:border-[#855dcd]/60 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-300">Title</span>
        <input
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ZAO on X — Tuesday Spaces"
          className="w-full rounded-xl border border-white/[0.08] bg-[#0d1b2a] px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:border-[#855dcd]/60 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-300">
          Audio URL <span className="font-normal text-gray-500">(optional)</span>
        </span>
        <input
          type="url"
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
          placeholder="https://… direct mp3/m4a link"
          className="w-full rounded-xl border border-white/[0.08] bg-[#0d1b2a] px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:border-[#855dcd]/60 focus:outline-none"
        />
        <span className="text-[11px] text-gray-500">
          Download the Space audio first (yt-dlp, SpacesDown, Flowjin). Paste a direct link here, or
          leave blank and upload the file on the next screen.
        </span>
      </label>

      {state.status === 'error' && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={state.status === 'importing' || state.status === 'done'}
        className="self-start rounded-xl bg-[#855dcd] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#a78bfa] disabled:opacity-50"
      >
        {state.status === 'importing'
          ? 'Importing…'
          : state.status === 'done'
            ? 'Imported ✓'
            : 'Import X Space'}
      </button>
    </form>
  );
}
