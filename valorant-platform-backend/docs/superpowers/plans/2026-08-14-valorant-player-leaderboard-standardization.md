# Valorant SL Player Leaderboard Standardization — Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all `valorantsl-new` endpoints, the player data model, and the background workers into `valorant-platform-backend`, then repoint Quest's proxy and convert `valorantsl-new` to a thin BFF.

**Architecture:** New `leaderboard_players` table + `leaderboard`/`registration`/`auth` routers (service-token gated) in `valorant-platform-backend`, a `workers/` package (updater + name-audit + discord-bot), a one-time migration script, a Quest client repoint (system-actor signed), and a `valorantsl-new` thin-BFF conversion. Executed in dependency order with atomic cutover.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, asyncpg, pydantic v2, pytest + ruff (backend); Node 24 / Express 5 (Quest); FastAPI (valorantsl-new BFF).

**Spec:** `valorant-platform-backend/docs/superpowers/specs/2026-08-14-valorant-player-leaderboard-standardization-design.md`

## Global Constraints

- All new backend code follows the existing route → service → repository → session layering; errors via `AppError(code, status, message)` with UPPER_SNAKE codes; responses via Pydantic `response_model=`.
- Every new `/api/v1` route is gated by `Depends(require_service_token)` (the repo invariant: `/health` is the only open route). Add every new route to `DOCUMENTED_SURFACE` in `tests/unit/test_route_inventory.py` — 5 contract tests enforce no-drift.
- Migrations are plain SQL in `supabase/migrations/`, applied by `scripts/apply_migrations.py`; no Alembic.
- Backend is fully async; SQLAlchemy 2.0 `Mapped`/`mapped_column`; JSONB via `sqlalchemy.dialects.postgresql`.
- Field names are snake_case in the API (matching both `valorantsl-new` and the repo), so Quest's Phase-1 `valorant-leaderboard` mapping is unchanged.
- Preserve the `rank_details` dual-shape tolerance (`get_rank_field`: read `rank_details[key]`, fall back to `rank_details["data"][key]`).
- Leaderboard filter is exactly: `elo IS NOT NULL AND last_played_match >= now()-14d AND currenttierpatched != 'Unrated'`, ordered `elo DESC`.
- No geo-gating anywhere.
- Backend run: `cd valorant-platform-backend && uv run pytest -m "not live" -q` and `uv run ruff check app tests scripts`.
- Commit style mirrors the repo: `feat(leaderboard): …`, `feat(registration): …`, `feat(auth): …`, `feat(workers): …`.

## Phase decomposition

| Phase | Scope | Repo | Depends on |
|---|---|---|---|
| A | Leaderboard read slice (table + model + repo + schemas + service + router + Henrik MMR client) | `valorant-platform-backend` | — |
| B | Registration + Discord auth endpoints | `valorant-platform-backend` | A |
| C | Background workers (updater + name-audit + discord-bot) | `valorant-platform-backend` | A |
| D | One-time migration script | `valorant-platform-backend` | A |
| E | Quest proxy repoint (system actor) | `QuestEsports` | A |
| F | `valorantsl-new` thin BFF | `valorantsl-new` | B |

Each phase produces working, testable software. Execute A → (B, C, D in any order) → E → F, then cut over per spec §12.

---

## Phase A — Leaderboard read slice

### Task 1: `leaderboard_players` table + model + repository

**Files:**
- Create: `supabase/migrations/0015_leaderboard_players.sql`
- Create: `app/db/models/leaderboard_player.py`
- Modify: `app/db/models/__init__.py` (export `LeaderboardPlayer`)
- Create: `app/db/repositories/leaderboard_player_repository.py`
- Test: `tests/integration/test_leaderboard_players.py` (migration + repo round-trip; skips without `TEST_DATABASE_URL`)

**Interfaces:**
- Produces: `LeaderboardPlayer` ORM model; `LeaderboardPlayerRepository` with `list_page(page, per_page) -> tuple[list[LeaderboardPlayer], int]`, `get_by_discord_username(username) -> LeaderboardPlayer | None`, `get_stats() -> dict`, `get_by_puuid(puuid)`, `upsert(**fields)`.

- [ ] **Step 1: write the migration**

`supabase/migrations/0015_leaderboard_players.sql`:

