# Quest Esports V2 Architecture Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This document is a design and sequencing artifact; it does not authorize implementation, migration, deployment, or commit by itself.

**Goal:** Extend the existing Quest Esports platform with durable player identity, LAN operations, controlled competitive workflows, broadcast boundaries, rankings, and community features without rebuilding systems that already work.

**Architecture:** Quest remains the system of record for users, permissions, registrations, saved teams, matches, operations, and public product identity. The external VALORANT service remains the owner of leaderboard data and PUUID resolution until an explicit integration contract is agreed; Quest stores opaque external identifiers and links them to Quest players. New V2 capabilities are additive, feature-flagged, and introduced behind existing Express, Prisma, Next.js, Expo, audit, notification, cache, and deployment boundaries.

**Tech Stack:** Next.js 16.2 App Router, React 19, Tailwind 4, Zustand; Express 5/CommonJS; Prisma 6.19; PostgreSQL/Supabase; PM2 on the API VPS; Vercel frontend; Expo/Android `mobile-admin/`; external FastAPI VALORANT service; Challonge, PayHere, Resend, Web Push, and Upstash Redis.

**Spec:** `docs/superpowers/plans/2026-08-22-quest-v2-architecture-discovery-prompt.md` (the validated discovery prompt and Part 0 baseline).

## Global constraints

- Do not rebuild saved teams, invitations, registration, waitlist, payments, reservations, matches, brackets, veto, match rooms, notifications, audit logging, auth, ticketing, shop, media, recruitment, support, event series, jobs, or rate limiting.
- Additive Prisma migrations only; follow `backend/prisma/codemap.md`.
- One migration maximum per task; schema migrations ship separately from readers.
- Preserve all existing public URLs and existing registration, payment, veto, match-room, OAuth, ticket, shop, and recruitment flows.
- Treat the Next.js web app, `mobile-admin/`, and the external VALORANT service as separate API clients whenever an API contract changes.
- Feature-flag every new user-visible V2 surface until its phase is complete.
- Never store Discord usernames as identity keys. Discord remains a connected identity through `OAuthAccount.providerUserId`.
- PUUID is the preferred durable VALORANT identifier; Riot ID is cached display data.
- Back up production before every migration. Backend deployment remains the existing manual, owner-only `cd.yml` flow gated by `MIGRATION_APPROVAL_SHA`.
- Destructive changes require `DESTRUCTIVE_MIGRATION_APPROVAL_SHA`; none are required by this plan.
- No task may combine a schema change with rendering a public page.
- Any task touching `TeamRegistration`, `Session`, `PaymentTransaction`, or `Ticket` must explicitly assess production-data risk.

---

## 1. Executive summary

Quest already has the difficult tournament-platform foundations. V2 should therefore be an extension program, not a replacement: consolidate the frontend state contract, close authorization and audit gaps, add a Quest-owned player identity layer, then add roster changes and LAN operations. Broadcast comes only after realtime fan-out is made process-safe. Rankings, achievements, and LFT/LFP follow after identity and tournament outcomes are reliable.

The highest-confidence production defect is the frontend type boundary: `frontend/lib/tournaments.ts:144,156` describes aggregate event states while `:300` describes the full tournament registration state. The backend canonical state machine is coherent at `backend/src/modules/tournaments/registration-state.js:12-85`; public mapping derives the booleans from that state at `backend/src/modules/tournaments/tournament.service.js:614-618`. The user-visible mismatch is most plausibly event-level versus child-tournament labels, stale cache, or a client-side union fallback—not two contradictory values in one backend projection. Consolidate the frontend contract as the first standalone bugfix.

No leaderboard migration exists in this repository. The VALORANT leaderboard is a signed proxy to `valorantsl-new`; Quest should own the product `Player` and link it to upstream `puuid` and stable Discord provider identity without importing leaderboard rows.

## 2. Current architecture ✅

```
Next.js/Vercel ─┐
Expo/Android    ├─► Express/PM2 ─► Prisma ─► PostgreSQL/Supabase
VALORANT proxy  ┘       ├─► FastAPI VALORANT service
                         ├─► Challonge, PayHere, Resend, Web Push
                         └─► Upstash Redis when API_PROCESS_COUNT > 1
```

Entrypoints are `backend/src/server.js` → `backend/src/app.js`; frontend deployment is `.github/workflows/deploy-frontend.yml`; backend deployment is `.github/workflows/cd.yml`. Realtime is SSE at `GET /api/v1/events`, backed today by a process-local `EventEmitter` in `backend/src/modules/realtime/realtime.service.js:9-23`. The existing product model and deployment facts in Part 0 are confirmed and are the constraints for every phase.

## 3. Frontend route map

The repository contains 67 `page.tsx` routes:

```text
/, /admin, /admin/contact-messages, /admin/event-series, /admin/events,
/admin/events/[id], /admin/expenses, /admin/games, /admin/media,
/admin/match-rooms, /admin/orders, /admin/payments, /admin/products,
/admin/recruitment, /admin/registrations, /admin/rulebooks, /admin/support,
/admin/teams, /admin/tickets, /admin/tournaments,
/admin/tournaments/[id]/edit, /admin/tournaments/new, /admin/users,
/admin/valorant, /admin/veto-rooms, /confirm-email-change, /contact,
/events/[slug], /forgot-password, /gallery, /gallery/[slug], /join, /login,
/maintenance, /match-room/[code], /match-videos, /members, /posters,
/privacy-policy, /profile, /refund-policy, /registration,
/reset-password, /rulebook, /rulebooks/[slug], /shop, /shop/[slug],
/shop/cart, /shop/order, /signup, /support, /support/[conversationId],
/team-invite, /terms-of-service, /tickets, /tickets/[slug], /tickets/order,
/tournaments, /tournaments/[slug], /tournaments/[slug]/payment,
/tournaments/[slug]/register, /tournaments/series/[slug],
/valorant-leaderboard, /valorant-leaderboard/register, /verify-email,
/veto/[code], /admin/event-albums
```

The event route responsibility is documented in `frontend/app/events/codemap.md`; admin route responsibility is documented in `frontend/app/admin/codemap.md`. V2 extends `frontend/app/admin/`; it does not create a parallel control-centre app.

## 4. Backend/API map

`backend/src/routes/index.js:3-38` composes the module routers. `backend/src/routes/v1.js:43-206` contains the versioned public, authenticated, realtime, veto, match, leaderboard, and admin-adjacent routes. The 26 modules are:

```text
account, admin, auth, challonge, contact, expenses, games, matches,
match-rooms, media, notifications, payments, permissions, realtime,
recruitment, rulebooks, series, shop, support, teams, tickets, tournaments,
uploads, valorant, valorant-leaderboard, veto
```

Important existing boundaries:

- Tournament and registration logic: `backend/src/modules/tournaments/`.
- Permission guards: `backend/src/modules/permissions/permission.middleware.js` and `backend/src/modules/auth/auth.middleware.js`.
- Admin router: `backend/src/modules/admin/admin.routes.js`.
- VALORANT edge adapter: `backend/src/modules/valorant-leaderboard/client.js`, `service.js`, and `controller.js`.
- Veto: approximately 25 routes in `backend/src/routes/v1.js:85-110`, with service-level authorization in `backend/src/modules/veto/veto.service.js`.
- Match rooms: `backend/src/routes/v1.js:67-78` and `backend/src/modules/match-rooms/`.
- SSE: `backend/src/modules/realtime/`.

## 5. Data model map

`backend/prisma/schema.prisma` is approximately 2,000 lines with 66 committed migrations. Existing groups are:

- Identity/auth/security: `User`, `OAuthAccount`, `Session`, OAuth link and grant models, verification/reset models, lines 315-570.
- Events and competition: `EventSeries`, `Tournament`, `TournamentBracket`, `TournamentStaffAssignment`, `Match`, `MatchParticipant`, lines 384-845.
- Integrations and audit: Challonge models and `AuditLog`, lines 846-935.
- Registration/capacity: `TeamRegistration`, `AdminSlotReservation`, `RegistrationMember`, lines 936-1011 and 1318-1348.
- Commerce/payments: products, orders, `PaymentTransaction`, `BankTransferProof`, and reconciliation models, lines 1012-1317.
- VALORANT team/admin data: `ValorantTeamBinding`, `QuestValorantSeries`, game and operations models, lines 1349-1466.
- Saved teams and infrastructure: `SavedTeam`, `SavedTeamMember`, rate limits, jobs, lines 1467-1556.
- Media: `ImageAsset`, `Poster`, `EventAlbum`, `AlbumPhoto`, sponsors, lines 1557-1638.
- Veto and communications: veto tables, match rooms, support messages, notifications, lines 1639-1991.

The missing durable player, game-account, venue/station, check-in, dispute, penalty, match-game, ranking, achievement, roster-request, and broadcast-state entities are genuinely greenfield.

## 6. Authentication ✅

Password/bcryptjs and Google/Discord OAuth already exist. Sessions use hashed tokens and HttpOnly cookies. Quest Discord identity is correctly represented by `OAuthAccount(provider, providerUserId)`; `User.discordTag` is display-only. Email verification, password reset, email change, lockout, OAuth link safety, and mobile OAuth grants remain reused. V2 must not add a second Discord identity store.

## 7. Authorization

There are two existing layers: global `UserRole { user, admin }` and per-tournament `TournamentStaffAssignment` roles (`tournament_admin`, `referee`). `requireSuperAdmin`, `requireTournamentStaff`, and `requireMatchStaff` are in `backend/src/modules/permissions/permission.middleware.js`.

`/admin/valorant/*` is protected: `backend/src/routes/v1.js:181-204` mounts it under `requireAdmin`, and `backend/src/modules/auth/auth.middleware.js:27-40` checks `req.user.role === "admin"`. The prompt's concern is therefore not missing authentication. Severity is MEDIUM for least-privilege: the route is globally admin-only rather than scoped to a tournament/operation permission, and route metadata is weaker than runtime enforcement.

Veto admin routes use `requireAuth` at `backend/src/routes/v1.js:92-110`, then enforce tournament staff/super-admin decisions inside `backend/src/modules/veto/veto.service.js:300-371,461-500,659-687`. That is effective in the inspected path but HIGH defense-in-depth risk: route middleware should reject obviously unauthorized callers before service work, while service checks remain authoritative.

## 8. Discord integration ✅

Quest obtains the stable Discord account ID from OAuth and stores it in `OAuthAccount.providerUserId` (`backend/src/modules/auth/oauth.service.js:552-584,637-731`). The upstream VALORANT registration flow also carries `discord_id` and `discord_username` (`frontend/components/valorant/ValorantRegistration.tsx:146-157,254-258`), but the public leaderboard projection exposes only `discord_username` (`docs/superpowers/specs/2026-08-14-valorant-player-leaderboard-design.md:94-106`). Discord username/tag values are mutable display data, never join keys.

Quest owns authenticated product identity and permissions. The upstream service owns its leaderboard/player registration state until a versioned linking endpoint is agreed. A future link uses stable Discord ID and PUUID, not username.

## 9. Riot/VALORANT integration and external boundary

`backend/src/modules/valorant-leaderboard/client.js:12-18,20-48,107-124` signs and proxies requests to `VALORANT_INTERNAL_BASE_URL`; `service.js:11-24,37-52` maps opaque `puuid`, Riot display fields, and `discord_username`; `controller.js:22-57` exposes public lookup and upstream registration. The upstream source is not in this repository.

