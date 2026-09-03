# VALORANT Platform Backend — Approved Architecture Design

**Status:** Approved design; implementation-ready
**Date:** 2026-08-13
**Scope:** Backend only — `valorant-platform-backend`
**Canonical database:** Supabase Postgres (direct PostgreSQL connection)
**VALORANT data source:** HenrikDev API only (`https://api.henrikdev.xyz`)
**Recommended stack:** Python 3.11+ / FastAPI / Pydantic / SQLAlchemy 2.x (async) or asyncpg / Supabase Postgres
**Reference inputs:** `docs/valorant_backend_phase1_phase2_implementation_spec.md` and `docs/repositories-overview.md` (repository reconnaissance of `valorant-lk-elo` and `revival-stats`)

This document is self-contained: an implementer should be able to produce the backend from this file plus the two reference inputs, without the original conversation.

---

## 1. Purpose and scope

### 1.1 Purpose

Build the backend foundation for a VALORANT competition platform in two independent, separately shippable phases:

- **Phase 1 — Match Engine:** resolve Riot IDs through HenrikDev, persist PUUID-keyed player identities, discover shared matches between two players, import canonical match data by Henrik Match ID, and expose a durable Supabase-backed Match Library.
- **Phase 2 — Competition Core:** create teams, compose BO1/BO3/BO5 series from imported Match IDs, map Henrik Red/Blue sides to platform teams, derive map and series winners, allow an official winner override without corrupting the raw game result, preserve the legacy custom ELO engine, and maintain auditable team ratings and rankings.

### 1.2 Central architectural rule

> **A Match is the canonical atomic VALORANT game record. A Series is composed of imported Matches. Team ratings are derived from finalized Series results.**

Scores and winners are always derived from linked imported Henrik matches. The caller never re-enters map scores, and ELO is never caller-supplied.

### 1.3 Dependency chain

```text
HenrikDev API
      |
      v
MATCH ENGINE (Phase 1)
      |
      v
Imported Match Library (Supabase)
      |
      v
SERIES (Phase 2)
      |
      v
TEAMS
      |
      v
RATINGS / RANKINGS

Imported Match Library
      |
      +------> Future statistics pipeline (Phase 3+)
```

### 1.4 Out of scope (hard boundaries)

- Streamlit and any frontend. This project has no UI.
- Riot official API, Riot Sign-On (RSO), Riot OAuth — must not appear as dependencies.
- Tournament registration, brackets, groups, Swiss stages, fixtures.
- Team roster registration, captain/player accounts, ownership verification.
- Revival static JSON import — the 13 static JSON files from `revival-stats` are **not** canonical data and are not imported. The project does **not** assume a Revival generator exists.
- Advanced statistics (round/kill/economy normalization, Impact Rating, leaderboards) — enabled by retained raw payloads, not implemented in Phase 1/2.
- Public end-user authentication.

The explicit non-goal list is expanded in §17.

---

## 2. Independent Phase 1 and Phase 2 gates

The two phases are **independent gates**: each is planned, built, tested, and accepted on its own. Phase 2 consumes only the Phase 1 Match Library read interface, never internal Phase 1 implementation details. Neither phase is a prerequisite for the other's *architecture*; Phase 2 is a prerequisite only for *using* Match Library rows as series games.

### 2.1 Gate 1 — Phase 1 (Match Engine)

**Entry criteria:** skeleton exists (FastAPI app, config, structured logging, health route, Henrik client shell, Postgres connection, migration mechanism, test setup); Henrik API key available in environment.

**Operational capabilities at exit:**

1. Enter two Riot IDs (`name#tag`) of players known to have played against one another; optionally provide map and date/time filters; receive their overlapping recent match IDs with useful metadata.
2. Select a candidate and import that match.
3. Directly import a known Match ID + affinity without two-player search.
4. Retrieve any imported match later entirely from Supabase.
5. Re-import of the same Match ID is idempotent (no duplicate rows).

**Exit criteria (acceptance):** the functional, reliability, and test criteria of §19 of the implementation spec, concretely enumerated in §16.6 of this design.

### 2.2 Gate 2 — Phase 2 (Competition Core)

**Entry criteria:** Gate 1 complete; Match Library stable; legacy `elo_calculator.py` characterized (§13).

**Operational capabilities at exit:**

1. Create Team A and Team B.
2. Create a BO1/BO3/BO5 series in `draft` status.
3. Attach already-imported Match IDs in order with per-game Red/Blue side mapping.
4. Derive each map winner from the imported game; derive series score and calculated winner.
5. Optionally set a different official winner with a mandatory reason.
6. Finalize the series exactly once for rating purposes (atomic, locked, idempotent).
7. Apply the preserved legacy ELO logic.
8. Show current team rankings and auditable rating history.
9. Rebuild rankings deterministically from finalized series.

**Exit criteria (acceptance):** §33 of the implementation spec, concretely enumerated in §16.7.

---

## 3. Architecture: modular monolith

One deployable FastAPI service, organized as internal modules with strict one-way dependencies. No microservices, no separate workers for Phase 1/2 scope.

### 3.1 Target layout

```text
valorant-platform-backend/
  backend/
    app/
      main.py
      config.py
      logging_setup.py

      api/
        dependencies.py
        errors.py
        routes/
          health.py
          players.py
          match_search.py
          matches.py
          teams.py
          series.py
          rankings.py

      domain/
        players/         # pure identity rules
        matches/         # pure match normalization/derivation rules
        teams/
        series/          # BO format validation, side mapping, result derivation
        ratings/         # rating event math, rebuild ordering rules

      integrations/
        henrik/
          client.py
          models.py      # verified response envelope/field mapping
          mapper.py      # upstream JSON -> domain objects; fixture-driven
          exceptions.py

      db/
        models/          # SQLAlchemy 2.x ORM models (or SQL-only if asyncpg)
        repositories/
        session.py

      services/
        player_service.py
        match_discovery_service.py
        match_import_service.py
        series_service.py
        rating_service.py
        ranking_rebuild_service.py

      legacy/
        elo_calculator.py   # preserved legacy ELO math, characterized first

      schemas/           # Pydantic request/response models
        players.py
        matches.py
        teams.py
        series.py
        rankings.py

    tests/
      unit/
      integration/
      fixtures/          # sanitized real Henrik payloads + generated variants

    supabase/
      migrations/        # sequential SQL migrations

    pyproject.toml
    .env.example
```

### 3.2 Dependency direction

Dependencies point **inward only**:

