# VALORANT Platform Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `valorant-platform-backend` modular monolith in two independently gated phases. Phase 1 (Match Engine) resolves Riot IDs via HenrikDev, persists PUUID-keyed players, discovers overlapping matches between two players by exact `metadata.match_id`, imports canonical Henrik v4 match details into Supabase Postgres (raw JSONB retained, scores/winners derived from `teams[].rounds`/`teams[].won`), and exposes a durable Match Library API. Phase 2 (Competition Core) creates teams, composes BO1/BO3/BO5 series from imported matches with Red/Blue side mapping, separates calculated vs official winners, finalizes series exactly once inside an atomic locked transaction applying the preserved legacy ELO calculator, and exposes auditable rating history, rankings, and a deterministic rebuild.

**Architecture:** Modular monolith, single deployable FastAPI service. One-way dependency direction `api/routes -> services -> domain (pure) + db/repositories`; `services -> integrations/henrik + legacy/elo_calculator`; `domain` and `db` depend on nothing. Only `integrations/henrik/client.py` speaks HTTP to `https://api.henrikdev.xyz`; only `db/repositories` touch SQLAlchemy. Repo root is the backend root (greenfield — only `.git` exists; no `backend/` nesting). Supabase Postgres is canonical via a direct async SQLAlchemy connection with plain SQL migrations under `supabase/migrations/` (no Alembic, no PostgREST for multi-statement writes). Raw Henrik v4 payloads retained as `jsonb`; the dedicated match-detail endpoint is the only canonical import path; match-list data is discovery-only. No generic provider abstraction — a single concrete `HenrikClient`. Legacy `elo_calculator.py` from the sibling `valorant-lk-elo` repo is copied verbatim and characterized before any refactor.

**Tech Stack:** Python 3.11+; FastAPI; Pydantic v2 (`extra="ignore"`, strict types); SQLAlchemy 2.x async + asyncpg; PostgreSQL (Supabase) as the only database (integration/concurrency tests run on real PostgreSQL, never SQLite); `httpx.AsyncClient` for Henrik; `pytest` + `pytest-asyncio`; `ruff`; stdlib `logging` with a JSON formatter for structured logs; `uv` for dependency/env management.

**Spec:** `docs/superpowers/specs/2026-08-13-valorant-platform-backend-design.md`

## Global Constraints

1. **No frontend.** No Streamlit, no UI of any kind. This project has no UI.
2. **No Riot official API / RSO / OAuth**, and no provider abstraction whose only purpose is a hypothetical Riot migration. `HenrikClient` is concrete.
3. **No Revival static JSON integration.** The 13 static `revival-stats` JSON files are not canonical data and are never imported; no assumption that a Revival generator exists.
4. **Repo root is the backend root.** Target repo is greenfield (only `.git` exists). Files live at `valorant-platform-backend/app/...`, `tests/...`, `supabase/migrations/...` — no `backend/backend` nesting.
5. **Supabase SQL migrations are the sole migration system.** `supabase/migrations/NNNN_*.sql` applied in filename order by `scripts/apply_migrations.py`. **No Alembic.**
6. **Integration/concurrency tests use real PostgreSQL** via `TEST_DATABASE_URL` (asyncpg). SQLite is never used as a stand-in.
7. **PUUID is canonical player identity**; `name#tag` is mutable display identity, indexed but never unique. `player_aliases` is **deferred** (not created) unless a real name-resolution need appears.
8. **Henrik Match ID is canonical match identity**; `matches.henrik_match_id` unique; import idempotent and concurrency-safe.
9. **Dedicated match detail is the canonical import.** Match-list history is used for discovery only; no candidate payload is persisted as a canonical match.
10. **Scores and winners are derived, never caller-supplied.** `red_score`/`blue_score` derive from `teams[].rounds.won`; `winning_side` from `teams[].won` (tolerant `draw`/`unknown`). Callers never re-enter map scores; ELO is never caller-supplied.
11. **Policy locks (approved, must be encoded in tests):**
    - Official winner determines ELO winner and win/loss counters.
    - Imported score/margin remain the performance inputs even when the official winner differs.
    - `rating_events.calculation_details` records the override and the resolved rating policy (mode: `normal | forfeit_no_rating | forfeit_result_only | manual_override`).
    - Preserve legacy Python `round(..., 0)` persistence for `teams.current_elo`/event columns **plus** unrounded inputs in `calculation_details`.
    - Equal ratings retain the legacy `+5` upset bonus (branch `elo_diff < 100`).
    - Versioned `rating_runs` preserve immutable audit events across rebuilds; events are never deleted or updated.
    - `series.played_at` is required for finalization and used for chronological rebuild ordering.
    - Refresh (`refresh=true`) is rejected for a match attached to a finalized series.
    - Incomplete match imports are rejected (`is_completed=false` → `MATCH_NOT_COMPLETED`).
    - Idempotent import returns `201` with `created=true`, or `200` with `created=false`.
    - No-overlap two-player search returns `200` with empty `candidates`.
    - Series statuses are limited to `draft` and `finalized` only (no persisted `ready`/`void`; readiness is the derived `preview.valid`; abandonment is `DELETE /api/v1/series/{series_id}` on drafts; corrections go through the rebuild path).
    - `ADMIN_API_KEY` is required (outside `local`/`test` env) for all mutations and for Henrik-consuming discovery (`POST /api/v1/players/resolve`, `POST /api/v1/match-search/two-player`, `POST /api/v1/matches/import`, all team/series mutations).
12. **Wave 0 contract gate must resolve the unresolved contract facts** (auth header form, first pagination offset, side literals, custom-mode literal, `is_completed`/`started_at` presence) and produce sanitized fixtures, `docs/henrik-contract.md`, and `docs/architecture-decisions.md`. Live tests are opt-in only; everything deterministic runs from fixtures.
13. **Deterministic behavior comes from fixtures; live calls are rate-limited and opt-in.** Raw payloads are excluded from default read responses (opt-in flag only).
14. **Validation owner: orchestrator.** This plan's scope is one file only — no commits, no code changes outside this document.

---

## Table of contents

