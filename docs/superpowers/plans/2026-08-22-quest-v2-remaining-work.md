# Quest Esports V2 — Remaining Work Plan

> Companion to `docs/superpowers/plans/2026-08-22-quest-v2-architecture-discovery.md`
> (the 40-section discovery plan) and
> `docs/superpowers/plans/2026-08-22-quest-v2-architecture-discovery-prompt.md`
> (the validated Part 0 baseline).
>
> This document covers only what those two do **not**: the discovery gaps they
> deferred, the corrections they now need, and the execution order for what is
> genuinely left. It does not restate the 32 task specifications.

**Status as of 2026-08-22:** 32 planned tasks. **2 are complete**
(`V2-P0-001` pending merge, `V2-P1-002` merged). **30 remain.** Six discovery
gaps block or degrade the first three phases and are not covered by any existing
task.

---

## 0. Corrections required to the existing plan documents

These are factual errors in the two companion documents. Fix them before any
agent executes from them, or the agent will do redundant or wrong work.

### C-1 — `V2-P1-002` is already done and merged (HIGH)

Cluster-safe realtime shipped. Evidence:

- `backend/src/modules/realtime/realtime.transport.js` — Upstash Redis pub/sub
  transport with reconnect backoff (`REALTIME_PUBSUB_RECONNECT_BASE_MS`,
  `..._MAX_MS`) and payload caps (`REALTIME_PUBSUB_MAX_MESSAGE_BYTES`).
- Commits `9579994` "feat: fan out realtime events across workers" and
  `9b90b2e` "feat: make SSE reconnects reconcile state", plus ~13 hardening
  commits through `3719d22`.
- Tests: `backend/tests/realtime.transport.test.js`,
  `realtime.cluster.integration.test.js`, `realtime.service.test.js`,
  `realtime.controller.test.js`.
- Operations: `backend/scripts/realtime-cluster-smoke.js`, documented at
  `docs/production-runbook.md:166`.
- Its own plan: `docs/superpowers/plans/2026-08-22-realtime-cluster-safe-implementation.md`.

The task's acceptance criterion — "an event published on worker A reaches
clients on worker B" — is met.

**Actions:**
1. Mark `V2-P1-002` **DONE** in §34 of the discovery plan.
2. Remove the "PM2 SSE split-brain — Confirmed today" row from the §38 risk
   register, or restate it as a regression risk with the smoke script as control.
3. **Ungate Phase 7.** §33 says broadcast comes "only after shared fan-out/replay
   or durable polling is proven." It is proven. Phase 7 no longer depends on
   Phase 1.
4. Correct constraint **0.4-1** in the prompt document. It reads the process-local
   `EventEmitter` in `realtime.service.js` in isolation; the fan-out lives in
   `realtime.transport.js`. Restate as: *fan-out requires Upstash; verify
   `CACHE_DRIVER`/Upstash availability wherever `API_PROCESS_COUNT > 1`.*

### C-2 — Frontend route list is incomplete (LOW)

§3 claims 67 routes and enumerates 66. Missing: `/admin/event-albums`
(`frontend/app/admin/event-albums/page.tsx`).

### C-3 — `/admin/valorant/*` finding supersedes the prompt baseline (LOW)

The discovery plan's MEDIUM ("broadly admin-protected, not scoped; no
missing-auth defect confirmed") is correct and supersedes the prompt's
Part 1.5 phrasing, which suspected missing middleware. Update Part 1.5 so a
future reader does not re-open a closed question.

---

## 1. Track A — Close the discovery gaps

The discovery plan's stated purpose is that Codex should not need to rediscover
the architecture. Sections 3–5 do not meet that bar, and three investigations
were framed rather than answered. These six tasks close that, and several are
hard prerequisites for Phase 2.

Task IDs continue the existing convention under a new `V2-A` (audit) prefix so
they do not collide with the 32 numbered tasks.

### V2-A-001 — Complete the frontend route map

- **Objective:** Turn §3's path list into a per-route table.
- **Why:** Codex currently has to open every file to learn what a route does.
- **Columns:** path · source file · main component · data source (which
  `frontend/lib/*` fetcher or server action) · SSR/CSR/hybrid · auth requirement
  · loading/error behaviour · notes on duplication.
- **Method:** Read-only pass over the 67 `page.tsx` files under `frontend/app/`;
  cross-reference `frontend/app/*/codemap.md`.
- **Output:** Replaces §3 of the discovery plan.
- **Flag:** any route whose auth requirement is enforced only client-side.
- **Dependencies:** none. **Blocks:** Phase 3, Phase 6.

### V2-A-002 — Complete the backend API map

- **Objective:** Turn §4's module list into a per-endpoint table.
- **Columns:** method · route · handler · service · Prisma models touched ·
  auth middleware · authorization check · response shape · known consumers
  (web / mobile-admin / external).
