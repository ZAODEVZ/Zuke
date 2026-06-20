import type { Metadata } from 'next';
import Link from 'next/link';
import { zukeConfig } from '@/zuke.config';

export const metadata: Metadata = {
  title: `${zukeConfig.name} - live audio for Farcaster communities`,
  description:
    'Zuke is the multi-provider live audio surface for Farcaster communities. Host on Juke, import X Spaces, keep recordings, cut snippets, and make recap videos.',
  openGraph: {
    title: `${zukeConfig.name} - Farcaster-native live audio`,
    description:
      'Host live audio, import X Spaces, keep recordings, cut snippets, and make recap videos.',
    siteName: zukeConfig.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${zukeConfig.name}`,
    description: 'Farcaster-native live audio: host, import, record, snippet, recap.',
  },
};

/**
 * Zuke root. Hero + primary CTAs, then a capability grid surfacing the full
 * surface area: listen, host on Juke, import an X Space, the recordings shelf
 * (multi-part + uploads + snippets), and the recap-video pipeline bridge.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0a1628] text-white">
      <header className="border-b border-white/[0.08] bg-gradient-to-b from-[#0d1b2a] to-[#0a1628]">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#855dcd]/30 bg-[#855dcd]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#a78bfa]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a78bfa]" aria-hidden="true" />
            Multi-provider live audio
          </div>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
            {zukeConfig.name}.
            <span className="block text-[#855dcd]">Host it. Import it. Keep it.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
            Live audio for Farcaster communities. Host on{' '}
            <a
              href="https://juke.audio"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-200 underline decoration-[#855dcd]/40 hover:decoration-[#a78bfa]"
            >
              Juke
            </a>
            , import a past X Space, then keep every recording — multi-part, uploads, and snippets —
            and turn it into a recap video.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/live"
              className="inline-flex items-center rounded-xl bg-[#855dcd] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#a78bfa]"
            >
              Listen now
            </Link>
            <Link
              href="/live/create"
              className="inline-flex items-center rounded-xl border border-white/[0.12] bg-[#1a2a3a] px-6 py-3 text-sm font-bold text-gray-200 transition-colors hover:bg-[#22364a]"
            >
              Host a space
            </Link>
            <Link
              href="/live/import"
              className="inline-flex items-center rounded-xl border border-white/[0.12] bg-[#1a2a3a] px-6 py-3 text-sm font-bold text-gray-200 transition-colors hover:bg-[#22364a]"
            >
              Import an X Space
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-gray-500">
          Everything you can do
        </h2>
        <p className="mb-6 max-w-2xl text-sm text-gray-400">
          One home for live audio across providers — listen, host, import, and keep the archive.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            title="Listen"
            href="/live"
            accent="purple"
            badge="Open"
            body="Drop into a live room, see what's scheduled, or scroll the recording shelf. Anyone can listen — no token gate."
          />
          <FeatureCard
            title="Host a space"
            href="/live/create"
            accent="purple"
            badge="Juke"
            body="Spin up a branded Juke space for a standup, fractal call, or Concertz night. Hosting is admin/password gated."
          />
          <FeatureCard
            title="Import an X Space"
            href="/live/import"
            accent="gold"
            badge="New"
            body="Bring a finished X (Twitter) Space in as a recording — paste the link, add the audio, and it joins your shelf."
          />
          <FeatureCard
            title="Recordings"
            href="/live/recordings"
            accent="gray"
            badge="Multi-part"
            body="Every ended space with audio, including multi-part Juke recordings and host uploads, with inline players."
          />
          <FeatureCard
            title="Snippets & recap"
            href="/live/recordings"
            accent="gold"
            badge="Clips"
            body="Cut audio snippets from any recording, then export the inputs for a PFP-rich recap video."
          />
          <FeatureCard
            title="Build status"
            href="/juke-status"
            accent="gray"
            badge="Live"
            body="Integration health, recent webhooks, shipped features, and what's blocking the next slice."
          />
        </div>

        <section className="mt-10 rounded-2xl border border-white/[0.06] bg-[#0d1b2a] p-6">
          <h2 className="text-sm font-bold text-gray-200">From live room to recap video</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-400">
            Host or import a space, keep its recording (multi-part aware), cut the highlights into
            snippets, then hand the audio plus your Farcaster guest list to the open-source{' '}
            <a
              href="https://github.com/99darwin/juke-space-recap"
              target="_blank"
              rel="noreferrer noopener"
              className="text-[#a78bfa] hover:underline"
            >
              juke-space-recap
            </a>{' '}
            Remotion pipeline for a 1080p recap with per-guest PFPs. Thanks{' '}
            <a
              href="https://farcaster.xyz/nickysap"
              target="_blank"
              rel="noreferrer noopener"
              className="text-[#a78bfa] hover:underline"
            >
              @nickysap
            </a>
            .
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {['Live on Juke', 'Import X Space', 'Multi-part recordings', 'Uploads', 'Snippets', 'Recap inputs'].map(
              (step) => (
                <span
                  key={step}
                  className="rounded-full border border-white/[0.1] bg-[#111d2e] px-3 py-1 text-[11px] font-semibold text-gray-300"
                >
                  {step}
                </span>
              ),
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] bg-[#0d1b2a]">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-gray-500">
          <span>
            {zukeConfig.name} runs on{' '}
            <a
              href="https://juke.audio"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-300 hover:text-[#a78bfa]"
            >
              Juke
            </a>
            {' '}- thanks{' '}
            <a
              href="https://farcaster.xyz/nickysap"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-300 hover:text-[#a78bfa]"
            >
              @nickysap
            </a>
            .
          </span>
          <div className="flex gap-3 text-[11px]">
            <Link href="/juke" className="text-gray-400 hover:text-[#a78bfa]">
              How we built it
            </Link>
            <a
              href="https://github.com/ZAODEVZ/Zuke"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-400 hover:text-[#a78bfa]"
            >
              GitHub
            </a>
            <Link href="/juke-integration.md" className="text-gray-400 hover:text-[#a78bfa]">
              llms.txt
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  title,
  href,
  body,
  accent,
  badge,
}: {
  title: string;
  href: string;
  body: string;
  accent: 'purple' | 'gold' | 'gray';
  badge: string;
}) {
  const accentClass =
    accent === 'purple'
      ? 'border-[#855dcd]/30 hover:border-[#a78bfa]/50 hover:shadow-lg hover:shadow-[#855dcd]/10 group-hover:text-[#a78bfa]'
      : accent === 'gold'
        ? 'border-[#f5a623]/30 hover:border-[#f5a623]/50 hover:shadow-lg hover:shadow-[#f5a623]/10 group-hover:text-[#f5a623]'
        : 'border-white/[0.08] hover:border-gray-600 group-hover:text-white';
  const badgeClass =
    accent === 'purple'
      ? 'border-[#855dcd]/30 text-[#a78bfa]'
      : accent === 'gold'
        ? 'border-[#f5a623]/30 text-[#f5a623]'
        : 'border-white/[0.12] text-gray-400';
  return (
    <Link
      href={href}
      className={`group block rounded-2xl border bg-[#111d2e] p-6 transition-all ${accentClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xl font-bold text-white transition-colors">{title}</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
          {badge}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">{body}</p>
      <span className="mt-4 inline-flex items-center text-xs font-semibold text-gray-500 transition-colors group-hover:text-gray-300">
        Open
        <svg className="ml-1 h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </Link>
  );
}
