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

## Run 7 — 2026-07-12

Read this file fully before starting. Local `main` had detached again (same
recurring pattern as every prior run) - fast-forwarded to `origin/main` (2
commits). Re-verified from a clean `npm install`: `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Re-verified
`juke-api-reads.ts` directly this run: still only GET-by-id and
DELETE-by-id for webhooks, no list-by-URL endpoint. Nothing has changed.

### Task B - env-var cross-check (Run 6's pointer) - clean

Re-ran the env var cross-check Run 6 flagged for this run: every var read
in `src/lib/env.ts` (9 vars) plus `CRON_SECRET` (read directly in the cron
route, not via env.ts - fine, not every var needs to route through it) is
now present in `setup-zuke.md`'s Step 3 list. Nothing missing. TODO/FIXME
grep across `src/` turned up nothing new (same honestly-labeled `hms.ts`
stub as every prior run).

### Found and fixed: three fictional SHIPPED entries in
`jukeIntegrationManifest.ts` - the most significant finding across any run
so far

While re-reading the manifest end-to-end (last touched by Run 3), noticed
three SHIPPED entries - `juke-go-live-provider` ("Juke as 3rd audio
provider in the Go-Live modal"), `spaces-unified-feed` ("Unified /spaces
Live tab"), and `recurring-schedule-script` ("Recurring weekly Juke
schedule script") - all named specific implementing files, and unlike
every other entry in the array, none of the three had a `pr` field to
corroborate the claim. Verified before touching anything:

- Wrote a one-off script to check every file path referenced anywhere in
  the manifest's `files:` arrays against the actual filesystem. 5 came back
  missing, all concentrated in exactly these 3 entries:
  `src/app/spaces/page.tsx`, `src/components/spaces/HostRoomModal.tsx`,
  `src/lib/spaces/roomsDb.ts`, `scripts/schedule-zao-recurring.ts`,
  `scripts/zao-recurring-events.json`.
- Ran `git log --all --oneline --diff-filter=A` on each of the 5 paths -
  every single one came back completely empty. These files have never
  existed anywhere in this repo's history, on any branch, not just
  "deleted since." This corroborates Run 4's independent finding that
  `src/app/spaces/**` and `HostRoomModal.tsx` don't exist - Run 4 cleaned
  up dead `/spaces` links/comments in 4 other files but never went back to
  check whether the manifest's own SHIPPED claims referenced the same dead
  paths. They did.
- Also grepped for `JukeLiveSection`, the component name the
  `spaces-unified-feed` description claims renders on `/spaces` - zero
  hits anywhere except the manifest's own description text. Not a real
  component.
- This manifest is explicitly the "public build-status surface for the
  Juke team" (served at `/juke-status`, `/api/juke/status`,
  `/juke-integration.md`) - the exact kind of external-facing false claim
  this whole overnight project has been hunting for since Run 1's original
  stale-rooms-cron discovery.

Removed all three entries (following the file's own established
convention from Run 3's OPEN_ASKS removal - explanatory comment in place,
not a silent deletion). Did not attempt to "correct" them to describe a
possible ZAOOS-repo-side implementation (the manifest's pitch text says
Zuke "graduated from ZAO OS", and most other entries' PR links do point at
`bettercallzaal/ZAOOS` - so it's plausible a similar feature shipped
there) because I have no access to that repo from this session's GitHub
scope to verify it, and these three entries specifically lack any PR
reference at all to check against - unlike the properly-cited entries.
Commit `982c2ed`.

### Found and fixed via one Explore sub-agent's sweep - both independently
re-verified myself before fixing

Dispatched one read-only sub-agent to sweep areas not yet individually
confirmed clean by name this week: `RecordingsManager.tsx`,
`ImportXSpaceForm.tsx`, `JukeListenerBadge.tsx`, `src/app/admin/**`,
`src/app/api/auth/**`, `src/app/live/**`, a fresh full read of
`src/app/juke/page.tsx`, `jukeChangelog.ts`, and `README.md`. It reported
two findings, both in `juke/page.tsx`, both verified directly against the
file before fixing:

1. **Stale migration count.** Step 2's prose said "Apply the two migration
   files in scripts/" while the `CodeBlock` two lines below it lists all
   four `juke-spaces-migration{,-2,-3,-4}.sql` files (migrations 3/4 were
   added later; the prose count was never updated to match its own code
   block). Fixed to say "four."
2. **Unbacked license claim.** Step 1 said the repo ships under an
   "MIT-style license." Verified: no `LICENSE`/`LICENSE.md` file anywhere
   in the repo root, no `license` field in `package.json`. Nothing backs
   the claim. Removed it rather than inventing a `LICENSE` file myself -
   choosing a project's license is a legal/business decision outside an
   automated code-audit loop's scope, not something to ship blind.

Both are pure JSX text edits (no logic touched). Commit `36f8147`.

Everything else the sub-agent checked - `RecordingsManager.tsx`,
`ImportXSpaceForm.tsx`, `JukeListenerBadge.tsx` prop-doc claims;
`src/app/admin/**` auth-flow claims; `src/app/api/auth/**` docstrings;
`src/app/live/**` password-gating/scheduling/end-space claims;
`jukeChangelog.ts`'s fetch/cache/null-on-failure claims; `README.md`'s
scripts block, webhook event list, and architecture notes - held up on
independent verification. No further findings there.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- `jukeIntegrationManifest.ts`'s SHIPPED array should now be fully
  file-verified - every remaining entry's `files:` paths exist on disk
  (checked programmatically this run, not just spot-read). Worth
  re-running that same file-existence check next run only if the manifest
  gets a new entry added; no need to redo the full sweep otherwise.
- Env var docs are confirmed complete again this run (the check Run 6
  asked for). Same caveat as always: re-check if a new var gets added to
  `env.ts`, don't assume from this note alone.
- At this point Runs 1-7 combined have read essentially every route, doc,
  script, config file, and component in this repo end-to-end, more than
  once in several cases, and this run found a genuinely new, significant
  gap (the fictional manifest entries) in a file every prior run had
  already touched - proof the backlog isn't fully dry yet even in
  well-trodden files. Keep reading closely rather than assuming a file is
  "done" just because a prior run edited it once.

## Run 8 — 2026-07-12

Read this file fully before starting. Local `main` had detached again (same
recurring pattern as every prior run) - fast-forwarded to `origin/main` (30
commits). Re-verified from a clean `npm install`: `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Re-verified
`juke-api-reads.ts` directly this run: still only GET-by-id and
DELETE-by-id for webhooks, no list-by-URL endpoint. Nothing has changed.

### Task B - found a blind spot in every prior run's `/spaces` cleanup

Fresh TODO/FIXME/stub grep across `src/` turned up nothing new (same
honestly-labeled `hms.ts` stub as every prior run). Re-ran the
manifest file-existence check from Run 7's pointer (every `files:` path
programmatically checked against the filesystem) - all 28 paths still
exist, that cleanup held.

While re-verifying Task A I re-read `jukeIntegrationManifest.ts` end-to-end
(same file Run 7 heavily edited) and noticed its `INTEGRATION_ARCHITECTURE_ASCII`
`String.raw` block still said `USER -> /spaces (Go Live) OR /live/create` in
the CREATE PATH diagram. `/spaces` was confirmed dead as far back as Run 4
(no such route anywhere in `src/app`, confirmed again this run via
`git log --all --diff-filter=A`) and Runs 4-5 believed they'd fully swept
it - but their greps only matched **quoted** string literals
(`grep -rn '"/spaces"' src`), which never touches unquoted text inside a
`String.raw` template or a plain `//` comment. That's exactly where this
one and two more were hiding:

1. `jukeIntegrationManifest.ts`'s ASCII diagram CREATE PATH line - fixed to
   `USER -> /live/create` (the only real create entry point).
2. `jukeIntegrationManifest.ts`'s `host-end-space-button` SHIPPED
   description - said the mark-ended fallback makes "`/spaces` stop showing
   dead rooms as Live." Fixed to `/live` (confirmed via Run 4: that's the
   real public dashboard the fallback actually affects).
3. `src/app/api/cron/juke-stale-rooms/route.ts`'s 404-handling comment -
   same "Flip locally so `/spaces` stops listing a row" phrasing. Fixed to
   `/live`.

While in that area also fixed `src/lib/db/supabase.ts`'s `getSupabaseBrowser`
comment, which likewise said "Browser-side anon client for `/spaces`
real-time" - verified via grep that `getSupabaseBrowser` is not called
anywhere in `src/` at all (dead code, currently unused, kept as an exported
helper). Rewrote the comment to say that plainly instead of pointing at a
route that never existed. Did not delete the function itself - it's real,
working code, just unused; deleting an unused-but-correct export felt like
scope creep beyond "fix false claims," so left it. Commit `d147c60`.

Ran a full repo-wide `grep -rn "/spaces"` sweep afterward (not restricted to
quoted forms this time) across both `src/` and the top-level docs
(`README.md`, `setup-zuke.md`) to make sure nothing else survived - every
remaining hit is a legitimate substring (`src/lib/spaces/`,
`src/components/spaces/`, `/v1/developer/spaces` Juke API path, `/i/spaces/`
X-Space URLs, or Run 7's own explanatory removal comment). Confirmed clean.

### Dispatched one Explore sub-agent to sweep for the same blind-spot class
elsewhere, independently re-verified both findings myself before fixing

Asked it to specifically hunt for other `String.raw`/large-template-literal
comments and route/env/feature-status claims embedded in prose rather than
quoted literals, since that's the exact class of miss this run's fix
uncovered. It reported two findings, both inside
`jukeIntegrationManifest.ts` (in sections today's earlier fix hadn't
touched) - I verified each against the real code before fixing:

1. **`CONVENTIONS` array claimed "Stage rooms (audio Clubhouse) and Video
   Rooms (full A+V) are ZAO concepts; both live alongside Juke."** False.
   Grepped for "stage room"/"clubhouse"/"video room" anywhere else in
   `src/` - zero hits. Read `providers/index.ts`'s registry directly: only
   `juke` and `hms` have implementations; `hms` (the closest thing to
   "Video Rooms") is an explicit stub where every method 501s or throws
   (`providers/hms.ts`); there is no `'stage'` provider id at all, not even
   a reserved unimplemented one. Rewrote the convention to describe the
   real registry state (`juke` live, `hms` a registered-but-unimplemented
   stub, `stream`/`songjam` reserved ids with nothing behind them) instead
   of claiming two things "live alongside Juke" that don't exist in this
   repo in any form.
2. **The ASCII diagram's webhook-dispatch section showed `recording.ready
   -> ... + autoCastToZao recap to /zao channel` with no caveat**, reading
   as a live dispatch step. Verified `src/lib/publish/auto-cast.ts` is
   still a hard no-op stub (logs, returns `null` unconditionally, no
   @thezao signer provisioned) - exactly what the manifest's own
   `recap-cast`/`recap-cast-room-finished` SHIPPED entries already caveat
   in prose ("wiring shipped, posting not yet live"). The diagram was the
   one place in this file that caveat never reached. Added a matching
   caveat line to the diagram.

Both are the same file already touched by today's earlier fix, in parts
(`CONVENTIONS`, the diagram's dispatch section) that fix didn't touch -
consistent with Run 7's note that this file keeps yielding real findings on
repeated close reads. Commit `c884b35`.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed both commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- The `/spaces` dead-route cleanup should now be genuinely complete across
  both quoted and unquoted forms, in both `src/` and top-level docs -
  verified via an unrestricted `grep -rn "/spaces"` sweep this run, not
  just the quoted-literal form Runs 4-5 used. If a future run adds new
  prose/diagrams, keep in mind quoted-literal greps alone will miss dead
  references inside `String.raw` blocks or plain comments - this run's
  whole finding was exactly that gap.
- `jukeIntegrationManifest.ts` has now been closely read end-to-end across
  Runs 3, 7, and 8, each time surfacing a genuinely new false/stale claim
  in a part the previous close-read hadn't touched (OPEN_ASKS -> SHIPPED
  entries -> diagram/prose text this run). It's a large, prose-heavy file
  that's easy to skim past known-fixed sections and miss the rest - worth
  one more full line-by-line pass next run before assuming it's finally
  exhausted, rather than assuming today's fixes were the last of it.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is real, working,
  correctly-typed code that is currently called from nowhere in `src/`.
  Not a false claim (comment now accurately says so), so not fixed as a
  Task B finding, but flagging in case a future run wants a decision on
  whether to keep it (something client-side is expected to use it later)
  or remove it as dead code - that's a product/scope call, not something
  to force blind from this sandbox.

## Run 9 — 2026-07-12

Read this file fully before starting. Local `main` had detached again (same
recurring pattern as every prior run) - fast-forwarded to `origin/main` (33
commits). Re-verified from a clean `npm install`: `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Re-verified
`juke-api-reads.ts` directly this run: still only GET-by-id and DELETE-by-id
for webhooks, no list-by-URL endpoint. Also re-read
`register-webhook/route.ts` end-to-end (the idempotency status field Run 1
added) - still correct and consistent with `setup-zuke.md` and
`scripts/register-juke-webhook.ts`. Nothing has changed since Run 1's
writeup.

### Task B

Fresh TODO/FIXME/stub grep across `src/` turned up nothing new (same
honestly-labeled `hms.ts` stub as every prior run). Spot-checked several
previously-fixed areas held up: `/spaces` dead-route cleanup (Run 8) still
clean, env var cross-check (`env.ts`'s 10 vars + `CRON_SECRET` all present in
`setup-zuke.md`) still clean, `.github/workflows/juke-stale-rooms-cron.yml`
still matches `setup-zuke.md`'s claims about it exactly, `docs/recap.md`
still matches `recap/route.ts`, `README.md`'s `scripts/` directory
description still matches what's actually in `scripts/`.

Did a fresh close read of `jukeIntegrationManifest.ts` end-to-end again (per
Run 8's pointer that this file has yielded a genuinely new finding on every
one of its last three close reads - Runs 3, 7, 8) and found one more:

1. **`public-status-surfaces` SHIPPED entry claimed `/api/juke/status` sends
   `X-ZAO-Juke-Status: v1`.** Verified directly against
   `src/app/api/juke/status/route.ts:51` - it actually sends `v3`. The
   manifest also never mentioned `/juke-integration.md`'s header at all,
   which is `v2` (`src/app/juke-integration.md/route.ts:104`) - a third,
   different value on the file the manifest claims is this one's own mirror.
   Fixed the description to state both real values instead of the one wrong
   one. While there, also fixed a related but distinct issue in
   `jukeChangelog.ts`'s `buildResolutionIndex` inline comment: its example of
   the implicit-id-join mechanism cited `'developer-end-space'` as a live ask
   being matched - but that ask was resolved and removed from `OPEN_ASKS` by
   Run 3, so the example read as a current case when it's now historical.
   Reworded to say so. Commit `8b80c9d`.

2. **Dispatched one Explore sub-agent** to sweep `src/app/juke-status/page.tsx`
   end-to-end, `jukeSpacesDb.ts`'s `getJukeIntegrationStats` /
   `listRecentJukeSpaces` / `listRecentWebhookEvents`, and
   `jukeChangelog.ts`'s `buildResolutionIndex` logic specifically (the one
   piece of that file not yet individually checked past its fetch/cache
   behavior). It reported two findings; both independently re-verified
   against the real code before fixing, per instructions:

   - **`juke-status/page.tsx`'s webhook-timeline empty-state copy said "the
     most recent 15 events show up here"** - but `page.tsx:155` only ever
     passes `recentEvents.slice(0, 8)` into that section, so at most 8 will
     ever render there once Juke starts posting, not 15. (Confirmed the "15"
     itself isn't wrong in isolation - `listRecentWebhookEvents(15)` does
     fetch 15 rows, and both the JSON route and the markdown route use the
     unsliced full list - only this one HTML page's copy, sitting right next
     to a `.slice(0, 8)` call two lines above it, was stale.) Fixed to say 8.
   - **`listRecentJukeSpaces`'s docstring claimed it "Returns title, status,
     and time markers only"** - the interface and the actual `.select(...)`
     query both also include `participant_count` and `recording_url`, and
     both are genuinely consumed downstream (`page.tsx:318-332`'s
     listener-count badge and recording-link). The word "only" was the false
     part. Fixed the docstring to name both fields.
   - Everything else the sub-agent checked - the JSON/markdown status
     routes' headers and cache behavior (post-fix from finding #1 above),
     `jukeChangelog.ts`'s cache TTL and both join branches of
     `buildResolutionIndex`, `getJukeIntegrationStats` and
     `listRecentWebhookEvents`'s docstrings, `jukeWebhookVerify.ts`'s replay
     window and signature format, and `CodeExamplesSection`'s reference
     snippets - held up on independent verification. No further findings.
   Commit `b8c8951`.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed both commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real finding
  on four consecutive close reads (Runs 3, 7, 8, 9), each time in a part the
  previous read hadn't touched. Worth at least one more full pass before
  assuming it's finally exhausted - this file is large, prose-heavy, and easy
  to skim past already-fixed sections.
- `juke-status/page.tsx` has now been read end-to-end multiple times
  (Runs 4, 5, 7, 9) and both of this run's findings were subtle
  slice/field-level mismatches, not the more obvious dead-link class of bug
  earlier runs caught - a sign this file is close to fully swept but not
  guaranteed clean. If a Run 10 wants one more pass, focus on numeric claims
  next to array/slice operations specifically, since that's the exact class
  of bug this run's finding #2 was.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Run 8, still a product/scope call, not
  something to force blind from this sandbox.
- No other unaudited surface comes to mind. Runs 1-9 combined have now read
  essentially every route, doc, script, config file, and component in this
  repo end-to-end, several more than once. If a Run 10 finds nothing new via
  grep or a fresh targeted re-read of the manifest/status-page files above,
  it's fair to conclude this repo's Task-B backlog is genuinely close to
  exhausted - though Run 8's and this run's findings both came from files
  every prior run had already "finished," so don't assume without checking.

## Run 10 — 2026-07-12

Read this file fully before starting. Local `main` had detached again (same
recurring pattern as every prior run) - fast-forwarded to `origin/main` (2
commits). Re-verified from a clean `npm install`: `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

Scope changed this run per the human owner: Task A stays ruled out (Run 1),
but the general Task B sweep now takes a back seat to a new **Task C** -
auditing `README.md`'s (moved to `setup-zuke.md`'s) "v1 Roadmap" against
actual code, item by item, verify-don't-assume.

### Task C, item 1 - "Replace admin password with Farcaster SIWN"

Already correctly identified as done and removed from the roadmap by Run 2
(commit `36179ff`) - this item no longer even appears in `setup-zuke.md`'s
current "v1 Roadmap" (only 3 items remain: signer, domain, branding).
Re-verified anyway, from scratch, that the gate is genuinely complete and
not partially wired: read `src/lib/auth/session.ts` end-to-end and grepped
every consumer of `isAdmin`/`getSessionData`/`ZUKE_ADMIN_PASSWORD`. Every
admin-gated route (`agent-join`, `delete-webhook`, `end-space`,
`mark-ended`, `register-webhook`, `partner-token`, `/api/juke/space`,
`/admin`, `/admin/login`) checks `getSessionData().isAdmin`, which resolves
via SIWF + the `ZUKE_ADMIN_FIDS` allowlist by default. The legacy
`zuke_admin` password cookie only activates at all if `ZUKE_ADMIN_PASSWORD`
is explicitly set (empty/unset by default) - it's an opt-in back-compat
fallback, not a parallel gate silently open in production, and is already
correctly documented as such. Also confirmed `JUKE_CREATE_PASSWORD` (the
password `/live/create` actually uses) is a distinct, intentional
shared-secret feature for non-admin team members to spin up rooms - not
the same mechanism as the deprecated admin password, and not something the
roadmap item was ever about. **Nothing to fix - already fully wired,
correctly documented, and already reflected in the roadmap by a prior
run.**

### Task C, item 2 - "Integrate ZAO signer for auto-casting to @thezao"

Re-read `src/lib/publish/auto-cast.ts`: still an unconditional stub (logs,
returns `null`, no conditional logic). Grepped for "signer" repo-wide -
zero references to any actual signer credential anywhere in code, env
vars, or docs; `README.md`'s Architecture section and both
`jukeIntegrationManifest.ts` SHIPPED entries that reference it already
honestly caveat this ("wiring shipped, posting not yet live"), consistent
with every prior run's finding. **Confirmed still blocked** on a
@thezao Farcaster signer credential this sandbox has no access to
provision or fake - same category as the three explicitly-excluded items.
Nothing to fix; nothing to build without a real credential.

### Task C, item 3 - "Custom domain: zuke.thezao.com"

Independently verified live by the human owner tonight (200 in prod).
Read `src/zuke.config.ts`'s `getBaseUrl()` and every consumer
(`jukeWebhookHandlers.ts`, `admin/register-webhook/route.ts`), plus
`AuthKitWrapper.tsx`'s SSR domain fallback, `jukeIntegrationManifest.ts`'s
hardcoded URLs, and `juke-status/page.tsx`'s reference snippet - all
already consistently target `zuke.thezao.com`. No leftover `zaoos.com` or
stray `localhost` references found in a repo-wide grep (`zaoos.com` only
appears in this log's own Run 1 history entry, describing an old bug
already fixed). Found and fixed two real, narrow gaps:

1. `zuke.config.ts`'s doc comment still said code needed to agree on the
   canonical host "even before the custom domain (zuke.thezao.com) lands"
   - stale now that it's live. Reworded to state the domain is live and
   explain `NEXT_PUBLIC_SITE_URL`'s role as an explicit pin.
2. `NEXT_PUBLIC_SITE_URL` - the #1, highest-priority entry in
   `getBaseUrl()`'s own resolution-order comment, and the one code-level
   lever a deployer has to pin the base URL regardless of how Vercel's
   `VERCEL_PROJECT_PRODUCTION_URL` resolves a custom-domain alias - was
   undocumented in `setup-zuke.md`'s env var list (the "full list" this
   project's docs have promised since Run 6). Added it with an
   explanation of what it does and when it's actually needed.

No DNS/Vercel dashboard access exists from this sandbox to verify domain
config directly, per the task framing - this was a pure code-consistency
check. **Verified done code-side**; marking this roadmap item as
verified-complete rather than inventing further work on it. Commit
`a434aa7`.

### Task C, item 4 - "Branding: Zuke identity + logo"

Checked `public/` - it contains only the five unmodified create-next-app
default SVGs (`next.svg`, `vercel.svg`, `window.svg`, `globe.svg`,
`file.svg`), none referenced anywhere in `src` (confirmed via grep - dead
scaffold files). `src/app/favicon.ico` is also confirmed to be the
stock Next.js default (25,931 bytes, 4 icon sizes, matches the known
create-next-app default exactly) - **no real Zuke logo or favicon asset
exists anywhere in this repo.** This is a genuine design-asset gap I
cannot invent from nothing (no design input, and fabricating a placeholder
logo and calling it "done" would be worse than leaving it honestly
missing) - documenting it here rather than faking it, same as every prior
run's treatment of the three explicitly-blocked items.

While checking for stale "ZAO"-not-"Zuke" product surfaces (commit
`4d9bfac`'s rebrand, per the task's own framing), found something more
basic than a rebrand miss: **`src/app/layout.tsx`'s root metadata was
still the literal, unmodified create-next-app boilerplate** -
`title: "Create Next App"`, `description: "Generated by create next app"`
- never touched since project scaffolding. Three routes have no
page-level metadata to override it: `/admin`, `/admin/login`, and
`/live/create` (a `'use client'` page, which can't export `metadata`
itself). In production, all three routes' browser tabs and any link
previews showed the raw Next.js scaffold title, not even a stale "ZAO"
string - the actual create-next-app default. Fixed:

- `src/app/layout.tsx` - real Zuke title/description matching the
  established `zukeConfig.name` pattern used by every other page in the
  app.
- `src/app/admin/page.tsx` and `src/app/admin/login/page.tsx` - added
  page-level `metadata` (both are server components, so this was a direct
  export), `robots: { index: false }` matching the existing pattern for
  utility pages (`/live/import`, `/live/recordings`).
- `src/app/live/create/layout.tsx` (new file) - `/live/create` is a client
  component and can't export `metadata` itself, so added a segment layout
  to carry it, same noindex treatment.

This is a real, buildable code gap (unlike the missing logo asset) with
zero new credentials needed, so it was fixed rather than just documented.
Commit `d6b8671`.

### Also found and fixed while re-reading `jukeIntegrationManifest.ts`
(dispatched one Explore sub-agent for a fifth close read of this file,
per Run 9's pointer that it has yielded a new genuine finding on four
consecutive prior reads - both of its findings independently re-verified
against the real code before fixing, per instructions)

1. **`juke-status-richer` SHIPPED description claimed the dashboard shows
   "last 15" webhook events and "last 10" spaces** - `juke-status/page.tsx:155-156`
   actually slices both to 8 and 6 for what the Overview tab renders (the
   fuller 15/10 sets are only what `/api/juke/status` and
   `/juke-integration.md` return unsliced). Run 9 already fixed the page's
   *own* empty-state copy to say "8" but never touched this independent
   manifest claim making the same now-stale 15/10 claim. Fixed to
   describe both the shown-count and the fuller fetched-count accurately.
2. **The ASCII diagram's CREATE PATH claimed an automatic "redirect to
   /live/{spaceId}"** after space creation - verified `live/create/page.tsx`
   end-to-end: no `router.push`/`redirect`/navigation call anywhere; on
   success it shows a "Space created" panel with explicit "Copy link" and
   "Open space" actions the user must click. Fixed the diagram to describe
   the real flow.
   Commit `cbfdfb2`.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed all four commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- All 4 roadmap items are now individually resolved for this run: item 1
  (SIWF) done and already reflected in the roadmap; item 2 (signer) still
  genuinely blocked on an external credential, correctly documented; item
  3 (custom domain) verified code-consistent, two small real gaps fixed;
  item 4 (branding) - the boilerplate-metadata bug fixed, but the actual
  logo/favicon asset gap is real and still needs a human-provided design
  asset - not something a future run can close from this sandbox either.
- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real
  finding on **five** consecutive close reads (Runs 3, 7, 8, 9, 10). At
  this point treat "this file is exhausted" claims from any single run
  with real skepticism - it is long, prose-heavy, and easy to skim past
  already-fixed sections. Worth one more full pass next run before
  assuming otherwise.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-9, still a product/scope call.
- `zukeConfig.brandColor` (`src/zuke.config.ts:14`, `'#855dcd'`) is defined
  but has zero consumers anywhere in `src` (confirmed via grep) - not a
  false claim (nothing asserts it's wired up anywhere), so not fixed as a
  finding, but flagging in case a future run or the branding work above
  ever wants to actually apply it somewhere.
- If a future run exhausts fresh Task C angles and this file's well
  finally runs dry, the general Task B TODO/stale-doc sweep is still the
  documented fallback per this run's instructions - not abandoned, just
  deprioritized while Task C had real, unexhausted gaps.

## Run 11 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 10's last commit but already equal to `origin/main` (0 commits behind) -
checked out a tracking `main` branch pointed at it, no fast-forward needed.
Re-verified from a clean `npm install`: `build`, `lint`, `typecheck`, `test`
(94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated this run;
nothing prompted a re-check (no changes to Juke's API surface referenced
anywhere new).

### Task C - re-verified all 4 roadmap items; found and closed one real gap
Run 10 left half-finished, plus two more manifest findings on a sixth close
read

1. **Item 1 (SIWN)** - re-confirmed still fully wired, already correctly
   absent from the roadmap list (Run 2). No change.
2. **Item 2 (signer)** - re-grepped for "signer" repo-wide; still zero real
   credential references anywhere. Confirmed still blocked on a @thezao
   Farcaster signer this sandbox cannot provision or fake. No change.
3. **Item 3 (custom domain)** - Run 10 verified this item done code-side and
   said in its BUILD_LOG writeup it should be "marked verified-complete,"
   but never actually removed it from `setup-zuke.md`'s roadmap list itself
   - it was still sitting there as an open item. Fixed: removed
   "Custom domain: zuke.thezao.com" from the `## v1 Roadmap` list, with a
   short note explaining it shipped and pointing at `NEXT_PUBLIC_SITE_URL`
   for anyone who needs to pin it explicitly. Same treatment Run 2 gave
   item 1 once it was done. Confirmed no other file references the roadmap
   list or repeats this claim. Commit `b934698`.
4. **Item 4 (branding)** - re-checked `public/` and `src/app/favicon.ico`:
   still only the five unmodified create-next-app SVGs and the stock
   favicon, byte-identical to Run 10's check. Re-confirmed no product
   surface says "ZAO" where it should say "Zuke" - read commit `4d9bfac`'s
   diff directly this run to confirm what "product surfaces" actually meant
   (the manifest's self-identification + hardcoded URLs, not every mention
   of "ZAO" in the app - "ZAO" legitimately still refers to the community/
   org throughout the UI, e.g. "ZAO Live", "ZAO team", "ZAO dev", which is
   correct and not a rebrand miss). Root layout metadata (fixed by Run 10)
   still correct. **No new gap; logo/favicon asset is still the one
   documented missing piece, still needs a human-provided design asset.**

### Sixth close read of `jukeIntegrationManifest.ts` (per Run 10's pointer -
five consecutive prior close reads each found something new) - two more
real findings, both independently re-verified against actual code before
fixing

Dispatched one Explore sub-agent for a full line-by-line re-read
specifically hunting for the same class of bug the last five reads found
(stale counts, dead paths, fictional behavior). It reported two
discrepancies; both confirmed directly against source before fixing:

1. **CONVENTIONS entry lumped `'songjam'` in with `'stream'` as "reserved
   ids with no implementation at all."** False for `'songjam'` - verified
   `src/lib/spaces/xSpaces.ts` (`X_SPACE_PROVIDER = 'songjam'`,
   `parseXSpaceUrl`/`zukeIdForXSpace`) and
   `src/app/api/recordings/import-x/route.ts` are real, live code: X Space
   imports are tagged provider `'songjam'` and inserted into `juke_spaces`
   via `insertImportedSpace`. It's not a live-audio *backend* (doesn't run
   alongside Juke for hosting), which is presumably why the false claim
   crept in, but it is real, shipped, implemented functionality. Only
   `'stream'` genuinely has zero implementation. Fixed the sentence to
   describe `'songjam'` accurately as the real X-Space-import provider id,
   distinct from an unimplemented live-audio backend.
2. **The markdown-renderer's own hardcoded prose (served at
   `/juke-integration.md`) claimed "ZAO holds two persisted tables:
   `juke_spaces` ... and `juke_webhook_events`."** False - a third table,
   `juke_recordings` (added by `scripts/juke-spaces-migration-4.sql`,
   confirmed present), is actively read/written by
   `src/lib/spaces/recordingsDb.ts`, the `recording.ready` webhook handler,
   `/live/recordings`, and the recap route - not a read against either of
   the two named tables or against juke.audio directly, contradicting the
   very next sentence's claim that "every other public surface" is exactly
   that. Fixed to name all three tables. Checked `README.md`/`setup-zuke.md`
   /`docs/recap.md` for the same stale "two tables" phrasing - none had it;
   this was isolated to the manifest. Commit `3794fb5`.

### Fallback Task B sweep (per instructions, since Task C's per-run gaps
were exhausted after the above) - found and fixed one real, verified issue

Dispatched one Explore sub-agent to sweep areas not the focus of a *recent*
close read: `src/app/admin/**`, remaining `src/components/spaces/*.tsx`,
`src/lib/auth/*.ts`, `docs/*.md` not yet covered, and a fresh
hardcoded-count-next-to-`.slice()`/`.limit()` sweep (the exact bug class
Runs 9-11 kept finding in the manifest/status page). Admin pages, auth
files, `docs/recap.md`, and the slice/limit sweep all came back clean on
independent re-verification - no new findings there. One real finding,
verified directly against the code myself before fixing:

1. **Run 4's `EndJukeSpaceButton.tsx` fix (commit `f11a0c4`) only corrected
   the file's docstring, not its own rendered UI text three lines below
   it, nor the sibling route file that actually produces the underlying
   status/log/response strings.** Read both files directly: the button's
   docstring correctly says the end-space endpoint shipped (PR #174) and a
   404 means a cross-app/iOS-native room - but its `<div>` for the
   `'fallback'` case still rendered `"(local-only - Juke endpoint not
   shipped yet)"` to actual users. Separately, `end-space/route.ts` (four
   distinct spots: its own docstring, an inline comment, a
   `logger.warn(...)` call, and the JSON `note` field returned to API
   callers) still said "not yet shipped"/"not yet available" throughout -
   never touched by Run 4's fix at all. While fixing these, grepped for
   the same phrase repo-wide and found a fifth, unrelated instance: the
   `end-space-button` SHIPPED entry's own description in
   `jukeIntegrationManifest.ts` had the identical stale "endpoint not
   shipped yet, or cross-app room" phrasing. Fixed all five call sites
   (button UI text, route docstring, route comment, route log message,
   route response `note` field, manifest description) to consistently say
   what Run 4 already established: the endpoint is shipped, a 404 means a
   cross-app/iOS-native room Zuke doesn't own. Commit `cf4ecc3`.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed all three commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- All 4 roadmap items are now resolved as far as this sandbox can take
  them: item 1 done, item 2 blocked on an external credential, item 3 now
  fully done including the roadmap-list removal Run 10 left unfinished,
  item 4's code-side gap fixed (Run 10) with the logo/favicon asset gap
  still real and still needing a human-provided design asset. The v1
  roadmap in `setup-zuke.md` now lists only the two genuinely-still-open
  items (signer, branding assets) - both blocked on something outside this
  sandbox, not on engineering time. If both stay blocked, there is no
  further Task C work to do until one unblocks; a future run should say so
  plainly rather than re-litigating items 1-3 from scratch every time.
- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real
  finding on **six** consecutive close reads (Runs 3, 7, 8, 9, 10, 11).
  Given how consistently this keeps happening, it's worth treating any
  single run's "this file is exhausted" claim (including this one) with
  real skepticism - but also worth noting the findings are getting
  narrower and more isolated each time (this run's two were a single
  mislabeled provider id and a stale table count), which is consistent
  with a genuinely shrinking backlog rather than a bottomless one.
- This run's real lesson for future doc/message fixes: **when a fix
  changes a claim, grep for the literal old phrase repo-wide before
  considering the fix done.** Run 4's `EndJukeSpaceButton.tsx` fix only
  touched the one file it was looking at and missed four other call sites
  echoing the same stale string, some in a completely different file. This
  run's fix used that grep step and caught all five in one pass - worth
  keeping as standard practice, not just for end-space specifically.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-10, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Run 10, flagged in case future branding work wants it.

## Run 12 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 11's last commit (`ce8396a`), already equal to `origin/main` (0 commits
behind) - checked out a tracking `main` branch pointed at it, no fast-forward
needed. Re-verified from a clean `npm install`: `build`, `lint`, `typecheck`,
`test` (94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated this run;
nothing prompted a re-check (no changes to Juke's API surface referenced
anywhere new since Run 4/7's last direct re-verification of
`juke-api-reads.ts`).

### Task C - re-verified all 4 roadmap items directly against current code;
no change in status on any of them

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer in
   `src/`: still exactly `session.ts:48-53`'s explicitly-opt-in legacy
   fallback block, unchanged since Run 2/10/11 confirmed it done. Already
   correctly absent from `setup-zuke.md`'s roadmap list. No change.
2. **Item 2 (signer)** - re-grepped "signer" repo-wide and re-read
   `src/lib/publish/auto-cast.ts` in full: still an unconditional stub (logs,
   returns `null`), still zero real credential references anywhere in code,
   env vars, or docs. Confirmed still blocked on a @thezao Farcaster signer
   this sandbox cannot provision or fake. No change.
3. **Item 3 (custom domain)** - already removed from the roadmap list by
   Run 11 (commit `b934698`); re-confirmed `setup-zuke.md`'s current `## v1
   Roadmap` section only lists the signer and branding items, with the
   custom-domain note intact below it. No change needed.
4. **Item 4 (branding)** - re-checked `public/` (still only the five
   unmodified create-next-app SVGs) and `src/app/favicon.ico` (md5
   `c30c7d42707a47a3f4591831641e50dc`, byte-identical to Run 10/11's check -
   still the stock create-next-app default). **No new gap; the logo/favicon
   asset is still the one documented missing piece, still needs a
   human-provided design asset.** Root layout metadata (fixed Run 10) still
   correct.

All 4 roadmap items are unchanged from Run 11's resolution: items 1 and 3
done, item 2 blocked on an external credential, item 4's code-side gap
already fixed with the asset gap itself still real and outside this
sandbox's ability to close.

### Seventh close read of `jukeIntegrationManifest.ts` (per Run 11's
pointer - six consecutive prior close reads each found something new) - one
more real finding, independently re-verified before fixing

Dispatched one Explore sub-agent for a full line-by-line seventh read,
explicitly told to re-verify every claim (SHIPPED descriptions, OPEN_ASKS
reasons, CONVENTIONS bullets, diagram lines, file paths, counts, header
versions) against current code rather than trusting any prior run's "fixed"
label. It checked all 28 file paths, both status-header versions, the
8-of-15/6-of-10 count pair, the three-table claim, the provider-id
CONVENTIONS bullet (already corrected by Run 11), the webhook verifier
details, every remaining SHIPPED/OPEN_ASKS entry, and the full ASCII
diagram - all held up. It reported exactly one finding, which I
independently verified against the real code myself before fixing:

1. **`recording-shelf` SHIPPED description (line 137) was stale relative to
   a page rewrite that happened after this entry's `shippedAt: '2026-05-23'`
   date.** It claimed the shelf "Lists ended Juke spaces with recording_url"
   "Server-fetched from juke_spaces" with a "Listen to recording" CTA,
   "Populated by the recording.ready webhook." Read
   `src/app/live/recordings/page.tsx` in full myself: `safeListRecordingsShelf`
   explicitly merges two sources (its own docstring: "legacy path: juke_spaces
   rows... new path: any space that has a row in juke_recordings... even if
   recording_url was never set"), calling both `listRecordedJukeSpaces` and
   `listRecentRecordedSpaceIds` (confirmed the latter's real implementation in
   `recordingsDb.ts:133-154`: queries `juke_recordings`, excludes
   `source: 'snippet'`). Repo-wide grep for `"Listen to recording"` returns
   zero hits anywhere except the manifest's own stale line - the real card
   (`RecordingCard`) renders an inline `<audio controls>` player plus a
   separate "Open in new tab" link, not a CTA button. The OG-image claim is
   also incomplete: it's Juke-hosted-only (`isJukeHosted` check), with a
   generic icon + source badge ("Juke"/"X Space") for imports/uploads.
   Rewrote the description to state the real two-source merge, the real
   card contents, and added the missing `recordingsDb.ts` to `files:`.
   Commit `0cb1bf8`.

Everything else the sub-agent checked - all 28 `files:` paths, both header
versions, both count pairs, the three-table claim, CONVENTIONS, the webhook
verifier, every other SHIPPED/OPEN_ASKS entry, the removed-entries comments,
and the ASCII diagram - held up on independent verification. No further
findings.

### Fallback Task B sweep (per instructions, since Task C's per-run gaps
were exhausted after the above) - clean, no findings

Dispatched one Explore sub-agent in parallel with the manifest read, scoped
to areas not the focus of a *recent* close read: all six files under
`scripts/` (including a live `npm view` re-check of the `viem` override's
continued necessity against `@farcaster/auth-client`'s actual `viem`
peer/dependency range - still required, still correct), a full end-to-end
`README.md` read, `package.json`'s scripts/overrides, a side-by-side re-read
of `.github/workflows/juke-stale-rooms-cron.yml` against the route it calls,
and confirmation that `docs/recap.md` remains the only file under `docs/`.
Every area came back clean on independent verification - no new findings.
Also ran a fresh TODO/FIXME/XXX/HACK/STUB grep across `src/` myself: same
honestly-labeled `hms.ts` stub and `auto-cast.ts` stub as every prior run,
nothing new.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join

### For the next run

- All 4 roadmap items remain in the same state Run 11 left them: items 1
  and 3 done, item 2 blocked on a @thezao Farcaster signer credential, item
  4's code-side gap fixed with the logo/favicon design asset itself still
  the one open piece - none of these are engineering gaps left in this
  sandbox's control. Until one of the two blocked items unblocks (a signer
  credential shows up, or a human provides logo/favicon assets), there is no
  further Task C work to do - say so plainly rather than re-litigating
  items 1-3 from scratch every run.
- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real finding
  on **seven** consecutive close reads (Runs 3, 7, 8, 9, 10, 11, 12), though
  this run's was the narrowest yet (one stale SHIPPED description, versus
  whole fictional entries in earlier runs) - consistent with Run 11's note
  that the backlog here is shrinking, not bottomless. Given how narrow this
  run's finding was and how much of the file has now been independently
  re-verified clean multiple times, it's reasonable for a Run 13 to treat a
  fully-clean eighth read as real evidence this specific file is finally
  exhausted, rather than assuming there must always be one more finding.
- The fallback Task B sweep this run (scripts/, README.md, package.json,
  the cron workflow, docs/) came back completely clean - the first fully
  clean fallback sweep since this pattern started. Combined with Run 9's
  note and this run's result, essentially every corner of this repo has now
  been read at least once, several corners many times, and genuinely fresh
  ground is getting hard to find. If a Run 13 also comes up empty on both
  Task C and a fallback sweep, it's fair to say the backlog is exhausted for
  now rather than manufacturing busywork.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-11, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Run 10-11, flagged in case future branding work wants it.

## Run 13 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 12's last commit (`4b219b4`), already equal to `origin/main` (0 commits
behind) - checked out a tracking `main` branch pointed at it. Re-verified
from a clean `npm install` (removed `node_modules` first): `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated this run;
nothing prompted a re-check (no changes to Juke's API surface referenced
anywhere new).

### Task C - re-verified all 4 roadmap items directly against current code;
no change in status on any of them

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer in
   `src/`: still exactly `session.ts:48-53`'s explicitly-opt-in legacy
   fallback block. Already correctly absent from `setup-zuke.md`'s roadmap
   list. No change.
2. **Item 2 (signer)** - re-grepped "signer" repo-wide and re-read
   `src/lib/publish/auto-cast.ts` in full: still an unconditional stub (logs,
   returns `null`), still zero real credential references anywhere in code,
   env vars, or docs. Confirmed still blocked on a @thezao Farcaster signer
   this sandbox cannot provision or fake. No change.
3. **Item 3 (custom domain)** - confirmed `setup-zuke.md`'s current
   `## v1 Roadmap` section (`- Integrate ZAO signer...` / `- Branding...`)
   still correctly omits the domain item, with the shipped-note intact below
   it (Run 11's fix). No change needed.
4. **Item 4 (branding)** - re-checked `public/` (still only the five
   unmodified create-next-app SVGs) and `src/app/favicon.ico` (md5
   `c30c7d42707a47a3f4591831641e50dc`, byte-identical to Runs 10-12's check -
   still the stock create-next-app default). **No new gap; the logo/favicon
   asset is still the one documented missing piece, still needs a
   human-provided design asset.** Root layout metadata (fixed Run 10) still
   correct.

All 4 roadmap items remain exactly where Run 12 left them: items 1 and 3
done, item 2 blocked on an external credential, item 4's code-side gap
already fixed with the design-asset gap itself still real and outside this
sandbox's control.

### Eighth close read of `jukeIntegrationManifest.ts` (per Run 12's pointer
- seven consecutive prior close reads each found something new) - one real
finding, verified myself before fixing

Dispatched one Explore sub-agent for a full line-by-line eighth read,
explicitly told to re-verify every claim against current code from scratch
rather than trust any prior "fixed" label - every `files:` path (all ~50
unique), every SHIPPED description's behavioral claims, every OPEN_ASKS
entry, the CONVENTIONS array against the real provider registry, the full
ASCII diagram, both status-header versions, and every slice/count pair. It
reported exactly one finding, which I independently re-verified against the
real code myself before fixing:

1. **The `agents` OPEN_ASKS entry was stale - Juke already shipped the
   read-only/data-publish capability the ask was requesting, and Zuke
   already has a working consumer for it, undocumented anywhere as
   SHIPPED.** Verified directly: `src/lib/spaces/jukeAgentJoin.ts`
   (`joinAgentInJukeRoom`, calling Juke's free key-only
   `POST /v1/developer/rooms/{id}/agent-join`, shipped 2026-05-23,
   data-publish only in v1) and `src/app/api/juke/admin/agent-join/route.ts`
   (the admin-gated route that calls it) are both real, complete,
   working code - the same surface Run 2 already confirmed
   "real, complete, correctly-gated implementations" of. Neither file
   appears anywhere in the manifest's `SHIPPED` array. Meanwhile the ask's
   reason text said Juke "still flag[s] agents as a future surface" and
   that "even read-only/observer would unblock half the value" - both
   already false: the observer-equivalent path (an admin manually
   triggering a join) is live today. What's genuinely still missing,
   confirmed by re-reading `isAutoAgentJoinEnabled()`'s doc comment: ZOE has
   no VPS-side consumer for the minted `session_token`, so the auto-join
   hook on `room.started` stays off by default
   (`ZAO_AUTO_AGENT_JOIN=false`) - unchanged from Run 2's conclusion that
   *unattended* ZOE-in-Juke is blocked outside this sandbox, not an
   engineering gap in Zuke's code. Added a new `agent-join-consumer` SHIPPED
   entry (files, description, PR reference, matching the array's existing
   style) and rewrote the `agents` ask's reason/title to state what's
   actually still open - the VPS-side piece, not anything further from
   Juke's API. Commit `a3228f6`.

Everything else the sub-agent checked - all `files:` paths, both header
versions, both count pairs, the three-table claim, CONVENTIONS, the webhook
verifier, every other SHIPPED/OPEN_ASKS entry, and the ASCII diagram - held
up on independent verification. Unlike Run 12's note speculating a fully
clean read might be possible, this run's read was *not* fully clean - the
backlog here, while clearly narrowing, has not actually run dry yet.

### Fallback Task B sweep (per instructions, since Task C's per-run gaps
were exhausted after the above) - one real finding, verified before fixing

Dispatched one Explore sub-agent scoped to areas not covered by a *recent*
close read: `src/app/api/juke/webhooks/route.ts` +
`jukeWebhookHandlers.ts` read as the handler files themselves (prior runs
mostly checked the *manifest's description* of them, not the files
directly), the remaining `src/components/spaces/*.tsx` files (none left
unchecked - confirmed via `ls`), `src/app/api/auth/session/route.ts` +
`verify/route.ts`, the `viem` override's continued necessity (re-confirmed
live via `npm ls`/`npm view` - still required), `vitest.config.ts`/
`vitest.setup.ts`, and a repo-wide TODO/FIXME/STUB/"not yet" grep across
`src/`, `docs/`, and top-level `*.md` (not just `src/`, to catch docs-only
hits). It reported one finding, independently re-verified against the real
code myself before fixing:

1. **`src/app/api/juke/webhooks/route.ts`'s own docstring claimed "We always
   return 200 once the signature passes, except for setup misconfiguration
   (no secret) and signature failures."** False - read the route directly:
   two more non-200 paths exist strictly after signature verification
   succeeds - `JSON.parse(rawBody)` failure returns 400
   (`route.ts:57-62`), and a `recordWebhookEvent` DB-insert failure returns
   500 (`route.ts:66-78`). Only a *handler* error (after the event is
   already persisted) is intentionally swallowed into 200, to avoid a Juke
   retry storm on our own bug - that's the real invariant, and the old text
   conflated it with "always 200 post-signature." Rewrote the docstring's
   numbered behavior list to name all six response paths (401 no-secret,
   401 bad-signature, 400 bad-JSON, 500 DB-insert-failure, 200 duplicate,
   200 handler-ran) and replaced the closing summary sentence with the
   actual invariant. Commit `cd56a29`.

   Everything else the sub-agent checked came back clean on independent
   verification: `jukeWebhookHandlers.ts`'s event-vocabulary docstring
   (confirmed the undocumented `'room.ended'` switch-case alias is inert
   defensive code, not a functional gap - `register-webhook/route.ts`'s
   `EVENTS` array only ever subscribes Juke to the 5 documented events);
   the remaining `src/components/spaces/*.tsx` files (all already covered
   by a prior run's close read - no fresh ground); `session/route.ts` +
   `verify/route.ts` (thin wrappers, status codes/fields cross-checked
   against their one caller, `AdminLoginButton.tsx` - consistent); the
   `viem` override (still necessary and correctly reasoned); `vitest.*`
   config files (no stale comments, 94/94 still passing); and the wider
   grep (nothing new in `docs/` or top-level `*.md` beyond what this file
   already documents about itself).

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed both commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join (specifically the *unattended*/auto-join
  piece - the underlying agent-join API call is now a documented SHIPPED
  consumer as of this run; only the VPS-side session-token consumer remains
  outside this sandbox)