```sql
-- 0015_leaderboard_players.sql — SL player leaderboard (Phase 2, spec §4)
CREATE TABLE leaderboard_players (
    puuid text PRIMARY KEY,
    name text NOT NULL,
    tag text NOT NULL,
    region text NOT NULL,
    discord_id text NOT NULL DEFAULT '',
    discord_username text NOT NULL,
    elo integer,
    currenttierpatched text,
    rank_details jsonb NOT NULL DEFAULT '{}',
    peak_rank jsonb,
    seasonal_ranks jsonb,
    last_played_match timestamptz,
    update_source text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX leaderboard_players_discord_username_key
    ON leaderboard_players (discord_username);
CREATE UNIQUE INDEX leaderboard_players_discord_id_key
    ON leaderboard_players (discord_id) WHERE discord_id <> '';
CREATE INDEX leaderboard_players_elo_idx ON leaderboard_players (elo DESC);
CREATE INDEX leaderboard_players_last_played_idx ON leaderboard_players (last_played_match);
```

- [ ] **Step 2: write the ORM model**

`app/db/models/leaderboard_player.py` (mirror `app/db/models/team.py` conventions):

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class LeaderboardPlayer(Base):
    """A Sri Lankan Valorant leaderboard entry (Phase 2; distinct from match-engine ``Player``)."""

    __tablename__ = "leaderboard_players"

    puuid: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    tag: Mapped[str] = mapped_column(Text, nullable=False)
    region: Mapped[str] = mapped_column(Text, nullable=False)
    discord_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    discord_username: Mapped[str] = mapped_column(Text, nullable=False)
    elo: Mapped[int | None] = mapped_column(Integer)
    currenttierpatched: Mapped[str | None] = mapped_column(Text)
    rank_details: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    peak_rank: Mapped[dict | None] = mapped_column(JSONB)
    seasonal_ranks: Mapped[list | None] = mapped_column(JSONB)
    last_played_match: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    update_source: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("discord_username", name="leaderboard_players_discord_username_key"),
        Index("leaderboard_players_elo_idx", "elo"),
        Index("leaderboard_players_last_played_idx", "last_played_match"),
    )
```

Register it in `app/db/models/__init__.py` (add `from app.db.models.leaderboard_player import LeaderboardPlayer` alongside the other model imports, so the single `Base` metadata picks it up).

- [ ] **Step 3: write the repository**

`app/db/repositories/leaderboard_player_repository.py` — mirror `app/db/repositories/team_repository.py` style (thin, owns all SQL). Core methods:

```python
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.leaderboard_player import LeaderboardPlayer

_LEADERBOARD_FILTERS = (
    LeaderboardPlayer.elo.is_not(None),
    LeaderboardPlayer.currenttierpatched != "Unrated",
)

class LeaderboardPlayerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_page(self, page: int, per_page: int) -> tuple[list[LeaderboardPlayer], int]:
        cutoff = datetime.now(timezone.utc) - timedelta(weeks=2)
        filters = (*_LEADERBOARD_FILTERS, LeaderboardPlayer.last_played_match >= cutoff)
        rows = (await self._session.execute(
            select(LeaderboardPlayer).where(*filters)
            .order_by(LeaderboardPlayer.elo.desc())
            .offset((page - 1) * per_page).limit(per_page)
        )).scalars().all()
        total = (await self._session.execute(
            select(func.count()).select_from(LeaderboardPlayer).where(*filters)
        )).scalar_one()
        return rows, total

    async def get_by_discord_username(self, discord_username: str) -> LeaderboardPlayer | None:
        return (await self._session.execute(
            select(LeaderboardPlayer)
            .where(func.lower(LeaderboardPlayer.discord_username) == discord_username.strip().lower())
            .limit(1)
        )).scalar_one_or_none()

    async def get_stats(self) -> dict:
        total, highest, lowest, average = (await self._session.execute(
            select(func.count(), func.max(LeaderboardPlayer.elo), func.min(LeaderboardPlayer.elo), func.avg(LeaderboardPlayer.elo))
            .where(LeaderboardPlayer.elo.is_not(None))
        )).one()
        dist = (await self._session.execute(
            select(LeaderboardPlayer.currenttierpatched, func.count())
            .where(LeaderboardPlayer.currenttierpatched.is_not(None))
            .group_by(LeaderboardPlayer.currenttierpatched)
        )).all()
        return {
            "total_users": total,
            "highest_elo": highest if highest is not None else 0,
            "lowest_elo": lowest if lowest is not None else 0,
            "average_elo": round(average, 2) if average is not None else 0,
            "rank_distribution": {tier: cnt for tier, cnt in dist},
        }

    async def get_by_puuid(self, puuid: str) -> LeaderboardPlayer | None:
        return await self._session.get(LeaderboardPlayer, puuid)

    async def upsert(self, *, puuid: str, name: str, tag: str, region: str, **fields) -> LeaderboardPlayer:
        stmt = pg_insert(LeaderboardPlayer).values(puuid=puuid, name=name, tag=tag, region=region, **fields)
        stmt = stmt.on_conflict_do_update(
            index_elements=[LeaderboardPlayer.puuid],
            set_={k: stmt.excluded[k] for k in fields},
        ).returning(LeaderboardPlayer)
        return (await self._session.execute(stmt)).scalar_one()
