# Zuke - Multi-Provider Live Audio for Farcaster Communities

A white-label live audio platform powered by Juke, with support for hosting, importing X Spaces, recording management, snippet creation, and recap video generation.

**Status:** Production-ready core (Juke provider) with active development on import/recordings features. HMS backend is scaffolded but not implemented.

## Quick Start

```bash
npm install
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run typecheck    # Type check (tsc)
npm run test         # Run tests (Vitest)
npm run lint         # ESLint
```

Environment setup: See `setup-zuke.md` for Supabase provisioning, Juke API key setup, and complete env var configuration. No `.env.example` is committed (`.gitignore` blocks `.env*` files) - environment is documented only in `setup-zuke.md`.

## Stack

- **Framework:** Next.js 16, React 19
- **Database:** Supabase (PostgreSQL with RLS)
- **Audio Provider:** Juke (primary), HMS/100ms (scaffolded)
- **Auth:** Farcaster Sign-In with Frame (SIWF) + legacy password cookie
- **Styling:** Tailwind CSS v4
- **Testing:** Vitest + React Testing Library

## Architecture

### Main Features

1. **Live Rooms (`/live/*`)**
   - Create rooms via Juke API: `/live/create` (requires `JUKE_CREATE_PASSWORD`)
   - Join rooms: `/live/[spaceId]`
   - Public listen view: `/listen`
   - Status dashboard: `/juke-status` (no auth, public)

2. **Recordings & Snippets (`/api/recordings/*`)**
   - Webhook handlers capture Juke events (room.started, participant.joined/left, room.ended, recording.ready)
   - Supabase storage bucket `recordings` holds multi-part recordings
   - Snippet creation: `POST /api/recordings/snippet` (cuts a specific audio segment)
   - Recap video generation: `GET /api/recordings/recap` (compiles recording + metadata into video)

3. **X Space Import (`/live/import` + `/api/recordings/import-x`)**
   - Admin form at `/live/import` (requires Farcaster SIWF auth + FID allowlist)
   - HTTP client fetches X Space details (via fxtwitter API)
   - Syncs space record to `juke_spaces` table with `provider='x'`
   - Debug endpoint in production (line 92 of route.ts) temporarily allows any signed-in user to see DB errors (remove after testing)

4. **Admin Console (`/admin`)**
   - SIWF login via `/admin/login` (redirects to Farcaster sign-in)
   - Routes require `ZUKE_ADMIN_FIDS` allowlist (comma-separated FIDs)
   - Legacy password auth: `ZUKE_ADMIN_PASSWORD` cookie (back-compat, slated for removal)
   - Webhook status, room management, agent integration

5. **Juke Integration**
   - Provider abstraction: `src/lib/spaces/providers/`
   - Webhook verification: `jukeWebhookVerify.ts` (HMAC validation)
   - Webhook handlers: `jukeWebhookHandlers.ts` (event dispatch to DB + storage)
   - Partner token generation: `juke-partner-token.ts` (secure room entry for guests)

### Database Schema

- `juke_spaces` - Room records (provider, external_id, name, recording_url, etc.)
- `recording_parts` - Multi-part recording segments (juke spaces only; X imports have single URL)
- `recordings` storage bucket - Audio file storage (Supabase public bucket)

See `scripts/juke-spaces-migration-*.sql` for full schema. Migrations 1-4 are cumulative (upgrade in order).

### Directory Map

```
src/
  app/
    admin/              # Admin console (SIWF auth required)
    api/
      auth/             # SIWF nonce/verify, session, logout
      juke/             # Juke API routes (create, webhooks, admin, partner token)
      cron/             # GitHub Actions cron tasks (stale room sweeper)
      recordings/       # Recording webhooks, snippet, recap, import-x
    live/               # Public room pages
      [spaceId]/        # Room listener view
      create/           # Room creation form (password-gated)
      import/           # X Space import form (SIWF auth)
      recordings/       # Recordings shelf (multi-part + uploads + snippets)
    juke-status/        # Public Juke health dashboard (no auth)
    listen/             # Listener view (alias to /live/[spaceId])
  components/spaces/    # Audio UI components (embed, badge, controls)
  lib/
    auth/               # Session, SIWF verification, FID allowlist
    db/                 # Supabase client + typed queries
    farcaster/          # Farcaster utilities (username lookup, etc.)
    publish/            # Auto-cast stub (not yet implemented)
    spaces/             # Juke + HMS providers, webhook handlers, recording logic
```