Quest-side `TeamRegistration.captainRiotId`, `RegistrationMember.riotId`, and `SavedTeamMember.riotId` are free text. V2 stores `puuid` in `GameAccount.externalId` with `game = VALORANT`, and caches `riotId`/tag only for display. The edge adapter must normalize timeouts, upstream errors, and opaque IDs without copying leaderboard ownership into Prisma.

## 10. Leaderboard ownership and linkage options

The current leaderboard stays an external read-through. Options are:

1. **Recommended:** Quest `Player` links to an upstream PUUID through a versioned, signed lookup/link contract. Quest stores the link and cached display snapshot, while the leaderboard remains upstream-owned.
2. Import leaderboard rows into Quest. Rejected: duplicates ownership, creates stale rank data, and cannot be safely backfilled from this repository.
3. Link by Discord username. Rejected: mutable, collision-prone, and the leaderboard projection does not expose stable Discord IDs.

The upstream must expose a stable Discord-ID-aware endpoint or an admin-mediated proof flow before automatic account linking is enabled. Until then, links are manual, auditable, and reversible.

## 11. Player identity design

Add `players` with internal UUID primary key and public sequential identifier `QPID-000001`. Store nullable `userId` so a player can be unclaimed or guest. Add `game_accounts` with unique `(game, externalId)`; for VALORANT `externalId` is PUUID. Store Riot name/tag as cached display fields with `lastResolvedAt` and source metadata. Preserve all legacy `SavedTeamMember`, `RegistrationMember`, and `TeamRegistration` strings and relations.

Backfill is deliberately probabilistic: first use populated `userId`, then `emailNormalized`, then normalized Riot ID only as a candidate match. Create a merge queue for collisions and never silently merge two people. Dual-write new player links behind a feature flag; do not change public read paths until merge confidence and manual tooling are proven.

Ownership: Quest owns `Player`, Quest account claims, merge decisions, and registration history; the upstream owns PUUID resolution and leaderboard/rank fields. A Quest service may cache upstream data but must not make cached Riot ID the identity key.

**Verification strength — there is no Riot RSO (confirmed 2026-08-23).** The sibling
`valorant-platform-backend` talks to exactly one upstream, HenrikDev
(`app/integrations/henrik/client.py`); there is no Riot Sign-On client and no Riot
OAuth credential anywhere in either repository. Henrik proves an account *exists*; it
can never prove the signed-in Quest user holds it. No task in this plan may promise
ownership verification. The reachable states are `UNLINKED`, `RESOLVED`,
`USER_CONFIRMED`, `DISCORD_CORROBORATED`, `ADMIN_VERIFIED`, `REVOKED` — see
`2026-08-23-quest-identity-and-riot-linking-plan.md` §A.3 C-1.

## 12. Teams: extension of `SavedTeam`

`SavedTeam` and `SavedTeamMember` remain the team system. Add optional `playerId` to `SavedTeamMember` only after the player migration exists; keep `userId`, role, invite-token hash, expiry, email, Discord, and Riot fields for compatibility. `TeamRegistration` remains the tournament entry aggregate and `RegistrationMember` remains the historical roster snapshot. Do not create a second `teams` table or a separate invitations table.

## 13. Tournaments and state consolidation

The backend state machine is canonical: `already_registered`, `registration_closed`, `registration_open`, `waitlist_open`, and `slots_full` from `registration-state.js`. `tournament.service.js:614-618` derives action and boolean flags from it. Consolidate frontend types so event aggregate status and child registration status are distinct named types; do not use a fallback union that permits an event status to masquerade as a tournament registration state.

Cards must show event-level status only in event-level locations and child registration state only in child tournament locations. The detail page and button must consume the same canonical child state. A production regression test must prove that a closed event with an open child can show two intentionally scoped labels, while one child cannot show both `registration_closed` and `waitlist_open`.

## 14. Registration and eligibility

Backend enforcement includes registration windows, parent series windows, capacity/waitlist, transactionally allocated slots, active reservations, duplicate active team names, coach validation, and coach/player role conflicts. DB constraints enforce public-reference uniqueness, `(tournamentId,captainEmail)`, waitlist position, assigned slots, and reservation slots. The frontend enforces form UX only; it is not security authority.

`TeamRegistration` already serves as the participant aggregate. A separate `tournament_participants` table is not justified unless future requirements demand independently transferred participant identities, participant-level eligibility history, or a normalized many-to-many participant model. V2 should add approved status indexes/queries and player links rather than duplicate registration lifecycle.

## 15. Brackets and matches ✅

Reuse `Match`, `MatchParticipant`, native `TournamentBracket`, brackets-manager/model, and Challonge sync. `Match` already has a 12-state status, station text, staff assignment, check-in deadline, veto start, winner slot, and score JSON. V2 alters station/result representations additively and introduces `MatchGame` for typed map/game scores; existing JSON remains readable during dual-read migration.

## 16. Veto ✅

Reuse `VetoMap`, pool, rules, room, participant, action, grant, and tournament configuration tables. Public `/veto/[code]` and admin `/admin/veto-rooms` remain. Gaps are defense-in-depth route guards, audit coverage for overrides, and evidence/penalty linkage—not a new veto subsystem.

## 17. LAN operations design

Add `Venue` → `Station` → `StationAssignment`. A station has a stable venue-scoped code, status, capabilities, and active flag. An assignment links a match, station, time window, and operator; it is the operational history and must not overwrite historical match data. Alter `Match.station` additively to nullable `stationId`, retain the text column as legacy display data, backfill only exact safe matches, and keep unmatched historical text.

Add team/player check-in records with expected arrival, actual arrival, status, station, actor, and optional evidence. Match check-in windows are derived from existing `MatchStatus.check_in_open` and `Match.checkInDeadline`; spectator `TicketScan` remains separate.

## 18. Referee system design

Create a restricted referee surface over existing `TournamentStaffAssignment`, `requireMatchStaff`, `Match.assignedStaffId`, match rooms, and veto rooms. Do not create a second staff subsystem. Missing capabilities are authoritative result submission, penalties, disputes, evidence attachment, and auditable override reasons. Referees may act only on assigned/authorized matches; super-admins retain emergency override with mandatory reason and audit entry.

## 19. Control Centre plan

Extend `frontend/app/admin/` and its codemap. Existing modules map as follows: events/event-series/tournaments remain competition setup; registrations/payments/teams remain entrant operations; match-rooms/veto-rooms remain match operations; media, tickets, orders, products, support, recruitment, users, games, rulebooks, expenses, contact, and VALORANT remain existing modules. New modules are check-in, venues/stations, referee queue, disputes/penalties, and broadcast state.

The Control Centre is a navigation and permissions composition over existing pages and APIs, not a parallel route tree. It should expose tournament context, live operation status, staff scope, and links into existing detail pages before adding bespoke dashboards.

## 20. Broadcast / Spectra design and SSE constraint

Add a durable `BroadcastState` projection sourced from tournament/match/check-in/result events. Expose a read-only, public-safe broadcast API and `/overlay/*` browser sources. Keep Spectra behind an adapter at the edge, analogous to `backend/src/modules/valorant/valorant.client.js`; no Spectra dependency belongs in core tournament services.

The current process-local EventEmitter cannot support cluster-safe overlays (`backend/src/modules/realtime/realtime.service.js:9-23`). Before any push-dependent broadcast feature, publish events through a shared Redis bus (required when `API_PROCESS_COUNT > 1`) or use a durable polling/version cursor. Recommended design: durable broadcast state plus Redis fan-out for low latency, with overlay polling/reconnect cursor as the correctness fallback. Add `Last-Event-ID`/version replay or explicit polling so disconnects do not silently lose state.

## 21. Rankings and achievements

Keep the VALORANT leaderboard external and read-only. Add configurable Quest ranking seasons, point rules, player standings, and team standings based on approved tournament outcomes, with immutable award records so recalculation is possible. Achievements should be a small reusable definition/award model attachable to a `Player` or `SavedTeam`, with idempotent awards and source references. Do not duplicate rank snapshots into the player identity table.

## 22. Recruitment → LFT/LFP

Preserve `/join`, `RecruitmentApplication`, encrypted applicant ID, privacy-consent version, and existing application workflow. Add optional `playerId`, `teamId` (`SavedTeam`), listing type, availability, game, region, and expiry in a later additive migration. Existing applications remain unlinked and private. Public LFT/LFP listings require an explicit consent state and must never expose the encrypted ID field or private application messages.

## 23. Media

Reuse `ImageAsset`, `Poster`, `EventAlbum`, `AlbumPhoto`, `TournamentSponsor`, and existing upload roots. Add responsive derivative metadata and bounded public projections only if needed by measured performance. Do not change public media URLs. Keep `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` separated; private files must be served through authorization, not static public directories.

## 24. Notifications ✅

Reuse `Notification`, `NotificationRecipient`, `WebPushSubscription`, `UserNotificationPreference`, and `backend/src/modules/notifications/`. Roster requests, check-in changes, disputes, penalties, referee assignments, and merge decisions should enqueue notifications through this service and use existing preferences/rate limits.

## 25. Audit logging coverage

`AuditLog` already records actor, action, target, before/after JSON, request ID, and IP. Registration status changes are explicitly logged in `backend/src/modules/admin/admin.service.js:89-110`. Coverage is incomplete or not evidenced for every roster edit, payment reconciliation, veto override, Valorant mutation, station assignment, result override, dispute decision, penalty, player merge, and broadcast mutation.

Introduce a single audit helper with redaction rules and operation-specific required fields. Never log OAuth tokens, session tokens, PayHere signatures, PUUIDs when privacy policy forbids them, encrypted ID ciphertext, or uploaded private content. Audit writes must be in the same transaction as the critical state change where possible; otherwise mark delivery failure and fail closed for privileged overrides.

## 26. Security findings

| Severity | Finding | Evidence and action |
|---|---|---|
| HIGH | Veto admin routes rely on service-layer authorization while route layer uses only `requireAuth`. | `backend/src/routes/v1.js:92-110`; `veto.service.js:300-371,461-500,659-687`. Add defense-in-depth route guards and retain service checks. |
| MEDIUM | `/admin/valorant/*` is broadly admin-protected, not tournament/operation-scoped. | `backend/src/routes/v1.js:181-204`; `auth.middleware.js:27-40`. No missing-auth defect was confirmed. Add least-privilege permissions only if the upstream operations need narrower scope. |
| MEDIUM | Short code lookup surfaces require continuous IDOR regression tests. | Veto `veto.service.js:467-470,619-627`; match rooms `match-room.service.js:411-413`. Current access checks were found; test anonymous, wrong-team, expired-grant, and cross-tournament cases. |
| MEDIUM | Audit coverage for privileged mutations is incomplete. | Registration status is covered at `admin.service.js:89-110`; verify roster, payment, veto, results, merges, disputes, and penalties operation by operation. |
| LOW | No dedicated limiter was found for admin/Valorant or veto mutations. | `backend/src/middleware/rate-limit.js:89-138`; add targeted limits after measuring abuse risk. |
| LOW | Public media can enumerate public filenames and lacks request-time responsive variants. | `upload.service.js:60-95`; media services and optimization script. Preserve public intent, reduce enumeration and payload exposure where practical. |
| LOW | CSRF/origin and PayHere controls appear present. | `app.js:38-51`, `security.js:95-155`, `payment.service.js:439-478`; preserve exemptions only for signed webhook/OAuth flows. |
| LOW | No secret leakage was found in inspected backend logs. | PayHere logs order ID and amount/currency, not signatures/secrets. Add automated log scans in security review. |

