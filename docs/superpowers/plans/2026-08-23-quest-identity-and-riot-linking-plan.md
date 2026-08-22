# Quest Esports — Player Identity & Riot Account Linking

**Date:** 23 August 2026
**Supersedes:** `quest-platform-development-plan.md` (19 Aug 2026 handoff draft)
**Companions:** `2026-08-22-quest-v2-architecture-discovery.md` (32 numbered V2 tasks),
`2026-08-22-quest-v2-remaining-work.md`, `docs/valorant-integration.md` (as-built)

This is the 19 Aug handoff document rewritten against the actual state of
`QuestEsports` and the sibling `valorant-platform-backend` repository. Roughly
half of the original document described work that is already shipped, and two of
its core assumptions were wrong. Sections below are ordered so they can be
executed one at a time.

---

## Part A — What the repos actually say

### A.1 Confirmed by inspection (the original plan was right)

| Claim | Evidence |
|---|---|
| Riot IDs are unvalidated free text | `TeamRegistration.captainRiotId` (`schema.prisma:950`), `RegistrationMember.riotId` (`:1329`), `SavedTeamMember.riotId` (`:1502`) — three separate `String?` columns, no constraint, no external ID |
| No generic game-account model exists | No `GameAccount`/`Player` model in 2,002 lines of `schema.prisma`; identity is `User` + `OAuthAccount` only |
| Two-backend separation is the intended shape | Already built and documented in `docs/valorant-integration.md` |
| "Account found" is not "user owns it" | Correct, and stronger than the plan states — see A.3 |
| Registration snapshots matter | `RegistrationMember` is already a per-registration roster copy, but it snapshots *free-text* `riotId`, not a stable ID, and nothing locks it |

### A.2 Already shipped — remove from scope

