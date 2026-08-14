# Quest ←→ VALORANT Platform Integration — Design Draft (rev 2)

**Status:** Draft for review; implementation-ready pending user approval
**Date:** 2026-08-13 (rev 2)
**Scope:** QuestEsports integration layer (admin BFF + durable bindings + read projections) against the **current** `valorant-platform-backend` implementation.
**Change log:** This is a **revised contract after repository review** of both current codebases. Rev 2 removes references to the older companion VAL design where it no longer matches code, and pins every claim to the actual repositories:
- Service auth is defined as **required FastAPI work** (current `app/api/dependencies.py` uses `X-Admin-Key` and bypasses `local`/`test`; no HMAC bearer exists yet).
- IDs are disambiguated (`henrik_match_id` text for import/display, VAL internal `match_id` UUID for attach, `valorant_series_uuid`, Quest binding/series UUIDs).
- Series status reflects the real model (`draft|finalized` only; `preview.valid` is derived readiness); Quest integration state is `draft|finalized|orphaned|reconciliation_required`.
- Rating policy uses FastAPI `rating_mode` (`normal|forfeit_no_rating|forfeit_result_only|manual_override` + required `unrated` delta), chosen at finalization.
- Error mapping uses the actual `app/api/errors.py`/service codes and statuses; re-import is 200 `created=false`, not an error.
- Migration/role model (four roles), RLS posture, expand-first ordering, and the required change to `ops/backup-production.sh` (`--schema=public` only today) are specified.
- Added: anchor (Riot-ID) identity proof for rated finalization, Quest operation record + `Idempotency-Key`, absolute desired-order game reordering, chronological backdate rejection (no seven-day window, no rebuild promise).

**Companion repos:** `valorant-platform-backend` (sibling repo; FastAPI) and this repo (`QuestEsports`). The core architecture decision is **settled and not reopened** (§1.1).

---

## 1. Problem and goals

### 1.1 Settled core architecture (do not reopen)

| # | Decision | Consequence |
|---|---|---|
| A1 | **QuestEsports is the authenticated product/admin/BFF layer.** | All admin identity, permissions, UX, and team selection live in Quest. The browser talks only to Quest. |
| A2 | **`valorant-platform-backend` is a separate FastAPI repository/service.** | Own repo, own deployment, own migration ledger. Called *only* by the Quest backend over a private internal API. The browser never calls FastAPI. |
| A3 | **One Supabase PostgreSQL project, two schema owners.** | Quest Prisma owns `public`; FastAPI owns the `valorant` schema (pinned by `app/config.py` `APP_DB_SCHEMA = "valorant"`) via its plain-SQL ledger. No Prisma models or migrations for `valorant` tables; no cross-schema foreign keys; Quest never accesses the `valorant` schema directly. |
| A4 | **Quest `SavedTeam` is the team selection source.** | A durable Quest `SavedTeam` → VALORANT team binding lives in Quest `public` schema and stores the VALORANT team UUID as an opaque reference. The binding is reused across series. Quest team deletion/detachment must never delete VALORANT rating history. |
| A5 | **Standalone admin series is the MVP.** | No tournament fixture links, no Challonge coordination, no public stats, no seasons, no roster automation, no mobile work in MVP. |
| A6 | **FastAPI is authoritative.** | Canonical Henrik matches, series correctness/finalization, rating events, and rankings are owned by FastAPI. Quest owns admin identity, permissions, UX, bindings, and read projections. |

### 1.2 Problem statement

Quest admins need to run VALORANT competitive series (BO1/BO3/BO5) with trusted, Riot-sourced results and ELO-based ratings, without (a) re-entering scores by hand, (b) duplicating VALORANT data models into Quest's Prisma schema, or (c) exposing the VALORANT platform service directly to browsers. Quest already stores `SavedTeam`/`SavedTeamMember` (with optional `riotId`) and has an established admin/session/audit stack. The FastAPI backend already implements the match engine, two-player discovery, series draft/finalize, legacy ELO, and rankings in `valorant-platform-backend/app/`.

### 1.3 Goals

1. **Admin-driven discovery:** admins enter two Riot IDs (`name#tag`); FastAPI resolves them, searches both recent histories, intersects on `metadata.match_id`, and returns reviewable candidates. The admin explicitly selects the exact match; no candidate is ever auto-imported or auto-attached.
2. **Anchor identity proof:** the two discovery Riot IDs are retained as anchor identities for the series. For **rated** finalization, FastAPI verifies both anchor PUUIDs appear on opposing sides of every attached map, or the admin must provide an explicit, audited override with reason. This is **not** roster automation.
3. **Standalone series management:** create a draft series (BO1/BO3/BO5), attach/reorder/remove imported games, map Red/Blue sides to Quest teams, preview validity, and finalize exactly once.
4. **Explicit Rated/Unrated:** ordinary series expose a clear Rated/Unrated choice (Rated → `rating_mode=normal`, Unrated → `rating_mode=unrated`); explicit forfeit/override policy is preserved.
5. **Durable binding without coupling:** Quest `SavedTeam` → VALORANT team binding is stable, never deleted with history, and never cascades into VALORANT data.
6. **Trustworthy automation:** Quest operation records + `Idempotency-Key` for creates, never blind-retry finalize, admin-visible orphan/reconciliation state, full actor/operation audit context.
7. **Schema hygiene:** one Supabase project, no Prisma migrations for `valorant`, no cross-schema FKs, no duplicate canonical stores, consistent two-schema backup.

---

## 2. Non-goals and phased scope

### 2.1 Explicit non-goals (MVP and near-term)

- Tournament fixture links to Quest `Match`/`TournamentBracket`, Challonge coordination, bracket/group/Swiss logic.
- Public-facing VALORANT stats, leaderboards, or unauthenticated data access.
- Seasons, league structure, or scheduled recurring series.
- Roster automation (auto-associating matches from PUUID lineups). Anchor verification (§5.5) is the only player-identity check in MVP.
- Mobile admin (`mobile-admin/`) VALORANT screens.
- Re-entering scores manually, caller-supplied ELO, or any writes by the browser to FastAPI.
- Riot official API / RSO; HenrikDev remains the only VALORANT data source.
- Cross-schema foreign keys, Prisma-managed `valorant` tables, or any Quest code path reading/writing the `valorant` schema directly.
- **Backdated ratings:** in MVP, any rated finalization whose `played_at` predates the latest rated finalized series is rejected (no seven-day window, no rebuild promise).
- `unrated` series affecting rating counters: in MVP, `unrated` applies **no ELO and no win/loss/matches counters** (deliberately distinct from `forfeit_result_only`).

### 2.2 Phased scope (summary; full slices in §12)

1. **Slice 0 — Foundation:** binding models + operation record in Quest `public` schema, env/secrets plumbing, service-auth (HMAC bearer) on both sides, internal HTTP client, error mapping.
2. **Slice 1 — Discovery:** Riot ID resolution + two-player candidate search + explicit candidate import (two-stage lightweight/detail fetch).
3. **Slice 2 — Series build:** create draft series with anchors, attach/remove games, absolute desired-order reordering, side mapping.
4. **Slice 3 — Preview & finalize:** BO validation preview, `rating_mode` (Rated/Unrated + forfeit/override), anchor verification, atomic finalize with audit, admin rankings/rating-history reads.
5. **Slice 4 — Reconciliation & polish:** orphan/reconciliation UI, chronological guardrails, verification hardening.

Deferred entirely (all slices): tournament fixtures, Challonge, public stats, seasons, roster automation, mobile, backdated ratings/rebuild automation.

---

## 3. Architecture and service ownership

### 3.1 Topology

```text
 Browser (Next.js admin UI, localhost:3000)
        |  (HttpOnly session cookie, credentials: include)
        v
 Quest Express backend (localhost:5001)  ── public schema (Quest Prisma owns `public`)
        |  requireAdmin -> session/role check
        |  Quest server-side operation_id; signed HMAC bearer (actor + operation claims)
        |  private network only; never exposed to browser
        v
 valorant-platform-backend (FastAPI, localhost:8000)  ── `valorant` schema
        |     (plain-SQL ledger, scripts/apply_migrations.py)
        v
   HenrikDev API  (only FastAPI speaks Henrik)
```

- Quest frontend (`frontend/`) calls Quest Express (`backend/src/`) under `/api`/`/api/v1` per existing conventions (`frontend/lib/api.ts`, `docs/api-documentation.md`).
- Quest Express is the **only** caller of FastAPI. FastAPI binds to a private interface / internal ingress and has no browser-facing CORS surface.
- Both services connect to the **same** Supabase PostgreSQL project but with **schema-specific runtime roles** (§7).

### 3.2 Ownership table (current code)

| Concern | Owner | Where (current) |
|---|---|---|
| Admin identity, sessions, roles | Quest | `backend/src/modules/auth/auth.middleware.js` (`requireAdmin`) |
| `SavedTeam`/`SavedTeamMember` team selection | Quest | `backend/prisma/schema.prisma` (`SavedTeam` ~L1133, `SavedTeamMember` ~L1154 incl. `riotId`) |
| Quest→VALORANT bindings, series projections, operation records, audit mirror | Quest | new Prisma models in `public` (Slice 0) |
| Admin UX (bindings, discovery, series, rankings read) | Quest | new `frontend/app/admin/valorant/*` |
| Service auth (HMAC bearer) for Quest calls | **FastAPI (required delta)** | `valorant-platform-backend/app/api/dependencies.py` (`require_admin` today) |
| Canonical Henrik matches, players, teams | FastAPI | `valorant-platform-backend/app/api/routes/matches.py`, `app/services/match_import_service.py`, `app/db/models/*` |
| Two-player discovery | FastAPI | `app/api/routes/match_search.py`, `app/services/match_discovery_service.py` |
| Series draft/finalize, rating events, rankings | FastAPI | `app/api/routes/series.py`, `app/services/series_service.py`, `app/services/rating_service.py`, `app/api/routes/rankings.py` |
| Rating policy (`rating_mode`) | FastAPI | `app/domain/ratings/policy.py` (`RATING_MODES`) |
| Migrations for `valorant` schema | FastAPI | `supabase/migrations/0001–0013` + `scripts/apply_migrations.py` |
| Production backup of both schemas | **Quest ops (required change)** | `ops/backup-production.sh` (today dumps `--schema=public` only) |

### 3.3 Quest integration module (new, inside Quest backend)

Mirroring the existing module layout in `backend/src/modules/`, add:

```text
backend/src/modules/valorant/
  valorant.client.js        # internal HTTP client for FastAPI (timeouts, bounded read retries,
                            #   HMAC bearer signing, actor/operation headers, error mapping)
  valorant.auth.js          # HMAC bearer token signing + kid rotation; no FastAPI secrets in UI
  valorant.mapper.js        # FastAPI payload <-> Quest projections (fixture-driven)
  valorant.controller.js    # route handlers (thin)
  valorant.routes.js        # mounted under /api/v1/admin/valorant (requireAdmin-guarded)
  valorant.service.js       # orchestration: binding CRUD, discovery proxy, series proxy,
                            #   operation-record state machine, reconciliation queries
  valorant.validation.js    # Riot ID (Name#Tag) parsing, externalKey/operation rules
```