```text
api/routes  ->  services  ->  domain (pure)  +  db/repositories
services    ->  integrations/henrik  +  legacy/elo_calculator
domain      ->  (nothing)          # pure functions, no I/O
db          ->  (nothing)          # SQL/ORM only
```

Rules enforced by code review and imports:

- Routes contain no business logic; they parse requests (Pydantic), call one service, map exceptions, return responses.
- Services orchestrate: call Henrik, call repositories, apply domain rules inside a transaction.
- Domain modules are pure: no HTTP, no SQL. All VALORANT/BO/rating rules live here so they are unit-testable without I/O.
- Only `integrations/henrik/client.py` speaks HTTP to Henrik.
- Only `db/repositories` touch SQLAlchemy sessions / SQL.
- `legacy/elo_calculator.py` depends on nothing; it is pure math preserved from `valorant-lk-elo/elo_calculator.py`.

### 3.3 What the old repositories contributed

- **Preserved in substance:** team competitive-rating concept; BO1/BO3/BO5 series; regular/playoff/finals importance; pure ELO calculation logic; ELO before/after/change history; series/map result semantics; team seeding concept (`seeding_elo = average player ELO` at creation, `competitive_elo` starts at 1000).
- **Replaced/discarded:** Streamlit pages, `st.session_state` workflows, MongoDB service implementation, non-atomic write pattern, caller-supplied ELO, unvalidated manual map scores, hard deletes, connection glue, hardcoded page links, all `revival-stats` static JSON and its display code.

---

## 4. Component boundaries and dependency flow

### 4.1 Henrik boundary

`integrations/henrik/` is the **only** place that knows Henrik's HTTP contract.

- `client.py`: one async `httpx.AsyncClient`; base URL from config; auth header injected centrally; timeouts; bounded retries; rate-limit handling; structured logging of status/duration/X-Request-ID/rate-limit/cache headers. Never logs the API key.
- `models.py`: Pydantic models for the **verified** envelope and field paths (§6). Unknown fields are tolerated (extra="ignore"); only application-required fields are normalized.
- `mapper.py`: maps upstream JSON → application domain objects using fixture-verified field paths and side-literal tables. Fails loudly on missing **required** fields; tolerates missing optional fields.
- `exceptions.py`: normalized exception hierarchy (§14.2).

No other module may reference `api.henrikdev.xyz`, Henrik field names, or rate-limit headers.

### 4.2 Data flow — Phase 1

```text
POST /players/resolve
  -> PlayerService
       -> check local players (by alias/latest identity); return if fresh
       -> else HenrikClient.get_account(name, tag[, force])
       -> validate puuid + affinity
       -> upsert players by puuid; update latest name/tag/affinity/platforms
       -> return player

POST /match-search/two-player
  -> MatchDiscoveryService
       -> resolve A -> puuid + affinity
       -> resolve B -> puuid + affinity
       -> reject incompatible affinities
       -> fetch A history, fetch B history (start=0 first page; see §6.4)
       -> index by metadata.match_id; intersect
       -> apply local map/date filters
       -> build MatchCandidate summaries (scores from teams[].rounds)
       -> return candidates (no candidate payload persisted as canonical)

POST /matches/import
  -> MatchImportService
       -> validate UUID-ish match_id
       -> if matches.henrik_match_id exists: return existing row (unless refresh=true)
       -> GET /valorant/v4/match/{affinity}/{match_id}
       -> validate completed-enough for platform
       -> map required fields; retain full raw payload
       -> BEGIN TX: upsert players by puuid; upsert match; insert match_players
       -> COMMIT  (concurrency-safe; see §7.3)

GET /api/v1/matches[...]  -> Match Library reads, entirely from Supabase
```

### 4.3 Data flow — Phase 2

```text
POST /teams            -> create team, current_elo=1000, seeding_elo optional
POST /series           -> create draft series (team_a != team_b, format, importance)
POST /series/{id}/games -> attach imported match; derive sides, rounds, game winner
GET  /series/{id}/preview -> recompute BO validity + calculated winner (no writes)
POST /series/{id}/finalize -> locked atomic ELO transaction (see §14)
GET  /rankings/teams   -> current_elo desc
GET  /teams/{id}/rating-history -> immutable rating events
rebuild_rankings()     -> internal/admin command, deterministic replay (§14.6)
```

---

## 5. HenrikDev integration boundary (verified contract)

Source of truth is the current HenrikDev documentation. The exact documented URLs used:

- Account: https://docs.henrikdev.xyz/api-reference/valorant/get-account-v2
- Match history by PUUID: https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-puuid-v4
- Match details: https://docs.henrikdev.xyz/api-reference/valorant/get-match-details-v4
- Auth: https://docs.henrikdev.xyz/general/auth
- Rate limiting: https://docs.henrikdev.xyz/general/rate-limiting
- Error codes: https://docs.henrikdev.xyz/valorant/error-codes

### 5.1 Base host

```text
https://api.henrikdev.xyz
```

### 5.2 Authentication (verified: key required; header form unconfirmed)

An API key is required. The exact header form — bare `Authorization: <key>` vs `Authorization: Bearer <key>` — is **not confirmed** by current documentation. The adapter therefore:

- reads the key from `HENRIK_API_KEY` (server-side only, never committed, never returned, never logged);
- sends it via a configurable scheme: `HENRIK_AUTH_SCHEME=bare` (default) or `Bearer`;
- validates the working form against the live API once during integration testing and pins the verified scheme in `HENRIK_AUTH_SCHEME`;
- never guesses per-request.

### 5.3 Endpoints

| Operation | Endpoint | Notes |
|---|---|---|
| Resolve account | `GET /valorant/v2/account/{name}/{tag}` | Optional `force` query parameter (bypasses Henrik cache) is passed through from an explicit refresh path only. Returns PUUID, affinity/region, name, tag, platforms, updated_at, etc. |
| Match history | `GET /valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}` | Query params: `mode`, `map`, `size`, `start`. **No `queue` parameter is currently documented — do not send it.** |
| Match details | `GET /valorant/v4/match/{affinity}/{match_id}` | Canonical import call; envelope `data` is a single match object. |

- `affinity` is the documented path segment (historically "region"); default `eu`, configurable per request. `platform` defaults to `pc` (accepted literals `pc`/`console`; code 42 otherwise).
- Account resolution means *Henrik resolved this Riot ID to a PUUID* — it is not ownership verification.

### 5.4 Response envelope and verified field paths

Both endpoints wrap content in `data`:

- History: `data` is an array of rich match objects.
- Detail: `data` is a single match object.

