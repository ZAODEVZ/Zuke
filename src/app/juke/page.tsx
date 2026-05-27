import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getJukeIntegrationManifest,
  type ShippedFeature,
} from '@/lib/spaces/jukeIntegrationManifest';
import {
  getJukeIntegrationStats,
  type JukeIntegrationStats,
} from '@/lib/spaces/jukeSpacesDb';
import { zukeConfig } from '@/zuke.config';

export const metadata: Metadata = {
  title: `${zukeConfig.name} - live audio for Farcaster communities`,
  description:
    'Zuke is a white-label live audio surface for Farcaster communities. Built on Juke. Open-source, fork-and-deploy.',
  openGraph: {
    title: `${zukeConfig.name} - live audio for Farcaster communities`,
    description:
      'White-label live audio for Farcaster communities. Built on Juke. Fork it, deploy it, host on your own domain.',
    siteName: zukeConfig.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: zukeConfig.name,
    description: 'Live audio for Farcaster communities.',
  },
};

async function safeStats(): Promise<JukeIntegrationStats> {
  try {
    return await getJukeIntegrationStats();
  } catch {
    return {
      total_spaces: 0,
      active: 0,
      scheduled: 0,
      ended: 0,
      with_recording: 0,
      total_webhook_events: 0,
      recent_event_types: {},
      last_event_at: null,
    };
  }
}

const GITHUB_URL = 'https://github.com/ZAODEVZ/Zuke';

/**
 * /juke — the Zuke product pitch. Audience: other Farcaster community
 * operators (and the agents researching for them) who want to embed live
 * audio on their own surface without standing up their own LiveKit cluster.
 *
 * The page leads with the product offer, then drops every shipped feature
 * as receipts (sourced from jukeIntegrationManifest so it auto-updates), and
 * closes with the three-step deploy-your-own runbook. Pairs with /listen
 * (member-pull surface) and /juke-status (live ops dashboard).
 */