No CRITICAL issue was confirmed by repository inspection. Production review must still include environment configuration and upstream service logs, which are outside this repository.

## 27. Performance findings

- `tournament.service.js:709-740` maps every loaded registration and scans members in memory. The public `registeredParticipants` payload is unbounded; use summary/bounded projections and pagination.
- The mapper itself does not query, but callers must avoid broad Prisma includes for `teamRegistrations`, `members`, users, posters, and album photos. Confirm query plans before calling this an N+1.
- Album listing is bounded, but album detail can return all photos when pagination is omitted (`backend/src/modules/media/event-album.service.js:169-184`). Require bounded defaults.
- Stored optimization exists in `backend/scripts/optimize-event-album-photos.js:51-79`, but pages lack responsive variants, `srcset`, or dimensions.
- SSE has five-second reconnect and 25-second heartbeat but no replay buffer or `Last-Event-ID` (`realtime.controller.js:73-82`). Add shared fan-out plus a durable cursor/fallback.
- `foundation` invalidation is explicit in some match, team, Challonge, and admin mutations, but every tournament, registration, series, media, and publication mutation must be audited. Cache invalidates after successful 2xx only (`response-cache.js:58-63`); stale cache after failed or partial operations must remain impossible.

## 28. Bugs and technical debt

1. Consolidate the two frontend `registrationState` unions and remove `event-utils.ts` fallback ambiguity.
2. Document that `TeamRegistration` is the approved entrant aggregate and add query/index improvements instead of a duplicate participant table.
3. Replace free-text identity reliance incrementally with player/game-account links while preserving historical snapshots.
4. Replace free-text `Match.station` with additive station assignment data.
5. Add process-safe realtime and reconnect replay before broadcast.
6. Add operation-by-operation audit coverage and redaction tests.
7. Bound participant and album projections and add media dimension/derivative metadata.
8. Add route-level defense-in-depth to veto administration.

## 29. Keep / Extend / Rework classification

| Classification | Existing concepts |
|---|---|
| KEEP | Auth, sessions, OAuth accounts, payment systems, reservations, waitlist, brackets, veto, ticketing, shop, notifications, support, event series, jobs, rate limiting, external leaderboard ownership. |
| EXTEND | `SavedTeam`, `SavedTeamMember`, `TeamRegistration`, `RegistrationMember`, `Match`, `MatchParticipant`, match rooms, media, recruitment, audit coverage, RBAC, realtime, public projections. |
| REWORK | Frontend status type contract; public participant/photo projection boundaries; process-safe SSE; privileged mutation audit helper. |
| NEW | `Player`, `GameAccount`, venues, stations, assignments, check-ins, roster requests, disputes, penalties, match games, rankings, achievements, broadcast state. |
| NOT NEEDED | Separate `teams`, `team_invitations`, `match_vetoes`, `payments`, or `tournament_participants` tables under the current requirements. |

## 30. Proposed V2 architecture

```text
Quest identity layer
  User/OAuthAccount ── Player ── GameAccount(PUUID)
       │                    └── public profile / rankings / achievements
       └── SavedTeam/SavedTeamMember ── TeamRegistration/RegistrationMember

Competition layer
  Tournament/Series ── approved TeamRegistration ── Match/MatchParticipant
       │                         ├── CheckIn
       │                         ├── StationAssignment ── Venue/Station
       │                         └── MatchGame / Result / Dispute / Penalty

Edge integrations
  Quest VALORANT adapter ── external FastAPI leaderboard (PUUID/rank)
  Quest broadcast adapter ── BroadcastState ── read-only overlay API ── Spectra adapter

Cross-cutting
  RBAC, AuditLog, Notifications, rate limits, cache tags, shared realtime bus
```

Each new aggregate has an Express module/service boundary, Prisma additive migration, feature flag, audit events, notification hooks where relevant, and a read-only/public projection separate from admin mutation routes.

## 31. Proposed V2 data model with mapping

| Proposed entity | Mapping | Current model / change |
|---|---|---|
| users | REUSE | `User` |
| oauth_accounts | REUSE | `OAuthAccount` |
| sessions | REUSE | `Session` |
| saved_teams | REUSE | `SavedTeam` |
| saved_team_members | ALTER/EXTEND | `SavedTeamMember`; nullable `playerId`, preserve legacy fields |
| team_registrations | REUSE/EXTEND | `TeamRegistration`; approved-entry queries and player links only when proven |
| registration_members | REUSE/EXTEND | `RegistrationMember`; preserve immutable snapshots, optionally link player |
| matches | ALTER | `Match`; nullable station FK, typed result dual-read, preserve legacy fields |
| match_participants | REUSE | `MatchParticipant` |
| tournament_brackets | REUSE | `TournamentBracket` and existing integrations |
| tournament_staff_assignments | ALTER | Extend role enum/permissions without replacing assignment model |
| audit_logs | REUSE/EXTEND | `AuditLog` plus coverage/helper |
| notifications | REUSE | Existing notification tables |
| veto tables | REUSE | Existing Veto* models |
| ticket tables | REUSE | TicketEvent/Order/Ticket/Scan |
| shop tables | REUSE | Product/order/fulfilment/reconciliation models |
| players | NEW | Internal UUID plus public QPID, nullable `userId` |
| game_accounts | NEW | `(game, externalId)` unique; PUUID for VALORANT |
| venues | NEW | LAN venue metadata |
| stations | NEW | Venue-scoped physical stations |
| station_assignments | NEW | Match-to-station operational history |
| check_ins | NEW | Team/player arrival state, expected/actual time, station |
| roster_change_requests | NEW | Typed request, proposed values, approval/rejection, audit links |
| disputes | NEW | Match/result/registration dispute workflow |
| penalties | NEW | Scoped sanction, reason, duration, audit/evidence |
| match_games | NEW | One row per game/map, distinct from match |
| player_rankings | NEW | Quest season/points standings, not external rank snapshot |
| team_rankings | NEW | Quest season/points standings |
| achievements | NEW | Definitions plus idempotent player/team awards |
| broadcast_state | NEW | Durable public-safe live projection and version |
| teams | NOT NEEDED | Use `SavedTeam` |
| team_invitations | NOT NEEDED | Use `SavedTeamMember` invite fields |
| match_vetoes | NOT NEEDED | Use existing veto models |
| payments | NOT NEEDED | Use `PaymentTransaction` |
| tournament_participants | NOT NEEDED | Use approved `TeamRegistration` plus `RegistrationMember` |

## 32. Migration strategy

All migrations are additive and proposed. Migration PRs are separate from code that reads new columns. Each production migration requires a backup, status check, security verification, approval SHA, and a tested restore path through `ops/restore-production-backup.sh`.

| Migration | Affected data and method | Risk / compatibility / rollback |
|---|---|---|
| `20260822100000_add_tournament_staff_permissions` | Additive permission/role values only; seed no destructive changes. | Low. Existing enum values continue to work. Roll back by disabling new permission checks and restoring from backup only if enum deployment fails. |
| `20260822110000_add_players_and_game_accounts` | Create `players`, `game_accounts`, indexes, QPID sequence, nullable foreign keys; no backfill in migration. | High identity risk. No existing rows change; drop is not rollback-safe after references, so rollback is feature-flag disable plus forward repair. |
| `20260822120000_add_player_links_to_rosters` | Add nullable `playerId` to `SavedTeamMember` and `RegistrationMember`; represent a linked captain through the captain `RegistrationMember` snapshot rather than changing `TeamRegistration` ownership. | High production-data risk because roster history is sensitive. Backfill none in migration; preserve strings and snapshots. Rollback by nulling new links, never deleting historical rows. |
| `20260822130000_add_roster_change_requests` | Create request/status/review/evidence tables with indexes and immutable request numbers. | Medium. No existing registration rows change. Disable intake and leave requests read-only during rollback. |
| `20260822140000_add_venues_stations_assignments` | Create venue/station/assignment tables; add nullable `Match.stationId`, retain `Match.station`; exact-match backfill is a separate reviewed job. | High operational risk. Existing match text remains source fallback. Roll back by disabling station UI and using text station. |
| `20260822150000_add_check_ins` | Create team/player check-in tables, status enum, unique scopes, actor indexes. | Medium operational risk. No spectator `TicketScan` changes. Disable check-in UI/API and retain match deadlines. |
| `20260822160000_add_match_games_and_result_records` | Create typed game rows and result audit fields; keep `Match.scoreData`, winner, participant score/result. | High competition-data risk. Dual-write/dual-read and reconciliation required. Roll back reads to legacy JSON and preserve typed rows. |
| `20260822170000_add_disputes_penalties` | Create dispute, penalty, evidence-reference tables and indexes. | Medium/high because sanctions affect eligibility. No automatic sanctions during rollout; disable mutations and preserve decisions. |
| `20260822180000_add_broadcast_state` | Create versioned public-safe state snapshots, source event/version, and retention indexes. | Medium. No existing public route changes. Disable overlay reads and continue ordinary match operation. |
| `20260822190000_add_rankings` | Create ranking seasons, scoring rules, player standings, team standings, and immutable source awards. | Medium. Recalculate from source outcomes; do not delete source results on rollback. |
| `20260822200000_add_recruitment_entity_links` | Add nullable player/team/listing fields and consent/publication state to recruitment structures. | Medium privacy risk. Existing `/join` submissions remain private and unlinked; rollback hides new listing fields. |
| `20260822210000_add_achievements` | Create achievement definitions and idempotent player/team awards with source references. | Medium. Awards are additive; disable evaluation/public reads and retain rows for forward repair on rollback. |
| `20260822220000_add_profile_media_links` | Add nullable player/team/tournament links for public-safe histories and media. | Medium privacy risk. Existing media URLs and assets remain untouched; hide new links on rollback. |

No migration alters `Session`, `PaymentTransaction`, or `Ticket` in the proposed first implementation. Registration migrations must explicitly run free/PayHere/bank-transfer, waitlist, reservation, and historical snapshot regressions before release.

## 33. Phase plan

### Phase 0 — Audit and visible bugfix

Confirm status rendering, security, audit, performance, and route behavior. Ship the frontend state-contract fix as a standalone PR. Add regression tests before broader V2 work.

### Phase 1 — Foundations

Consolidate tournament state; extend the existing permission model; harden veto routes; fill audit gaps; bound public projections; establish cache-tag coverage. Implement process-safe realtime here or make it a gated prerequisite to Phase 7.

### Phase 2 — Player identity

Create players and game accounts; dual-write behind a feature flag; build candidate backfill and manual merge tooling; obtain an upstream PUUID/Discord-ID contract. Do not change public reads until reconciliation metrics are acceptable.

### Phase 3 — Player and team profiles

Build public profiles, search, saved-team links, and leaderboard linkage over the identity layer. Phase 3 and Phase 5 are independent after Phase 2 interfaces stabilize.

### Phase 4 — Registration V2

Add roster-change requests and player-backed roster selection while preserving `SavedTeam`, snapshots, waitlist, payment, reservation, and current URLs.

### Phase 5 — LAN operations

Add venues/stations, assignment, check-in, referee panel, typed results, disputes, penalties, and evidence. Referee authority is explicit: LAN referee authoritative; online captain submit → opponent confirm or dispute.

### Phase 6 — Control Centre

Compose existing admin routes into tournament-scoped operational views and add only the new check-in/station/referee/dispute/broadcast modules.

### Phase 7 — Broadcast

Only after shared fan-out/replay or durable polling is proven. Add broadcast state, read-only API, overlays, and the edge-only Spectra adapter.