### For the next run

- All 4 roadmap items remain in the same state Run 11/12 left them: items 1
  and 3 done, item 2 blocked on a @thezao Farcaster signer credential, item
  4's code-side gap fixed with the logo/favicon design asset itself still
  the one open piece. None of these are engineering gaps left in this
  sandbox's control - say so plainly rather than re-litigating items 1-3
  from scratch every run.
- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real finding
  on **eight** consecutive close reads (Runs 3, 7, 8, 9, 10, 11, 12, 13).
  This run's finding was actually more substantial than Run 12's (a missing
  SHIPPED entry plus a stale ask, not just one stale description) - a
  reminder not to assume the trend toward "narrower findings" is monotonic.
  Still worth another close read next run rather than assuming exhaustion,
  though the well is visibly getting harder to draw from (two full
  sub-agent sweeps this run each found exactly one thing).
- The fallback Task B sweep found one real, narrow finding this run
  (`webhooks/route.ts`'s docstring) after Run 12's sweep came back
  completely clean - a reminder that "handler files themselves" and
  "manifest's description of the handler files" are different audit
  surfaces, and a clean read of one doesn't imply the other is clean too.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-12, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Runs 10-12, flagged in case future branding work wants it.

## Run 14 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 13's last commit (`12e13dd`), already equal to `origin/main` (0 commits
behind) - checked out a tracking `main` branch pointed at it, no fast-forward
needed. Re-verified from a clean `npm install` (removed `node_modules` first):
`build`, `lint`, `typecheck`, `test` (94/94) all pass clean before touching
anything.