Route mounting follows `backend/src/routes/v1.js`; admin protection follows the `backend/src/modules/admin/admin.routes.js` pattern (`router.use("/admin", requireAdmin)`).

---

## 4. Domain model and identity mapping

### 4.1 Identity glossary (be precise — IDs are distinct)

| Term | Definition | Owner schema | Canonical key / name used |
|---|---|---|---|
| **Quest SavedTeam** | Admin-selected team record | `public` | `saved_teams.id` (UUID) |
| **VALORANT Team** | Rating/standings entity (`teams`) | `valorant` | `teams.id` → stored on the Quest binding as `valorantTeamUuid` |
| **VAL Match (imported map)** | One canonical imported Henrik match | `valorant` | internal `matches.id` (UUID) → **`match_id`** on attach calls; also `matches.henrik_match_id` |
| **Henrik Match ID** | Canonical upstream text ID | `valorant` | `matches.henrik_match_id` → **`henrik_match_id`** for import/display |
| **Quest Match (future fixture)** | Quest's existing `matches` table (tournament fixtures). **Never** used by this integration in MVP. | `public` | `matches.id` |
| **VAL Series** | A BO1/BO3/BO5 draft/finalized series | `valorant` | `series.id` → stored on the Quest series as `valorantSeriesUuid` |
| **Binding** | Durable Quest `SavedTeam` ↔ VAL Team link | `public` | binding row `id` (UUID) |
| **Actor** | Quest admin user performing an action | `public` | `users.id` |
| **Riot ID** | `name#tag` display identity (mutable); admin enters it | `valorant` | resolved PUUID |
| **PUUID** | Riot player UUID; canonical player identity in VALORANT platform | `valorant` | `players.puuid` (also snapshotted on `match_players.puuid_snapshot`) |
| **Operation** | One Quest-initiated remote mutation, tracked end-to-end | `public` | `quest_valorant_operations.id` + server-side `operation_id` (UUID) propagated to FastAPI |
| **Quest series key** | Quest's own series row id | `public` | `quest_valorant_series.id` (UUID) |
| **External series key** | FastAPI-side convergence key for series create | `valorant` | `series.external_quest_series_id` (required delta, unique) |

### 4.2 ASCII model diagram

```text
 public schema (Quest Prisma)                      valorant schema (FastAPI)

 users ──< saved_teams ──< saved_team_members           players (puuid canonical)
            |    |             | riot_id?                    |
            |    |             |   (display hint only;       |
            |    |             |    not authoritative)       |
            |    |                                           |
            |    +-- valorant_team_bindings                  |
            |        id, saved_team_id (nullable FK,          |
            |           SetNull, active-unique),              |
            |        valorant_team_uuid (opaque, NO FK) ──────+-> teams (VAL Team)
            |        status: active|detached                  |   quest_saved_team_id (unique, req. delta)
            |        bound_by_user_id, timestamps             |   anchor columns not here
            |                                                |
            |   quest_valorant_series                      series (status: draft|finalized)
            |       id, external_key (unique),              series_games ──> matches (VAL Match)
            |       binding_a_id, binding_b_id,             external_quest_series_id (req. delta)
            |       format, played_at,                       anchor_a_puuid, anchor_b_puuid (req. delta)
            |       rating_mode_preference (draft only),     rating_mode (persisted at finalize)
            |       status: draft|finalized|orphaned|        finalized_by_actor_id,
            |           reconciliation_required             finalized_by_operation_id (req. delta)
            |       valorant_series_uuid (opaque, NO FK) ──> rating_events (immutable)
            |
            |   quest_valorant_series_games                  v
            |       quest_series_id, game_number,       rankings (derived read; versioned runs)
            |       match_id (VAL UUID, opaque),
            |       team_a_side, team_b_side
            |
            |   quest_valorant_matches   (read projection, admin lists)
            |       match_id (VAL UUID, unique), henrik_match_id (unique, text),
            |       map, started_at, mode, queue, red/blue score, winning_side,
            |       roster_summary (jsonb), last_synced_at
            |
            |   quest_valorant_operations   (idempotency/audit record)
            |       id, operation_id (propagated), type, external_key?,
            |       quest_series_id?, status, fastapi_request_id?,
            |       response_code, error_code?, response_summary (jsonb), timestamps
```

Key properties:

- **No cross-schema FKs.** Quest stores VALORANT UUIDs (`valorant_team_uuid`, `valorant_series_uuid`, `match_id`) as opaque `text`; `henrik_match_id` is the only cross-service text identity on matches. All cross-service referential integrity is application-level plus reconciliation via FastAPI reads.
- **Binding is durable and one-way.** Deleting/detaching a Quest `SavedTeam` (or the binding row) never deletes VALORANT teams, series, or rating history.
- **`quest_valorant_matches` is a projection, not authority.** Display fields cached for admin lists; rebuilt from FastAPI. Row presence means "imported" — there is no speculative pending/failed state (imports are synchronous).
- **`quest_valorant_operations` is Quest's own audit/idempotency ledger** for remote mutations (see §8).

### 4.3 New Quest Prisma models (in `public`)

Add to `backend/prisma/schema.prisma` (snake_case `@@map` per existing convention; the partial unique index is appended as raw SQL to the generated migration — Prisma cannot express partial indexes):

- **`ValorantTeamBinding`** (`valorant_team_bindings`): `id`, `savedTeamId String?` (FK `saved_teams`, `onDelete: SetNull`), `valorantTeamUuid String` (opaque, NOT NULL), `status` (`active|detached`), `boundByUserId` (FK `users`, `SetNull`), `boundAt`, `detachedAt`, timestamps. Service enforces exactly one **active** binding per SavedTeam; migration adds `CREATE UNIQUE INDEX valorant_team_bindings_active_saved_team_idx ON valorant_team_bindings(saved_team_id) WHERE status = 'active'`. Index on `valorantTeamUuid`. **No unique on `(savedTeamId, valorantTeamUuid)`** — a SavedTeam can never bind to a second VAL team (rebinding is forbidden in MVP, §5.1), and a detached binding keeps history.
- **`QuestValorantSeries`** (`quest_valorant_series`): `id`, `externalKey String @unique` (Quest idempotency key for create), `bindingAId`/`bindingBId` (FK bindings, `Restrict`), `format` (`bo1|bo3|bo5`), `playedAt DateTime` (required — FastAPI finalize requires it), `ratingModePreference String?` (Quest draft UI preference only; canonical `rating_mode` is chosen at finalize), `status` (`draft|finalized|orphaned|reconciliation_required`), `valorantSeriesUuid String?` (opaque, set on create response), `finalizedById String?`, `lastOperationId` (FK operations), timestamps. **No `ready`/`void`/`finalizing` values** (transport attempt state lives on the operation record), **no `requiresRebuild`** (chronological backdate rejection replaces it).
- **`QuestValorantSeriesGame`** (`quest_valorant_series_games`): `id`, `questSeriesId` (FK, cascade), `gameNumber Int`, `matchId String` (VAL `matches.id`, opaque), `teamASide` (`red|blue`), `teamBSide` (`red|blue`), `mapName String?`, timestamps. `@@unique([questSeriesId, gameNumber])`, `@@unique([matchId])` (mirrors FastAPI `series_games_match_key`).
- **`QuestValorantMatch`** (`quest_valorant_matches`): `id`, `matchId String @unique` (VAL UUID), `henrikMatchId String @unique` (text), `mapName`, `startedAt`, `mode?`, `queue?`, `redScore?`, `blueScore?`, `winningSide?`, `rosterSummary Json?` (snapshot for candidate/team context), `lastSyncedAt`, timestamps.
- **`QuestValorantOperation`** (`quest_valorant_operations`): `id`, `operationId String @unique` (server-generated UUID, propagated to FastAPI), `type` (`team_bind|series_create|attach_game|set_game_order|remove_game|finalize|reconcile`), `externalKey String?` (create idempotency), `questSeriesId?` (FK, SetNull), `status` (`pending|in_flight|succeeded|failed|reconciliation_required`), `fastapiRequestId?` (echoed `X-Request-ID` when known), `requestBodyHash?`, `responseCode Int?`, `errorCode String?`, `responseSummary Json?`, timestamps.

No Prisma model touches `valorant` schema tables; no cross-schema FK annotations.

### 4.4 FastAPI-side deltas (all **required work**, owned by the FastAPI repo)