| Original section | Status |
|---|---|
| §9 Backend separation, §21 service networking | **Done.** Quest Express to FastAPI over `VALORANT_INTERNAL_BASE_URL`, HMAC-SHA256 service token (`kid`-selected secret, 300 s TTL, actor + `operation_id` claims), one Supabase project / two owned schemas (`public` Prisma, `valorant` FastAPI), no cross-schema FKs, CI-enforced in both directions |
| §9 "verify port 8000" | **Answered.** `:8000` is the *local dev* port only. Production is a private-network origin from `VALORANT_INTERNAL_BASE_URL` with HTTPS asserted at boot (`backend/src/config/env.js:517-525`). `GET /api/v1/health` is the only unauthenticated FastAPI route |
| §22 VALORANT backend endpoints | **All three already exist**: `POST /api/v1/players/resolve` (Name#Tag to PUUID + current name/tag/affinity/platforms), `GET /api/v1/players/{id}`, `GET /api/v1/players/by-puuid/{puuid}`. Plus `POST /api/v1/register/preview` (rank, peak, last played) and `POST /api/v1/auth/check-puuid` / `check-discord` |
| §31 Phase 2 "clean account connections" | **Done.** `2026-08-19-valorant-oauth-account-linking.md` shipped: `OAuthLinkNonce`, `User.passwordSetAt`, `GET /auth/oauth/providers`, `DELETE /auth/oauth/:provider` with last-login-method protection, serializable unlink |
| §17 Tracker.gg | **Decided and shipped as the plan recommends.** Profile *links* only, never a dependency — `frontend/lib/valorant.ts:153-157` builds a `tracker.gg` URL from cached name/tag. Close the question |
| §16 audit logging | **Foundation exists and was just hardened.** `AuditLog` (actor/action/target/before/after/requestId/IP) plus the 8-commit coverage wave `afa808c`…`dbf2387`. New work extends the helper; it does not build one |
| §34 observability, realtime | Cluster-safe SSE shipped (`realtime.transport.js`, Upstash pub/sub, `backend/scripts/realtime-cluster-smoke.js`) |

### A.3 Corrections — the plan is wrong here

**C-1 — Riot ownership cannot be proven at all today. There is no RSO.**
`valorant-platform-backend` talks to exactly one upstream: HenrikDev
(`app/integrations/henrik/client.py`). There is no Riot Sign-On client, no Riot
OAuth credentials in `.env.example`, nothing. Henrik proves an account *exists*;
it can never prove the Quest user holds it.

The original §8 state list therefore promises a state that is unreachable. Use
this instead — and never label anything above what was actually proven:

```text
UNLINKED
RESOLVED               Henrik returned a PUUID for the submitted Name#Tag
USER_CONFIRMED         the signed-in Quest user clicked "this is mine"
DISCORD_CORROBORATED   the PUUID is already paired to this user's Discord ID upstream (see C-2)
ADMIN_VERIFIED         a human checked evidence
REVOKED
```

`OWNERSHIP_VERIFIED` is deleted from the model until Riot RSO exists. If it is
ever added, it is a new state, not a renamed one.

**C-2 — The "external unblock" in the remaining-work plan is stale. It is already done.**
`2026-08-22-quest-v2-remaining-work.md` §3 calls the upstream Discord-ID/PUUID
contract "the longest lead time of anything in this plan" and tells you to open
it with the `valorantsl-new` owner. That is out of date on two counts:

1. The upstream is no longer `valorantsl-new` — it was ported into
   `valorant-platform-backend`, which you own.
2. The contract already exists. `leaderboard_players` carries
   `discord_id TEXT NOT NULL DEFAULT ''` with a **partial unique index** on
   `discord_id <> ''` (`app/db/models/leaderboard_player.py`), and both
   `POST /api/v1/auth/check-discord` and `check-puuid` are live. The Discord bot
   worker even writes identity corrections back
   (`workers/discord_bot.py` calling `LeaderboardPlayerRepository.update_discord_identity`).

**Consequence: `V2-P2-004` is unblocked and Phase 2 has no external dependency.**
This is the single biggest scheduling change in this document.

**C-3 — Dockerization should not go first, and probably should not go at all yet.**
The original §20/Phase 1 puts Dockerization ahead of everything. Neither repo
contains a Dockerfile or compose file. What exists instead is a working, audited
deploy path: PM2 on the API VPS via `.github/workflows/cd.yml` gated by
`MIGRATION_APPROVAL_SHA` (and `DESTRUCTIVE_MIGRATION_APPROVAL_SHA`), Vercel for
the frontend, systemd units and eight backup/restore/recovery scripts under
`ops/`, and `ops/restore-production-backup.sh` as the tested rollback.

Containerizing means re-pointing all of that at a new runtime. It buys nothing
for identity work — the two services already reach each other through a
configured internal base URL, not `localhost` assumptions. **Recommendation:
demote to Section 10 (optional), and if it happens at all, scope it to local-dev
parity first, never production-first.** This is a real disagreement with the
handoff document; the call is yours, but make it with the cost stated.

**C-4 — Discord invitations need a Quest-side bot that does not exist.**
There *is* a Discord bot (`valorant-platform-backend/workers/discord_bot.py`),
but it is a rank-role/nickname worker for the VALORANT-SL guild operating on
`leaderboard_players`. It has no Quest user context and cannot deliver team
invitations. §12 is genuinely unbuilt.

**C-5 — Security finding: the leaderboard registration proxy is unauthenticated and unthrottled.**
`backend/src/routes/v1.js:140-144` mounts five `/valorant/leaderboard/register/*`
routes with **no `requireAuth` and no rate limiter**, and they proxy straight
through to Henrik-backed upstream endpoints. Any anonymous caller can burn the
upstream Henrik budget and enumerate PUUID/Discord existence. Fix this before
adding a second, richer resolve path on top (Section 3).

**C-6 — Fold into the existing V2 task IDs; do not start a parallel scheme.**
The 19 Aug document's Phase 0–10 duplicates roughly 70% of the V2 discovery plan,
which already has 32 numbered tasks, reserved migration names, a risk register,
and a phase graph. Sections below map onto those IDs rather than renumbering.

---

## Part B — The sections, in execution order

Each section is independently mergeable, has at most one migration, and ships on
its own branch and PR. Migration PRs stay separate from the code that reads the
new columns.

---

### Section 0 — Apply the corrections to the planning documents

**Do this first; it is 30 minutes and it stops the next agent doing dead work.**

- Mark `V2-P1-002` DONE in §34 of the discovery plan (already flagged as C-1 there).
- In `2026-08-22-quest-v2-remaining-work.md` §3 and §4.2, replace the
  "open the upstream contract with the `valorantsl-new` owner" action with C-2
  above: the contract exists in `valorant-platform-backend`. Remove it from the
  critical path.
- Record C-1 (no RSO) in the discovery plan §11 so no later task promises
  ownership verification.
- Add `/admin/event-albums` to the §3 route list (the 67th route).

**Done when:** the three planning docs agree with each other and with the repos.
**Depends on:** nothing.

---

### Section 1 — Close the unauthenticated upstream proxy (C-5)

**Branch:** `fix/leaderboard-register-proxy-guards`

The five `/valorant/leaderboard/register/*` routes are the only public path into
the Henrik-backed upstream. Harden them before widening the surface.

- Decide per route: `check-puuid`, `preview`, and `submit` should require
  `requireAuth`; the Discord `login`/`callback` pair keeps its OAuth-flow
  exemption but gains a limiter.
- Add a dedicated limiter in `backend/src/middleware/rate-limit.js` for the
  upstream-proxy group. Existing limiters do not cover `/valorant/*` at all.
- Confirm the public registration page (`/valorant-leaderboard/register`) still
  works end to end, or intentionally require sign-in there.
- Never surface upstream error text to the browser — `client.js`
  `propagateUpstreamError` already maps; assert it in a test.

**Files:** `backend/src/routes/v1.js`, `backend/src/middleware/rate-limit.js`,
`backend/src/modules/valorant-leaderboard/controller.js`, tests.
**Done when:** anonymous callers get 401/429, the register page flow passes, no
upstream detail leaks.
**Depends on:** nothing. **Blocks:** Section 3.

---

### Section 2 — Player + GameAccount schema (migration only)

**Branch:** `feat/player-game-account-schema`
**V2 task:** `V2-P2-001` · **Migration:** `20260822110000_add_players_and_game_accounts`

Additive tables only. No backfill in the migration, no reader in this PR.

```text
Player
  id            uuid pk
  publicId      QPID-000001 sequence, unique
  userId        uuid? -> User (nullable: unclaimed/guest players exist)
  displayName, createdAt, updatedAt

GameAccount
  id                 uuid pk
  playerId           uuid -> Player
  game               enum (VALORANT, ...)   -- extensible, not a VALORANT column
  externalId         text                   -- PUUID for VALORANT
  username, tagline, region                 -- CACHED DISPLAY ONLY
  verificationStatus enum (see C-1 state list)
  verifiedAt, linkedAt, lastSyncedAt
  status             enum (ACTIVE, CHANGE_REQUESTED, LOCKED, REPLACED, REVOKED)
  metadata           jsonb
  @@unique([game, externalId])              -- one Quest player per game account
```

Constraints carry the integrity rules, not app code:

- `@@unique([game, externalId])` — the abuse boundary from §13/§24.
- Partial unique on `(playerId, game)` where `status = ACTIVE` — one active
  account per game per player.
- `externalId` normalized on write (case, trim) so uniqueness is real.

**Do not touch** `SavedTeamMember.riotId`, `RegistrationMember.riotId`, or
`TeamRegistration.captainRiotId` in this PR. They stay as legacy display data
permanently.

**Done when:** the migration applies and rolls forward cleanly on a restored
backup; `npm run prisma:security:verify` and `verify-prisma-schema-scope.js` pass.
**Depends on:** Section 0. **Blocks:** Sections 3–7.

---

### Section 3 — Authenticated Riot resolve endpoint

**Branch:** `feat/riot-account-resolve`
**No FastAPI work required** — `POST /api/v1/players/resolve` already exists.

Quest side only:

- Reuse `backend/src/modules/valorant/valorant.validation.js` `parseRiotId` /
  `normalizeRiotId` (already written, already tested) — do not write a second parser.
- Add a user-facing (not admin-only) resolve route under `/api/v1` behind
  `requireAuth` plus the Section 1 limiter, calling FastAPI `players/resolve`
  through the existing signed client.
- Cache resolve results briefly (the open question "how long" — start at 5 min,
  keyed on normalized `name#tag`) so debounced typing does not multiply upstream calls.
- Map upstream failures honestly. `PLAYER_NOT_FOUND` gives "check the Riot ID";
  timeout/5xx/429 gives "couldn't verify right now, try shortly". **Never report
  not-found when the upstream is down** — `VALORANT_ERROR_MESSAGES` in
  `valorant.client.js:37-38` already distinguishes these; keep that separation.
- Optionally enrich with `POST /api/v1/register/preview` for rank/peak, but only
  as a non-blocking add-on: registration must never fail because stats are absent.

**Done when:** an authenticated user can resolve `Name#Tag` to PUUID plus current
name/tag/affinity, with distinct not-found vs unavailable states, rate limited
and cached.
**Depends on:** Sections 1, 2.

---

### Section 4 — Link, confirm, and the profile UI

**Branch:** `feat/valorant-account-linking`
**V2 task:** `V2-P2-002`

- `POST /game-accounts/valorant/link` takes the PUUID the server resolved (not a
  client-supplied one; re-resolve server-side before writing) and creates the
  `GameAccount` at `USER_CONFIRMED`.
- Duplicate handling: the `(game, externalId)` unique index is the boundary.
  A collision returns a clear conflict, never a silent re-parent. Log it
  (`game account link rejected duplicate`) without logging the PUUID if policy
  forbids it — the discovery plan's redaction rule applies.
- Upgrade path: after linking, check `POST /api/v1/auth/check-discord` against
  the user's `OAuthAccount(discord).providerUserId`. If upstream already pairs
  that Discord ID to the same PUUID, promote to `DISCORD_CORROBORATED`. This is
  the strongest signal available without RSO (C-1, C-2).
- Profile UI on `/profile` account tab, beside the existing OAuth panel:
  debounced lookup, loading state, the found-account confirmation card, explicit
  state labels ("Confirmed by you", not "Verified"), and the tracker.gg link
  from `frontend/lib/valorant.ts` as an optional flourish.
- `GET /users/me/game-accounts` for the panel and for Section 5.

**Done when:** a player links VALORANT from their profile, sees accurate state
wording, and a second user cannot claim the same PUUID.
**Depends on:** Section 3.

---

### Section 5 — Registration consumes the linked account

**Branch:** `feat/registration-reads-game-accounts`
**V2 task:** `V2-P4-001` · **Migration:** `20260822120000_add_player_links_to_rosters`

Two PRs: the nullable `playerId` columns on `SavedTeamMember` /
`RegistrationMember` first, the reader second.

- Server-computed readiness — the §26 idea, and the right one. One authoritative
  endpoint (`GET /teams/{id}/registration-readiness`) returning typed requirement
  results (`ROSTER_SIZE`, `INVITES_ACCEPTED`, `PLAYER_GAME_ACCOUNTS`,
  `ELIGIBILITY`). The frontend renders it; it does not recompute it. This is the
  same discipline as `registration-state.js` and avoids repeating the
  `V2-P0-001` two-sources-of-truth bug.
- The captain's roster screen shows per-player Quest / Discord / VALORANT status
  instead of Riot-ID text inputs, and falls back to manual entry only for members
  who have no Quest account.
- Finalization is blocked server-side when readiness fails. The captain bypassing
  the UI and POSTing directly must fail — assert it in a test.
- Legacy `riotId` strings keep rendering for old registrations. Nothing is rewritten.

**Done when:** a fully linked roster registers without the captain typing a
single Riot ID; a roster with a gap cannot finalize by any route.
**Depends on:** Section 4.

---

### Section 6 — Snapshot and lock at finalization

**Branch:** `feat/roster-snapshot-locking`

`RegistrationMember` already snapshots the roster. Extend it so the snapshot is
*competitively* meaningful and immutable:

- At finalization write `externalIdSnapshot`, `usernameSnapshot`, `tagSnapshot`,
  `verificationStatusSnapshot`, `gameAccountId`, and the timestamp onto the
  registration member row.
- Set the linked `GameAccount.status = LOCKED` while the tournament is live.
- Nothing on the profile-edit path may write these columns. Enforce at the
  service boundary and prove it with a test that edits a profile and asserts the
  snapshot is byte-identical.
- Concurrency: finalize inside a transaction; two simultaneous finalizes for one
  team must produce one result.

**Done when:** a player renames on Riot, their profile updates, and the
tournament record still shows exactly what was submitted.
**Depends on:** Section 5.

---

### Section 7 — Account-change requests and admin tooling

**Branch:** `feat/game-account-change-requests`
**V2 task:** `V2-P4-002` · **Migration:** `20260822130000_add_roster_change_requests`

The distinction from §13 is correct and worth keeping exactly as written:

- **Same PUUID, new Riot name/tag** — refresh cached display fields automatically
  on sync. No approval. This is not an account change.
- **Different PUUID** — a `CHANGE_REQUESTED` record, admin review, explicit roster
  update, audit entry with old and new references. Never a silent swap.

The admin surface extends `frontend/app/admin/` (not a parallel tree, per
discovery plan §19): search by Quest account, view linked identities and stable
external ID, review the change queue, approve/reject with reason, inspect roster
snapshots, unlock a registration with a mandatory audit reason.

Audit events go through the existing helper hardened in `afa808c`…`dbf2387`, in
the same transaction as the state change.

**Done when:** no routine identity operation requires editing a database row by hand.
**Depends on:** Section 6.

---

### Section 8 — Legacy Riot data census and migration

**Branch:** `chore/player-identity-census`
**V2 task:** `V2-A-004` — *read-only, preview only, no `--apply`*

The discovery plan sizes this as the Phase 2 risk and correctly notes there are
no numbers yet. Run it against a **restored backup, never production**.

`backend/scripts/player-identity-census.js`, following the existing
`backend/scripts/data-hygiene.js` preview/apply convention. Report aggregate
counts only — no emails, names, or Riot IDs in output:

- distinct identity rows across `User`, `SavedTeamMember`, `RegistrationMember`,
  `TeamRegistration.captainRiotId`
- `emailNormalized` collisions, exact and case-normalized
- `riotId` collisions after normalization
- rows with `userId` populated vs null; rows matchable by no key at all
- estimated manual-merge queue depth

Backfill order stays `userId`, then `emailNormalized`, then normalized Riot ID as
a *candidate only*. Anything uncertain lands as `LEGACY_UNVERIFIED` for the
player to confirm later. **Never auto-merge two people.**

**Done when:** the merge-queue estimate is concrete enough to accept or reject
Section 7's tooling scope.
**Depends on:** Section 2. Can run in parallel with Sections 3–5.

---

### Section 9 — Discord invitations (optional, evaluate first)

**Branch:** `feat/discord-team-invitations`

Genuinely unbuilt (C-4). Before writing code, answer:

- Does Quest run its own bot, or does the existing
  `valorant-platform-backend/workers/discord_bot.py` gain a Quest intent? A
  Quest-side bot is cleaner — that worker is scoped to leaderboard roles and has
  no Quest user context.
- The bot can only DM users who share a guild with it and have DMs open. Plan for
  that failure; do not assume it away.

**Email invitations stay.** They are load-bearing for payments, shop orders,
receipts, account recovery, and transactional mail. Discord becomes a *preferred
channel* with email as fallback — a failed DM must never lose the invitation.

**Done when:** invitations deliver over Discord where possible and silently fall
back, with the pending invite always reachable inside Quest.
**Depends on:** Section 5. Independent of 6–8.

---

### Section 10 — Optional: Dockerization

**Deliberately last. See C-3.** Do not let this block identity work.

If it happens, scope it to local-development parity first — a compose file that
runs Quest Express, the FastAPI service, and Postgres together, matching the
already-documented two-schema topology in `docs/setup-and-deployment.md`.
Production containerization is a separate decision that must first account for
PM2, `cd.yml` approval-SHA gating, the systemd units, and every script in `ops/`.

Non-negotiables if attempted: no secrets baked into images, no production `.env`
committed, no internal port exposed publicly, no database address changed without
a tested restore, and never combined with a registration-logic change in one PR.

---

## Part C — Testing gates

Run per section, not once at the end.

**Regression (every section):** password login, Google login/link, Discord
login/link, existing registrations load, existing teams load, invitations work,
admin functions work.

**Riot parsing (Section 3):** valid `Name#Tag`; missing `#`; empty name; empty
tag; whitespace; unicode; not found; upstream timeout; 429; 5xx. Assert not-found
and unavailable produce *different* user-facing states.

**Integrity (Sections 4, 6, 7):** first link; relink same PUUID after a Riot
rename; PUUID already linked elsewhere; replacement with a different PUUID; admin
approve and reject; tournament history unchanged throughout.

**Registration (Sections 5, 6):** full roster ready; one player unlinked; invite
pending; account changed pre-finalization; change requested post-finalization;
direct API finalize bypassing the UI; admin override.

**Concurrency (Sections 4, 6):** two users linking one PUUID; two finalizes on one
team; roster edit during finalization. Transactions and DB constraints carry
these, not application checks.

---

## Part D — Open questions, reduced

The original §35 listed twelve. Eight are now answered:

| # | Question | Answer |
|---|---|---|
| 1 | Which Riot data source is permitted? | HenrikDev, via `valorant-platform-backend` only |
| 2 | Can Quest prove ownership? | **No.** Resolve + user confirmation + Discord corroboration is the ceiling (C-1) |
| 3 | What stable identifier? | PUUID (`players.puuid`, unique) |
| 5 | Does the VALORANT backend already implement this? | Yes — `players/resolve`, `by-puuid`, `register/preview`, `auth/check-*` |
| 6 | What port/service name? | `:8000` locally; `VALORANT_INTERNAL_BASE_URL` (private, HTTPS-asserted) in production |
| 7 | Is Tracker worth integrating? | Already settled — profile links only, never a dependency |
| 8 | Can Discord deliver invitations? | Only to users sharing a guild with DMs open; needs a Quest-side bot (C-4) |
| 12 | How to migrate legacy Riot IDs? | Section 8 census first, then candidate-only backfill, `LEGACY_UNVERIFIED` for anything uncertain |

Still genuinely open: **(4)** which rank/stat fields may be surfaced publicly
under Henrik's terms; **(9)** the fallback when a user cannot receive Discord
DMs; **(10)** the exact self-service vs admin-approval boundary for account
changes; **(11)** resolve-cache TTL (Section 3 starts at 5 minutes and measures).

---

## Part E — Architectural rule (unchanged, and correct)

```text
QUEST ACCOUNT              the person
DISCORD / GOOGLE / EMAIL   identity, authentication, contact
GAME ACCOUNT               the person inside one specific game, keyed on a stable external ID
TOURNAMENT REGISTRATION    a locked historical snapshot of the competitive identity used for that event
STATS                      attached to stable IDs, never to mutable display names
```

Every section above preserves this separation. It is the reason the model
survives adding CODM, PUBG, or anything else without another user-model rewrite.