Verified field paths within a match object:

```text
metadata.match_id        -> canonical Henrik Match ID (identity key)
metadata.map.id          -> map UUID
metadata.map.name        -> map display name
metadata.started_at      -> match start timestamp (ISO-8601)
metadata.is_completed    -> completion flag
metadata.mode            -> game mode (history objects)
metadata.queue           -> queue, may be null
players[]                -> array of participant objects:
    players[].puuid
    players[].name
    players[].tag
    players[].team_id    -> side literal (exact literal values need fixtures, §5.7)
    players[].stats      -> per-player stat object (kills, deaths, assists, damage, shots, etc.)
teams[]                  -> array of team objects:
    teams[].team_id      -> side literal
    teams[].rounds.won   -> rounds won
    teams[].rounds.lost  -> rounds lost
    teams[].won          -> boolean match winner flag
```

Derivation rules:

- `matches.red_score`/`blue_score` are **derived from `teams[].rounds.won`** for the side mapped to Red/Blue — never from `players[].stats`, never caller-supplied.
- `matches.winning_side` is derived from `teams[].won` (with the tolerant `draw/unknown` case; see §10.3).
- Player snapshot rows come from `players[]` (`puuid`, `name`, `tag`, `team_id` → side, `stats` → kills/deaths/assists/damage/shots).

### 5.5 Rate limiting (verified: 429 behavior and headers matter)

Henrik documents usage as: 1 incoming API request = +1, plus +1 for each background Riot request Henrik must make (cache miss). One match-list request may therefore consume multiple units.

Relevant headers (presence varies; treat as optional but log when present):

```text
RateLimit-Policy, RateLimit, X-RateLimit-Limit, X-RateLimit-Remaining,
X-RateLimit-Reset, X-RateLimit-Bucket, X-Request-ID, X-Cache-Status, X-Cache-TTL
```

On `429`:

- read `Retry-After` (seconds) and/or `X-RateLimit-Reset` (unix timestamp); do not tight-loop retry;
- expose a normalized `HENRIK_RATE_LIMITED` error to the caller;
- log Henrik `X-Request-ID` and remaining/reset values;
- the HTTP client may honor `Retry-After` for **bounded** retries of idempotent reads (max `HENRIK_MAX_RETRIES`, default 2) only when the caller opts in; otherwise surface the error immediately.

Practical rules (hard requirements):

1. Cache resolved player identities in Supabase; do not re-resolve on every call.
2. Use PUUID history once identity is known.
3. Default page `size=10`; never fetch huge histories by default.
4. Do not query all ten players to discover one game — two-player histories are the required workflow.
5. After import, serve matches from Supabase; do not call Henrik again for normal retrieval.
6. Only explicit refresh (`refresh=true`) re-fetches a match.

### 5.6 Error normalization (verified codes)

| HTTP | Henrik code | Meaning | App error |
|---|---|---|---|
| 401 | — | missing API key | `HENRIK_AUTH_FAILED` |
| 403 | — | invalid API key | `HENRIK_AUTH_FAILED` |
| 429 | — | rate limited | `HENRIK_RATE_LIMITED` |
| 500/501 | — | upstream/internal, endpoint missing | `HENRIK_UNAVAILABLE` |
| 404 | 22 | account not found | `PLAYER_NOT_FOUND` |
| 404 | 23 | region/affinity for user not found | `PLAYER_REGION_UNKNOWN` |
| 404 | 26 | match not found | `MATCH_NOT_FOUND` |
| 400 | 27 | invalid mode/queue | `INVALID_RIOT_ID`-family input error → `HENRIK_VALIDATION_ERROR` |
| 400 | 28 | invalid map | `HENRIK_VALIDATION_ERROR` |
| 400 | 42 | invalid platform | `HENRIK_VALIDATION_ERROR` |
| 400 | 43 | invalid UUID/PUUID | `INVALID_RIOT_ID` / `HENRIK_VALIDATION_ERROR` |
| 400 | 45 | invalid `start` value | `HENRIK_VALIDATION_ERROR` |

Mapping reads HTTP status plus body `status`/`errors[].code`/`message` (format pinned by fixtures). Retry policy: **only** clearly transient conditions (selected 5xx, network timeouts, optional 429 with Retry-After) and always bounded/exponential. Never retry 400/401/403/404 blindly.

### 5.7 Fixture-driven mapping (side literals and field names)

Two contract details are **not** confirmed and must be pinned from real payloads before the mapper is trusted:

1. **Side literals:** the exact values of `players[].team_id` / `teams[].team_id` (e.g. `"Red"`/`"Blue"`, `"red"`/`"blue"`, or numeric). The mapper uses a verified literal table, e.g. `SIDE_LITERAL_MAP = {"Red": "red", "Blue": "blue"}` seeded from fixtures; any unknown literal raises `HenrikProtocolError` rather than silently misassigning sides.
2. **Optional stat presence:** exact `players[].stats` sub-fields (kills/deaths/assists, damage, headshots/bodyshots/legshots) are pinned against real fixtures. Missing optional stats must not fail import; missing **required** fields (puuid, name/tag, team_id, match identity) must fail import.

The mapper distinguishes required vs optional fields and is covered by fixture tests (§16.1).

---

## 6. Supabase/Postgres direct transaction strategy

Supabase Postgres is canonical, but the backend does **not** route data access through Supabase's REST/PostgREST client. Rationale: PostgREST cannot combine arbitrary separate API requests into one caller-controlled transaction, and Phase 2 finalization requires multi-statement atomicity.

**Decision:** connect to the Supabase database with a normal PostgreSQL connection (SQLAlchemy 2.x async or asyncpg), run schema migrations from `supabase/migrations/`, and execute multi-table operations in direct Postgres transactions. A Postgres function/RPC is an acceptable alternative for a given atomic operation, but a direct transaction is the simplest default for this Python backend.

Consequences:

- Application tables live in a private/non-exposed schema; no anonymous grants. If any table is exposed through Supabase, RLS is enabled with explicit policies and no anonymous writes.
- Backend credentials live only in environment variables (`DATABASE_URL`); never committed, never returned.

---

## 7. Canonical identities, idempotency, and raw payload retention

### 7.1 PUUID is canonical player identity