### Phase 8 — Community

Add Quest rankings, achievements, LFT/LFP, profile histories, and media linking after player identity and approved outcomes are stable.

## 34. Task breakdown

Each task below is independently mergeable, has at most one migration, and must be reviewed against the global constraints. Migration PRs are separate from reader/API PRs. Exact migration directory names are proposed names and must be reserved before implementation.

### Phase 0 — Audit

#### V2-P0-001 — Consolidate tournament status contract

- **Objective:** Replace the overlapping frontend registration-state unions with separate event aggregate and tournament registration types.
- **Why:** `frontend/lib/tournaments.ts:144,156,300` and `event-utils.ts:19-58` allow event state to be confused with child registration state.
- **Existing files:** `frontend/lib/tournaments.ts`, `frontend/lib/event-utils.ts`, `frontend/components/tournaments/event/EventTournamentList.tsx:26-28`, `frontend/components/tournaments/TournamentDetailsContent.tsx:272-275`, `frontend/components/tournaments/RegisterTournamentButton.tsx:151-225`, `backend/src/modules/tournaments/registration-state.js`, `backend/src/modules/tournaments/tournament.service.js:614-618`.
- **Files likely changed:** The listed frontend type/helper/component files and their focused tests; no backend behavior change.
- **Database changes:** None.
- **API changes:** None; consume existing `registrationState`, `registrationAction`, and boolean fields.
- **Frontend changes:** Make child labels/buttons use one canonical `TournamentRegistrationState`; keep event aggregate labels separate and scoped.
- **Mobile-admin impact:** None.
- **Migration + backfill:** None.
- **Backwards compatibility:** Preserve `/events/[slug]`, `/tournaments/[slug]`, `/tournaments/[slug]/register`, and all existing button/payment flows.
- **Tests:** `Set-Location frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e:local` plus focused cases for closed event/open child, waitlist-open child, and one-child/one-label invariants.
- **Manual verification:** Compare event card, tournament detail, register button, waitlist, and already-registered states against SSR payloads.
- **Security considerations:** Do not make the frontend state gate authoritative; retain backend checks.
- **Rollback:** Revert the frontend-only PR; no data rollback.
- **Dependencies:** None.
- **Do not touch:** Backend state machine, payment, registration, or schema.
- **Acceptance criteria:** TypeScript has no ambiguous registration union; a child never renders both closed and waitlist-open labels from one payload; personal “Checking…” remains distinct from tournament state.

#### V2-P0-002 — Bound public projections and cache tags

- **Objective:** Bound public participant and album projections and audit `foundation` invalidation coverage.
- **Why:** `tournament.service.js:709-740` and album detail queries can return unbounded data; stale foundation tags can survive mutation paths.
- **Existing files:** `backend/src/modules/tournaments/tournament.service.js`, `backend/src/modules/media/event-album.service.js`, `backend/src/middleware/response-cache.js`, `backend/src/routes/v1.js:26-35,123-169`.
- **Files likely changed:** Public query services, cache invalidation helpers, backend tests, and media projection tests.
- **Database changes:** None.
- **API changes:** Preserve routes; if pagination is added, make query parameters optional and backward-compatible with bounded defaults.
- **Frontend changes:** Consume pagination/summary fields only if API evidence requires it; no visual redesign.
- **Mobile-admin impact:** None unless an existing admin endpoint's response shape changes; public projection changes must not affect mobile.
- **Migration + backfill:** None.
- **Backwards compatibility:** Existing public URLs and first-page response shape remain valid; never remove legacy fields in this task.
- **Tests:** `Set-Location backend; npm run lint; npm test; npm run test:coverage; npm run test:integration`.
- **Manual verification:** Load a tournament/event with large registration and album counts; inspect payload size, query count, cache refresh after each mutation family.
- **Security considerations:** Do not expose private registration/member fields while changing projection bounds.
- **Rollback:** Disable pagination/summary flag and restore prior cache helper; no schema rollback.
- **Dependencies:** V2-P0-001 is logically independent but should land before frontend consumers.
- **Do not touch:** Payment, ticket, shop, or registration write semantics.
- **Acceptance criteria:** Public payloads have bounded defaults, cache invalidation coverage is enumerated by mutation, and no public URL breaks.

#### V2-P0-003 — Audit and security coverage baseline

- **Objective:** Produce operation-by-operation audit coverage tests and close confirmed privileged-mutation gaps.
- **Why:** Registration status is audited, but roster edits, reconciliation, veto overrides, and future privileged operations are not uniformly evidenced.
- **Existing files:** `backend/src/modules/admin/admin.service.js:89-110`, `backend/src/modules/admin/admin.routes.js`, `backend/src/modules/veto/veto.service.js`, payment/upload/security/rate-limit modules.
- **Files likely changed:** A shared audit helper, admin/veto/payment/roster mutation services, and backend security tests.
- **Database changes:** None.
- **API changes:** No public contract changes; unauthorized paths should return existing auth/permission status codes.
- **Frontend changes:** None.
- **Mobile-admin impact:** None.
- **Migration + backfill:** None; historical missing audit events cannot be invented.
- **Backwards compatibility:** Existing admin and staff workflows remain available with additional audit side effects.
- **Tests:** `Set-Location backend; npm run lint; npm test; npm run test:coverage; npm run test:integration` and the required OAuth link/unlink, match-room, veto, payment, and ticket regressions.
- **Manual verification:** Execute registration approval, payment reconciliation, roster edit, veto override, and unauthorized variants; inspect redacted audit rows.
- **Security considerations:** Redact sessions, OAuth grants, PayHere signatures, secrets, encrypted ID ciphertext, and private upload contents.
- **Rollback:** Disable new audit enforcement only for non-critical writes; privileged override paths fail closed if audit cannot be recorded.
- **Dependencies:** None.
- **Do not touch:** Audit schema or production history in this task.
- **Acceptance criteria:** Required privileged mutations have actor/target/before/after/request/IP evidence; no secret appears in audit/log tests.

#### V2-P0-004 — Harden veto route middleware

- **Objective:** Add route-level defense-in-depth while retaining service-level veto authorization.
- **Why:** `v1.js:92-110` uses only `requireAuth`; authorization is delayed to `veto.service.js`.
- **Existing files:** `backend/src/routes/v1.js:92-110`, `backend/src/modules/permissions/permission.middleware.js`, `backend/src/modules/veto/veto.service.js:300-371,461-500,659-687`.
- **Files likely changed:** Veto route definitions, permission middleware wiring, and authorization tests.
- **Database changes:** None.
- **API changes:** Unauthorized requests fail earlier with the existing permission response; valid team/grant flows remain unchanged.
- **Frontend changes:** None.
- **Mobile-admin impact:** None.
- **Migration + backfill:** None.
- **Backwards compatibility:** Preserve `/veto/[code]`, grants, public room access, and admin room UI.
- **Tests:** `Set-Location backend; npm run lint; npm test; npm run test:integration` with wrong-team, expired-grant, staff, super-admin, and public-token cases.
- **Manual verification:** Exercise public veto actions and admin override as each supported role.
- **Security considerations:** Keep service checks; never trust route middleware alone for code-based room access.
- **Rollback:** Revert route guard wiring; service authorization remains.
- **Dependencies:** V2-P0-003 audit tests should cover override paths.
- **Do not touch:** Veto schema or public veto code format.
- **Acceptance criteria:** Invalid callers are rejected at route/service boundaries and all valid existing veto flows pass.

### Phase 1 — Foundations

#### V2-P1-001 — Add scoped tournament permissions

- **Objective:** Extend the existing two-layer RBAC model for check-in, stations, results, disputes, and broadcast operations.
- **Why:** V2 needs least-privilege operations without replacing `TournamentStaffAssignment`.
- **Existing files:** `backend/src/modules/permissions/permission.middleware.js`, `backend/src/modules/auth/auth.middleware.js`, `backend/src/modules/admin/admin.routes.js`, `backend/prisma/schema.prisma` staff models.
- **Files likely changed:** Permission constants/middleware, staff checks, permission tests, Prisma schema and migration.
- **Database changes:** `20260822100000_add_tournament_staff_permissions`; additive enum/permission values only.
- **API changes:** Existing staff-protected routes gain narrowly scoped checks; new route contracts are deferred to feature tasks.
- **Frontend changes:** None.
- **Mobile-admin impact:** None unless a future API exposes new staff permissions.
- **Migration + backfill:** Deploy enum values before code reads them; no data backfill.
- **Backwards compatibility:** Existing `tournament_admin` and `referee` assignments retain access.
- **Tests:** `Set-Location backend; npm run prisma:migrate:status; npm run prisma:security:verify; npm test; npm run test:integration`.
- **Manual verification:** Test old staff assignments and new permission scopes against one tournament and another tournament.
- **Security considerations:** Default deny unknown scopes; do not infer tournament scope from client input without loading assignment.
- **Rollback:** Feature-flag new checks; use forward migration repair rather than deleting enum values.
- **Dependencies:** V2-P0-003.
- **Do not touch:** Global user role semantics or OAuth/session models.
- **Acceptance criteria:** Existing staff behavior passes and new operation scopes can be enforced without global-admin escalation.

#### V2-P1-002 — Make realtime cluster-safe — **DONE (shipped)**

> Shipped as `docs/superpowers/plans/2026-08-22-realtime-cluster-safe-implementation.md`.
> `backend/src/modules/realtime/realtime.transport.js` (Upstash pub/sub, reconnect
> backoff, payload caps), commits `9579994` and `9b90b2e` plus hardening through
> `3719d22`, smoke script `backend/scripts/realtime-cluster-smoke.js`. The acceptance
> criterion — an event published on worker A reaches clients on worker B — is met.
> **Phase 7 (broadcast) is therefore no longer gated on this task.**

- **Objective:** Replace process-local-only SSE fan-out with shared delivery and reconnect-safe state observation.
- **Why:** `realtime.service.js:9-23` cannot fan out across PM2 workers; reconnects have no replay cursor.
- **Existing files:** `backend/src/modules/realtime/realtime.service.js`, `realtime.controller.js`, Redis/cache configuration, API process-count deployment settings.
- **Files likely changed:** Realtime service/controller, Redis adapter, configuration docs, and integration tests.
- **Database changes:** None.
- **API changes:** Preserve `GET /api/v1/events`; add optional event version/`Last-Event-ID` semantics without breaking EventSource clients.
- **Frontend changes:** Existing consumers may use replay/polling fallback; no overlay page yet.
- **Mobile-admin impact:** None unless mobile consumes SSE; verify and preserve existing behavior.
- **Migration + backfill:** None; Redis channels and durable version fallback are runtime changes.
- **Backwards compatibility:** Keep heartbeats, retry behavior, topic filters, connection caps, and 204 disabled behavior.
- **Tests:** `Set-Location backend; npm run lint; npm test; npm run test:integration` with two worker processes and reconnect gaps.
- **Manual verification:** Run two API processes, connect clients to each, publish from one, restart one worker, and verify eventual state recovery.
- **Security considerations:** Authenticate private topics, cap subscriptions, and never broadcast secrets/private registration data.
- **Rollback:** Feature flag back to process-local delivery only for single-process emergency operation; broadcast remains disabled until shared delivery returns.
- **Dependencies:** Upstash Redis availability when `API_PROCESS_COUNT > 1`.
- **Do not touch:** Public overlay routes; they belong to Phase 7.
- **Acceptance criteria:** An event published on worker A reaches clients on worker B or clients recover it from a versioned/polling source.