| # | Delta | Current state | Required behavior | Owner + tests |
|---|---|---|---|---|
| D1 | **Service auth (HMAC bearer)** | `app/api/dependencies.py` `require_admin` compares `X-Admin-Key`, bypassed in `local`/`test` | New `require_service_token` dependency validating `Authorization: Bearer <HMAC>` with `iss`/`aud`/`exp`/`nbf`/`iat`/`kid` claims and signed Quest `sub` (actor id) + `operation_id`; **all** domain routes protected in production; health stays unauthenticated | FastAPI: `app/api/dependencies.py` + tests `tests/unit/test_admin_dependency.py`, new `tests/unit/test_service_token.py` |
| D2 | **`teams.quest_saved_team_id`** | `teams` has no external key (`app/db/models/team.py`) | Add `quest_saved_team_id text UNIQUE` (nullable; partial unique `WHERE quest_saved_team_id IS NOT NULL`); `POST /api/v1/teams` accepts it and returns existing row (200) or creates (201) — the single convergence key | `supabase/migrations/0014_*.sql`, `app/db/models/team.py`, `app/schemas/teams.py`, `app/services/team_service.py`, `tests/integration/test_teams_api.py` |
| D3 | **`series.external_quest_series_id`** | `series` has no external key (`app/db/models/series.py`) | Add `external_quest_series_id text UNIQUE` (nullable); `POST /api/v1/series` accepts it; create-or-get on retry with the same key | migration 0014+, `app/schemas/series.py`, `app/services/series_service.py`, `tests/integration/test_series_api.py` |
| D4 | **`unrated` rating mode** | `RATING_MODES = normal, forfeit_no_rating, forfeit_result_only, manual_override` (`app/domain/ratings/policy.py`); DB CHECK in `0009_series_rating_mode.sql` | Add `unrated` to `RATING_MODES`, `_RATE_SERIES_MODES` unchanged, `series.rating_mode` CHECK, and schema `RatingMode` literal. `unrated` ⇒ no ELO **and** no win/loss/matches counters (distinct from `forfeit_result_only` which updates counters) | `app/domain/ratings/policy.py`, `supabase/migrations/0014+`, `app/schemas/series.py`, `tests/unit/test_rating_policy.py`, `tests/integration/test_finalize_policy.py` |
| D5 | **Reason required for forfeit/override modes** | Only a *real* override (winner ≠ calculated) requires a reason (`policy.py`) | Require a non-empty `override_reason` whenever the resolved `rating_mode` is `manual_override`, `forfeit_no_rating`, or `forfeit_result_only` — **even when official winner equals calculated** — else 409 `RATING_POLICY_REQUIRED` | `app/domain/ratings/policy.py`, `app/schemas/series.py`, `tests/unit/test_rating_policy.py` |
| D6 | **Anchor identity columns + rated verification** | Series has no anchor concept | Add `series.anchor_a_puuid`, `series.anchor_b_puuid text null`; `POST /api/v1/series` accepts `anchor_player_a`/`anchor_player_b` (`name`,`tag`) and resolves+persists PUUIDs. At **rated** finalize, verify for **every** attached game that `match_players` contains both anchor PUUIDs on **opposing sides**; failure ⇒ 409 `ANCHOR_MISMATCH` unless explicit `override_reason` + explicit rated mode (audited). Unrated/forfeit modes skip verification (side mapping recorded with audit). | `supabase/migrations/0014+`, `app/db/models/series.py`, `app/schemas/series.py`, `app/services/series_service.py`, `app/services/rating_service.py`, `tests/integration/test_finalize_policy.py`, new `tests/integration/test_anchor_verification.py` |
| D7 | **Audit fields in finalize transaction** | `series` has no actor/operation columns | Add `series.finalized_by_actor_id`, `series.finalized_by_operation_id text null`; the finalize transaction persists them from the validated token claims (§9.2) | migration 0014+, `app/db/models/series.py`, `app/services/rating_service.py`, `tests/integration/test_finalization.py` |
| D8 | **Chronological guard (MVP)** | None | Inside the finalize transaction (after the rating-work advisory lock), for rated modes only: reject with 409 `BACKDATED_SERIES_REJECTED` when `series.played_at < MAX(played_at)` over already-finalized rated series. No seven-day exception; unrated/forfeit finalization exempt | `app/services/rating_service.py`, `tests/integration/test_finalization.py`, new `tests/integration/test_backdated_finalization.py` |
| D9 | **Absolute desired-order endpoint** | Reorder is per-game `PATCH /series/{id}/games/{game_id}` with swap semantics (not retry-safe) | New admin route `PUT /api/v1/series/{series_id}/games/order` body `{games: [{game_id, game_number}]}` — atomic, draft-only, validates the full desired order, idempotent by absolute values | `app/api/routes/series.py`, `app/services/series_service.py`, `tests/integration/test_series_api.py` |
| D10 | **ID naming contract** | `POST /matches/import` field `match_id` currently holds the Henrik **text** ID; `AttachGameRequest.match_id` holds the VAL **UUID** | Keep the FastAPI contract unchanged but pin it in the OpenAPI docstrings; Quest must send the right ID to the right endpoint. No code change needed beyond documentation | FastAPI: `app/schemas/matches.py`, `app/schemas/series.py`; Quest fixture tests |
| D11 | **Candidate detail (two-stage)** | Search returns only `MatchCandidate` fields; import returns full `MatchDetailResponse` | **Reuse existing endpoints** (no new endpoint): candidate detail = `POST /api/v1/matches/import` for a new match (idempotent, returns `MatchDetailResponse` incl. `winning_side` and `players[]`) or `GET /api/v1/matches/by-henrik-id/{henrik_match_id}` when already imported. Lightweight search results are **not** extended. | FastAPI: no code change; Quest contract tests against both endpoints |

All deltas are additive to the `valorant` schema via `supabase/migrations/0014_*.sql` (single file per deploy wave where possible) and covered by FastAPI's existing test layout (`tests/unit/*`, `tests/integration/*`). The core series/rating rules in `app/domain/series/*` and `app/legacy/elo_calculator.py` are unchanged.

---

## 5. User/admin workflows

All workflows start behind `requireAdmin` (`backend/src/modules/auth/auth.middleware.js`) and the existing admin layout (`frontend/app/admin/`).

### 5.1 Team binding (one-time, reused across series)

```text
1. Admin opens /admin/valorant and picks an existing Quest SavedTeam.
2. Quest validates the admin may select the team (existing SavedTeam access rules).
3. Quest writes a pending QuestValorantOperation (type=team_bind, operation_id generated).
4. Quest calls FastAPI POST /api/v1/teams with { name, short_name?, quest_saved_team_id }.
   FastAPI returns the existing VAL team (200) or creates one (201) keyed on
   quest_saved_team_id — convergence by saved-team key, no new identity per bind.
5. Quest stores valorantTeamUuid on the binding (status=active) and marks the operation succeeded.
```

- **One active binding per SavedTeam** (partial unique index, §4.3). **Rebinding to another VAL team is forbidden in MVP** — the binding is the stable identity; if the VAL team is lost, reconciliation flags it rather than re-binds.
- **Detachment:** sets the binding `status = detached` (and nulls the active index) via a Quest-local `DELETE /api/v1/admin/valorant/teams/{bindingId}/detach`. It never calls FastAPI and never touches VALORANT data. A detached binding row is **retained** for history and can be re-activated only if `valorantTeamUuid` still resolves on FastAPI.
- **SavedTeam deletion is guarded** (§7.4): `deleteSavedTeam` (`backend/src/modules/teams/team.service.js` L643) is changed to reject 409 when an active binding exists; the binding FK is `onDelete: SetNull` as a safety net so even a bypassed delete never destroys the historical binding.

### 5.2 Riot ID discovery and explicit match selection (two-stage)

```text
1. Admin enters Riot ID A (Name#Tag) and Riot ID B (Name#Tag) in /admin/valorant/discover.
2. Quest validates the format locally (backend/src/modules/valorant/valorant.validation.js),
   then proxies to FastAPI POST /api/v1/match-search/two-player with bounded
   page_size/max_pages (current bounds: max 50 / max 5).
3. FastAPI resolves both players, fetches both histories, intersects on
   henrik match_id, and returns candidates with the CURRENT MatchCandidate fields:
   match_id (Henrik text), affinity, map, started_at, mode, queue, is_completed,
   red_score, blue_score, already_imported — plus the resolved players dict
   {a, b} with puuid/name/tag/affinity.
   NO winning_side or roster in the lightweight list.
4. Admin reviews candidates (match id, map, time, mode/queue, score, imported state).
5. Admin explicitly selects ONE candidate. Detail stage:
     - if already_imported: GET /api/v1/matches/by-henrik-id/{henrik_match_id}
       → full MatchDetailResponse (winning_side, players[] with sides/stats).
     - else: POST /api/v1/matches/import { match_id: <henrik text id>, affinity }
       → 201 created=true (or 200 created=false if another admin imported it).
6. Quest upserts the quest_valorant_matches projection from the detail response.
```

- **Never auto-attach the first result.** Selection is an explicit admin action.
- **Two-stage keeps discovery cheap:** history objects only; detail fetch happens only for the selected match.
- The resolved `players.a`/`players.b` (with PUUIDs) become the **anchor identities** carried into series creation (§5.3).

### 5.3 Series creation (with anchors)

```text
1. Admin selects two bound teams, a format (BO1/BO3/BO5), and a playedAt (defaults to now).
2. Admin chooses a draft preference: Rated or Unrated (forfeit/override are chosen at
   finalize). Quest stores ratingModePreference on the draft — canonical rating_mode is
   decided at finalization (§5.6).
3. The discovery anchor players from step 5.2 (the two Riot IDs, by name/tag) are attached
   to the series as anchor_player_a / anchor_player_b.
4. Quest generates externalKey (uuid), writes a QuestValorantOperation (type=series_create,
   external_key=externalKey), then proxies POST /api/v1/series with
   { team_a_id, team_b_id, format, importance: "regular", played_at,
     external_quest_series_id: externalKey,
     anchor_player_a: {name, tag}, anchor_player_b: {name, tag} }.
5. Quest stores the returned valorantSeriesUuid on quest_valorant_series (status=draft)
   and marks the operation succeeded.
```

### 5.4 Attach / remove / reorder games + side mapping

```text
1. Admin selects an imported VAL Match from the projection/library.
2. Quest writes an operation record (type=attach_game), then proxies
   POST /api/v1/series/{valorant_series_uuid}/games
   { match_id: <VAL match UUID>, game_number, team_a_side: red|blue }.
   FastAPI derives team_b_side, both round scores, and the game winner from the
   canonical match (app/services/series_service.py) — scores are never re-entered.
   Error surfaced: 404 MATCH_NOT_FOUND, 422 MATCH_NOT_COMPLETED, 409
   MATCH_ALREADY_ASSIGNED_TO_SERIES, 409 SERIES_INVALID (invalid shape), 400 INVALID_SIDE_MAPPING.
3. Quest mirrors the game row into quest_valorant_series_games and marks the operation succeeded.
4. Reorder is a single ABSOLUTE desired-order operation:
   Quest writes an operation record (type=set_game_order) and proxies
   PUT /api/v1/series/{valorant_series_uuid}/games/order
   { games: [{ game_id, game_number }, ...] }   (FastAPI delta D9, draft-only).
   The body states the full desired final order; retrying the same body converges.
5. Remove: Quest writes an operation record (type=remove_game), then proxies
   DELETE /api/v1/series/{valorant_series_uuid}/games/{game_id} (draft-only, 204).
6. Preview is recomputed via GET /api/v1/series/{valorant_series_uuid}/preview (no writes)
   and shown before finalization.
7. Delete a draft series entirely: DELETE /api/v1/series/{valorant_series_uuid} (draft-only).
   There is no separate "void": DELETE is the removal mechanism for drafts, and finalized
   history is retained permanently.
```

Side mapping UX: each game row shows the VALORANT Red/Blue side assigned to Team A/Team B. For **unrated** series, manual side mapping is allowed and is recorded with audit (operation record + FastAPI `series_games` rows). For **rated** series, side mapping must be consistent with the anchor verification at finalize (§5.5).

### 5.5 Preview, finalize, and anchor verification

```text
1. Admin opens /admin/valorant/series/{id}: Quest shows FastAPI preview (valid,
   per-game winners, maps won, calculated winner) and the anchor identities.
2. Admin clicks Finalize. Quest writes an operation record (type=finalize,
   status=in_flight) BEFORE the remote call, then proxies
   POST /api/v1/series/{valorant_series_uuid}/finalize
   { official_winner_id?, override_reason?, rating_mode }.
3. FastAPI (app/services/rating_service.py) runs the locked atomic transaction:
   advisory rating-work lock → series FOR UPDATE → teams FOR UPDATE (sorted)
   → re-validate BO + winner agreement → resolve policy → [rated] run ELO,
   insert two immutable rating events, update ratings/counters → persist
   rating_mode, status=finalized, finalized_at + audit fields → COMMIT.
4. Rated modes (normal, manual_override) additionally require anchor verification:
   both anchor PUUIDs present on opposing sides of every attached map. Failure
   returns 409 ANCHOR_MISMATCH unless the admin supplies an explicit
   override_reason + explicit rated mode (audited) (§4.4 D6).
5. Quest marks the operation succeeded/failed, updates quest_valorant_series to
   finalized, records finalizedById, and refreshes its rankings read projection.
```

- **Double-finalize:** FastAPI returns 409 `SERIES_ALREADY_FINALIZED`; Quest surfaces the committed state, never re-applies.
- **Timeout/unknown outcome:** Quest never blindly retries. It marks the operation `reconciliation_required` and reconciles by **reading** FastAPI (§8.3).

### 5.6 Rated / Unrated and forfeit/override policy (product-visible semantics)

Canonical `rating_mode` is chosen at **finalization** (FastAPI-owned). Quest exposes:

| Quest label | FastAPI `rating_mode` | ELO applied? | Counters (wins/losses/matches)? | Notes |
|---|---|---|---|---|
| **Rated** | `normal` | Yes | Yes | Default for ordinary competitive series. |
| **Unrated** | `unrated` (delta D4) | No | **No** | Series result recorded; standings unaffected. |
| Forfeit — result only | `forfeit_result_only` | No | Yes | Official winner + counters, no ELO. |
| Forfeit — no rating | `forfeit_no_rating` | No | No | Result recorded, no ELO, no counters. |
| Manual override | `manual_override` | Yes | Yes | `override_reason` required. |

Policy rules (FastAPI `app/domain/ratings/policy.py` + delta D5):

- No official winner → official defaults to the calculated winner, mode `normal` (explicit mode honored).
- Official == calculated → mode `normal` unless an explicit mode is selected (a forfeit declared after the maps is honored).
- Official != calculated (real override) → non-empty `override_reason` **and** an explicit mode required; ambiguous ⇒ 409 `RATING_POLICY_REQUIRED`.
- **Delta D5:** any of `manual_override`/`forfeit_no_rating`/`forfeit_result_only` selected also requires a non-empty `override_reason`, even when the official winner equals the calculated winner.
- ELO always uses the *official series winner*; `calculation_details` records the resolved policy and inputs on every rating event.

### 5.7 Rankings and rating history (admin-only, required in MVP)

`/admin/valorant/rankings` (admin-only page) reads FastAPI `GET /api/v1/rankings/teams`, `GET /api/v1/teams/{id}/rating-history`, and `GET /api/v1/teams/{id}/series`, joined in Quest with binding display names. Quest never computes ELO.

---

## 6. Integration API boundary

### 6.1 Principle

- **Quest proxy routes** = admin-facing, `/api/v1/admin/valorant/...`, always behind `requireAdmin`. The browser sees only Quest endpoints.
- **Private FastAPI endpoints** = the routes in `valorant-platform-backend/app/api/routes/*`. Reached only by Quest's internal client; never browser-facing; all domain routes protected in production (delta D1); `GET /api/v1/health` stays unauthenticated.

### 6.2 Quest proxy route table (new, `backend/src/modules/valorant/valorant.routes.js`)

| Method | Quest route | Backing FastAPI call |
|---|---|---|
| `GET` | `/api/v1/admin/valorant/teams` | `GET /api/v1/teams` + bindings joined |
| `POST` | `/api/v1/admin/valorant/teams/bind` | `POST /api/v1/teams` (create-or-get by `quest_saved_team_id`) |
| `DELETE` | `/api/v1/admin/valorant/teams/{bindingId}/detach` | none (Quest-local status change) |
| `POST` | `/api/v1/admin/valorant/discover` | `POST /api/v1/match-search/two-player` |
| `POST` | `/api/v1/admin/valorant/matches/import` | `POST /api/v1/matches/import` |
| `GET` | `/api/v1/admin/valorant/matches/by-henrik-id/{henrikMatchId}` | `GET /api/v1/matches/by-henrik-id/{henrik_match_id}` |
| `GET` | `/api/v1/admin/valorant/matches` | `GET /api/v1/matches[...]` (list filters) |
| `POST` | `/api/v1/admin/valorant/series` | `POST /api/v1/series` (with `external_quest_series_id` + anchors) |
| `GET` | `/api/v1/admin/valorant/series` | `GET /api/v1/series` |
| `GET` | `/api/v1/admin/valorant/series/{id}` | `GET /api/v1/series/{valorant_series_uuid}` |
| `POST` | `/api/v1/admin/valorant/series/{id}/games` | `POST /api/v1/series/{valorant_series_uuid}/games` |
| `PUT` | `/api/v1/admin/valorant/series/{id}/games/order` | `PUT /api/v1/series/{valorant_series_uuid}/games/order` (delta D9) |
| `DELETE` | `/api/v1/admin/valorant/series/{id}/games/{gameId}` | `DELETE /api/v1/series/{valorant_series_uuid}/games/{game_id}` |
| `DELETE` | `/api/v1/admin/valorant/series/{id}` | `DELETE /api/v1/series/{valorant_series_uuid}` (draft only) |
| `GET` | `/api/v1/admin/valorant/series/{id}/preview` | `GET /api/v1/series/{valorant_series_uuid}/preview` |
| `POST` | `/api/v1/admin/valorant/series/{id}/finalize` | `POST /api/v1/series/{valorant_series_uuid}/finalize` |
| `GET` | `/api/v1/admin/valorant/rankings` | `GET /api/v1/rankings/teams` |
| `GET` | `/api/v1/admin/valorant/teams/{teamId}/rating-history` | `GET /api/v1/teams/{team_id}/rating-history` |
| `GET` | `/api/v1/admin/valorant/reconciliation` | reconciliation queries via FastAPI reads only (§8.3) |

### 6.3 Auth headers and propagation

Every Quest→FastAPI request carries:

```http
Authorization: Bearer <quest-service-token>
X-Quest-Operation-Id: <operation_id>
Idempotency-Key: <external_key>          # on team-bind and series-create only
```

**This is a required FastAPI delta (D1) — it does not exist today.** The current `require_admin` (`app/api/dependencies.py`) uses `X-Admin-Key` and is bypassed in `local`/`test`; it is replaced/kept as described below.

- **Token:** HMAC-SHA256 signed by Quest with the shared secret. Header `{alg: HS256, kid: "<key id>"}`; claims `{iss: "quest-esports", aud: "valorant-platform", sub: <actor users.id>, operation_id: <uuid>, iat, exp, nbf}`. `exp` window default 5 min; allowed clock skew 30 s. FastAPI validates `iss`/`aud`, `exp`/`nbf` with skew, `kid` lookup, and signature; rejects unsigned/malformed/expired tokens with 401 `ADMIN_AUTH_REQUIRED` (renamed/documented as service-auth in the delta).
- **Rotation:** `kid` selects between the current and previous key (dual-key overlap window). Quest env `VALORANT_SERVICE_KEY_ID`; FastAPI config maps `kid → secret`.
- **Scope of protection (production):** all domain routes (read and mutation) require a valid service token. `GET /api/v1/health` stays unauthenticated. `X-Admin-Key` may be retained solely as an operational/admin path for `POST /api/v1/rankings/rebuild` and ops tooling, documented as such.
- **Actor/operation propagation:** `sub` (actor id) and `operation_id` are validated from the signed claims — FastAPI never trusts an unsigned header. FastAPI logs them and persists them in the finalize transaction (delta D7).
- **No browser tokens reach FastAPI.** Quest session cookies are stripped at the Quest boundary.

### 6.4 Representative request/response shapes

**Discover (Quest `POST /api/v1/admin/valorant/discover`):**

```jsonc
// Request (browser -> Quest)
{
  "playerA": { "name": "TenZ", "tag": "SEN" },
  "playerB": { "name": "Demon1", "tag": "NA" },
  "pageSize": 10,
  "maxPages": 1,
  "map": "Ascent",       // optional, applied locally
  "from": "2026-07-01"   // optional local date filter
}

// Response (Quest -> browser, mapped from FastAPI two-player search; only
// fields the current MatchCandidate actually returns)
{
  "success": true,
  "players": {
    "a": { "id": "...", "puuid": "puuid-a", "name": "TenZ", "tag": "SEN", "affinity": "eu" },
    "b": { "id": "...", "puuid": "puuid-b", "name": "Demon1", "tag": "NA", "affinity": "eu" }
  },
  "candidates": [
    {
      "henrikMatchId": "abcdef0123...",   // text ID; display + import input
      "affinity": "eu",
      "map": "Ascent",
      "startedAt": "2026-08-01T14:30:00Z",
      "mode": "Standard",
      "queue": "unrated",
      "isCompleted": true,
      "redScore": 13, "blueScore": 8,
      "alreadyImported": false
      // NOTE: no winningSide, no roster here — see detail stage
    }
  ],
  "search": { "pagesExamined": 1, "pageSize": 10 }
}
```

**Candidate detail (detail stage; reuses existing FastAPI endpoints):**

```jsonc
// Not imported: POST /api/v1/matches/import
{ "match_id": "abcdef0123...", "affinity": "eu" }          // 201 created=true
// Already imported: GET /api/v1/matches/by-henrik-id/abcdef0123...
// Both return MatchDetailResponse:
{
  "id": "<val-match-uuid>",            // internal VAL match UUID -> "match_id" for attach
  "henrik_match_id": "abcdef0123...",
  "affinity": "eu", "platform": "pc",
  "map_name": "Ascent", "mode": "Standard", "queue": "unrated",
  "started_at": "2026-08-01T14:30:00Z",
  "is_completed": true, "red_score": 13, "blue_score": 8, "winning_side": "red",
  "players": [ { "puuid": "puuid-a", "name": "TenZ", "tag": "SEN", "side": "red",
                 "agent_name": "Jett", "kills": 22, "deaths": 15 }, ... ],
  "raw_payload_available": true
}
```

**Create series (Quest `POST /api/v1/admin/valorant/series`):**

```jsonc
// Request (browser -> Quest)
{
  "bindingTeamAId": "...", "bindingTeamBId": "...",
  "format": "bo3",
  "playedAt": "2026-08-02T18:00:00Z",
  "ratingModePreference": "normal",       // draft preference only; decided at finalize
  "anchorPlayerA": { "name": "TenZ", "tag": "SEN" },   // from discovery inputs
  "anchorPlayerB": { "name": "Demon1", "tag": "NA" }
}
// Quest -> FastAPI POST /api/v1/series
{
  "team_a_id": "<valorant team uuid from binding>",
  "team_b_id": "<valorant team uuid from binding>",
  "format": "bo3",
  "importance": "regular",
  "played_at": "2026-08-02T18:00:00Z",
  "external_quest_series_id": "quest-0000-...",   // == Idempotency-Key
  "anchor_player_a": { "name": "TenZ", "tag": "SEN" },
  "anchor_player_b": { "name": "Demon1", "tag": "NA" }
}
// Response (FastAPI -> Quest, then Quest -> browser with projection)
{ "id": "<valorant-series-uuid>", "status": "draft", "...": "..." }
```

**Attach game:**

```jsonc
// Request (browser -> Quest)  /  (Quest -> FastAPI POST /series/{uuid}/games)
{
  "gameNumber": 1, "matchId": "<val-match-uuid>", "teamASide": "red"
}
// Response (FastAPI -> Quest, GameView)
{ "id": "<game-id>", "game_number": 1, "match_id": "<val-match-uuid>",
  "map_name": "Ascent", "team_a_side": "red", "team_b_side": "blue",
  "team_a_rounds": 13, "team_b_rounds": 8, "winner_team_id": "<team-uuid>" }
```

**Set game order (absolute desired order):**

```jsonc
// Request (Quest -> FastAPI PUT /series/{uuid}/games/order)  — delta D9
{ "games": [ { "game_id": "g2-uuid", "game_number": 1 },
             { "game_id": "g1-uuid", "game_number": 2 } ] }
// Response: list of GameView in the new order (204/200)
```

**Finalize:**