### Task A - still correctly ruled out (Run 1). Re-verified
`juke-api-reads.ts` directly this run: still only GET-by-id and DELETE-by-id
for webhooks, no list-by-URL endpoint. Nothing has changed.

### Task C - re-verified all 4 roadmap items directly against current code;
no change in status on any of them

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer in
   `src/`: still exactly `session.ts:48-53`'s explicitly opt-in legacy
   fallback block. Already correctly absent from `setup-zuke.md`'s roadmap
   list. No change.
2. **Item 2 (signer)** - re-grepped "signer" repo-wide and re-read
   `src/lib/publish/auto-cast.ts` in full: still an unconditional stub (logs,
   returns `null`), still zero real credential references anywhere in code,
   env vars, or docs. Confirmed still blocked on a @thezao Farcaster signer
   this sandbox cannot provision or fake. No change.
3. **Item 3 (custom domain)** - confirmed `setup-zuke.md`'s current
   `## v1 Roadmap` section still correctly omits the domain item (only
   "Integrate ZAO signer..." and "Branding..." remain), with the
   shipped-note intact below it (Run 11's fix). No leftover `zaoos.com`/
   `localhost` references in `src/` (the one `localhost` hit is a legitimate
   test fixture URL in `providers.test.ts`). No change needed.
4. **Item 4 (branding)** - re-checked `public/` (still only the five
   unmodified create-next-app SVGs) and `src/app/favicon.ico` (md5
   `c30c7d42707a47a3f4591831641e50dc`, byte-identical to Runs 10-13's check -
   still the stock create-next-app default). **No new gap; the logo/favicon
   asset is still the one documented missing piece, still needs a
   human-provided design asset.**

All 4 roadmap items remain exactly where Run 13 left them: items 1 and 3
done, item 2 blocked on an external credential, item 4's code-side gap
already fixed with the design-asset gap itself still real and outside this
sandbox's control.

### Ninth close read of `jukeIntegrationManifest.ts` (per Run 13's pointer -
eight consecutive prior close reads each found something new) - one real
finding, verified myself before fixing