```

- [ ] **Step 4: write the integration test**

`tests/integration/test_leaderboard_players.py` — the harness creates an isolated `it_<uuid>` schema, applies all migrations, truncates between tests (see `tests/integration/conftest.py`). Assert: migration creates the table + indexes; `list_page` filters out `elo IS NULL`, `currenttierpatched = 'Unrated'`, and `last_played_match` older than 14 days; `get_by_discord_username` is case-insensitive; `get_stats` aggregates correctly; `upsert` inserts then updates on conflict.

- [ ] **Step 5: run**

Run: `cd valorant-platform-backend && TEST_DATABASE_URL=postgresql+asyncpg://.../valorant_platform_test uv run pytest tests/integration/test_leaderboard_players.py -q` (real Postgres; skips without `TEST_DATABASE_URL`) and `uv run ruff check app tests scripts`.

- [ ] **Step 6: commit**

```bash
cd /Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend
git add supabase/migrations/0015_leaderboard_players.sql app/db/models/leaderboard_player.py app/db/models/__init__.py app/db/repositories/leaderboard_player_repository.py tests/integration/test_leaderboard_players.py
git commit -m "feat(leaderboard): add leaderboard_players table, model, and repository"
```

### Task 2: leaderboard schemas

**Files:**
- Create: `app/schemas/leaderboard.py`
- Test: `tests/unit/test_leaderboard_schemas.py`

