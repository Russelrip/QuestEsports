# Quest Esports V2 — Architecture Discovery & Planning Prompt (validated against the repository, 2026-08-22)

You are acting as the senior software architect for the existing Quest Esports
production platform (https://questesports.lk).

Your job is **not** to implement Quest Esports V2. Your job is to produce a
technically accurate implementation plan that another coding agent (OpenCode +
Codex) can execute incrementally.

This prompt has already been calibrated against the real repository. Part 0
records verified ground truth so you do not waste effort rediscovering it.
**Verify Part 0 before relying on it** — it was accurate at commit `615f121` on
`main` — but do not re-derive it from scratch.

---

## Working rules

- Do not change code, schema, migrations, APIs, auth, or production config.
- Do not rename files. Do not commit unless explicitly instructed later.
- Reference the actual file, model, route, migration, or table for every
  significant finding. If something cannot be found, say so explicitly.
- Do not propose creating a system that already exists. Part 0 lists what
  exists; verify, then extend.
- Follow existing repository conventions:
  - Read the nearest `codemap.md` before analysing a directory
    (`AGENTS.md`, `codemap.md`, `backend/src/modules/*/codemap.md`,
    `frontend/app/*/codemap.md`).
  - Plans go in `docs/superpowers/plans/YYYY-MM-DD-slug.md`; designs go in
    `docs/superpowers/specs/YYYY-MM-DD-slug-design.md`.
  - `backend/prisma/codemap.md` requires additive migrations.
- There are **three** API clients, not two: the Next.js web app, the private
  Expo/Android app in `mobile-admin/`, and the external VALORANT service. Any
  API change must consider all three.

---

# PART 0 — VERIFIED GROUND TRUTH

## 0.1 Stack and deployment

| Layer | Reality |
| --- | --- |
| Frontend | Next.js 16.2 App Router, React 19, Tailwind 4, Zustand, `frontend/` |
| Backend | Express 5, CommonJS, `backend/src/`, entry `backend/src/server.js` → `backend/src/app.js` |
| ORM | Prisma 6.19, `backend/prisma/schema.prisma` (~2000 lines), 66 committed migrations |
| Database | PostgreSQL (Supabase-hosted; Supabase Data API deliberately unused, RLS retained) |
| Third client | Expo/Android admin in `mobile-admin/` using Keystore-backed bearer sessions |
| Frontend deploy | Vercel, `.github/workflows/deploy-frontend.yml` |
| Backend deploy | SSH → VPS → **PM2** restart, `.github/workflows/cd.yml`, manual `workflow_dispatch`, owner-restricted, gated on `MIGRATION_APPROVAL_SHA` |
| Backups | `ops/`, systemd timers in `ops/systemd/` |
| CI | `.github/workflows/ci.yml`, plus `secret-scan.yml` (Gitleaks), `release-admin-apk.yml` |
| Branch protection | **Not enforceable** (GitHub Free). CODEOWNERS review only. |

Architecture:

```
Next.js (Vercel) ─┐
Expo Android      ├─► Express API (VPS, PM2) ─► Prisma ─► PostgreSQL (Supabase)
                  │            │
                  │            ├─► VALORANT FastAPI service (VALORANT_INTERNAL_BASE_URL)
                  │            ├─► Challonge (OAuth client credentials)
                  │            ├─► PayHere (payments + notify webhook)
                  │            ├─► Resend (mail)
                  │            ├─► Web Push (VAPID)
                  │            └─► Upstash Redis (cache; required when API_PROCESS_COUNT > 1)
                  └─► SSE /api/v1/events (in-process EventEmitter)
```

## 0.2 What already exists (do NOT plan to build these from scratch)

| Target concept | Already implemented as | Verdict |
| --- | --- | --- |
| Persistent teams | `SavedTeam`, `SavedTeamMember` (roles CAPTAIN/PLAYER/SUBSTITUTE/COACH, hashed invite tokens, expiry) | EXTEND |
| Team invitations | `SavedTeamMember.inviteTokenHash` + `/team-invite` page + `backend/src/modules/teams/` | EXTEND |
| Historical tournament roster | `RegistrationMember` — already a *snapshot* separate from `SavedTeamMember` | EXTEND |
| Tournament registration | `TeamRegistration` + `backend/src/modules/tournaments/registration.service.js` | EXTEND |
| Waitlist | `TeamRegistration.waitlistPosition`, `Tournament.waitlistEnabled`, unique `(tournamentId, waitlistPosition)` | KEEP |
| Payment status | `RegistrationPaymentStatus`, `PaymentTransaction`, `BankTransferProof`, PayHere + bank transfer + reconciliation | KEEP |
| Slot reservation | `AdminSlotReservation`, `Tournament.reservationMinutes`, `TeamRegistration.reservedUntil` | KEEP |
| Matches as entities | `Match` (12-state `MatchStatus`, `station`, `assignedStaffId`, `checkInDeadline`, `vetoStartAt`) + `MatchParticipant` | EXTEND |
| Brackets | Native `TournamentBracket` + `brackets-manager`/`brackets-model`, plus `ChallongeIntegration` with scheduled sync and `ChallongeSyncLog` | KEEP |
| **Map veto** | Fully built: `VetoMap`, `VetoMapPool`, `VetoMapPoolMap`, `VetoRulePreset`, `VetoRoomTemplate`, `TournamentVetoConfig`, `VetoRoom`, `VetoRoomParticipant`, `VetoRoomAction`, `VetoAccessGrant`; public `/veto/[code]`; admin `/admin/veto-rooms`; ~25 endpoints in `backend/src/routes/v1.js:85-110` | KEEP |
| Match chat / referee comms | `MatchRoom`, `MatchRoomMember`, `MatchRoomMessage`, `MatchSupportRequest`, `MatchSupportMessage`; `/match-room/[code]` | EXTEND |
| Notifications | `Notification`, `NotificationRecipient`, `WebPushSubscription`, `UserNotificationPreference`; `backend/src/modules/notifications/` | EXTEND |
| Realtime | SSE at `GET /api/v1/events`, `backend/src/modules/realtime/realtime.service.js` | EXTEND (see 0.4) |
| **Audit logging** | `AuditLog` with `actorUserId`, `action`, `targetType`, `targetId`, `beforeData`, `afterData`, `requestId`, `ipAddress` | EXTEND (coverage, not design) |
| RBAC | Two layers: global `UserRole {user, admin}` + per-tournament `TournamentStaffAssignment {tournament_admin, referee}`; guards in `backend/src/modules/permissions/permission.middleware.js` (`requireSuperAdmin`, `requireTournamentStaff`, `requireMatchStaff`) | EXTEND |
| Auth | Password (bcryptjs) + Google/Discord OAuth; `Session` (hashed token, HttpOnly cookie), `OAuthAccount`, `OAuthLinkNonce`, `MobileOAuthGrant`, email verification, password reset, email change, lockout counters | KEEP |
| Discord as connected identity | **Already correct** — `OAuthAccount(provider, providerUserId)` unique, no tokens stored. `User.discordTag` is a separate mutable display string. | KEEP |
| Ticketing / spectator check-in | `TicketEvent`, `TicketOrder`, `Ticket`, `TicketScan` (signed QR, live scan) | KEEP |
| Shop | **Fully database-backed and checkout-ready**: `Product`, `ProductVariant`, `ProductImage`, `MerchandiseOrder`, `MerchandiseOrderItem`, fulfilment, reconciliation | KEEP — out of V2 scope |
| Media | `ImageAsset`, `Poster`, `EventAlbum`, `AlbumPhoto`, `TournamentSponsor`; `/gallery`, `/posters`, `/match-videos`; public/private upload roots | EXTEND |
| Recruitment | `RecruitmentApplication` at `/join` (`applicationType`, encrypted `applicantIdNumberCiphertext`, privacy versioning) | EXTEND |
| Support | `SupportConversation`, `SupportMessage`, `SupportConversationRead`; `/support` | KEEP |
| Event series | `EventSeries` ("Quest Ascension") with nullable `Tournament.seriesId` | KEEP |
| Background jobs | `BackgroundJob` + `backend/src/lib/jobs.js`, `JOB_WORKER_ENABLED` | KEEP |
| Rate limiting | `RateLimitBucket` + `backend/src/middleware/rate-limit.js` | KEEP |

## 0.3 The VALORANT leaderboard is NOT in this repository

`backend/src/modules/valorant-leaderboard/{client,controller,service}.js` is a
**thin proxy** to an external FastAPI service (`valorantsl-new`) reached via
`VALORANT_INTERNAL_BASE_URL`, authenticated with
`VALORANT_SERVICE_SECRET` / `VALORANT_SERVICE_KEY_ID`
(`backend/src/modules/valorant/valorant.auth.js`).

Consequences that invalidate the naive "migrate leaderboard players into Quest
players" framing:

- There is **no leaderboard table in `schema.prisma`**. There is nothing to
  migrate inside this repo.
- The upstream entity is keyed by **`puuid`** and already carries `name`, `tag`,
  `discord_username`, `current_tier`, `elo`, `rank_in_tier`, `peak_rank`,
  `peak_season`, `last_played_match`
  (`backend/src/modules/valorant-leaderboard/service.js:13-25`).
- Leaderboard registration runs its **own Discord OAuth** upstream
  (`/valorant/leaderboard/register/discord/login|callback`,
  `backend/src/routes/v1.js:117-118`) — separate from Quest's own Discord OAuth.
  These two Discord identities are currently unlinked.
- Public leaderboard endpoints are cached 60s
  (`leaderboardCache`, `backend/src/routes/v1.js:33-34`).

## 0.4 Verified constraints and real defects

1. **SSE does not fan out across processes.**
   `backend/src/modules/realtime/realtime.service.js` uses a module-scoped Node
   `EventEmitter`. With `API_PROCESS_COUNT > 1` (PM2 cluster), an event published
   on one process is invisible to SSE clients on another. Any broadcast/overlay
   design that assumes push must resolve this first (shared bus, sticky routing,
   or polling).

2. **Two conflicting `registrationState` unions on the frontend.**
   `frontend/lib/tournaments.ts:144` and `:156` type it as
   `"open" | "upcoming" | "closed" | "completed"` (event/aggregate shape), while
   `:300` types it as the full `TournamentRegistrationState`.
   `frontend/lib/event-utils.ts:20,51` then falls back between `eventStatus` and
   `registrationState`. **This — not the backend — is the likely source of
   contradictory public status labels.**

3. **Tournament registration state already has a single source of truth.**
   `backend/src/modules/tournaments/registration-state.js` →
   `getTournamentRegistrationState()` returns
   `already_registered | registration_closed | registration_open | waitlist_open | slots_full`,
   is composed with series-level windows in
   `backend/src/modules/tournaments/tournament.service.js:492-502`, and is served
   as `registrationState` / `isRegistrationOpen` / `isSlotsFull` /
   `isRegistrationClosed` (`tournament.service.js:614-617`). It is **server-side
   and SSR-delivered.** Treat this as correct until proven otherwise.

4. **"Checking…" is not a tournament-state problem.**
   `frontend/components/tournaments/RegisterTournamentButton.tsx:220` shows
   "Checking..." while fetching *the signed-in user's own registration*.
   Tournament state is already SSR. The real question is whether that personal
   fetch degrades gracefully on failure — not whether tournament state is
   client-dependent. Same pattern at
   `frontend/components/tournament-registration/ConfiguredTournamentRegistrationForm.tsx:421`.

5. **Riot identity is free text on the Quest side.**
   `TeamRegistration.captainRiotId`, `RegistrationMember.riotId`, and
   `SavedTeamMember.riotId` are unvalidated strings. **No PUUID column exists in
   `schema.prisma`.** PUUID exists only in the leaderboard proxy path. A Riot ID
   change silently orphans every historical roster row.

6. **`Match.station` is a free-text string.** There is no venue, station, or
   station-assignment model. LAN operations are genuinely greenfield.

7. **Registration uniqueness is keyed on captain email.**
   `@@unique([tournamentId, captainEmail])` — a captain changing email, or two
   registrations by one person under different emails, are both unhandled.

8. **`TeamRegistration` doubles as the tournament participant.** There is no
   separate approved-entrant entity; `MatchParticipant` links straight back to
   `TeamRegistration`.

## 0.5 Confirmed absent (genuinely greenfield)

Quest Player entity / QPID · public player profiles · public team profiles ·
player search · Quest tournament rankings (a *VALORANT team* rating exists at
`GET /admin/valorant/rankings`) · achievements · disputes · penalties ·
roster-change requests · venues/stations · team/player tournament check-in
records · OBS overlay routes · **any Spectra or OBS integration whatsoever**
(searched; zero hits) · LFT/LFP.

---

# PART 1 — INVESTIGATION ASSIGNMENTS

Part 0 closed most of the discovery questions. Investigate only what remains
open. For each, produce findings with file references.

### 1.1 Tournament status consistency (highest priority)

Trace `registrationState` end to end. Confirm or refute defect 0.4-2. Check
whether tournament **cards**
(`frontend/components/tournaments/event/EventTournamentList.tsx:26,28`) and the
**detail page** (`frontend/components/tournaments/TournamentDetailsContent.tsx:273`)
resolve status through the same union and the same helper
(`getTournamentRegistrationLabel`, `frontend/lib/tournaments.ts:325`). Determine
whether "Registration Closed" and "Waitlist Open" can render together, and from
which code path.

### 1.2 Registration → participant boundary

Read `registration.service.js`, `registration-eligibility.js`,
`role-conflict.service.js`, `coach.validation.js` (all in
`backend/src/modules/tournaments/`). Determine exactly which validations are
backend-enforced, which are DB constraints, and which exist only in
`frontend/components/tournament-registration/`. Decide whether a distinct
`tournament_participants` entity earns its cost, or whether an approved
`TeamRegistration` plus a status index is sufficient.

### 1.3 Identity gap between Quest and the leaderboard service

Determine what would be required to link a Quest `User` to an upstream
leaderboard `puuid`. Both sides have a Discord identity; Quest's is
`OAuthAccount.providerUserId`, the leaderboard's is upstream `discord_username`.
Report whether the upstream service exposes a stable Discord **ID** (not
username) — read `docs/valorant-integration.md` and
`docs/superpowers/specs/2026-08-14-valorant-player-leaderboard-design.md`.
State clearly which system should own player identity.

### 1.4 Duplicate-player surface

Quantify how identity currently duplicates across `User`, `SavedTeamMember`,
`RegistrationMember`, and upstream leaderboard entries. Identify the join keys
that exist today (`emailNormalized`, `userId`, `riotId`) and their reliability.

### 1.5 RBAC coverage audit

`requireSuperAdmin` / `requireTournamentStaff` / `requireMatchStaff` exist. Find
admin endpoints that still gate only on `requireAdmin`
(`backend/src/modules/auth/auth.middleware.js`) where a per-tournament check
would be more correct — start with `backend/src/modules/admin/admin.routes.js`.
Note that `/admin/valorant/*` (`backend/src/routes/v1.js:182-204`) appears to
carry **no auth middleware in the router**; verify whether it is protected
elsewhere and report this as a finding with a severity.

### 1.6 Audit log coverage

`AuditLog` exists. Determine which mutating admin operations actually write to
it and which silently overwrite history — especially registration approval,
payment reconciliation, roster edits, and veto overrides.

### 1.7 Security review

Focus on: the `/admin/valorant/*` auth question above; PayHere webhook signature
validation (`backend/src/modules/payments/`); private upload boundary
(`UPLOAD_ROOT` vs `PRIVATE_UPLOAD_ROOT`, `backend/src/middleware/upload.js`);
IDOR on `TeamRegistration.publicReference`, veto room `code`, match-room `code`,
ticket QR; CSRF (`protectAgainstCsrf`, `backend/src/middleware/security.js`);
rate-limit coverage; secret leakage into logs. Classify CRITICAL/HIGH/MEDIUM/LOW.

### 1.8 Performance review

Look for N+1 in `tournament.service.js` public projections, the unbounded
`registeredParticipants` payload, image sizing on gallery/poster routes, SSE
reconnect behaviour, and cache-tag invalidation correctness
(`invalidateCache("foundation")`).

---

# PART 2 — DESIGN ASSIGNMENTS

Design only; implement nothing.

### 2.1 Quest Player identity (QPID)

Introduce a permanent player entity **without** disturbing `User`,
`SavedTeamMember`, or `RegistrationMember`. Address:

- `players` as a new table with public `QPID-000001` mapped to an internal UUID,
  and a nullable `user_id` so unclaimed/guest players exist.
- `game_accounts` keyed by `(game, external_id)` where `external_id` is **PUUID**
  for VALORANT — the durable identifier, with `riot_id`/`tag` demoted to cached
  display fields.
- Backfill strategy from existing roster rows, which are matchable only by
  `emailNormalized` and free-text `riotId`. Assume duplicates; require a manual
  merge tool.
- Whether the leaderboard service or Quest owns PUUID resolution (see 1.3).

### 2.2 Roster-change requests

No such system exists. Design a request model (Riot ID correction, player
replacement, coach add/remove, substitute change, team info correction) with an
approval workflow that reuses `AuditLog` and the existing notification service.

### 2.3 LAN venue and station operations

Greenfield. Design `venues → stations → station_assignments`, migrating
`Match.station` (free text) forward without breaking existing rows. Treat LAN as
first-class, not an online-platform afterthought.

### 2.4 Team/player tournament check-in

Distinct from spectator `TicketScan`. Design check-in records carrying team,
player, expected arrival, actual arrival, status, and station — wired to the
existing `MatchStatus.check_in_open` and `Match.checkInDeadline`.

### 2.5 Referee panel

`TournamentStaffRole.referee`, `requireMatchStaff`, `Match.assignedStaffId`,
match rooms, and veto rooms all already exist. Design a **restricted UI surface
over existing APIs**, not a new subsystem. Identify the genuinely missing pieces:
result submission authority, penalties, disputes, evidence attachment.

### 2.6 Result reporting

Today results live in `Match.scoreData` (JSON), `Match.winnerSlot`, and
`MatchParticipant.score` / `.result`. Design: LAN → referee authoritative;
online → captain submits, opponent confirms or disputes. Decide whether
`scoreData` JSON should become a typed `match_games` table (MATCH ≠ MAP) and
what that costs.

### 2.7 Broadcast and Spectra

Fully greenfield. Design tournament DB → broadcast state → read-only broadcast
API → `/overlay/*` browser sources, with a **Spectra adapter kept at the edge**
(mirror the isolation already used for the VALORANT FastAPI client in
`backend/src/modules/valorant/valorant.client.js`). **Resolve constraint 0.4-1
first** — an overlay that relies on SSE will silently break under PM2 cluster.

### 2.8 Quest rankings and achievements

Keep the VALORANT competitive leaderboard as an external read. Design a separate
configurable points model for Quest tournament ranking, plus the simplest
reusable achievement model attaching to players and teams.

### 2.9 LFT / LFP

Evolve `RecruitmentApplication` into player- and team-entity-backed listings
while preserving the current `/join` form and its privacy-consent fields.

### 2.10 Control Centre

Extend `frontend/app/admin/` (already ~25 routes). Do **not** design a parallel
system. Identify which existing admin pages become Control Centre modules and
which modules are genuinely new (check-in, stations, referees, broadcast,
disputes).

---

# PART 3 — TARGET MODEL MAPPING

For each proposed entity, state exactly one of **REUSE / ALTER / MIGRATE / NEW /
NOT NEEDED**, naming the current model it maps to. Expected outcome given Part 0
(verify, don't assume):

- **REUSE** — `users`, `oauth_accounts`, `sessions`, `saved_teams`,
  `saved_team_members`, `team_registrations`, `registration_members`, `matches`,
  `match_participants`, `tournament_brackets`, `audit_logs`, `notifications`,
  veto tables, ticket tables, shop tables
- **ALTER** — `tournaments` (state model), `matches` (station FK, result fields),
  `tournament_staff_assignments` (role enum)
- **NEW** — `players`, `game_accounts`, `venues`, `stations`,
  `station_assignments`, `check_ins`, `roster_change_requests`, `disputes`,
  `penalties`, `match_games`, `player_rankings`, `team_rankings`, `achievements`,
  `broadcast_state`
- **NOT NEEDED** — a separate `teams` table (use `saved_teams`), a separate
  `team_invitations` table (already on `saved_team_members`), a separate
  `match_vetoes` table (already modelled), a separate `payments` table
  (`payment_transactions` exists)

---

# PART 4 — REVISED PHASE ORDER

The original phase order assumed teams, veto, matches, audit, and notifications
were missing. They are not. Revised order, and why:

- **Phase 0 — Audit.** Parts 1.1–1.8. Ship the fix for defect 0.4-2 (frontend
  status union) as a standalone bugfix PR; it is the visible production symptom
  and needs no schema change.
- **Phase 1 — Foundations.** Tournament state consolidation, RBAC role-enum
  extension on the *existing* two-layer model, audit-log coverage gaps.
  *Moved earlier than the original: these are additive and unblock everything.*
- **Phase 2 — Player identity.** `players` + `game_accounts` + PUUID, behind a
  feature flag, dual-write, no read-path change yet. *The riskiest migration in
  the plan; it gets its own phase and its own merge tooling.*
- **Phase 3 — Player & team profiles.** Public pages, search, and linking the
  leaderboard proxy to Quest players.
- **Phase 4 — Registration V2.** Team/roster selection on top of existing
  `SavedTeam`, eligibility, roster-change requests. *Deferred behind identity
  because registration validation is the main consumer of PUUID.*
- **Phase 5 — LAN operations.** Venues, stations, check-in, referee panel,
  results, disputes, penalties. *Promoted above broadcast: Quest runs physical
  LANs, and the referee/check-in gap is operationally live today.*
- **Phase 6 — Control Centre.** Consolidates Phase 5 surfaces.
- **Phase 7 — Broadcast.** Requires the SSE fan-out fix (0.4-1) first.
- **Phase 8 — Community.** Rankings, achievements, LFT/LFP, histories, media
  linking.

Phases 3 and 5 can run in parallel; they touch disjoint code.

---

# PART 5 — TASK FORMAT FOR OPENCODE + CODEX

Break each phase into small, independently mergeable tasks. Task IDs follow
`V2-P<phase>-<seq>`, e.g. `V2-P1-001`. Each task must contain:

**Objective** · **Why** · **Existing files** (real paths) · **Files likely
changed** · **Database changes** (exact, additive; name the new migration
directory under `backend/prisma/migrations/`) · **API changes** (exact route +
method) · **Frontend changes** · **Mobile-admin impact** (state "none" explicitly
if none) · **Migration + backfill** · **Backwards compatibility** (what must keep
working, including existing public URLs) · **Tests** (exact commands, Part 7) ·
**Manual verification** · **Security considerations** · **Rollback** ·
**Dependencies** · **Do not touch** · **Acceptance criteria**

Rules for task sizing:

- One migration per task, maximum.
- No task may change both the schema and a public page's rendering.
- Any task touching `TeamRegistration`, `Session`, `PaymentTransaction`, or
  `Ticket` must state its production-data risk explicitly.

---

# PART 6 — PR STRATEGY

Branches follow the existing repo style (`feat/`, `fix/`, `docs/` prefixes per
recent history). Use `quest-v2/<area>` only for long-lived integration branches.

- Small, single-purpose PRs; CODEOWNERS review is the only gate (no branch
  protection is enforceable on GitHub Free).
- Schema migrations ship in their own PR, separate from the code that reads the
  new columns.
- Feature-flag every user-visible V2 surface until its phase completes.
- Never merge a migration PR and run a deploy in the same window — backend CD is
  manual and gated on `MIGRATION_APPROVAL_SHA`.

---

# PART 7 — TESTING STRATEGY

Use the real commands:

```powershell
# backend
Set-Location backend; npm run lint; npm test; npm run test:coverage
Set-Location backend; npm run test:integration        # needs isolated test DB
Set-Location backend; npm run prisma:migrate:status; npm run prisma:security:verify

# frontend
Set-Location frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e:local

# mobile-admin (only if API contracts change)
Set-Location mobile-admin; npm run typecheck; npm test
```

Coverage thresholds are enforced in `backend/package.json`: lines 68, branches
60, functions 64 — V2 work must not regress them.

Required regression coverage for existing production behaviour: tournament
registration end to end (free, PayHere, bank transfer), waitlist promotion, slot
reservation expiry, veto room flow, match room permissions, ticket QR scan,
OAuth link/unlink safety (`20260819170000_add_oauth_link_safety`), and public
tournament status rendering.

---

# PART 8 — DEPLOYMENT

Match the existing pipeline; do not propose a different one.

```
PR → CI (ci.yml) → merge to main
  → frontend: deploy-frontend.yml (Vercel, prebuilt artifact)
  → backend:  cd.yml (manual dispatch, owner-only)
       → backup → prisma migrate deploy (MIGRATION_APPROVAL_SHA gate)
       → pm2 restart → /api/health/ready verification → pm2 save
```

Additive migrations only (`backend/prisma/codemap.md`). Destructive changes
require `DESTRUCTIVE_MIGRATION_APPROVAL_SHA`. Take a database backup before every
V2 migration; `ops/restore-production-backup.sh` is the rollback path.

---

# PART 9 — OUTPUT FORMAT

Produce one planning document with these sections. Sections marked ✅ are largely
answered by Part 0 — confirm briefly with file references rather than
re-investigating.

1. Executive summary
2. Current architecture ✅
3. Frontend route map (all 67 `page.tsx` routes under `frontend/app/`)
4. Backend/API map (`backend/src/routes/v1.js`, `backend/src/routes/index.js`,
   and the 26 modules under `backend/src/modules/`)
5. Data model map (from `backend/prisma/schema.prisma`)
6. Authentication ✅
7. Authorization — including the `/admin/valorant/*` question (1.5)
8. Discord integration ✅
9. Riot/VALORANT integration and the external service boundary
10. Leaderboard — external ownership and linkage options
11. Player identity design
12. Teams — extension of `SavedTeam`
13. Tournaments and state consolidation
14. Registration and eligibility
15. Brackets and matches ✅
16. Veto ✅ (confirm; note gaps only)
17. LAN operations design
18. Referee system design
19. Control Centre plan
20. Broadcast / Spectra design (+ SSE constraint)
21. Rankings and achievements
22. Recruitment → LFT/LFP
23. Media
24. Notifications ✅
25. Audit logging coverage
26. Security findings (severity-classified)
27. Performance findings
28. Bugs and technical debt
29. Keep / Extend / Rework classification
30. Proposed V2 architecture
31. Proposed V2 data model with REUSE/ALTER/MIGRATE/NEW/NOT NEEDED
32. Migration strategy (affected data, risk, compatibility, method, rollback,
    tests — per migration)
33. Phase plan (Part 4)
34. Task breakdown (Part 5 format)
35. PR strategy
36. Testing strategy
37. Deployment strategy
38. Risk register
39. Recommended first PR
40. Open questions

---

# NON-NEGOTIABLES

- Protect production data, existing public URLs, and existing user flows.
- Keep Quest's existing visual identity.
- LAN operations are first-class.
- PUUID is the preferred permanent VALORANT identifier; Riot ID is display data.
- Discord stays a connected identity via `OAuthAccount`, never a stored username.
- Do not rebuild the veto system, the bracket system, the payment system, the
  notification system, the audit log, or the shop.
- Every finding cites a real file. Never invent functionality.
