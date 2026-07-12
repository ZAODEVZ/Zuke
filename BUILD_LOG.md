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

## Run 3 — 2026-07-12

Read this file fully before starting (per instructions). Fast-forwarded
local `main` to `origin/main` (10 commits behind, HEAD had detached again -
same pattern as Run 2, no divergent work lost). Re-verified from a clean
`npm install`: `npm run build`, `lint`, `typecheck`, `test` (94/94) all
still pass clean before touching anything.

### Task A — already correctly ruled out (Run 1). Not redone.

Full automation is still not possible without new external credentials
(Juke issues the webhook secret once, server-side, with no list-webhooks
endpoint to query against). Nothing has changed since Run 1's writeup.

### Task B — fresh gap sweep, this run's actual work

Checked `docs/recap.md` (flagged by Run 2 as unread) against
`src/app/api/recordings/recap/route.ts` line-by-line: accurate, no gaps.
`scripts/juke-spaces-migration-4.sql` also matches its own doc claims
(juke_recordings table + public `recordings` storage bucket). Nothing to
fix there.

Ran a fresh grep sweep for TODO/FIXME/stub across `src/` - every hit was
already-known/honest (hms.ts self-labeled stub, providers/index.ts
deliberately throws for unimplemented ids, supabase.ts's placeholder
fallback is a build-safety guard, not a functional gap).

Found and verified two real bugs/overclaims myself (not blindly trusting a
sub-agent) before fixing:

1. **`src/app/api/juke/space/route.ts` - a real status-code bug.**
   `providers/juke.ts` returns `status: 503` specifically to mean "Zuke
   isn't configured" (missing `JUKE_API_KEY`) - a distinct condition from
   an actual upstream Juke failure. But the route's own status mapping
   (`result.status >= 500 ? 502 : result.status`) silently collapsed that
   503 into 502 before it ever reached the client, contradicting the
   route's own docstring, which explicitly promises the not-configured
   case "reports 503 rather than failing opaquely." Fixed the mapping to
   carve out 503 specifically. Also fixed the docstring's stale claim that
   `JUKE_USER_TOKEN` gates this route - `juke-api.ts`'s own docstring says
   that bearer-auth path was superseded by key-only auth in 2026-05-22 and
   is never read here. No consumer currently branches on this route's
   exact status code (checked `/live/create`, `AdminConsole.tsx`,
   `/juke-status` - none do), so this was a silent contract violation, not
   an active outage, but still a real bug worth fixing.
   Commit: `bf0e8af`.

2. **README's webhook event list was wrong.** Claimed
   `space.finished` - no such event exists anywhere in
   `jukeWebhookHandlers.ts`. Real events: `room.started`,
   `participant.joined`, `participant.left`, `room.finished`/`room.ended`,
   `recording.ready`. Fixed. Commit: `ab834ba`.

3. **`src/app/api/cron/juke-stale-rooms/route.ts` docstring never got
   updated when the scheduler mechanism changed.** Said "Runs every 30
   minutes via vercel.json cron config" - no `vercel.json` exists in this
   repo at all (confirmed - `find` came back empty), and the GitHub
   Actions workflow that actually runs it (merged earlier tonight, before
   this loop started) has its own comment saying Vercel Cron was
   deliberately not used (Hobby tier). Fixed to name the real mechanism.
   Commit: `b292f76`.

