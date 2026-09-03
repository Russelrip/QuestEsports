# Phase 2 Standardization — Handoff & Testing Guide

**What this is:** a summary of everything implemented in Phase 2 (porting `valorantsl-new`'s
player leaderboard + registration + Discord auth + background workers into
`valorant-platform-backend`), plus a step-by-step guide to test it end-to-end.

**Status:** All 12 implementation tasks are DONE and reviewed. The code is committed but
**nothing is live yet** — the cutover (spec §12) is a separate, gated step.

---

## 1. What was done

| Phase | Scope | What changed |
|---|---|---|
| **A** | Leaderboard read slice | New `leaderboard_players` table + ORM model + repository; leaderboard schemas; `LeaderboardService` + `get_rank_field` (dual-shape tolerant) + Henrik MMR client/mapper; `leaderboard` router + service-token gating + route-inventory |
| **B** | Registration + auth | `register/preview` + `register/submit` (+ aliases); Discord OAuth `auth/login`/`callback`/`check-discord`/`check-puuid` (+ aliases) via a minimal httpx OAuth exchange |
| **C** | Background workers | `workers/updater.py` (30-min rank refresh), `workers/name_audit.py` (weekly name/tag audit), `workers/discord_bot.py` (15-min role/nickname sync + write-back) |
| **D** | Migration | `scripts/migrate_valorantsl_players.py` — run-once copy of ~279 players from `public.players` → `valorant.leaderboard_players` (dry-run default, `--apply` to write) |
| **E** | Quest repoint | `valorant-leaderboard` client now targets `valorant-platform-backend` with a system-actor HMAC token (was anonymous → `api.valorantsl.com`) |
| **F** | valorantsl-new thin BFF | valorantsl-new backend is now a thin forwarder that signs HMAC and proxies every `/api/v1/*` to `valorant-platform-backend`; DB/Henrik/geo logic + `updater/`/`discord-bot/` deleted |

**Resulting architecture:**

```text
Browser (valorantsl-new frontend /register)
  → valorantsl-new backend (thin BFF, signs HMAC)
       → valorant-platform-backend (auth / registration / leaderboard)
            → valorant schema (leaderboard_players) + HenrikDev MMR client

Browser (Quest /valorant-leaderboard)
  → Quest Express (signs HMAC, system actor)
       → valorant-platform-backend (leaderboard router)

valorant-platform-backend workers (updater + name-audit + discord-bot)
  → HenrikDev + Discord → valorant schema (leaderboard_players)
```

### New backend endpoints (all `Depends(require_service_token)`, except `/health`)

```
GET  /api/v1/leaderboard?page=&per_page=
GET  /api/v1/leaderboard/top/{count}
GET  /api/v1/leaderboard/search/{discord_username}
GET  /api/v1/leaderboard/stats
POST /api/v1/register/preview          {puuid}
POST /api/v1/register/submit           {discord_id, discord_username, puuid}
GET  /api/v1/register/preview/{puuid}
POST /api/v1/register                  (submit alias)
GET  /api/v1/auth/discord/login
GET  /api/v1/auth/discord/callback?code=
POST /api/v1/auth/check-discord        {discord_id}
POST /api/v1/auth/check-puuid          {puuid}
GET  /api/v1/auth/login                (login alias)
GET  /api/v1/auth/check-discord/{discord_id}
GET  /api/v1/auth/check-puuid/{puuid}
```

### New workers / scripts

```bash
python -m workers.updater         # 30-min scheduled loop (initial full pass on startup)
python -m workers.updater --once  # one full pass, then exit
python -m workers.updater --test PUUID
python -m workers.updater --info
python -m workers.updater --name-audit   # one-shot name audit
python -m workers.name_audit             # standalone one-shot name audit
python -m workers.discord_bot            # 15-min role/nickname sync (two bots)
python -m scripts.apply_migrations       # plain-SQL migrations (valorant schema)
python -m scripts.migrate_valorantsl_players [--apply]  # one-time data migration
```

---

## 2. Repos, branches, commits

| Repo | Branch | Key commits |
|---|---|---|
| `valorant-platform-backend` | `main` | `031af78` table/model/repo · `ab539a0` upsert fix · `9c15181` schemas · `9343fca` service+MMR · `cc20693` router · `fbe5ee8` registration · `04675a7` auth · `c6e030e` updater · `304aafb`+`d8c1a09` name-audit · `275b635` discord-bot · `50f309a` migration · `5da9368`+`f1d0eae` final hardening |
| `QuestEsports` | `chore/local-development-environment` | `402f5cb` leaderboard client repoint |
| `valorantsl-new` | `master` | `b4ccfca`+`7917d51` thin-BFF conversion |