## Key Files & Gotchas

### Auth Flow

- **SIWF (primary):** `/api/auth/nonce` -> `/api/auth/verify` -> session cookie
- **Legacy password:** `ZUKE_ADMIN_PASSWORD` env var, timing-safe comparison (see `src/lib/auth/session.ts`)
- **FID Allowlist:** Checked against `ZUKE_ADMIN_FIDS` in `/api/auth/verify`
- **Session Secret:** Required, minimum 32 characters (`SESSION_SECRET` env var)

### Environment Variables (Required)

| Variable | Purpose | Example |
|----------|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access | (64-char secret) |
| `JUKE_API_KEY` | Juke API authentication | (from juke.audio/developers) |
| `JUKE_WEBHOOK_SECRET` | Webhook HMAC verification | (returned by webhook registration) |
| `JUKE_CREATE_PASSWORD` | Gate `/live/create` form | (shared team password) |
| `SESSION_SECRET` | iron-session encryption | (random 32+ char string) |
| `ZUKE_ADMIN_FIDS` | Admin FID allowlist | `123,456,789` |
| `CRON_SECRET` | GitHub Actions cron gate | (random string, also set as repo secret) |

### Optional Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ZUKE_ADMIN_PASSWORD` | Legacy fallback (to be removed) | unset |
| `NEYNAR_API_KEY` | Recap PFPs + admin username | unset (degrades gracefully) |
| `NEXT_PUBLIC_OPTIMISM_RPC_URL` | SIWF signature verification | public optimism-rpc.publicnode.com |
| `NEXT_PUBLIC_SITE_URL` | Canonical deployment origin | Vercel's `VERCEL_PROJECT_PRODUCTION_URL` |

## Deployment

### Vercel (Production)

```bash
vercel --prod
```

Set these as **repository secrets** in GitHub (Settings > Secrets and variables > Actions):
- `CRON_SECRET` - gates `GET /api/cron/juke-stale-rooms`
- `ZUKE_BASE_URL` - base URL for cron webhook calls (e.g. `https://zuke.thezao.com`)

The GitHub Actions workflow `.github/workflows/juke-stale-rooms-cron.yml` runs every 30 minutes to sweep stale rooms (Vercel Cron not available on Hobby tier).

### Local Development

```bash
npm run dev
# Then set env vars in `.env.local` and run setup:
npx tsx scripts/register-juke-webhook.ts
```

## Testing

Coverage targets: auth flows, Juke/X provider abstractions, webhook verification, recording fragment stitching.

```bash
npm run test                    # All tests
npm run test -- src/lib/spaces # Specific directory
```

Tests use `vitest` with mocked Supabase/Juke clients. No production database is accessed in tests.

## Current State & Known Issues

### Working

- Juke integration (create rooms, webhook dispatch, recording capture)
- SIWF + FID allowlist admin auth
- X Space import (fetch + sync to DB)
- Recording multi-part stitching + recap video generation
- Snippet creation (audio segment extraction)

### In Progress / Debugging

- Import-x error handling (recent work on line 92 of `/api/recordings/import-x/route.ts` shows DB errors to admins temporarily)
- Webhook delivery reliability (recent fix for `recording.ready` events clobbering `recording_url`)

### Not Yet Implemented

- **HMS/100ms backend** - Provider scaffold exists (`src/lib/spaces/providers/hms.ts`) but is all TODOs. Requires:
  - 100ms SDK integration + auth token generation
  - Webhook event dedup (idempotency table)
  - One-open-session-per-room unique index
  - Stale-room sweeper for reconciliation
  - Full webhook verification + event routing