- `puuid` is the durable player identity key; every player upsert keys on `puuid` (unique constraint).
- `name#tag` is mutable display identity; it is indexed for lookup (`lower(current_name), lower(current_tag)`) but never unique.
- Re-resolving a Riot ID that maps to an existing PUUID updates the current display identity only; historical match snapshots (`name_snapshot`/`tag_snapshot`) are never rewritten.
- Optional `player_aliases` table records historical `(name, tag)` identities per player with unique `(player_id, lower(name), lower(tag))` to support future name-change resolution. Low cost; included.
- Match-level rows always carry `puuid_snapshot` plus the historical `name`/`tag` from that match.

### 7.2 Henrik Match ID is canonical VALORANT match identity

- `matches.henrik_match_id` is `text not null unique`.
- Repeated imports of the same upstream match are idempotent; a concurrent duplicate import resolves to the single winning row (see §7.3).

### 7.3 Import concurrency (unique-conflict race)

The import transaction uses a "soft" pre-check plus the DB unique constraint as the real gate:

1. Select on `henrik_match_id`; if present, return the existing row (unless `refresh=true`).
2. Inside the transaction, insert the match; on `unique violation` of `henrik_match_id`, roll back to a savepoint, re-select, and return the row that won the race.

A DB advisory lock on the `henrik_match_id` text hash is an acceptable alternative implementation; the behavioral requirement is one canonical row per upstream match.

### 7.4 Raw JSONB payload retention (mandatory)

- `matches.raw_payload` is `jsonb not null` and holds the **complete** canonical v4 match-detail response (the `data` object, or the full body as returned).
- `match_players.raw_player_payload` holds each participant's raw `players[]` object (jsonb, nullable).
- Raw payloads are retained even when fields are normalized. Rationale:
  - future statistics can be rebuilt without re-fetching old games;
  - Henrik can evolve its response model;
  - parsing errors can be debugged;
  - Phase 3 can normalize rounds/kills/economy/clutches/abilities later;
  - no Revival generator exists or is assumed; raw retention removes any dependency on recovered generators.
- Normalized relational columns exist for queryable core fields; the raw payload is the compatibility bridge.

---

## 8. Phase 1 entities and Match Library

Migrations are implementer-authored SQL; the logical tables, columns, constraints, and indexes below are required.

### 8.1 `players`

```text
id                  uuid pk
puuid               text not null unique
current_name        text not null
current_tag         text not null
affinity            text null           -- "region"/affinity from account resolution
platforms           text[] or jsonb null
henrik_updated_at   timestamptz null
first_seen_at       timestamptz not null default now()
last_seen_at        timestamptz not null default now()
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()
```

Indexes: `unique(puuid)`; `index(lower(current_name), lower(current_tag))`.

### 8.2 `player_aliases`

```text
id            uuid pk
player_id     uuid FK players
name          text not null
tag           text not null
first_seen_at timestamptz not null default now()
last_seen_at  timestamptz not null default now()
```

Unique: `(player_id, lower(name), lower(tag))`.

### 8.3 `matches`

```text
id                 uuid pk
henrik_match_id    text not null unique
affinity           text not null        -- documented path segment
platform           text not null default 'pc'
map_id             text null
map_name           text not null
mode               text null
queue              text null
started_at         timestamptz not null
duration_ms        bigint null
is_completed       boolean not null
red_score          integer null         -- derived from teams[].rounds.won
blue_score         integer null         -- derived from teams[].rounds.won
winning_side       text null            -- red | blue | draw/unknown
game_version       text null
raw_payload        jsonb not null
henrik_api_version text not null default 'v4'
imported_at        timestamptz not null default now()
refreshed_at       timestamptz null
created_at         timestamptz not null default now()
updated_at         timestamptz not null default now()
```

Constraints: `unique(henrik_match_id)`; `red_score >= 0`; `blue_score >= 0`; `winning_side in ('red','blue','draw','unknown')` when non-null. The model tolerates non-decisive matches for arbitrary game modes; tournament custom matches should normally have a winner but the schema does not assume it.

### 8.4 `match_players` (match-time snapshot)

```text
id                   uuid pk
match_id             uuid FK matches on delete cascade
player_id            uuid FK players
puuid_snapshot       text not null
name_snapshot        text not null
tag_snapshot         text not null
side                 text not null     -- red | blue
agent_id             text null
agent_name           text null
score_total          integer null
kills                integer null
deaths               integer null
assists              integer null
damage_dealt         integer null
damage_received      integer null
headshots            integer null
bodyshots            integer null
legshots             integer null
raw_player_payload   jsonb null
created_at           timestamptz not null default now()
```

Unique: `(match_id, player_id)`. Required fields: PUUID, display name/tag, side, match identity. All stat fields are optional; absence of an optional stat must not fail import.

### 8.5 Match Library (read API surface)

The Match Library is the durable read surface of Phase 1 and the only contract Phase 2 consumes:

- `GET /api/v1/matches` — list with filters `map`, `from`, `to`, `player_puuid`, `limit`, cursor/page.
- `GET /api/v1/matches/{id}` — by internal UUID.
- `GET /api/v1/matches/by-henrik-id/{match_id}` — by canonical Henrik Match ID.
- Detail responses include the match metadata, derived scores/winner, participant snapshots, and a flag/hash indicating raw payload availability (payload itself may be excluded from public responses; see §14.3).

---

## 9. Phase 2 entities

### 9.1 `teams`

```text
id               uuid pk
name             text not null
short_name       text null
slug             text unique
logo_url         text null
current_elo      numeric not null default 1000
peak_elo         numeric not null default 1000
seeding_elo      numeric null           -- legacy compatibility; nullable
matches_played   integer not null default 0
series_wins      integer not null default 0
series_losses    integer not null default 0
is_active        boolean not null default true
created_at       timestamptz not null default now()
updated_at       timestamptz not null default now()
```

`current_elo` is the semantic successor of the old `competitive_elo`. `seeding_elo` is preserved only for future compatibility; team creation does not depend on any external leaderboard. Referenced teams are never hard-deleted; retirement uses `is_active=false`.

### 9.2 `series`

```text
id                      uuid pk
team_a_id               uuid FK teams
team_b_id               uuid FK teams
format                  text not null      -- bo1 | bo3 | bo5
importance              text not null      -- regular | playoff | finals
status                  text not null      -- draft | ready | finalized | void
calculated_winner_id    uuid FK teams null
official_winner_id      uuid FK teams null
winner_override_reason  text null
team_a_maps_won         integer not null default 0
team_b_maps_won         integer not null default 0
played_at               timestamptz null
finalized_at            timestamptz null
notes                   text null
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()
```

