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
3. Note the `Webhook Secret` for incoming events

## Step 3 - Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
JUKE_API_KEY=<your-juke-api-key>
JUKE_WEBHOOK_SECRET=<your-juke-webhook-secret>
ZUKE_ADMIN_PASSWORD=<a-secure-password-for-v0>
NEYNAR_API_KEY=<optional-for-recap-pfp-enrichment>
```

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

1. Navigate to `/zuke-status` with the admin password cookie
2. Click "Create Test Space" to verify Juke integration
3. Check webhook delivery in the webhook status view

## v1 Roadmap

- Replace admin password with Farcaster SIWN
- Integrate ZAO signer for auto-casting to @thezao
- Custom domain: zuke.thezao.com
- Branding: Zuke identity + logo