- **Auto-casting** - Stub in `src/lib/publish/auto-cast.ts` (always no-ops). Needs:
  - ZAO signer credential provisioning (`APP_SIGNER_PRIVATE_KEY` env var)
  - Farcaster cast generation in webhook handlers (room.started, room.ended, recording.ready events)

- **Branding identity** - Product identity not yet established. Needs logo, design system, brand voice.

### Debug Routes (Cleanup Needed)

- `GET /api/cron/debug-write-test/route.ts` - Temporary test route, remove after verification
- Import-x admin debug detail (line 92) - Widen from admin-only once testing completes

## Continuing Development

### Next Steps

1. **Clean up debug routes** - Remove `/api/cron/debug-write-test` and revert import-x debug widening to admin-only
2. **Implement HMS backend** - Follow the TODO scaffolding in `src/lib/spaces/providers/hms.ts`
3. **Enable auto-casting** - Wire ZAO signer into webhook handlers for Farcaster posts
4. **Establish branding** - Logo, design system, brand voice for Zuke product

### How to Add a Feature

1. **New page:** Add to `src/app/*/page.tsx`, wire auth if needed in `src/lib/auth/session.ts`
2. **New API route:** Add to `src/app/api/**/route.ts`, follow conventions in `/api/auth/verify` for error handling + Zod validation
3. **Juke provider method:** Edit `src/lib/spaces/providers/juke.ts`, update `src/lib/spaces/providers/types.ts` interface
4. **Database schema:** Add migration to `scripts/`, run locally, document in setup-zuke.md
5. **Test:** Co-locate test file next to source: `*.test.ts`

## Troubleshooting

### Build fails with `tsc` error

Check `npm run typecheck` - may be missing env vars or type mismatches in `/src/lib/auth/session.ts` (requires `SESSION_SECRET` to be at least 32 chars).

### Juke webhook not delivering

1. Check `JUKE_WEBHOOK_SECRET` matches what Juke has on file
2. Verify `JUKE_CREATE_PASSWORD` is set (used by create form)
3. Navigate to `/juke-status` to see webhook delivery status
4. Re-register via `POST /api/juke/admin/register-webhook` (admin auth required)

### Admin login redirects to Farcaster but doesn't return

1. Verify `SESSION_SECRET` is set and 32+ chars
2. Check FID is in `ZUKE_ADMIN_FIDS` allowlist
3. Confirm `NEXT_PUBLIC_SUPABASE_URL` is reachable (CORS issue?)

### Import-X shows DB error instead of success

- Admins will see the real error (temporary debug mode)
- Check that `juke_spaces` table has the columns defined in migrations 1-4
- Verify X Space URL is valid and fxtwitter API is reachable

## Secrets Hygiene

- **Never commit `.env` files** (`.gitignore` blocks `*.env*`)
- **Env vars needed:** `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `JUKE_API_KEY`, `JUKE_WEBHOOK_SECRET`, `JUKE_CREATE_PASSWORD`
- **GitHub Actions secrets:** `CRON_SECRET`, `ZUKE_BASE_URL` (required for cron workflow)
- No API keys or tokens are logged or sent to client (all server-side in route handlers)

## Contributing

- Branch off `main`
- Follow TypeScript hygiene: explicit return types on exported functions, no `any`, Zod validation on user input
- Add tests for new features (Vitest)
- Open a PR (never push directly to main)
- Deploy via Vercel once PR is merged

## Links

- **Juke:** https://juke.audio/developers
- **Farcaster Auth:** @farcaster/auth-kit docs
- **Setup Guide:** See `setup-zuke.md` for complete provisioning steps
- **Architecture Docs:** See `docs/recap.md` for recording/snippet/recap-video flow
- **Juke Integration Docs:** See `src/app/juke-integration.md/route.ts` (OpenAPI-style docs)

## License

See LICENSE file.