Constraints: `team_a_id != team_b_id`; `official_winner_id` in `(team_a_id, team_b_id)` when non-null; `calculated_winner_id` in `(team_a_id, team_b_id)` when non-null; `format` in `('bo1','bo3','bo5')`; `importance` in `('regular','playoff','finals')`; `status` in `('draft','ready','finalized','void')`.

### 9.3 `series_games`

```text
id             uuid pk
series_id      uuid FK series on delete cascade
game_number    integer not null
match_id       uuid FK matches not null
team_a_side    text not null           -- red | blue
team_b_side    text not null           -- the opposite side
team_a_rounds  integer not null        -- derived from match teams[].rounds.won
team_b_rounds  integer not null        -- derived from match teams[].rounds.won
winner_team_id uuid FK teams null      -- derived
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```

Constraints: `unique(series_id, game_number)`; `unique(match_id)` (a canonical match is rated in at most one series — prevents accidental rating double-count); `team_a_side != team_b_side`; `game_number > 0`; `winner_team_id in (team_a_id, team_b_id)` of the owning series (enforced via trigger or application code with FK-level check).

Attaching a game: input is `match_id` (internal UUID), `game_number`, and `team_a_side`. The service derives `team_b_side`, both round scores, and `winner_team_id` from the imported match. Scores are never re-entered.

### 9.4 `rating_events`

```text
id                      uuid pk
series_id               uuid FK series
team_id                 uuid FK teams
elo_before              numeric not null
elo_after               numeric not null
elo_change              numeric not null
opponent_team_id        uuid FK teams
result                  text not null       -- win | loss
k_factor                numeric null
expected_score          numeric null
performance_multiplier  numeric null
importance_multiplier   numeric null
upset_bonus             numeric null
calculation_details     jsonb not null
created_at              timestamptz not null default now()
```

Unique: `(series_id, team_id)`. A rated finalized series produces exactly two events (one per team). `calculation_details` captures inputs enough to reproduce/debug the calculation (ratings, K, E, multipliers, bonus, inputs).

---

## 10. Series state/result invariants

### 10.1 Lifecycle

```text
draft --(attach games)--> ready --(finalize)--> finalized
  \                                      |
   \------(void)-------------------------+
```

- `draft`: games may be attached, removed, reordered, side mappings edited.
- `ready`: all games attached, side-mapped, completed, and BO-valid (preview `valid=true`).
- `finalized`: immutable for rating; the only mutation allowed later is a deliberate correction workflow (void + re-import or rebuild).
- `void`: abandons a draft or reverses a finalized series (see §10.4); never applies/removes rating implicitly without going through the rebuild path.

### 10.2 Best-of validation (not "exactly N maps")

Required wins / max games:

```text
BO1 -> 1 / 1
BO3 -> 2 / 3
BO5 -> 3 / 5
```

Finalization rules (all must hold):

1. Game numbers start at 1 and are contiguous.
2. Every attached game has a valid side mapping.
3. Every attached match has `is_completed=true`.
4. Exactly one team reaches the required number of map wins.
5. No game may exist after the series was already mathematically clinched (e.g., no game 4 in a 2-0 BO3).
6. The calculated winner is the team that reached the required map wins.

Valid shapes: BO3 → 2-0 (2 games) or 2-1 (3 games); BO5 → 3-0, 3-1, or 3-2.

### 10.3 Calculated vs official result

- **Calculated result** derives strictly from imported games: per-game winners → `team_a_maps_won`/`team_b_maps_won` → `calculated_winner_id`.
- **Official result** defaults to the calculated winner. An administrator may override it (`official_winner_id` different, e.g. forfeit after eligibility ruling); a different official winner **requires** `winner_override_reason`.
- The imported match score is **never mutated** to represent a tournament ruling.
- **Rating policy:** ELO uses the *official series winner*; performance/margin inputs remain based on actual imported map scores, unless the preserved legacy calculator defines otherwise (pinned by characterization tests). Rating modes are explicit and named: `normal`, `forfeit_no_rating`, `forfeit_result_only`, `manual_override`. If the policy is ambiguous for an overridden/forfeit series, the implementation **forbids** ELO finalization until a policy is explicitly selected (`RATING_POLICY_REQUIRED`). Overrides are never hidden in generic winner code.

### 10.4 Key invariants (DB constraints + code assertions + tests)

```text
PLAYER:        one puuid => one canonical player
MATCH:         one Henrik Match ID => one canonical imported match
MATCH PLAYER:  one canonical player occurs at most once in one match
SERIES:        team_a_id != team_b_id
SERIES GAME:   one game_number per series
               one canonical match rated in at most one series (unique(match_id))
               team_a_side != team_b_side
FINALIZED:     winner reached the required best-of wins
               all side mappings valid
               rating applied at most once
RATING:        each rated finalized series creates at most one event per team
               team current_elo equals latest/replayed rating history
```

---

## 11. Phase 1 and Phase 2 API surface

All routes versioned under `/api/v1`.

### 11.1 Phase 1

```http
POST /api/v1/players/resolve               {name, tag}
GET  /api/v1/players/{player_id}
GET  /api/v1/players/by-puuid/{puuid}
POST /api/v1/match-search/two-player       {player_a{name,tag}, player_b{name,tag},
                                            platform?, map?, mode?, from?, to?,
                                            page_size?, max_pages?}
POST /api/v1/matches/import                {match_id, affinity, refresh?}
GET  /api/v1/matches[?map&from&to&player_puuid&limit&cursor]
GET  /api/v1/matches/{id}
GET  /api/v1/matches/by-henrik-id/{match_id}
GET  /api/v1/health
```

Two-player search resolves/upserts players (allowed) but never persists candidate payloads as canonical matches. Search returns `{players, candidates[], search{pages_examined, page_size}}`; candidates expose `match_id`, `map`, `started_at`, `mode`, `queue`, `is_completed`, `red_score`, `blue_score`, `already_imported`. Candidate scores derive from `teams[].rounds` in the history objects; no detail calls are made during search.

### 11.2 Phase 2

```http
POST   /api/v1/teams
GET    /api/v1/teams
GET    /api/v1/teams/{id}
PATCH  /api/v1/teams/{id}                 (deactivation via is_active=false)
POST   /api/v1/series                     {team_a_id, team_b_id, format, importance, played_at, notes}
POST   /api/v1/series/{series_id}/games   {match_id, game_number, team_a_side}
DELETE /api/v1/series/{series_id}/games/{game_id}    (draft only)
PATCH  /api/v1/series/{series_id}/games/{game_id}    (draft only)
GET    /api/v1/series/{series_id}/preview
POST   /api/v1/series/{series_id}/finalize {official_winner_id?, override_reason?}
GET    /api/v1/series
GET    /api/v1/series/{id}
GET    /api/v1/rankings/teams             (current_elo desc; rank, name, short_name,
                                           current_elo, peak_elo, series_wins,
                                           series_losses, matches_played)
GET    /api/v1/teams/{team_id}/rating-history
GET    /api/v1/teams/{team_id}/series
```