Dispatched one Explore sub-agent for a full line-by-line ninth read,
explicitly told to re-verify every claim against current code from scratch:
all ~30 `files:` paths, both status-header versions, both count pairs, the
three-table claim, CONVENTIONS vs. the real provider registry, the webhook
verifier details, the full event-dispatch table, the three
removed-SHIPPED-entries and three removed-OPEN_ASKS comments, and every
remaining open OPEN_ASKS entry. It reported exactly one finding, which I
independently re-verified against the real code myself before fixing:

1. **The `agent-join-consumer` SHIPPED entry (added by Run 13) claimed
   `joinAgentInJukeRoom` "is wired into two call sites."** Verified via
   `grep -rn "joinAgentInJukeRoom" src`: the helper is imported and called
   exactly once, from `jukeWebhookHandlers.ts`'s auto-join hook.
   `src/app/api/juke/admin/agent-join/route.ts` never imports
   `jukeAgentJoin.ts` at all - I read the route in full and confirmed it has
   its own independent inline `fetch` to the same Juke endpoint, with its
   own header construction and response parsing. So the "shared helper, two
   call sites" framing was false: in reality there are two independent
   implementations of the same call, only one of which uses the named
   helper. Rewrote the description to state this accurately. Commit
   `4ae658c` (combined with the fallback-sweep fix below, same file, same
   close-read pass).