4. **`jukeIntegrationManifest.ts` (served publicly at `/juke-status`,
   `/api/juke/status`, `/juke-integration.md`, read by Juke's own team)
   had three stale `OPEN_ASKS` entries for asks Zuke's own build had
   already resolved** - verified each against real code, not just against
   PR mentions in the manifest's own prose, before deleting:
   - `participant-fids` ("webhooks give a count but not identities") -
     false; `readParticipant` in `jukeWebhookHandlers.ts` already extracts
     fid from both events, stored in `juke_spaces.participants` and
     rendered by `JukeListenerBadge.tsx` ("N ZAO members here" + names).
   - `partner-sso-bridge` (wanted a trusted-partner pre-mint JWT endpoint)
     - false; that's exactly `GET /api/juke/partner-token`, already
       wired into `JukeEmbed.tsx` via `?token=`.
   - `developer-end-space` (wanted a developer API to end a space) -
     false, and self-contradicting: this ask's own reason text already
     says "Confirmed by Nicky 2026-05-24: both ship in their PR #174,"
     and there's a SHIPPED entry (`host-end-space-button`) for the exact
     same feature a few lines above it in the same file.
   Removed all three, added a comment explaining why (following the
   file's own existing convention - `oss-spec` was removed the same way
   in an earlier PR). Also fixed `schedule-space-ui`'s SHIPPED
   description, which claimed `/live/create` has a `scheduled_at` field,
   an `announceCast` toggle, and a "1h from now" prefill - read the page
   fully, it only has password + title inputs. The API-level claim
   (`createSpaceSchema` does accept `scheduledAt`/`announceCast`) is true;
   only the UI-form claim was false. Corrected to describe reality.
   Commit: `f00831f`.

5. **`bumpParticipantCount` in `jukeSpacesDb.ts` claimed to be "atomic"** -
   it's a plain select-then-update, same non-atomic read-modify-write
   shape as `addParticipant` right below it. A real fix needs a Postgres
   RPC for a true atomic increment, which means authoring a new migration
   a human has to apply against the live DB (same category as
   migration-4.sql) - not something to ship blind from this sandbox
   without being able to verify it against Supabase. Fixed the comment to
   say what the code actually does (read-modify-write, narrow race risk
   under concurrent same-space deliveries, low real-world severity since
   Juke's retry/backoff makes that rare) instead of claiming a guarantee
   that doesn't exist. Commit: `e7624fa`.

Dispatched two read-only sub-agents this run (one for the remaining
routes, one for a wider file sweep) to parallelize reading, per Run 2's
precedent - every one of the six discrepancies they reported was
independently re-verified against the actual code myself, by reading the
files directly, before I fixed anything or wrote it here. All six held
up; no false positives from either sub-agent this run.

All of build (`npm run build`), lint, typecheck, and test (94/94) pass
clean as of the last commit this run.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- If a real atomic-increment fix for `bumpParticipantCount` is ever
  wanted, it needs a new SQL migration (a Postgres function + `.rpc()`
  call) that a human applies against Supabase - do not ship the code
  change without confirming the migration has actually been applied, or
  the webhook handler will start erroring on every `participant.joined`/
  `participant.left` event.
- Toolchain, recordings pipeline, docs/recap.md, and now the full Juke
  route surface (space, webhooks, partner-token, admin/*, cron) have all
  been read end-to-end across Runs 1-3 and their docstrings now match
  their code. Haven't yet done a close read of `src/app/spaces/**` (the
  older multi-provider Stage/Video-Room surface predating the Juke
  provider) or `HostRoomModal.tsx` - worth a look if Task A/B here are
  ever considered fully closed out.

## Run 4 — 2026-07-12

Read this file fully before starting. Local `main` had detached again
(same recurring pattern as Runs 2-3) - fast-forwarded to `origin/main`
(16 commits). Re-verified from a clean `npm install`: `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

### Correction to Run 3's "for next run" pointer

`src/app/spaces/**` and `HostRoomModal.tsx`, flagged by Run 3 as unread,
**do not exist anywhere in this repo** - confirmed via `find` and
`git log --all --diff-filter=A` (empty history for both paths). That was
a false lead, not a real gap. Not worth another look; nothing there to
read.

### Task A — still correctly ruled out (Run 1). Not redone.

Re-verified `juke-api-reads.ts` directly this run: still only
GET-by-id and DELETE-by-id for webhooks, no list-by-URL endpoint.
Nothing has changed since Run 1's writeup - full automation is still
blocked on Juke's API surface, not on engineering time in this repo.

### Task B — this run's actual work

1. **`src/app/api/juke/admin/mark-ended/route.ts` docstring was stale
   relative to a sibling file in the same directory.** It claimed Juke's
   developer end-space endpoint has "no spec for that yet, blocked on
   Nicky" - false. `end-space/route.ts`, one directory entry away,
   implements that exact endpoint (`POST /v1/developer/spaces/{id}/end`)
   as shipped since 2026-05-24 (Nicky's PR #174), and
   `jukeIntegrationManifest.ts` (fixed by Run 3) already confirms it
   shipped. Rewrote the docstring to describe mark-ended's actual current
   role: a local-only escape hatch (Juke unreachable, or the iframe Leave
   button which never calls end-space at all), not the primary path.
   Commit `a04dc9b`.

2. **Dispatched one read-only sub-agent** (Explore) to sweep files not yet
   closely read this week: admin console pages, the three juke/admin
   routes I hadn't personally read yet (delete-webhook, mark-ended,
   end-space - read those myself too, in parallel), all of
   `src/app/api/auth/**` + `session.ts`, `env.ts`, `neynar.ts`,
   `/live`/`/listen`/`/juke` page components, `src/components/spaces/**`,
   `jukeChangelog.ts`, and the provider registry. It reported 3 candidate
   findings; I independently re-verified every one against the real code
   before fixing anything (per instructions - never trust a sub-agent
   blindly). All three held up, and while verifying #2 I caught the
   sub-agent's own suggested fix was itself insufficiently checked (see
   below) and fixed it correctly instead:

   - **`juke-status/page.tsx`**: the public "Subscribe to webhooks"
     reference snippet (labelled as mirroring the live route) showed a
     `"secret": "<JUKE_WEBHOOK_SECRET>"` field in the POST body -
     `register-webhook/route.ts` never sends one (Juke generates + returns
     it, rejects a client-supplied secret with 422, per that route's own
     docstring and Run 1's script fix). Removed the field from the
     snippet. Also removed a "Create one via /spaces (Go Live - Juke)"
     link next to the correct `/live/create` link - `/spaces` doesn't
     exist anywhere in the app (confirmed via grep + `find`), so it was a
     dead duplicate of the working link right beside it.

   - **`listen/page.tsx`**: a comment claimed the stale-room cron "only
     runs daily on Hobby tier" and that some page "uses the same 30min
     threshold" for a "Stale" badge. I verified both halves independently
     before writing a fix, and both were wrong in ways the sub-agent's
     report didn't fully capture: the cron actually runs every 30min
     (`.github/workflows/juke-stale-rooms-cron.yml`'s own cron
     expression, `*/30 * * * *`), its real staleness threshold is 2 hours
     (`STALE_THRESHOLD_MINUTES = 120` in
     `/api/cron/juke-stale-rooms/route.ts`), and - I checked - **no page
     in the app has a "Stale" badge at all**, so that clause was
     fabricated regardless of which route it named. Rewrote the comment
     to describe the real cron cadence/threshold and this page's own
     60min heuristic. Also fixed a footer link ("All audio surfaces")
     pointing at `/spaces`; repointed to `/live`, the real dashboard
     (confirmed via its own docstring: "the operator-facing dashboard
     with finer controls").

   - **`EndJukeSpaceButton.tsx`**: same stale "not shipped yet" framing
     as finding #1 above, plus another `/spaces` reference. Fixed both -
     end-space is shipped; the 404 fallback is for cross-app/iOS-native
     rooms we don't own, not an unshipped endpoint; link is `/live`.

   Commits: `4d2dc23`, `6f62d2d`, `f11a0c4`.

All of build, lint, typecheck, and test (94/94) pass clean as of the
last commit this run.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- `/spaces` was a genuinely dead route referenced in stale
  comments/links across four files - all four are now fixed
  (`mark-ended/route.ts` incidentally, by this run's docstring rewrite;
  `juke-status/page.tsx`, `listen/page.tsx`, `EndJukeSpaceButton.tsx`
  explicitly). Worth a final grep for `/spaces` next run just to confirm
  no stray reference survived, but I believe this is now fully clean -
  `grep -rn '"/spaces"' src` after this run's commits should return
  nothing outside of legitimate substrings like
  `/v1/developer/spaces/{id}` (Juke's real API path, not our route).
- No further unaudited surface area comes to mind - Runs 1-4 combined
  have now read essentially every route, doc, and component in
  `src/app` and `src/lib/spaces`. If a Run 5 finds itself here with
  nothing new via TODO/FIXME grep or targeted re-reads, it's fair to
  conclude this repo's Task-B backlog is genuinely exhausted for now,
  and to say so plainly rather than manufacture busywork.

## Run 5 — 2026-07-12

Read this file fully before starting. Local `main` had detached again
(same recurring pattern as every prior run) - fast-forwarded to
`origin/main` (5 commits). Re-verified from a clean `npm install`:
`build`, `lint`, `typecheck`, `test` (94/94) all pass clean before
touching anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated;
nothing in Juke's API surface has changed since.

### Task B

Fresh TODO/FIXME/stub grep across `src/` turned up nothing new (only the
already-known, honestly-labeled `hms.ts` stub and `providers/index.ts`'s
deliberate throw). Confirmed Run 4's `/spaces` cleanup fully held - a
repo-wide grep for `"/spaces"` / `'/spaces'` in `src/` now returns zero
hits.

Dispatched one read-only sub-agent (Explore) to sweep the remaining
corners of the app Runs 1-4 hadn't individually confirmed clean
(`src/components/spaces/{RecordingsManager,ImportXSpaceForm,JukeListenerBadge}.tsx`,
`src/app/admin/**`, `src/app/api/auth/**`, `src/app/live/**`,
`src/app/juke/page.tsx`, `jukeChangelog.ts`). It reported one candidate
finding; I independently re-verified it against the real code myself
before fixing anything (per instructions), and in doing so found two
more related issues it missed:

1. **`src/app/juke/page.tsx` (public marketing/pitch page) had its own
   independent, never-synced copy of the deploy instructions - stale in
   two ways.** Verified directly: it told a deployer to set 6 env vars
   (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `JUKE_API_KEY`, `JUKE_WEBHOOK_SECRET`, `ZUKE_ADMIN_PASSWORD`,
   `CRON_SECRET`) - omitting `SESSION_SECRET` and `ZUKE_ADMIN_FIDS`,
   which `session.ts:25-26` throws without on effectively every request
   (confirmed by reading `getSessionData()` - it unconditionally calls
   `getSession()` → `sessionOptions()` unless the legacy password cookie
   matches), and including `ZUKE_ADMIN_PASSWORD` as if it were part of
   the primary path when it's explicitly a deprecated fallback per that
   same file's own comment ("Delete this block + ZUKE_ADMIN_PASSWORD
   ... after task #71 closes"). This is exactly the bug Run 2 found and
   fixed in README/setup-zuke.md - this page just has its own separate
   copy that was never updated to match. Also found while reading the
   same section: its migration step only listed
   `juke-spaces-migration.sql` and `-2.sql`, missing `-3.sql` and
   `-4.sql` (both exist in `scripts/`, and `-4.sql` is required for the
   recordings feature this same page advertises). Fixed both the env var
   list and the migration list, plus two "drop in 6 env vars" prose
   mentions elsewhere on the page that no longer matched. Commit
   `681480c`.

2. **`setup-zuke.md`'s env var list (the one Run 2 fixed) was itself
   still missing `CRON_SECRET` entirely - a gap none of Runs 1-4 caught.**
   Verified by reading `.github/workflows/juke-stale-rooms-cron.yml`
   (this run's background context: the cron scheduler merged earlier
   tonight) alongside `/api/cron/juke-stale-rooms/route.ts`: the route
   500s without `CRON_SECRET` set as an app env var, and the workflow
   itself needs `CRON_SECRET` *and* `ZUKE_BASE_URL` set as separate
   **GitHub Actions repo secrets** to actually call it - neither of
   which setup-zuke.md (or README, which defers to it) mentions
   anywhere. A deployer following the doc literally would provision
   everything else correctly and still have the stale-room sweep 401
   forever with no indication why. Added `CRON_SECRET` to the env var
   list plus a paragraph explaining the GitHub Actions repo-secret
   requirement. While in that file, also fixed a small leftover
   inconsistency in the route's own docstring
   (`/api/cron/juke-stale-rooms/route.ts:25`): it still said "Bearer
   CRON_SECRET (Vercel cron header)", contradicting the GitHub-Actions
   explanation three lines below it in the same comment block (Run 3
   fixed the scheduler-mechanism line but missed this parenthetical).
   Commit `3c3fdaa`.

All of build, lint, typecheck, and test (94/94) pass clean as of the
last commit this run.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- `src/app/juke/page.tsx` and `setup-zuke.md`/README should now be
  consistent with each other and with actual required env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `JUKE_API_KEY`, `JUKE_WEBHOOK_SECRET`, `SESSION_SECRET`,
  `ZUKE_ADMIN_FIDS`, `CRON_SECRET`, plus optional
  `ZUKE_ADMIN_PASSWORD`/`NEYNAR_API_KEY`) and the real 4-file migration
  list. Worth a spot-check next run that nothing drifts again if new env
  vars get added.
- This run's sub-agent sweep covered admin pages, auth routes,
  live/**, and the remaining spaces components and found them clean on
  independent verification. Combined with Runs 1-4, essentially all of
  `src/app`, `src/lib/spaces`, and the top-level docs have now been read
  end-to-end at least once. If a Run 6 finds nothing new via grep or a
  fresh targeted re-read, it's fair to conclude this repo's Task-B
  backlog is genuinely exhausted and say so rather than manufacture
  busywork - this note has said something similar before (Run 4) and a
  real gap still turned up, so keep checking, but don't force it if
  there's truly nothing left.

## Run 6 — 2026-07-12

Read this file fully before starting. Local `main` had detached again
(same recurring pattern as every prior run) - fast-forwarded to
`origin/main` (5 commits). Re-verified from a clean `npm install`:
`build`, `lint`, `typecheck`, `test` (94/94) all pass clean before
touching anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated;
nothing in Juke's API surface has changed since.

### Task B

Fresh TODO/FIXME/stub grep across `src/` turned up nothing new (same
honestly-labeled `hms.ts` stub and `providers/index.ts`'s deliberate
throw as every prior run). `README.md`'s roadmap section no longer
exists as such (moved into `setup-zuke.md`'s "v1 Roadmap", already
verified accurate by Run 2) - nothing stale there.

Found and fixed two real, verified env-var documentation gaps - both
confirmed by reading the actual consuming code myself before touching
anything, not by trusting either the doc prose or (for #2) the
sub-agent's report blindly:

1. **`JUKE_CREATE_PASSWORD` was completely missing from every env var
   list** (`setup-zuke.md` Step 3, `src/app/juke/page.tsx`'s deploy
   snippet) despite being read in `env.ts:11` and gating the password
   path of `POST /api/juke/space` (`route.ts:87-90`). Traced the actual
   consumer: `src/app/live/create/page.tsx`'s form always uses this
   password path (no admin-session bypass in the UI - the submit button
   is disabled whenever the password field is empty), so without this
   var set, `/live/create` can never succeed (`Wrong password` on every
   attempt). This matters specifically because `setup-zuke.md`'s own
   Verification section step 2 tells a deployer to use that exact page
   to "verify Juke integration end to end" - so a deployer following the
   doc literally would hit a wall at the doc's own suggested smoke test,
   with zero indication why. Added it to both lists with an explanation
   in setup-zuke.md's prose. Commit `cd389ca`.

2. **Dispatched one read-only sub-agent** (Explore) to sweep areas no
   prior run had individually confirmed clean by name: `src/lib/env.ts`,
   `src/lib/farcaster/neynar.ts`, `next.config.ts`, a repo-wide search
   for any `middleware.ts` (none exists), every file in `scripts/` not
   already known-fixed, every `.github/workflows/*` file (only one
   exists, already known-good), and `package.json`'s scripts block
   against README/setup-zuke.md's script references. It reported one
   finding, which I independently re-verified before fixing (it also
   correctly noticed my own commit for finding #1 landed mid-sweep and
   re-checked against the post-commit HEAD rather than going stale):
   `README.md` claims `setup-zuke.md` Step 3 is "the full list" of env
   vars, but `NEXT_PUBLIC_OPTIMISM_RPC_URL` - read in `env.ts:24`, and
   actually consumed by `/api/auth/verify/route.ts:19` to configure the
   RPC endpoint the SIWF signature-verify connector uses - was absent
   from that list. Lower severity than #1 (it has a working default,
   `https://optimism-rpc.publicnode.com`, so nothing breaks if left
   unset), but the "full list" claim was still false. Added it to
   `setup-zuke.md` with a short explanation of what it configures and
   its default. Did **not** add it to `juke/page.tsx`'s shorter env var
   snippet - that list already deliberately omits other optional vars
   with defaults (`ZUKE_ADMIN_PASSWORD`, `NEYNAR_API_KEY`) and never
   claims to be exhaustive the way README does, so it wasn't actually
   misdocumented. Commit `d24ace1`.

   Everything else the sub-agent checked came back clean on independent
   verification: `env.ts`'s other var defaults/optionality all match
   real usage; `neynar.ts`'s docstring claims (best-effort/empty-map
   behavior, 100-fid chunking, server-only) hold up against the actual
   code and its caller; `next.config.ts` is an empty stub with no
   claims to violate; `test-juke-space.ts` and the three not-yet-
   individually-checked migration SQL files (`.sql`, `-2.sql`, `-3.sql`
   - `-4.sql` was already checked in Run 3) all match their own header
   comments and the schema/types they claim to mirror; `package.json`'s
   `dev`/`build`/`typecheck`/`test`/`start` scripts all exist exactly as
   referenced in README/setup-zuke.md (`lint` exists but isn't mentioned
   in either doc - merely undocumented, not misdocumented, so not a
   finding).

### Considered but not turned into a finding

Read `src/lib/auth/nonce.ts` closely (self-signed HMAC nonce + an
in-memory `Map` for single-use replay protection, consumed by
`/api/auth/verify`). On Vercel's serverless model a given nonce's
single-use guarantee only holds within one warm Lambda instance, not
globally - a real design characteristic, and arguably a gap, but not a
*documented* claim anywhere that contradicts it (no comment asserts
global single-use), so it doesn't fit this project's established
bar for a finding (a stated claim the code doesn't back up). Practical
severity is also low: exploiting it requires already possessing a
valid signed SIWF message for a target nonce, which normally only the
legitimate signer's own browser has. Left untouched rather than either
inventing a doc caveat to "fix" or attempting a persistent-store
redesign (new Supabase table + migration a human has to apply,
same category Run 3 correctly declined for `bumpParticipantCount`)
without being able to verify it against a live DB from this sandbox.
Noting it here in case a future run wants to revisit with more
context (e.g. confirmed Vercel instance-reuse behavior, or a decision
that this is worth a Supabase-backed nonce store).

All of build, lint, typecheck, and test (94/94) pass clean as of the
last commit this run.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- Env var docs (`setup-zuke.md`, `src/app/juke/page.tsx`) should now
  list every var that's actually required or has a non-obvious
  optional/default status: `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `JUKE_API_KEY`, `JUKE_WEBHOOK_SECRET`,
  `JUKE_CREATE_PASSWORD`, `SESSION_SECRET`, `ZUKE_ADMIN_FIDS`,
  `CRON_SECRET`, plus optional `ZUKE_ADMIN_PASSWORD`, `NEYNAR_API_KEY`,
  `NEXT_PUBLIC_OPTIMISM_RPC_URL`. Worth a final `grep -n
  'process\.env\.' src/lib/env.ts` cross-check next run just to
  confirm no ninth var slipped through - I believe this is now
  genuinely complete, but the last two runs each found exactly one
  more missed var, so don't assume without checking.
- `nonce.ts`'s in-memory replay-Map-across-serverless-instances
  characteristic (see above) is a real but low-severity, undocumented
  design limitation, not a false claim - left as a note for a future
  run to decide on, not something to force a fix for blind.
- Combined with Runs 1-5, essentially every route, doc, script, config
  file, and component in this repo has now been read at least once
  end-to-end. If a Run 7 finds nothing new via grep, a fresh targeted
  re-read, or the env-var cross-check above, it's fair to conclude
  this repo's Task-B backlog is genuinely exhausted for now.