```jsonc
// Request (browser -> Quest)
{ "ratingMode": "normal", "officialWinnerTeamId": null, "overrideReason": null }
// Request (Quest -> FastAPI POST /series/{uuid}/finalize)
{ "official_winner_id": null, "override_reason": null, "rating_mode": "normal" }
// Response (FastAPI -> Quest, FinalizeResult)
{ "series_id": "...", "status": "finalized",
  "calculated_winner_id": "...", "official_winner_id": "...",
  "winner_override_reason": null, "rating_mode": "normal",
  "events": [ { "team_id": "...", "elo_before": 1200, "elo_after": 1218,
                "result": "win", "sequence": 1, "calculation_details": { } } ],
  "team_a_current_elo": 1218, "team_b_current_elo": 1180 }
```

### 6.5 Error mapping (Quest surface → observed FastAPI codes)

Quest maps FastAPI's actual error codes to admin-friendly messages; mapping is fixture-tested against recorded FastAPI responses and **assumed** codes are not invented. "No overlap" is **not** an error: the search returns `candidates: []` with 200.

| FastAPI code (observed) | HTTP | Quest surface |
|---|---|---|
| `ADMIN_AUTH_REQUIRED` | 401 | "VALORANT platform rejected the request (service auth)" |
| `INVALID_REQUEST` | 422 | "Invalid request — check the form values" |
| `INVALID_RIOT_ID` | 422 | "Invalid Riot ID or player identifier" |
| `PLAYER_NOT_FOUND` / `PLAYER_REGION_UNKNOWN` | 404 | "Riot ID could not be resolved" |
| `HENRIK_AUTH_FAILED` | 502 | "VALORANT provider auth failed — contact admin" |
| `HENRIK_RATE_LIMITED` | 429 | "VALORANT provider is rate limited — retry shortly" |
| `HENRIK_UNAVAILABLE` | 503 | "VALORANT platform unavailable — contact admin" |
| `HENRIK_VALIDATION_ERROR` | 422 | "VALORANT provider rejected the search filters" |
| `MATCH_NOT_FOUND` | 404 | "Match not found" |
| `MATCH_NOT_COMPLETED` | 422 | "Match is not completed" |
| `MATCH_ALREADY_ASSIGNED_TO_SERIES` | 409 | "This match is already used in another series" |
| `MATCH_REFRESH_REJECTED` | 409 | "This match cannot be refreshed (finalized series)" |
| `TEAM_NOT_FOUND` | 404 | "VALORANT team not found" (bind/series-create with unknown team) |
| `TEAM_SLUG_TAKEN` | 409 | "Team slug already taken" |
| `SERIES_NOT_FOUND` | 404 | "Series not found" |
| `SERIES_INVALID` | 409/422 | "Series shape is invalid" (409 draft mutations, 422 finalize re-validation) |
| `SERIES_ALREADY_FINALIZED` | 409 | "Series already finalized" (show committed result) |
| `RATING_POLICY_REQUIRED` | 409 | "Choose an explicit rating policy and reason" |
| `INVALID_SIDE_MAPPING` | 400 | "Invalid side mapping" |
| `ANCHOR_MISMATCH` (delta D6) | 409 | "Anchor player not verified on one side of a map — override required" |
| `BACKDATED_SERIES_REJECTED` (delta D8) | 409 | "Cannot rate a series older than the latest rated series" |

Transport-level failures (timeout, connection) are **not** mapped to FastAPI codes — they enter the operation-record reconciliation path (§8). Quest reuses `frontend/lib/api.ts` `ApiRequestError` on the browser side and `HttpError` (`backend/src/lib/http-error.js`) on the backend.

### 6.6 Internal client behavior

`valorant.client.js`:

- one `fetch`/`undici` client with connect/read timeouts (default 10 s/15 s), bounded read retries (max 2, exponential) **only** for idempotent GETs and transient 5xx/429-with-Retry-After; never retries mutations;
- per-request HMAC bearer token (`iss`/`aud`/`exp`/`nbf`/`kid`, `sub` = actor id, `operation_id`) and `X-Quest-Operation-Id` header;
- never logs tokens, secrets, or raw candidate payloads;
- 2xx parsing, FastAPI error-code mapping (§6.5), and a distinct `InternalServiceError` for transport failures that trigger operation reconciliation (§8).

### 6.7 FastAPI deltas: owner + tests (summary)

Owned and tested in `valorant-platform-backend` (details in §4.4): D1 service auth (`app/api/dependencies.py`, `tests/unit/test_service_token.py`), D2 `teams.quest_saved_team_id`, D3 `series.external_quest_series_id`, D4 `unrated` mode (`app/domain/ratings/policy.py`), D5 reason-required for forfeit/override modes, D6 anchor columns + rated verification, D7 audit fields in the finalize transaction, D8 chronological guard, D9 absolute desired-order endpoint, D10 ID-naming documentation, D11 candidate-detail reuse (no code change). Every delta ships with `supabase/migrations/0014_*.sql` and unit/integration tests in the FastAPI repo; Quest consumes them only through the HTTP contract.

---

## 7. Persistence/schema ownership and migration rules

### 7.1 Four roles (conceptual)

| Role | Schema | Responsibility | DDL or DML |
|---|---|---|---|
| Quest migrator | `public` | runs Prisma migrations (`backend/prisma/migrations/`, `npm run prisma:migrate:deploy`) | DDL |
| Quest runtime | `public` | app queries (Prisma client) | DML only |
| VAL migrator | `valorant` | runs `scripts/apply_migrations.py` (creates schema + `_migration_ledger`, applies `supabase/migrations/*.sql`) | DDL |
| VAL runtime | `valorant` | FastAPI app queries (SQLAlchemy async) | DML only |

- The migrator owns the schema and runs DDL. **A DML-only role cannot migrate.** Credentials are therefore split: migration runs use the migrator/owner role; the running app uses the runtime role. In Supabase terms, the migrator is the project owner (or a dedicated `val_migrator` role granted the schema), and the runtime is a separate role granted table privileges.
- Quest Prisma is constrained to `public`; a CI check asserts `prisma migrate status`/diff never references `valorant` tables and that FastAPI migrations never touch `public` tables.

### 7.2 No cross-schema FKs

All VALORANT UUIDs stored in `public` are opaque `text`. Reasons: Prisma cannot express FKs to tables it doesn't model; cross-schema FKs would couple migration lifecycles and make schema ownership unenforceable. Referential integrity is application-level plus FastAPI-read reconciliation (§8).

### 7.3 Migration rules (expand-first, rollback-limited)

1. Quest Prisma migrations touch only `public`; FastAPI plain-SQL migrations touch only `valorant`.
2. **Expand-first order:** each deploy wave adds columns/tables first, backfills data in a later statement of the same wave, and only enforces new constraints in a **subsequent** deploy once backfill is verified. Never drop a column/table in the same deploy that populates it.
3. **Rollback limits:** rollback = revert the app deployment; newly added columns are inert to the previous app version (nullable/defaulted). Destructive operations (drops, tightens) are separate, deliberate migrations, never part of an expansion wave.
4. Destructive `prisma migrate reset` / `db drop` are forbidden against shared/remote databases (existing local-workflow rules in `README.md`); the same rule applies to FastAPI reset commands against the shared project.
5. FastAPI migrations already enforce a private-schema posture (`scripts/apply_migrations.py`): `valorant` schema created, `_migration_ledger` recorded per file, `PUBLIC` revoked, RLS enabled on every table. This behavior is retained and extended by the 0014 wave.

### 7.4 RLS strategy for the private VAL role

- The `valorant` schema is private and only reachable via the VAL runtime's direct connection (never through Supabase REST/PostgREST, never anonymous). The current runner enables RLS with **no policies** because the connecting app role is the table/schema owner — its direct connection is unaffected while every other role sees nothing.
- For the **four-role** model (runtime ≠ migrator), RLS must be made explicit: either (a) per-table RLS policies granting the VAL runtime role access to all rows in each `valorant` table (single-tenant admin service — the runtime role is the only legitimate direct caller), or (b) the deliberate constrained decision to leave RLS disabled on the private schema for the runtime role and rely on role-level `GRANT`s + private schema + network isolation, documented in the FastAPI repo. The runner's blanket `ENABLE ROW LEVEL SECURITY` without policies must be reconciled with whichever choice is made (choose (a) explicit policies for the runtime role; update the runner so migrations grant and policy).
- No anonymous grants; no `public` grants to the `valorant` schema; the Quest runtime role has no privileges on `valorant` and the VAL runtime role has no privileges on `public` (granted-by-default `public` schema usage is scoped to the Quest role).

### 7.5 Binding deletion semantics (safety rails)

- The Quest binding row survives SavedTeam deletion: FK `onDelete: SetNull` (the historical binding is retained with `savedTeamId = null`, marked `detached`), and `deleteSavedTeam` (`backend/src/modules/teams/team.service.js` L643) is **changed** to reject 409 when an active binding exists ("detach the VALORANT binding first"). This is an explicit Quest code change.
- VALORANT team/series/rating rows are never affected: there is no cross-schema FK and no FastAPI call on detach.
- Detached bindings are retained (soft) for history and can be re-activated only if the VAL team still resolves.

### 7.6 Backup/restore (required ops change)

- Current production backup `ops/backup-production.sh` runs `pg_dump ... --schema=public` and its manifest records `database_scope=application_public_schema_only`. **This must change before any authoritative VALORANT data is colocated**: the dump must capture both `public` and `valorant` in one consistent snapshot (`--schema=public --schema=valorant`, or a full-database dump with explicit schema list), the manifest scope updated, and restore tested to recreate both schemas together. Until then, the VALORANT data has no production backup — a release blocker for Slice 3+.

---

## 8. Consistency, idempotency, retries, and failure/reconciliation behavior

### 8.1 Operation records + `Idempotency-Key` (creates)

- Every Quest-initiated remote mutation writes a `QuestValorantOperation` row **before** the HTTP call (status `pending` → `in_flight` → `succeeded`/`failed`/`reconciliation_required`), with the propagated `operation_id` and request-body hash. This is Quest's authoritative audit/idempotency ledger.
- **Team bind:** convergence by `quest_saved_team_id` (unique on FastAPI team, delta D2) — a retried bind returns the existing team (200) or creates (201). No separate `external_key`.
- **Series create:** Quest generates `externalKey`, sends it as `Idempotency-Key` **and** `external_quest_series_id` in the body (delta D3, unique). A retried create with the same key returns the existing series (create-or-get).
- **Attach / remove / set-order / finalize** are **not** idempotency-keyed creates. They are protected by the operation record: on timeout, Quest reconciles by reading FastAPI state and only re-issues the mutation if it did **not** take effect (attach: re-`GET /series/{uuid}` and check for the game by `match_id`; set-order: re-issue the same absolute desired order, which converges).
- **Repeated import** is existing FastAPI behavior: 200 `created=false` (or 201 `created=true`), never `MATCH_ALREADY_IMPORTED` — Quest surfaces "already imported" as informational state.

### 8.2 Finalize — never blind retry