### Fallback Task B sweep (per instructions, since Task C's per-run gaps
were exhausted after the above) - four real findings, all independently
verified before fixing

Dispatched one Explore sub-agent in parallel with the manifest read, scoped
to areas not the focus of a *recent* close read: `src/app/live/[spaceId]/page.tsx`,
`src/app/admin/AdminConsole.tsx` and the remaining `src/components/spaces/*.tsx`
files, a full `README.md` read against `setup-zuke.md`'s current 2-item
roadmap, a repo-wide sweep for hardcoded counts sitting next to
`.slice(`/`.limit(`, and a fresh TODO/FIXME/XXX/HACK/STUB/"not yet" grep
across `src/`, `docs/`, and top-level `*.md`. It reported four findings; each
verified directly against the real code myself before fixing, per
instructions:

1. **`src/app/juke-status/page.tsx`'s own `ArchitectureSection` still said
   "ZAO holds two persisted tables" (`juke_spaces` + `juke_webhook_events`)**
   - the exact false claim Run 11 already fixed in the manifest's markdown
   prose (`jukeIntegrationManifest.ts`, now correctly says "three," including
   `juke_recordings`). This page has its own independent copy of that prose
   that no prior run ever touched - confirmed via `git log -S` on the string,
   unchanged since the file's original commit. Fixed to say three tables and
   name `juke_recordings`. Commit `9a595e5`.
2. **`src/lib/spaces/jukeIntegrationManifest.ts`'s ASCII diagram
   webhook-dispatch section omitted `juke_recordings` entirely** - it showed
   `recording.ready -> juke_spaces.recording_url` and a terminal box of only
   `juke_spaces + juke_webhook_events`, in a part of the same file neither
   Run 8's nor Run 11's fixes touched. Verified `jukeWebhookHandlers.ts:246-278`
   directly: the handler inserts every recording part into `juke_recordings`
   (idempotent on `space_id`+`url`) in addition to updating
   `juke_spaces.recording_url` with just the first part for back-compat.
   Fixed the diagram line and the terminal Supabase box to name all three
   tables. Commit `4ae658c` (same commit as the agent-join-consumer fix
   above - same file, same read pass).
3. **`src/app/listen/page.tsx` - a real, verified logic bug: the "See all"
   link to `/live/recordings` could never render.** `recorded` came from
   `listRecordedJukeSpaces(6)`, whose own query caps the result at
   `Math.min(Math.max(1, limit), 100)` = exactly 6 rows
   (`jukeSpacesDb.ts:289-298`) - so `recorded.length > 6`, the link's gating
   condition, was dead code from the original commit: no matter how many
   recordings actually exist in the DB, the array handed to the page could
   never exceed 6, and the link would never show. Fixed by fetching one
   extra row (`listRecordedJukeSpaces(7)`), checking overflow on the
   unsliced result (`hasMoreRecorded = recordedRaw.length > 6`), then
   slicing to the displayed 6 (`recordedRaw.slice(0, 6)`) - same pattern
   already used elsewhere in this file for `live` (fetch-wide, slice-narrow).
   This is a real, buildable engineering bug fix, not a doc-only correction.
   Commit `ebcc9f2`.
4. **`src/lib/spaces/juke.ts`'s docstring claimed `frame-src` and the
   `microphone` Permissions-Policy live in `src/middleware.ts`** - confirmed
   no such file exists anywhere in the repo (only Next.js's own generated
   `.next/server/middleware-*` build artifacts, not a source file), and
   `next.config.ts` is an empty stub with no `headers()` config; no
   `vercel.json` exists either. Repo-wide grep for "frame-src" and
   "Permissions-Policy" returns zero hits outside this one docstring - no
   CSP or Permissions-Policy is configured anywhere in this codebase. The
   real mechanism granting microphone access to the Juke iframe is
   `JukeEmbed.tsx:104`'s own `allow` attribute
   (`'autoplay; microphone'`/`'autoplay'`), confirmed by reading that file
   directly. Rewrote the docstring to state this. Commit `388db73`.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed all four commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join (specifically the *unattended*/auto-join
  piece - unchanged since Run 13)

### For the next run

- All 4 roadmap items remain in the same state Runs 11-13 left them: items 1
  and 3 done, item 2 blocked on a @thezao Farcaster signer credential, item
  4's code-side gap fixed with the logo/favicon design asset itself still
  the one open piece. None of these are engineering gaps left in this
  sandbox's control - say so plainly rather than re-litigating items 1-3
  from scratch every run.
- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real finding
  on **nine** consecutive close reads (Runs 3, 7, 8, 9, 10, 11, 12, 13, 14).
  This run's manifest-specific finding was narrow (one mis-described
  call-site count), consistent with the shrinking-backlog trend Run 11/12
  noted - but the *fallback sweep* also found a second, unrelated issue in
  this same file (the diagram's missing `juke_recordings`), a reminder that
  a narrow finding from the manifest-focused read doesn't mean the file is
  fully clean; a differently-scoped read can still find something the
  focused read's checklist didn't happen to cover.
- This run's most notable finding was `listen/page.tsx`'s dead
  `recorded.length > 6` condition (finding #3 above) - a genuine functional
  bug (a real UI link that could never render), not just a doc/comment
  correction, caught by the "hardcoded count next to `.slice`/`.limit`" sweep
  pattern several prior runs have used for the manifest/status-page files.
  Worth remembering that pattern generalizes beyond those two files - it
  found a real bug in a third file this run.
- Two files (`juke-status/page.tsx`'s ArchitectureSection prose,
  `jukeIntegrationManifest.ts`'s markdown-route prose) had said the same
  "two tables" thing independently; Run 11 fixed one copy, this run found
  and fixed the other. Same lesson as Run 11's note about grepping for a
  literal old phrase repo-wide after a fix - worth doing for prose claims
  that could plausibly exist as an independent copy elsewhere, not just
  exact-string duplicates.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-13, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Runs 10-13, flagged in case future branding work wants it.

## Run 15 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 14's last commit (`28092a6`), already equal to `origin/main` (0 commits
behind) - checked out a tracking `main` branch pointed at it, no fast-forward
needed. Re-verified from a clean `npm install` (removed `node_modules` first):
`build`, `lint`, `typecheck`, `test` (94/94) all pass clean before touching
anything.

### Task A - still correctly ruled out (Run 1). Re-verified
`juke-api-reads.ts` directly this run: still only GET-by-id and DELETE-by-id
for webhooks, no list-by-URL endpoint. Nothing has changed.

### Task C - re-verified all 4 roadmap items directly against current code;
no change in status on any of them

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer in
   `src/`: still exactly `session.ts:48-53`'s explicitly opt-in legacy
   fallback block, unchanged. Already correctly absent from
   `setup-zuke.md`'s roadmap list. No change.
2. **Item 2 (signer)** - re-read `src/lib/publish/auto-cast.ts` in full:
   still an unconditional stub (logs, returns `null`), still zero real
   credential references anywhere in `src/`, `docs/`, or top-level `*.md`
   beyond the same honest stub-caveat text every prior run found. Confirmed
   still blocked on a @thezao Farcaster signer this sandbox cannot
   provision or fake. No change.
3. **Item 3 (custom domain)** - confirmed `setup-zuke.md`'s current
   `## v1 Roadmap` section still correctly omits the domain item (only
   "Integrate ZAO signer..." and "Branding..." remain), with the
   shipped-note intact below it (Run 11's fix). Re-ran a repo-wide grep for
   `zaoos.com`/`localhost` in `src/` (excluding `*.test.ts`): zero hits.
   `zuke.config.ts`'s `getBaseUrl()` resolution-order comment still
   accurately describes the live custom-domain state. No change needed.
4. **Item 4 (branding)** - re-checked `public/` (still only the five
   unmodified create-next-app SVGs) and `src/app/favicon.ico` (md5
   `c30c7d42707a47a3f4591831641e50dc`, byte-identical to Runs 10-14's check
   - still the stock create-next-app default). Root layout metadata (fixed
   Run 10) still correct. **No new gap; the logo/favicon asset is still the
   one documented missing piece, still needs a human-provided design
   asset.**

All 4 roadmap items remain exactly where Runs 11-14 left them: items 1 and
3 done, item 2 blocked on an external credential, item 4's code-side gap
already fixed with the design-asset gap itself still real and outside this
sandbox's control.

### Tenth close read of `jukeIntegrationManifest.ts` (per Run 14's pointer -
nine consecutive prior close reads each found something new) - one real
finding, independently re-verified against actual code before fixing

Dispatched one Explore sub-agent for a full line-by-line tenth read,
explicitly told to re-verify every claim from scratch: all `files:` paths
(all exist), every SHIPPED description against the file(s) it describes,
every OPEN_ASKS reason (all five still genuinely open, none secretly
shipped), the CONVENTIONS array against the real provider registry, both
status-header versions, both count/slice pairs, the three-table claim, and
the full `INTEGRATION_ARCHITECTURE_ASCII` diagram line by line. It reported
exactly one finding, which I independently re-verified against the real
code myself before fixing:

1. **The diagram's webhook-dispatch table showed `room.finished ->
   juke_spaces.status='ended'` with no mention of a recap-cast dispatch,**
   while the parallel `recording.ready` line correctly shows its own
   `+ autoCastToZao recap to /zao channel` sub-line. Verified directly:
   `jukeWebhookHandlers.ts:193-232`'s `room.finished`/`room.ended` case
   does call `autoCastToZao(...)` with a "Just wrapped: {title}" message
   whenever `ended_via` is `'host'` or `'api'` (skipping idle LiveKit
   timeouts, where `ended_via` is unset) - exactly what the manifest's own
   `recap-cast-room-finished` SHIPPED entry (added by an earlier run)
   already describes in prose a few hundred lines up. The diagram was the
   one place in the file where that entry's own claim never made it in -
   the same class of prose/diagram desync Run 8's `hms`/`stage-room` fix
   and Run 14's `juke_recordings`-in-diagram fix both caught. Added a
   matching dispatch line, with the same "wired but stubbed" caveat used
   elsewhere in the same table. Commit `a84a7ea`.

Everything else the sub-agent checked - all `files:` path existence, every
other SHIPPED/OPEN_ASKS entry, CONVENTIONS, both header versions, both
count pairs, the three-table claim, and the rest of the diagram - held up
on independent verification.

### Fallback Task B sweep (per instructions, run in parallel with the
manifest read since both draw from the same "nothing left to check"
uncertainty) - completely clean, no findings

Dispatched one Explore sub-agent scoped to areas not covered by a recent
close read, explicitly excluding `jukeIntegrationManifest.ts` (being read
by the parallel agent) and every file already fixed/verified clean in Runs
11-14: `live/create/page.tsx`+`layout.tsx`, `live/import/page.tsx`+
`ImportXSpaceForm.tsx`, `live/[spaceId]/page.tsx`, `AdminConsole.tsx`,
`admin/login/page.tsx`, full reads of `recordingsDb.ts`,
`recordingsStorage.ts`, `recordingParts.ts`, `xSpaces.ts`,
`jukeSpacesDb.ts`, `jukeChangelog.ts`, `jukeWebhookHandlers.ts` (handler
bodies, not just docstrings), `providers/{juke,hms,index}.ts`, every
`scripts/*.ts`/`*.sql` file, `package.json` scripts vs. README/
setup-zuke.md, and a fresh TODO/FIXME/XXX/HACK/"not yet"/"not implemented"
grep across `src/`, `docs/`, and top-level `*.md`. Every single claim it
checked held up against the real code it described - the first fully clean
fallback sweep since Run 12's (which was also fully clean). No findings to
fix.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join (specifically the *unattended*/auto-join
  piece - unchanged since Run 13)

### For the next run

- All 4 roadmap items remain in the same state Runs 11-14 left them: items
  1 and 3 done, item 2 blocked on a @thezao Farcaster signer credential,
  item 4's code-side gap fixed with the logo/favicon design asset itself
  still the one open piece. None of these are engineering gaps left in
  this sandbox's control - say so plainly rather than re-litigating items
  1-3 from scratch every run.
- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real
  finding on **ten** consecutive close reads (Runs 3, 7, 8, 9, 10, 11, 12,
  13, 14, 15). This run's finding was the same "diagram/prose desync"
  class Run 8 and Run 14 both found - a SHIPPED entry's prose gets fixed
  or added but the ASCII diagram's own copy of the same fact doesn't get
  updated in the same pass. Worth explicitly cross-checking the diagram
  section whenever a future run touches any SHIPPED entry's prose, rather
  than treating the diagram as a separate, lower-priority pass.
- This run's fallback sweep was fully clean for the second time (Run 12,
  now Run 15) - two of the last four fallback sweeps found nothing, versus
  real findings in Runs 11, 13, 14. Combined with essentially every file
  in the repo now having been read at least twice, this is consistent with
  a genuinely narrowing (not bottomless) backlog outside the manifest file
  specifically - but Run 13's note about not assuming monotonic narrowing
  still applies; don't skip the sweep on the strength of this note alone.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-14, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Runs 10-14, flagged in case future branding work wants it.

