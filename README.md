# Zuke

White-label live audio surface for Farcaster communities, powered by Juke.

Graduated from ZAO OS (the lab) to its own repository.

## Getting Started

See `setup-zuke.md` for provisioning Supabase, configuring environment variables, and deploying.

## Development

```bash
npm install
npm run dev       # Start dev server
npm run build     # Production build
npm run typecheck # Type check
npm run test      # Run tests
```

## Key Directories

- `src/lib/spaces/` - Juke integration (webhooks, space management, partner tokens)
- `src/components/spaces/` - Audio UI components (embed, listener badge, controls)
- `src/app/live/` - Public audio rooms and creation interface
- `src/app/api/juke/` - Juke API routes (create, webhooks, admin)
- `scripts/` - Database migrations and webhook registration

## Architecture

- **Rooms**: Created via Juke's API, synced to Supabase `juke_spaces` table
- **Webhooks**: Juke sends real-time events (participant.joined, space.finished, etc.)
- **Auth**: SIWF + FID allowlist (iron-session) is the live admin path; the legacy `zuke_admin` password cookie still works as a back-compat fallback pending removal (see `src/lib/auth/session.ts`)
- **Casting**: Auto-cast stub (`src/lib/publish/auto-cast.ts` always no-ops) - the webhook handlers already call it, but no @thezao Farcaster signer credential is provisioned yet

## Environment Variables

See `.env.example` or `setup-zuke.md` for the full list.
