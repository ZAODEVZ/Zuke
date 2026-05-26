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
- **Auth**: Admin password (v0), SIWN in v1
- **Casting**: Auto-cast stub (no-op in v0, will integrate with ZAO signer later)

## Environment Variables

See `.env.example` or `setup-zuke.md` for the full list.