## Run 16 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 15's last commit (`71ea1c4`), already equal to `origin/main` (0 commits
behind) - checked out a tracking `main` branch pointed at it, no fast-forward
needed. Re-verified from a clean `npm install` (removed `node_modules` first):
`build`, `lint`, `typecheck`, `test` (94/94) all pass clean before touching
anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated this run;
nothing prompted a re-check (no changes to Juke's API surface referenced
anywhere new since Run 14/15's last direct re-verification of
`juke-api-reads.ts`).

### Task C - re-verified all 4 roadmap items directly against current code;
no change in status on any of them

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer in
   `src/`: still exactly `session.ts:48-53`'s explicitly opt-in legacy
   fallback block, unchanged. Already correctly absent from
   `setup-zuke.md`'s roadmap list. No change.
2. **Item 2 (signer)** - re-read `src/lib/publish/auto-cast.ts` in full:
   still an unconditional stub (logs, returns `null`), still zero real
   credential references anywhere in `src/`, `docs/`, or top-level `*.md`
   beyond the same honest stub-caveat text every prior run found. Confirmed
   still blocked on a @thezao Farcaster signer this sandbox cannot
   provision or fake. No change.
3. **Item 3 (custom domain)** - confirmed `setup-zuke.md`'s current
   `## v1 Roadmap` section still correctly omits the domain item (only
   "Integrate ZAO signer..." and "Branding..." remain), with the
   shipped-note intact below it (Run 11's fix). Re-ran a repo-wide grep for
   `zaoos.com`/`localhost` in `src/` (excluding `*.test.ts`): zero hits. No
   change needed.
4. **Item 4 (branding)** - re-checked `public/` (still only the five
   unmodified create-next-app SVGs) and `src/app/favicon.ico` (md5
   `c30c7d42707a47a3f4591831641e50dc`, byte-identical to Runs 10-15's check
   - still the stock create-next-app default). **No new gap; the logo/
   favicon asset is still the one documented missing piece, still needs a
   human-provided design asset.**

All 4 roadmap items remain exactly where Runs 11-15 left them: items 1 and
3 done, item 2 blocked on an external credential, item 4's code-side gap
already fixed with the design-asset gap itself still real and outside this
sandbox's control.

### Eleventh close read of `jukeIntegrationManifest.ts` (per Run 15's
pointer - ten consecutive prior close reads each found something new) - one
real finding, independently re-verified against actual code before fixing

Dispatched one Explore sub-agent for a full line-by-line eleventh read,
explicitly told to re-verify every claim from scratch: all `files:` paths
(all exist), every SHIPPED description against the file(s) it describes,
every OPEN_ASKS reason (all still genuinely open, none secretly shipped),
the CONVENTIONS array against the real provider registry, both status-header
versions, both count/slice pairs, the three-table claim, and the full
`INTEGRATION_ARCHITECTURE_ASCII` diagram line by line. It reported exactly
one finding, which I independently re-verified against the real code myself
before fixing:

1. **The `agents` OPEN_ASKS entry claimed "we're passing allow_agents:true
   on create."** False for the actual production create path. Verified
   directly: `src/app/live/create/page.tsx:41`'s fetch body is
   `JSON.stringify({ title: title.trim(), password })` - no `allowAgents`
   field at all - and `src/lib/spaces/juke-api.ts:141` defaults
   `allow_agents` to `false` whenever the caller doesn't explicitly supply
   it. `src/app/api/juke/space/route.ts`'s `createSpaceSchema` does accept
   an optional `allowAgents`, but nothing on the real `/live/create` page
   ever sends it. Grepped for the only two places that actually pass
   `true`: `src/app/admin/AdminConsole.tsx:48` (a dev/admin test console,
   defaults its own local state to `true`) and
   `scripts/test-juke-space.ts:53` (a manual test script) - neither is the
   path used to create real ZAOstock-standup/weekly-fractal rooms the ask
   is actually about. This undermines the ask's own premise that "any admin
   can trigger [agent-join] by hand today" against a real event room - it
   only works against a room created via the admin test console or with the
   flag set by hand, not one created through the normal `/live/create` flow.
   Rewrote the reason to name this as a second real gap (allow_agents needs
   exposing on the real create path) alongside the already-documented
   VPS-side session-token piece, rather than implying the create-side wiring
   was already done. Commit `88ad74f`.

Everything else the sub-agent checked - all 30 `files:` paths, every other
SHIPPED description (including `path-a-iframe`, `path-b-developer-create`,
`webhook-consumer`, `recap-cast`/`recap-cast-room-finished`,
`agent-join-consumer`, `host-end-space-button`,
`developer-reads-and-observability`), the remaining four OPEN_ASKS entries,
CONVENTIONS, both header versions, both count pairs, the three-table claim,
and the full ASCII diagram - held up on independent verification.

### Fallback Task B sweep (per instructions, run in parallel with the
manifest read) - two real findings, both independently verified before
fixing

Dispatched one Explore sub-agent scoped to areas not covered by a *recent*
close read (explicitly excluding `jukeIntegrationManifest.ts`, being read by
the parallel agent): a full fresh read of `juke-status/page.tsx` beyond its
already-fixed `ArchitectureSection`, `juke/page.tsx`'s env var/migration
claims, `JukeEmbed.tsx`/`.test.tsx`, `RecordingsManager.tsx`,
`JukeListenerBadge.tsx`, `partner-token/route.ts` and the four
`admin/*/route.ts` files, `juke-api.ts`/`juke-api-reads.ts` docstrings
directly (not just their downstream consumers' docstrings), and a fresh
TODO/FIXME/STUB/"not yet" grep. It reported two findings, both independently
re-verified against the real code myself before fixing:

1. **`src/lib/spaces/juke-api.ts:124` - `createJukeSpace`'s own `@param
   credentials` doc comment still said "The `JUKE_API_KEY` +
   `JUKE_USER_TOKEN` pair."** Verified directly: the `JukeCredentials`
   interface (`juke-api.ts:81-84`) has been `apiKey`-only since the
   2026-05-22 key-only auth switch, and this same file's own top-of-file
   docstring already says so. Run 3 fixed the identical stale claim
   downstream in `api/juke/space/route.ts`'s docstring but never touched
   this file - the actual source of the claim. Fixed. Commit `b69ec0d`.
2. **`juke-status/page.tsx:349-350`'s `CodeExamplesSection` claimed "Every
   line matches the live production code paths."** False for the webhook-
   verification snippet specifically: it showed a single HMAC comparison,
   but `jukeWebhookVerify.ts:90-103` actually retries the HMAC across
   several secret-canonicalization variants (`buildSecretVariants` - raw,
   `whsec_`-stripped, app-prefix-stripped, base64-decoded) before failing,
   to tolerate ambiguity in how Juke's shared secret should be
   canonicalized. Softened the blanket "every line matches" claim (the
   snippets are simplified references, not literal file contents) and added
   a comment inside the webhook snippet itself naming the real variant-retry
   behavior it omits. Commit `7be0e1c`.

   Everything else the sub-agent checked - `juke-status/page.tsx`'s stats
   row, webhook timeline, recent-spaces section, and the rest of
   `ArchitectureSection`'s prose; `juke/page.tsx`'s migration count and env
   var list; `JukeEmbed.tsx`/`.test.tsx`'s every prop/behavior claim;
   `RecordingsManager.tsx`'s media-fragment snippet claim (byte-for-byte
   against `/api/recordings/snippet/route.ts`); `JukeListenerBadge.tsx`'s
   overflow-count claim; `partner-token/route.ts` and the four admin routes'
   docstrings/status-code contracts; `juke-api-reads.ts`'s docstrings; and
   the TODO/FIXME sweep (nothing new beyond the already-known `hms.ts` and
   `auto-cast.ts` stubs) - held up on independent verification.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed all three commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join (specifically the *unattended*/auto-join
  piece - unchanged since Run 13, now with a second named blocker
  (`allow_agents` not exposed on the real create path) alongside the
  VPS-side session-token piece)

### For the next run

- All 4 roadmap items remain in the same state Runs 11-15 left them: items
  1 and 3 done, item 2 blocked on a @thezao Farcaster signer credential,
  item 4's code-side gap fixed with the logo/favicon design asset itself
  still the one open piece. None of these are engineering gaps left in
  this sandbox's control - say so plainly rather than re-litigating items
  1-3 from scratch every run.
- `jukeIntegrationManifest.ts` has now yielded a genuinely new, real
  finding on **eleven** consecutive close reads (Runs 3, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16). This run's finding (`allow_agents:true` not actually
  set on the real create path) is a case worth flagging distinctly: unlike
  most prior findings, which were pure doc/prose corrections, this one
  surfaces a real, if narrow, product question - should `/live/create`
  expose an `allow_agents` toggle (or default it `true`) so the
  already-working `agent-join-consumer` can actually target a real event
  room? That's a scope/product call this run deliberately did not make
  unilaterally (no design input on whether agents should be on-by-default
  for real ZAO events) - documented honestly in the ask's reason text
  instead of either building a toggle blind or leaving the false claim
  standing. A future run could pick this up as real, buildable feature work
  if the human owner confirms the intent (e.g. "yes, add an allow_agents
  checkbox to /live/create" or "yes, default it true for admin-created
  rooms") - it needs zero new external credentials, unlike items 2 and the
  design-asset half of item 4.
- The fallback sweep found two real findings this run (both independently
  verified) after Run 15's fully-clean sweep - consistent with Run 13's
  note that clean sweeps don't reliably predict the next one. Both findings
  were the same "docstring/prose claim goes stale after the code it
  describes changes elsewhere" class every prior run has repeatedly found -
  worth continuing to scope fallback sweeps at files not recently
  close-read by name, rather than assuming a file is done once any part of
  it has been fixed once.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-15, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Runs 10-15, flagged in case future branding work wants it.

## Run 17 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 16's last commit (`65f3ff9`), already equal to `origin/main` (0 commits
behind) - checked out a tracking `main` branch pointed at it, no fast-forward
needed. Re-verified from a clean `npm install` (removed `node_modules` first):
`build`, `lint`, `typecheck`, `test` (94/94) all pass clean before touching
anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated this run;
nothing prompted a re-check (no changes to Juke's API surface referenced
anywhere new since Run 14/15's last direct re-verification of
`juke-api-reads.ts`).

### Task C - re-verified all 4 roadmap items directly against current code;
no change in status on any of them

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer in
   `src/`: still exactly `session.ts:48-53`'s explicitly opt-in legacy
   fallback block, unchanged. Already correctly absent from
   `setup-zuke.md`'s roadmap list. No change.
2. **Item 2 (signer)** - re-read `src/lib/publish/auto-cast.ts` in full:
   still an unconditional stub (logs, returns `null`), still zero real
   credential references anywhere in `src/`, `docs/`, or top-level `*.md`
   beyond the same honest stub-caveat text every prior run found. Confirmed
   still blocked on a @thezao Farcaster signer this sandbox cannot
   provision or fake. No change.
3. **Item 3 (custom domain)** - confirmed `setup-zuke.md`'s current
   `## v1 Roadmap` section still correctly omits the domain item (only
   "Integrate ZAO signer..." and "Branding..." remain), with the
   shipped-note intact below it (Run 11's fix). Re-ran a repo-wide grep for
   `zaoos.com`/`localhost` in `src/`: zero hits. No change needed.
4. **Item 4 (branding)** - re-checked `public/` (still only the five
   unmodified create-next-app SVGs) and `src/app/favicon.ico` (md5
   `c30c7d42707a47a3f4591831641e50dc`, byte-identical to Runs 10-16's check
   - still the stock create-next-app default). **No new gap; the logo/
   favicon asset is still the one documented missing piece, still needs a
   human-provided design asset.**

All 4 roadmap items remain exactly where Runs 11-16 left them: items 1 and
3 done, item 2 blocked on an external credential, item 4's code-side gap
already fixed with the design-asset gap itself still real and outside this
sandbox's control.

### Twelfth close read of `jukeIntegrationManifest.ts` - the first fully
clean read in twelve consecutive attempts (Runs 3, 7-16)

Dispatched one Explore sub-agent for a full line-by-line twelfth read,
explicitly told to re-verify every claim from scratch and not trust any
prior "fixed" annotation: all `files:` paths (all exist), every SHIPPED
description's behavioral claims (including the two most recently touched -
`agent-join-consumer`'s "does not share the helper" correction from Run 14,
and the `agents` OPEN_ASKS's `allow_agents` correction from Run 16), the
CONVENTIONS array against the real provider registry, both status-header
versions, both count/slice pairs, the three-table claim, and the full
`INTEGRATION_ARCHITECTURE_ASCII` diagram line by line including the
`room.finished`/`recording.ready` recap-cast dispatch lines Run 15 added.

**It found nothing.** Every claim it checked - all ~34 file paths, every
SHIPPED/OPEN_ASKS entry, CONVENTIONS, both header versions, both count
pairs, and the diagram - held up against the real current code. This is the
first genuinely clean close read of this file across twelve attempts since
Run 3 first started auditing it. Consistent with Run 11/12's note that the
backlog here was narrowing (not bottomless) and Run 12's speculation that a
fully clean read would eventually be real evidence of exhaustion, rather
than something to assume without checking - it took four more runs (13-16)
to actually arrive.

**Treating this as tentative, not proof the file can never drift again** -
every future run that touches code this file describes (webhook handlers,
provider registry, create-space flow, admin routes) should still grep-check
the manifest's corresponding claim before considering a change complete, the
same discipline that caused most of the last twelve fixes. But absent such a
change, there's no more standing reason to dispatch a dedicated close-read
sub-agent against this file every single run - see "for the next run" below.

### Fallback Task B sweep (per instructions, run in parallel with the
manifest read) - two real findings, both independently verified before
fixing