#### V2-P1-003 — Add mutation cache-tag matrix

- **Objective:** Centralize and test `foundation` invalidation for tournament, registration, series, team, match, bracket, media-publication, and admin mutations.
- **Why:** Explicit invalidation is currently distributed and omissions leave public projections stale until TTL.
- **Existing files:** `backend/src/routes/v1.js:123-169`, admin routes, team/challonge services, response-cache middleware.
- **Files likely changed:** Cache helper, mutation services/routes, matrix tests, codemap notes if responsibility changes.
- **Database changes:** None.
- **API changes:** None.
- **Frontend changes:** None.
- **Mobile-admin impact:** None.
- **Migration + backfill:** None.
- **Backwards compatibility:** Preserve existing cache TTL and response shapes.
- **Tests:** `Set-Location backend; npm run lint; npm test; npm run test:integration` with successful and failed mutations.
- **Manual verification:** Mutate each operation family and confirm public cache changes immediately after 2xx.
- **Security considerations:** Never invalidate or expose private cache entries through public tags.
- **Rollback:** Restore prior explicit invalidation calls.
- **Dependencies:** V2-P0-002.
- **Do not touch:** Redis topology or unrelated shop cache behavior.
- **Acceptance criteria:** A maintained matrix maps each public projection mutation to its invalidation tag and tests fail on omissions.

### Phase 2 — Player identity

#### V2-P2-001 — Create players and game accounts

- **Objective:** Add Quest-owned QPID players and durable game-account links.
- **Why:** Current identity is duplicated across optional user links and mutable email/Discord/Riot strings.
- **Existing files:** `backend/prisma/schema.prisma:315-363,936-1009,1318-1348,1490-1518`; nearest `backend/prisma/codemap.md`.
- **Files likely changed:** Prisma schema, migration, generated client, schema tests, feature-flag configuration docs.
- **Database changes:** `20260822110000_add_players_and_game_accounts`; `players` with UUID and QPID sequence, nullable `userId`; `game_accounts` with unique `(game, externalId)` and cached display fields.
- **API changes:** None in the migration PR.
- **Frontend changes:** None.
- **Mobile-admin impact:** None.
- **Migration + backfill:** No data backfill in migration; deploy empty tables and verify indexes.
- **Backwards compatibility:** Existing tables and strings remain unchanged and nullable links are absent.
- **Tests:** `Set-Location backend; npm run prisma:migrate:status; npm run prisma:security:verify; npm test`.
- **Manual verification:** Create claimed and unclaimed players, duplicate game-account rejection, QPID formatting, and transaction rollback.
- **Security considerations:** QPID is public, internal UUID is not; enforce access to claim/merge operations.
- **Rollback:** Disable feature flag; do not drop tables after references exist; use forward repair/backup restore under approval.
- **Dependencies:** V2-P1 foundations.
- **Do not touch:** Leaderboard ownership, roster rows, or public profile pages.
- **Acceptance criteria:** Additive schema deploys with zero existing-row mutation and durable uniqueness for PUUID per game.

#### V2-P2-002 — Add nullable player links to roster models

- **Objective:** Add optional player references to saved and historical roster records without changing snapshot semantics.
- **Why:** New registrations can link players while old rows remain auditable free-text snapshots.
- **Existing files:** `SavedTeamMember`, `RegistrationMember`, `TeamRegistration` schema and services.
- **Files likely changed:** Prisma schema/migration, registration/team serializers, schema tests.
- **Database changes:** `20260822120000_add_player_links_to_rosters`; nullable `playerId` on `SavedTeamMember` and `RegistrationMember`; no destructive column removal.
- **API changes:** Add nullable player IDs only to authenticated/admin responses that already expose the corresponding member; do not remove legacy fields.
- **Frontend changes:** None in schema PR.
- **Mobile-admin impact:** Existing roster response fields remain; new nullable field is additive.
- **Migration + backfill:** No automatic backfill in migration. Candidate linking is V2-P2-003 and manual merge-reviewed.
- **Backwards compatibility:** Historical `RegistrationMember` snapshots remain unchanged even if linked to a current player.
- **Tests:** `Set-Location backend; npm run prisma:migrate:status; npm test; npm run test:integration` plus free/PayHere/bank-transfer registration and waitlist regressions.
- **Manual verification:** Confirm old registrations render with null links and new saved members can link without changing displayed historical strings.
- **Security considerations:** Player links expose identity relationships; enforce staff/user ownership and audit edits.
- **Rollback:** Null new links and disable readers; preserve legacy data.
- **Dependencies:** V2-P2-001.
- **Do not touch:** `PaymentTransaction`, `Session`, or ticket rows.
- **Acceptance criteria:** Links are nullable, history remains immutable, and all existing registration/payment/waitlist flows pass.

#### V2-P2-003 — Build candidate backfill and manual merge tooling

- **Objective:** Produce reviewable candidate matches from `userId`, `emailNormalized`, and normalized Riot ID, with explicit merge decisions.
- **Why:** Existing rows are duplicate-prone and cannot be safely auto-merged.
- **Existing files:** team/registration services, admin users/teams/registrations pages, audit and notification modules.
- **Files likely changed:** Backfill script/job, admin service/routes/UI, merge audit tests; no public page.
- **Database changes:** None.
- **API changes:** New admin-only `GET /api/v1/admin/players/merge-candidates`, `POST /api/v1/admin/players/:id/merge-preview`, `POST /api/v1/admin/players/:id/merge`; exact payloads must include source IDs, confidence, conflicts, and reason.
- **Frontend changes:** Add a scoped admin review surface under existing `/admin/`; no public profile rendering.
- **Mobile-admin impact:** None.
- **Migration + backfill:** Run in dry-run, review, then idempotent batches; never delete source roster rows; merge creates audit evidence.
- **Backwards compatibility:** Legacy fields remain and unlinked candidates remain usable.
- **Tests:** `Set-Location backend; npm test; npm run test:coverage; npm run test:integration`; `Set-Location frontend; npm run typecheck; npm test`.
- **Manual verification:** Review false-positive pairs, reject candidates, merge a known duplicate, and verify history/audit/notifications.
- **Security considerations:** Admin/super-admin only, no bulk auto-merge, redact private identifiers in list responses.
- **Rollback:** Unmerge through an explicit reversible link operation; do not erase source rows.
- **Dependencies:** V2-P2-002 and audit helper.
- **Do not touch:** Upstream leaderboard data or automatic account claims.
- **Acceptance criteria:** Every merge is human-approved, reversible at the link layer, and fully audited.

#### V2-P2-004 — Add dual-write and upstream identity adapter

- **Objective:** Create new player/game-account links for future supported flows and isolate upstream PUUID/Discord-ID resolution.
- **Why:** Quest must not import or own the external leaderboard while it gains durable links.
- **Existing files:** `backend/src/modules/valorant-leaderboard/client.js`, `service.js`, `controller.js`, `frontend/components/valorant/ValorantRegistration.tsx`.
- **Files likely changed:** VALORANT adapter/client, player service, feature flags, contract tests.
- **Database changes:** None.
- **API changes:** No external route change until upstream contract is versioned; internal adapter interface must accept `puuid` and stable Discord ID, not username-only links.
- **Frontend changes:** Keep current upstream registration UI; no public read-path switch.
- **Mobile-admin impact:** None.
- **Migration + backfill:** Dual-write only for verified new events; reconcile failures via job and audit.
- **Backwards compatibility:** Existing leaderboard proxy and registration endpoints continue unchanged.
- **Tests:** `Set-Location backend; npm test; npm run test:integration`; contract tests with upstream timeout, duplicate PUUID, missing Discord ID, and stale Riot display.
- **Manual verification:** Link a known PUUID through a manual/admin flow and confirm upstream errors do not block ordinary Quest registration.
- **Security considerations:** Verify service secret/key ID, protect PUUID linkage, and never log tokens or raw upstream payloads unnecessarily.
- **Rollback:** Disable dual-write and keep proxy-only behavior.
- **Dependencies:** V2-P2-001 through P2-003; upstream contract approval.
- **Do not touch:** Leaderboard ranking ownership or `discord_username` uniqueness.
- **Acceptance criteria:** Adapter is edge-isolated, stable-ID-only for linking, and failure-tolerant.

### Phase 3 — Profiles and leaderboard linkage

#### V2-P3-001 — Add player/profile read APIs

- **Objective:** Expose public-safe QPID/player profile and search endpoints with privacy controls.
- **Why:** Player identity becomes useful only through stable, consent-aware public surfaces.
- **Existing files:** `backend/src/routes/v1.js`, account/media/teams services, Prisma player models.
- **Files likely changed:** New `backend/src/modules/players/` router/service/controller, route composition, tests.
- **Database changes:** None.
- **API changes:** `GET /api/v1/players/:qpid`; `GET /api/v1/players?query=&game=&page=&pageSize=`. Return public display, linked teams if consented, achievements/rank summaries only.
- **Frontend changes:** None in API PR.
- **Mobile-admin impact:** None.
- **Migration + backfill:** Read only linked rows; unclaimed players remain private unless explicitly public.
- **Backwards compatibility:** No existing route changes.
- **Tests:** `Set-Location backend; npm test; npm run test:coverage; npm run test:integration`.
- **Manual verification:** Anonymous, claimed, unclaimed, hidden, and non-existent QPID cases.
- **Security considerations:** Prevent enumeration leakage, expose QPID not UUID, rate-limit search, omit private roster/contact fields.
- **Rollback:** Disable public player flag.
- **Dependencies:** V2-P2.
- **Do not touch:** Existing `/members` semantics until profile rollout is approved.
- **Acceptance criteria:** Public responses are consent-aware, bounded, stable, and cannot reveal private identity fields.

#### V2-P3-002 — Add player and team public profile pages

- **Objective:** Add profile pages using the new read API while preserving existing team management and historical views.
- **Why:** Profiles are a user-visible identity feature and must not mutate old roster behavior.
- **Existing files:** `frontend/app/members/page.tsx`, team components, `frontend/app/admin/codemap.md` only for admin links.
- **Files likely changed:** New public profile route/components, data hooks, navigation, tests.
- **Database changes:** None.
- **API changes:** Consume P3-001 only.
- **Frontend changes:** Add `/players/[qpid]` and team-profile links only after consent; retain `/members`.
- **Mobile-admin impact:** None.
- **Migration + backfill:** No page for unclaimed/private players.
- **Backwards compatibility:** Existing public URLs unchanged.
- **Tests:** `Set-Location frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e:local`.
- **Manual verification:** Responsive anonymous profile, hidden fields, linked team, old `/members`, and direct invalid QPID URL.
- **Security considerations:** SSR must not serialize private fields; authorization is server-side.
- **Rollback:** Disable navigation/feature flag, leave API available.
- **Dependencies:** V2-P3-001.
- **Do not touch:** Visual identity or unrelated admin layouts.
- **Acceptance criteria:** Existing visual language is preserved and public profile data exactly matches consent policy.

#### V2-P3-003 — Link external leaderboard display to Quest profiles

