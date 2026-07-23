import type { Metadata } from 'next';
import Link from 'next/link';
import { ImportXSpaceForm } from '@/components/spaces/ImportXSpaceForm';
import { zukeConfig } from '@/zuke.config';

export const metadata: Metadata = {
  title: `Import an X Space - ${zukeConfig.name}`,
  description: 'Bring a past X (Twitter) Space into Zuke as a recording.',
  robots: { index: false },
};

/**
 * /live/import — bring a finished X Space into Zuke. Creation-gated on the
 * server route (admin/host); this page renders the form for anyone, and the
 * POST returns 401 if the visitor is not signed in.
 */
export default function ImportXSpacePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0a1628] text-white">
      <header className="border-b border-white/[0.08] bg-[#0d1b2a]">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4">
          <Link
            href="/"
            aria-label="Back home"
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-[#a78bfa]"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-bold sm:text-lg">Import an X Space</h1>
            <p className="text-xs text-gray-500">Bring a finished X (Twitter) Space in as a recording.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <div className="rounded-2xl border border-white/[0.08] bg-[#111d2e] p-6">
          <ImportXSpaceForm />
        </div>

        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-[#0d1b2a] p-5 text-xs leading-relaxed text-gray-400">
          <h2 className="mb-2 text-sm font-bold text-gray-200">How it works</h2>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>Paste the X Space link (or its id). Zuke creates an ended space for it.</li>
            <li>
              Add the Space audio: paste a direct audio URL above, or upload the downloaded file on
              the space page.
            </li>
            <li>
              From there it behaves like any Zuke recording — play it, cut snippets, and export the
              inputs for a{' '}
              <a
                href="https://github.com/bettercallzaal/mp3-to-mp4-pipeline"
                target="_blank"
                rel="noreferrer noopener"
                className="text-[#a78bfa] hover:underline"
              >
                recap video
              </a>
              .
            </li>
          </ol>
          <p className="mt-3 text-[11px] text-gray-500">
            Note: recap PFP/username enrichment resolves Farcaster identities, so X-only guests
            won&apos;t be pictured. Live X Spaces can&apos;t be re-broadcast — import is for finished
            Spaces.
          </p>
        </div>
      </main>
    </div>
  );
}