Dispatched one Explore sub-agent scoped to areas not covered by a *recent*
close read (explicitly excluding `jukeIntegrationManifest.ts`, being read by
the parallel agent): `src/app/api/juke/admin/agent-join/route.ts` +
`jukeAgentJoin.ts` read as the actual files (not just the manifest's
description of them), `live/create/page.tsx` + `api/juke/space/route.ts`
cross-checked field-by-field, `jukeSpacesDb.ts`'s every exported function's
docstring against its query body, `RecordingsManager.tsx` +
`JukeListenerBadge.tsx`, a full `README.md` read against real code, and a
fresh TODO/FIXME/STUB/"not yet"/"not implemented"/"no-op" grep. It reported
two findings, both independently re-verified against the real code myself
before fixing:

1. **`jukeAgentJoin.ts`'s own docstring (lines 1-5) claimed
   `joinAgentInJukeRoom()` is "shared by the admin route (`POST
   /api/juke/admin/agent-join`)."** False - read
   `admin/agent-join/route.ts` directly: it never imports `jukeAgentJoin.ts`
   at all, and has its own independent inline `fetch` to the same Juke
   endpoint with its own status mapping. Only the `room.started` webhook
   auto-join hook (`jukeWebhookHandlers.ts`) actually calls the shared
   helper. This is the exact same false claim Run 14 already found and
   fixed inside the *manifest's* `agent-join-consumer` description
   (commit `4ae658c`) - but this run found it was never fixed at its
   actual source, `jukeAgentJoin.ts`'s own docstring, which independently
   makes the identical claim. Fixed to state plainly that two independent
   implementations of the same call exist, not one shared helper. Commit
   `53e7e44`.
2. **Both `src/lib/spaces/juke-api.ts` (`record?: boolean` doc comment) and
   `src/app/api/juke/space/route.ts` (`record` Zod field comment) claimed
   "ZAO defaults this ON in the UI" / "ZAO default is true so every space
   contributes to the archive."** False for the real production path.
   Verified directly: `juke-api.ts:142` sends `record: input.record ??
   false` (confirmed by `juke-api.test.ts:111,126`'s own assertions that
   `record: false` is sent both when omitted and when explicitly false),
   and `live/create/page.tsx:41`'s fetch body is `{ title: title.trim(),
   password }` - no `record` field at all, so every space created through
   the real `/live/create` form is unrecorded by default. Only
   `AdminConsole.tsx:49` (the admin test console) defaults its own local
   component state to `true` - not the production path. This is the same
   category of gap as the already-documented `allow_agents` finding from
   Run 16 (a docstring describing intended/aspirational UI behavior that
   the real `/live/create` form never actually implements) - just never
   independently caught for `record` specifically until this run. Fixed
   both docstrings to state the real default and point at the same
   `AdminConsole`-only exception. Grepped repo-wide for the same
   "defaults... ON"/"default is true" phrasing after fixing - no other
   copies found (unlike the `allow_agents`/two-tables cases in earlier
   runs, this claim only existed in these two places). Commit `1b6e035`.

   Everything else the sub-agent checked - `jukeSpacesDb.ts`'s every
   `.limit()`/docstring N-claim, `RecordingsManager.tsx` and
   `JukeListenerBadge.tsx`'s display-count claims, `README.md`'s scripts/
   webhook-event/architecture claims, and the TODO/FIXME/STUB grep - held
   up on independent verification, or (TODO/FIXME grep) surfaced nothing
   beyond the already-known honest `hms.ts` and `auto-cast.ts` stubs.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed both commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join (specifically the *unattended*/auto-join
  piece - unchanged since Run 13, still blocked on both the VPS-side
  session-token consumer and `allow_agents` not being exposed on the real
  create path, per Run 16)

### For the next run

- All 4 roadmap items remain in the same state Runs 11-16 left them: items
  1 and 3 done, item 2 blocked on a @thezao Farcaster signer credential,
  item 4's code-side gap fixed with the logo/favicon design asset itself
  still the one open piece. None of these are engineering gaps left in
  this sandbox's control - say so plainly rather than re-litigating items
  1-3 from scratch every run.
- `jukeIntegrationManifest.ts` finally produced a fully clean twelfth close
  read this run, after eleven consecutive reads (Runs 3, 7-16) each found
  something. **Recommend a future run stop dispatching a dedicated
  close-read sub-agent against this specific file every single run** unless
  either (a) this run's fallback sweep or a future one touches code the
  manifest describes (any change to webhook handlers, the provider
  registry, create-space fields, or admin routes should still prompt a
  targeted grep-check of the manifest's corresponding claim, per Run 11's
  standing lesson), or (b) enough runs have passed that a fresh full read is
  cheap insurance against a slow drift a targeted check wouldn't catch.
  Redirect that sub-agent budget toward fresh fallback-sweep territory
  instead - see next point.
- This run's real finding was a genuine pattern: **the same false claim can
  exist independently in multiple places, and fixing one copy (the
  manifest's description of a file) doesn't fix the other copy (that file's
  own docstring).** `jukeAgentJoin.ts`'s "shared by the admin route" claim
  sat unfixed for three runs after Run 14 fixed the identical claim in the
  manifest. Worth treating "does the *source* file's own docstring say the
  same thing correctly, not just the manifest's description of it" as a
  standing double-check whenever a manifest fix references a specific
  function/route by name.
- The `record` default finding (like Run 16's `allow_agents` finding) again
  surfaces a real, narrow product question this run deliberately did not
  decide unilaterally: should `/live/create` actually send `record: true`
  by default (matching the now-corrected docstrings' description of intent
  - "the recording is what powers the post-live discovery loop"), or should
  the docstrings' aspirational framing be considered wrong and left as
  documented reality (opt-in only, via AdminConsole)? Two now-adjacent
  product questions (`allowAgents` default, `record` default) both live on
  the same real `/live/create` form and both need a human decision, not
  invented code - a future run could bundle both into one scoped feature if
  the human owner confirms intent for either or both.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-16, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Runs 10-16, flagged in case future branding work wants it.

## Run 18 — 2026-07-12

Read this file fully before starting. Local `main`/`origin/main` had
diverged in an unusual way this run: local `main` pointed at an entirely
unrelated history (`git merge-base --is-ancestor` returned false despite
matching final commit messages) rather than the usual simple
detached-HEAD-behind-origin pattern of Runs 2-17. Diagnosed before acting:
this was a stale local branch ref artifact of this sandbox's setup, not
real divergent work (`git status` was clean, no uncommitted changes
anywhere). Fixed with `git checkout -B main origin/main` rather than a
merge, since there was nothing local to preserve. Re-verified from a
clean `npm install` (removed `node_modules` first): `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated this
run; nothing prompted a re-check.

### Task C - re-verified all 4 roadmap items directly against current
code; no change in status on any of them

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer in
   `src/`: still exactly `session.ts:48-53`'s explicitly opt-in legacy
   fallback block, unchanged. No change.
2. **Item 2 (signer)** - re-read `src/lib/publish/auto-cast.ts` in full:
   still an unconditional stub (logs, returns `null`), still zero real
   signer-credential references anywhere in `src/`. Confirmed still
   blocked on a @thezao Farcaster signer this sandbox cannot provision or
   fake. No change.
3. **Item 3 (custom domain)** - `setup-zuke.md`'s roadmap section still
   correctly lists only the two open items (signer, branding), with the
   shipped-note intact. Re-ran a repo-wide grep for `zaoos.com`/`localhost`
   in `src/`: zero non-test hits. `zuke.config.ts`'s `getBaseUrl()` still
   accurately describes the live custom-domain resolution order. No change
   needed.
4. **Item 4 (branding)** - re-checked `public/` (still only the five
   unmodified create-next-app SVGs) and `src/app/favicon.ico` (md5
   `c30c7d42707a47a3f4591831641e50dc`, byte-identical to Runs 10-17's
   check - still the stock create-next-app default) and grepped product
   surfaces for stray "ZAO" mislabeling (only legitimate references to
   "the ZAO team"/org remain). **No new code-side gap; the logo/favicon
   asset is still the one documented missing piece, still needs a
   human-provided design asset.**

Also independently confirmed `README.md` has no stale duplicate roadmap
(it dropped its own roadmap section entirely per Run 6 - only
`setup-zuke.md` carries one now) and its Architecture section's SIWF/
auto-cast-stub prose still matches current code exactly.

All 4 roadmap items remain exactly where Runs 11-17 left them: items 1
and 3 done, item 2 blocked on an external credential, item 4's code-side
gap already fixed with the design-asset gap itself still real and outside
this sandbox's control.

### Skipped the dedicated `jukeIntegrationManifest.ts` close-read sub-agent
this run, per Run 17's explicit recommendation

Run 17 was the file's first fully clean read after twelve consecutive
reads (Runs 3, 7-16) each found something, and recommended redirecting
sub-agent budget toward fresh territory instead of a guaranteed-diminishing
close read every single run unless a change touches code the manifest
describes. No commit this run touched webhook handlers, the provider
registry, create-space fields, or admin routes, so no targeted grep-check
was needed either.

### Fallback Task B sweep - dispatched into genuinely fresh territory
(config/toolchain files, not the app/docs surface 17 prior runs have
repeatedly covered) - three real, verified findings, all fixed; one
investigated and correctly not acted on

Dispatched one Explore sub-agent scoped to `vitest.config.ts`/
`vitest.setup.ts`, `package.json` in full (deps, scripts, overrides),
`tsconfig.json`, `eslint.config.mjs`, `.github/workflows/
juke-stale-rooms-cron.yml`'s actual YAML, `next.config.ts`, `.gitignore`,
`CLAUDE.md`/`AGENTS.md`, and `package.json`'s `name` field - areas no
prior run's build-log entry named as checked. Most of this checked out
clean (vitest/tsconfig alias parity, the GitHub Actions workflow matching
`route.ts` and setup-zuke.md exactly, `.gitignore`'s `.env*` claim,
`next.config.ts` still an empty stub). Four items were flagged; I
independently re-verified each against real code myself before acting,
per instructions:

1. **`@neynar/nodejs-sdk` was a fully unused dependency.** Confirmed via
   repo-wide grep (`src/`, `scripts/`) - zero imports anywhere. All real
   Neynar integration is raw `fetch()` REST calls per `neynar.ts`'s own
   doc comment ("Direct REST (no SDK coupling)"). Removed it, ran a clean
   `npm install`, and re-verified `build`/`lint`/`typecheck`/`test`
   (94/94) all still pass. Also checked whether this affected the `viem`
   override's necessity (the sub-agent flagged `@neynar/nodejs-sdk` as one
   of two packages constraining `viem` in the lockfile) - read
   `@farcaster/auth-client`'s own `package.json` directly
   (`viem: ^2.29.2`) and confirmed the override is still required
   regardless: Run 1's original finding was that the *published*
   `viem@2.51.0` itself points its `ox` dependency at a broken
   ephemeral pre-release build, unrelated to which consumer requests
   viem. Left the override in place. Commit `e4ad893`.