- The finalize operation record is set `in_flight` before the call; `playedAt` and `ratingMode` are fixed at that point.
- Definitive responses (success, 409/422) are recorded and surfaced.
- **Timeout/unknown outcome:** Quest does **not** retry. It marks the operation `reconciliation_required` and reads `GET /api/v1/series/{valorant_series_uuid}`:
  - `finalized` → adopt, refresh projection, record the observed `rating_mode`/events;
  - `draft` → "finalization did not complete; retry safely" (the FastAPI transaction either committed or rolled back; a fresh finalize with the same inputs is safe because double-finalize is rejected by the locked transaction).
- Rationale: FastAPI's finalize transaction (advisory lock + `FOR UPDATE` + unique `(run_id, series_id, team_id)` events) either committed atomically or rolled back; a blind retry could double-apply if the first commit was invisible to the caller.

### 8.3 Reconciliation and orphan state (admin-visible)

- `quest_valorant_series.status` values: `draft | finalized | orphaned | reconciliation_required`. **`finalizing` is a Quest-local transport attempt state on the operation record, not a series status** — FastAPI only ever reports `draft`/`finalized`.
- `GET /api/v1/admin/valorant/reconciliation` (admin UI) surfaces:
  - Quest series with no matching FastAPI series (by `external_quest_series_id` or `valorantSeriesUuid`);
  - FastAPI series with no Quest projection (created out-of-band);
  - bindings whose VAL team no longer resolves (FastAPI 404);
  - match projections whose VAL match no longer exists;
  - operations stuck in `in_flight`/`reconciliation_required`.
- All reconciliation reads happen **through FastAPI** (Quest has no direct `valorant` access). Admin-triggered actions: re-sync a projection from FastAPI or adopt a FastAPI series into a Quest projection. No destructive cleanup in MVP.

### 8.4 Rebuildability

- `quest_valorant_*` projections are refreshable from FastAPI (rankings, match list, series preview). Canonical data is never stored only in the projection.
- FastAPI's `POST /api/v1/rankings/rebuild` (admin-gated, `app/api/routes/rankings.py`) remains FastAPI-owned, versioned-run replay. **MVP does not promise finalize-then-rebuild atomicity** — rebuild is a separate, deliberate admin operation if ever needed (deferred beyond MVP).

### 8.5 Chronological rating rule (MVP)

- For **rated** finalization only: FastAPI rejects (409 `BACKDATED_SERIES_REJECTED`, delta D8) any series whose `played_at` is earlier than the latest already-finalized **rated** series. No seven-day window, no backdate override, no `requires_rebuild` flow. Unrated/forfeit finalization is exempt (no standings impact).
- Quest sets `playedAt` at create (default: now) and surfaces the backdate error as-is.

### 8.6 Consistency invariants (enforced + checked)

| Invariant | Enforcement |
|---|---|
| One VAL match rated in at most one series | FastAPI `series_games_match_key` unique (`app/db/models/series_game.py`) + Quest projection mirror |
| Series finalized at most once | FastAPI locked transaction + unique `(run_id, series_id, team_id)` rating events |
| One active binding per SavedTeam | Quest partial unique index + service guard |
| Quest deletion never deletes VAL history | no cross-schema FK; `onDelete: SetNull` binding; guarded `deleteSavedTeam` |
| Rated finalization honors chronological order | FastAPI delta D8 within the finalize transaction |
| Rated finalization verifies anchors | FastAPI delta D6 within the finalize transaction |
| Projections consistent with authority | admin-triggered reconciliation (no undefined periodic resync in MVP) |

---

## 9. Security/privacy and audit

### 9.1 Access boundaries

- Browser → Quest: existing session auth; `requireAdmin` on every `/api/v1/admin/valorant/*` route; existing CSRF/origin protections (`backend/src/middleware/security.js`, `protectAgainstCsrf` in `backend/src/app.js`).
- Quest → FastAPI: HMAC bearer service token (delta D1), private/internal network only. FastAPI is not publicly reachable; production binds to a private interface behind an internal ingress with IP allowlist (mTLS deferred).
- FastAPI → DB: VAL runtime role, DML on `valorant` only; Quest runtime role, DML on `public` only. No anonymous grants (§7.4).

### 9.2 Audit (distinguish FastAPI request ID from Quest operation ID)

- **Quest-side:** every admin VALORANT action writes an `AuditLog` row (`backend/prisma/schema.prisma` L707: `actorUserId`, `action`, `targetType`, `targetId`, `requestId`, `ipAddress`, `beforeData`/`afterData`) **and** a `QuestValorantOperation` row (operation status, FastAPI response code, response summary, reconciliation result). The Quest `operation_id` is the durable cross-service correlation key.
- **FastAPI-side (authoritative, in the finalize transaction):** the finalize transaction persists `series.finalized_by_actor_id` and `series.finalized_by_operation_id` from the validated token claims (delta D7), and every rating event's `calculation_details` records the resolved policy/inputs (`app/services/rating_service.py`). This satisfies "record actor/operation audit context in the VAL domain transaction."
- **Distinction:** FastAPI's per-request correlation ID is the middleware-generated `request_id` (`app/main.py` `RequestIdMiddleware`, echoed as `X-Request-ID`); the **Quest operation ID** is a different identifier propagated in the signed token and `X-Quest-Operation-Id`. Quest stores the echoed FastAPI `X-Request-ID` (`fastapiRequestId`) on the operation row for support correlation.
- **Lost-response reconciliation:** if a finalize commit succeeded but the response was lost, the operation row remains `reconciliation_required`; Quest reads the FastAPI series and adopts its committed state, recording the reconciliation outcome in both `AuditLog` and the operation row. This is the compensating audit mechanism for the commit-succeeded-but-response-lost window.
- Tokens, secrets, and raw candidate payloads are never logged (FastAPI `app/api/errors.py` already strips sensitive validation fields; Quest follows the same rule).

### 9.3 Privacy

- Riot IDs entered by admins are stored only where needed: resolution happens in FastAPI; Quest keeps the two anchor identities on the series row (name/tag at create, resolved PUUIDs on the FastAPI side) and match projection roster snapshots for candidate review. No additional bulk PII collection.
- Henrik raw payloads stay in FastAPI `valorant.matches.raw_payload` (not exposed unless `RAW_PAYLOAD_IN_RESPONSES`); Quest projections store only display fields and a `roster_summary` snapshot.
- Test fixtures and screenshots use scrubbed data (matching FastAPI fixture practice in `tests/fixtures`).

---

## 10. Local development and deployment topology

### 10.1 Local topology (this branch, `chore/local-development-environment`)

```text
Next.js frontend ......... http://localhost:3000
Quest Express backend .... http://localhost:5001   (NEXT_PUBLIC_API_URL=http://localhost:5001)
valorant-platform-backend. http://localhost:8000   (VALORANT_INTERNAL_BASE_URL=http://localhost:8000)
Shared Supabase test project  (schema-specific credentials)
```

- Both services target the **same configured Supabase test project** (never production/staging) with schema-specific runtime credentials: Quest `DATABASE_URL`/`DIRECT_URL` on `public` (existing local workflow in `README.md` and `docs/setup-and-deployment.md` on this branch); FastAPI `DATABASE_URL` on `valorant` (runner `scripts/apply_migrations.py`, `app/config.py`).
- New env vars:
  - Quest: `VALORANT_INTERNAL_BASE_URL`, `VALORANT_SERVICE_SECRET`, `VALORANT_SERVICE_KEY_ID`, `VALORANT_SERVICE_ISSUER=quest-esports`, `VALORANT_SERVICE_AUDIENCE=valorant-platform`, `VALORANT_TIMEOUT_MS`, `VALORANT_READ_RETRIES`. (No `VALORANT_MAX_BACKDATE_DAYS` — backdating is rejected outright in MVP.)
  - FastAPI: `QUEST_SERVICE_SHARED_SECRETS` (`kid:secret` map), `QUEST_SERVICE_ISSUER`, `QUEST_SERVICE_AUDIENCE`, existing `ADMIN_API_KEY` (ops tooling), `HENRIK_API_KEY`, `DATABASE_URL`.
- Validation mirrors `backend/src/config/env.js` conventions: fail fast on missing `VALORANT_SERVICE_SECRET` outside tests; HTTPS-assert the internal base URL in production. `.env` files stay untracked; `.env.example` carries shape only.
- `require_admin`'s `local`/`test` bypass remains for local DX; the production contract requires the service token (delta D1).

### 10.2 Production topology (target)

```text
Browser -> CDN -> Next.js (Vercel)          (public)
              -> Quest Express (Node, private VPC / internal LB)
              -> FastAPI (private network, private interface only)
              -> Supabase project (public + valorant schemas, runtime roles)
```

- Only Quest Express is reachable by the frontend; FastAPI lives on a private network with an IP allowlist. Browser never talks to FastAPI (enforced by topology, not convention).
- Service-token rotation: dual-key window (`kid`); ops scripts rotate the secret in both services; CI secret-scanning already present in `.github/workflows/secret-scan.yml`.
- Backup change required before authoritative VAL data is colocated (§7.6).

### 10.3 Frontend Playwright

- Browser installation is **deferred** on this branch; do not run `npx playwright install` as part of this work.
- Future UI verification uses **Playwright MCP** (or a manual browser) rather than a local Playwright install. Existing `frontend/playwright.config.ts` remains untouched for later use.

---

## 11. Testing and verification strategy

### 11.1 Quest unit tests (node --test, existing style in `backend/tests/`)

- `valorant.validation.test.js`: Riot ID `Name#Tag` parsing/rejection; `externalKey` generation; anchor Riot ID normalization.
- `valorant.client.test.js`: HMAC token signing (claims, `kid`, exp/nbf), header assembly, timeout/abort, read-retry bounds, transport-failure classification.
- `valorant.service.test.js`: binding create/reuse/detach; series-create idempotency (same `external_quest_series_id` returns the same series); operation-record state machine (pending→in_flight→succeeded/failed/reconciliation_required); finalize definitive vs unknown outcomes; reconciliation logic.
- `valorant.routes.test.js`: `requireAdmin` guard on every `/api/v1/admin/valorant/*` route; payload validation; `AuditLog` + operation rows written.

### 11.2 Contract tests (Quest client ↔ FastAPI API)

- Fixture-driven: recorded FastAPI responses (search, import, series, game views, order, finalize, every §6.5 error code) drive `valorant.client` mapping tests. Assumed/undocumented codes are never mapped.
- FastAPI side: contract tests assert the exact request shapes Quest sends (HMAC headers, `external_quest_series_id`, `anchor_player_*`, `rating_mode` literals, `match_id` vs `henrik_match_id` placement).
- Prisma diff guard: CI step asserts `prisma migrate status`/diff references no `valorant` tables and that FastAPI migrations touch no `public` tables.

### 11.3 DB integration tests

- Quest: extend `backend/scripts/run-database-integration-tests.js` (the isolated-test-project runner on this branch) with binding/series-projection/operation tests against the test project: binding reuse, detached soft-state, active-binding uniqueness, guarded SavedTeam deletion, projection rebuild.
- **Reconciliation tests that cross schemas must be FastAPI-side or two-service E2E** — Quest has no direct `valorant` access, so any test asserting "VAL history untouched" runs against FastAPI (its integration suite, e.g. `tests/integration/test_finalization.py`) or the §11.4 E2E harness.