export default async function ZukeProductPage() {
  const manifest = getJukeIntegrationManifest();
  const stats = await safeStats();
  const shippedFeatures = manifest.shipped;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0a1628] text-white">
      <header className="border-b border-white/[0.08] bg-gradient-to-b from-[#0d1b2a] to-[#0a1628]">
        <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:py-20">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#855dcd]/10 border border-[#855dcd]/30 text-[#a78bfa] text-[10px] font-bold uppercase tracking-wider mb-5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#a78bfa]" aria-hidden="true" />
            Open source on{' '}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-[#855dcd]/40 hover:decoration-[#a78bfa]"
            >
              GitHub
            </a>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight max-w-2xl">
            Live audio for Farcaster communities.
            <span className="block text-[#a78bfa]">White-label. Open. Yours.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base sm:text-lg text-gray-400 leading-relaxed">
            {zukeConfig.name} is the white-label live audio surface for
            Farcaster communities. Powered by{' '}
            <a
              href="https://juke.audio"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-200 underline decoration-[#855dcd]/40 hover:decoration-[#a78bfa]"
            >
              Juke
            </a>
            . Graduated from the{' '}
            <a
              href="https://www.thezao.com"
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-200 underline decoration-[#855dcd]/40 hover:decoration-[#a78bfa]"
            >
              ZAO OS
            </a>
            {' '}lab. Fork, drop in 6 env vars, deploy.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center px-6 py-3 rounded-xl bg-[#855dcd] hover:bg-[#a78bfa] text-white text-sm font-bold transition-colors"
            >
              Fork on GitHub
            </a>
            <Link
              href="/listen"
              className="inline-flex items-center px-6 py-3 rounded-xl border border-white/[0.12] bg-[#1a2a3a] hover:bg-[#22364a] text-gray-200 text-sm font-bold transition-colors"
            >
              See it live
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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 space-y-12">
        <StatsStrip stats={stats} shippedCount={shippedFeatures.length} />

        <Section title="What you get">
          <div className="grid gap-3 sm:grid-cols-2">
            <FeatureCard
              title="Listen surface"
              body="Public /listen page. Live now, scheduled next, recording shelf. No auth required to listen - SIWF only for participation."
            />
            <FeatureCard
              title="Host + admin tools"
              body="/live/create UI plus admin API for programmatic space creation, end-space, recording handling, agent join."
            />
            <FeatureCard
              title="Webhook receiver"
              body="HMAC-verified inbound webhooks (room.started, finished, participant.*, recording.ready). Idempotent. Auto-cast on recap."
            />
            <FeatureCard
              title="Public status dashboard"
              body="/juke-status mirrors what you shipped + recent webhook deliveries + open asks. JSON + markdown + HTML, all in sync."
            />
          </div>
        </Section>

        <Section title="Why Zuke, not raw Juke">
          <ul className="space-y-3 text-sm text-gray-300 leading-relaxed">
            <li>
              <strong className="text-white">Your domain.</strong> Listeners
              land at <code className="text-[#a78bfa]">audio.yourbrand.com</code>,
              not <code>juke.audio/space/xyz</code>. Cast unfurls show your
              card.
            </li>
            <li>
              <strong className="text-white">Your database.</strong> All space
              metadata, participant counts, recordings land in your Supabase -
              queryable from your existing community tooling.
            </li>
            <li>
              <strong className="text-white">Your integrations.</strong> Recap
              casts from your own community account, custom CTAs on the live
              page, agent participants tied to your accounts.
            </li>
            <li>
              <strong className="text-white">No infra.</strong> Juke runs the
              LiveKit cluster, the iOS app, the iframe. You ship a Vercel
              project + a Supabase + 6 env vars.
            </li>
          </ul>
        </Section>

        <Section title="The build - every feature, newest first">
          <p className="text-xs text-gray-500 mb-4">
            Sourced from <code>jukeIntegrationManifest</code>. Every PR linked
            where one exists. Auto-updates as we ship.
          </p>
          <ol className="space-y-3">
            {shippedFeatures
              .slice()
              .sort((a, b) => (b.shippedAt > a.shippedAt ? 1 : -1))
              .map((f) => (
                <BuildRow key={f.id} feature={f} />
              ))}
          </ol>
        </Section>

        <Section title="Deploy your own">
          <DeployStep
            num={1}
            title="Fork the repo"
            body={
              <>
                <p className="text-sm text-gray-300">
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[#a78bfa] hover:underline"
                  >
                    github.com/ZAODEVZ/Zuke
                  </a>
                  . MIT-style license. Next.js 16 + Supabase + Juke developer API.
                </p>
                <CodeBlock>git clone https://github.com/ZAODEVZ/Zuke.git</CodeBlock>
              </>
            }
          />
          <DeployStep
            num={2}
            title="Provision Supabase + apply migrations"
            body={
              <>
                <p className="text-sm text-gray-300">
                  Create a Supabase project. Apply the two migration files in{' '}
                  <code className="text-[#a78bfa]">scripts/</code>:
                </p>
                <CodeBlock>{`scripts/juke-spaces-migration.sql
scripts/juke-spaces-migration-2.sql`}</CodeBlock>
              </>
            }
          />
          <DeployStep
            num={3}
            title="Set 6 env vars + register the webhook"
            body={
              <>
                <p className="text-sm text-gray-300">
                  Apply for a Juke developer key at{' '}
                  <a
                    href="https://juke.audio/developers"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[#a78bfa] hover:underline"
                  >
                    juke.audio/developers
                  </a>
                  . Then in Vercel:
                </p>
                <CodeBlock>{`NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
JUKE_API_KEY
JUKE_WEBHOOK_SECRET   # filled by step-6 webhook register
ZUKE_ADMIN_PASSWORD
CRON_SECRET`}</CodeBlock>
                <p className="text-xs text-gray-500 mt-2">
                  Deploy. Hit{' '}
                  <code className="text-[#a78bfa]">
                    POST /api/juke/admin/register-webhook
                  </code>{' '}
                  with the admin cookie. Copy the returned <code>whsec_</code>{' '}
                  into <code>JUKE_WEBHOOK_SECRET</code>, redeploy.
                </p>
              </>
            }
          />
        </Section>

        <Section title="Resources">
          <div className="grid gap-3 sm:grid-cols-3">
            <ResourceCard
              label="Juke llms.txt"
              href="https://juke.audio/llms.txt"
              hint="Canonical machine-readable Juke spec. Feed this to your agent."
            />
            <ResourceCard
              label="Zuke integration manifest"
              href="/juke-integration.md"
              hint="Our llms.txt-style mirror - shipped features + open asks."
              internal
            />
            <ResourceCard
              label="Build status"
              href="/juke-status"
              hint="HTML dashboard + JSON + markdown of the live integration."
              internal
            />
          </div>
        </Section>
      </main>

      <footer className="border-t border-white/[0.06] bg-[#0d1b2a]">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
          <span>
            {zukeConfig.name} on{' '}
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
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-gray-400 hover:text-[#a78bfa]"
            >
              GitHub
            </a>
            <Link href="/listen" className="text-gray-400 hover:text-[#a78bfa]">
              Demo
            </Link>
            <Link href="/juke-integration.md" className="text-gray-400 hover:text-[#a78bfa]">
              llms.txt
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StatsStrip({
  stats,
  shippedCount,
}: {
  stats: JukeIntegrationStats;
  shippedCount: number;
}) {
  const items = [
    { value: shippedCount, label: 'Features shipped' },
    { value: stats.total_spaces, label: 'Spaces hosted' },
    { value: stats.with_recording, label: 'With recording' },
    { value: stats.total_webhook_events, label: 'Webhook events' },
  ];
  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-xl border border-white/[0.08] bg-[#111d2e] px-4 py-3"
        >
          <p className="text-2xl font-bold text-white">{it.value}</p>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mt-1">{it.label}</p>
        </div>
      ))}
    </section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#111d2e] p-4">
      <p className="text-sm font-bold text-white">{title}</p>
      <p className="mt-1 text-xs text-gray-400 leading-relaxed">{body}</p>
    </div>
  );
}

function DeployStep({
  num,
  title,
  body,
}: {
  num: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#111d2e] p-5 mb-3">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#855dcd]/20 text-[#a78bfa] text-xs font-bold">
          {num}
        </span>
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      {body}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg border border-white/[0.08] bg-[#0a1628] p-3 text-[11px] leading-relaxed text-gray-300 font-mono">
      {children}
    </pre>
  );
}

function BuildRow({ feature }: { feature: ShippedFeature }) {
  return (
    <li className="rounded-xl border border-white/[0.08] bg-[#111d2e] p-4">
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h3 className="text-sm font-bold text-white">{feature.title}</h3>
        <span className="text-[10px] text-gray-500 font-mono">{feature.shippedAt}</span>
        {feature.pr && (
          <a
            href={feature.pr}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[10px] text-[#a78bfa] hover:underline"
          >
            View PR
          </a>
        )}
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{feature.description}</p>
    </li>
  );
}

function ResourceCard({
  label,
  href,
  hint,
  internal,
}: {
  label: string;
  href: string;
  hint: string;
  internal?: boolean;
}) {
  if (internal) {
    return (
      <Link
        href={href}
        className="block rounded-xl border border-white/[0.08] bg-[#111d2e] p-4 hover:border-[#a78bfa]/30 transition-colors"
      >
        <p className="text-sm font-bold text-white">{label}</p>
        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{hint}</p>
      </Link>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="block rounded-xl border border-white/[0.08] bg-[#111d2e] p-4 hover:border-[#855dcd]/30 transition-colors"
    >
      <p className="text-sm font-bold text-white">{label}</p>
      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{hint}</p>
    </a>
  );
}