2. **`tsx` was invoked via bare `npx` in `setup-zuke.md` and two
   `scripts/*.ts` docstrings but was never a declared dependency
   anywhere** - not in `package.json`, not actually installed in
   `package-lock.json` (only a never-installed optional peerDependency of
   `vite`, itself pulled in transitively by `vitest`). Every documented
   `npx tsx ...` invocation was silently fetching `tsx` ad hoc from the
   registry at runtime instead of resolving a pinned local copy, unlike
   `vitest`, which properly backs the documented `npm run test`. Added
   `tsx` as a devDependency (latest published, `^4.23.0`, verified via
   `npm view tsx version`), confirmed `node_modules/.bin/tsx` now resolves
   and `npx tsx --version` works locally without a network fetch, and
   re-verified the full toolchain (94/94 tests). Commit `66c7d42`.
3. **`package.json`'s `name` field was still the untouched create-next-app
   boilerplate `"zuke-init"`.** Confirmed via `git log -- package.json`
   that no prior commit ever touched it (Run 9's branding fix was root
   layout `<title>`/`<meta>` only). Nothing in the repo reads this field
   externally (package is `private: true`), so this is cosmetic, but it's
   exactly the kind of leftover scaffolding this run's own Task C item 4
   re-check was looking for. Renamed to `"zuke"`, ran `npm install` to
   sync `package-lock.json`'s mirrored name fields, re-verified the full
   toolchain (94/94 tests, `zuke@0.1.0` now shown in script output).
   Commit `606a156`.
4. **Investigated, not a finding: `AGENTS.md`'s directive to read
   `node_modules/next/dist/docs/` "before writing any code."** The
   sub-agent flagged this as security-relevant because several bundled
   doc files contain repeated `{/* AI agent hint: ... */}` comments
   pushing toward exporting an experimental `unstable_instant` route flag.
   Read the actual content directly before treating this as a possible
   prompt-injection concern (per this project's standing instruction to
   flag suspected injection): `node_modules/next/dist/docs/01-app/
   02-guides/ai-agents.md` documents this exact bundled-docs-plus-inline-
   agent-hints mechanism as an official, intentional Next.js 16.2+ feature
   (ships with `create-next-app`, generates the same `AGENTS.md`
   `@`-import pattern this repo already has), and `instant-navigation.md`
   documents `unstable_instant` as a real, legitimate opt-in experimental
   API for validating Suspense-boundary placement, not something covert
   or harmful. Concluded this is genuine (if unusually assertive in tone)
   framework documentation, not an attack - did not act on the hint (no
   task this run touched navigation/caching code, and it was never
   requested), and did not escalate further since there's no actual
   security concern, just an unusual but legitimate framework feature
   worth this note for any future run that does touch routing/caching
   code and wonders where the `unstable_instant` hints keep coming from.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed all three commits to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join (specifically the *unattended*/auto-join
  piece - unchanged since Run 13, still blocked on both the VPS-side
  session-token consumer and `allow_agents` not being exposed on the real
  create path, per Run 16)

### For the next run

- All 4 roadmap items remain in the same state Runs 11-17 left them: items
  1 and 3 done, item 2 blocked on a @thezao Farcaster signer credential,
  item 4's code-side gap fixed with the logo/favicon design asset itself
  still the one open piece. None of these are engineering gaps left in
  this sandbox's control - say so plainly rather than re-litigating items
  1-3 from scratch every run.
- `jukeIntegrationManifest.ts`'s dedicated close-read sub-agent is still
  correctly paused per Run 17's recommendation - resume it only if a
  future commit touches webhook handlers, the provider registry,
  create-space fields, or admin routes (do a targeted grep-check of the
  manifest's corresponding claim first), or once enough runs have passed
  that a fresh full read is cheap insurance again.
- This run found real gaps by deliberately searching *config/toolchain*
  files (`package.json`, devDependency completeness) rather than
  re-reading app code/docs a dozen prior runs have already covered -
  worth continuing to rotate the fallback sweep's scope toward
  genuinely-unread file categories (build config, CI, lockfile hygiene)
  rather than re-treading `src/app`/`src/lib/spaces` by default, now that
  those are comparatively well-trodden.
- The two adjacent product questions from Run 16/17 (`allowAgents`
  default, `record` default on `/live/create`) still need a human
  decision, not invented code - unchanged this run.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-17, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Runs 10-17, flagged in case future branding work wants it.

## Run 19 — 2026-07-12

Read this file fully before starting. Local checkout was HEAD-detached at
Run 18's last commit (`b60590e`), already equal to `origin/main` (0 commits
behind) - same recurring pattern as every prior run. Checked out a tracking
`main` branch pointed at it, no fast-forward needed. Re-verified from a
clean `npm install` (removed `node_modules` first): `build`, `lint`,
`typecheck`, `test` (94/94) all pass clean before touching anything.

### Task A - still correctly ruled out (Run 1). Not re-investigated this
run; nothing prompted a re-check.

### Task C - re-verified all 4 roadmap items directly against current
code, via four parallel sub-agents each independently re-verifying one
item from scratch (not trusting this file's prior claims blindly); every
result matched what Runs 10-18 already established, no drift on any item

1. **Item 1 (SIWN)** - re-grepped every `ZUKE_ADMIN_PASSWORD` consumer:
   still exactly `session.ts:48-53`'s explicitly opt-in legacy fallback
   block (only activates if the env var is set). Every admin-gated route
   (agent-join, delete-webhook, register-webhook, mark-ended, end-space,
   `/api/juke/space`, `/admin`, `/admin/login`) still checks
   `getSessionData().isAdmin`, resolved via SIWF + `ZUKE_ADMIN_FIDS` at
   login. `JUKE_CREATE_PASSWORD` confirmed still a distinct, intentional
   mechanism for `/live/create`, not conflated with the deprecated admin
   password. `setup-zuke.md`'s roadmap still correctly omits this item.
   No change.
2. **Item 2 (signer)** - re-read `src/lib/publish/auto-cast.ts` in full:
   still an unconditional stub (logs, returns `null`, zero conditional
   logic). Repo-wide grep for "signer" still turns up zero real credential
   references anywhere - only the honest stub-caveat text every prior run
   found. `jukeIntegrationManifest.ts`'s `recap-cast`/
   `recap-cast-room-finished` entries and the ASCII diagram still honestly
   caveat "wiring shipped, posting not yet live." Confirmed still blocked
   on a @thezao Farcaster signer credential this sandbox cannot provision
   or fake. No change.
3. **Item 3 (custom domain)** - `getBaseUrl()`'s doc comment still
   correctly states production serves on `zuke.thezao.com` (no stale
   "before it lands" language). Repo-wide grep for `zaoos.com`/`localhost`
   in `src/`: zero real hits (only this log's own history and a legitimate
   test-file `localhost`). Every consumer (webhook handlers, register-
   webhook route, `AuthKitWrapper.tsx`'s SSR fallback, the manifest's
   hardcoded URLs, `juke-status/page.tsx`'s reference snippet) still
   consistently targets the custom domain. `setup-zuke.md`'s roadmap still
   correctly omits this item, with `NEXT_PUBLIC_SITE_URL` still documented.
   No change needed - remains verified-done.
4. **Item 4 (branding)** - `public/` still only the five unmodified
   create-next-app SVGs, none referenced in `src/`. `favicon.ico` md5
   still `c30c7d42707a47a3f4591831641e50dc` - byte-identical to Runs
   10-18's check, still the stock Next.js default. Fresh grep for stray
   "ZAO" mislabeling on product surfaces: every hit is a legitimate
   reference to the ZAO org/community, not the Zuke product itself. Root
   layout and per-page metadata (`/admin`, `/admin/login`, `/live/create`)
   all still use `zukeConfig.name`, not boilerplate. **No new gap; the
   logo/favicon asset is still the one documented missing piece, still
   needs a human-provided design asset.**

All 4 roadmap items remain exactly where Runs 10-18 left them: items 1 and
3 done, item 2 blocked on an external credential, item 4's code-side gap
already fixed with the design-asset gap itself still real and outside this
sandbox's control. Given nine consecutive fully-stable re-verifications
(Runs 10-18, now 19) with zero drift on any of the four items, future runs
can treat a quick re-grep/re-check of each item's key signal (the
`ZUKE_ADMIN_PASSWORD` consumer list, the `auto-cast.ts` stub body, the
`zaoos.com`/`localhost` grep, the favicon md5) as sufficient confirmation
rather than a full from-scratch sub-agent dispatch per item every run,
unless a commit that run actually touches the relevant surface.

### Fallback Task B sweep - one real, verified finding, fixed

Dispatched one Explore sub-agent into fresh territory Run 18 hadn't
covered (config/toolchain files were Run 18's rotation; this run's targets
were `src/middleware.ts` existence, env template files, the full webhook
handler bodies cross-checked against the manifest/README, a fresh read of
`src/lib/auth/nonce.ts` + all of `src/app/api/auth/**`, `docs/` in full,
the last 10 commits' claims vs. docs, and a full `src/components/**`
listing for anything not yet individually checked). Six of seven areas
came back clean; explicitly excluded `jukeIntegrationManifest.ts`'s
dedicated close-read per Run 17's still-standing pause recommendation
(no commit this run touched webhook handlers, the provider registry,
create-space fields, or admin routes, so no targeted grep-check was
needed either). One real finding, independently re-verified against the
actual code myself before fixing, per instructions:

1. **`src/lib/env.ts`'s `NEYNAR_API_KEY` docstring and
   `setup-zuke.md:41`'s env var list both undersold this var's actual
   scope.** Both described it as feeding only the recap pipeline
   (`GET /api/recordings/recap`). Verified directly: `src/app/api/auth/
   verify/route.ts:25-49`'s `fetchNeynarProfile` (called at line 107) is a
   second, independent consumer - it resolves the signed-in admin's
   Farcaster username/PFP for the session at SIWF login time, reading
   `process.env.NEYNAR_API_KEY` directly rather than through the `ENV`
   object (`recap/route.ts` correctly uses `ENV.NEYNAR_API_KEY`). Unset,
   this path degrades gracefully too (falls back to `fid:{fid}` as the
   display name, `verify/route.ts:107-111`) - a behavior neither doc
   mentioned at all. Fixed both `env.ts`'s docstring and
   `setup-zuke.md`'s var description + added prose paragraph to name both
   consumers and their independent fallback behavior. Commit `6d3f87f`.

   Everything else the sub-agent checked - `middleware.ts` (still
   confirmed absent), env template files (still none committed, matching
   `.gitignore`), the full webhook handler bodies for every event case
   against the manifest/README claims, `docs/recap.md` against
   `recap/route.ts`, the last 10 commits' claims (package.json rename,
   `tsx` devDependency, `@neynar/nodejs-sdk` removal) against every doc,
   and `AdminLoginButton.tsx` (the one component not yet individually
   named in a prior run's findings, but carries no docstrings/prose claims
   to be false) - held up on independent verification or had nothing to
   check.

All of build, lint, typecheck, and test (94/94) pass clean as of the last
commit this run. Pushed to `origin/main`.

### Explicitly not touched (confirmed blocked on someone outside this
codebase - same three as every prior run)

- `JUKE_USER_TOKEN` refresh flow
- Recurring-event cron
- Agent-in-Juke/ZOE auto-join (specifically the *unattended*/auto-join
  piece - unchanged since Run 13, still blocked on both the VPS-side
  session-token consumer and `allow_agents` not being exposed on the real
  create path, per Run 16)

### For the next run

- All 4 roadmap items remain in the same state Runs 10-18 left them: items
  1 and 3 done, item 2 blocked on a @thezao Farcaster signer credential,
  item 4's code-side gap fixed with the logo/favicon design asset itself
  still the one open piece. **Nine consecutive runs (10-18, now 19) have
  found zero drift on any of the four items** - a lighter-weight re-check
  (targeted grep/read of each item's key signal, not a full sub-agent
  dispatch per item) is a reasonable default going forward unless a commit
  actually touches the surface an item depends on.
- `jukeIntegrationManifest.ts`'s dedicated close-read sub-agent is still
  correctly paused per Run 17's recommendation - resume it only if a
  future commit touches webhook handlers, the provider registry,
  create-space fields, or admin routes (do a targeted grep-check of the
  manifest's corresponding claim first), or once enough runs have passed
  that a fresh full read is cheap insurance again.
- `NEYNAR_API_KEY`'s two independent consumers (recap pipeline, SIWF
  admin login) are now correctly documented in both `env.ts` and
  `setup-zuke.md`. Worth noting for any future run touching either
  consumer: `verify/route.ts` reads `process.env.NEYNAR_API_KEY` directly
  instead of through the `ENV` object like every other consumer in the
  codebase - a minor inconsistency (not a false claim, so not fixed as
  part of this run's finding), worth a look if a future run wants to
  normalize env-var access patterns.
- The two adjacent product questions from Run 16/17 (`allowAgents`
  default, `record` default on `/live/create`) still need a human
  decision, not invented code - unchanged this run.
- `getSupabaseBrowser` (`src/lib/db/supabase.ts`) is still real, working,
  unused code - same note as Runs 8-18, still a product/scope call.
- `zukeConfig.brandColor` is still defined with zero consumers - same note
  as Runs 10-18, flagged in case future branding work wants it.
