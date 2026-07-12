# Build Log

Running log across hourly overnight-loop invocations. Read this fully before
starting any new run - don't repeat or redo work a prior run already
finished or correctly ruled out.

## Run 1 — 2026-07-12

This was the first invocation of the hourly loop (this file didn't exist
yet). Background context confirmed via git log before starting: the
juke-stale-rooms GitHub Actions cron (`.github/workflows/juke-stale-rooms-cron.yml`)
was already merged to main (commit `7df4193`) - not redone.

### Blocker hit before any task work: `npm install` was completely broken

`node_modules` wasn't installed in this sandbox. Ran `npm install` to get
tooling working before touching anything, and it failed outright:
`viem@2.51.0`'s *actual published npm package.json* declares its `ox`
dependency as `https://pkg.pr.new/ox@386a34...` - an ephemeral PR-preview
build, not a real npm release (verified via `curl registry.npmjs.org/viem/2.51.0`,
not a lockfile artifact from this repo). viem 2.49.0 and 2.52.0 both depend
on normal published `ox` versions, so this looks like a one-off bad publish
from upstream. Fixed with `"overrides": { "viem": "2.52.0" }` in
package.json (`@farcaster/auth-client` requires `^2.29.2`, so 2.52.0
satisfies it). `npm install` now succeeds from a clean clone.

This was a hard blocker: without it, build/lint/test could never run, so
every commit tonight would have violated the "don't commit anything that
fails build/lint/test" rule. Necessary to fix before anything else.

### Also broken once install worked: typecheck, lint, and test had never
actually run to completion in this repo

- README documents `npm run typecheck` and `npm run test`, but
  package.json never defined either script (only dev/build/start/lint
  existed). Added both.
- Once `test` existed: `JukeEmbed.test.tsx` imports `@testing-library/react`
  and jest-dom matchers (`toHaveAttribute` etc.) that were never installed
  and had no vitest config/environment to support DOM rendering at all
  (no vitest.config.ts existed). Installed `@testing-library/react`,
  `@testing-library/jest-dom`, `jsdom`; added `vitest.config.ts` (jsdom
  environment + `@/` alias, since vitest's Vite resolver doesn't read
  tsconfig `paths`) and `vitest.setup.ts` (jest-dom matchers + RTL
  `afterEach(cleanup)`, without which cross-test DOM pollution failed 4/6
  cases in that file).
- Once `typecheck` ran: caught one real pre-existing bug -
  `juke-api.test.ts` cast a partial mock object straight to `Response`
  (missing required fields); fixed by routing through `unknown` first.
- Once `lint` ran (first clean run ever, since node_modules never
  existed): 4 pre-existing errors in files unrelated to tonight's task -
  a `let` that's never reassigned in the stale-rooms cron, a raw `<a>`
  that should be `next/link`'s `<Link>`, two unescaped apostrophes in JSX
  text on `/juke-status`. All fixed.

All of build / lint / typecheck / test are green as of the last commit
this run (`npm run build`, `npm run lint`, `npm run typecheck`,
`npm run test` all pass clean, 94/94 tests).

### Task A — automate Juke webhook registration

Read `src/app/api/juke/admin/register-webhook/route.ts`,
`scripts/register-juke-webhook.ts`, and `setup-zuke.md` fully before
changing anything, per instructions.

**Full automation is not possible without new external credentials I
don't have** - same category as the three explicitly-blocked items. Juke
generates the webhook HMAC secret server-side and returns it exactly once
in the POST response; there is no documented "list webhooks" endpoint
(only GET-by-id and DELETE-by-id exist per `src/lib/spaces/juke-api-reads.ts`),
so there's no way to query "does a valid webhook already exist for this
URL" without either an ID already in hand or making the registration call
itself. A human still has to be the one who receives and stores that
secret the first time, or - if it's ever lost - delete the old
subscription and re-register. That step cannot be automated from this
sandbox (no Vercel/GitHub dashboard access), and I'm not aware of any
Juke API that changes this.

What I did instead, per the "make the flow safer and re-runnable" framing:

1. **Fixed a genuinely broken script.** `scripts/register-juke-webhook.ts`
   was stale relative to the route it's supposed to mirror: it still
   POSTed `{ url, secret, events }` with a client-supplied secret, which
   the route's own docstring says Juke rejects with `422 extra_forbidden`
   (fixed there in a prior PR #669, per `jukeIntegrationManifest.ts` -
   the script was never updated to match). It also defaulted to the old
   `zaoos.com` domain instead of this repo's own `getBaseUrl()`, and
   `setup-zuke.md` claimed it "saves the webhook URL to .env.local" when
   the script never wrote anything to disk. Fixed all three: no more
   client secret, correct default URL via `getBaseUrl()`, and it now
   actually writes the returned secret into `JUKE_WEBHOOK_SECRET` in
   `.env.local` - without touching the existing value if a re-run's
   response doesn't include a fresh secret (Juke already existed for
   that URL). `setup-zuke.md` updated to match, plus a misplaced
   invocation of the script in Step 1 (before `JUKE_API_KEY` is even
   configured in Step 2/3) removed.

2. **Added machine-readable idempotency status to the admin route.**
   `POST /api/juke/admin/register-webhook` now returns
   `status: "created" | "already_registered"` depending on whether
   Juke's response actually included a fresh `secret`, with
   `action_required` text tailored to each case, plus `juke_status` on
   error responses. This doesn't change whether Juke dedupes (that's
   already true per the route's docstring: unique on `(app_id, url)`) -
   it makes the *caller* able to tell, programmatically, whether there's
   actually a secret to copy or not, instead of always showing the same
   "copy juke.secret" instructions even when nothing new was issued.

### Task B — other verified gaps found

3. **`jukeIntegrationManifest.ts` (served publicly at `/juke-status`,
   `/api/juke/status`, `/juke-integration.md` - read by Juke's own team
   per the architecture doc in that file) overclaimed a shipped feature.**
   It described "recap-cast" and "recap-cast-room-finished" as working,
   claiming `autoCastToZao` "silently no-ops when the @thezao signer env
   is missing." I checked `src/lib/env.ts` - there is no signer env var
   anywhere in it (`NEYNAR_API_KEY` is read-only, for username/pfp
   lookups). `src/lib/publish/auto-cast.ts` is an unconditional stub: it
   always logs and returns `null`, signer configured or not - there's no
   conditional logic at all. The webhook call sites
   (`jukeWebhookHandlers.ts`) are real and correctly wired; only the
   actual posting is unimplemented, because no @thezao Farcaster signer
   credential has ever been provisioned in this repo. Fixed the misleading
   inline comment and the two manifest descriptions to say this plainly.
   Did **not** attempt to implement real casting - that needs a new
   external credential (a Farcaster signer for @thezao) I don't have
   access to from this sandbox, same as the three explicitly-blocked
   items. Left it a stub, now honestly documented.

4. **README's "Auth: Admin password (v0), SIWN in v1" was stale.**
   `feat(auth): SIWF + FID allowlist + iron-session for admin` already
   merged (visible in git log before this run started). Checked
   `src/lib/auth/session.ts`: SIWF + FID allowlist is the live default
   admin path; the password cookie is only a documented back-compat
   fallback explicitly marked for removal after task #71 closes. Updated
   README to describe current reality instead of the pre-SIWF state.

### Explicitly not touched (per instructions - confirmed blocked on
someone outside this codebase)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- Build/lint/typecheck/test all pass clean as of this commit - a fresh
  clone should now `npm install && npm run build && npm run lint &&
  npm run typecheck && npm run test` with zero setup surprises. Confirm
  this is still true before assuming it (something upstream could still
  regress the `viem` override, or drift again).
- Recap-cast auto-posting is a stub (not blocked-on-Nicky like the three
  explicitly excluded items above - it's blocked on ZAO provisioning a
  Farcaster signer for @thezao, which is outside Juke's API surface
  entirely). Not something to pick up unless that credential shows up.
- Haven't done a deep audit of `src/app/api/juke/admin/agent-join` or
  `src/app/api/recordings/*` routes yet - worth a read-through next run
  if Task A/B here are considered closed out.

## Run 2 — 2026-07-12

Read this file fully before starting (per instructions). Fast-forwarded
local `main` to `origin/main` (HEAD had detached to Run 1's commit, no
divergent work lost). Re-verified from a clean `npm install`:
`npm run build`, `lint`, `typecheck`, `test` (94/94) all still pass clean
- confirms the Run 1 toolchain fixes hold up on a fresh checkout.

### Followed up on Run 1's "for next run" pointers