- **Objective:** Show external rank data as an attributed read-only section on linked profiles.
- **Why:** Linking must not make Quest the owner of leaderboard data.
- **Existing files:** VALORANT proxy module, player profile API/page, cache middleware.
- **Files likely changed:** Player adapter/service, profile projection, frontend profile component, contract tests.
- **Database changes:** None beyond existing game accounts.
- **API changes:** Extend `GET /api/v1/players/:qpid` with optional external leaderboard snapshot metadata; preserve 60-second upstream cache.
- **Frontend changes:** Render “VALORANT leaderboard” as external/read-only and handle unavailable/stale states.
- **Mobile-admin impact:** None.
- **Migration + backfill:** Resolve only explicit `GameAccount` PUUID links; no username matching.
- **Backwards compatibility:** Leaderboard public routes remain unchanged.
- **Tests:** Backend lint/unit/integration and frontend lint/typecheck/unit/e2e commands from Part 7.
- **Manual verification:** Linked, unlinked, upstream timeout, and changed Riot display cases.
- **Security considerations:** Do not leak upstream service secrets or allow arbitrary PUUID lookup through public input.
- **Rollback:** Hide external section, retain Quest profile.
- **Dependencies:** P2-004 and P3-001.
- **Do not touch:** Upstream database or leaderboard registration ownership.
- **Acceptance criteria:** Only explicit PUUID links render external data and failure is non-blocking.

### Phase 4 — Registration V2

#### V2-P4-001 — Create roster-change request model

- **Objective:** Add approval workflow records for Riot correction, replacement, coach/substitute changes, and team info corrections.
- **Why:** No roster-change system exists; direct historical edits would destroy registration evidence.
- **Existing files:** Tournament codemap, registration services, audit and notification modules.
- **Files likely changed:** Prisma schema/migration, new request service/types, schema tests.
- **Database changes:** `20260822130000_add_roster_change_requests`; request type/status, registration/team/player references, proposed change JSON, submitter/reviewer, reason, evidence reference, timestamps.
- **API changes:** No reader/API in migration PR.
- **Frontend changes:** None in migration PR.
- **Mobile-admin impact:** None.
- **Migration + backfill:** No backfill; old edits remain historical and cannot be fabricated as requests.
- **Backwards compatibility:** Existing registration records remain valid.
- **Tests:** `Set-Location backend; npm run prisma:migrate:status; npm test; npm run test:integration`.
- **Manual verification:** Validate state transitions and uniqueness/idempotency constraints.
- **Security considerations:** Proposed values may contain PII; limit access and redact audit payloads.
- **Rollback:** Disable intake; retain submitted requests for forward repair.
- **Dependencies:** Player links and audit helper.
- **Do not touch:** Existing registration rows or payment state.
- **Acceptance criteria:** Request lifecycle is additive, explicit, auditable, and cannot mutate history directly.

#### V2-P4-002 — Add roster request APIs and notifications

- **Objective:** Implement submit, review, approve, reject, and withdraw operations using existing permissions, audit, and notifications.
- **Why:** The model alone does not protect roster history or inform affected users.
- **Existing files:** `backend/src/modules/tournaments/`, admin routes, notifications, audit, permission middleware.
- **Files likely changed:** Request service/controller/routes, admin service/UI integration, notification templates, tests.
- **Database changes:** None.
- **API changes:** `POST /api/v1/tournaments/:tournamentId/roster-change-requests`; `GET /api/v1/tournaments/:tournamentId/roster-change-requests`; `POST /api/v1/roster-change-requests/:id/approve`; `POST .../:id/reject`; `POST .../:id/withdraw`.
- **Frontend changes:** Authenticated registration/admin review surfaces; no public profile rendering.
- **Mobile-admin impact:** API contract changes affect mobile only if mobile consumes tournament registration/admin routes; update types or state “none” after contract audit.
- **Migration + backfill:** Operates only on new requests; approval creates a new snapshot/version, never overwrites old snapshot.
- **Backwards compatibility:** Existing `/tournaments/[slug]/register` remains usable without requests.
- **Tests:** Backend full commands plus frontend lint/typecheck/unit; required registration/waitlist/reservation regressions.
- **Manual verification:** Submit correction, approve replacement, reject coach removal, withdraw, inspect notification and audit.
- **Security considerations:** Staff scope, actor conflict checks, input validation, evidence authorization, rate limits.
- **Rollback:** Disable request endpoints and leave records immutable/read-only.
- **Dependencies:** P4-001, P1 RBAC/audit, P2 player links.
- **Do not touch:** Payment or ticket records.
- **Acceptance criteria:** Only authorized reviewers can approve; historical roster rows remain immutable and users are notified.

#### V2-P4-003 — Add player-backed registration eligibility

- **Objective:** Use optional player/game-account links in new registration validation without replacing existing captain email/Riot checks.
- **Why:** PUUID-aware validation is the main consumer of player identity, but legacy registrations must remain valid.
- **Existing files:** `registration.service.js`, `registration-eligibility.js`, `role-conflict.service.js`, `coach.validation.js`, registration components.
- **Files likely changed:** Backend eligibility/service, registration API serializers, tests.
- **Database changes:** None; use P4-001 schema already deployed.
- **API changes:** Add optional player IDs/validation diagnostics to registration payloads; reject only proven duplicate/conflict links, not unmatched legacy strings.
- **Frontend changes:** Authenticated roster selection may offer linked players; keep manual legacy entry fallback during feature flag.
- **Mobile-admin impact:** Update mobile types only if its registration/admin API client consumes the changed payload; otherwise none.
- **Migration + backfill:** Dual validation; no historical data rewrite.
- **Backwards compatibility:** Free, PayHere, bank-transfer, waitlist, reservation, and existing captain email behavior remain supported.
- **Tests:** All backend commands in Part 7, especially registration E2E, waitlist promotion, reservation expiry, and coverage thresholds.
- **Manual verification:** Linked duplicate PUUID, unlinked legacy Riot ID, coach/player conflict, waitlist full, and payment paths.
- **Security considerations:** Backend remains authority; do not accept client-supplied player ownership without authorization.
- **Rollback:** Disable player-aware validation and return to legacy checks.
- **Dependencies:** P2, P4-002.
- **Do not touch:** `TeamRegistration` uniqueness semantics without a separate approved migration.
- **Acceptance criteria:** Linked identity improves validation, but no existing valid registration/payment flow is blocked solely by missing player linkage.

#### V2-P4-004 — Add roster selection UI

- **Objective:** Let users select saved, linked players for registration while preserving historical snapshot submission.
- **Why:** Registration V2 should extend `SavedTeam`, not create a parallel team flow.
- **Existing files:** `frontend/components/tournament-registration/ConfiguredTournamentRegistrationForm.tsx`, registration/team components, event/tournament routes.
- **Files likely changed:** Registration form components/hooks/tests.
- **Database changes:** None.
- **API changes:** Consume P4-003; no new route.
- **Frontend changes:** Feature-flagged saved-team/player picker, explicit snapshot confirmation, graceful fallback to current manual fields.
- **Mobile-admin impact:** None; this is a web registration surface.
- **Migration + backfill:** None.
- **Backwards compatibility:** Preserve `/tournaments/[slug]/register` and payment/resume URLs.
- **Tests:** `Set-Location frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e:local` and backend contract tests.
- **Manual verification:** Anonymous, signed-in, unlinked saved team, waitlist, payment resume, and roster-change paths.
- **Security considerations:** Never trust client roster selection; server rechecks membership and eligibility.
- **Rollback:** Disable picker and use existing form.
- **Dependencies:** P4-003.
- **Do not touch:** Event card/detail status layout beyond the P0 fix.
- **Acceptance criteria:** Users can opt into linked roster selection and existing manual registration remains fully functional.

### Phase 5 — LAN operations

#### V2-P5-001 — Add venues, stations, and assignments

- **Objective:** Model physical LAN resources and assign matches without losing legacy station text.
- **Why:** `Match.station` is free text and LAN operations are currently greenfield.
- **Existing files:** Match schema/service/admin routes/UI; `backend/prisma/codemap.md`; admin codemap.
- **Files likely changed:** Prisma schema/migration, venue/station/assignment service, admin API tests.
- **Database changes:** `20260822140000_add_venues_stations_assignments`; new Venue/Station/StationAssignment and nullable `Match.stationId`; retain `Match.station`.
- **API changes:** Migration PR none; later APIs are `GET/POST/PATCH /api/v1/admin/venues`, `GET/POST/PATCH /api/v1/admin/venues/:venueId/stations`, and `POST/PATCH /api/v1/admin/matches/:matchId/station-assignment`.
- **Frontend changes:** None in migration PR.
- **Mobile-admin impact:** New admin API must be added to mobile only if mobile is approved as an operations client; otherwise none explicitly.
- **Migration + backfill:** Exact-safe station text backfill is a reviewed job after migration; unmatched text remains.
- **Backwards compatibility:** Match views fall back to legacy `station` text.
- **Tests:** Backend migration status/security verify, unit/integration, and match-room permission regressions.
- **Manual verification:** Create venue/stations, assign/reassign a match, deactivate station, inspect history and legacy match.
- **Security considerations:** Venue/station mutation is staff-scoped and audited; prevent overlapping active assignments.
- **Rollback:** Disable assignment UI/API and use legacy station text.
- **Dependencies:** P1 permissions/audit.
- **Do not touch:** Existing match status transitions or public bracket URLs.
- **Acceptance criteria:** Station assignment is historical and conflict-safe; old matches render unchanged.

#### V2-P5-002 — Add team/player check-ins

- **Objective:** Track expected and actual LAN arrival for teams and players, linked to matches and stations.
- **Why:** Spectator `TicketScan` is not team/player operational check-in.
- **Existing files:** Match status/match service, admin routes/UI, ticket models only for boundary comparison.
- **Files likely changed:** Prisma schema/migration, check-in service/routes/tests, admin operation components.
- **Database changes:** `20260822150000_add_check_ins`; check-in subject/status/timestamps/station/actor/evidence and tournament/match indexes.
- **API changes:** `GET /api/v1/tournaments/:tournamentId/check-ins`; `POST /api/v1/matches/:matchId/check-ins`; `PATCH /api/v1/check-ins/:id`.
- **Frontend changes:** Admin/referee check-in queue; no spectator ticket UI change.
- **Mobile-admin impact:** Contract change affects mobile only if mobile becomes an operations client; state none pending that decision.
- **Migration + backfill:** No historical spectator scan backfill; existing `check_in_open`/deadline remains source for windows.
- **Backwards compatibility:** Existing Match status and ticket scans remain independent.
- **Tests:** Backend full suite plus ticket QR scan and match-room permission regressions; frontend tests for admin queue.
- **Manual verification:** Open/closed deadline, early/late arrival, wrong team, duplicate scan, station display.
- **Security considerations:** Staff scope, idempotency, actor audit, no public PII payload.
- **Rollback:** Disable operational check-in and retain records.
- **Dependencies:** P5-001 and P1 permissions.
- **Do not touch:** `TicketScan` or spectator ticket order state.
- **Acceptance criteria:** Team/player check-ins are independently queryable and correctly follow match check-in windows.

#### V2-P5-003 — Add referee panel over existing match/veto APIs

- **Objective:** Build a restricted referee UI for assigned matches, check-in, rooms, veto, result submission, and evidence.
- **Why:** Referee role and services already exist; missing capability is a focused operational surface, not a subsystem.
- **Existing files:** `frontend/app/admin/`, `Match.assignedStaffId`, permission middleware, match-room/veto services, P5 APIs.
- **Files likely changed:** Admin referee route/components, server data loaders, permission-aware tests.
- **Database changes:** None.
- **API changes:** Consume existing match/veto/check-in APIs; result/dispute endpoints come from P5-004/P5-005.
- **Frontend changes:** Add `/admin/referee` and match-scoped panels within existing admin route conventions.
- **Mobile-admin impact:** None unless explicitly made a supported referee client.
- **Migration + backfill:** None.
- **Backwards compatibility:** Existing admin tournament and match pages remain.
- **Tests:** `Set-Location frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e:local` plus backend permission tests.
- **Manual verification:** Referee, tournament admin, super-admin, unrelated referee, and captain views.
- **Security considerations:** UI hiding is not authorization; every API call must enforce match staff scope.
- **Rollback:** Hide route behind feature flag.
- **Dependencies:** P1 permissions, P5-001/002, existing match/veto APIs.
- **Do not touch:** Existing public match-room/veto layout.
- **Acceptance criteria:** Referees see only authorized operational work and can reach existing rooms without privilege escalation.