### 11.4 API integration tests (both services up; two-service E2E)

- Boot Quest Express (localhost:5001) + FastAPI (localhost:8000) against the Supabase test project; drive the full journey through Quest routes with a mock admin session:
  1. bind two teams (create-or-get by `quest_saved_team_id`, retry converges);
  2. discover with fixture-stubbed Henrik; assert no overlap → `candidates: []` 200;
  3. import selected match; re-import → 200 `created=false`;
  4. create BO3 with anchors; attach 3 games with side mapping;
  5. set absolute order; preview shows `valid`;
  6. finalize rated → assert two rating events + ranking change; anchor-verification positive path;
  7. finalize again → 409 `SERIES_ALREADY_FINALIZED`, no rating change;
  8. anchor-negative rated finalize → 409 `ANCHOR_MISMATCH` unless explicit reason+mode;
  9. backdated rated finalize → 409 `BACKDATED_SERIES_REJECTED`; unrated finalize → no events, no counters.
- Timeout/unknown-outcome scenario: stub FastAPI to drop the finalize response; assert the operation goes `reconciliation_required` and reconciliation adopts the committed state (never a blind retry).

### 11.5 Rating policy/ELO parity

- ELO math remains FastAPI-owned (characterization tests `tests/characterization/test_elo_calculator_parity.py`; policy tests `tests/unit/test_rating_policy.py`). Quest only asserts the *outcome contract*: `normal`/`manual_override` → two events; `unrated`/`forfeit_*` → none; `forfeit_result_only` → counters without events; `unrated` → no counters; `RATING_POLICY_REQUIRED` (409) surfaced when reason/mode missing.

### 11.6 UI verification (Playwright MCP / manual)

- Browser install deferred; UI verified via **Playwright MCP** or manual flows against localhost:3000 once available: bind flow, discovery + explicit selection, series create with Rated/Unrated preference, attach/reorder/remove with side mapping, preview panel, finalize with audit banner, anchor-mismatch prompt, orphan/reconciliation banner, rankings page. Screenshots use scrubbed data.

---

## 12. Phased implementation slices and acceptance criteria

Each slice is independently shippable; later slices consume only the earlier slice's stable interfaces.

### Slice 0 — Foundation (bindings, operations, transport)

**Deliverables:** Prisma models (§4.3) + migration in `public`; `backend/src/modules/valorant/` skeleton (client, auth, mapper, routes scaffold, validation); env vars + `.env.example`; HMAC bearer signing in Quest **and** FastAPI delta D1 (with `tests/unit/test_service_token.py`); guarded `deleteSavedTeam` change; route mount behind `requireAdmin`; reconciliation endpoint stub.

**Acceptance (testable):**
- A binding row persists a VALORANT team UUID as opaque text with no FK; exactly one **active** binding per SavedTeam is DB-enforced.
- `deleteSavedTeam` returns 409 when an active binding exists; a direct (bypassed) delete leaves the binding row with `savedTeamId = null` and `status = detached`.
- Quest→FastAPI request carries a valid HMAC bearer (`iss`, `aud`, `sub`, `operation_id`, `exp`, `kid`); FastAPI rejects unsigned/malformed/expired tokens with 401 in non-`local`/`test` envs; `GET /api/v1/health` remains unauthenticated.
- Every `/api/v1/admin/valorant/*` route is `requireAdmin`-guarded and writes `AuditLog` + operation rows.

### Slice 1 — Discovery and match import

**Deliverables:** two-player search proxy; candidate list UI with explicit selection; two-stage detail (import for new / `by-henrik-id` for imported); `quest_valorant_matches` projection.

**Acceptance (testable):**
- Candidates show the actual `MatchCandidate` fields (no `winning_side`/roster in the list); no overlap returns an empty list, not an error.
- No candidate is auto-imported or auto-attached; selection is explicit.
- Import is idempotent: 201 `created=true` or 200 `created=false` (informational, never an error).
- Projection matches FastAPI detail after re-sync (admin-triggered).

### Slice 2 — Series build (draft)

**Deliverables:** series-create proxy with `external_quest_series_id` + anchors (deltas D2/D3/D6 columns); attach/remove; absolute desired-order endpoint (delta D9); preview proxy; series/game projection rows.

**Acceptance (testable):**
- BO1/BO3/BO5 supported; create with the same `external_quest_series_id` returns the same series (no duplicate).
- Attach rejects `MATCH_ALREADY_ASSIGNED_TO_SERIES`, `MATCH_NOT_COMPLETED`, `INVALID_SIDE_MAPPING`, `SERIES_INVALID` with the §6.5 mappings.
- Set-order with the same absolute body converges to the same final order on retry; order is draft-only.
- Game/series projections mirror FastAPI state.

### Slice 3 — Preview, finalize, and rankings (required)

**Deliverables:** finalize proxy with `rating_mode` (Rated/Unrated + forfeit/override, delta D4/D5), anchor verification (delta D6), chronological guard (delta D8), audit fields (delta D7); Quest operation state machine + reconciliation-by-read; **admin rankings/rating-history pages** (required in MVP).

**Acceptance (testable):**
- `normal`/`manual_override` finalize produces two rating events and ranking changes; `unrated` produces none (no counters); `forfeit_result_only` updates counters only; `forfeit_no_rating` records neither.
- Forfeit/override modes without a non-empty reason → 409 `RATING_POLICY_REQUIRED`, even when the official winner equals the calculated winner.
- Anchor-negative rated finalize → 409 `ANCHOR_MISMATCH` unless explicit reason + rated mode.
- Backdated rated finalize → 409 `BACKDATED_SERIES_REJECTED`.
- Double finalize → 409, no rating change; timeout finalize → operation `reconciliation_required`, reconciliation adopts the committed state, never a blind retry.
- Actor ID and operation ID are visible in both Quest `AuditLog` and FastAPI `series.finalized_by_actor_id`/`finalized_by_operation_id`.

### Slice 4 — Reconciliation, guardrails, polish

**Deliverables:** reconciliation UI (orphans, missing projections, stuck operations); admin-triggered re-sync/adoption; verification hardening; backup change (§7.6) reviewed and deployed before any authoritative VAL data.

**Acceptance (testable):**
- Reconciliation lists every mismatch class from §8.3 and offers controlled re-sync/adoption via FastAPI reads only.
- Full journey passes the two-service E2E suite (§11.4); UI flows verified via Playwright MCP/manual.

---

## 13. Risks and explicitly deferred decisions

### 13.1 Risks

| Risk | Mitigation |
|---|---|
| Henrik contract drift (auth scheme, side literals, field optionality) | FastAPI fixture-driven contract (`app/integrations/henrik/*`, `tests/unit/test_henrik_*`); Quest maps only observed error codes |
| Henrik rate limiting on discovery | bounded page_size/max_pages; cached resolved identities; two-stage fetch |
| Double-rating via retried finalize | never blind-retry; reconcile-by-read; FastAPI advisory lock + `FOR UPDATE` + unique `(run_id, series_id, team_id)` |
| Anchor mismatch blocking legitimate rated series | explicit audited override path (reason + mode); unrated alternative |
| Quest deletion touching VAL history | no cross-schema FK; `SetNull` binding; guarded `deleteSavedTeam`; E2E test asserts isolation |
| Schema credential misconfig | four roles (§7.1); fail-fast env validation; secret-scanning CI; `.env` untracked |
| Projection drift | admin-triggered reconciliation (§8.3); projections always rebuildable |
| VAL data without backup | §7.6 backup change is a release blocker for Slice 3+ |
| Backdated standings corruption | chronological guard (delta D8) rejects out-of-order rated finalization |
| Playwright/browser gaps | deferred install; Playwright MCP or manual verification |

### 13.2 Explicitly deferred decisions (do not decide now)

- Tournament/fixture linkage of VALORANT series to Quest `Match` (future fixture) and Challonge coordination — out of MVP.
- Roster automation and auto-association from PUUID lineups; anchor verification is the only MVP identity check.
- Public stats, seasons, mobile-admin screens, any public FastAPI exposure.
- mTLS between Quest and FastAPI (IP allowlist + HMAC bearer are the MVP controls).
- `unrated` semantics for future stats: MVP records no rating events and no counters; a null-op event marker is an open question for a later stats pass.
- Rebuild automation after corrections (`POST /api/v1/rankings/rebuild` exists but MVP does not automate it; backdated finalization is simply rejected).
- Exact production hosting for FastAPI (container + private LB vs managed service).
- Whether `X-Admin-Key` remains for ops tooling beyond `rankings/rebuild` (deferred to the D1 implementation).

---

## 14. References (exact current paths)

- Quest Prisma schema: `backend/prisma/schema.prisma` (`SavedTeam` ~L1133, `SavedTeamMember` ~L1154 incl. `riotId`, `Match` ~L582, `MatchParticipant` ~L615, `AuditLog` ~L707).
- Quest admin auth: `backend/src/modules/auth/auth.middleware.js` (`requireAdmin`); admin route pattern `backend/src/modules/admin/admin.routes.js`; mounting `backend/src/routes/v1.js`.
- Quest team deletion: `backend/src/modules/teams/team.service.js` `deleteSavedTeam` ~L643 (guard change required).
- Quest env conventions: `backend/src/config/env.js`; local DB workflow: `README.md` + `docs/setup-and-deployment.md` (this branch).
- Quest API/UX conventions: `docs/api-documentation.md`, `frontend/lib/api.ts`, `frontend/lib/teams.ts`, `frontend/app/admin/`.
- Quest production backup: `ops/backup-production.sh` (schema change required, §7.6).
- FastAPI auth/errors/config: `valorant-platform-backend/app/api/dependencies.py` (`require_admin`), `app/api/errors.py`, `app/config.py`, `app/main.py`.
- FastAPI routes: `app/api/routes/{health,players,match_search,matches,teams,series,rankings}.py`.
- FastAPI models: `app/db/models/{team,series,series_game,match,match_player,player,rating_event}.py`; migrations `supabase/migrations/0001–0013` + runner `scripts/apply_migrations.py`.
- FastAPI policy/rating: `app/domain/ratings/policy.py`, `app/services/rating_service.py`, `app/services/series_service.py`, `app/legacy/elo_calculator.py`.
- FastAPI schemas: `app/schemas/{match_search,matches,series,teams}.py`; tests `tests/unit/*`, `tests/integration/*`, `tests/characterization/*`.

---

# Revision 3 (as-built)

**Status:** Implemented and shipped across four phases (FastAPI contract → Quest backend → Quest admin UI → deployment/verification). This section is appended **after** the fact and records only the **deltas** between the rev-2 design above and what actually shipped. The rev-2 body above is the historical design and is **not** edited. No claim here should be read as design intent — everything below is verified against the shipped code and commit history.

**Verification basis (read before trusting any claim):**
- QuestEsports `chore/local-development-environment` @ `037142a` (head), Phase-2 `66c426a` → Phase-3 `296e66f` → Phase-4 `1ba6a86…1d882e1` → fixes `c0fe1f3`, `037142a`.
- `valorant-platform-backend` `main` @ `5fe4ecc` (head), Phase-1 `882e30a` → deployment tasks `7b56ac4` (T1), `98742a1` (T2), `705bae3` (T6), `2389a69` (T7), `0abbe05` (T8), `5fe4ecc` (T9).
- SDD ledgers: `.superpowers/sdd/2026-08-13-quest-valorant-admin-ui-plan/progress.md`, `.superpowers/sdd/2026-08-13-valorant-deployment-verification-plan/progress.md`.

