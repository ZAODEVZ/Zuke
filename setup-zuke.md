# Zuke Setup Guide

Follow these steps to provision and deploy Zuke.

## Step 1 - Supabase

1. Create a new Supabase project (or use an existing one)
2. Copy the project URL and service role key
3. Run the migrations:

```bash
psql -U postgres -d zuke_db -f scripts/juke-spaces-migration.sql
psql -U postgres -d zuke_db -f scripts/juke-spaces-migration-2.sql
psql -U postgres -d zuke_db -f scripts/juke-spaces-migration-3.sql
psql -U postgres -d zuke_db -f scripts/juke-spaces-migration-4.sql
```

Migration #4 adds multi-part recordings + the public `recordings` storage
bucket. See `docs/recap.md` for the recordings / snippets / recap-video flow.

## Step 2 - Juke API Key

1. Go to juke.audio/developers
2. Create a new API key for Zuke (separate key from ZAO OS)

There is no webhook secret to note here yet - Juke only generates that HMAC
secret later, server-side, when you register a webhook subscription (Step
4), and returns it exactly once in that response.

## Step 3 - Environment Variables

Create `.env.local` (there is no committed `.env.example` - `.gitignore`
excludes all `.env*` files) and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
JUKE_API_KEY=<your-juke-api-key>
JUKE_WEBHOOK_SECRET=<your-juke-webhook-secret>
JUKE_CREATE_PASSWORD=<shared-team-password-for-live-create>
SESSION_SECRET=<random-string-32-chars-or-longer>
ZUKE_ADMIN_FIDS=<comma-separated-farcaster-fids-allowed-as-admin>
ZUKE_ADMIN_PASSWORD=<optional-legacy-admin-cookie-fallback>
NEYNAR_API_KEY=<optional-for-recap-and-admin-login-pfp-enrichment>
CRON_SECRET=<random-string-shared-with-the-GitHub-Actions-workflow>
NEXT_PUBLIC_OPTIMISM_RPC_URL=<optional-custom-optimism-rpc-for-siwf-verify>
NEXT_PUBLIC_SITE_URL=<optional-canonical-origin-e.g.-https://zuke.thezao.com>
```

`SESSION_SECRET` and `ZUKE_ADMIN_FIDS` are required for the live SIWF admin
auth path (`src/lib/auth/session.ts`) - without `SESSION_SECRET` set to at
least 32 characters, session handling throws on every request that reaches
it. `ZUKE_ADMIN_PASSWORD` is only a documented back-compat fallback slated
for removal once secret rotation (task #71) closes. `JUKE_CREATE_PASSWORD`
gates the password path of `POST /api/juke/space`, which is what the
`/live/create` page's form always uses (`src/app/live/create/page.tsx`) -
without it set, that page's submit button can never succeed (`Wrong
password` on every attempt, since an empty/unset shared password never
matches), which matters because the Verification section below tells you
to use that exact page to confirm Juke integration end to end. `CRON_SECRET`
gates `GET /api/cron/juke-stale-rooms` (returns 401 without a matching
bearer token) - it must also be added as a **GitHub Actions repository
secret** (Settings -> Secrets and variables -> Actions), alongside a
`ZUKE_BASE_URL` repo secret (your deployed origin, e.g.
`https://audio.yourbrand.com`), since
`.github/workflows/juke-stale-rooms-cron.yml` is what actually calls this
route every 30 minutes - Vercel Cron isn't available on the Hobby tier.
Without both repo secrets set, the workflow runs but every call 401s and
stale rooms never get swept. `NEYNAR_API_KEY` has two independent consumers, not just recap: the recap
pipeline (`GET /api/recordings/recap`) and SIWF admin login
(`POST /api/auth/verify`, which reads `process.env.NEYNAR_API_KEY` directly
to resolve the signed-in admin's Farcaster username/PFP for the session).
Unset, both degrade gracefully - recap omits PFPs, and admin sessions show
`fid:{fid}` instead of a real username. `NEXT_PUBLIC_OPTIMISM_RPC_URL` is
optional - it configures the RPC endpoint `/api/auth/verify` uses to check
SIWF signatures (`src/lib/env.ts`); unset, it falls back to a public
Optimism RPC (`https://optimism-rpc.publicnode.com`). `NEXT_PUBLIC_SITE_URL` is
optional and read directly by `getBaseUrl()` (`src/zuke.config.ts`), the
first and highest-priority entry in its resolution order - it's what the
webhook registration route and the recap/wrap-up auto-cast text use to
build absolute `/live/{id}` URLs. Unset, `getBaseUrl()` falls back to
Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL`, which should
already resolve to your custom domain if one is assigned as the project's
production domain in Vercel - set this explicitly only if you want to pin
the value regardless of Vercel's domain-alias behavior.

## Step 4 - Register Webhook

```bash
npx tsx scripts/register-juke-webhook.ts
```

This POSTs to Juke and, on a fresh registration, writes the returned secret
into `JUKE_WEBHOOK_SECRET` in `.env.local`. Safe to re-run: Juke dedupes by
(app, url), and if the response doesn't include a new secret (subscription
already existed) the script leaves your existing `.env.local` untouched
rather than clobbering it. In production, use the admin route instead:
`POST /api/juke/admin/register-webhook` (session must be admin), then copy
`juke.secret` from the response into Vercel's env vars and redeploy - see
that route's docstring for the exact flow.

## Step 5 - Deploy

```bash
npm run build
npm run start
```

Or deploy to Vercel:

```bash
vercel --prod
```

## Verification

1. Navigate to `/juke-status` (public dashboard, no auth needed) to confirm
   the deployment sees Juke as configured
2. Create a room via `/live/create` to verify Juke integration end to end
3. Check webhook delivery in the webhook status view
4. `GET /api/health` should return `{ ok: true, db: 'reachable' }` - point an
   external uptime monitor here, not at `/api/juke/status` (that one swallows
   dependency failures and always returns 200)

## Rollback

No automated rollback tooling exists (documented here since the 2026-07
prod-readiness audit flagged this as missing - a runbook is the minimum
viable version, not a substitute for real tooling later).

**Bad deploy (code):**
1. Vercel dashboard -> zuke project -> Deployments -> find the last known-good
   deployment -> "..." menu -> Promote to Production. Instant, no rebuild.
2. Or: `git revert <bad-commit>`, push to `main` - triggers a normal redeploy.

**Bad migration (schema):**
There is no automated migration rollback - `scripts/juke-spaces-migration-*.sql`
are additive-only by design (new nullable columns / new tables, see each
file's header comment) specifically so a bad migration rarely needs a real
down-migration. If one does:
1. Write a new `scripts/juke-spaces-migration-N.sql` that undoes the specific
   change (e.g. `alter table ... drop column ...`) - do not edit a past
   migration file in place, the same way you wouldn't force-push a shared branch.
2. Run it manually against the Supabase SQL editor (same manual process as
   applying any migration here - see Step 1).
3. Run `GET /api/cron/schema-drift-check` (CRON_SECRET-gated) afterward to
   confirm the schema matches what the code expects again.

**Bad migration that was never applied (this is what actually happened in
2026-07):** the code shipped assuming a column existed that didn't. Symptom is
usually a `PGRST204`/`42P01` error surfacing as a generic 500. `GET
/api/cron/schema-drift-check` checks for exactly this drift on a 6-hour
schedule (`.github/workflows/schema-drift-check.yml`) - a failed run there
means a migration file was merged but never actually run against production.

## v1 Roadmap

- Integrate ZAO signer for auto-casting to @thezao
- Branding: Zuke identity + logo

Custom domain (`zuke.thezao.com`) shipped and verified live in production -
removed from this list. `getBaseUrl()` (`src/zuke.config.ts`) and every
consumer already resolve to it consistently; see `NEXT_PUBLIC_SITE_URL`
above if you need to pin the value explicitly.