**Interfaces:**
- Produces: `LeaderboardEntry`, `LeaderboardPage`, `LeaderboardStats` (snake_case, mirroring `valorantsl-new` exactly so Quest's mapping is unchanged).

- [ ] **Step 1: write the schemas**

```python
from __future__ import annotations

from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    puuid: str
    name: str
    tag: str
    discord_username: str
    current_tier: str | None = None
    elo: int | None = None
    rank_in_tier: int | None = None
    peak_rank: str | None = None
    peak_season: str | None = None
    last_played_match: str | None = None


class LeaderboardPage(BaseModel):
    entries: list[LeaderboardEntry]
    total: int
    page: int
    per_page: int
    total_pages: int


class LeaderboardStats(BaseModel):
    total_users: int
    highest_elo: int
    lowest_elo: int
    average_elo: float
    rank_distribution: dict[str, int]
```

- [ ] **Step 2: write a small unit test** (constructor + optional-field defaults; `LeaderboardPage` accepts `entries=[]`).

- [ ] **Step 3: run + commit** — `uv run pytest tests/unit/test_leaderboard_schemas.py -q`; commit `feat(leaderboard): add leaderboard schemas`.

### Task 3: `leaderboard_service` + HenrikDev MMR client + `get_rank_field`

**Files:**
- Create: `app/services/leaderboard_service.py`
- Create: `app/services/rank_field.py` (the `get_rank_field` helper, shared with registration/workers)
- Modify: `app/integrations/henrik/client.py` (add `get_player_mmr`, `get_last_competitive_match`)
- Modify: `app/integrations/henrik/mapper.py` (MMR → `rank_details`/`peak_rank` mapping)
- Test: `tests/unit/test_leaderboard_service.py`, `tests/unit/test_rank_field.py`, `tests/unit/test_henrik_mmr.py`

**Interfaces:**
- Consumes: `LeaderboardPlayerRepository`, `HenrikClient` (new MMR methods).
- Produces: `LeaderboardService(session, repo)` with `leaderboard(page, per_page) -> LeaderboardPage`, `top(count) -> list[LeaderboardEntry]`, `search(discord_username) -> LeaderboardEntry | None`, `stats() -> LeaderboardStats`; `get_rank_field(rank_details, key, default=None)`; `HenrikClient.get_player_mmr(puuid) -> dict`, `get_last_competitive_match(puuid) -> dict`.

- [ ] **Step 1: `get_rank_field` helper** — port verbatim from `valorantsl-new` `backend/app/models/user.py` (`get_rank_field`), dual-shape tolerant.

- [ ] **Step 2: extend `HenrikClient`** with two methods, mirroring `get_account`/`get_matches_by_puuid` style (envelope validation + mapper):
  - `get_player_mmr(puuid)` → `GET /valorant/v3/by-puuid/mmr/{affinity}/{platform}/{puuid}`.
  - `get_last_competitive_match(puuid)` → `GET /valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}?mode=competitive&size=1`.
  Add `HenrikMapper` methods that map the MMR payload to `{elo, currenttierpatched, ranking_in_tier, peak_rank:{tier_name, season_short, tier}, …}` (handle both `data.current` flat and `data` nested shapes).

- [ ] **Step 3: write `LeaderboardService`** — a thin read service (no Henrik): `leaderboard()` builds `LeaderboardEntry` from repo rows using `get_rank_field(rank_details, "ranking_in_tier")`, `peak_rank=(player.peak_rank or {}).get("tier_name")`, `peak_season=(player.peak_rank or {}).get("season_short")`, `last_played_match=isoformat or None` (exactly `valorantsl-new` `database.py:164-185`); `top(count)` = `leaderboard(1, count).entries`; `search()` maps a single repo row; `stats()` returns repo stats. 404 on out-of-range page is raised by the router, not the service.

- [ ] **Step 4: unit tests** with a fake repo/fake client; assert the filter is enforced at the repo level (already tested in Task 1) and the service mapping is field-exact (including `peak_rank`/`peak_season` extraction and the dual-shape `rank_details`).

- [ ] **Step 5: run + commit** — `uv run pytest tests/unit/test_leaderboard_service.py tests/unit/test_rank_field.py tests/unit/test_henrik_mmr.py -q`; commit `feat(leaderboard): add leaderboard service and henrik MMR client`.

### Task 4: leaderboard router + wiring + route-inventory

**Files:**
- Create: `app/api/routes/leaderboard.py`
- Modify: `app/api/dependencies.py` (add `get_leaderboard_service`)
- Modify: `app/main.py` (import + `include_router`)
- Modify: `tests/unit/test_route_inventory.py` (`DOCUMENTED_SURFACE` additions)
- Test: `tests/unit/test_leaderboard_routes.py`

**Interfaces:**
- Consumes: `LeaderboardService`.
- Produces: `GET /api/v1/leaderboard`, `GET /api/v1/leaderboard/top/{count}`, `GET /api/v1/leaderboard/search/{discord_username}`, `GET /api/v1/leaderboard/stats` — all `dependencies=[Depends(require_service_token)]`.

- [ ] **Step 1: router** (mirror `app/api/routes/rankings.py`):

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from app.api.dependencies import get_leaderboard_service, require_service_token
from app.schemas.leaderboard import LeaderboardEntry, LeaderboardPage, LeaderboardStats
from app.services.leaderboard_service import LeaderboardService

router = APIRouter(prefix="/api/v1", tags=["leaderboard"])

_ServiceDep = Annotated[LeaderboardService, Depends(get_leaderboard_service)]


@router.get("/leaderboard", response_model=LeaderboardPage, dependencies=[Depends(require_service_token)])
async def get_leaderboard(
    svc: _ServiceDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
) -> LeaderboardPage:
    result = await svc.leaderboard(page, per_page)
    if page > result.total_pages:
        raise HTTPException(status_code=404, detail=f"Page {page} not found. Total pages: {result.total_pages}")
    return result


@router.get("/leaderboard/top/{count}", response_model=list[LeaderboardEntry], dependencies=[Depends(require_service_token)])
async def get_top_players(svc: _ServiceDep, count: int = Path(..., ge=1, le=100)) -> list[LeaderboardEntry]:
    return await svc.top(count)


@router.get("/leaderboard/search/{discord_username}", response_model=LeaderboardEntry | None, dependencies=[Depends(require_service_token)])
async def find_user_in_leaderboard(svc: _ServiceDep, discord_username: str) -> LeaderboardEntry | None:
    return await svc.search(discord_username)


@router.get("/leaderboard/stats", response_model=LeaderboardStats, dependencies=[Depends(require_service_token)])
async def get_leaderboard_stats(svc: _ServiceDep) -> LeaderboardStats:
    return await svc.stats()
```

- [ ] **Step 2: `get_leaderboard_service` factory** in `app/api/dependencies.py` (mirror `get_ranking_service`): request-scoped, `LeaderboardService(session=session, repo=LeaderboardPlayerRepository(session))`.

- [ ] **Step 3: include in `app/main.py`** (import + `app.include_router(leaderboard.router)` next to the other routers).

- [ ] **Step 4: `DOCUMENTED_SURFACE`** — add four entries:
  `"/api/v1/leaderboard": {"get": (None, LeaderboardPage)}`, `"/api/v1/leaderboard/top/{count}": {"get": (None, list[LeaderboardEntry])}`, `"/api/v1/leaderboard/search/{discord_username}": {"get": (None, LeaderboardEntry)}`, `"/api/v1/leaderboard/stats": {"get": (None, LeaderboardStats)}` (+ the schema imports).

- [ ] **Step 5: route tests** — `tests/unit/test_leaderboard_routes.py` using `TestClient(create_app())` with an overridden service (fake), asserting 200 shapes, 404 on out-of-range page, and the 401 service-token gate in a production-settings path (mirror `tests/unit/test_health.py` / `tests/integration` auth patterns).

- [ ] **Step 6: run the full non-live suite + ruff** — `uv run pytest -m "not live" -q` and `uv run ruff check app tests scripts` (the route-inventory contract test must pass: no undocumented route, every route service-token gated).

- [ ] **Step 7: commit** — `feat(leaderboard): wire leaderboard routes and route-inventory`.

---

## Phase B — Registration + auth endpoints

### Task 5: registration (preview/submit)

**Files:** `app/schemas/registration.py`, `app/services/registration_service.py`, `app/api/routes/registration.py`, `app/api/dependencies.py` (factory), `app/main.py`, `tests/unit/test_route_inventory.py`, `tests/unit/test_registration_*.py`.

**Interfaces:** `POST /api/v1/register/preview`, `POST /api/v1/register/submit`, `GET /api/v1/register/preview/{puuid}`, `POST /api/v1/register` — service-token gated. `registration_service` calls `HenrikClient.get_player_mmr`/`get_last_competitive_match`, maps to `PlayerPreview`, and `submit` upserts via `LeaderboardPlayerRepository.upsert`. Errors: 409 `DISCORD_ALREADY_REGISTERED` / `PUUID_ALREADY_REGISTERED`, 404 `PLAYER_NOT_FOUND` (no competitive data), upstream Henrik errors mapped to `AppError` (e.g. `HENRIK_UNAVAILABLE` 503, `HENRIK_RATE_LIMITED` 429) rather than blank/500 (mirrors the latest `valorantsl-new` preview error handling).

- [ ] Steps: schemas → service (Henrik fetch + mapping + upsert) → router → factory/main → route-inventory → tests → run → commit `feat(registration): add registration endpoints`.

### Task 6: Discord OAuth auth endpoints

**Files:** `app/schemas/auth.py`, `app/services/auth_service.py`, `app/api/routes/auth.py`, `app/api/dependencies.py` (factory), `app/config.py` (`discord_client_id`, `discord_client_secret`, `discord_redirect_uri`), `app/main.py`, `tests/unit/test_route_inventory.py`, `tests/unit/test_auth_*.py`.

**Interfaces:** `GET /api/v1/auth/discord/login`, `GET /api/v1/auth/discord/callback`, `POST /api/v1/auth/check-discord`, `POST /api/v1/auth/check-puuid`, `GET /api/v1/auth/login`, `GET /api/v1/auth/check-discord/{discord_id}`, `GET /api/v1/auth/check-puuid/{puuid}` — service-token gated. Discord OAuth via `fastapi-discord` (add to `pyproject.toml` deps) or a minimal httpx OAuth exchange; in-memory code dedupe (single-instance, as today).

- [ ] Steps: config → schemas → service → router → factory/main → route-inventory → tests → run → commit `feat(auth): add discord oauth auth endpoints`.

---

## Phase C — Background workers

### Task 7: updater — `workers/updater.py`

Port `valorantsl-new/updater/updater.py` + `riot_api.py` (active Postgres version): every 30 min, pull all PUUIDs, fetch MMR + last match via the shared `HenrikClient`, write `name/tag/rank_details/elo/currenttierpatched/peak_rank/seasonal_ranks/last_played_match/update_source` via `LeaderboardPlayerRepository.upsert`. Keep `Retry-After`/`max_retries`/`rate_limit_delay`, initial-full-pass-on-startup, and the Sunday rank-update pause window (`_in_rank_pause_window`). Entry points: `python -m workers.updater --once/--test/--info` (reuse the `valorantsl-new` CLI). Test: `tests/unit/test_updater.py` (fake client → assert upsert fields + retry/pause behavior).

### Task 8: name-audit — `workers/name_audit.py`

Port `valorantsl-new/updater/name_audit.py` (weekly Sunday 02:00 Asia/Colombo): verify each player's name/tag against Riot and correct drift. Test: `tests/unit/test_name_audit.py`.

### Task 9: discord-bot — `workers/discord_bot.py`

Port `valorantsl-new/discord-bot/` (two bots, 15-min loop, role/nickname sync + write-back). Test: `tests/unit/test_discord_bot.py`.

Commit each worker separately (`feat(workers): port updater`, `…: port name-audit`, `…: port discord bot`).

---

## Phase D — One-time migration script

### Task 10: `scripts/migrate_valorantsl_players.py`

Reads `valorantsl-new` Supabase `public.players` (DSN via env `VALORANTSL_SOURCE_DB_DSN`), normalizes (dedupe `discord_username` keeping newest; leave `rank_details` untouched), upserts into `valorant.leaderboard_players` on `puuid`. Dry-run by default, `--apply` to write. Test: `tests/unit/test_migrate_script.py` (fake source rows → assert dedupe + upsert). Commit `feat(scripts): add valorantsl players migration script`.

---

## Phase E — Quest proxy repoint

### Task 11: `QuestEsports` `valorant-leaderboard` client → `valorant-platform-backend`

**Files (QuestEsports):** `backend/src/modules/valorant-leaderboard/client.js`, `backend/src/config/env.js`, `backend/.env.example`, `backend/tests/valorant-leaderboard.client.test.js`.

Repoint the anonymous `valorantsl-new` client at `valorant-platform-backend`'s internal base URL and sign an HMAC service token with a **system actor** (`QUEST_LEADERBOARD_SYSTEM_ACTOR` config). The upstream payload is already snake_case and identical in shape, so `service.js`/`controller.js`/the page are unchanged. Keep the 60s cache + graceful-unavailable behavior. Steps: add config → swap `client.js` to HMAC (reuse `modules/valorant/valorant.auth.js`'s `buildServiceAuthHeaders`, with `sub` = the system actor) → update env + tests → run `node --test tests/valorant-leaderboard.client.test.js` → commit `feat(valorant-leaderboard): repoint client to valorant-platform-backend`.

---

## Phase F — `valorantsl-new` thin BFF

### Task 12: convert `valorantsl-new` backend to a forwarding BFF

**Files (`valorantsl-new`):** backend routers (`auth.py`, `registration.py`, `leaderboard.py`) become forwarders that sign an HMAC service token (shared `QUEST_SERVICE_SHARED_SECRETS`) and call `valorant-platform-backend`; delete the DB/Henrik/geo logic and the updater/discord-bot (now in `valorant-platform-backend`). Its frontend is unchanged. Steps: add a service-token signer → convert each handler to forward → remove dead code → run `valorantsl-new` backend tests (or retire them) → commit `feat: convert backend to thin BFF`.

---

## Final verification & cutover (spec §12)

- [ ] Backend: `uv run pytest -m "not live" -q` + `uv run ruff check app tests scripts` green.
- [ ] Run the migration script (dry-run → `--apply`).
- [ ] Start the workers against `valorant.leaderboard_players`.
- [ ] Repoint Quest (Phase E) and verify the leaderboard page renders.
- [ ] Convert `valorantsl-new` to the BFF (Phase F) and verify registration/auth still work.
- [ ] Decommission the old `valorantsl-new` Supabase table.