- [Execution order, waves, and gates](#execution-order-waves-and-gates)
- [Wave 0 — Skeleton & Henrik contract gate](#wave-0--skeleton--henrik-contract-gate)
  - [Task 1 — Initial scaffold](#task-1--initial-scaffold)
  - [Task 2 — Henrik contract gate (Wave 0)](#task-2--henrik-contract-gate-wave-0)
  - [Task 3 — CI, config, logging, health, admin dependency](#task-3--ci-config-logging-health-admin-dependency)
- [Phase 1 — Match Engine](#phase-1--match-engine)
  - [Task 4 — Migrations, SQLAlchemy models, session](#task-4--migrations-sqlalchemy-models-session)
  - [Task 5 — Henrik client, mapper, exceptions](#task-5--henrik-client-mapper-exceptions)
  - [Task 6 — Player resolve](#task-6--player-resolve)
  - [Task 7 — Two-player discovery with accumulated pagination](#task-7--two-player-discovery-with-accumulated-pagination)
  - [Task 8 — Canonical import](#task-8--canonical-import)
  - [Task 9 — Match Library APIs](#task-9--match-library-apis)
- [Phase 1 gate](#phase-1-gate)
- [Phase 2 — Competition Core](#phase-2--competition-core)
  - [Task 10 — Legacy ELO characterization and copy](#task-10--legacy-elo-characterization-and-copy)
  - [Task 11 — Teams](#task-11--teams)
  - [Task 12 — Series, games, side mapping, BO validation](#task-12--series-games-side-mapping-bo-validation)
  - [Task 13 — Preview](#task-13--preview)
  - [Task 14 — Official override and rating policy](#task-14--official-override-and-rating-policy)
  - [Task 15 — Atomic finalization](#task-15--atomic-finalization)
  - [Task 16 — Rankings, rating history, rebuild](#task-16--rankings-rating-history-rebuild)
  - [Task 17 — Docs, security, final validation](#task-17--docs-security-final-validation)
- [Phase 2 gate](#phase-2-gate)
- [Appendix A — SQL migration sequence](#appendix-a--sql-migration-sequence)
- [Appendix B — Error codes and status mapping](#appendix-b--error-codes-and-status-mapping)
- [Appendix C — Fixture inventory](#appendix-c--fixture-inventory)
- [Appendix D — Real-Postgres test setup and live opt-in](#appendix-d--real-postgres-test-setup-and-live-opt-in)
- [Appendix E — Acceptance criteria mapping](#appendix-e--acceptance-criteria-mapping)
- [Appendix F — Explicit non-goals](#appendix-f--explicit-non-goals)

---

## Execution order, waves, and gates

```text
Wave 0  Task 1 (scaffold) -> Task 2 (Henrik contract gate) -> Task 3 (CI/config/logging/health/admin)
          |
Phase 1  Task 4 (migrations/models/session) -> Task 5 (Henrik client/mapper/errors)
            -> Task 6 (player resolve) -> Task 7 (discovery) -> Task 8 (canonical import)
            -> Task 9 (Match Library APIs)
            |
            v
        *** PHASE 1 GATE ***
          |
Phase 2  Task 10 (legacy ELO characterization) -> Task 11 (teams) -> Task 12 (series/games/sides/BO)
            -> Task 13 (preview) -> Task 14 (official override/policy) -> Task 15 (atomic finalization)
            -> Task 16 (rankings/history/rebuild) -> Task 17 (docs/security/final validation)
            |
            v
        *** PHASE 2 GATE ***
```

Gate definitions are in ["Phase 1 gate"](#phase-1-gate) and ["Phase 2 gate"](#phase-2-gate). Each gate is an explicit acceptance checkpoint owned by the orchestrator.

**Standard commands (used throughout):**

```text
uv sync                                  # install deps from pyproject.toml
uv run pytest -m "not live" -q           # default suite (unit + integration, no live)
uv run pytest tests/unit -q              # unit tests only
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test \
  uv run pytest -m "not live" tests/integration -q      # integration on real Postgres
HENRIK_API_KEY=... RUN_LIVE_HENRIK=1 \
  uv run pytest -m live tests/integration/live -q       # LIVE opt-in only
uv run python -m scripts.apply_migrations  # apply supabase/migrations/*.sql to DATABASE_URL
uv run ruff check app tests scripts
```

---

# Wave 0 — Skeleton & Henrik contract gate

## Task 1 — Initial scaffold

**Purpose:** Create the greenfield repo skeleton at the repo root: package layout, dependency manifest, minimal FastAPI app with config + logging + health, and test harness. No business logic yet.

**Files**
- Create: `pyproject.toml`, `.gitignore`, `.env.example`, `app/__init__.py`, `app/main.py`, `app/config.py`, `app/logging_setup.py`, `app/api/__init__.py`, `app/api/routes/__init__.py`, `app/api/routes/health.py`, `tests/__init__.py`, `tests/conftest.py`, `tests/unit/test_health.py`
- Modify: none

**Interfaces**

```python
# app/config.py
from decimal import Decimal
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_env: str = "development"                       # development | local | test | production
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform"
    henrik_api_key: str | None = None
    henrik_base_url: str = "https://api.henrikdev.xyz"
    henrik_auth_scheme: str = "bare"                   # bare | Bearer (pinned by Wave 0)
    henrik_timeout_seconds: float = 15.0
    henrik_max_retries: int = 2
    default_platform: str = "pc"
    default_affinity: str = "eu"
    default_initial_elo: Decimal = Decimal("1000")
    admin_api_key: str | None = None
    log_level: str = "INFO"
    match_search_max_page_size: int = 50
    match_search_max_pages: int = 5
    raw_payload_in_responses: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

def get_settings() -> Settings: ...                     # module-level cached instance
```

```python
# app/logging_setup.py
import logging

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str: ...   # single-line JSON: ts, level, logger, msg, extra fields (redacts keys in REDACT_KEYS)

def setup_logging(level: str = "INFO") -> None: ...
# REDACT_KEYS = {"api_key", "authorization", "henrik_api_key", "password"}
```

```python
# app/api/routes/health.py
from fastapi import APIRouter

router = APIRouter(tags=["health"])

@router.get("/api/v1/health")
async def health() -> dict:
    return {"status": "ok", "app": "valorant-platform-backend", "env": get_settings().app_env}
```

```python
# app/main.py
from fastapi import FastAPI

def create_app() -> FastAPI:
    setup_logging(get_settings().log_level)
    app = FastAPI(title="VALORANT Platform Backend", version="0.1.0")
    app.include_router(health.router)
    return app

app = create_app()
```

```toml
# pyproject.toml (excerpt — exact versions resolved at execution time)
[project]
name = "valorant-platform-backend"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.29",
    "httpx>=0.27",
    "python-dotenv>=1.0",
]
[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.23", "pytest-cov>=5", "ruff>=0.4"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = ["live: opt-in tests that hit the live Henrik API"]

[tool.ruff]
line-length = 110
target-version = "py311"
```

```bash
# .env.example
APP_ENV=development
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform
HENRIK_API_KEY=
HENRIK_BASE_URL=https://api.henrikdev.xyz
HENRIK_AUTH_SCHEME=bare
HENRIK_TIMEOUT_SECONDS=15
HENRIK_MAX_RETRIES=2
DEFAULT_PLATFORM=pc
DEFAULT_AFFINITY=eu
DEFAULT_INITIAL_ELO=1000
ADMIN_API_KEY=
LOG_LEVEL=INFO
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test
```

**Steps (TDD)**

- [x] 1. Confirm repo state: only `.git` and `docs/` exist; `git status` clean. Create `.gitignore` covering `.venv/`, `.env`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `.coverage`, `htmlcov/`.
- [x] 2. Write the failing unit test `tests/unit/test_health.py`:

```python
from fastapi.testclient import TestClient
from app.main import create_app

def test_health() -> None:
    client = TestClient(create_app())
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
```

- [x] 3. Command: `uv run pytest -m "not live" tests/unit/test_health.py -q`. Expected: 1 failed (route missing / import error).
- [x] 4. Implement `config.py`, `logging_setup.py`, `health.py`, `main.py` per the interfaces above.
- [x] 5. Re-run step 3. Expected: 1 passed.
- [x] 6. Sanity check app boots: `uv run uvicorn app.main:app --port 8000` then `curl -s localhost:8000/api/v1/health` returns `{"status":"ok",...}`. Add `tests/unit/test_logging_format.py` asserting `JsonFormatter` output is parseable JSON and never contains a value from a key in `REDACT_KEYS`.

**Commit checkpoint:** commit `scaffold: FastAPI app, config, logging, health, test harness`.

---

## Task 2 — Henrik contract gate (Wave 0)

**Purpose:** Resolve the unresolved contract facts U1–U7 from design §19.3 by probing the live API (opt-in) and capturing sanitized real payloads as fixtures. Produce `docs/henrik-contract.md` and `docs/architecture-decisions.md`. This gate determines: auth header form (bare `Authorization: <key>` vs `Bearer <key>`), the safe first pagination offset (`start=0` vs omission vs `start=1`), side literal values, the accepted custom-game `mode` literal, and presence/shape of `is_completed`/`started_at` in history objects. This task blocks mapper trust; deterministic mapper behavior comes from the fixtures captured here.

**Files**
- Create: `scripts/__init__.py`, `scripts/henrik_contract_probe.py`, `docs/henrik-contract.md`, `docs/architecture-decisions.md`, `tests/fixtures/henrik/README.md`, fixture JSON files per [Appendix C](#appendix-c--fixture-inventory), `tests/unit/test_contract_pins.py`
- Modify: none

**Interfaces**

```python
# scripts/henrik_contract_probe.py
from dataclasses import dataclass

@dataclass(frozen=True)
class ContractEvidence:
    auth_scheme: str                  # "bare" | "Bearer" | "unresolved"
    first_page_start: int             # 0 | 1 | -1 for "omission"
    side_literals: list[str]          # e.g. ["Red", "Blue"]
    custom_mode_literal: str | None   # e.g. "Custom" | None if rejected upstream
    history_has_completion: bool      # is_completed present in history objects
    history_has_started_at: bool
    detail_is_completed: bool | None
    rate_headers_seen: list[str]      # X-Request-ID, RateLimit-*, X-Cache-*
    raw_samples: dict[str, dict]      # minimal redacted samples per endpoint

async def run_probe(settings: Settings, api_key: str, live: bool) -> ContractEvidence: ...
```

- When run with `--live`, the probe performs, in order:
  1. **Auth scheme:** for scheme in (`bare`, `Bearer`): `GET /valorant/v2/account/{name}/{tag}` (a public known test account); record which yields 200 vs 401/403. Never log the key.
  2. **Pagination offset:** for start in (`0`, `1`, omission): `GET /valorant/v4/by-puuid/matches/{affinity}/pc/{puuid}?size=5&start=...`; record status and body error `code` for each. Live-verified 2026-08-13: `start=0` and `start=1` are both accepted (0 = newest, 1 = next) and omission is equivalent to `start=0`.
  3. **Side literals:** collect distinct `players[].team_id` and `teams[].team_id` from one history page and one detail response.
  4. **Custom mode:** `size=5&mode=Custom`; if 400/code 27, retry without `mode` and record the metadata `mode` literals actually returned.
  5. **Completion/time fields:** record presence of `metadata.is_completed` and `metadata.started_at` in history objects and in the detail payload.
  6. **Rate headers:** record `X-Request-ID`, `RateLimit-*`, `X-RateLimit-*`, `X-Cache-*` presence on a 200 response.
- Without `--live`, the probe reads the checked-in fixtures and reports pinned values, skipping live-only facts.
- `docs/henrik-contract.md` — pinned contract table per endpoint (URL, method, auth form, params incl. `force` on account and `mode/map/size/start` on history and **no** `queue`; verified field paths; side-literal table; custom-mode literal; error envelope format `{status, errors:[{code, message}]}`; rate-limit headers; U1–U7 status resolved/unresolved).
- `docs/architecture-decisions.md` — ADRs ADR-001… covering Global Constraints policy locks (item 11) plus: direct Postgres not PostgREST; raw JSONB retention; two-player discovery retained; match-list discovery-only / detail canonical; Wave 0 contract pins; statuses limited to draft/finalized; versioned `rating_runs`; no provider abstraction; `player_aliases` deferred; admin token.

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_contract_pins.py` asserting every pin in `app/integrations/henrik/contract.py` is non-empty for fields Wave 0 resolved; run it against the contract-pin module and keep unresolved live facts represented explicitly by the documented fallback values.
- [x] 2. Implement `scripts/henrik_contract_probe.py` with a fixture-only mode.
- [x] 3. If a `HENRIK_API_KEY` is available, run the live probe opt-in:

```bash
HENRIK_API_KEY=... uv run python -m scripts.henrik_contract_probe --live
```

   Expected outcome: evidence written to `docs/henrik-contract-evidence.json`; every U-item marked resolved or explicitly "unresolved — fallback is X". If no key, mark U-items unresolved and use the fallbacks listed in the contract doc.
- [x] 4. Sanitize captured payloads (replace real PUUIDs/names/tags with deterministic fakes: `puuid_p_a`, `PlayerA`, `A`; scrub anything non-public) and write them under `tests/fixtures/henrik/` per [Appendix C](#appendix-c--fixture-inventory). Record sanitization rules in `tests/fixtures/henrik/README.md`.
- [x] 5. Set pinned values in `app/integrations/henrik/contract.py`:

```python
# app/integrations/henrik/contract.py (created here, owned by Task 5)
AUTH_SCHEME_PINNED: str = "..."                 # "bare" | "Bearer" — from Wave 0 evidence
FIRST_PAGE_START: int = 0                       # verified safe first offset (design D12 default: 0; live-verified 2026-08-13)
SIDE_LITERAL_MAP: dict[str, str] = {...}        # e.g. {"Red": "red", "Blue": "blue"}
CUSTOM_MODE_LITERAL: str | None = ...           # verified literal or None (local filter fallback)
HENRIK_QUEUE_PARAM: None = None                 # never send `queue`
```

- [x] 6. Re-run `uv run pytest -m "not live" tests/unit/test_contract_pins.py -q`. Expected: passed once pins are set.
- [x] 7. Finalize `docs/henrik-contract.md` and `docs/architecture-decisions.md`. Live-only facts are labeled "live-verified" vs "fixture-pinned".

**Commit checkpoint:** commit `wave0: Henrik contract gate — probe, sanitized fixtures, henrik-contract.md, architecture-decisions.md`.

---

## Task 3 — CI, config, logging, health, admin dependency

**Purpose:** Harden the skeleton: GitHub Actions CI (lint + tests against a Postgres service), central admin dependency for mutations, error response model, and structured-request logging middleware. Completes the Wave 0 baseline required by the Phase 1 gate entry criteria.

**Files**
- Create: `.github/workflows/ci.yml`, `app/api/dependencies.py`, `app/api/errors.py`, `tests/unit/test_admin_dependency.py`, `tests/unit/test_errors.py`
- Modify: `app/main.py` (middleware + error handlers), `app/api/routes/health.py` (optional DB ping)

**Interfaces**

```python
# app/api/errors.py
from dataclasses import dataclass

@dataclass(frozen=True)
class AppError(Exception):
    code: str
    status: int
    message: str
    request_id: str | None = None
    detail: dict | None = None

# Canonical status classes (full table in Appendix B):
# 400 malformed/invalid | 404 missing | 409 conflict | 422 semantic | 429 upstream rate limit | 502/503 upstream

def register_error_handlers(app: FastAPI) -> None:
    # maps AppError -> {"error": {"code": ..., "message": ..., "request_id": ...}}
    ...
```

```python
# app/api/dependencies.py
from fastapi import Header, HTTPException

async def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    settings = get_settings()
    if settings.app_env in {"local", "test"}:
        return
    expected = settings.admin_api_key
    if not expected or x_admin_key != expected:
        raise HTTPException(status_code=401, detail={"error": {"code": "ADMIN_AUTH_REQUIRED", "message": "admin key required"}})
```

- All mutation routes and Henrik-consuming discovery routes declare `dependencies=[Depends(require_admin)]`.
- Error responses always carry the shape `{"error": {"code", "message", "request_id"?}}`; the internal request ID (uuid4 per request, set in middleware) is surfaced; no secret is ever echoed.
- `health.py` gains an optional DB check: `GET /api/v1/health` returns `{"status": "ok"|"degraded", "db": "up"|"down"|"unknown"}` via `SELECT 1` on the async engine (Task 4 provides the session; until then `db: "unknown"`).

```yaml
# .github/workflows/ci.yml (shape)
name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: valorant_platform_test }
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync --extra dev
      - run: uv run ruff check app tests scripts
      - run: TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" -q
```

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_errors.py` (AppError → JSON shape; unknown exception → 500 `{"error":{"code":"INTERNAL_ERROR",...}}`) and `tests/unit/test_admin_dependency.py` (with `app_env="production"` + key: `POST /api/v1/teams` without header → 401; with header → dependency runs and request proceeds; with `app_env="test"` → no header required).
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_errors.py tests/unit/test_admin_dependency.py -q`. Expected: fail first (handlers/dependency missing).
- [x] 3. Implement `errors.py`, `dependencies.py`; wire handlers, request-id middleware, and logging middleware in `app/main.py`.
- [x] 4. Re-run step 2 plus `tests/unit/test_logging_format.py` from Task 1. Expected: all pass.
- [x] 5. Commit `.github/workflows/ci.yml`; verify locally that `ruff check` passes and the workflow test command runs green on a local Postgres (see [Appendix D](#appendix-d--real-postgres-test-setup-and-live-opt-in)).

**Commit checkpoint:** commit `ci: GitHub Actions + admin dependency + error model + request logging`.
---

# Phase 1 — Match Engine

## Task 4 — Migrations, SQLAlchemy models, session

**Purpose:** Create the Phase 1 database schema via plain SQL migrations (`players`, `matches`, `match_players`), the SQLAlchemy 2.x async models, and the async session factory. This task also creates the migration runner used by every later migration task (Phase 2 tables are added in Tasks 11/12/15, DDL fully defined in [Appendix A](#appendix-a--sql-migration-sequence)).

**Files**
- Create: `scripts/apply_migrations.py`, `supabase/migrations/0001_players.sql`, `supabase/migrations/0002_matches.sql`, `supabase/migrations/0003_match_players.sql`, `app/db/__init__.py`, `app/db/session.py`, `app/db/models/__init__.py`, `app/db/models/player.py`, `app/db/models/match.py`, `app/db/models/match_player.py`, `tests/integration/conftest.py`, `tests/integration/test_migrations.py`
- Modify: none

**Interfaces**

```python
# app/db/session.py
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

engine: AsyncEngine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
SessionFactory: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        yield session
```

```python
# scripts/apply_migrations.py
async def apply_migrations(database_url: str, migrations_dir: Path = Path("supabase/migrations")) -> list[str]:
    """Executes each *.sql file in filename order, each inside its own transaction; returns applied filenames."""
```

- Usage: `uv run python -m scripts.apply_migrations` (reads `DATABASE_URL` from env; `--database-url` override for tests).
- SQLAlchemy 2.x models use `Mapped[...]`/`mapped_column`, `DeclarativeBase`, and `__table_args__` replicating the DDL constraints from [Appendix A](#appendix-a--sql-migration-sequence). Column types: `id: Mapped[uuid.UUID]` with server default `gen_random_uuid()`; `raw_payload: Mapped[dict]` → `JSONB`; timestamps `DateTime(timezone=True)` with `server_default=func.now()`.

```sql
-- supabase/migrations/0001_players.sql   (exact DDL in Appendix A — table players)
CREATE TABLE players ( ... );
CREATE UNIQUE INDEX players_puuid_key ON players (puuid);
CREATE INDEX players_lower_name_tag_idx ON players (lower(current_name), lower(current_tag));
CREATE INDEX players_affinity_idx ON players (affinity);
```

```sql
-- supabase/migrations/0002_matches.sql   (exact DDL in Appendix A — table matches)
CREATE TABLE matches ( ... CONSTRAINT matches_henrik_match_id_key UNIQUE (henrik_match_id), ... );
CREATE INDEX matches_started_at_idx ON matches (started_at);
CREATE INDEX matches_map_name_idx ON matches (map_name);
CREATE INDEX matches_mode_idx ON matches (mode);
```

```sql
-- supabase/migrations/0003_match_players.sql   (exact DDL in Appendix A — table match_players)
CREATE TABLE match_players ( ... CONSTRAINT match_players_match_player_key UNIQUE (match_id, player_id), ... );
CREATE INDEX match_players_puuid_snapshot_idx ON match_players (puuid_snapshot);
CREATE INDEX match_players_player_id_idx ON match_players (player_id);
```

**Steps (TDD)**

- [x] 1. Write `tests/integration/conftest.py` (real-Postgres session fixture — see [Appendix D](#appendix-d--real-postgres-test-setup-and-live-opt-in)): session-scoped fixture applies all migrations to `TEST_DATABASE_URL` in a fresh schema; function-scoped fixture truncates tables between tests.
- [x] 2. Write `tests/integration/test_migrations.py`: assert `players`, `matches`, `match_players` exist; duplicate `henrik_match_id` → `IntegrityError`; duplicate `(match_id, player_id)` → `IntegrityError`; `side='green'` rejected.
- [x] 3. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_migrations.py -q`. Expected: fail until migrations + models exist.
- [x] 4. Implement `0001`–`0003` SQL (exact DDL in Appendix A), `apply_migrations.py`, `session.py`, and the three model files.
- [x] 5. Re-run step 3. Expected: all pass (proves the real-Postgres harness; all later integration tests reuse it).
- [x] 6. Verify `uv run ruff check app scripts tests` passes.

**Commit checkpoint:** commit `db: players/matches/match_players migrations, async models, session, migration runner`.

---

## Task 5 — Henrik client, mapper, exceptions

**Purpose:** Implement the only module that knows Henrik's HTTP contract: exception hierarchy, Pydantic envelope models (tolerant, `extra="ignore"`), fixture-driven mapper with the Wave 0 side-literal table, and the `httpx.AsyncClient`-based client with centralized auth, timeouts, bounded retries, 429 handling, and structured logging. All deterministic behavior is proven against the Wave 0 fixtures.

**Files**
- Create: `app/integrations/__init__.py`, `app/integrations/henrik/__init__.py`, `app/integrations/henrik/contract.py` (pins from Task 2), `app/integrations/henrik/exceptions.py`, `app/integrations/henrik/models.py`, `app/integrations/henrik/mapper.py`, `app/integrations/henrik/client.py`, `app/domain/__init__.py`, `app/domain/matches/__init__.py`, `app/domain/matches/derivation.py`, `tests/unit/test_henrik_exceptions.py`, `tests/unit/test_henrik_mapper.py`, `tests/unit/test_henrik_client.py`
- Modify: none

**Interfaces**

```python
# app/integrations/henrik/exceptions.py
class HenrikError(Exception): ...
class HenrikAuthenticationError(HenrikError):
    def __init__(self, message: str, request_id: str | None = None) -> None: ...
class HenrikRateLimitError(HenrikError):
    def __init__(self, message: str, retry_after: float | None, rate_limit_reset: int | None,
                 request_id: str | None = None) -> None: ...
class HenrikNotFoundError(HenrikError):
    def __init__(self, message: str, sub_code: int | None, request_id: str | None = None) -> None: ...
class HenrikValidationError(HenrikError):
    def __init__(self, message: str, sub_code: int | None, request_id: str | None = None) -> None: ...
class HenrikUnavailableError(HenrikError): ...
class HenrikProtocolError(HenrikError): ...   # unexpected envelope/field/side literal
```

```python
# app/integrations/henrik/models.py  (Pydantic v2, extra="ignore")
from pydantic import BaseModel, ConfigDict

class HenrikRounds(BaseModel):
    model_config = ConfigDict(extra="ignore")
    won: int = 0
    lost: int = 0

class HenrikMap(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str | None = None
    name: str | None = None

class HenrikMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")
    match_id: str
    map: HenrikMap | None = None
    started_at: datetime | None = None
    is_completed: bool = False
    mode: str | None = None
    queue: str | None = None

class HenrikTeam(BaseModel):
    model_config = ConfigDict(extra="ignore")
    team_id: str
    rounds: HenrikRounds = HenrikRounds()
    won: bool | None = None

class HenrikStats(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kills: int | None = None
    deaths: int | None = None
    assists: int | None = None
    score: int | None = None
    damage_dealt: int | None = None
    damage_received: int | None = None
    headshots: int | None = None
    bodyshots: int | None = None
    legshots: int | None = None

class HenrikPlayer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    puuid: str
    name: str
    tag: str
    team_id: str | None = None
    character: str | None = None          # fixture-pinned agent name path (U6/U7)
    stats: HenrikStats | None = None
    raw: dict = Field(default_factory=dict, exclude=True)

class HenrikMatchListItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    metadata: HenrikMetadata
    players: list[HenrikPlayer] = []
    teams: list[HenrikTeam] = []

class HenrikMatchDetail(BaseModel):
    model_config = ConfigDict(extra="ignore")
    metadata: HenrikMetadata
    players: list[HenrikPlayer] = []
    teams: list[HenrikTeam] = []

class HenrikAccount(BaseModel):
    model_config = ConfigDict(extra="ignore")
    puuid: str
    region: str | None = None
    name: str
    tag: str
    platforms: list[str] = []
    updated_at: datetime | None = None
```

```python
# app/integrations/henrik/mapper.py
from app.integrations.henrik.contract import SIDE_LITERAL_MAP

class HenrikMapper:
    def parse_error_body(self, body: dict) -> tuple[int, str, list[dict]]:
        """Returns (status, message, errors[]) from the pinned error envelope; raises HenrikProtocolError if malformed."""
    def to_account(self, raw: dict) -> HenrikAccount: ...
    def to_match_list_item(self, raw: dict) -> HenrikMatchListItem: ...
    def to_match_detail(self, raw: dict) -> HenrikMatchDetail: ...
    def map_side(self, literal: str) -> str:
        """SIDE_LITERAL_MAP lookup; unknown literal -> HenrikProtocolError. Never guesses."""
```

```python
# app/domain/matches/derivation.py  (pure, no I/O)
def derive_scores(teams: list[HenrikTeam]) -> tuple[int | None, int | None]:
    """red_score/blue_score from teams[].rounds.won for sides mapped to red/blue; None when side absent."""
def derive_winning_side(teams: list[HenrikTeam]) -> str | None:
    """'red' | 'blue' | 'draw' | 'unknown' from teams[].won."""
```

- Required vs optional fields (from Wave 0 fixtures, U6/U7): required for import = match identity, map name, `started_at`, `is_completed`, and per player `puuid`/`name`/`tag`/`team_id`; everything under `players[].stats` and agent fields is optional and never fails import.

```python
# app/integrations/henrik/client.py
class HenrikClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self._http = http or httpx.AsyncClient(
            base_url=settings.henrik_base_url,
            timeout=settings.henrik_timeout_seconds,
            headers=self._build_auth_headers(settings),
        )

    async def get_account(self, name: str, tag: str, *, force: bool = False) -> HenrikAccount: ...
    async def get_matches_by_puuid(self, puuid: str, *, affinity: str, platform: str,
                                   mode: str | None = None, map_name: str | None = None,
                                   size: int = 10, start: int = 0) -> list[HenrikMatchListItem]:
        # NEVER sends `queue`; sends `mode` only when contract-pinned; raises per exceptions.py
    async def get_match_detail(self, match_id: str, *, affinity: str) -> HenrikMatchDetail: ...
    async def aclose(self) -> None: ...
```

- Behavior: one `httpx.AsyncClient`; auth header injected centrally (`bare` → `Authorization: <key>`, `Bearer` → `Authorization: Bearer <key>`, driven by `contract.AUTH_SCHEME_PINNED`); bounded exponential retry only for selected 5xx/network and 429-with-`Retry-After` (max `HENRIK_MAX_RETRIES=2`); never retry 400/401/403/404; on 429 raise `HenrikRateLimitError` carrying `Retry-After`/`X-RateLimit-Reset`; per-request structured log: endpoint category, status, duration, `X-Request-ID`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Cache-Status`, retry count — never the key. HTTP status mapping: 401/403 → `HenrikAuthenticationError`; 429 → `HenrikRateLimitError`; 404 → `HenrikNotFoundError(sub_code)`; 400 → `HenrikValidationError(sub_code)`; 500/501/network → `HenrikUnavailableError`.

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_henrik_exceptions.py`: each exception type's fields; `map_side("Green")` raises `HenrikProtocolError`.
- [x] 2. Write `tests/unit/test_henrik_mapper.py` driven by Wave 0 fixtures: valid account (force present/absent), history item field paths (`metadata.match_id/map.id/map.name/started_at/is_completed/mode`, `players[].puuid/name/tag/team_id/stats`, `teams[].team_id/rounds.won/rounds.lost/won`), detail normalization, missing optional stats tolerated, malformed required field → error, unknown side literal → `HenrikProtocolError`, every error-code fixture (401/403/429, 22/23/26, 27/28/42/43/45) maps to the right exception + sub_code. Assert the adapter never serializes a `queue` param (assert on query params of the fake transport).
- [x] 3. Command: `uv run pytest -m "not live" tests/unit/test_henrik_mapper.py tests/unit/test_henrik_exceptions.py -q`. Expected: fail first.
- [x] 4. Implement `contract.py` (pins from Task 2), `exceptions.py`, `models.py`, `mapper.py`, `derivation.py`.
- [x] 5. Re-run step 3. Expected: all pass.
- [x] 6. Write `tests/unit/test_henrik_client.py` using `httpx.MockTransport`: 200 detail → parsed `HenrikMatchDetail`; 429 with `Retry-After: 1` → `HenrikRateLimitError(retry_after=1.0)`; 404 code 26 → `HenrikNotFoundError(sub_code=26)`; 401 → `HenrikAuthenticationError`; verify `Authorization` header equals the key for `bare` and `Bearer <key>` for `Bearer`; verify retries occur only for transient statuses and `X-Request-ID` is logged.
- [x] 7. Command: `uv run pytest -m "not live" tests/unit/test_henrik_client.py -q`. Expected: all pass.

**Commit checkpoint:** commit `henrik: client, mapper, models, exceptions, fixture-driven contract tests`.

---

## Task 6 — Player resolve

**Purpose:** Implement player identity resolution and persistence: local cache check, Henrik v2 account lookup, PUUID-keyed upsert, display-identity update on re-resolve, and the resolve/get/by-puuid API routes.

**Files**
- Create: `app/db/repositories/__init__.py`, `app/db/repositories/player_repository.py`, `app/services/__init__.py`, `app/services/player_service.py`, `app/schemas/__init__.py`, `app/schemas/players.py`, `app/api/routes/players.py`, `tests/unit/test_player_service.py`, `tests/integration/test_player_resolve.py`
- Modify: `app/main.py` (include players router)

**Interfaces**

```python
# app/db/repositories/player_repository.py
class PlayerRepository:
    def __init__(self, session: AsyncSession) -> None: ...
    async def get_by_puuid(self, puuid: str) -> Player | None: ...
    async def get_by_id(self, player_id: uuid.UUID) -> Player | None: ...
    async def upsert_by_puuid(self, *, puuid: str, current_name: str, current_tag: str,
                              affinity: str | None, platforms: list[str],
                              henrik_updated_at: datetime | None) -> Player: ...
```

- `upsert_by_puuid` = insert on missing, or update current display identity/platforms/affinity/`updated_at`/`last_seen_at` when present; `first_seen_at` never changes; uniqueness guaranteed by `players_puuid_key`.

```python
# app/services/player_service.py
class PlayerService:
    def __init__(self, session: AsyncSession, henrik: HenrikClient,
                 repo: PlayerRepository) -> None: ...
    async def resolve(self, name: str, tag: str, *, force: bool = False) -> Player:
        """Normalize name/tag; look up local identity by (name,tag) index; if fresh and not force, return local;
        else Henrik get_account(name, tag, force=force); validate puuid; upsert; return."""
    async def get_by_id(self, player_id: uuid.UUID) -> Player: ...
    async def get_by_puuid(self, puuid: str) -> Player: ...
```

```python
# app/schemas/players.py
class PlayerResolveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9 _.-]+$")
    tag: str = Field(min_length=1, max_length=16, pattern=r"^[A-Za-z0-9#_-]+$")

class PlayerResponse(BaseModel):
    id: uuid.UUID
    puuid: str
    name: str
    tag: str
    affinity: str | None = None
    platforms: list[str] = []
```

```python
# app/api/routes/players.py
router = APIRouter(prefix="/api/v1/players", tags=["players"],
                   dependencies=[Depends(require_admin)])

@router.post("/resolve", response_model=PlayerResponse, status_code=200)
async def resolve_player(req: PlayerResolveRequest,
                         svc: PlayerService = Depends(get_player_service)) -> PlayerResponse: ...

@router.get("/{player_id}", response_model=PlayerResponse)
async def get_player(player_id: uuid.UUID,
                     svc: PlayerService = Depends(get_player_service)) -> PlayerResponse: ...

@router.get("/by-puuid/{puuid}", response_model=PlayerResponse)
async def get_player_by_puuid(puuid: str,
                              svc: PlayerService = Depends(get_player_service)) -> PlayerResponse: ...
```

- Errors: `PLAYER_NOT_FOUND` (404, incl. Henrik code 22), `PLAYER_REGION_UNKNOWN` (404, code 23), `INVALID_RIOT_ID` (422, malformed name/tag/UUID), `HENRIK_AUTH_FAILED` (502), `HENRIK_RATE_LIMITED` (429), `HENRIK_UNAVAILABLE` (503). Re-resolve idempotency: same PUUID → updated display identity, no new row.

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_player_service.py` with a fake `HenrikClient` and in-memory repo: resolve-new (calls Henrik, upserts), resolve-cached (no Henrik call when fresh), resolve-force (always Henrik), re-resolve same PUUID new name/tag (updates display, `first_seen_at` unchanged).
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_player_service.py -q`. Expected: fail first.
- [x] 3. Implement `player_repository.py`, `player_service.py`.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_player_resolve.py` against real Postgres + fixture-driven fake Henrik transport: POST resolve persists a row; GET by id; GET by puuid; duplicate resolve returns same `id`; Henrik 404/22 → `PLAYER_NOT_FOUND` 404.
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_player_resolve.py -q`. Expected: all pass.
- [x] 7. Wire the `players` router into `app/main.py`; `uv run ruff check app tests scripts`.

**Commit checkpoint:** commit `players: resolve API, PUUID upsert, display-identity refresh`.

---

## Task 7 — Two-player discovery with accumulated pagination

**Purpose:** Implement `POST /api/v1/match-search/two-player`: resolve both players, reject incompatible affinities, fetch both histories page by page (accumulated pagination), intersect by exact `metadata.match_id`, apply optional map/date/mode filters, and return lightweight candidates. No canonical persistence; no detail calls during search.

**Files**
- Create: `app/schemas/match_search.py`, `app/services/match_discovery_service.py`, `app/db/repositories/match_repository.py` (read helpers used here and in Task 8), `app/api/routes/match_search.py`, `tests/unit/test_match_discovery.py`, `tests/integration/test_match_discovery.py`
- Modify: `app/main.py` (include router)

**Interfaces**

```python
# app/schemas/match_search.py
class PlayerRef(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    tag: str = Field(min_length=1, max_length=16)

class TwoPlayerSearchRequest(BaseModel):
    player_a: PlayerRef
    player_b: PlayerRef
    platform: str = Field(default="pc", pattern=r"^(pc|console)$")
    map: str | None = None
    mode: str | None = None
    from_: datetime | None = Field(default=None, alias="from")
    to: datetime | None = None
    page_size: int = Field(default=10, ge=1, le=50)
    max_pages: int = Field(default=1, ge=1, le=5)

    model_config = ConfigDict(populate_by_name=True)

class MatchCandidate(BaseModel):
    match_id: str
    map: str | None = None
    started_at: datetime | None = None
    mode: str | None = None
    queue: str | None = None
    is_completed: bool
    red_score: int | None = None
    blue_score: int | None = None
    already_imported: bool

class TwoPlayerSearchResult(BaseModel):
    players: dict[str, PlayerResponse]     # {"a": ..., "b": ...}
    candidates: list[MatchCandidate] = []
    search: SearchMeta                     # {"page_size": int, "pages_examined": int}
```

```python
# app/services/match_discovery_service.py
class MatchDiscoveryService:
    def __init__(self, session: AsyncSession, player_svc: PlayerService,
                 henrik: HenrikClient, match_repo: MatchRepository) -> None: ...

    async def search_two_player(self, req: TwoPlayerSearchRequest) -> TwoPlayerSearchResult:
        """Resolve A and B; reject affinity mismatch; accumulated pagination:
        for page in 0..max_pages-1:
            start = FIRST_PAGE_START + page * page_size
            a_page = henrik.get_matches_by_puuid(puuid_a, affinity, platform, mode?, map?, size, start)
            b_page = henrik.get_matches_by_puuid(puuid_b, affinity, platform, mode?, map?, size, start)
            accumulate both lists by metadata.match_id
            intersect accumulated match_ids; stop early once non-empty (or after max_pages)
        apply local map/date filters; flag already_imported from matches table;
        build candidate summaries with scores from teams[].rounds.won."""
```

- Candidate scores derive from `teams[].rounds.won` in the history objects; no detail calls during search.
- Affinity mismatch: both players resolve to different non-null affinities → `INVALID_RIOT_ID` (422, message "players resolve to different affinities"). If either affinity is null, fall back to request/`settings.default_affinity`.
- `mode` filter is passed upstream only when `contract.CUSTOM_MODE_LITERAL` is pinned and equals the requested literal; otherwise the requested mode is applied locally to returned metadata (see Wave 0 U5).
- Date filtering is applied locally (`metadata.started_at` within `[from, to]`).
- Bounds: `page_size` default 10, `max_pages` default 1; caps from `Settings.match_search_max_*`.

```python
# app/api/routes/match_search.py
router = APIRouter(prefix="/api/v1/match-search", tags=["match-search"],
                   dependencies=[Depends(require_admin)])

@router.post("/two-player", response_model=TwoPlayerSearchResult, status_code=200)
async def two_player_search(req: TwoPlayerSearchRequest,
                            svc: MatchDiscoveryService = Depends(get_discovery_service)) -> TwoPlayerSearchResult: ...
```

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_match_discovery.py` with a fake `PlayerService` and fixture-driven fake `HenrikClient` covering: same one match; multiple overlapping matches; **no overlap → 200 empty `candidates`**; map filter; date filter; different match-list ordering between the two players (intersection still exact by `match_id`); **accumulated pagination** (overlap found on page 2 with `max_pages=2`, `pages_examined=2`, page-1 lists disjoint); duplicate match IDs within a page (no duplicate candidates); one account missing (Henrik 404/22 → `PLAYER_NOT_FOUND`); affinity mismatch → 422; Henrik 429 → `HENRIK_RATE_LIMITED`; invalid `start` value (code 45) → `HENRIK_VALIDATION_ERROR`.
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_match_discovery.py -q`. Expected: fail first.
- [x] 3. Implement `match_repository.py` (list imported `henrik_match_id` set / `already_imported` lookup), `match_discovery_service.py`, `match_search.py` schemas.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_match_discovery.py` against real Postgres: candidates persisted from pre-imported matches are flagged `already_imported=true`; search itself writes no rows to `matches`.
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_match_discovery.py -q`. Expected: all pass.
- [x] 7. Wire the router into `app/main.py`; `uv run ruff check app tests scripts`.

**Commit checkpoint:** commit `discovery: two-player match search, accumulated pagination, exact match_id intersection`.
---

## Task 8 — Canonical import

**Purpose:** Implement `POST /api/v1/matches/import`: validate UUID-ish match ID, idempotency pre-check, fetch the dedicated v4 match detail (canonical), reject incomplete matches, persist the raw full envelope JSONB plus normalized rows transactionally, and resolve concurrent duplicate imports to one row.

**Files**
- Create: `app/schemas/matches.py`, `app/services/match_import_service.py`, `app/db/repositories/match_repository.py` (full write surface), `app/api/routes/matches.py`, `tests/unit/test_match_import.py`, `tests/integration/test_match_import.py`
- Modify: `app/main.py` (include router)

**Interfaces**

```python
# app/schemas/matches.py
class MatchImportRequest(BaseModel):
    match_id: str = Field(min_length=8, max_length=64, pattern=r"^[0-9a-fA-F-]+$")   # UUID-ish
    affinity: str = "eu"
    refresh: bool = False

class MatchImportResponse(BaseModel):
    match: MatchDetailResponse
    created: bool

class MatchDetailResponse(BaseModel):
    id: uuid.UUID
    henrik_match_id: str
    affinity: str
    platform: str
    map_id: str | None = None
    map_name: str
    mode: str | None = None
    queue: str | None = None
    started_at: datetime
    duration_ms: int | None = None
    is_completed: bool
    red_score: int | None = None
    blue_score: int | None = None
    winning_side: str | None = None
    game_version: str | None = None
    players: list[MatchPlayerResponse] = []
    raw_payload_available: bool
```

```python
# app/services/match_import_service.py
class MatchImportService:
    def __init__(self, session: AsyncSession, henrik: HenrikClient,
                 player_repo: PlayerRepository, match_repo: MatchRepository,
                 mapper: HenrikMapper) -> None: ...

    async def import_match(self, match_id: str, affinity: str, *, refresh: bool = False) -> MatchImportResponse:
        """1) Validate UUID-ish match_id (else INVALID_RIOT_ID 422).
        2) Pre-check matches.henrik_match_id; if present and not refresh -> return existing (created=false).
        3) If refresh: reject with MATCH_REFRESH_REJECTED (409) when the match is attached to a finalized series.
        4) GET /valorant/v4/match/{affinity}/{match_id} (canonical import call).
        5) Reject is_completed=false -> MATCH_NOT_COMPLETED (422); reject missing required fields (HenrikProtocolError).
        6) BEGIN TX: upsert all players by puuid; insert match row with raw full detail `data` envelope as raw_payload jsonb
           (verbatim, not normalized); derive red_score/blue_score from teams[].rounds.won and winning_side from teams[].won;
           insert match_players snapshots (required: puuid/name/tag/team_id; optional stats tolerated).
        7) On unique-violation of henrik_match_id -> savepoint rollback -> re-select and return the winning row (created=false).
        8) COMMIT -> return created=true with 201.
        """
```

- Concurrency: the unique `henrik_match_id` constraint is the real gate; on `IntegrityError` the transaction rolls back to a savepoint, re-selects, and returns the row that won the race.
- Raw retention: `matches.raw_payload` = the complete v4 match-detail `data` object verbatim; `match_players.raw_player_payload` = each participant's raw `players[]` object verbatim.
- Derivation: `red_score`/`blue_score` from `teams[].rounds.won` for the sides mapped to `red`/`blue`; `winning_side` from `teams[].won` with tolerant `draw`/`unknown`.

```python
# app/api/routes/matches.py
router = APIRouter(prefix="/api/v1/matches", tags=["matches"],
                   dependencies=[Depends(require_admin)])

@router.post("/import", response_model=MatchImportResponse, status_code=201)
async def import_match(req: MatchImportRequest,
                       svc: MatchImportService = Depends(get_import_service)) -> MatchImportResponse:
    """Returns 201 with created=true for new imports; 200 with created=false when the match already exists
    (idempotent). Response_model always MatchImportResponse; the route sets status_code conditionally:
    response created=true -> 201, created=false -> 200."""
```

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_match_import.py` with a fake `HenrikClient` returning fixture payloads and an in-memory repo: new match (created=true, raw payload verbatim, players + snapshots persisted); same match twice (second → created=false, no new rows); match contains known player (player upsert reuses row); player Riot ID changed in payload (snapshot preserves payload names, player row display identity updates); missing optional stats (import succeeds, null columns); missing required field (puuid) → import fails loudly; `is_completed=false` → `MATCH_NOT_COMPLETED`; invalid `match_id` → `INVALID_RIOT_ID`; `refresh=true` on a match attached to a finalized series → `MATCH_REFRESH_REJECTED`.
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_match_import.py -q`. Expected: fail first.
- [x] 3. Implement `match_repository.py` write surface, `match_import_service.py`, `matches.py` schemas.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_match_import.py` against real Postgres: **concurrent duplicate import** (two `asyncio.gather` imports of the same `henrik_match_id` → exactly one row, both calls return the same row, one `created=true` one `created=false`); rollback test (inject a repository failure after match insert → no child rows remain); raw_payload persisted byte-for-byte equal to the fixture `data` envelope; double import creates no duplicate `match_players`.
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_match_import.py -q`. Expected: all pass.
- [x] 7. Wire the router into `app/main.py`; `uv run ruff check app tests scripts`.

**Commit checkpoint:** commit `import: canonical match import, raw JSONB retention, idempotent + concurrency-safe`.

---

## Task 9 — Match Library APIs

**Purpose:** Expose the durable Match Library read surface entirely from Supabase: list with filters + cursor pagination, detail by internal UUID, and by canonical Henrik Match ID.

**Files**
- Create: `app/api/routes/matches.py` (extend with read routes), `tests/unit/test_match_library.py`, `tests/integration/test_match_library_api.py`
- Modify: `app/main.py` (already wired in Task 8)

**Interfaces**

```python
# app/api/routes/matches.py (additions)
@router.get("", response_model=MatchListResponse)
async def list_matches(
    map: str | None = None,
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None, alias="to"),
    player_puuid: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: uuid.UUID | None = None,
    svc: MatchLibraryService = Depends(get_library_service),
) -> MatchListResponse: ...

@router.get("/{match_id}", response_model=MatchDetailResponse)
async def get_match(match_id: uuid.UUID, svc: MatchLibraryService = Depends(get_library_service)) -> MatchDetailResponse: ...

@router.get("/by-henrik-id/{henrik_match_id}", response_model=MatchDetailResponse)
async def get_match_by_henrik_id(henrik_match_id: str,
                                 svc: MatchLibraryService = Depends(get_library_service)) -> MatchDetailResponse: ...

class MatchListResponse(BaseModel):
    items: list[MatchSummaryResponse]
    next_cursor: uuid.UUID | None = None
    total: int | None = None
```

- Filters: `map` (map_name equality), `from`/`to` (`started_at` range), `player_puuid` (exists in `match_players.puuid_snapshot`), `limit`, `cursor` (keyset by `(started_at, id)`). Detail responses include metadata, derived scores/winner, participant snapshots, and `raw_payload_available: bool`; raw payload content is included only when `Settings.raw_payload_in_responses` is true (opt-in).
- New service `app/services/match_library_service.py` with `class MatchLibraryService: list_matches(...)`, `get_by_id(...)`, `get_by_henrik_id(...)`.
- Errors: `MATCH_NOT_FOUND` (404) for both detail lookups; `INVALID_RIOT_ID`-family 422 for malformed UUID (FastAPI validation).

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_match_library.py` with an in-memory repo: filter by map; filter by from/to; filter by player_puuid; cursor pagination returns `next_cursor` and no overlap; detail by id; detail by henrik-id; missing → `MATCH_NOT_FOUND`.
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_match_library.py -q`. Expected: fail first.
- [x] 3. Implement `match_library_service.py` and read routes.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_match_library_api.py` against real Postgres: import 3 fixture matches via the service, then exercise every read route end-to-end through the FastAPI test client; assert detail is served entirely from Supabase (no Henrik client invocation — inject a fake that raises if called).
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_match_library_api.py -q`. Expected: all pass.

**Commit checkpoint:** commit `library: Match Library list/detail APIs, filter + cursor pagination`. Then **declare Phase 1 feature-complete**.

---

# Phase 1 gate

**Entry criteria (must hold):** Tasks 1–9 complete; `uv run pytest -m "not live" -q` green on real Postgres; Henrik key available in environment.

**Operational capabilities at exit (design §2.1):**
1. Resolve two Riot IDs (`name#tag`) → overlapping recent match IDs with useful metadata.
2. Select a candidate and import that match.
3. Directly import a known Match ID + affinity without two-player search.
4. Retrieve any imported match later entirely from Supabase.
5. Re-import of the same Match ID is idempotent (no duplicate rows).

**Gate checklist (owned by orchestrator; every box maps to a passing test):**

- [x] `uv run pytest -m "not live" -q` passes (unit + integration, real Postgres).
- [x] `uv run ruff check app tests scripts` passes.
- [x] Wave 0 artifacts exist: `docs/henrik-contract.md`, `docs/architecture-decisions.md`, sanitized fixtures.
- [x] Functional criteria (design §16.1 / impl spec §19): valid `name#tag` resolves and persists; re-resolve idempotent; two-player search uses exact `metadata.match_id`; optional map/date filtering works; candidate import and direct import both work; re-import does not duplicate; detail served from Supabase; raw v4 JSON persisted; participant PUUIDs + side assignments normalized.
- [x] Reliability criteria (design §16.2 / impl spec §19): 429 handled via `Retry-After`/`X-RateLimit-Reset`; 400/404 not blindly retried; retries bounded/exponential for transient only; `X-Request-ID` logged; API key never returned/logged; DB writes transactional; concurrent duplicate import converges to one row.
- [x] Test evidence (design §15.1–15.3): adapter, discovery (incl. no-overlap 200 empty, accumulated pagination), import (incl. concurrency + rollback), upstream error mapping.

---

# Phase 2 — Competition Core

## Task 10 — Legacy ELO characterization and copy

**Purpose:** Copy the legacy `EloCalculator` from the sibling repo **verbatim** into `app/legacy/elo_calculator.py`, then build characterization tests that pin exact numerical parity **before any refactor**. This is the documented crown jewel; the README is known to disagree with code, so the code is the source of truth.

**Source file (must inspect, not the README):** `../valorant-lk-elo/elo_calculator.py` (255 lines, verified during planning).

**Files**
- Create: `app/legacy/__init__.py`, `app/legacy/elo_calculator.py` (verbatim copy), `tests/characterization/test_elo_calculator_parity.py`
- Modify: none

**Interfaces (verbatim, as copied)**

```python
# app/legacy/elo_calculator.py  (verbatim copy of the sibling file; do NOT rename/refactor yet)
class EloCalculator:
    @staticmethod
    def get_k_factor(matches_played: int) -> int: ...           # <10 -> 40, <30 -> 30, else 20
    @staticmethod
    def expected_score(rating_a: float, rating_b: float) -> float:
        return 1 / (1 + math.pow(10, (rating_b - rating_a) / 400))
    @staticmethod
    def get_round_differential_multiplier(winner_rounds: int, loser_rounds: int) -> float: ...
    @staticmethod
    def get_series_multiplier(winner_maps: int, loser_maps: int, winner_total_rounds: int,
                              loser_total_rounds: int, match_format: str) -> float: ...
    @staticmethod
    def get_upset_bonus(winner_elo: float, loser_elo: float) -> float: ...
    @staticmethod
    def calculate_new_elo(winner_elo, loser_elo, winner_matches, loser_matches,
                          winner_rounds=13, loser_rounds=0, match_importance="regular",
                          match_format="bo1", winner_maps=None, loser_maps=None) -> tuple[float, float]: ...
    @staticmethod
    def predict_match_outcome(team1_elo: float, team2_elo: float) -> dict: ...
    @staticmethod
    def estimate_elo_changes(...) -> dict: ...                  # DEAD CODE — remove only with proof of non-reference
```

**Behavioral pins (from actual code inspection, not README):**
- K: `matches < 10 → 40`, `matches < 30 → 30`, else `20` (boundaries at exactly 10 and 30).
- Expected score: `1 / (1 + 10^((B − A) / 400))`.
- BO1 round-diff multiplier (winner_rounds − loser_rounds): `<=2 → 1.0`, `<=4 → 1.1`, `<=6 → 1.25`, `<=8 → 1.4`, else `1.5`.
- Series multiplier (map diff + aggregate round bonus): BO3 `map_diff==2 → 1.4` else `1.1`; round bonus `<=5 → 0.0`, `<=10 → 0.05`, `<=15 → 0.1`, else `0.15`. BO5 `map_diff==3 → 1.6`, `==2 → 1.35`, else `1.1`; round bonus `<=8 → 0.0`, `<=15 → 0.05`, `<=25 → 0.1`, else `0.15`. BO1 `map_mult=1.0`, `round_bonus=0.0`.
- Importance multipliers applied to **K**: `regular 1.0`, `playoff 1.3`, `finals 1.5`.
- Upset bonus by `loser_elo − winner_elo`: `<0 → 0`, `<100 → 5`, `<200 → 10`, `<300 → 15`, else `20`. **Equal ratings → 0 is not `< 0`, so the winner gets +5 (lock: equal ratings retain legacy +5 upset).**
- Winner delta `K_w * (1 − E_w) * perf_mult + upset`; loser delta `K_l * (0 − E_l) * perf_mult` (K already multiplied by importance).
- Persistence semantics (from `services.py`, not the calculator): `competitive_elo`, `elo_before/after/change` persisted with Python `round(..., 0)`.

**Steps (TDD)**

- [x] 1. Copy `../valorant-lk-elo/elo_calculator.py` to `app/legacy/elo_calculator.py` byte-for-byte (verify `git diff --no-index` shows no changes).
- [x] 2. Generate golden values **by executing the copied legacy code** and write them into `tests/characterization/test_elo_calculator_parity.py` (each test recomputes via the module and asserts exact float equality within `pytest.approx(abs=1e-9)`, plus one `assert_almost_equal` at full precision). Cases: K boundaries at 9/10/29/30 matches; equal ratings (assert `get_upset_bonus(1000, 1000) == 5` and the +5 appears in `calculate_new_elo`); large disparity; upset; BO1 margin threshold boundaries (round diff 2/4/6/8); BO3 2-0 and 2-1; BO5 3-0/3-1/3-2; regular/playoff/finals; winner/loser expected scores; upset threshold boundaries (diff −1/0/99/100/199/200/299/300).
- [x] 3. Command: `uv run pytest -m "not live" tests/characterization -q`. Expected: all pass (proves verbatim copy).
- [x] 4. Prove `estimate_elo_changes` unreferenced: `rg -n "estimate_elo_changes" ../valorant-lk-elo app tests` → only the definition site. Record this evidence in `docs/architecture-decisions.md`; then (and only then) may it be removed — a later naming-normalization pass is allowed only after parity is proven.
- [x] 5. Commit the verbatim copy + characterization suite **before** any refactor.

**Commit checkpoint:** commit `elo: verbatim legacy EloCalculator copy + characterization parity tests`.

---

## Task 11 — Teams

**Purpose:** Phase 2 schema migration `0004_teams.sql` plus teams CRUD API and repository. Ratings start at 1000; referenced teams are never hard-deleted (`is_active=false`).

**Files**
- Create: `supabase/migrations/0004_teams.sql`, `app/db/models/team.py`, `app/db/repositories/team_repository.py`, `app/services/team_service.py`, `app/schemas/teams.py`, `app/api/routes/teams.py`, `tests/unit/test_team_service.py`, `tests/integration/test_teams_api.py`
- Modify: `app/main.py` (include router)

**Interfaces**

```python
# app/schemas/teams.py
class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    short_name: str | None = Field(default=None, max_length=16)
    slug: str | None = Field(default=None, max_length=64)
    logo_url: str | None = None
    seeding_elo: Decimal | None = None          # legacy compatibility; never a rating input

class TeamUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    slug: str | None = None
    logo_url: str | None = None
    is_active: bool | None = None

class TeamResponse(BaseModel):
    id: uuid.UUID
    name: str
    short_name: str | None = None
    slug: str | None = None
    logo_url: str | None = None
    current_elo: Decimal
    peak_elo: Decimal
    seeding_elo: Decimal | None = None
    matches_played: int
    series_wins: int
    series_losses: int
    is_active: bool
```

```python
# app/services/team_service.py
class TeamService:
    def __init__(self, session: AsyncSession, repo: TeamRepository) -> None: ...
    async def create(self, req: TeamCreate) -> Team: ...       # current_elo = DEFAULT_INITIAL_ELO, peak_elo = same
    async def list(self, *, active_only: bool = True) -> list[Team]: ...
    async def get(self, team_id: uuid.UUID) -> Team: ...       # 404 TEAM_NOT_FOUND
    async def update(self, team_id: uuid.UUID, req: TeamUpdate) -> Team: ...  # deactivation via is_active=false
```

```python
# app/api/routes/teams.py
router = APIRouter(prefix="/api/v1/teams", tags=["teams"], dependencies=[Depends(require_admin)])

@router.post("", response_model=TeamResponse, status_code=201)
async def create_team(req: TeamCreate, svc: TeamService = Depends(get_team_service)) -> TeamResponse: ...
@router.get("", response_model=list[TeamResponse])
async def list_teams(active_only: bool = True, svc: TeamService = Depends(get_team_service)) -> list[TeamResponse]: ...
@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(team_id: uuid.UUID, svc: TeamService = Depends(get_team_service)) -> TeamResponse: ...
@router.patch("/{team_id}", response_model=TeamResponse)
async def update_team(team_id: uuid.UUID, req: TeamUpdate, svc: TeamService = Depends(get_team_service)) -> TeamResponse: ...
```

- `slug` unique; duplicate slug → 409 `TEAM_SLUG_TAKEN` (explicit extension of the stable set; or map to 422). No DELETE route — retirement is `PATCH is_active=false`.

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_team_service.py` (in-memory repo): create starts at 1000/1000; create with `seeding_elo` stores it without affecting `current_elo`; list filters inactive; update deactivates; get missing → `TEAM_NOT_FOUND`.
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_team_service.py -q`. Expected: fail first.
- [x] 3. Implement `0004_teams.sql` (exact DDL in Appendix A), `team.py` model, `team_repository.py`, `team_service.py`, schemas, routes.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_teams_api.py`: end-to-end CRUD via test client against real Postgres; assert DB CHECK constraints (e.g. `current_elo >= 0`) reject invalid rows.
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_teams_api.py -q`. Expected: all pass.
- [x] 7. Wire router into `app/main.py`; `uv run ruff check app tests scripts`.

**Commit checkpoint:** commit `teams: schema migration, CRUD API, is_active retirement`.

---
---

## Task 12 — Series, games, side mapping, BO validation

**Purpose:** Phase 2 schema migrations `0005_series.sql` and `0006_series_games.sql`, pure BO/side/result domain rules, and the series draft service: create series, attach imported matches with side mapping, remove/reorder games (draft only), and reject invalid shapes.

**Files**
- Create: `supabase/migrations/0005_series.sql`, `supabase/migrations/0006_series_games.sql`, `app/db/models/series.py`, `app/db/models/series_game.py`, `app/db/repositories/series_repository.py`, `app/domain/series/__init__.py`, `app/domain/series/bo.py`, `app/domain/series/sides.py`, `app/domain/series/results.py`, `app/services/series_service.py`, `app/schemas/series.py`, `app/api/routes/series.py`, `tests/unit/test_series_bo.py`, `tests/unit/test_series_service.py`, `tests/integration/test_series_api.py`
- Modify: `app/main.py` (include router)

**Interfaces**

```python
# app/domain/series/bo.py  (pure, no I/O)
FORMAT_REQUIRED_WINS: dict[str, int] = {"bo1": 1, "bo3": 2, "bo5": 3}
FORMAT_MAX_GAMES: dict[str, int] = {"bo1": 1, "bo3": 3, "bo5": 5}

def validate_series_games(games: list[GameSnapshot], format_: str) -> list[str]:
    """Rules (design §10.2, impl spec §25):
    1. game_numbers start at 1 and are contiguous.
    2. every attached game has a valid side mapping.
    3. every attached match is_completed=true.
    4. exactly one team reaches the required wins.
    5. no game exists after the series was already mathematically clinched
       (e.g. no game 4 in a 2-0 BO3).
    6. calculated winner is the team that reached required wins.
    Returns a list of human-readable errors (empty == valid)."""

def is_clinched(team_a_wins: int, team_b_wins: int, format_: str) -> bool: ...

@dataclass(frozen=True)
class GameSnapshot:
    game_number: int
    match_id: uuid.UUID
    team_a_side: str
    team_b_side: str
    team_a_rounds: int
    team_b_rounds: int
    winner_team_id: uuid.UUID | None
    is_completed: bool
```

```python
# app/domain/series/sides.py  (pure)
OPPOSITE_SIDE: dict[str, str] = {"red": "blue", "blue": "red"}

def validate_side_literal(side: str) -> str:
    """side in {'red','blue'} else INVALID_SIDE_MAPPING (422)."""
def resolve_sides(team_a_side: str) -> tuple[str, str]:
    """Returns (team_a_side, team_b_side) with team_b_side = opposite."""
```

```python
# app/domain/series/results.py  (pure)
@dataclass(frozen=True)
class SeriesResult:
    team_a_maps_won: int
    team_b_maps_won: int
    calculated_winner_id: uuid.UUID | None

def compute_series_result(games: list[GameSnapshot], team_a_id: uuid.UUID,
                          team_b_id: uuid.UUID) -> SeriesResult:
    """Per-game winners -> team_a_maps_won/team_b_maps_won -> calculated_winner_id (None when no reach)."""
```

```python
# app/schemas/series.py
class SeriesCreate(BaseModel):
    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    format: Literal["bo1", "bo3", "bo5"]
    importance: Literal["regular", "playoff", "finals"]
    played_at: datetime | None = None
    notes: str | None = None

class AttachGameRequest(BaseModel):
    match_id: uuid.UUID
    game_number: int = Field(ge=1)
    team_a_side: Literal["red", "blue"]

class UpdateGameRequest(BaseModel):
    game_number: int | None = Field(default=None, ge=1)
    team_a_side: Literal["red", "blue"] | None = None

class GameView(BaseModel):
    id: uuid.UUID
    game_number: int
    match_id: uuid.UUID
    map_name: str | None = None
    team_a_side: str
    team_b_side: str
    team_a_rounds: int
    team_b_rounds: int
    winner_team_id: uuid.UUID | None = None

class SeriesView(BaseModel):
    id: uuid.UUID
    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    format: str
    importance: str
    status: str                                   # draft | finalized
    calculated_winner_id: uuid.UUID | None = None
    official_winner_id: uuid.UUID | None = None
    winner_override_reason: str | None = None
    team_a_maps_won: int
    team_b_maps_won: int
    played_at: datetime | None = None
    finalized_at: datetime | None = None
    notes: str | None = None
    games: list[GameView] = []
```

```python
# app/services/series_service.py
class SeriesService:
    def __init__(self, session: AsyncSession, series_repo: SeriesRepository,
                 match_repo: MatchRepository) -> None: ...
    async def create(self, req: SeriesCreate) -> Series: ...        # team_a != team_b (409 SERIES_INVALID), draft status
    async def attach_game(self, series_id: uuid.UUID, req: AttachGameRequest) -> SeriesGame:
        """draft only (409 SERIES_ALREADY_FINALIZED); match must exist (404 MATCH_NOT_FOUND) and be completed
        (422 MATCH_NOT_COMPLETED); match not already attached to another series (409 MATCH_ALREADY_ASSIGNED_TO_SERIES);
        derives team_b_side, both round scores, and winner_team_id from the imported match (scores never re-entered)."""
    async def remove_game(self, series_id: uuid.UUID, game_id: uuid.UUID) -> None: ...    # draft only
    async def update_game(self, series_id: uuid.UUID, game_id: uuid.UUID, req: UpdateGameRequest) -> SeriesGame: ...  # draft only
    async def get(self, series_id: uuid.UUID) -> Series: ...        # 404 SERIES_NOT_FOUND
    async def list(self) -> list[Series]: ...
    async def delete(self, series_id: uuid.UUID) -> None:           # draft only; 409 SERIES_ALREADY_FINALIZED otherwise
```

```python
# app/api/routes/series.py
router = APIRouter(prefix="/api/v1/series", tags=["series"], dependencies=[Depends(require_admin)])

@router.post("", response_model=SeriesView, status_code=201)
async def create_series(req: SeriesCreate, svc: SeriesService = Depends(get_series_service)) -> SeriesView: ...
@router.post("/{series_id}/games", response_model=GameView, status_code=201)
async def attach_game(series_id: uuid.UUID, req: AttachGameRequest, svc: SeriesService = Depends(get_series_service)) -> GameView: ...
@router.delete("/{series_id}/games/{game_id}", status_code=204)
async def remove_game(series_id: uuid.UUID, game_id: uuid.UUID, svc: SeriesService = Depends(get_series_service)) -> None: ...
@router.patch("/{series_id}/games/{game_id}", response_model=GameView)
async def update_game(series_id: uuid.UUID, game_id: uuid.UUID, req: UpdateGameRequest,
                      svc: SeriesService = Depends(get_series_service)) -> GameView: ...
@router.get("", response_model=list[SeriesView])
async def list_series(svc: SeriesService = Depends(get_series_service)) -> list[SeriesView]: ...
@router.get("/{series_id}", response_model=SeriesView)
async def get_series(series_id: uuid.UUID, svc: SeriesService = Depends(get_series_service)) -> SeriesView: ...
@router.delete("/{series_id}", status_code=204)      # explicit addition under the draft/finalized status policy
async def delete_series(series_id: uuid.UUID, svc: SeriesService = Depends(get_series_service)) -> None: ...
```

- DB enforcement: `unique(series_id, game_number)`, `unique(match_id)`, `team_a_side != team_b_side`, `game_number > 0`, winner-in-owning-series trigger (Appendix A, `0006_series_games.sql`), `status IN ('draft','finalized')`, `team_a_id != team_b_id`.

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_series_bo.py` covering the full matrix: BO1 1-0 valid; BO3 2-0 valid; BO3 2-1 valid; BO3 1-1 invalid (no winner); BO3 fourth map after 2-0 invalid (clinched); BO5 3-0/3-1/3-2 valid; game 6 after 3-0 invalid; missing side mapping invalid; same side for both teams invalid; non-contiguous game numbers invalid.
- [x] 2. Write `tests/unit/test_series_service.py` (in-memory): create draft; attach derives sides/rounds/winner from the match; attach a match already in another series → `MATCH_ALREADY_ASSIGNED_TO_SERIES`; attach non-completed match → `MATCH_NOT_COMPLETED`; attach to finalized series → `SERIES_ALREADY_FINALIZED`; remove/reorder in draft; `team_a_id == team_b_id` → `SERIES_INVALID`.
- [x] 3. Command: `uv run pytest -m "not live" tests/unit/test_series_bo.py tests/unit/test_series_service.py -q`. Expected: fail first.
- [x] 4. Implement `bo.py`, `sides.py`, `results.py`, `0005`/`0006` SQL (exact DDL in Appendix A), models, `series_repository.py`, `series_service.py`, schemas, routes.
- [x] 5. Re-run step 3. Expected: all pass.
- [x] 6. Write `tests/integration/test_series_api.py` against real Postgres: import matches → create series → attach games end-to-end; assert DB constraints reject `same side`, duplicate `(series_id, game_number)`, and duplicate `match_id` across series.
- [x] 7. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_series_api.py -q`. Expected: all pass.
- [x] 8. Wire router into `app/main.py`; `uv run ruff check app tests scripts`.

**Commit checkpoint:** commit `series: series/games schema, side mapping, BO validation, draft CRUD`.

---

## Task 13 — Preview

**Purpose:** Implement `GET /api/v1/series/{series_id}/preview` — recompute BO validity, map counts, and calculated winner from attached games with no writes. Also implement `ready` derivation (`preview.valid == true`).

**Files**
- Create: `tests/unit/test_preview.py`, `tests/integration/test_preview_api.py`
- Modify: `app/services/series_service.py` (add `preview`), `app/schemas/series.py` (add `SeriesPreview`)

**Interfaces**

```python
# app/schemas/series.py
class SeriesPreview(BaseModel):
    valid: bool
    team_a_maps_won: int
    team_b_maps_won: int
    calculated_winner_id: uuid.UUID | None = None
    games: list[GameView] = []
    errors: list[str] = []
```

```python
# app/services/series_service.py (addition)
    async def preview(self, series_id: uuid.UUID) -> SeriesPreview:
        """Load series + games + matches; run domain validate_series_games + compute_series_result;
        valid = no errors; NEVER writes. This is the derived 'ready' signal."""
```

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_preview.py`: valid BO3 2-1 → `valid=true`, correct maps + calculated winner; invalid 1-1 → `valid=false` with error message; games with missing side mapping → error; preview never mutates the series (assert no repo write called).
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_preview.py -q`. Expected: fail first.
- [x] 3. Implement `preview` in `series_service.py` + `SeriesPreview` schema.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_preview_api.py`: end-to-end preview route on a real Postgres-backed series; assert 200 and correct body for valid and invalid cases.
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_preview_api.py -q`. Expected: all pass.

**Commit checkpoint:** commit `series: preview endpoint, derived readiness, BO/result validation`.

---

## Task 14 — Official override and rating policy

**Purpose:** Implement the calculated-vs-official winner separation and the explicit rating policy resolution. Overrides require a reason; ambiguous forfeit/override cases refuse ELO finalization until a policy is explicitly selected.

**Files**
- Create: `app/domain/ratings/__init__.py`, `app/domain/ratings/policy.py`, `tests/unit/test_rating_policy.py`
- Modify: `app/services/series_service.py` or `app/services/rating_service.py` (finalize input handling), `app/schemas/series.py`

**Interfaces**

```python
# app/domain/ratings/policy.py  (pure, no I/O)
RATING_MODES = ("normal", "forfeit_no_rating", "forfeit_result_only", "manual_override")

@dataclass(frozen=True)
class RatingPolicyDecision:
    mode: str            # one of RATING_MODES
    rate_series: bool    # False for forfeit_no_rating
    official_winner_id: uuid.UUID | None
    override_reason: str | None
    # When mode is ambiguous and not explicitly selectable -> raise RATING_POLICY_REQUIRED

def resolve_rating_policy(*, official_winner_id: uuid.UUID | None,
                          calculated_winner_id: uuid.UUID | None,
                          override_reason: str | None,
                          explicit_mode: str | None = None) -> RatingPolicyDecision:
    """- official None -> official = calculated; mode=normal.
    - official == calculated -> mode=normal.
    - official != calculated: override_reason REQUIRED (else RATING_POLICY_REQUIRED).
      If the payload carries a mode (`normal | forfeit_no_rating | forfeit_result_only | manual_override`),
      honor it; if none is provided for an override, mode is ambiguous -> raise RATING_POLICY_REQUIRED (409)."""
```

- Locked policy (Global Constraints item 11): official winner determines ELO winner and win/loss counters; imported score/margin remain the performance inputs; `calculation_details` records the override and the resolved mode.
- The `FinalizeRequest` schema gains an optional `rating_mode: Literal[...] | None` field to make the policy explicit (see Task 15).

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_rating_policy.py`: no override → `normal`; official == calculated → `normal`; override without reason → `RATING_POLICY_REQUIRED`; override with reason and `manual_override` → decision `rate_series=true`; `forfeit_no_rating` → `rate_series=false` (no events, no counters, but finalizes with result recorded); `forfeit_result_only` → official winner + counters, no rating; official winner must be a team of the series (else `SERIES_INVALID`).
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_rating_policy.py -q`. Expected: fail first.
- [x] 3. Implement `domain/ratings/policy.py` and wire into the finalize input parsing (Task 15 consumes it).
- [x] 4. Re-run step 2. Expected: all pass.

**Commit checkpoint:** commit `ratings: official override + explicit rating policy resolution`.

---

## Task 15 — Atomic finalization

**Purpose:** Implement `POST /api/v1/series/{series_id}/finalize` as the single most correctness-critical operation: atomic transaction, deterministic sorted row locks, BO validation recheck, legacy ELO application with persisted `round(..., 0)` semantics plus unrounded details, versioned `rating_runs` event insertion, and idempotent double-finalize protection.

**Files**
- Create: `supabase/migrations/0007_rating_runs.sql`, `supabase/migrations/0008_rating_events.sql`, `app/db/models/rating_run.py`, `app/db/models/rating_event.py`, `app/db/repositories/rating_repository.py`, `app/services/rating_service.py`, `tests/unit/test_rating_service.py`, `tests/integration/test_finalization.py`
- Modify: `app/schemas/series.py` (add `FinalizeRequest`, `FinalizeResult`), `app/api/routes/series.py` (add finalize route), `app/main.py`

**Interfaces**

```python
# app/schemas/series.py (additions)
class FinalizeRequest(BaseModel):
    official_winner_id: uuid.UUID | None = None
    override_reason: str | None = None
    rating_mode: Literal["normal", "forfeit_no_rating", "forfeit_result_only", "manual_override"] | None = None

class FinalizeResult(BaseModel):
    series_id: uuid.UUID
    status: str                                    # "finalized"
    calculated_winner_id: uuid.UUID | None = None
    official_winner_id: uuid.UUID | None = None
    winner_override_reason: str | None = None
    rating_mode: str | None = None
    events: list[RatingEventResponse] = []
    team_a_current_elo: Decimal
    team_b_current_elo: Decimal
```

```python
# app/services/rating_service.py
class RatingService:
    def __init__(self, session: AsyncSession, series_repo: SeriesRepository,
                 rating_repo: RatingRepository) -> None: ...

    async def finalize(self, series_id: uuid.UUID, req: FinalizeRequest) -> FinalizeResult:
        """Single transaction:
        BEGIN
          SELECT series FOR UPDATE
          if series.status == 'finalized' -> rollback, 409 SERIES_ALREADY_FINALIZED
          SELECT team_a, team_b FOR UPDATE in deterministic sorted UUID order
          reload games + matches; re-run validate_series_games (any error -> 422 SERIES_INVALID)
          derive calculated_winner_id
          resolve official winner + rating policy (Task 14); RATING_POLICY_REQUIRED -> 409
          if policy.rate_series:
              read teams.current_elo (persisted integers) and matches_played
              input ratings = current_elo values (already rounded); if equal -> legacy +5 upset applies
              run legacy EloCalculator.calculate_new_elo(winner_elo, loser_elo, winner_matches, loser_matches,
                  winner_rounds, loser_rounds, importance, format, winner_maps, loser_maps)
              persisted_winner_elo = round(new_winner_elo, 0)   # Python round, legacy persistence semantics
              persisted_loser_elo  = round(new_loser_elo, 0)
              insert rating_event under current run for each team:
                elo_before = input rating, elo_after = persisted_..., elo_change = round(..., 0)
                result='win'|'loss', k_factor (post-importance), expected_score, performance_multiplier,
                importance_multiplier, upset_bonus, calculation_details jsonb = {
                    policy mode, override, raw unrounded new elos, base changes, inputs }
              update teams: current_elo = persisted, peak_elo = max(peak, persisted),
                matches_played += number of games, series_wins/series_losses += 1 (by official winner)
          else (forfeit_no_rating): record result only; no events; no ELO change
          update series: maps won, calculated/official winner, status='finalized', finalized_at=now()
        COMMIT
        Any error rolls back all changes.
        """
```

- Concurrency guarantees: row locks serialize concurrent finalization for the same team; `unique(run_id, series_id, team_id)` in `rating_events` is the DB-enforced double-rate guard; an already-finalized series returns `409 SERIES_ALREADY_FINALIZED` and never reapplies ELO.
- `matches_played` for K is the team's count read inside the transaction; each finalized series increments `matches_played` by the number of games (per design §12.3, pinned by characterization tests).
- `rating_runs`: `rating_repo.get_current_run()` returns the row with max `run_number`; finalize inserts events under it (initial run seeded by migration `0007`).
- Logging per finalization: series ID, team IDs, input ratings, output ratings, rating event IDs (design §14.4).

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_rating_service.py` with an in-memory repo: BO3 2-0 finalize → two events, both team updates, series finalized; simulated mid-transaction failure → nothing persisted; double finalize → `SERIES_ALREADY_FINALIZED` (no second events); equal ratings → winner event shows `upset_bonus=5` and legacy +5 in `elo_change`; `round(..., 0)` persistence (persisted `current_elo` is the rounded integer, unrounded values present in `calculation_details`); `forfeit_no_rating` → no events, no rating change; `RATING_POLICY_REQUIRED` when override without explicit mode; finalize rejects a series with `played_at IS NULL`.
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_rating_service.py -q`. Expected: fail first.
- [x] 3. Implement `0007`/`0008` SQL (exact DDL in Appendix A), models, `rating_repository.py`, `rating_service.py`, schemas, finalize route.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_finalization.py` against **real Postgres** (design §15.6): both events + both team updates commit together; simulated failure rolls everything back; double finalization does not reapply ELO; **concurrent finalization for the same team is serialized safely** (two `asyncio.gather` finalizes of series sharing a team → exactly one wins per series, no lost updates, events consistent); rebuild reproduces standings (exercised more in Task 16).
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_finalization.py -q`. Expected: all pass.
- [x] 7. Wire finalize route into `app/main.py`; `uv run ruff check app tests scripts`.

**Commit checkpoint:** commit `finalize: atomic locked finalization, rating_runs/events, legacy rounding, concurrency tests`.

---
---

## Task 16 — Rankings, rating history, rebuild

**Purpose:** Implement the rankings read API, per-team rating history (from the current run's immutable events), per-team series list, and the deterministic `rebuild_rankings()` that replays finalized series into a new `rating_runs` version while preserving every prior audit event.

**Files**
- Create: `app/schemas/rankings.py`, `app/services/ranking_rebuild_service.py`, `app/services/ranking_service.py` (read paths), `app/api/routes/rankings.py`, `tests/unit/test_ranking_rebuild.py`, `tests/integration/test_rankings_api.py`
- Modify: `app/main.py` (include rankings router + expose rebuild as an admin/internal command route), `app/api/routes/teams.py` (add `rating-history` and `series` reads)

**Interfaces**

```python
# app/schemas/rankings.py
class RankingEntry(BaseModel):
    rank: int
    team_id: uuid.UUID
    name: str
    short_name: str | None = None
    current_elo: Decimal
    peak_elo: Decimal
    series_wins: int
    series_losses: int
    matches_played: int

class RatingEventResponse(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    series_id: uuid.UUID
    elo_before: Decimal
    elo_after: Decimal
    elo_change: Decimal
    opponent_team_id: uuid.UUID
    result: Literal["win", "loss"]
    k_factor: Decimal | None = None
    expected_score: Decimal | None = None
    performance_multiplier: Decimal | None = None
    importance_multiplier: Decimal | None = None
    upset_bonus: Decimal | None = None
    created_at: datetime
```

```python
# app/services/ranking_rebuild_service.py
class RankingRebuildService:
    def __init__(self, session: AsyncSession, rating_repo: RatingRepository) -> None: ...

    async def rebuild(self, *, note: str | None = None) -> RebuildResult:
        """One transaction:
        1. create a new rating_runs row (run_number = max+1, note) — the new 'current' run.
        2. reset ALL teams: current_elo = peak_elo = DEFAULT_INITIAL_ELO; matches_played=0; series_wins=0; series_losses=0.
        3. select eligible finalized series ordered by (played_at, created_at, id) — deterministic, chronological.
        4. replay each through the same rating math as finalize (no status transitions, no re-validation writes):
           insert events under the NEW run; update team ratings + counters.
        5. COMMIT. Prior runs' events are never deleted or updated (immutable audit)."""
```

- The current run for reads and for normal finalization is always `max(run_number)`. Rebuild is the recovery path for corrected series, rating-bug fixes, and later historical imports (design §13.4). All-or-nothing per invocation.
- Rebuild rejects (422) a finalized series whose `played_at` is null (it cannot be ordered deterministically).

```python
# app/api/routes/rankings.py
router = APIRouter(prefix="/api/v1/rankings", tags=["rankings"])

@router.get("/teams", response_model=list[RankingEntry])
async def rankings_teams(svc: RankingService = Depends(get_ranking_service)) -> list[RankingEntry]:
    """current_elo DESC; rank = 1-based position."""

# app/api/routes/teams.py (additions — GET only, no admin dependency for reads)
@router.get("/{team_id}/rating-history", response_model=list[RatingEventResponse])
async def team_rating_history(team_id: uuid.UUID, svc: RankingService = Depends(get_ranking_service)) -> list[RatingEventResponse]: ...
@router.get("/{team_id}/series", response_model=list[SeriesView])
async def team_series(team_id: uuid.UUID, svc: RankingService = Depends(get_ranking_service)) -> list[SeriesView]: ...

# app/api/routes/rankings.py (addition — internal/admin command, admin-protected)
@router.post("/rebuild", status_code=200)
async def rebuild_rankings(note: str | None = None, svc: RankingRebuildService = Depends(get_rebuild_service)) -> dict:
    dependencies=[Depends(require_admin)]
```

**Steps (TDD)**

- [x] 1. Write `tests/unit/test_ranking_rebuild.py` (in-memory): two finalized series ordered by `played_at` replay deterministically; events inserted under the new run; old events remain unchanged; teams reset before replay; `played_at` ordering respected (later series applies later); a `forfeit_no_rating` series produces no events and no counters but still appears in order.
- [x] 2. Command: `uv run pytest -m "not live" tests/unit/test_ranking_rebuild.py -q`. Expected: fail first.
- [x] 3. Implement `ranking_rebuild_service.py`, `ranking_service.py`, rankings schema, routes.
- [x] 4. Re-run step 2. Expected: all pass.
- [x] 5. Write `tests/integration/test_rankings_api.py` against real Postgres: finalize 3 series → rankings order correct; rating-history explains every current rating (event chain replays to `current_elo`); **rebuild reproduces standings** (compare standings before vs after `rebuild()` — identical); run versions: after rebuild, history for a team contains events from both runs and current-run events match final standings.
- [x] 6. Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration/test_rankings_api.py -q`. Expected: all pass.
- [x] 7. Wire routers into `app/main.py`; `uv run ruff check app tests scripts`.

**Commit checkpoint:** commit `rankings: rankings API, rating history, deterministic versioned rebuild`.

---

## Task 17 — Docs, security, final validation

**Purpose:** Close out: README, OpenAPI validation, `.env.example` final pass, migration instructions, security review (admin token coverage, secret redaction, RLS/private-schema note), and a full final validation sweep mapped to the acceptance criteria.

**Files**
- Create: `README.md`, `docs/henrik-integration-notes.md`, `docs/tournament-future-extension-notes.md`
- Modify: `.env.example` (final), `docs/architecture-decisions.md` (add security/ops ADRs if not already), any residual lint/test failures

**Steps**

- [x] 1. Write `README.md`: project overview; prerequisites (Python 3.11+, Postgres, `uv`); setup (`uv sync`, copy `.env.example` → `.env`, `uv run python -m scripts.apply_migrations`); test commands (standard + integration + live opt-in); local run (`uv run uvicorn app.main:app --reload`); architecture summary; links to design/spec/contract/ADRs.
- [x] 2. Write `docs/henrik-integration-notes.md`: pinned contract summary, rate-limit etiquette (cache identities, PUUID history, default `size=10`, two-player workflow, post-import reads from Supabase, explicit `refresh` only), error mapping table.
- [x] 3. Write `docs/tournament-future-extension-notes.md`: extension points from design §18 (rosters `team_memberships`, tournaments/stages/fixtures, automatic discovery, statistics from retained raw payloads; Revival Impact Rating documented for later — never assumed).
- [x] 4. Security validation: grep the tree for `henrik_api_key`/`HENRIK_API_KEY`/`DATABASE_URL` outside `.env.example`/`docs`/`app/config.py`/`.env` — no credential-shaped values in committed code; `ruff` clean; admin dependency present on every mutation + discovery route (assert via an OpenAPI-driven test: every `POST`/`PATCH`/`DELETE` route lists `Depends(require_admin)` unless it is `GET` or `/health`).
- [x] 5. OpenAPI validation: boot the app, fetch `/openapi.json`, assert every route in the [API surface](#api-surface) exists with the documented methods and response models; Pydantic request/response schemas resolve.
- [x] 6. Final full sweep: `uv run ruff check app tests scripts && TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" -q` — all green.
- [x] 7. Optional live smoke (opt-in, rate-limited, `size=1`): explicit opt-in
  guard passed (`1 passed`). The bounded live probe reached both the history
  and detail endpoints and resolved U1 (bare auth), U2 (side literals
  Red/Blue), U3 (queue never sent), U4 (zero-based pagination: `start=0`
  returns the newest match, `start=1` the next, omission equals `start=0`),
  U5 (`mode=Custom` rejected — HTTP 400 code 27, so `CUSTOM_MODE_LITERAL`
  stays `None` with local filtering), and U7 (history/detail field shape
  confirmed), as applicable. U6 status is computed by the existing
  evidence/probe rules.

**Commit checkpoint:** commit `docs: README, integration notes, security + OpenAPI validation, final sweep`.

---

# Phase 2 gate

**Entry criteria (must hold):** Phase 1 gate passed; `docs/architecture-decisions.md` records the ELO characterization evidence.

**Operational capabilities at exit (design §2.2):**
1. Create Team A and Team B.
2. Create a BO1/BO3/BO5 series in `draft` status.
3. Attach already-imported Match IDs in order with per-game Red/Blue side mapping.
4. Derive each map winner from the imported game; derive series score and calculated winner.
5. Optionally set a different official winner with a mandatory reason.
6. Finalize the series exactly once for rating purposes (atomic, locked, idempotent).
7. Apply the preserved legacy ELO logic.
8. Show current team rankings and auditable rating history.
9. Rebuild rankings deterministically from finalized series.

**Gate checklist (owned by orchestrator; every box maps to a passing test):**

- [x] `TEST_DATABASE_URL=... uv run pytest -m "not live" -q` passes on real Postgres (685 passed, 1 deselected).
- [x] `uv run ruff check app tests scripts` passes.
- [x] Teams criteria (design §16.3 / impl spec §33): create with durable ID; rating starts at 1000; no hard delete path.
- [x] Series criteria: BO1/BO3/BO5 supported with required-win/max-game semantics; only imported matches attachable; sides map Red/Blue to Team A/Team B; scores derived not re-entered; calculated winner derived; official winner independent; override requires reason; finalization rejects invalid/incomplete series; cannot rate the same series twice.
- [x] Ratings criteria (design §16.4 / impl spec §33): legacy ELO characterization tests green (K boundaries, equal-ratings +5, BO3/BO5 multipliers pinned from code); finalization writes two events atomically; current ELO updates atomically; peak ELO maintained; rating history explains every current rating; rebuild reproduces standings; versioned `rating_runs` preserve immutable audit events.
- [x] Finalization transaction tests (design §15.6) green: atomic commit, rollback, double-finalize, concurrent same-team serialization, rebuild parity.
- [x] Policy locks verified by tests: official-winner ELO/counters; imported margin as performance input; `calculation_details` records override+mode; `round(...,0)` persistence; equal-ratings +5; versioned runs; `played_at` required + chronological; refresh rejected for finalized-series matches; incomplete imports rejected; import 201/200 idempotency; no-overlap search 200 empty; draft/finalized-only statuses; admin key enforcement.
- [x] Docs complete: `README.md`, `docs/henrik-contract.md`, `docs/architecture-decisions.md`, `docs/henrik-integration-notes.md`.

---
---

# Appendix A — SQL migration sequence

All migrations are plain SQL in `supabase/migrations/`, applied in filename order by `scripts/apply_migrations.py` (one transaction per file). **No Alembic.** Sequence:

```text
0001_players.sql        -> players
0002_matches.sql        -> matches
0003_match_players.sql  -> match_players
0004_teams.sql          -> teams
0005_series.sql         -> series
0006_series_games.sql   -> series_games (+ winner-in-owning-series trigger)
0007_rating_runs.sql    -> rating_runs (+ seed row)
0008_rating_events.sql  -> rating_events
```

## 0001_players.sql

```sql
CREATE TABLE players (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    puuid             text NOT NULL,
    current_name      text NOT NULL,
    current_tag       text NOT NULL,
    affinity          text,
    platforms         jsonb,
    henrik_updated_at timestamptz,
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_seen_at      timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX players_puuid_key ON players (puuid);
CREATE INDEX players_lower_name_tag_idx ON players (lower(current_name), lower(current_tag));
CREATE INDEX players_affinity_idx ON players (affinity);
```

## 0002_matches.sql

```sql
CREATE TABLE matches (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    henrik_match_id    text NOT NULL,
    affinity           text NOT NULL,
    platform           text NOT NULL DEFAULT 'pc',
    map_id             text,
    map_name           text NOT NULL,
    mode               text,
    queue              text,
    started_at         timestamptz NOT NULL,
    duration_ms        bigint,
    is_completed       boolean NOT NULL,
    red_score          integer,
    blue_score         integer,
    winning_side       text,
    game_version       text,
    raw_payload        jsonb NOT NULL,
    henrik_api_version text NOT NULL DEFAULT 'v4',
    imported_at        timestamptz NOT NULL DEFAULT now(),
    refreshed_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT matches_henrik_match_id_key UNIQUE (henrik_match_id),
    CONSTRAINT matches_red_score_nonneg CHECK (red_score IS NULL OR red_score >= 0),
    CONSTRAINT matches_blue_score_nonneg CHECK (blue_score IS NULL OR blue_score >= 0),
    CONSTRAINT matches_winning_side_check CHECK (winning_side IS NULL OR winning_side IN ('red','blue','draw','unknown')),
    CONSTRAINT matches_platform_check CHECK (platform IN ('pc','console'))
);

CREATE INDEX matches_started_at_idx ON matches (started_at);
CREATE INDEX matches_map_name_idx ON matches (map_name);
CREATE INDEX matches_mode_idx ON matches (mode);
```

## 0003_match_players.sql

```sql
CREATE TABLE match_players (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id           uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id          uuid NOT NULL REFERENCES players(id),
    puuid_snapshot     text NOT NULL,
    name_snapshot      text NOT NULL,
    tag_snapshot       text NOT NULL,
    side               text NOT NULL,
    agent_id           text,
    agent_name         text,
    score_total        integer,
    kills              integer,
    deaths             integer,
    assists            integer,
    damage_dealt       integer,
    damage_received    integer,
    headshots          integer,
    bodyshots          integer,
    legshots           integer,
    raw_player_payload jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT match_players_match_player_key UNIQUE (match_id, player_id),
    CONSTRAINT match_players_side_check CHECK (side IN ('red','blue'))
);

CREATE INDEX match_players_puuid_snapshot_idx ON match_players (puuid_snapshot);
CREATE INDEX match_players_player_id_idx ON match_players (player_id);
```

## 0004_teams.sql

```sql
CREATE TABLE teams (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    short_name     text,
    slug           text,
    logo_url       text,
    current_elo    numeric NOT NULL DEFAULT 1000,
    peak_elo       numeric NOT NULL DEFAULT 1000,
    seeding_elo    numeric,
    matches_played integer NOT NULL DEFAULT 0,
    series_wins    integer NOT NULL DEFAULT 0,
    series_losses  integer NOT NULL DEFAULT 0,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT teams_slug_key UNIQUE (slug),
    CONSTRAINT teams_current_elo_nonneg CHECK (current_elo >= 0),
    CONSTRAINT teams_peak_elo_nonneg CHECK (peak_elo >= 0)
);

CREATE INDEX teams_is_active_idx ON teams (is_active);
```

## 0005_series.sql

```sql
CREATE TABLE series (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_a_id              uuid NOT NULL REFERENCES teams(id),
    team_b_id              uuid NOT NULL REFERENCES teams(id),
    format                 text NOT NULL,
    importance             text NOT NULL,
    status                 text NOT NULL DEFAULT 'draft',
    calculated_winner_id   uuid REFERENCES teams(id),
    official_winner_id     uuid REFERENCES teams(id),
    winner_override_reason text,
    team_a_maps_won        integer NOT NULL DEFAULT 0,
    team_b_maps_won        integer NOT NULL DEFAULT 0,
    played_at              timestamptz,
    finalized_at           timestamptz,
    notes                  text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT series_team_distinct CHECK (team_a_id <> team_b_id),
    CONSTRAINT series_format_check CHECK (format IN ('bo1','bo3','bo5')),
    CONSTRAINT series_importance_check CHECK (importance IN ('regular','playoff','finals')),
    CONSTRAINT series_status_check CHECK (status IN ('draft','finalized')),        -- locked: only draft/finalized
    CONSTRAINT series_calculated_winner_check CHECK (
        calculated_winner_id IS NULL OR calculated_winner_id IN (team_a_id, team_b_id)),
    CONSTRAINT series_official_winner_check CHECK (
        official_winner_id IS NULL OR official_winner_id IN (team_a_id, team_b_id)),
    CONSTRAINT series_override_reason_check CHECK (
        official_winner_id IS NULL
        OR official_winner_id = calculated_winner_id
        OR (winner_override_reason IS NOT NULL AND length(trim(winner_override_reason)) > 0))
);

CREATE INDEX series_status_idx ON series (status);
CREATE INDEX series_team_a_idx ON series (team_a_id);
CREATE INDEX series_team_b_idx ON series (team_b_id);
```

> Note: `played_at` is nullable at creation (SeriesCreate accepts it) but finalization requires a non-null value (`SERIES_INVALID` 422 otherwise) and rebuild ordering depends on it.

## 0006_series_games.sql

```sql
CREATE TABLE series_games (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id      uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    game_number    integer NOT NULL,
    match_id       uuid NOT NULL REFERENCES matches(id),
    team_a_side    text NOT NULL,
    team_b_side    text NOT NULL,
    team_a_rounds  integer NOT NULL,
    team_b_rounds  integer NOT NULL,
    winner_team_id uuid REFERENCES teams(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT series_games_number_key UNIQUE (series_id, game_number),
    CONSTRAINT series_games_match_key UNIQUE (match_id),      -- one canonical match rated in at most one series
    CONSTRAINT series_games_number_positive CHECK (game_number > 0),
    CONSTRAINT series_games_sides_check CHECK (
        team_a_side IN ('red','blue') AND team_b_side IN ('red','blue') AND team_a_side <> team_b_side),
    CONSTRAINT series_games_rounds_nonneg CHECK (team_a_rounds >= 0 AND team_b_rounds >= 0)
);

CREATE INDEX series_games_series_id_idx ON series_games (series_id);
CREATE INDEX series_games_match_id_idx ON series_games (match_id);

CREATE OR REPLACE FUNCTION series_games_winner_check() RETURNS trigger AS $$
BEGIN
    IF NEW.winner_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM series s WHERE s.id = NEW.series_id
          AND (s.team_a_id = NEW.winner_team_id OR s.team_b_id = NEW.winner_team_id)
    ) THEN
        RAISE EXCEPTION 'winner_team_id must be a team of the owning series';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER series_games_winner_check_trg
    BEFORE INSERT OR UPDATE OF winner_team_id ON series_games
    FOR EACH ROW EXECUTE FUNCTION series_games_winner_check();
```

## 0007_rating_runs.sql

```sql
CREATE TABLE rating_runs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_number bigint GENERATED ALWAYS AS IDENTITY,
    note       text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rating_runs_run_number_key ON rating_runs (run_number);

-- Seed the initial (live) run so normal finalization has a run to write under.
INSERT INTO rating_runs (note) VALUES ('initial live run');
```

## 0008_rating_events.sql

```sql
CREATE TABLE rating_events (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  uuid NOT NULL REFERENCES rating_runs(id),
    series_id               uuid NOT NULL REFERENCES series(id),
    team_id                 uuid NOT NULL REFERENCES teams(id),
    elo_before              numeric NOT NULL,
    elo_after               numeric NOT NULL,
    elo_change              numeric NOT NULL,
    opponent_team_id        uuid NOT NULL REFERENCES teams(id),
    result                  text NOT NULL,
    k_factor                numeric,
    expected_score          numeric,
    performance_multiplier  numeric,
    importance_multiplier   numeric,
    upset_bonus             numeric,
    calculation_details     jsonb NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rating_events_run_series_team_key UNIQUE (run_id, series_id, team_id),
    CONSTRAINT rating_events_result_check CHECK (result IN ('win','loss'))
);

CREATE INDEX rating_events_team_id_idx ON rating_events (team_id);
CREATE INDEX rating_events_series_id_idx ON rating_events (series_id);
CREATE INDEX rating_events_run_id_idx ON rating_events (run_id);
```

> `rating_events` are immutable audit records: never updated, never deleted. Rebuilds insert under a new `rating_runs` row; reads use the current run (max `run_number`). The unique `(run_id, series_id, team_id)` plus the `series.status='finalized'` check enforce at-most-once rating per series per run.
---

## API surface

All routes versioned under `/api/v1` (design §11). `*` = admin-protected (`Depends(require_admin)`).

**Phase 1**

```text
GET    /api/v1/health
POST   /api/v1/players/resolve *                  {name, tag}
GET    /api/v1/players/{player_id}
GET    /api/v1/players/by-puuid/{puuid}
POST   /api/v1/match-search/two-player *          {player_a{name,tag}, player_b{name,tag}, platform?,
                                                    map?, mode?, from?, to?, page_size?, max_pages?}
POST   /api/v1/matches/import *                   {match_id, affinity, refresh?}   -> 201 created=true | 200 created=false
GET    /api/v1/matches[?map&from&to&player_puuid&limit&cursor]
GET    /api/v1/matches/{id}
GET    /api/v1/matches/by-henrik-id/{match_id}
```

**Phase 2**

```text
POST   /api/v1/teams *                            -> 201
GET    /api/v1/teams
GET    /api/v1/teams/{id}
PATCH  /api/v1/teams/{id} *                       (deactivation via is_active=false; no DELETE)
GET    /api/v1/teams/{team_id}/rating-history
GET    /api/v1/teams/{team_id}/series
POST   /api/v1/series *                           {team_a_id, team_b_id, format, importance, played_at, notes} -> 201 draft
POST   /api/v1/series/{series_id}/games *         {match_id, game_number, team_a_side} -> 201
DELETE /api/v1/series/{series_id}/games/{game_id} *   (draft only)
PATCH  /api/v1/series/{series_id}/games/{game_id} *   (draft only)
GET    /api/v1/series/{series_id}/preview
POST   /api/v1/series/{series_id}/finalize *      {official_winner_id?, override_reason?, rating_mode?}
DELETE /api/v1/series/{series_id} *               (draft only — explicit addition under draft/finalized status policy)
GET    /api/v1/series
GET    /api/v1/series/{id}
GET    /api/v1/rankings/teams
POST   /api/v1/rankings/rebuild *                 (internal/admin command; note? body or query)
```

---

# Appendix B — Error codes and status mapping

Response shape: `{"error": {"code", "message", "request_id"?}}`. Henrik `X-Request-ID` is surfaced only inside the error detail for support; the API key is never echoed.

| HTTP | Code | Meaning / source |
|---|---|---|
| 400 | `INVALID_SIDE_MAPPING` | invalid side literal / same side both teams |
| 401 | `ADMIN_AUTH_REQUIRED` | missing/wrong `X-Admin-Key` on an admin route |
| 404 | `PLAYER_NOT_FOUND` | player or Henrik code 22 |
| 404 | `PLAYER_REGION_UNKNOWN` | Henrik code 23 |
| 404 | `MATCH_NOT_FOUND` | match or Henrik code 26 |
| 404 | `SERIES_NOT_FOUND` | series id not found |
| 404 | `TEAM_NOT_FOUND` | team id not found |
| 409 | `SERIES_ALREADY_FINALIZED` | finalize on finalized/voided series; mutation of finalized series |
| 409 | `SERIES_INVALID` | `team_a_id == team_b_id`; invalid format/importance; `played_at` missing at finalize |
| 409 | `MATCH_ALREADY_ASSIGNED_TO_SERIES` | attach a match already used in another series |
| 409 | `ANCHOR_NOT_IN_MATCH` | attach with `team_a_side` omitted when the match lacks both anchors on opposing sides |
| 409 | `MATCH_REFRESH_REJECTED` | `refresh=true` on a match attached to a finalized series (explicit extension) |
| 409 | `RATING_POLICY_REQUIRED` | override/forfeit without an explicitly selected rating mode |
| 422 | `INVALID_RIOT_ID` | malformed name/tag/UUID/match_id; affinity mismatch |
| 422 | `MATCH_NOT_COMPLETED` | import or attach of an `is_completed=false` match |
| 422 | `HENRIK_VALIDATION_ERROR` | Henrik code 27/28/42/43/45 (invalid mode/map/platform/UUID/start) |
| 429 | `HENRIK_RATE_LIMITED` | Henrik 429 (carries `Retry-After`/`X-RateLimit-Reset` in detail) |
| 500 | `INTERNAL_ERROR` | unhandled exception |
| 502 | `HENRIK_AUTH_FAILED` | Henrik 401/403 |
| 503 | `HENRIK_UNAVAILABLE` | Henrik 500/501/network failure |

Design §14.1 stable codes are all present; additions flagged explicitly: `ADMIN_AUTH_REQUIRED` (Task 3), `MATCH_REFRESH_REJECTED` (Task 8), `TEAM_SLUG_TAKEN` (optional, Task 11).

---

# Appendix C — Fixture inventory

Sanitized fixtures live under `tests/fixtures/henrik/` (sanitization rules in `tests/fixtures/henrik/README.md`; real PUUIDs/names/tags replaced with deterministic fakes; structure preserved). Tests under `tests/fixtures/elo/` hold ELO golden values.

```text
tests/fixtures/henrik/
  account_v2/
    valid.json                  valid account (name/tag/puuid/region/platforms/updated_at)
    valid_force.json            same shape with force passthrough trace
    missing_platform.json       platform-optional case
    error_404_code22.json       account not found
    error_404_code23.json       region unknown
  history_v4/
    page1_mixed_modes.json      data[] with several matches (completed + one incomplete)
    page2_overlap.json          later page sharing a match_id with page1 (pagination tests)
    empty.json                  data: []
    error_400_code45.json       invalid start
    error_400_code27.json       invalid mode
    error_400_code28.json       invalid map
    error_400_code42.json       invalid platform
    error_400_code43.json       invalid UUID/PUUID
  match_detail_v4/
    completed_custom.json       full detail: metadata.match_id/map/started_at/is_completed,
                                players[].puuid/name/tag/team_id/stats (rich), teams[].team_id/rounds.won/lost/won
    incomplete.json             is_completed=false (import must reject)
    missing_optional_stats.json players without stats/agent fields (import must succeed)
    malformed_required.json     player missing puuid (import must fail loudly)
    unknown_side_literal.json   teams[].team_id = "Green" (HenrikProtocolError)
  errors/
    error_401.json / error_403.json / error_429.json   (429 includes retry headers sample)

tests/fixtures/elo/
  golden_cases.json             {inputs -> expected outputs} generated from the legacy calculator pre-refactor
```

---

# Appendix D — Real-Postgres test setup and live opt-in

**Real Postgres (mandatory for integration/concurrency):**
- `tests/integration/conftest.py` requires `TEST_DATABASE_URL` (asyncpg URL). If unset, integration tests `pytest.skip("TEST_DATABASE_URL not set")`.
- Session-scoped fixture applies `supabase/migrations/*.sql` in order into a dedicated schema; function-scoped fixture truncates `rating_events, rating_runs, series_games, series, teams, match_players, matches, players` between tests.
- Command: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" tests/integration -q`.
- CI runs the same command against a Postgres 16 service container (Task 3 workflow). SQLite is never used.

**Live Henrik tests (opt-in only):**
- Marker `live` on tests in `tests/integration/live/`; skipped unless both `HENRIK_API_KEY` and `RUN_LIVE_HENRIK=1` are set. Live tests use `size=1` and a single small page to stay rate-limited.
- Command: `HENRIK_API_KEY=... RUN_LIVE_HENRIK=1 uv run pytest -m live tests/integration/live -q`.
- Live facts are recorded (not asserted as stable truth) in `docs/henrik-contract.md`; all deterministic behavior is covered by fixtures.

---

# Appendix E — Acceptance criteria mapping

Every acceptance criterion maps to named tests.

| Spec / design section | Criterion | Covered by |
|---|---|---|
| impl §19 functional; design §16.1 | resolve + persist; idempotent re-resolve | `test_player_resolve.py`, `test_player_service.py` |
| impl §19 functional; design §16.1 | exact `metadata.match_id` intersection; map/date filters; candidate + direct import; no duplicate re-import; Supabase-only retrieval; raw JSONB persisted; PUUID/side normalization | `test_match_discovery.py`, `test_match_import.py`, `test_match_library_api.py` |
| impl §19 reliability; design §16.2 | 429 headers; no blind 400/404 retry; bounded exponential retry; `X-Request-ID` logged; key never logged; transactional writes; concurrent import converges | `test_henrik_client.py`, `test_logging_redaction.py`, `test_match_import.py`, `test_logging_format.py` |
| impl §33 teams; design §16.3 | durable ID; rating starts 1000; no hard delete | `test_team_service.py`, `test_teams_api.py` |
| impl §33 series; design §16.3 | BO1/3/5 semantics (2-0/2-1/3-0/3-1/3-2 valid; clinch rule); imported-match-only attach; Red/Blue→A/B mapping; derived scores; calculated vs official winner; override needs reason; reject invalid; no double rating | `test_series_bo.py`, `test_series_service.py`, `test_series_api.py`, `test_preview.py`, `test_rating_policy.py` |
| impl §33 ratings; design §16.4 | characterization tests; exact BO3/BO5 multiplier from code; atomic two events; atomic current ELO; peak maintained; history explains rating; rebuild reproduces standings | `test_elo_calculator_parity.py`, `test_rating_service.py`, `test_finalization.py`, `test_rankings_api.py` |
| design §15.6 | commit/rollback, double-finalize, concurrent serialization, rebuild parity | `test_finalization.py`, `test_ranking_rebuild.py` |
| design §15.1 | adapter fixture coverage incl. error codes and side literals | `test_henrik_mapper.py` |
| design §15.2 | discovery matrix incl. no-overlap 200, pagination, duplicate ids, 429 | `test_match_discovery.py` |
| design §15.3 | import matrix incl. known player, Riot ID change, missing optional stats, rollback, verbatim raw | `test_match_import.py` |
| Policy locks (Global Constraints 11) | official-winner ELO/counters; margin inputs; `calculation_details` override+mode; `round(...,0)` persistence; equal-ratings +5; versioned runs; `played_at` required + chronological; refresh rejection; incomplete-import rejection; 201/200 idempotency; no-overlap 200 empty; draft/finalized only; admin enforcement | `test_rating_policy.py`, `test_rating_service.py`, `test_finalization.py`, `test_ranking_rebuild.py`, `test_match_import.py`, `test_match_discovery.py`, `test_series_service.py`, `test_admin_dependency.py`, `test_contract_pins.py` |
| Wave 0 gate (U1–U7) | auth scheme, pagination start, side literals, custom mode, completion/time fields | `scripts/henrik_contract_probe.py`, `test_contract_pins.py`, fixtures |

---

# Appendix F — Explicit non-goals

Never implemented in Phase 1/2 (design §17, impl §35): frontend/Streamlit/any UI; tournament registration, brackets, groups, Swiss stages, map veto; team roster registration, captain/player accounts, ownership verification; Riot official API, Riot RSO/OAuth, and any provider abstraction for a hypothetical Riot migration; automatic one-player roster discovery; **Revival static JSON import** (the 13 JSON files are not canonical, and no Revival generator is assumed); player career statistics, VLR/Discord integration, real-time live match tracking; complete kill/round/economy normalization (raw payloads retained only); public authentication; image/logo storage beyond a URL field; `player_aliases` (deferred). No `backend/` nesting; no Alembic; no SQLite in integration/concurrency tests.

---

*Validation owner: orchestrator. Scope of this plan: a single plan file. No commits or code changes are made by this document.*
