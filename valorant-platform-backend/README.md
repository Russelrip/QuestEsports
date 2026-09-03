# VALORANT Platform Backend

A modular-monolith backend API that imports VALORANT match data from the
[HenrikDev API](https://docs.henrikdev.xyz) into Postgres (via Supabase), runs
two-player match discovery, manages teams and best-of series, and preserves the
legacy ELO rating engine for competition ratings.

This repository implements **Phase 1 (Match Engine)** and **Phase 2
(Competition Core)** of the approved architecture (design §2). Frontend /
Streamlit / Riot-RSO / Revival-JSON import / tournament features are explicit
**non-goals** for these phases — see
[`docs/tournament-future-extension-notes.md`](docs/tournament-future-extension-notes.md)
for the deliberate extension points.

## Table of contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Configuration](#configuration)
- [Database migrations](#database-migrations)
- [Local run](#local-run)
- [Tests](#tests)
- [Containerised production deployment](#containerised-production-deployment)
- [Architecture summary](#architecture-summary)
- [API surface](#api-surface)
- [Security notes](#security-notes)
- [Documentation index](#documentation-index)

## Prerequisites

- **Python 3.11+**
- **PostgreSQL 14+** (local install, Docker, or a Supabase Postgres). SQLite is
  never used.
- **[uv](https://docs.astral.sh/uv/)** — the project uses `uv` for the virtual
  environment and dependency lock (`uv.lock`). `pip install -e ".[dev]"` works
  too (`dev` extra mirrors the uv dev group).

## Setup

```bash
git clone <this repo> && cd valorant-platform-backend

uv sync                 # create .venv and install project + dev deps (uv.lock)
cp .env.example .env    # then edit .env: DATABASE_URL, ADMIN_API_KEY, ...
uv run python -m scripts.apply_migrations   # create schema + apply 0001–0013
uv run uvicorn app.main:app --reload        # start the API on :8000
```

The runner creates the private application schema `valorant` automatically and
the backend connects against it (no manual `CREATE SCHEMA` needed). The default
`DATABASE_URL` points at `localhost:5432`; create the databases first if they
do not exist:

```sql
CREATE DATABASE valorant_platform;
CREATE DATABASE valorant_platform_test;   -- used by the integration tests
```

## Configuration

All settings live in `app/config.py` (`Settings`, pydantic-settings) and are
read from environment variables (upper-cased) or a local `.env` file. The
committed `.env.example` documents every variable with its default. Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | `local`/`test` bypass the admin token; `production` enforces it |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform` | app database |
| `HENRIK_API_KEY` | *(empty)* | HenrikDev key; never committed/logged |
| `HENRIK_TIMEOUT_SECONDS` | `15` | per-request upstream HTTP timeout |
| `HENRIK_MAX_RETRIES` | `2` | bounded exponential retries (transient only) |
| `HENRIK_RETRY_AFTER_CAP_SECONDS` | `30` | cap on the upstream `Retry-After` wait |
| `ADMIN_API_KEY` | *(empty)* | required (outside `local`/`test`) on every mutation/discovery route |
| `RAW_PAYLOAD_IN_RESPONSES` | `false` | echo retained raw payloads in responses (off by default) |
| `TEST_DATABASE_URL` | `...valorant_platform_test` | **test harness only** — not a `Settings` field; the app never reads it (see Tests) |

## Database migrations

**No Alembic.** Migrations are plain SQL files in `supabase/migrations/`,
applied in filename order by `scripts/apply_migrations.py`, each file inside its
own transaction (a small splitter handles multi-statement files including the
PL/pgSQL trigger bodies). The runner maintains a durable `_migration_ledger`
table inside the target schema:

- **Each migration applies exactly once.** Success is recorded transactionally
  (same transaction as the migration); already-applied migrations are skipped
  on rerun.
- **Checksum drift is fatal.** The sha256 of each applied file is recorded; a
  changed, already-applied file aborts the run with a `migration drift` error.
- **Renames/removals are reported.** A ledger entry with no matching file on
  disk is a visible warning (never silently ignored).
- **Private-schema posture (ADR-001).** The runner creates the private schema
  `valorant` (when no `--search-path` is given), revokes `PUBLIC` access on the
  schema/tables/default privileges, and enables row-level security on every
  table. The app connects as the schema/table owner, so its direct connection
  is unaffected; every other role sees nothing.

```bash
uv run python -m scripts.apply_migrations            # creates `valorant` schema + applies
uv run python -m scripts.apply_migrations --database-url postgresql+asyncpg://...:5432/db
```

Current sequence (0001–0013):

```text
0001_players.sql                       players (+ unique puuid, lower(name,tag) index)
0002_matches.sql                       matches (unique henrik_match_id, raw_payload jsonb, checks)
0003_match_players.sql                 match_players (+ unique (match_id, player_id), side check)
0004_teams.sql                         teams (current/peak elo >= 0, unique slug)
0005_series.sql                        series (BO1/3/5, importance, draft|finalized, winner checks)
0006_series_games.sql                  series_games (+ winner-in-owning-series trigger)
0007_rating_runs.sql                   rating_runs (identity run_number, seeded initial run)
0008_rating_events.sql                 rating_events (+ unique (run, series, team), result check)
0009_series_rating_mode.sql            series.rating_mode (+ check over the four modes)
0010_rating_events_immutable.sql       rating_events UPDATE/DELETE rejected at the DB level
0011_rating_events_sequence.sql        per-run application/replay sequence + deferred pair guard
0012_rating_event_sequences.sql        durable sequence reservations (+ events composite FK)
0013_rating_event_sequences_immutable.sql  reservations immutable (UPDATE/DELETE rejected)
```

`scripts/apply_migrations.py` records every applied migration in the
`_migration_ledger` (checksum + timestamp), so **re-running it is a no-op** on
an already-migrated database and a **fatal drift error** if an already-applied
file changed. The upgrade path 0001–0010 → 0011–0013 is proven by
`tests/integration/test_migrations.py`; ledger mechanics (clean apply, rerun
no-op, drift, failure rollback, security posture) are proven by
`tests/integration/test_migration_runner.py`.

## Local run

```bash
uv run uvicorn app.main:app --reload
# http://127.0.0.1:8000/docs  (interactive OpenAPI)
# http://127.0.0.1:8000/api/v1/health
```

## Tests

All commands below use the project-local `.venv` (`uv run`). The suites are
described in detail in [`docs/henrik-integration-notes.md`](docs/henrik-integration-notes.md).

```bash
# Lint
uv run ruff check app tests scripts

# Standard suite (unit + characterization + contract pins). Integration tests
# SKIP when TEST_DATABASE_URL is unset, so this runs anywhere.
uv run pytest -m "not live" -q

# Full suite on real Postgres (mandatory for integration/concurrency).
# The harness creates a fresh isolated schema per session, applies 0001–0013,
# and truncates between tests.
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test \
  uv run pytest -m "not live" -q

# Live Henrik tests (OPT-IN only — real network, rate-limited). The
# tests/integration/live package is double-protected: the `live` marker
# deselects it from every -m "not live" run, and its conftest skips every test
# unless BOTH HENRIK_API_KEY and RUN_LIVE_HENRIK=1 are set. Live tests use
# size=1 (see tests/integration/live/README.md).
HENRIK_API_KEY=... RUN_LIVE_HENRIK=1 uv run pytest -m live tests/integration/live -q

# Wave-0 contract probe: fixture-only by default; --live requires HENRIK_API_KEY
# and is hard-bounded to 7 requests. Never logs or commits the key.
uv run python -m scripts.henrik_contract_probe
HENRIK_API_KEY=... HENRIK_TEST_ACCOUNT="name:tag" uv run python -m scripts.henrik_contract_probe --live
```

## Containerised production deployment

The production image/Compose contract, private-CA HTTPS health smoke, write
freeze, release lock, and weekly name-audit timer are documented in
[`docs/containerised-deployment.md`](docs/containerised-deployment.md).

CI (`.github/workflows/ci.yml`) runs `ruff` and the full non-live suite against
a Postgres 16 service container with the same `TEST_DATABASE_URL`.

## Architecture summary

Modular monolith (FastAPI + SQLAlchemy 2.x async + asyncpg), documented in
`docs/architecture-decisions.md` (ADRs) and the design doc:

```text
app/
  api/          routes, dependencies (require_admin), error model
  config.py     pydantic-settings Settings (env / .env)
  db/           models + repositories (SQLAlchemy)
  domain/       pure logic: match derivation, series BO/results/sides, rating policy
  integrations/henrik/  the ONLY HTTP module (client, mapper, contract pins)
  legacy/       verbatim legacy ELO calculator (characterization-tested)
  schemas/      Pydantic request/response models
  services/     player, match discovery/import/library, team, series, rating,
                ranking, ranking-rebuild
scripts/        apply_migrations.py, henrik_contract_probe.py
supabase/migrations/  plain-SQL migrations (0001–0013)
tests/          unit / characterization / integration (real Postgres) / fixtures
```

Key rules:

- **Canonical identities:** PUUID is player identity; `henrik_match_id` is
  match identity (unique, idempotent import). `name#tag` is display-only.
- **Discovery vs canonical:** match-list history produces discovery candidates;
  the match-detail endpoint is the canonical snapshot persisted on import.
- **Raw retention:** the upstream v4 match-detail **`data` object** is
  persisted verbatim in `matches.raw_payload` (the transport envelope's
  `status`/top-level fields are not stored); responses expose it only via the
  `RAW_PAYLOAD_IN_RESPONSES` opt-in.
- **Scores/winners are derived**, never caller-supplied; `series_games` maps
  imported matches with Red/Blue → Team A/Team B sides.
- **Finalization** is one atomic, advisory-locked transaction that applies the
  legacy ELO math, writes two immutable `rating_events` under the current
  versioned `rating_runs` row, and can never rate a series twice.
- **Rating runs are versioned**: `POST /api/v1/rankings/rebuild` replays every
  finalized series into a NEW run, preserving prior runs byte-for-byte
  (immutable audit).
- **Admin token** (`ADMIN_API_KEY`, constant-time compare) gates every
  POST/PATCH/DELETE route and the Henrik-consuming discovery routes; reads are
  public.

## API surface

All routes are versioned under `/api/v1`. `*` = admin-protected
(`Depends(require_admin)`). The complete inventory — methods, paths, request/
response models, and the admin-coverage invariant — is enforced by
`tests/unit/test_route_inventory.py` against the live OpenAPI document.

**Phase 1 (Match Engine)**

```text
GET    /api/v1/health
POST   /api/v1/players/resolve *                  PlayerResolveRequest -> PlayerResponse
GET    /api/v1/players/{player_id}
GET    /api/v1/players/by-puuid/{puuid}
POST   /api/v1/match-search/two-player *          TwoPlayerSearchRequest -> TwoPlayerSearchResult
POST   /api/v1/matches/import *                   MatchImportRequest -> MatchImportResponse (201|200)
GET    /api/v1/matches                            MatchListResponse (filterable, keyset cursor)
GET    /api/v1/matches/{id}
GET    /api/v1/matches/by-henrik-id/{match_id}
```

**Phase 2 (Competition Core)**

```text
POST   /api/v1/teams *                            TeamCreate -> TeamResponse (201)
GET    /api/v1/teams
GET    /api/v1/teams/{id}
PATCH  /api/v1/teams/{id} *                       TeamUpdate (deactivation via is_active=false; no DELETE)
GET    /api/v1/teams/{team_id}/rating-history
GET    /api/v1/teams/{team_id}/series
POST   /api/v1/series *                           SeriesCreate -> SeriesView (201 draft)
POST   /api/v1/series/{series_id}/games *         AttachGameRequest -> GameView (201)
PATCH  /api/v1/series/{series_id}/games/{game_id} *   UpdateGameRequest (draft only)
DELETE /api/v1/series/{series_id}/games/{game_id} *   (draft only)
GET    /api/v1/series/{series_id}/preview         derived readiness + calculated winner
POST   /api/v1/series/{series_id}/finalize *      FinalizeRequest -> FinalizeResult
DELETE /api/v1/series/{series_id} *               (draft only)
GET    /api/v1/series
GET    /api/v1/series/{id}
GET    /api/v1/rankings/teams
POST   /api/v1/rankings/rebuild *                 RebuildResult (internal/admin command)
```

Errors use the stable envelope `{"error": {"code", "message", "request_id"?}}`;
the full code → HTTP table is in Appendix B of the implementation plan and in
`app/api/errors.py`.

## Security notes

- Secrets (`HENRIK_API_KEY`, `ADMIN_API_KEY`, `DATABASE_URL`) are environment-only;
  `.env` is git-ignored, `.env.example` is committed. A secret scan is part of
  Task 17 validation (grep the tree — no real secrets in committed code).
- Admin mutations are denied by default in `production` (`401
  ADMIN_AUTH_REQUIRED`) unless a configured key matches in constant time.
- Application tables live in the private `valorant` schema; the migration
  runner revokes `PUBLIC` access on the schema/tables/default privileges and
  enables RLS on every table (ADR-001). The app connects as the schema/table
  owner, so its direct connection is unaffected; every other role sees nothing.
- Upstream HTTP calls have a configured timeout and a bounded retry budget;
  `X-Request-ID` correlation IDs are on every request; unhandled exceptions are
  sanitized into `INTERNAL_ERROR` (no traceback/secret leakage). Henrik
  protocol errors surface as `HENRIK_UNAVAILABLE` (503), never 500.
- Raw upstream payloads are excluded from default read responses.

## Documentation index

| Doc | Contents |
|---|---|
| [`docs/henrik-integration-notes.md`](docs/henrik-integration-notes.md) | HenrikDev integration runbook: contract pins, rate-limit etiquette, error mapping, live opt-in |
| [`docs/henrik-contract.md`](docs/henrik-contract.md) | Wave-0 pinned contract table (U1–U7) and fixture evidence |
| [`docs/architecture-decisions.md`](docs/architecture-decisions.md) | ADR-001…ADR-027 (schema, ELO policy locks, security/ops) |
| [`docs/tournament-future-extension-notes.md`](docs/tournament-future-extension-notes.md) | Phase-3/tournament TODOs and deliberate extension points |
| `docs/superpowers/specs/2026-08-13-valorant-platform-backend-design.md` | Approved architecture design |
| `docs/superpowers/plans/2026-08-13-valorant-platform-backend-implementation.md` | Approved implementation plan |
