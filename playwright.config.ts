import { defineConfig, devices } from '@playwright/test';

/**
 * Minimal E2E smoke suite - Zuke had zero E2E coverage before this (flagged
 * in the 2026-07 prod-readiness audit, deliberately deferred at the time as
 * "needs a framework decision"). Scope is intentionally narrow: confirm the
 * app actually boots and serves its core public pages/routes, not full user
 * journeys (auth-gated flows need a real SIWF session, out of scope here).
 *
 * webServer builds + starts a real production server so this exercises the
 * same artifact Vercel deploys, not the dev server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3210',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run start -- -p 3210',
    url: 'http://localhost:3210',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Build-time only placeholders - same rationale as .github/workflows/ci.yml.
      // supabaseAdmin is a lazy Proxy (see src/lib/db/supabase.ts), so these
      // never get touched unless a test actually exercises a DB-backed route.
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://e2e-placeholder.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-placeholder',
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'e2e-placeholder-session-secret-32-chars-min',
    },
  },
});