---

## 12. Legacy ELO preservation and characterization-first migration

### 12.1 Preserve, don't reinvent

The reusable domain logic is `valorant-lk-elo/elo_calculator.py`. The implementation must **inspect the actual file** (not the README, which is known to disagree with code at K-factor boundaries). The reconnaissance-verified rules:

```text
Expected score:   E = 1 / (1 + 10^((B - A) / 400))
K factor:         matches < 10 -> 40
                  matches < 30 -> 30
                  else         -> 20
BO1 multiplier:   round diff <= 2 -> 1.0
                  round diff <= 4 -> 1.1
                  round diff <= 6 -> 1.25
                  round diff <= 8 -> 1.4
                  else            -> 1.5
Series multiplier: map difference + aggregate round bonuses (BO3/BO5) —
                   exact formula taken from the code, not recreated from memory
Importance:       regular -> 1.0 | playoff -> 1.3 | finals -> 1.5
Upset bonus:      loser_elo - winner_elo < 0    -> 0
                  < 100  -> +5
                  < 200  -> +10
                  < 300  -> +15
                  else   -> +20
Winner delta:     K * (1 - E) * performance_multiplier + upset_bonus
Loser delta:      K * (0 - E) * performance_multiplier
```

The system is not necessarily zero-sum; the verified behavior is preserved unless a separate product change is approved.

### 12.2 Characterization-first migration steps

1. Copy `elo_calculator.py` unchanged into `app/legacy/elo_calculator.py` (importable, no I/O).
2. Build characterization tests against the copied code **before any refactor** (see §16.5): golden inputs/outputs generated by executing the legacy code, asserting numerical parity.
3. Only after parity is proven may names be normalized or dead code removed — and only with proof (the dead `estimate_elo_changes` may be removed only if tests show it is unreferenced).
4. Do not "simplify" formulas; preserve exact boundary behavior at 10 and 30 matches.
5. Replace caller-supplied ratings with database-loaded ratings; compute changes server-side; persist every change as an immutable event; update current team rating atomically.

### 12.3 ELO inputs from the new model

- `matches_played` for K is the team's `matches_played` count read inside the finalization transaction (each finalized series increments `matches_played` by the number of games, matching legacy semantics as characterized).
- Ratings come from `teams.current_elo`, loaded and locked inside the transaction.
- The exact mapping of BO3/BO5 "map difference + aggregate round bonuses" to the new `series_games` rows is derived from the characterized legacy code and pinned by tests.

---

## 13. Finalization: locking, atomicity, idempotency

Finalization is the single most correctness-critical operation. The legacy app's independent-writes failure mode (insert match, update team A, update team B as separate writes) is **not** reproduced.

### 13.1 Atomic transaction

```text
BEGIN

lock series row FOR UPDATE
lock team_a row and team_b row FOR UPDATE in deterministic ID order
  (sorted by team UUID to reduce deadlock risk)

verify series.status not in ('finalized', 'void')  else -> 409 SERIES_ALREADY_FINALIZED
recompute game winners from canonical matches (series_games -> matches)
validate BO format and completion (section 10.2)
derive calculated_winner_id
resolve official winner + rating policy (section 10.3)

read team_a.current_elo, team_b.current_elo, matches_played counts
calculate both rating changes via legacy elo_calculator

insert rating_event (series_id, team_a)
insert rating_event (series_id, team_b)

update team_a current_elo/peak_elo/matches_played/series_wins (or losses)
update team_b current_elo/peak_elo/matches_played/series_wins (or losses)

set series final score, calculated_winner_id, official_winner_id,
    status='finalized', finalized_at=now()

COMMIT
```

Any error rolls back all changes.

### 13.2 Concurrency

- Row locks prevent two series involving the same team from finalizing concurrently against the same starting rating.
- Team rows are locked in stable sorted-ID order to avoid deadlocks.
- The `unique(series_id, team_id)` on `rating_events` is a second, DB-enforced guarantee that a series is rated at most once per team.

### 13.3 Idempotency / double-finalize

- `finalize` on an already-finalized series returns `409 SERIES_ALREADY_FINALIZED` (or returns the existing result idempotently); it never reapplies ELO.
- If finalize is invoked concurrently for the same series, exactly one transaction commits; the loser observes the committed `finalized` state.

### 13.4 Rebuild

`rebuild_rankings()` is an internal/admin command (not a public route initially) that:

1. orders eligible finalized series deterministically by `played_at`, then stable tie-breaker (`created_at`, then UUID);
2. resets all team `current_elo`/`peak_elo` to `DEFAULT_INITIAL_ELO` and counters to 0;
3. replays every series through the same rating service;
4. regenerates rating events (delete-and-reinsert within the rebuild transaction);
5. updates current and peak ratings.

It is the recovery path for corrected series, rating-bug fixes, and later historical imports. Rebuild itself is transactional (all-or-nothing per invocation).

---

## 14. Errors, security, observability

### 14.1 HTTP error model

Stable application error codes (independent of Henrik wording):

```text
PLAYER_NOT_FOUND, PLAYER_REGION_UNKNOWN, INVALID_RIOT_ID,
HENRIK_AUTH_FAILED, HENRIK_RATE_LIMITED, HENRIK_UNAVAILABLE,
MATCH_NOT_FOUND, MATCH_ALREADY_IMPORTED, MATCH_NOT_COMPLETED,
NO_OVERLAPPING_MATCHES, SERIES_NOT_FOUND, SERIES_INVALID,
SERIES_ALREADY_FINALIZED, MATCH_ALREADY_ASSIGNED_TO_SERIES,
TEAM_NOT_FOUND, INVALID_SIDE_MAPPING, ANCHOR_NOT_IN_MATCH, RATING_POLICY_REQUIRED
```

Status mapping:

```text
400 malformed/invalid input | 404 missing resource | 409 state conflict
422 semantic validation | 429 upstream rate limited | 502/503 upstream failure
```

Responses carry `{error: {code, message, request_id?}}`; Henrik `X-Request-ID` is surfaced only inside the error detail for support, never the API key.

### 14.2 Henrik exception hierarchy