> Note: the user's own "manual series" commits (`b9f1b94`, `e4682cd`) are interleaved on
> `valorant-platform-backend` `main` and were left untouched.

---

## 3. Testing guide

### 3.1 Prerequisites

- **Python 3.11+** with `uv` (backend + BFF use it; valorantsl-new also has a `requirements.txt`).
- **Postgres 16** — a local container `vp_pg16` is already running on `localhost:5432` (user `postgres`/`postgres`), with the `valorant_platform_test` database.
- **Node 24** (Quest).
- A **HenrikDev API key** (`HENRIK_API_KEY`) — already present in the backend `.env`.
- (For live end-to-end) Discord bot tokens + a Discord server; the valorantsl-new Supabase source DSN.

### 3.2 `valorant-platform-backend` (the primary repo)

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
```

**Run the non-live test suite + lint (baseline):**

```bash
uv run pytest -m "not live" -q
uv run ruff check app tests scripts
```

Expected: tests green **except** one pre-existing network-dependent failure
(`tests/integration/test_quest_contract_shapes.py::test_series_create_contract_shape`), and ruff
shows exactly 7 pre-existing errors in files unrelated to Phase 2. Those are pre-existing baseline
issues, not Phase 2 regressions.

**Run the integration tests (real Postgres):**

```bash
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test \
  uv run pytest tests/integration -q