- **Method:** `backend/src/routes/v1.js`, `backend/src/routes/index.js`, and the
  26 module routers. Cross-check against `backend/src/lib/openapi.js` and
  `docs/api-documentation.md` — and **report any drift between them**, which is
  itself a finding.
- **Flag:** endpoints whose consumer set includes `mobile-admin/`, since those
  constrain every later API change.
- **Dependencies:** none. **Blocks:** Phases 3–7 task specification accuracy.

### V2-A-003 — Produce the current-state entity relationship map

- **Objective:** §5 groups models by line range but never shows relationships.
- **Deliverable:** a relationship diagram (mermaid, per `AGENTS.md` conventions)
  covering the identity, competition, registration, and operations clusters —
  plus an explicit list of where the current schema conflates concepts.
- **Method:** derive from `backend/prisma/schema.prisma` only.
- **Dependencies:** none. **Blocks:** `V2-P2-001`, `V2-P2-002`.

### V2-A-004 — Duplicate-player census (blocks Phase 2)

- **Objective:** Quantify the duplicate-identity surface. The discovery plan
  designs a probabilistic backfill (`userId` → `emailNormalized` → normalized
  Riot ID) but contains **no numbers**, so Phase 2's risk is unsized.
- **Why:** the §38 risk register rates "incorrect player merge joins two people"
  as Medium/Critical. That probability is currently a guess.
- **Implementation:** a **read-only** script,
  `backend/scripts/player-identity-census.js`, following the established
  preview/apply convention of `backend/scripts/data-hygiene.js` — **preview
  only, no `--apply` path in this task.**
- **Report:** distinct identity rows across `User`, `SavedTeamMember`,
  `RegistrationMember`, `TeamRegistration.captainRiotId`; counts of exact and
  case-normalized `emailNormalized` collisions; `riotId` collisions after
  normalization; rows with `userId` populated vs null; rows matchable by no key
  at all; and the estimated manual-merge queue depth.
- **Run against:** the isolated test database or a restored production backup —
  **never production directly.**
- **Security:** aggregate counts only. No emails, Riot IDs, or names in output.
- **Acceptance:** the merge-queue estimate is concrete enough to accept or
  reject `V2-P2-003`'s tooling scope.
- **Dependencies:** none. **Blocks:** `V2-P2-001` through `V2-P2-004`.

### V2-A-005 — Complete the audit coverage matrix

- **Objective:** §25 says coverage is "incomplete **or not evidenced**" — the
  question was framed, not answered.
- **Deliverable:** one row per privileged mutation — operation · handler ·
  writes `AuditLog`? · in the same transaction? · before/after captured? · gap
  severity. Cover at minimum: registration status change (known covered,
  `backend/src/modules/admin/admin.service.js:89-110`), roster edits, payment
  reconciliation, bank-transfer proof review, veto overrides/rewind/reset,
  Valorant bind/detach/finalize, staff assignment, tournament publish, and
  slot reservation.
- **Dependencies:** V2-A-002 helps. **Feeds:** `V2-P0-003` (converts it from
  discovery into implementation).

### V2-A-006 — Confirm the participant projection query plans

- **Objective:** §27 explicitly defers: "the mapper itself does not query, but
  callers must avoid broad Prisma includes… **Confirm query plans before calling
  this an N+1.**"
- **Method:** enable Prisma query logging against the test database, load
  `/tournaments/[slug]` for the largest tournament, and capture the actual query
  count and payload size for `registeredParticipants`
  (`backend/src/modules/tournaments/tournament.service.js:709-740`) and for
  album detail (`backend/src/modules/media/event-album.service.js:169-184`).
- **Acceptance:** `V2-P0-002` gets a real baseline number to improve against,
  or is closed as unnecessary.
- **Dependencies:** none. **Feeds:** `V2-P0-002`.

---

## 2. Track B — Land `V2-P0-001`

The work is done and green in the working tree; it is unmerged and one check
short.

Current state on `main` (uncommitted):

| File | Change |
|---|---|
| `frontend/lib/tournaments.ts` | drops `registrationAction`, `isRegistrationOpen`, `isSlotsFull`, `isWaitlistOpen`, `isRegistrationClosed` from the `Tournament` type |
| `frontend/lib/event-utils.ts` | adds `getEventCardPresentation` |
| `frontend/components/home/FeaturedTournaments.tsx` | consumes it |
| `frontend/components/tournaments/TournamentsContent.tsx` | consumes it |
| `frontend/tests/unit/tournament-status-contract.test.ts` | 6 cases covering every acceptance criterion |
| `frontend/tests/unit/tournament-registration-form.test.tsx` | updated |

Verified: `npm run lint` clean · `npm run typecheck` clean · `npm test`
220 passed / 39 files.

**Remaining steps:**
1. Run `npm run test:e2e:local` — the only unrun gate in the task's test list.
2. Branch `fix/tournament-registration-state-contract` (per §39).
3. Confirm the backend projection still emits the removed booleans for
   `mobile-admin/` and any other consumer before deleting them from the type —
   removing them from the TS type is safe, but confirm nothing else reads them.