```text
HenrikError (base)
  HenrikAuthenticationError   (401/403)
  HenrikRateLimitError        (429, carries Retry-After/X-RateLimit-Reset)
  HenrikNotFoundError         (404, carries sub-code 22/23/26)
  HenrikValidationError       (400, carries sub-code 27/28/42/43/45)
  HenrikUnavailableError      (500/501/network)
  HenrikProtocolError         (unexpected envelope/field/side literal)
```

### 14.3 Security baseline

- Henrik key and DB credentials only in backend environment; `.env.example` committed, real `.env` never committed; secrets redacted from structured logs.
- All request bodies validated with Pydantic; all IDs validated (UUID/pattern) **before** any Henrik call.
- HTTP client timeouts configured (`HENRIK_TIMEOUT_SECONDS`, default 15); match-search `page_size` and `max_pages` bounded.
- No anonymous Supabase writes; RLS on any exposed tables, or private/non-exposed application schema.
- Mutation API protected by a simple backend admin token (`ADMIN_API_KEY`) during early development; full end-user auth deferred.
- Raw payloads excluded from default read responses (available via explicit opt-in/flag), limiting payload size and exposure.

### 14.4 Observability

Structured logging (never `print()`). Per Henrik request:

```text
internal request/correlation ID, endpoint category, Henrik X-Request-ID,
HTTP status, duration, X-RateLimit-Remaining, X-RateLimit-Reset,
X-Cache-Status, retry count
```

Per finalization:

```text
series ID, team IDs, input ratings, output ratings, rating event IDs
```

---

## 15. Testing evidence path

Testing is mandatory (both legacy repos had none). Evidence = checked-in fixtures + tests + runnable commands.

### 15.1 Henrik adapter (fixture-driven)

Sanitized real payloads (personal data scrubbed) plus generated variants, checked into `tests/fixtures/`:

- v2 account mapping (valid, `force` present/absent, missing platform, code 22/23).
- v4 history mapping: envelope `data[]`, `metadata.match_id`, `metadata.map.id/name`, `metadata.started_at`, `metadata.is_completed`, `players[].puuid/name/tag/team_id/stats`, `teams[].team_id/rounds.won/rounds.lost/won`; missing optional fields; malformed required fields; unknown side literal → `HenrikProtocolError`.
- v4 detail mapping: envelope `data`, full match normalization, score derivation from `teams[].rounds`, winner from `teams[].won`.
- Error payload parsing for every code in §5.6 (401/403/429, 22/23/26, 27/28/42/43/45).

The side-literal and auth-scheme fixtures are the *evidence* that resolves the unresolved contract validations (§18).

### 15.2 Discovery tests

```text
same one match | multiple overlapping matches | no overlap | map filter |
date filter | different match-list ordering | pagination (start increments, 0-based) |
duplicate match IDs | one account missing | affinity mismatch | Henrik 429 |
invalid start value (code 45)
```

### 15.3 Import tests

```text
new match | same match twice | same match concurrent imports |
match contains known player | player Riot ID changed | missing optional stats |
DB failure rolls back all child rows | raw_payload persisted verbatim
```

### 15.4 Series tests

```text
BO1 1-0 | BO3 2-0 | BO3 2-1 | BO3 invalid 1-1 | BO3 invalid fourth map |
BO5 3-0 | BO5 3-1 | BO5 3-2 | missing side mapping | same side both teams |
match reused in another series | game after clinch | official override |
forfeit policy (RATING_POLICY_REQUIRED when ambiguous)
```

### 15.5 ELO characterization tests

Generated from the legacy calculator before refactor, asserting numerical parity:

```text
K boundaries at 9/10/29/30 matches | equal ratings | large disparity |
upset | BO1 margin thresholds | BO3 | BO5 | regular/playoff/finals |
winner/loser expected scores | upset threshold boundaries
```

### 15.6 Finalization transaction tests

```text
both rating events + both team updates commit together |
simulated failure rolls everything back |
double finalization does not reapply ELO |
concurrent finalization for the same team is serialized safely |
rebuild reproduces standings from finalized series
```

### 15.7 Evidence record

Tests run against a real Supabase Postgres (or local Postgres in CI) for integration tests; Henrik integration tests that hit the live API are opt-in and rate-limited (small size), with all deterministic behavior covered by fixtures. Every acceptance criterion in §16.6/§16.7 maps to at least one named test.

---

## 16. Acceptance criteria (consolidated)

### 16.1 Phase 1 — functional

- Valid `name#tag` resolves through Henrik and persists as a PUUID player.
- Re-resolving the same PUUID is idempotent.
- Two players can be searched for recent overlapping matches; matching uses exact `metadata.match_id`.
- Optional map/date filtering works (map passed to Henrik when safe + applied locally; date applied locally).
- A candidate can be imported; a known Match ID + affinity can be imported directly.
- Re-importing the same Match ID does not duplicate the game.
- Imported match detail served entirely from Supabase.
- Raw Henrik v4 JSON persisted; participant PUUIDs and side assignments normalized.

### 16.2 Phase 1 — reliability

- 429 handled using rate-limit headers (`Retry-After`, `X-RateLimit-Reset`).
- 400/404 validation errors not blindly retried; retries bounded/exponential for transient only.
- Henrik `X-Request-ID` logged; API key never returned/logged.
- Database writes transactional; concurrent duplicate import converges to one row.

### 16.3 Phase 2 — teams and series

- Team creation with durable ID; rating starts at 1000; referenced teams not hard-deletable.
- BO1/BO3/BO5 supported with correct required-win/max-game semantics.
- Only imported matches can be attached; sides map Red/Blue to Team A/Team B; scores derived, not re-entered.
- Calculated winner derived; official winner stored independently; override requires reason.
- Finalization rejects invalid/incomplete series and cannot rate the same series twice.

### 16.4 Phase 2 — ratings

- Legacy ELO has characterization tests; exact BO3/BO5 multiplier behavior pinned from code.
- Finalization writes two rating events atomically; current ELO updates atomically; peak ELO maintained.
- Rating history explains every current rating; rebuild reproduces standings.

### 16.5 Tests

All fixtures checked in; adapter, discovery, import, series, ELO characterization, and finalization-transaction tests present (§15).

---

## 17. Explicit non-goals

Not implemented in Phase 1/2 (and not allowed to turn this into a full esports SaaS):