- **`src/app/api/juke/admin/agent-join` route + `jukeAgentJoin.ts`**: read
  both fully. Both are real, complete, correctly-gated implementations
  (admin-auth checked, Juke's documented 404/429 semantics handled
  explicitly, `isAutoAgentJoinEnabled()` correctly reads
  `ZAO_AUTO_AGENT_JOIN`). This is the same surface as the
  explicitly-blocked "Agent-in-Juke/ZOE auto-join" item - confirmed
  blocked on ZOE's VPS-side readiness to consume session tokens, not an
  engineering gap. Left untouched, as instructed.
- **`src/app/api/recordings/*` routes**: dispatched a sub-agent to do a
  full read-through of all four routes (`import-x`, `recap`, `snippet`,
  `upload`) and their entire call chains
  (`recordingsDb.ts`/`recordingsStorage.ts`/`xSpaces.ts`/`recordingParts.ts`/
  the `recording.ready`/`room.finished` webhook handler cases), plus a
  fresh TODO/FIXME/stub/XXX/HACK grep across `src/` and a README roadmap
  re-check. **Verified result: the recordings pipeline itself has no
  gaps** - docstrings match implementation, error handling is real
  (idempotent `23505` handling, graceful degradation when migration #4
  isn't applied), no stubs disguised as working code. The only
  grep-sweep hits are the HMS provider (`providers/hms.ts`), which is
  already honestly self-labeled `STUB`/`TODO(hms-port)` and correctly
  throws `not implemented yet` rather than silently misrouting - not a
  new finding.

### Found and fixed: `setup-zuke.md` was actively wrong, not just stale

Verified each claim myself against real code before touching anything
(per instructions - do not trust a sub-agent's report blindly either):

1. Verification section told a deployer to visit `/zuke-status` (does
   not exist anywhere under `src/app` - confirmed via search; the real
   page is `/juke-status`, `src/app/juke-status/page.tsx`), gated by "the
   admin password cookie" (that page's own metadata says it's a public
   dashboard - no auth check in the file), and to click a "Create Test
   Space" button that doesn't exist anywhere in the codebase (grepped,
   zero hits). Real room creation is at `/live/create`.
2. Step 3's env var list is missing `SESSION_SECRET` and
   `ZUKE_ADMIN_FIDS`. Confirmed in `src/lib/auth/session.ts:24-27`:
   `sessionOptions()` unconditionally throws
   `'SESSION_SECRET must be set and at least 32 characters'` whenever
   the legacy `zuke_admin` password cookie isn't present, and that path
   is hit by nearly every route (`getSessionData()` is called broadly,
   including by the recordings routes). A deployer following the doc
   literally - setting only the vars it listed - gets a broken app for
   any user going through the now-live SIWF flow. `ZUKE_ADMIN_FIDS`
   (`src/lib/auth/session.ts:86,96`) gates who actually gets `isAdmin`
   on that path and was likewise missing.
3. Both `README.md` and `setup-zuke.md` pointed deployers at
   `.env.example` for the full env var list; that file was never
   committed (`.gitignore:34` excludes all `.env*`, no exception carved
   out for it) and doesn't exist in the repo. Fixed both docs to stop
   referencing it and point at `setup-zuke.md` Step 3 directly, with the
   two missing vars added.
4. `setup-zuke.md`'s "v1 Roadmap" still listed "Replace admin password
   with Farcaster SIWN" as outstanding - already done and documented
   correctly elsewhere (README, per Run 1). Removed the stale line.

All four fixes were pure documentation edits (`setup-zuke.md`,
`README.md`) - no code changed, so `npm run lint` / `npm run typecheck`
were re-run as a sanity check (both clean) but there was nothing for
`build`/`test` to regress. Committed and pushed as `36179ff`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- Toolchain (`install`/`build`/`lint`/`typecheck`/`test`) and the
  recordings pipeline are both now confirmed clean/accurate as of this
  run - no need to re-audit either from scratch unless something in the
  repo actually changes.
- Docs (`README.md`, `setup-zuke.md`) should now match reality. Worth a
  final skim of `docs/recap.md` next run - it's referenced by
  `setup-zuke.md` Step 1 but hasn't been checked against
  `src/lib/spaces/recordings.ts`/`recordingParts.ts` yet.
- Recap-cast auto-posting is still a stub blocked on a @thezao Farcaster
  signer credential (not one of the three explicitly-excluded items, but
  same category: needs external provisioning, not code).