#### V2-P5-004 — Add typed match-game results

- **Objective:** Model one row per map/game and define authoritative LAN/online result workflows while preserving legacy score JSON.
- **Why:** Match and map are distinct, and `scoreData`/`winnerSlot` are currently untyped.
- **Existing files:** `Match`, `MatchParticipant`, match service/routes, Challonge sync, referee/admin components.
- **Files likely changed:** Prisma schema/migration, result service/routes, serializers, referee/admin tests.
- **Database changes:** `20260822160000_add_match_games_and_result_records`; new `MatchGame` plus additive result metadata/indexes; keep legacy fields.
- **API changes:** `POST /api/v1/matches/:matchId/result-submissions`; `POST /api/v1/match-result-submissions/:id/confirm`; `POST .../:id/dispute`; `POST /api/v1/admin/matches/:matchId/result-override`.
- **Frontend changes:** Referee result form; online captain submit/opponent confirm/dispute controls in existing match surfaces.
- **Mobile-admin impact:** API contract changes require `mobile-admin` typecheck/tests if mobile consumes match results; otherwise none explicitly.
- **Migration + backfill:** Dual-write new results for new matches; reconcile old JSON only through reviewed parser, never assume map boundaries.
- **Backwards compatibility:** Read legacy `scoreData`, `winnerSlot`, participant score/result until a match is fully reconciled.
- **Tests:** Backend full commands plus veto/match-room/registration regressions; frontend full commands; mobile commands if contract is consumed.
- **Manual verification:** LAN referee authority, online captain/opponent, dispute, override with reason, partial map series, Challonge sync.
- **Security considerations:** Only referee/assigned staff can finalize LAN; online confirmation cannot bypass eligibility; audit every override.
- **Rollback:** Disable typed-read flag and use legacy fields; keep new rows.
- **Dependencies:** P5-003, P1 audit, existing bracket/match flows.
- **Do not touch:** Challonge schema or public bracket URLs.
- **Acceptance criteria:** LAN authority and online confirmation/dispute are explicit; old matches remain readable; MATCH ≠ MAP is represented.

#### V2-P5-005 — Add disputes, penalties, and evidence

- **Objective:** Add controlled dispute and sanction workflows for result, registration, roster, and operational incidents.
- **Why:** Referee panel lacks the missing authority, evidence, and sanction model.
- **Existing files:** Match/registration/admin services, media/upload boundaries, audit/notification modules.
- **Files likely changed:** Prisma schema/migration, dispute/penalty services/routes, admin/referee components, tests.
- **Database changes:** `20260822170000_add_disputes_penalties`; dispute, penalty, and evidence-reference tables with scoped status/indexes.
- **API changes:** `POST /api/v1/disputes`; `GET /api/v1/tournaments/:tournamentId/disputes`; `POST /api/v1/disputes/:id/resolve`; `POST /api/v1/penalties`; `POST /api/v1/penalties/:id/revoke`.
- **Frontend changes:** Restricted referee/admin dispute queue and evidence attachment controls.
- **Mobile-admin impact:** None unless mobile is approved for referee operations.
- **Migration + backfill:** No retroactive disputes; existing audit entries remain the historical source.
- **Backwards compatibility:** No automatic change to old match results or registrations.
- **Tests:** Backend full commands, coverage, integration, upload boundary tests, and notification tests; frontend full commands.
- **Manual verification:** Submit, assign, resolve, reject, sanction, revoke, notification, audit, and private-evidence access.
- **Security considerations:** Evidence must use private upload root and authorization; sanctions require reason, actor, and audit.
- **Rollback:** Disable new mutations; preserve resolved records and public eligibility fallback.
- **Dependencies:** P1 audit/permissions, P5-004, upload boundary review.
- **Do not touch:** Public gallery/media URLs or spectator ticket disputes.
- **Acceptance criteria:** Every resolution/sanction is scoped, reviewable, auditable, reversible through explicit action, and privacy-safe.

### Phase 6 — Control Centre

#### V2-P6-001 — Compose tournament operations navigation

- **Objective:** Add tournament-context navigation and permissions around existing admin modules.
- **Why:** Control Centre must extend `frontend/app/admin/`, not create a parallel system.
- **Existing files:** `frontend/app/admin/codemap.md`, existing 25 admin routes, admin layout/navigation.
- **Files likely changed:** Admin layout/nav, route guards, feature-flag config, navigation tests.
- **Database changes:** None.
- **API changes:** None; use existing route loaders.
- **Frontend changes:** Add links/context for registration, payments, teams, matches, rooms, veto, check-in, stations, referees, disputes, and broadcast.
- **Mobile-admin impact:** None.
- **Migration + backfill:** None.
- **Backwards compatibility:** Every existing admin URL remains directly reachable.
- **Tests:** `Set-Location frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e:local`.
- **Manual verification:** Role-specific navigation and direct URL access for super-admin, tournament admin, referee, and ordinary user.
- **Security considerations:** Navigation is advisory; server guards remain authoritative.
- **Rollback:** Revert navigation flag.
- **Dependencies:** Phase 1 and Phase 5 API surfaces.
- **Do not touch:** Existing public visual identity or mobile navigation.
- **Acceptance criteria:** A staff member can move through a tournament operation without duplicate admin pages or privilege leakage.

#### V2-P6-002 — Add operational queues

- **Objective:** Add check-in, station, referee, dispute, and penalty modules to the existing admin surface.
- **Why:** These are the genuinely new Control Centre modules.
- **Existing files:** Existing admin components/routes, P5 APIs, admin codemap.
- **Files likely changed:** New admin module components/pages under existing conventions and tests.
- **Database changes:** None.
- **API changes:** Consume P5 APIs; no new contract unless a queue-specific bounded projection is needed.
- **Frontend changes:** Feature-flagged queues with filters, pagination, status, and deep links to existing detail surfaces.
- **Mobile-admin impact:** None unless mobile scope is expanded.
- **Migration + backfill:** None.
- **Backwards compatibility:** Existing admin pages remain source of truth.
- **Tests:** Frontend lint/typecheck/unit/e2e; backend contract tests for queue projections.
- **Manual verification:** Large queue, empty queue, unauthorized direct link, stale update/reload, and responsive admin layout.
- **Security considerations:** Never rely on client filters for scope; do not include private evidence in list payloads.
- **Rollback:** Disable each module independently.
- **Dependencies:** P5 operations and P6-001.
- **Do not touch:** Public pages.
- **Acceptance criteria:** Each new queue is bounded, scoped, actionable, and links into existing APIs without duplicated state.

### Phase 7 — Broadcast

#### V2-P7-001 — Create durable broadcast state

- **Objective:** Store public-safe, versioned broadcast snapshots for selected tournament/match state.
- **Why:** Overlays need durable state, not fragile process-local event delivery.
- **Existing files:** Realtime, match/tournament services, broadcast codemap location under backend modules.
- **Files likely changed:** Prisma schema/migration, broadcast projection service, event source tests.
- **Database changes:** `20260822180000_add_broadcast_state`; versioned snapshots, source event/version, public-safe payload, retention indexes.
- **API changes:** None in migration PR.
- **Frontend changes:** None in migration PR.
- **Mobile-admin impact:** None.
- **Migration + backfill:** Initialize only newly opted-in tournaments; no historical broadcast reconstruction.
- **Backwards compatibility:** Existing match/tournament APIs unchanged.
- **Tests:** Backend migration status/security verify, unit/integration, and projection consistency tests.
- **Manual verification:** Publish match/check-in/result changes and inspect monotonically increasing state version.
- **Security considerations:** Allow-list public fields; never serialize private roster/evidence/staff data.
- **Rollback:** Disable projection writer and retain snapshots.
- **Dependencies:** P1-002 shared realtime and Phase 5 result/check-in state.
- **Do not touch:** Spectra integration or public overlay routes.
- **Acceptance criteria:** Broadcast state can be rebuilt/read by version and remains correct across worker restarts.

#### V2-P7-002 — Add read-only broadcast API and overlays

- **Objective:** Expose public broadcast state and browser-source overlay routes.
- **Why:** Broadcasters need a stable read-only boundary separate from admin APIs.
- **Existing files:** Backend v1 route composition, frontend app conventions, broadcast service.
- **Files likely changed:** `backend/src/modules/broadcast/`, v1 route, overlay pages/components, tests.
- **Database changes:** None.
- **API changes:** `GET /api/v1/broadcast/tournaments/:tournamentId/state`; `GET /api/v1/broadcast/matches/:matchId/state`; optional `GET /api/v1/broadcast/.../events` using replay-safe delivery.
- **Frontend changes:** Add `/overlay/tournament/[id]` and `/overlay/match/[id]` browser sources, feature-flagged and read-only.
- **Mobile-admin impact:** None.
- **Migration + backfill:** Read current broadcast snapshots only.
- **Backwards compatibility:** No existing public URLs changed.
- **Tests:** Backend full commands; frontend full commands; multi-process SSE/reconnect integration.
- **Manual verification:** OBS browser-source load, worker restart, reconnect, stale state, invalid ID, and public field audit.
- **Security considerations:** Public-safe projection, rate limits, cache headers, no write endpoints in overlay surface.
- **Rollback:** Disable overlay routes/flag; normal tournament pages continue.
- **Dependencies:** P7-001 and P1-002.
- **Do not touch:** Spectra-specific code.
- **Acceptance criteria:** Overlay recovers after disconnect/worker restart and never requires an admin session.

#### V2-P7-003 — Add edge-only Spectra adapter

- **Objective:** Integrate optional Spectra transport behind an isolated adapter.
- **Why:** Spectra is entirely greenfield and must not couple core Quest operations to an external vendor.
- **Existing files:** VALORANT client pattern, broadcast service, deployment env conventions.
- **Files likely changed:** New adapter/client, config validation, contract tests, operator docs.
- **Database changes:** None.
- **API changes:** Internal adapter only; no Spectra calls from public or core match services.
- **Frontend changes:** None; overlays consume Quest broadcast state.
- **Mobile-admin impact:** None.
- **Migration + backfill:** None.
- **Backwards compatibility:** Broadcast works with adapter disabled.
- **Tests:** Backend lint/unit/integration with disabled, timeout, retry, malformed response, and secret-redaction cases.
- **Manual verification:** Enable adapter in non-production, publish a state, inspect retry and graceful degradation.
- **Security considerations:** Separate secret, allow-listed outbound base URL, no vendor payload logging, circuit breaker/timeouts.
- **Rollback:** Disable adapter flag; overlays remain Quest-state-only.
- **Dependencies:** P7-002 and vendor contract approval.
- **Do not touch:** Core tournament result transactions.
- **Acceptance criteria:** Spectra outage cannot block match operations or make overlays unavailable when Quest state is healthy.

### Phase 8 — Community

#### V2-P8-001 — Add Quest ranking seasons and points

