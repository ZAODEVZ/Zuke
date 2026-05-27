import type { Metadata } from 'next';
import Link from 'next/link';
import { zukeConfig } from '@/zuke.config';

export const metadata: Metadata = {
  title: `${zukeConfig.name} - white-label live audio for Farcaster communities`,
  description:
    'Zuke is the white-label live audio surface for Farcaster communities. Built on Juke (the protocol). Graduated from ZAO OS - the lab.',
  openGraph: {
    title: `${zukeConfig.name} - Farcaster-native live audio`,
    description: 'White-label live audio for Farcaster communities. Listen now.',
    siteName: zukeConfig.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${zukeConfig.name}`,
    description: 'Farcaster-native live audio.',
  },
};

/**
 * Zuke root. Hero + 3 entry points (Listen / How we built / Build status).
 * Routes to /listen as the member-pull surface, /juke (which we keep as the
 * partnership story for now) and /juke-status (the dev/agent dashboard).
 */
export default function HomePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0a1628] text-white">
      <header className="border-b border-white/[0.08] bg-gradient-to-b from-[#0d1b2a] to-[#0a1628]">
        <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:py-24">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#855dcd]/10 border border-[#855dcd]/30 text-[#a78bfa] text-[10px] font-bold uppercase tracking-wider mb-5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a78bfa]" aria-hidden="true" />
            Farcaster-native live audio
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight max-w-2xl">
            {zukeConfig.name}.
            <span className="block text-[#855dcd]">Listen, live, on Farcaster.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base sm:text-lg text-gray-400 leading-relaxed">
            White-label live audio for Farcaster communities. Powered by{' '}
            <a
              href="https://juke.audio"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-200 underline decoration-[#855dcd]/40 hover:decoration-[#a78bfa]"
            >
              Juke
            </a>
            . Graduated from the ZAO OS lab.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/listen"
              className="inline-flex items-center px-6 py-3 rounded-xl bg-[#855dcd] hover:bg-[#a78bfa] text-white text-sm font-bold transition-colors"
            >
              Listen now
            </Link>
            <Link
              href="/juke"
              className="inline-flex items-center px-6 py-3 rounded-xl border border-white/[0.12] bg-[#1a2a3a] hover:bg-[#22364a] text-gray-200 text-sm font-bold transition-colors"
            >
              How we built it
            </Link>
            <Link
              href="/juke-status"
              className="inline-flex items-center px-6 py-3 rounded-xl border border-white/[0.12] bg-[#1a2a3a] hover:bg-[#22364a] text-gray-400 text-sm font-bold transition-colors"
            >
              Build status
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 grid gap-6 sm:grid-cols-3">
        <FeatureCard
          title="Listen"
          href="/listen"
          body="Drop into a live room, browse what's scheduled, or scroll back through the recording shelf."
          accent="purple"
        />
        <FeatureCard
          title="Embed"
          href="/juke"
          body="Bring Zuke to your own community. Build journey, code receipts, and the integration manifest."
          accent="gold"
        />
        <FeatureCard
          title="Status"
          href="/juke-status"
          body="Live integration health, recent webhooks, shipped features, and what's blocking the next slice."
          accent="gray"
        />
      </main>

      <footer className="border-t border-white/[0.06] bg-[#0d1b2a]">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
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
              href="https://farcaster.xyz/~/profiles/nickysap"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-300 hover:text-[#a78bfa]"
            >
              @nickysap
            </a>
            .
          </span>
          <div className="flex gap-3 text-[11px]">
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
}: {
  title: string;
  href: string;
  body: string;
  accent: 'purple' | 'gold' | 'gray';
}) {
  const accentClass =
    accent === 'purple'
      ? 'border-[#855dcd]/30 hover:border-[#a78bfa]/50 hover:shadow-lg hover:shadow-[#855dcd]/10 group-hover:text-[#a78bfa]'
      : accent === 'gold'
        ? 'border-[#f5a623]/30 hover:border-[#f5a623]/50 hover:shadow-lg hover:shadow-[#f5a623]/10 group-hover:text-[#f5a623]'
        : 'border-white/[0.08] hover:border-gray-600 group-hover:text-white';
  return (
    <Link
      href={href}
      className={`group block rounded-2xl border bg-[#111d2e] p-6 transition-all ${accentClass}`}
    >
      <h2 className="text-xl font-bold text-white transition-colors">{title}</h2>
      <p className="mt-2 text-sm text-gray-400 leading-relaxed">{body}</p>
      <span className="mt-4 inline-flex items-center text-xs font-semibold text-gray-500 group-hover:text-gray-300 transition-colors">
        Open
        <svg className="ml-1 h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </Link>
  );
}
