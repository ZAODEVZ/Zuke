import type { Metadata } from 'next';
import Link from 'next/link';
import { jukeSpaceOgImageUrl } from '@/lib/spaces/juke';
import {
  getJukeSpacesByIds,
  listRecordedJukeSpaces,
  type JukeSpaceRow,
} from '@/lib/spaces/jukeSpacesDb';
import { listRecentRecordedSpaceIds } from '@/lib/spaces/recordingsDb';
import { zukeConfig } from '@/zuke.config';

export const metadata: Metadata = {
  title: `Recordings - ${zukeConfig.name}`,
  description: 'Past audio spaces on Zuke — Juke recordings, uploads, and imported X Spaces.',
  robots: { index: false },
};

/** Render a friendly relative date — "3h ago", "2d ago", "May 22" once we
 * pass a week, so the recording shelf stays scannable. */
function formatEndedAt(value: string | null): string {
  if (!value) return 'recently';
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return 'recently';
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Fetch the full recordings shelf:
 * - legacy path: juke_spaces rows with recording_url set (pre-migration-4)
 * - new path: any space that has a row in juke_recordings (uploads, imports,
 *   multi-part) even if recording_url was never set
 * Merges both, deduplicates by id, most-recently-ended first.
 */
async function safeListRecordingsShelf(): Promise<JukeSpaceRow[]> {
  try {
    const [legacySpaces, recentIds] = await Promise.all([
      listRecordedJukeSpaces(50),
      listRecentRecordedSpaceIds(50),
    ]);

    // Build a map from the legacy list
    const byId = new Map<string, JukeSpaceRow>(legacySpaces.map((s) => [s.id, s]));

    // Hydrate any ids only found in juke_recordings (not in legacySpaces)
    const newIds = recentIds.filter((id) => !byId.has(id));
    if (newIds.length > 0) {
      const extra = await getJukeSpacesByIds(newIds);
      for (const s of extra) byId.set(s.id, s);
    }

    // Sort: most recently ended/updated first
    return [...byId.values()].sort((a, b) => {
      const ta = new Date(a.ended_at ?? a.updated_at ?? 0).getTime();
      const tb = new Date(b.ended_at ?? b.updated_at ?? 0).getTime();
      return tb - ta;
    });
  } catch {
    return [];
  }
}

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  songjam: { label: 'X Space', color: 'border-sky-500/30 text-sky-400' },
  juke: { label: 'Juke', color: 'border-[#f5a623]/30 text-[#f5a623]' },
};

/**
 * /live/recordings — shelf of all past spaces with any audio attached.
 * Covers Juke auto-recordings, host uploads, and imported X Spaces.
 */
export default async function LiveRecordingsPage() {
  const recordings = await safeListRecordingsShelf();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0a1628] text-white">
      <header className="border-b border-white/[0.08] bg-[#0d1b2a]">
        <div className="flex items-center gap-3 px-4 py-4 max-w-4xl mx-auto w-full">
          <Link
            href="/"
            aria-label="Back home"
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-[#f5a623]"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-bold">Recordings</h1>
            <p className="text-xs text-gray-500">
              Juke spaces, uploads &amp; X Space imports — all audio in one shelf.
            </p>
          </div>
          <span
            className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-[#f5a623]/10 border border-[#f5a623]/30 text-[#f5a623] text-[11px] font-bold"
            aria-label={`${recordings.length} ${recordings.length === 1 ? 'recording' : 'recordings'}`}
          >
            {recordings.length}
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-4xl mx-auto w-full">
        {recordings.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {recordings.map((row) => (
              <RecordingCard key={row.id} row={row} endedLabel={formatEndedAt(row.ended_at)} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-[#f5a623]/10 flex items-center justify-center mb-5">
        <svg className="w-8 h-8 text-[#f5a623]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-7-15a3 3 0 016 0v6a3 3 0 11-6 0V5z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold mb-1">No recordings yet</h2>
      <p className="text-gray-500 text-sm max-w-xs">
        Ended spaces with audio show up here — Juke auto-recordings, host uploads, and imported X
        Spaces.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 justify-center">
        <Link
          href="/live/create"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#f5a623] hover:bg-[#ffd700] text-[#0a1628] text-sm font-bold transition-colors"
        >
          Host a space
        </Link>
        <Link
          href="/live/import"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/[0.12] bg-[#1a2a3a] text-gray-200 text-sm font-bold transition-colors hover:bg-[#22364a]"
        >
          Import an X Space
        </Link>
      </div>
    </div>
  );
}

function RecordingCard({ row, endedLabel }: { row: JukeSpaceRow; endedLabel: string }) {
  const recordingUrl = row.recording_url ?? '';
  const provider = (row.provider ?? 'juke') as string;
  const badge = SOURCE_BADGE[provider] ?? SOURCE_BADGE.juke;
  // X Space imports don't have a juke.audio OG image, so skip the thumbnail.
  const isJukeHosted = provider === 'juke';
  const ogImage = isJukeHosted ? jukeSpaceOgImageUrl(row.id) : null;

  return (
    <li className="group bg-[#111d2e] border border-white/[0.08] rounded-xl overflow-hidden transition-all hover:border-gray-600 hover:shadow-lg hover:shadow-black/20">
      <Link
        href={`/live/${row.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a623] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1628]"
        aria-label={`Open recording: ${row.title}`}
      >
        {ogImage ? (
          <div className="aspect-[1200/630] bg-[#0a1628] relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ogImage}
              alt=""
              className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
              loading="lazy"
            />
            <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] font-bold uppercase tracking-wider text-gray-200">
              Recording
            </div>
          </div>
        ) : (
          <div className="aspect-[1200/630] bg-[#0d1b2a] flex items-center justify-center relative">
            <svg className="w-12 h-12 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-7-15a3 3 0 016 0v6a3 3 0 11-6 0V5z" />
            </svg>
            <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] font-bold uppercase tracking-wider text-gray-200">
              Recording
            </div>
          </div>
        )}
        <div className="p-4 pb-2">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm font-bold leading-tight line-clamp-2 group-hover:text-[#f5a623] transition-colors">
              {row.title || 'Untitled space'}
            </h3>
            <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-gray-500 text-xs">
            Ended {endedLabel}
            {typeof row.participant_count === 'number' && row.participant_count > 0 && (
              <>
                {' · '}
                {row.participant_count} {row.participant_count === 1 ? 'listener' : 'listeners'}
              </>
            )}
          </p>
        </div>
      </Link>
      <div className="px-4 pb-4 space-y-2">
        {recordingUrl ? (
          <>
            <audio
              controls
              preload="none"
              src={recordingUrl}
              className="w-full h-9 [&::-webkit-media-controls-panel]:bg-[#0a1628]"
            >
              Your browser does not support inline audio playback.
            </audio>
            <a
              href={recordingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center w-full px-4 py-2 rounded-xl border border-white/[0.12] bg-[#1a2a3a] text-gray-300 text-[11px] font-semibold hover:bg-[#22364a] transition-colors"
            >
              Open in new tab
            </a>
          </>
        ) : (
          <Link
            href={`/live/${row.id}`}
            className="inline-flex items-center justify-center w-full px-4 py-2 rounded-xl border border-white/[0.12] bg-[#1a2a3a] text-gray-300 text-[11px] font-semibold hover:bg-[#22364a] transition-colors"
          >
            Open space page →
          </Link>
        )}
      </div>
    </li>
  );
}