4. Open the PR. No schema, API, auth, or payment change; rollback is a revert.

---

## 3. Track C — The remaining 30 tasks

Sequencing from the discovery plan holds, with two changes.

### Revised phase graph

```
Track A (A-001…A-006) ──┬─► Phase 0 (P0-002, P0-003, P0-004)
                        │
Track B (P0-001) ───────┘
                              │
                              ▼
                        Phase 1 (P1-001, P1-003)     [P1-002 DONE]
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        Phase 2          Phase 5         Phase 7
     (identity, ×4)   (LAN ops, ×5)   (broadcast, ×3)
              │               │               │
              ▼               ▼               │
        Phase 3          Phase 6              │
     (profiles, ×3)   (control centre, ×2)    │
              │               │               │
              ▼               └───────┬───────┘
        Phase 4                       ▼
   (registration, ×4)           Phase 8 (community, ×4)
```

### Change 1 — Phase 7 is unblocked

C-1 removes the realtime dependency. Broadcast can now run in parallel with
Phases 2–5 rather than waiting behind them. It still depends on nothing but
Phase 1's permission work, since overlays are read-only.

This matters: broadcast was the longest pole in the original sequence and is
the most externally visible. It can start now.

### Change 2 — Phase 5 no longer waits on Phase 2

LAN operations (venues, stations, check-in, referee panel, typed results,
disputes) touch `Match`, `TournamentStaffAssignment`, and new tables. None of
them require `Player`. The discovery plan already notes Phases 3 and 5 are
independent; the stronger statement is that **Phase 5 only needs Phase 1**, so
it can begin while the identity census (V2-A-004) is still running.

Given that Quest runs physical LANs and the check-in/referee gap is
operationally live, this is the highest-value parallel track.

### Critical path

The long pole is now identity, not broadcast:

```
V2-A-004 → P2-001 → P2-002 → P2-003 → P2-004 → P3-001 → P3-002 → P4-003
```

~~`V2-P2-004` additionally depends on an **external** unblock~~ — **RESOLVED
2026-08-23; this dependency does not exist.** Two facts invalidate it:

1. The upstream is no longer `valorantsl-new`. It was ported into
   `valorant-platform-backend`, a sibling repository under the same owner.
2. The Discord-ID↔PUUID contract is already implemented there.
   `leaderboard_players.discord_id` is `TEXT NOT NULL DEFAULT ''` with a
   **partial unique index** on `discord_id <> ''`
   (`app/db/models/leaderboard_player.py`), and both
   `POST /api/v1/auth/check-discord` and `POST /api/v1/auth/check-puuid` are
   live and service-token gated. `workers/discord_bot.py` writes identity
   corrections back through
   `LeaderboardPlayerRepository.update_discord_identity`.

**`V2-P2-004` has no external blocker and Stream 3 is gated on the census
alone.** Detail in `2026-08-23-quest-identity-and-riot-linking-plan.md` §A.3 C-2.

### Recommended parallel streams

| Stream | Tasks | Prerequisite |
|---|---|---|
| 1. Merge + audit | B, V2-A-001…006, P0-002, P0-003, P0-004 | none |
| 2. LAN operations | P1-001, then P5-001…005, P6-001, P6-002 | P1-001 |
| 3. Identity | V2-A-004, P2-001…004, P3-001…003, P4-001…004 | V2-A-004 only (upstream contract resolved) |
| 4. Broadcast | P7-001, P7-002, P7-003 | P1-001 |
| 5. Community | P8-001…004 | Phases 3 and 5 |

Streams 2 and 4 can start as soon as `V2-P1-001` (scoped tournament
permissions) lands. Stream 3 is gated on the census alone.

---

## 4. Immediate next actions

1. Apply corrections **C-1**, **C-2**, **C-3** to the two companion documents.
2. ~~Open the upstream Discord-ID↔PUUID contract question~~ — **done; the
   contract already exists in `valorant-platform-backend`.** See the critical-path
   note above.
3. Run `npm run test:e2e:local`, branch, and PR `V2-P0-001` (Track B).
4. Start `V2-A-004` (census) and `V2-A-002` (API map) — the two gap-closures
   that block the most downstream work.
5. Schedule `V2-P1-001` (scoped tournament permissions), which unblocks both
   the LAN and broadcast streams.

## 5. Open questions this plan does not resolve

The discovery plan's §40 questions 2–10 remain open and are unchanged. Question
8 ("is Upstash guaranteed in every PM2 deployment where SSE is enabled") is
**partially answered** by C-1: `backend/src/config/env.js:426-430` already
enforces `CACHE_DRIVER=upstash` when `API_PROCESS_COUNT > 1`, so the guarantee
is configuration-enforced. Confirm the production environment satisfies it
before Phase 7 ships overlays.