- Frontend, Streamlit, UI of any kind.
- Tournament registration, brackets, groups, Swiss stages, map veto.
- Team roster registration, captain/player accounts, account ownership verification.
- Riot official API, Riot RSO/OAuth, provider abstractions for a hypothetical Riot migration.
- Automatic one-player roster discovery.
- Revival static JSON import, or any assumption that a Revival generator exists.
- Player career statistics, VLR integration, Discord integration, real-time live match tracking.
- Complete kill/round/economy normalization (Phase 1/2 retain raw payloads only).
- Public authentication system; image/logo storage beyond a URL field.

---

## 18. Future extension points (deliberately enabled)

- **Rosters:** `team_memberships(team_id, player_id, valid_from, valid_to, role)` later enables auto-association of matches to teams from PUUID lineups.
- **Tournaments:** `tournaments / stages / fixtures`; a fixture can point to an existing `series` row.
- **Automatic discovery:** expected-roster PUUIDs → one anchor history → validate all ten expected players; no Match/Series schema redesign.
- **Statistics:** parse retained `matches.raw_payload` / `match_players.raw_player_payload` into `match_rounds`, `kill_events`, economy, plants/defuses, derived stats — no historical Henrik refetch for retained fields. (Revival Impact Rating and player leaderboards can be reimplemented later from these payloads; not now.)

---

## 19. Decisions, tradeoffs, and unresolved contract validations

### 19.1 Decisions (approved)

| # | Decision | Rationale |
|---|---|---|
| D1 | Modular monolith, single deployable FastAPI service | Matches team size and scope; keeps atomic finalization in-process; no distributed-transaction cost |
| D2 | Direct Postgres connection + SQL transactions (not PostgREST) | PostgREST cannot compose multi-statement transactions; Phase 2 needs them |
| D3 | PUUID as canonical player identity; `name#tag` display-only | Riot IDs are mutable; snapshot integrity preserved |
| D4 | Henrik Match ID unique; import idempotent | One canonical row per upstream match; concurrent-safe |
| D5 | Raw v4 payload retained in `jsonb` | Future stats, debugging, schema-evolution safety |
| D6 | Match-list for discovery only; detail endpoint for canonical import | Match-list is a discovery candidate; detail is the canonical snapshot |
| D7 | Two-player intersection retained for discovery | Requested workflow; roster-aware discovery is a future extension |
| D8 | Series composed of imported matches; scores/winners derived | Removes unvalidated manual scores (legacy failure mode) |
| D9 | Calculated vs official winner separated; override needs reason | Handles forfeits/rulings without corrupting game data |
| D10 | Legacy ELO preserved verbatim, characterization-first | The old calculator is the verified crown jewel; README is unreliable |
| D11 | Finalization = locked atomic transaction + DB uniqueness + idempotent 409 | Fixes legacy non-atomic write pattern; guarantees rating applied once |
| D12 | `queue` never sent; `start` begins at 0 (zero-based) | `queue` is undocumented; live-verified 2026-08-13: `start=0` returns the newest match, `start=1` the next, omission equals `start=0` |
| D13 | Side literals and auth scheme pinned from fixtures before trust | Unconfirmed contract details must be evidenced, not guessed |
| D14 | Private/non-exposed schema + RLS-if-exposed; admin token for mutations | Fixes legacy no-auth pattern; full auth deferred |

### 19.2 Tradeoffs

- **Two-player discovery (vs one-anchor):** costs one extra history fetch per search but matches the requested workflow; drops away when rosters arrive.
- **Retaining full payloads (vs lean rows):** storage growth for rebuildability and future stats; the raw payload is the compatibility bridge.
- **Modular monolith (vs microservices):** simpler operations now; seams preserved so services can split later.
- **`refresh=true` re-fetch (vs always-cached):** explicit operator control trades rate units for freshness only when requested.
- **409 on double-finalize (vs silent idempotent return):** explicit conflict surfaces bugs; both are acceptable, 409 chosen for clarity and testability.
- **SQLAlchemy async or asyncpg:** exact ORM choice is left to the implementer; either satisfies the direct-transaction strategy.

### 19.3 Unresolved contract validations (with concrete resolution path)

These are open contract facts, not design gaps. Each has a named resolution action and an owner test; none block schema or service construction.

| ID | Unresolved fact | Resolution action | Evidence |
|---|---|---|---|
| U1 | Exact auth header form (bare `Authorization` vs `Bearer`) | Live integration check once; set `HENRIK_AUTH_SCHEME`; send one form only | Adapter auth fixture + `test_auth_header_form` |
| U2 | Exact `team_id` side literals ("Red"/"Blue" vs other) | Capture real v4 history + detail fixtures; seed `SIDE_LITERAL_MAP`; unknown literal → `HenrikProtocolError` | Side-literal fixtures + `test_side_literal_mapping` |
| U3 | `queue` query parameter absent from docs | Never send it; drop it from all adapter queries; filter queue locally if ever needed | Fixture-based adapter tests assert no `queue` param |
| U4 | Safe first page `start` value (live-verified: zero-based) | Use `start=0` for first page (0 = newest, 1 = next, omission = 0); advance by `size`; map invalid start value (code 45) to `HENRIK_VALIDATION_ERROR` | `test_pagination_start_values` + code-45 fixture |
| U5 | Accepted `mode` literal for custom games | Integration-test the value; if rejected, omit upstream `mode` filter and filter returned metadata locally | `test_mode_filter_custom` |
| U6 | Exact `players[].stats` sub-field presence/names | Pin from real fixtures; required vs optional field list finalized from fixtures | `test_optional_stats_tolerance` |
| U7 | `metadata`/`teams` field optionality across game modes | Pin from fixtures spanning modes; enforce required vs optional per field | `test_missing_optional_fields` |
| U8 | Exact BO3/BO5 series-multiplier formula in legacy code | Read `valorant-lk-elo/elo_calculator.py`; encode via characterization tests before refactor | `test_elo_parity_*` |

---

## 20. References

- HenrikDev — Account v2: https://docs.henrikdev.xyz/api-reference/valorant/get-account-v2
- HenrikDev — Match history by PUUID v4: https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-puuid-v4
- HenrikDev — Match details v4: https://docs.henrikdev.xyz/api-reference/valorant/get-match-details-v4
- HenrikDev — Auth: https://docs.henrikdev.xyz/general/auth
- HenrikDev — Rate limiting: https://docs.henrikdev.xyz/general/rate-limiting
- HenrikDev — Error codes: https://docs.henrikdev.xyz/valorant/error-codes
- Implementation spec: `docs/valorant_backend_phase1_phase2_implementation_spec.md`
- Repository reconnaissance: `docs/repositories-overview.md`