```

This creates an isolated `it_*` schema, applies every `supabase/migrations/*.sql`, and exercises the
migration + repository + API contracts. (Note: the user's untracked/committed `0016_manual_series.sql`
is also applied — it is self-contained and harmless to these tests.)

**Run the Phase 2 focused tests:**

```bash
uv run pytest tests/unit/test_leaderboard_schemas.py tests/unit/test_rank_field.py \
  tests/unit/test_henrik_mmr.py tests/unit/test_leaderboard_service.py \
  tests/unit/test_leaderboard_routes.py tests/unit/test_registration_service.py \
  tests/unit/test_registration_routes.py tests/unit/test_auth_service.py \
  tests/unit/test_auth_routes.py tests/unit/test_updater.py tests/unit/test_name_audit.py \
  tests/unit/test_discord_bot.py tests/unit/test_migrate_script.py -q
```

**Run the route-inventory contract (5 tests — must stay green):**

```bash
uv run pytest tests/unit/test_route_inventory.py -q
```

**Apply migrations to a target database** (creates the private `valorant` schema + all tables):

```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test \
  uv run python -m scripts.apply_migrations
```

**Start the API locally (auth bypass):**

Set `APP_ENV=local` in `.env` (or export it) so `require_service_token`/`require_admin` are bypassed,
then:

```bash
uv run uvicorn app.main:app --reload --port 8000
```

Smoke-test the endpoints (no token needed when `APP_ENV=local`):

```bash
curl -s localhost:8000/api/v1/health
curl -s "localhost:8000/api/v1/leaderboard?page=1&per_page=10"
curl -s "localhost:8000/api/v1/leaderboard/stats"
curl -s -X POST localhost:8000/api/v1/register/preview -H 'Content-Type: application/json' -d '{"puuid":"<real-puuid>"}'
```

With `APP_ENV=development`/`production` the same requests return 401 unless signed with a valid HMAC
token (see 3.5/3.6 for how Quest/BFF sign it).

### 3.3 One-time data migration

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend

# 1. DRY RUN (no writes) — reads valorantsl-new's public.players
VALORANTSL_SOURCE_DB_DSN="postgresql://<valorantsl-new-supabase>" \
  uv run python -m scripts.migrate_valorantsl_players

# 2. Inspect the summary (source_rows / deduped_rows / mapped_rows / written)

# 3. APPLY (writes to valorant.leaderboard_players via DATABASE_URL)
VALORANTSL_SOURCE_DB_DSN="postgresql://<valorantsl-new-supabase>" \
  uv run python -m scripts.migrate_valorantsl_players --apply

# 4. Verify ~279 rows landed
uv run python -c "import asyncio; from app.db.session import SessionFactory; from sqlalchemy import text; asyncio.run((lambda: None)())" # (see below for a proper check)
```

A quick row-count check (replace with a real script/psql):

```bash
docker exec vp_pg16 psql -U postgres -d valorant_platform_test \
  -c 'SET search_path=valorant; SELECT count(*) FROM leaderboard_players;'
```

The migration maps source columns and drops the legacy extras (`match_stats`, `account_level`,
`card`, `raw_source`, `seasonal_extended_at`, `last_updated`, `row_created_at`, `row_updated_at`);
`rank_details` is left **as-is** to preserve the dual-shape (`flat` vs `data.*`) tolerance.

### 3.4 Workers

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend

# Updater: one full pass over every PUUID in leaderboard_players
uv run python -m workers.updater --once

# Update a single player (sanity check against Henrik)
uv run python -m workers.updater --test <PUUID>

# Show config
uv run python -m workers.updater --info

# Name audit: one pass verifying name/tag drift
uv run python -m workers.name_audit

# Discord bot (needs DISCORD_TOKEN_1/2 + DISCORD_GUILD_ID in .env)
uv run python -m workers.discord_bot
```

All workers read `DATABASE_URL` + `HENRIK_API_KEY` from the backend `.env`. The updater honors the
Sunday 01:30–06:00 Asia/Colombo pause window and an initial full pass; the discord-bot runs two bots
and splits guild members by ID.

### 3.5 `QuestEsports` (the public leaderboard page)

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports

# Config (backend/.env) — add:
#   VALORANT_INTERNAL_BASE_URL=http://localhost:8000   (or the real platform-backend URL)
#   VALORANT_SERVICE_SECRET=<shared secret>
#   VALORANT_SERVICE_KEY_ID=<kid matching the backend's QUEST_SERVICE_SHARED_SECRETS>
#   QUEST_LEADERBOARD_SYSTEM_ACTOR=quest-leaderboard    (any fixed string; backend does not validate sub)

# Run the client test suite
cd backend
node --test tests/valorant-leaderboard.client.test.js \
          tests/valorant-leaderboard.service.test.js \
          tests/valorant-leaderboard.controller.test.js
```

Then start the Quest backend + frontend and open `http://localhost:3000/valorant-leaderboard`.
The page + service/controller are unchanged; only the client now signs an HMAC token.

### 3.6 `valorantsl-new` (thin BFF — registration/auth bridge)

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorantsl-new

# Config (.env) — add:
#   VALORANT_PLATFORM_BASE_URL=http://localhost:8000
#   VALORANTSL_BFF_SYSTEM_ACTOR=valorantsl-bff         (any fixed string)
#   VALORANTSL_BFF_KEY_ID=<kid>
#   VALORANTSL_BFF_SECRET=<secret>                     (the backend's QUEST_SERVICE_SHARED_SECRETS must include this kid=secret)
#   QUEST_SERVICE_ISSUER=quest-esports
#   QUEST_SERVICE_AUDIENCE=valorant-platform

# Run the BFF tests (signer + forwarder)
python -m pytest backend/tests/test_bff.py -q

# Start the BFF
uvicorn backend.app.main:app --reload --port 8001

# Its /api/v1/* now forwards (signed) to VALORANT_PLATFORM_BASE_URL; the frontend keeps calling it.
```

---

## 4. Cutover checklist (spec §12 — gated, do not rush)

1. **Provision env** in all three repos (see the `Config` blocks above; the backend's
   `QUEST_SERVICE_SHARED_SECRETS` must include **both** Quest's kid and the BFF's kid; backend
   `discord_client_id/secret/redirect_uri` must be non-empty or the login URL is broken).
2. **Migration** — dry-run → `--apply`, verify ~279 rows (3.3).
3. **Start workers** against `valorant.leaderboard_players` (3.4).
4. **Repoint Quest** (coded; needs env) and verify the page renders (3.5).
5. **Convert the BFF live** (coded; needs env) and verify registration/auth (3.6) — note the error
   response shape changed from `{"error": true, "message"}` to `{"error": {"code","message","request_id"}}` (frontend error-parsing should be checked here).
6. **Decommission** the old valorantsl-new Supabase `public.players` table (destructive — last).

---

## 5. Known items (non-blocking)

- **7 pre-existing ruff errors** + **1 pre-existing network-dependent test failure**
  (`test_series_create_contract_shape`) — unrelated to Phase 2; a separate cleanup pass.
- **~40 deferred minors** (parity-mandated or cosmetic) are triaged in the SDD ledger:
  `.superpowers/sdd/2026-08-14-valorant-player-leaderboard-standardization/progress.md`.
  Notable ones: OAuth `state`/CSRF param not added (source parity); `access_token` returned to the
  client (source parity — revisit in Phase 3); Discord `_used_codes` grows unbounded; leaderboard
  `discord_username` lookup is case-insensitive against a case-sensitive unique index (source parity).
- The user's "manual series" feature (`0016_manual_series.sql` + series/rating code) is committed on
  `main` and untouched.