- **Objective:** Add configurable Quest tournament rankings for players and teams based on approved outcomes.
- **Why:** External VALORANT rankings should remain separate from Quest competitive history.
- **Existing files:** Player/team/registration/match result services and admin route conventions.
- **Files likely changed:** Prisma schema/migration, ranking service/routes, admin configuration tests.
- **Database changes:** `20260822190000_add_rankings_and_achievements`; seasons, point rules, player/team standings, immutable awards/source references.
- **API changes:** `GET /api/v1/rankings/players`; `GET /api/v1/rankings/teams`; admin CRUD routes for seasons/rules.
- **Frontend changes:** None in schema/API PR.
- **Mobile-admin impact:** None unless mobile consumes rankings.
- **Migration + backfill:** Start a new season; historical recalculation is an explicit job, not migration behavior.
- **Backwards compatibility:** External leaderboard routes unchanged.
- **Tests:** Backend full suite, coverage, integration, and deterministic scoring/recalculation tests.
- **Manual verification:** Approved result awards points once, disputed/unapproved result does not, recalculation is deterministic.
- **Security considerations:** Only approved outcomes and authorized rules can alter standings; audit rule changes.
- **Rollback:** Freeze new awards and hide rankings; retain immutable source awards.
- **Dependencies:** P5-004/P5-005 and P2 player identity.
- **Do not touch:** External leaderboard tables/service ownership.
- **Acceptance criteria:** Quest rankings are configurable, reproducible, and distinct from external rank.

#### V2-P8-002 — Add reusable achievements

- **Objective:** Attach idempotent achievement definitions/awards to players and saved teams.
- **Why:** Achievements reuse player/team identity and approved outcomes without a complex rules engine.
- **Existing files:** Player/team/ranking services, notifications, admin conventions.
- **Files likely changed:** Prisma schema/migration, achievement evaluator/service/routes, profile projections/tests.
- **Database changes:** `20260822210000_add_achievements`; definitions, awards, subject type/id, source reference, unique idempotency key.
- **API changes:** `GET /api/v1/players/:qpid/achievements`; `GET /api/v1/teams/:id/achievements`; admin definition routes.
- **Frontend changes:** Profile/team achievement sections after API approval.
- **Mobile-admin impact:** None unless mobile consumes public profiles.
- **Migration + backfill:** New definitions only; award backfill is a reviewed deterministic job.
- **Backwards compatibility:** Existing profiles/routes remain.
- **Tests:** Backend full commands and frontend full commands for public projections.
- **Manual verification:** Duplicate event, revoked source, hidden profile, team award, notification preference.
- **Security considerations:** Public consent and private source references; do not expose internal evidence.
- **Rollback:** Disable evaluator/public section, preserve awards.
- **Dependencies:** P8-001 and P3 profiles.
- **Do not touch:** External rank data.
- **Acceptance criteria:** Awards are idempotent, source-linked, privacy-safe, and reusable for player/team subjects.

#### V2-P8-003 — Evolve recruitment into LFT/LFP

- **Objective:** Add entity-backed player/team listings while preserving `/join` and privacy consent.
- **Why:** Recruitment has the current intake and privacy fields but no player/team entity linkage.
- **Existing files:** `RecruitmentApplication`, `backend/src/modules/recruitment/`, `/join`, mobile recruitment types.
- **Files likely changed:** Prisma schema/migration, recruitment service/routes, existing join form, public listing page/components, mobile types only if API contract changes.
- **Database changes:** `20260822200000_add_recruitment_entity_links`; nullable player/team/listing/game/availability/expiry/consent fields.
- **API changes:** Preserve current `/api/v1/recruitment` intake; add `GET /api/v1/recruitment/listings`, `POST /api/v1/recruitment/listings`, `PATCH /api/v1/recruitment/listings/:id` with explicit publication consent.
- **Frontend changes:** Preserve `/join`; add feature-flagged LFT/LFP listing/search surface using public-safe fields.
- **Mobile-admin impact:** Existing recruitment admin types must be checked; run mobile commands if API response types change, otherwise none.
- **Migration + backfill:** Existing applications remain private/unlinked; users explicitly create listings.
- **Backwards compatibility:** Existing `/join` privacy versioning and encrypted ID handling remain unchanged.
- **Tests:** Backend full commands, privacy/rate-limit tests; frontend full commands; mobile typecheck/test if contract changes.
- **Manual verification:** Consent absent/present, player/team listing, expiration, withdrawal, encrypted ID never public.
- **Security considerations:** Separate application privacy from public listing, rate-limit search/posting, prevent contact scraping.
- **Rollback:** Hide listing routes/UI; existing intake remains.
- **Dependencies:** P2 player identity, P3 profiles, P1 audit/rate limits.
- **Do not touch:** Encrypted applicant ID storage or unrelated support flows.
- **Acceptance criteria:** `/join` remains intact and public LFT/LFP data is explicitly consented, bounded, and entity-linked.

#### V2-P8-004 — Link histories and media safely

- **Objective:** Add optional player/team/tournament links to public histories and media without changing upload boundaries or URLs.
- **Why:** Community profiles need useful history while existing media systems are already production-ready.
- **Existing files:** Media services/models, player/team profiles, tournament projections.
- **Files likely changed:** Additive media-link service/API, profile projections, frontend components, tests.
- **Database changes:** `20260822220000_add_profile_media_links`; nullable links only, no URL replacement.
- **API changes:** Add optional public-safe history/media fields to existing profile endpoints and bounded media queries.
- **Frontend changes:** Profile history/media sections, preserving `/gallery`, `/posters`, `/match-videos`.
- **Mobile-admin impact:** None unless admin media response changes.
- **Migration + backfill:** New links only; no automatic identity inference from filenames.
- **Backwards compatibility:** Existing media URLs and galleries remain.
- **Tests:** Backend full commands; frontend full commands; upload/private-boundary regression.
- **Manual verification:** Public/private asset, deleted subject, unlinked legacy media, responsive image variants.
- **Security considerations:** Private root remains private; authorization before exposing linked assets.
- **Rollback:** Hide profile sections, preserve media rows.
- **Dependencies:** P3 profiles, P8 identity/community approval.
- **Do not touch:** Shop assets or ticket QR assets.
- **Acceptance criteria:** Histories and media are optional, bounded, consent-aware, and do not alter existing URLs.

## 35. PR strategy

- Use `fix/` for the status contract and security/cache fixes; use `feat/` for phase work; use `docs/` for plan-only changes. Reserve `quest-v2/<area>` for long-lived integration branches.
- Land V2-P0-001 as a standalone bugfix PR with no schema change.
- Land each migration in its own PR, followed by a reader/API PR after migration status and backup approval.
- Use CODEOWNERS review; GitHub Free branch protection is not enforceable.
- Keep user-visible features behind flags until phase acceptance and regression checks pass.
- Do not merge a migration and deploy it in the same window. Backend CD remains manual and owner-restricted with `MIGRATION_APPROVAL_SHA`.
- Review all production-data tasks explicitly for registration, payment, session, ticket, roster, and privacy risk.

## 36. Testing strategy

Use the repository commands exactly:

```powershell
# backend
Set-Location backend; npm run lint; npm test; npm run test:coverage
Set-Location backend; npm run test:integration
Set-Location backend; npm run prisma:migrate:status; npm run prisma:security:verify

# frontend
Set-Location frontend; npm run lint; npm run typecheck; npm test; npm run test:e2e:local

# mobile-admin, only when API contracts change
Set-Location mobile-admin; npm run typecheck; npm test
```

Backend coverage must remain at least 68 lines, 60 branches, and 64 functions. Required production regressions are tournament registration end-to-end (free, PayHere, bank transfer), waitlist promotion, reservation expiry, veto room flow, match-room permissions, ticket QR scan, OAuth link/unlink safety migration `20260819170000_add_oauth_link_safety`, and public tournament status rendering. Add multi-process SSE, merge safety, private upload, dispute authorization, and typed result tests as their phases land.

## 37. Deployment strategy

```text
PR → CI (ci.yml) → merge to main
  → frontend: deploy-frontend.yml (Vercel, prebuilt artifact)
  → backend: cd.yml (manual, owner-only)
       → backup → prisma migrate deploy (MIGRATION_APPROVAL_SHA gate)
       → pm2 restart → /api/health/ready verification → pm2 save
```

Before each V2 migration: confirm clean CI, inspect migration SQL, take the production backup, run `prisma:migrate:status` and `prisma:security:verify`, obtain the approval SHA, deploy migration separately, verify readiness and feature flags, then deploy readers. Rollback uses flag disable and forward repair for additive schema; destructive rollback is not planned. `ops/restore-production-backup.sh` is the emergency data restore path.

## 38. Risk register

| Risk | Probability | Impact | Mitigation / owner |
|---|---:|---:|---|
| Incorrect player merge joins two people | Medium | Critical | Manual merge queue, reversible links, audit, no auto-merge; identity owner. |
| Upstream exposes no stable link contract | Medium | High | Keep manual PUUID/Discord-ID proof; do not username-match; integration owner. |
| Registration/payment regression | Low/medium | Critical | Separate schema/readers, full E2E/payment/waitlist/reservation suite; tournament owner. |
| Historical roster privacy leak | Medium | High | Immutable snapshots, scoped fields, private evidence, projection tests; registration owner. |
| PM2 SSE split-brain | Confirmed today | High | Shared Redis fan-out plus durable cursor/polling before broadcast; realtime owner. |
| Station assignment conflicts at LAN | Medium | High | Unique/overlap validation, operator audit, legacy text fallback; operations owner. |
| Referee privilege escalation | Medium | High | Route and service guards, assigned-match scope, audit; permissions owner. |
| Typed results disagree with Challonge/legacy JSON | Medium | High | Dual-read/write, reconciliation report, explicit authority by mode; match owner. |
| Public payload growth | Confirmed risk | Medium | Bounded projections, pagination, cache metrics; performance owner. |
| Feature flags drift across clients | Medium | Medium | Server-side flags, additive contracts, mobile impact review; release owner. |
| Migration/deploy timing causes outage | Low | Critical | Separate PR/window, backup, approval SHA, readiness check; release owner. |

## 39. Recommended first PR

`fix/tournament-registration-state-contract` implementing V2-P0-001 only: consolidate the frontend types and helpers, add public card/detail/button regression coverage, and prove the backend canonical state is unchanged. It is the smallest high-value PR, addresses the visible status symptom, changes no schema/API/auth/payment flow, and creates the regression harness needed before V2 phases.

## 40. Open questions

1. Which upstream `valorantsl-new` endpoint can prove a stable Discord account ID to PUUID relationship, and what operator consent is required?
2. Should unclaimed players be publicly discoverable by QPID, or only visible after a player claims and publishes a profile?
3. What is the retention policy for roster-change evidence, check-in records, disputes, penalties, and broadcast snapshots?
4. Which tournament staff roles may configure venues/stations versus merely operate assignments?
5. Is mobile-admin required to operate LAN check-in/referee flows, or is the web admin the sole operations client?
6. Which online match result confirmation timeout should automatically escalate to a referee/dispute?
7. Which public fields are allowed in overlays and external leaderboard-linked profiles under privacy policy?
8. Is Upstash Redis guaranteed in every PM2 deployment where broadcast/SSE is enabled, or should the durable polling path be the default?
9. Which existing event/tournament mutations are intentionally excluded from `foundation` cache invalidation, if any?
10. What is the official Quest ranking season/points policy and whether historical tournaments qualify?