## R3.1 §4.3 model deltas — `QuestValorantSeries` gained `ratingMode` + anchor name/tag columns

Shipped in Quest migration `backend/prisma/migrations/20260814050249_add_valorant_series_rating_and_anchors/migration.sql` (commit `296e66f`):

```sql
ALTER TABLE "quest_valorant_series" ADD COLUMN "anchor_player_a_name" TEXT,
ADD COLUMN "anchor_player_a_tag" TEXT,
ADD COLUMN "anchor_player_b_name" TEXT,
ADD COLUMN "anchor_player_b_tag" TEXT,
ADD COLUMN "rating_mode" TEXT;
```

- `ratingMode String?` (`rating_mode`) is persisted on the Quest row at **finalize** (`backend/src/modules/valorant/valorant.service.js` `finalizeSeries` updates `ratingMode` alongside `status = "finalized"`).
- `anchorPlayerAName/ATag/BName/BTag` (all nullable) are persisted on the Quest series row at **create** (`valorant.service.js` `createSeries` stores `anchorPlayerAName/ATag/BName/BTag` from the normalized discovery inputs).
- This resolves the rev-2 §4.3-vs-§9.3 contradiction **in favor of §9.3**: Quest keeps the anchor **name/tag** on its own series row; FastAPI resolves and persists the PUUIDs on its side (`series.anchor_a_puuid`/`anchor_b_puuid`, migration `0014_quest_integration.sql`).
- The UI projection (`frontend/lib/valorant.ts` `QuestValorantSeries`) exposes `ratingMode` and the four anchor fields; the committed-series card shows the actual finalized `ratingMode` (not the draft `ratingModePreference`), and the preview anchor strip renders from the persisted anchors.
- Related as-built addition not present in rev-2 §4.3: `QuestValorantSeriesGame` gained `valorantGameUuid String?` (`20260813210411_add_valorant_game_uuid`, Phase 2) to mirror the FastAPI `GameView.id` on attach.
- Quest Prisma migration chain for the feature: `20260813202126_add_valorant_bindings_series_operations` → `20260813210411_add_valorant_game_uuid` → `20260813220931_add_valorant_detach_trigger_security_definer` (all Phase 2, `66c426a`) → `20260814050249_add_valorant_series_rating_and_anchors` (Phase 3, `296e66f`).

## R3.2 §6.4 finalize envelope — `FinalizeResult` is FIRST-CLASS under `data`

- The Quest `finalize` response surfaces `FinalizeResult` **first-class** under `data` — `res.json({ success: true, data: { ...result }, meta })` (`backend/src/modules/valorant/valorant.controller.js:176`), **not** nested under `data.result`. The controller carries a comment: "not nested under `data.result` — the controller test asserts".
- `valorant.service.js` `finalizeSeries` returns `{ ...mapFinalizeResult(response.data), operationId: operation.operationId }`, so `data.operationId` is part of the result surface.
- The Phase-3 frontend originally shipped the **wrong** shape: `valorantAdminRequest<{ result: FinalizeResult }>` (`lib/valorant-api.ts`) and a unit test mocking the same `{ result }` shape — a latent runtime bug (destructuring `const { result }` → `undefined` in `ValorantFinalizeForm.tsx`). It was caught by the Phase-4 E2E cross-phase review (deployment ledger Task 8) and corrected in commit `c0fe1f3` (wrapper generic, finalize form destructure, and unit-test mocks). The wrapper now types `valorantAdminRequest<FinalizeResult>` (first-class).
- The two-service E2E harness asserts the correct shape: `finalize.body.events.length === 2` (deployment plan Task 8, commit `02dc19e`).

## R3.3 §6.3 service token — `sub` is the admin actor id on EVERY request

- As-built, `sub` in the signed token is the admin `users.id` on **every** Quest→FastAPI request — reads **and** writes. `backend/src/modules/valorant/valorant.auth.js` `buildServiceAuthHeaders({ actorUserId, operationId, externalKey })` puts `sub: actorUserId` into every signed token; the controller passes `req.user.id` into every service call.
- **Defect fixed in `037142a`:** the initial Phase-2 read path passed `actorUserId: null` into `listTeams`, `getMatchByHenrikId`, `listMatches`, `previewSeries`, `getRankings`, `getRatingHistory`, `getTeamSeries`, `getReconciliationReport`, so those tokens carried `sub: null`. Commit `037142a` ("send admin actor id as service-token sub on read endpoints") threads `req.user.id` through all eight read handlers.
- Token format as-built: `alg=HS256`, header `{alg, typ, kid}`; claims `{iss: "quest-esports", aud: "valorant-platform", sub, operation_id, iat, nbf = iat − 30s, exp = iat + 300s}` (Quest `TOKEN_TTL_SECONDS = 300`, `ALLOWED_CLOCK_SKEW_SECONDS = 30`).

## R3.4 §7.4 RLS — option (a) implemented: explicit `val_runtime` policies via the migration runner

- Rev-2 left a choice between (a) explicit per-table policies for the runtime role and (b) deliberate RLS-disabled + grants. **Option (a) shipped.**
- `valorant-platform-backend/scripts/apply_migrations.py` `_apply_security_posture` (commit `7b56ac4`, deployment plan Task 1) now, when a runtime role is configured:
  - `GRANT USAGE ON SCHEMA`, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`, `GRANT USAGE, SELECT ON ALL SEQUENCES`, plus matching `ALTER DEFAULT PRIVILEGES` to the runtime role;
  - per application table, idempotently `DROP POLICY IF EXISTS {table}_runtime_all` then `CREATE POLICY {table}_runtime_all ON {table} FOR ALL TO {role} USING (true) WITH CHECK (true)`;
  - `POLICY_EXCLUDED_TABLES = {"_migration_ledger"}` — the ledger is migrator-only and never gets a runtime policy.
- The role is selected by the new `--runtime-role` CLI flag (or `DATABASE_RUNTIME_ROLE` env); the posture still runs when unset (owner-only development/test default). The policy is named `<table>_runtime_all`; the ledger comment in the shipped code reads "never granted to or protected for the runtime role" (RLS-without-policy blocks it; minor M2 in the ledger).
- Verification: `scripts/verify_runtime_access.py` (positive probe + `--expect-denied`) and the `roles-rls` CI job (commit `98742a1`), which creates `val_runtime`/`quest_runtime`, applies migrations with `--runtime-role val_runtime`, asserts the VAL runtime can read/write `valorant`, and asserts the Quest runtime is denied.

## R3.5 §7.6 backup — one consistent two-schema snapshot

- `ops/backup-production.sh` (commit `1ba6a86`, deployment plan Task 5) probes for the `valorant` schema (`pg_namespace`); when present it dumps **both** `public` + `valorant` in a **single** custom-format snapshot (`--format=custom --schema=public --schema=valorant --no-owner --no-acl`), and the manifest records `database_scope=application_public_and_valorant_schemas` and `valorant_schema_included=true` (plus the pre-existing `supabase_managed_schemas_included=false`). Transitional public-only fallback keeps `database_scope=application_public_schema_only`.
- `ops/restore-production-backup.sh` prints post-restore table counts for both `public` and `valorant`; fix round (ledger Ruling R3) made the restore verification **non-fatal** (it must not participate in the rollback/split-brain guard) and made the backup schema probe **loud-fail** rather than silently degrade to a public-only dump.

## R3.6 Other ledger rulings / deferred items that materially shaped the design

- **Reads are not audited operations** (Quest ledger D2): reads write neither `QuestValorantOperation` nor `AuditLog` rows — "every admin action" in §9.2 means **mutating** actions.
- **Series-create retry dedupe** (Quest ledger D1): on whole-operation retry, the service reuses the `externalKey` stored on the operation ledger row (`quest_valorant_operations.external_key`) rather than generating a fresh one — combined with FastAPI `external_quest_series_id` create-or-get, a retried create converges.
- **Import is projection-sync for MVP** (Quest ledger D3): match import is handled as an idempotent projection sync; no new `import` operation type was added.
- **Schema-scope CI guard narrowed** (deployment ledger R5): the Quest `verify-prisma-schema-scope.js` guard was changed from `/\bvalorant\b/i` to schema-reference matching (`valorant\.|"valorant"`) to avoid false positives on the `valorant` game/slug seed data (commit `78b30ae`). The FastAPI migration-scope grep guard (`705bae3`) stays as-is.
- **`QUEST_SERVICE_SHARED_SECRETS` is `kid=secret`** (deployment ledger Task-8 Critical): the format is `"kid1=secret1,kid2=secret2"` (equals-separated, `parse_secrets_map` in `app/api/service_token.py`); the E2E driver's original `e2e:${secret}` (colon) was corrected to `e2e=${secret}` before the harness could run.
- **E2E timeout/unknown-outcome scenario not implemented** (deployment ledger Task-8 M2): the `E2E_DROP_FINALIZE_RESPONSE` opt-in test described in §11.4/plan Task 8 is a tracked follow-up, not shipped.
- **§6.5 mapping as-built:** `backend/src/modules/valorant/valorant.client.js` `VALORANT_ERROR_MESSAGES` maps every rev-2 table row plus the observed `INTERNAL_ERROR`; `FastApiError` (definitive FastAPI code) vs `InternalServiceError` (transport/unknown, codes `valorant_unreachable`/`valorant_upstream_error`/`valorant_not_configured`) is the shipped classification. No assumed codes were added (fixture-tested).

## R3.7 Release-blocker evidence status (ledgers)

All six release blockers from the deployment plan are **code-satisfied**; the runtime **evidence** is still prospective (none runnable in-session): two-schema production backup restore drill, four-role/RLS verification against the production Supabase project, the two-service E2E live run against a provisioned project (`npm run test:valorant:e2e`), live gitleaks run, and green CI on pushed branches.

## R3.8 Post-ship fixes (Aug 14, discovered in local testing)

- **Henrik contract drift** (FastAPI `6a1e0f3`): the live HenrikDev API now returns `metadata.queue` as an object `{id, name, mode_type}` (was a string) and Deathmatch `teams[].team_id` as a per-player UUID (was `"Red"`/`"Blue"`). The mapper now coerces `queue` to its `name` (a `field_validator`) and leaves non-side (UUID) team ids unchanged so `derive_scores` reports those sides absent. Affects the shared `HenrikMetadata` (history list + match detail).
- **Discovery depth + timeout** (Quest `3d9e08d`): the UI's two-player search defaulted to `max_pages=1` (10 matches/player), which could not reach older matches, and the Quest backend's 10s connect timeout aborted the slower multi-page search. The UI now requests `max_pages=5` (the §5.2 bound) and the client `CONNECT_TIMEOUT_MS` is 60s.
- Also landed before these: read-path `sub` = admin UUID on every request (`037142a`) and the first-class finalize envelope (`c0fe1f3`) — both already recorded in R3.2/R3.3.
