# VALORANT FastAPI Quest-Integration Contract (D1–D10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the FastAPI-side deltas D1–D10 (service-token auth, team/series create-or-get keys, `unrated` mode, reason-required forfeit/override, anchors, audit fields, chronological guard, absolute desired-order endpoint, ID-naming contract) in the sibling repo `valorant-platform-backend` so Quest can bind teams, build and finalize rated/unrated series, and reconcile.

**Architecture:** All work lives in the FastAPI repo (`/Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend`), additive to the `valorant` schema via one plain-SQL migration wave `0014_*.sql` (durable `_migration_ledger` runner). D1 replaces the production `X-Admin-Key` gate on domain routes with an HMAC-SHA256 service-token dependency (bypassed in `local`/`test`, mirroring today's `require_admin` bypass), propagating a signed actor/operation principal that the finalize transaction persists (D7). D2/D3 make `POST /teams` and `POST /series` idempotent create-or-get by `quest_saved_team_id` / `external_quest_series_id`. D4/D5 extend the pure rating-policy module; D6 adds anchor columns resolved at series create and a rated-finalize verification; D8 adds a chronological guard inside the finalize transaction; D9 adds `PUT /series/{id}/games/order`; D10 pins the match-ID contract in schemas and tests. The final task adds Quest-facing contract/integration tests.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async + asyncpg, Pydantic v2, pytest + pytest-asyncio (integration suite against real Postgres via `TEST_DATABASE_URL`), plain-SQL migration runner (`scripts/apply_migrations.py`), `uv`, `ruff`.

**Approved spec (authoritative):** `/Users/naheedroomy/Documents/valorant-stats-endpoints/QuestEsports/docs/superpowers/specs/2026-08-13-standalone-valorant-integration-design.md` — §4.4 (delta table), §5.1–§5.6 (workflows), §6.3–§6.5 (auth/headers/errors), §7.3 (migration rules), §8.5 (chronological rule), §9.2 (audit), §11.2–§11.4 (contract/DB/API tests). Every task cites its spec anchor.

**Scope guard:** This plan covers ONLY FastAPI-side work. The Quest-side work (Prisma models, `backend/src/modules/valorant/*`, bindings, operation records) is a separate plan. Nothing here touches `QuestEsports` application code — this document is the only file this plan creates.

---

## 0. Repository facts and command conventions

**All commands run from:** `/Users/naheedroomy/Documents/valorant-stats-endpoints/valorant-platform-backend` (the sibling repo; do not `cd` into `QuestEsports`).

**Commands:**
- Unit tests (no DB): `uv run pytest tests/unit/<file>.py::<test> -v`
- Integration tests (real Postgres; skipped without it): `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/<file>.py -q -m "not live"`
- Full suite: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" -q`
- Lint: `uv run ruff check app tests scripts`
- Apply migrations: `uv run python -m scripts.apply_migrations --database-url <url> [--search-path <schema>]`

**Current-state contract pins (verify before starting; these are the ACTUAL contracts today):**

| Contract | Current state (exact) |
|---|---|
| Import request `match_id` | `app/schemas/matches.py::MatchImportRequest.match_id: str` (`min_length=8, max_length=64, pattern=r"^[0-9a-fA-F-]+$"`) — holds the **Henrik text ID**, NOT the internal UUID |
| Internal match identity | `matches.id` (UUID) — what `AttachGameRequest.match_id: uuid.UUID` (`app/schemas/series.py`) accepts; surfaced as `MatchDetailResponse.id` |
| Series status | `series_status_check`: `draft\|finalized` only (`0005_series.sql`, `app/db/models/series.py`). Quest's `orphaned`/`reconciliation_required` states exist only in Quest's `public` schema and are never sent to FastAPI |
| Rating modes | `app/domain/ratings/policy.py` `RATING_MODES = ("normal", "forfeit_no_rating", "forfeit_result_only", "manual_override")`; `_RATE_SERIES_MODES = {"normal","manual_override"}`; DB CHECK `series_rating_mode_check` in `0009_series_rating_mode.sql`; schema `RatingMode = Literal[...]` in `app/schemas/series.py` |
| Error envelope | `{"error": {"code", "message", "request_id"?}}` (`app/api/errors.py`); 422 validation is `INVALID_REQUEST` (or `INVALID_RIOT_ID` on player/import paths); no upstream text echoed |
| Auth today | `app/api/dependencies.py::require_admin` compares `X-Admin-Key` via `secrets.compare_digest`, bypassed when `app_env in {"local","test"}`; health unauthenticated; mutations + match-search are admin-gated, GET reads public |
| Finalize transaction | `app/services/rating_service.py::RatingService.finalize` → `_finalize_locked`: advisory lock (`RatingRepository.acquire_rating_work_lock`, key `RATING_WORK_LOCK_KEY = 4_266_611_572_813`) → series `FOR UPDATE` → teams `FOR UPDATE` sorted → canonical games re-read (`SeriesRepository.get_series_with_canonical_games`) → BO gate → `resolve_rating_policy` → `apply_rating_policy` → persist `status='finalized'` + `rating_mode` |
| Migration ledger | `_migration_ledger` inside target schema; runner `scripts/apply_migrations.py`; files `supabase/migrations/0001_*.sql … 0013_*.sql` exist; **the next file is `0014_*`**; expand-first rule (§7.3) |
| Double-rate guard | DB unique `(run_id, series_id, team_id)` on `rating_events` + advisory lock; re-import is 200 `created=false` (never an error) |
| Per-request ID | `app/main.py::RequestIdMiddleware` sets `request.state.request_id`, echoed as `X-Request-ID`; distinct from the Quest `operation_id` (spec §9.2) |
| Test harness | `tests/integration/conftest.py` creates a fresh schema per session and applies every `supabase/migrations/*.sql`; `TRUNCATE_ORDER` truncates known tables between tests |
| Anchor fixture | `tests/fixtures/henrik/match_detail_v4/completed_custom.json`: exactly two players — `PlayerA#A` Red (`puuid_p_a`), `PlayerB#B` Blue (`puuid_p_b`); match import persists `match_players.puuid_snapshot`/`side` |

**Existing tests that MUST be updated as part of this plan** (enumerated inside their tasks): `tests/unit/test_rating_policy.py`, `tests/unit/test_route_inventory.py`, `tests/unit/test_rating_service.py`, `tests/integration/test_teams_api.py`, `tests/integration/test_finalization.py`, `tests/integration/test_match_import.py`, `tests/integration/test_player_resolve.py`, `tests/integration/test_match_discovery.py`, `tests/integration/test_preview_api.py`.

---

## File structure (what this plan creates/modifies)

```
supabase/migrations/0014_quest_integration.sql   Create  (Task 1)
app/db/models/team.py                            Modify  (Task 1, 4)
app/db/models/series.py                          Modify  (Task 1, 5, 7)
app/db/repositories/team_repository.py           Modify  (Task 4)
app/db/repositories/series_repository.py         Modify  (Task 5, 7, 9, 10)
app/db/repositories/match_repository.py          Modify  (Task 7)
app/api/service_token.py                         Create  (Task 2)
app/api/dependencies.py                          Modify  (Task 2, 3, 7)
app/config.py                                    Modify  (Task 2)
app/api/routes/{teams,series,matches,players,match_search,rankings}.py  Modify (Task 3, 4, 5, 8, 10)
app/schemas/teams.py                             Modify  (Task 4)
app/schemas/series.py                            Modify  (Task 5, 6, 7, 10, 11)
app/schemas/matches.py                           Modify  (Task 11)
app/services/team_service.py                     Modify  (Task 4)
app/services/series_service.py                   Modify  (Task 5, 7, 10)
app/services/player_service.py                   Modify  (Task 7)
app/services/rating_service.py                   Modify  (Task 6, 7, 8, 9)
app/domain/ratings/policy.py                     Modify  (Task 6)
app/domain/series/anchor.py                      Create  (Task 7)
.env.example                                     Modify  (Task 2)
tests/token_helpers.py                           Create  (Task 3)
tests/unit/test_service_token.py                 Create  (Task 2)
tests/unit/test_id_naming_contract.py            Create  (Task 11)
tests/unit/test_anchor.py                        Create  (Task 7)
tests/unit/test_rating_policy.py                 Modify  (Task 6)
tests/unit/test_route_inventory.py               Modify  (Task 3, 10)
tests/unit/test_rating_service.py                Modify  (Task 6, 7, 8, 9)
tests/unit/test_series_service.py                Modify  (Task 5, 7, 10)
tests/unit/test_team_service.py                  Modify  (Task 4)
tests/integration/test_migration_0014.py         Create  (Task 1)
tests/integration/test_teams_api.py              Modify  (Task 3, 4)
tests/integration/test_finalization.py           Modify  (Task 3, 6, 7, 8, 9)
tests/integration/test_match_import.py           Modify  (Task 3)
tests/integration/test_player_resolve.py         Modify  (Task 3)
tests/integration/test_match_discovery.py        Modify  (Task 3)
tests/integration/test_preview_api.py            Modify  (Task 3)
tests/integration/test_anchor_verification.py    Create  (Task 7)
tests/integration/test_backdated_finalization.py Create  (Task 9)
tests/integration/test_quest_contract.py         Create  (Task 12)
```

---

## Task 1: Migration `0014` + ORM columns (D2/D3/D4/D6/D7)

**Spec anchors:** §4.4 D2/D3/D4/D6/D7, §7.3 (expand-first), §3.2 (migration ownership).

**Files:**
- Create: `supabase/migrations/0014_quest_integration.sql`
- Modify: `app/db/models/team.py`, `app/db/models/series.py`
- Test: `tests/integration/test_migration_0014.py`

- [ ] **Step 1: Write the failing migration-contract test**

Create `tests/integration/test_migration_0014.py`:

```python
"""Migration 0014 contract tests (spec §4.4 D2/D3/D4/D6/D7).

Proves the Quest-integration columns/constraints on the migrated schema:
the partial-unique ``quest_saved_team_id`` on ``teams``; the nullable-unique
``external_quest_series_id`` on ``series``; the two anchor PUUID columns and
the two finalize-audit columns; and the widened ``series_rating_mode_check``
that now accepts ``unrated``. Skipped when ``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import Series, Team


async def _insert_team(session_factory, *, name: str, quest_saved_team_id: str | None) -> None:
    async with session_factory() as session:
        session.add(Team(name=name, quest_saved_team_id=quest_saved_team_id))
        await session.commit()


async def test_teams_quest_saved_team_id_partial_unique(session_factory) -> None:
    await _insert_team(session_factory, name="Alpha", quest_saved_team_id="quest-team-1")
    async with session_factory() as session:
        session.add(Team(name="Beta", quest_saved_team_id="quest-team-1"))
        with pytest.raises(IntegrityError, match="teams_quest_saved_team_id_key"):
            await session.commit()
        await session.rollback()
    await _insert_team(session_factory, name="Gamma", quest_saved_team_id=None)
    await _insert_team(session_factory, name="Delta", quest_saved_team_id=None)


async def test_series_external_quest_series_id_unique_nullable(session_factory) -> None:
    async with session_factory() as session:
        a, b, c, d = Team(name="A"), Team(name="B"), Team(name="C"), Team(name="D")
        session.add_all([a, b, c, d])
        await session.commit()
        team_a, team_b, team_c, team_d = a.id, b.id, c.id, d.id
    async with session_factory() as session:
        session.add(
            Series(team_a_id=team_a, team_b_id=team_b, format="bo1", importance="regular",
                   external_quest_series_id="quest-series-1")
        )
        session.add(
            Series(team_a_id=team_c, team_b_id=team_d, format="bo1", importance="regular",
                   external_quest_series_id=None)
        )
        await session.commit()
    async with session_factory() as session:
        session.add(
            Series(team_a_id=team_a, team_b_id=team_b, format="bo1", importance="regular",
                   external_quest_series_id="quest-series-1")
        )
        with pytest.raises(IntegrityError, match="series_external_quest_series_id_key"):
            await session.commit()
        await session.rollback()


async def test_series_anchor_and_audit_columns_round_trip(session_factory) -> None:
    async with session_factory() as session:
        a, b = Team(name="A"), Team(name="B")
        session.add_all([a, b])
        await session.commit()
        row = Series(team_a_id=a.id, team_b_id=b.id, format="bo1", importance="regular",
                     anchor_a_puuid="puuid_a", anchor_b_puuid="puuid_b",
                     finalized_by_actor_id="actor-1", finalized_by_operation_id="op-1")
        session.add(row)
        await session.commit()
        loaded = await session.get(Series, row.id)
        assert loaded.anchor_a_puuid == "puuid_a"
        assert loaded.anchor_b_puuid == "puuid_b"
        assert loaded.finalized_by_actor_id == "actor-1"
        assert loaded.finalized_by_operation_id == "op-1"


async def test_series_rating_mode_check_accepts_unrated(session_factory) -> None:
    async with session_factory() as session:
        a, b = Team(name="A"), Team(name="B")
        session.add_all([a, b])
        await session.commit()
        session.add(Series(team_a_id=a.id, team_b_id=b.id, format="bo1", importance="regular",
                           rating_mode="unrated"))
        await session.commit()
    async with session_factory() as session:
        c, d = Team(name="C"), Team(name="D")
        session.add_all([c, d])
        await session.commit()
        session.add(Series(team_a_id=c.id, team_b_id=d.id, format="bo1", importance="regular",
                           rating_mode="void"))
        with pytest.raises(IntegrityError, match="series_rating_mode_check"):
            await session.commit()
        await session.rollback()
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_migration_0014.py -q -m "not live"
```
Expected: FAIL. `Team(**{"quest_saved_team_id": ...})` raises `TypeError: __init__() got an unexpected keyword argument 'quest_saved_team_id'` (the model has no such column yet) and/or `UndefinedColumn: column teams.quest_saved_team_id does not exist`.

- [ ] **Step 3: Write the migration and the ORM columns**

Create `supabase/migrations/0014_quest_integration.sql`:

```sql
-- 0014_quest_integration.sql — Quest integration columns (spec §4.4 D2/D3/D4/D6/D7)
-- Expand-first (§7.3): every column is nullable and no backfill is needed
-- (new data only); the widened rating_mode CHECK only relaxes the allowed set.

-- D2: teams.quest_saved_team_id — the single convergence key for create-or-get.
ALTER TABLE teams ADD COLUMN quest_saved_team_id text;
CREATE UNIQUE INDEX teams_quest_saved_team_id_key
    ON teams (quest_saved_team_id) WHERE quest_saved_team_id IS NOT NULL;

-- D3: series.external_quest_series_id — create-or-get convergence key.
-- A plain UNIQUE constraint is safe: Postgres allows multiple NULLs.
ALTER TABLE series ADD COLUMN external_quest_series_id text;
ALTER TABLE series ADD CONSTRAINT series_external_quest_series_id_key UNIQUE (external_quest_series_id);

-- D6: anchor identity PUUIDs, resolved and persisted at series create.
ALTER TABLE series ADD COLUMN anchor_a_puuid text;
ALTER TABLE series ADD COLUMN anchor_b_puuid text;

-- D7: finalize actor/operation audit fields (persisted from the token claims).
ALTER TABLE series ADD COLUMN finalized_by_actor_id text;
ALTER TABLE series ADD COLUMN finalized_by_operation_id text;

-- D4: widen series_rating_mode_check to include 'unrated'.
ALTER TABLE series DROP CONSTRAINT series_rating_mode_check;
ALTER TABLE series ADD CONSTRAINT series_rating_mode_check CHECK (
    rating_mode IS NULL
    OR rating_mode IN ('normal','unrated','forfeit_no_rating','forfeit_result_only','manual_override')
);
```

Modify `app/db/models/team.py`:

- After `logo_url` (line 41) add:
```python
    quest_saved_team_id: Mapped[str | None] = mapped_column(Text)
```
- Extend `__table_args__` (after `Index("teams_is_active_idx", "is_active")`):
```python
        Index(
            "teams_quest_saved_team_id_key",
            "quest_saved_team_id",
            unique=True,
            postgresql_where=text("quest_saved_team_id IS NOT NULL"),
        ),
```

Modify `app/db/models/series.py`:

- After `rating_mode` (line 52) add:
```python
    external_quest_series_id: Mapped[str | None] = mapped_column(Text)
    anchor_a_puuid: Mapped[str | None] = mapped_column(Text)
    anchor_b_puuid: Mapped[str | None] = mapped_column(Text)
    finalized_by_actor_id: Mapped[str | None] = mapped_column(Text)
    finalized_by_operation_id: Mapped[str | None] = mapped_column(Text)
```
- Extend `__table_args__`: add `UniqueConstraint("external_quest_series_id", name="series_external_quest_series_id_key")` before the `Index(...)` entries, and change the `series_rating_mode_check` CheckConstraint literal (lines 79–83) to:
```python
        CheckConstraint(
            "rating_mode IS NULL OR rating_mode IN "
            "('normal','unrated','forfeit_no_rating','forfeit_result_only','manual_override')",
            name="series_rating_mode_check",
        ),
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same command as Step 2. Expected: PASS (4 passed). The session-scoped `migrated_schema` fixture applies `0014_quest_integration.sql` automatically; `tests/integration/test_migration_runner.py` and `tests/integration/test_migrations.py` use `glob`, so they stay green.

- [ ] **Step 5: Run the migration runner + integration migration tests**

Run:
```
uv run python -m scripts.apply_migrations --database-url postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_migrations.py tests/integration/test_migration_runner.py tests/integration/test_migration_0014.py -q -m "not live"
```
Expected: `applied 0014_quest_integration.sql`; all migration tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0014_quest_integration.sql app/db/models/team.py app/db/models/series.py tests/integration/test_migration_0014.py
git commit -m "feat: 0014 quest integration columns (D2/D3/D4/D6/D7)"
```

---

## Task 2: D1a — service-token module, config, and dependency

**Spec anchors:** §4.4 D1, §6.3 (token/claims/rotation), §6.5 (`ADMIN_AUTH_REQUIRED` 401), §10.1 (env vars).

**Files:**
- Create: `app/api/service_token.py`
- Modify: `app/config.py`, `app/api/dependencies.py`, `.env.example`
- Test: `tests/unit/test_service_token.py`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/test_service_token.py`:

```python
"""Service-token signing/verification unit tests (spec §6.3, delta D1).

HMAC-SHA256 bearer tokens signed by Quest carry ``iss``/``aud``/``sub``/
``operation_id``/``iat``/``nbf``/``exp`` and a ``kid`` header selecting the
shared secret. FastAPI verifies only; the signer here is the same code
integration tests and ops tooling use to mint tokens.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.api.service_token import (
    ServicePrincipal,
    ServiceTokenError,
    _b64url_decode,
    _b64url_encode,
    parse_secrets_map,
    sign_service_token,
    verify_service_token,
)

SECRET = "test-secret"
SECRETS = {"kid-1": SECRET, "kid-2": "previous-secret"}


def _token(**overrides) -> str:
    kwargs = {
        "secret": SECRET,
        "kid": "kid-1",
        "issuer": "quest-esports",
        "audience": "valorant-platform",
        "subject": "actor-1",
        "operation_id": "op-1",
    }
    kwargs.update(overrides)
    return sign_service_token(**kwargs)


def _verify(token: str, **overrides) -> ServicePrincipal:
    kwargs = {
        "secrets_by_kid": SECRETS,
        "issuer": "quest-esports",
        "audience": "valorant-platform",
        "max_skew_seconds": 30,
    }
    kwargs.update(overrides)
    return verify_service_token(token, **kwargs)


def test_parse_secrets_map_round_trips() -> None:
    assert parse_secrets_map("kid-1=secret-a,kid-2=secret-b") == {
        "kid-1": "secret-a",
        "kid-2": "secret-b",
    }
    assert parse_secrets_map(None) == {}


def test_parse_secrets_map_rejects_malformed_pair() -> None:
    with pytest.raises(ValueError):
        parse_secrets_map("kid-with-no-equals")


def test_valid_token_verifies_to_principal() -> None:
    principal = _verify(_token())
    assert principal.actor_id == "actor-1"
    assert principal.operation_id == "op-1"


def test_dual_key_overlap_window() -> None:
    old = _token(secret="previous-secret", kid="kid-2")
    assert _verify(old).actor_id == "actor-1"


def test_wrong_signature_rejected() -> None:
    parts = _token().split(".")
    tampered = parts[0] + "." + parts[1] + ".AAAA"
    with pytest.raises(ServiceTokenError, match="bad signature"):
        _verify(tampered)


def test_unknown_kid_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="unknown kid"):
        _verify(_token(kid="kid-3"))


def test_wrong_issuer_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="unexpected issuer"):
        _verify(_token(issuer="someone-else"))


def test_wrong_audience_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="unexpected audience"):
        _verify(_token(audience="other-aud"))


def test_expired_token_rejected() -> None:
    issued = datetime.now(UTC) - timedelta(minutes=10)
    with pytest.raises(ServiceTokenError, match="expired"):
        _verify(_token(issued_at=issued, ttl_seconds=300))


def test_expired_token_within_skew_accepted() -> None:
    issued = datetime.now(UTC) - timedelta(seconds=310)  # exp 10s ago, skew 30s
    assert _verify(_token(issued_at=issued, ttl_seconds=300)).actor_id == "actor-1"


def test_not_yet_valid_rejected() -> None:
    issued = datetime.now(UTC) + timedelta(minutes=2)
    with pytest.raises(ServiceTokenError, match="not yet valid"):
        _verify(_token(issued_at=issued, ttl_seconds=300))


def test_missing_sub_or_operation_id_rejected() -> None:
    token = _token()
    payload = json.loads(_b64url_decode(token.split(".")[1]))
    del payload["operation_id"]
    signing_input = token.split(".")[0] + "." + _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    sig = hmac.new(SECRET.encode(), signing_input.encode(), hashlib.sha256).digest()
    forged = signing_input + "." + _b64url_encode(sig)
    with pytest.raises(ServiceTokenError, match="sub/operation_id"):
        _verify(forged)


def test_malformed_token_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="malformed"):
        _verify("not.a.token")


def test_operation_id_defaults_to_uuid() -> None:
    principal = _verify(_token(operation_id=None))
    uuid.UUID(principal.operation_id)  # must parse
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_service_token.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.api.service_token'`.

- [ ] **Step 3: Implement `app/api/service_token.py`**

Create `app/api/service_token.py`:

```python
"""Quest service-token signing/verification (spec §6.3, delta D1).

Quest signs an HMAC-SHA256 bearer token (``alg=HS256``, ``kid``-selected
shared secret) with claims ``iss``/``aud``/``sub``/``operation_id``/``iat``/
``nbf``/``exp``. This module owns signing (used by integration tests and ops
tooling) and verification (used by the ``require_service_token`` dependency).
Tokens, secrets, and raw payloads are never logged.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


class ServiceTokenError(Exception):
    """Base for token verification failures (mapped to 401 at the API)."""


@dataclass(frozen=True)
class ServicePrincipal:
    """Validated caller identity propagated to the domain layer.

    ``actor_id`` is the signed Quest ``sub`` (``users.id``); ``operation_id``
    is the signed Quest operation UUID — the durable cross-service correlation
    key (spec §9.2). Never derived from an unsigned header in production.
    """

    actor_id: str | None
    operation_id: str


def parse_secrets_map(raw: str | None) -> dict[str, str]:
    """Parse ``QUEST_SERVICE_SHARED_SECRETS="kid1=secret1,kid2=secret2"``."""
    secrets: dict[str, str] = {}
    if not raw:
        return secrets
    for pair in raw.split(","):
        key, sep, value = pair.partition("=")
        if not sep or not key.strip() or not value.strip():
            raise ValueError(f"malformed shared-secret pair: {pair!r}")
        secrets[key.strip()] = value.strip()
    return secrets


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(payload: str) -> bytes:
    padded = payload + "=" * (-len(payload) % 4)
    return base64.urlsafe_b64decode(padded)


def sign_service_token(
    *,
    secret: str,
    kid: str,
    issuer: str,
    audience: str,
    subject: str,
    operation_id: str | None = None,
    issued_at: datetime | None = None,
    ttl_seconds: int = 300,
) -> str:
    """Sign an HMAC-SHA256 service token (test/ops helper)."""
    now = issued_at or datetime.now(UTC)
    header = {"alg": "HS256", "typ": "JWT", "kid": kid}
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": subject,
        "operation_id": operation_id or str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    signing_input = (
        _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        + "."
        + _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    )
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return signing_input + "." + _b64url_encode(signature)


def verify_service_token(
    token: str,
    *,
    secrets_by_kid: dict[str, str],
    issuer: str,
    audience: str,
    max_skew_seconds: int = 30,
) -> ServicePrincipal:
    """Validate signature, ``iss``/``aud``, and ``exp``/``nbf`` with skew.

    Returns the validated principal; raises ``ServiceTokenError`` for every
    rejection (the dependency maps it to 401 ``ADMIN_AUTH_REQUIRED``). The
    ``kid`` header selects the shared secret (dual-key rotation window).
    """
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
        signature = _b64url_decode(signature_b64)
    except (ValueError, json.JSONDecodeError) as exc:
        raise ServiceTokenError("malformed token") from exc
    kid = header.get("kid")
    if not isinstance(kid, str) or kid not in secrets_by_kid:
        raise ServiceTokenError("unknown kid")
    expected = hmac.new(
        secrets_by_kid[kid].encode("utf-8"),
        (header_b64 + "." + payload_b64).encode("ascii"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(signature, expected):
        raise ServiceTokenError("bad signature")
    if payload.get("iss") != issuer:
        raise ServiceTokenError("unexpected issuer")
    if payload.get("aud") != audience:
        raise ServiceTokenError("unexpected audience")
    nbf = payload.get("nbf")
    exp = payload.get("exp")
    if not isinstance(nbf, (int, float)) or not isinstance(exp, (int, float)):
        raise ServiceTokenError("missing nbf/exp")
    now = datetime.now(UTC).timestamp()
    if now < nbf - max_skew_seconds:
        raise ServiceTokenError("token not yet valid")
    if now > exp + max_skew_seconds:
        raise ServiceTokenError("token expired")
    subject = payload.get("sub")
    operation_id = payload.get("operation_id")
    if not isinstance(subject, str) or not isinstance(operation_id, str):
        raise ServiceTokenError("missing sub/operation_id")
    return ServicePrincipal(actor_id=subject, operation_id=operation_id)
```

- [ ] **Step 4: Add the settings fields**

Modify `app/config.py` — after `admin_api_key` (line 25) add:

```python
    # Quest service-token (HMAC bearer) verification (delta D1; spec §6.3).
    # Format: "kid1=secret1,kid2=secret2" (dual-key rotation window).
    quest_service_shared_secrets: str | None = None
    quest_service_issuer: str = "quest-esports"
    quest_service_audience: str = "valorant-platform"
    service_token_max_skew_seconds: int = 30
```

Modify `.env.example` — after the `ADMIN_API_KEY=` block (line 44) add:

```
# Quest service-token (HMAC bearer) verification (integration delta D1).
# Format: "kid1=secret1,kid2=secret2" — kid selects the shared secret so
# rotation keeps a dual-key overlap window. Production requires at least one.
QUEST_SERVICE_SHARED_SECRETS=
QUEST_SERVICE_ISSUER=quest-esports
QUEST_SERVICE_AUDIENCE=valorant-platform
SERVICE_TOKEN_MAX_SKEW_SECONDS=30
```

- [ ] **Step 5: Add the `require_service_token` dependency**

Modify `app/api/dependencies.py`:

1. Add imports (top of file):
```python
import uuid

from app.api.service_token import (
    ServicePrincipal,
    ServiceTokenError,
    parse_secrets_map,
    verify_service_token,
)
```
2. Add a module constant next to `_ADMIN_AUTH_ERROR`:
```python
_SERVICE_AUTH_ERROR = {
    "error": {"code": "ADMIN_AUTH_REQUIRED", "message": "service token required"},
}
```
3. Add after `require_admin`:
```python
async def require_service_token(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_quest_actor_id: str | None = Header(default=None, alias="X-Quest-Actor-Id"),
    x_quest_operation_id: str | None = Header(default=None, alias="X-Quest-Operation-Id"),
) -> ServicePrincipal:
    """Gate every domain route with a signed Quest service token (delta D1).

    In ``local``/``test`` the gate is bypassed exactly like ``require_admin``
    today, and a synthetic principal is built from the optional
    ``X-Quest-Actor-Id``/``X-Quest-Operation-Id`` headers (test-only seam so
    audit persistence is exercisable without HMAC). In production the
    HMAC-SHA256 bearer token is validated (``kid`` -> secret, ``iss``/``aud``,
    ``exp``/``nbf`` with skew) and the claims are authoritative — FastAPI
    never trusts an unsigned header. A malformed secrets config (operator
    error) propagates as a 500 rather than silently allowing requests.
    """
    settings = get_settings()
    if settings.app_env in {"local", "test"}:
        return ServicePrincipal(
            actor_id=x_quest_actor_id,
            operation_id=x_quest_operation_id or str(uuid.uuid4()),
        )
    secrets = parse_secrets_map(settings.quest_service_shared_secrets)
    if not secrets:
        raise HTTPException(status_code=401, detail=_SERVICE_AUTH_ERROR)
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail=_SERVICE_AUTH_ERROR)
    try:
        return verify_service_token(
            authorization.removeprefix("Bearer "),
            secrets_by_kid=secrets,
            issuer=settings.quest_service_issuer,
            audience=settings.quest_service_audience,
            max_skew_seconds=settings.service_token_max_skew_seconds,
        )
    except ServiceTokenError as exc:
        raise HTTPException(status_code=401, detail=_SERVICE_AUTH_ERROR) from exc
```

- [ ] **Step 6: Run the unit test to verify it passes**

Run: `uv run pytest tests/unit/test_service_token.py -v`
Expected: PASS (16 passed).

- [ ] **Step 7: Commit**

```bash
git add app/api/service_token.py app/config.py app/api/dependencies.py .env.example tests/unit/test_service_token.py
git commit -m "feat: service-token auth module + require_service_token (D1)"
```

## Task 3: D1b — wire domain routes to `require_service_token` + update gate tests

**Spec anchors:** §4.4 D1, §6.3 (all domain routes protected in production; health unauthenticated; `X-Admin-Key` retained only for `/rankings/rebuild`), §11.2 (contract tests).

**Files:**
- Modify: `app/api/routes/teams.py`, `app/api/routes/series.py`, `app/api/routes/matches.py`, `app/api/routes/players.py`, `app/api/routes/match_search.py`, `app/api/routes/rankings.py`, `tests/unit/test_route_inventory.py`, `tests/integration/test_teams_api.py`, `tests/integration/test_finalization.py`, `tests/integration/test_match_import.py`, `tests/integration/test_player_resolve.py`, `tests/integration/test_match_discovery.py`, `tests/integration/test_preview_api.py`
- Create: `tests/token_helpers.py`

- [ ] **Step 1: Create the shared token helper**

Create `tests/token_helpers.py`:

```python
"""Shared helpers for production-env API tests that must authenticate as Quest.

Every domain route is service-token-gated in production (delta D1; spec §6.3).
These helpers build the exact settings shape and mint a valid HMAC bearer
header via the production signing code (``app.api.service_token``).
"""

from __future__ import annotations

import uuid

from app.api.service_token import sign_service_token
from app.config import Settings

TEST_SECRET = "test-secret"
TEST_KID = "kid-1"


def production_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "app_env": "production",
        "quest_service_shared_secrets": f"{TEST_KID}={TEST_SECRET}",
        "quest_service_issuer": "quest-esports",
        "quest_service_audience": "valorant-platform",
    }
    base.update(overrides)
    return Settings(**base)


def service_token_headers(
    *, sub: str = "actor-1", operation_id: str | None = None, ttl_seconds: int = 300
) -> dict[str, str]:
    token = sign_service_token(
        secret=TEST_SECRET,
        kid=TEST_KID,
        issuer="quest-esports",
        audience="valorant-platform",
        subject=sub,
        operation_id=operation_id or str(uuid.uuid4()),
        ttl_seconds=ttl_seconds,
    )
    return {"Authorization": f"Bearer {token}"}
```

- [ ] **Step 2: Rewire the route modules**

For each domain router, replace `Depends(require_admin)` with `Depends(require_service_token)` on **every** route (mutations AND reads — production protects all domain routes per §6.3) and update the import line. Concretely:

`app/api/routes/teams.py`:
- Import: `from app.api.dependencies import get_ranking_service, get_team_service, require_service_token`
- `create_team` (line 29), `update_team` (line 53): `dependencies=[Depends(require_service_token)]`
- `list_teams` (line 37), `get_team` (line 45), `team_rating_history` (line 62), `team_series` (line 72): add `dependencies=[Depends(require_service_token)]`

`app/api/routes/series.py`:
- Import: `from app.api.dependencies import get_rating_service, get_series_service, require_service_token`
- Every route decorator (`create_series`, `attach_game`, `remove_game`, `update_game`, `list_series`, `get_series`, `preview_series`, `finalize_series`, `delete_series`) carries `dependencies=[Depends(require_service_token)]`.

`app/api/routes/matches.py`:
- Import: `from app.api.dependencies import get_import_service, get_library_service, require_service_token`
- `import_match`, `list_matches`, `get_match_by_henrik_id`, `get_match`: all `dependencies=[Depends(require_service_token)]`.

`app/api/routes/players.py`:
- Import: `from app.api.dependencies import get_player_service, require_service_token`
- `resolve_player`, `get_player`, `get_player_by_puuid`: all `dependencies=[Depends(require_service_token)]`.

`app/api/routes/match_search.py`:
- Import: `from app.api.dependencies import get_discovery_service, require_service_token`
- Router-level `dependencies=[Depends(require_service_token)]`.

`app/api/routes/rankings.py`:
- Import: `from app.api.dependencies import get_ranking_service, get_rebuild_service, require_admin, require_service_token`
- `rankings_teams` (GET): `dependencies=[Depends(require_service_token)]`
- `rebuild_rankings` (POST): KEEP `dependencies=[Depends(require_admin)]` — the sole retained `X-Admin-Key` path (spec §6.3).

`GET /api/v1/health` (`app/api/routes/health.py`) stays unauthenticated — no change.

- [ ] **Step 3: Update the route-inventory guard test**

Modify `tests/unit/test_route_inventory.py`:

1. Import `require_service_token`:
```python
from app.api.dependencies import require_admin, require_service_token
```
2. Update the module docstring (lines 11–21) to describe the production service-token posture.
3. Replace `test_every_mutation_and_discovery_route_is_admin_gated` (lines 200–238) with:

```python
SERVICE_GATED_EXEMPT = {"/api/v1/health"}
ADMIN_ONLY_PATHS = {"/api/v1/rankings/rebuild"}


def test_every_domain_route_is_service_token_gated_except_health() -> None:
    """Production posture (spec §6.3): every /api/v1 route except ``/health``
    requires ``Depends(require_service_token)``; ``/rankings/rebuild`` keeps
    the ``X-Admin-Key`` gate for ops tooling; health stays unauthenticated."""
    routes = list(_api_routes())
    api_routes = [r for r in routes if r.path.startswith("/api/v1")]
    assert api_routes, "no /api/v1 routes found"
    for route in api_routes:
        deps = [getattr(dep, "dependency", None) for dep in (getattr(route, "dependencies", None) or [])]
        if route.path in SERVICE_GATED_EXEMPT:
            assert require_service_token not in deps, f"{route.path}: health must stay unauthenticated"
            assert require_admin not in deps
        elif route.path in ADMIN_ONLY_PATHS:
            assert require_admin in deps, f"{route.path}: rebuild must keep the admin-key gate"
            assert require_service_token not in deps
        else:
            assert require_service_token in deps, f"{route.path}: missing service-token gate"
            assert require_admin not in deps, f"{route.path}: must not carry the admin-key gate"
```

- [ ] **Step 4: Update the production-gate integration tests**

These run with `app_env="production"` and previously sent `X-Admin-Key`. Change each to use `tests/token_helpers.py`:

`tests/integration/test_teams_api.py`:
- Import at top: `from tests.token_helpers import production_settings, service_token_headers`
- `_app(...)`: replace the `get_settings` patch body with `lambda: production_settings(app_env=app_env)`.
- Replace `test_mutations_require_admin_in_production` with:

```python
async def test_mutations_require_service_token_in_production(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory, app_env="production")
    async with _client(app) as client:
        post = await client.post(BASE, json={"name": "Sneaky"})
        assert post.status_code == 401
        assert post.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"

        patch = await client.patch(f"{BASE}/00000000-0000-0000-0000-000000000099", json={"name": "X"})
        assert patch.status_code == 401

        ok = await client.post(BASE, json={"name": "Sneaky"}, headers=service_token_headers())
        assert ok.status_code == 201
```

- Replace `test_reads_public_in_production` with:

```python
async def test_reads_require_service_token_in_production(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory, app_env="production")
    async with _client(app) as client:
        listed = await client.get(BASE)
        assert listed.status_code == 401

        ok = await client.get(BASE, headers=service_token_headers())
        assert ok.status_code == 200
        assert ok.json() == []
```

`tests/integration/test_match_import.py` (production block around lines 395–455):
- Replace `lambda: Settings(app_env="production", admin_api_key="s3cret-key")` with `lambda: production_settings(app_env="production")`.
- Replace `headers={"X-Admin-Key": "s3cret-key"}` and `headers={"content-type": "application/json", "X-Admin-Key": "s3cret-key"}` with `headers=service_token_headers()` / `headers={"content-type": "application/json", **service_token_headers()}`. Status/error-code assertions stay identical.

`tests/integration/test_player_resolve.py` (lines ~253, ~265) and `tests/integration/test_match_discovery.py` (line ~289): replace the settings patch with `production_settings(app_env="production")` and the `X-Admin-Key` header with `service_token_headers()`.

`tests/integration/test_preview_api.py` (line ~411): the `app_env="production"` test sends an admin header on the mutation; replace with `service_token_headers()`.

`tests/integration/test_finalization.py::test_finalize_route_is_admin_gated_and_idempotent` (lines 824–875):
- Replace the settings patch with `lambda: production_settings(app_env="production")`.
- Replace `headers={"X-Admin-Key": "s3cret-key"}` with `headers=service_token_headers(sub="actor-7", operation_id="op-finalize")`.
- Keep the rest of the assertions. (This test is extended with audit assertions in Task 8.)

- [ ] **Step 5: Run the updated tests**

Run:
```
uv run pytest tests/unit/test_route_inventory.py tests/unit/test_admin_dependency.py tests/unit/test_service_token.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_teams_api.py tests/integration/test_match_import.py tests/integration/test_player_resolve.py tests/integration/test_match_discovery.py tests/integration/test_preview_api.py -q -m "not live"
```
Expected: all PASS. `tests/unit/test_admin_dependency.py` is unchanged — `require_admin` still exists for `/rankings/rebuild`.

- [ ] **Step 6: Run the full suite**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" -q`
Expected: PASS (gate tests and inventory updated together; in `test` env the gate bypasses, so nothing else changed behavior).

- [ ] **Step 7: Commit**

```bash
git add app/api/routes tests/token_helpers.py tests/unit/test_route_inventory.py
git commit -m "feat: wire domain routes to require_service_token (D1)"
```

---

## Task 4: D2 — teams create-or-get by `quest_saved_team_id`

**Spec anchors:** §4.4 D2, §5.1 (convergence by saved-team key), §8.1 (idempotent bind; 200 existing / 201 created).

**Files:**
- Modify: `app/db/repositories/team_repository.py`, `app/schemas/teams.py`, `app/services/team_service.py`, `app/api/routes/teams.py`, `tests/unit/test_team_service.py`, `tests/integration/test_teams_api.py`
- Test: `tests/unit/test_team_service.py`, `tests/integration/test_teams_api.py`

- [ ] **Step 1: Write the failing service test**

Append to `tests/unit/test_team_service.py` (the file has an in-memory `FakeSession`/repo harness — extend that harness with `get_by_quest_saved_team_id` returning the previously created team, then append):

```python
async def test_create_or_get_returns_existing_team_for_reused_key() -> None:
    svc = _service()
    first, created = await svc.create_or_get(
        TeamCreate(name="Sentinels", quest_saved_team_id="quest-team-1")
    )
    assert created is True
    assert first.quest_saved_team_id == "quest-team-1"

    second, created = await svc.create_or_get(
        TeamCreate(name="Sentinels", quest_saved_team_id="quest-team-1")
    )
    assert created is False
    assert second.id == first.id  # convergence by key, no new identity
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_team_service.py -q`
Expected: FAIL (`TeamCreate` rejects `quest_saved_team_id`; `create_or_get` missing; `TeamRepository.get_by_quest_saved_team_id` missing).

- [ ] **Step 3: Implement the schema/repo/service/route**

`app/schemas/teams.py`:
- Add to `TeamCreate` (after `logo_url`):
```python
    quest_saved_team_id: str | None = Field(default=None, max_length=64)
```
- Add to `TeamResponse` (after `slug`):
```python
    quest_saved_team_id: str | None = None
```

`app/db/repositories/team_repository.py`:
- Add after `get_by_id`:
```python
    async def get_by_quest_saved_team_id(self, quest_saved_team_id: str) -> Team | None:
        """The team converged on the Quest saved-team key (delta D2)."""
        result = await self._session.execute(
            select(Team).where(Team.quest_saved_team_id == quest_saved_team_id)
        )
        return result.scalar_one_or_none()
```
- Extend `create_team` with `quest_saved_team_id: str | None` and pass it into the `Team(...)` constructor.

`app/services/team_service.py`:
1. Add a violation helper next to `_is_slug_unique_violation`:
```python
def _is_quest_saved_team_unique_violation(exc: IntegrityError) -> bool:
    orig = exc.orig
    constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
    if not constraint:
        constraint = getattr(orig, "constraint_name", None)
    if not constraint:
        constraint = str(orig)
    return constraint == "teams_quest_saved_team_id_key" or "teams_quest_saved_team_id_key" in str(constraint)
```
2. Replace `create` with create-or-get (existing callers keep working):
```python
    async def create(self, req: TeamCreate) -> Team:
        team, _created = await self.create_or_get(req)
        return team

    async def create_or_get(self, req: TeamCreate) -> tuple[Team, bool]:
        """Create a team, or return the existing row keyed on
        ``quest_saved_team_id`` (200) when the key already converged (delta
        D2; spec §5.1/§8.1). ``current_elo``/``peak_elo`` start at 1000.
        """
        if req.quest_saved_team_id is not None:
            existing = await self._repo.get_by_quest_saved_team_id(req.quest_saved_team_id)
            if existing is not None:
                return existing, False
        try:
            team = await self._repo.create_team(
                name=req.name,
                short_name=req.short_name,
                slug=req.slug,
                logo_url=req.logo_url,
                seeding_elo=req.seeding_elo,
                current_elo=INITIAL_ELO,
                peak_elo=INITIAL_ELO,
                quest_saved_team_id=req.quest_saved_team_id,
            )
            await self._session.commit()
            return team, True
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_quest_saved_team_unique_violation(exc):
                existing = await self._repo.get_by_quest_saved_team_id(req.quest_saved_team_id)
                if existing is not None:
                    return existing, False
            if _is_slug_unique_violation(exc):
                raise AppError("TEAM_SLUG_TAKEN", 409, "team slug already taken") from exc
            raise
```

`app/api/routes/teams.py::create_team` — dual-status 201/200 (mirrors the import route's ADR-019 pattern), and add `quest_saved_team_id=team.quest_saved_team_id` to `_to_response`:
```python
@router.post(
    "",
    response_model=TeamResponse,
    status_code=201,
    dependencies=[Depends(require_service_token)],
    responses={200: {"model": TeamResponse, "description": "existing team keyed on quest_saved_team_id (created=false)"}},
)
async def create_team(
    req: TeamCreate,
    response: Response,
    svc: _TeamServiceDep,
) -> TeamResponse:
    team, created = await svc.create_or_get(req)
    if not created:
        response.status_code = 200
    return _to_response(team)
```
Add `from fastapi import Response` to the route imports.

- [ ] **Step 4: Add the API integration tests**

Append to `tests/integration/test_teams_api.py`:

```python
async def test_create_or_get_team_by_quest_saved_team_id(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        first = await client.post(BASE, json={"name": "Sentinels", "quest_saved_team_id": "quest-team-1"})
        assert first.status_code == 201
        body = first.json()
        assert body["quest_saved_team_id"] == "quest-team-1"

        second = await client.post(BASE, json={"name": "Sentinels", "quest_saved_team_id": "quest-team-1"})
        assert second.status_code == 200
        assert second.json()["id"] == body["id"]
        assert await _count(session_factory) == 1  # no duplicate identity

        third = await client.post(BASE, json={"name": "Fnatic", "quest_saved_team_id": "quest-team-2"})
        assert third.status_code == 201
        assert await _count(session_factory) == 2


async def test_create_or_get_converges_on_pre_seeded_key(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with session_factory() as session:
        session.add(Team(name="PreSeeded", quest_saved_team_id="quest-team-9"))
        await session.commit()
    async with _client(app) as client:
        resp = await client.post(BASE, json={"name": "PreSeeded", "quest_saved_team_id": "quest-team-9"})
        assert resp.status_code == 200
        assert await _count(session_factory) == 1
```

- [ ] **Step 5: Run and verify**

Run:
```
uv run pytest tests/unit/test_team_service.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_teams_api.py -q -m "not live"
```
Expected: PASS (new tests green; existing create/list/update tests unaffected — `quest_saved_team_id` is optional).

- [ ] **Step 6: Commit**

```bash
git add app/schemas/teams.py app/db/repositories/team_repository.py app/services/team_service.py app/api/routes/teams.py tests/unit/test_team_service.py tests/integration/test_teams_api.py
git commit -m "feat: teams create-or-get by quest_saved_team_id (D2)"
```

---

## Task 5: D3 — series create-or-get by `external_quest_series_id`

**Spec anchors:** §4.4 D3, §5.3 (create with `external_quest_series_id`), §8.1 (same key returns the existing series).

**Files:**
- Modify: `app/db/repositories/series_repository.py`, `app/schemas/series.py`, `app/services/series_service.py`, `app/api/routes/series.py`, `tests/unit/test_series_service.py`, `tests/integration/test_series_api.py`
- Test: `tests/unit/test_series_service.py`, `tests/integration/test_series_api.py`

- [ ] **Step 1: Write the failing service test**

Append to `tests/unit/test_series_service.py` (the file has an in-memory repo harness — add `get_by_external_quest_series_id` to the mirror, returning the previously created series when the key matches, then append):

```python
async def test_create_or_get_returns_existing_series_for_reused_external_key() -> None:
    team_a, team_b = _team("Alpha"), _team("Beta")
    svc = _service(team_a, team_b)
    req = SeriesCreate(
        team_a_id=team_a.id,
        team_b_id=team_b.id,
        format="bo3",
        importance="regular",
        external_quest_series_id="quest-series-1",
    )
    first, created = await svc.create_or_get(req)
    assert created is True
    assert first.external_quest_series_id == "quest-series-1"

    second, created = await svc.create_or_get(req)
    assert created is False
    assert second.id == first.id  # convergence by external key
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_series_service.py -q`
Expected: FAIL (`SeriesCreate` rejects `external_quest_series_id`; `create_or_get` missing; repo mirror lacks the lookup).

- [ ] **Step 3: Implement schema/repo/service/route**

`app/schemas/series.py` — add to `SeriesCreate`:
```python
    external_quest_series_id: str | None = Field(default=None, max_length=64)
```
Add to `SeriesView` (Quest reconciliation reads it, spec §8.3):
```python
    external_quest_series_id: str | None = None
```

`app/db/repositories/series_repository.py`:
- Add after `get_by_id`:
```python
    async def get_by_external_quest_series_id(self, external_quest_series_id: str) -> Series | None:
        """The series converged on the Quest external key (delta D3)."""
        result = await self._session.execute(
            select(Series).where(Series.external_quest_series_id == external_quest_series_id)
        )
        return result.scalar_one_or_none()
```
- Extend `create_series` with `external_quest_series_id: str | None` and pass it to the `Series(...)` constructor.

`app/services/series_service.py`:
1. Replace `create` with create-or-get delegation and add the new method (existing callers keep working — they pass no external key):
```python
    async def create(self, req: SeriesCreate) -> Series:
        series, _created = await self.create_or_get(req)
        return series

    async def create_or_get(self, req: SeriesCreate) -> tuple[Series, bool]:
        """Create a draft series, or return the existing row keyed on
        ``external_quest_series_id`` (200) when the key already converged
        (delta D3; spec §8.1). Team equality, FK, and anchor rules apply only
        to the create path — a retry with the same key converges.
        """
        if req.external_quest_series_id is not None:
            existing = await self._series_repo.get_by_external_quest_series_id(req.external_quest_series_id)
            if existing is not None:
                return existing, False
        if req.team_a_id == req.team_b_id:
            raise AppError("SERIES_INVALID", 409, "team_a_id must differ from team_b_id")
        try:
            series = await self._series_repo.create_series(
                team_a_id=req.team_a_id,
                team_b_id=req.team_b_id,
                format=req.format,
                importance=req.importance,
                played_at=req.played_at,
                notes=req.notes,
                external_quest_series_id=req.external_quest_series_id,
            )
            await self._session.commit()
            return series, True
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_external_series_key_violation(exc):
                existing = await self._series_repo.get_by_external_quest_series_id(req.external_quest_series_id)
                if existing is not None:
                    return existing, False
            if _is_team_fk_violation(exc):
                raise AppError("TEAM_NOT_FOUND", 404, "team not found") from exc
            raise
```
2. Add the violation helper next to `_is_team_fk_violation`:
```python
def _is_external_series_key_violation(exc: IntegrityError) -> bool:
    constraint, raw = _constraint_name(exc)
    return constraint == "series_external_quest_series_id_key" or "series_external_quest_series_id_key" in raw
```

`app/api/routes/series.py::create_series` — dual-status 201/200:
```python
@router.post(
    "",
    response_model=SeriesView,
    status_code=201,
    dependencies=[Depends(require_service_token)],
    responses={200: {"model": SeriesView, "description": "existing series keyed on external_quest_series_id (created=false)"}},
)
async def create_series(
    req: SeriesCreate,
    response: Response,
    svc: _SeriesServiceDep,
) -> SeriesView:
    series, created = await svc.create_or_get(req)
    if not created:
        response.status_code = 200
    return await _view_for(svc, series)
```
Add `from fastapi import Response` to the route imports; add `external_quest_series_id=series.external_quest_series_id` to `_to_series_view`.

- [ ] **Step 4: Add the API integration test**

Append to `tests/integration/test_series_api.py`:

```python
async def test_create_or_get_series_by_external_quest_series_id(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with _client(app) as client:
        body = {
            "team_a_id": str(team_a_id),
            "team_b_id": str(team_b_id),
            "format": "bo3",
            "importance": "regular",
            "external_quest_series_id": "quest-series-1",
        }
        first = await client.post(f"{BASE}", json=body)
        assert first.status_code == 201
        series_id = first.json()["id"]
        assert first.json()["external_quest_series_id"] == "quest-series-1"

        second = await client.post(f"{BASE}", json=body)
        assert second.status_code == 200
        assert second.json()["id"] == series_id
```

- [ ] **Step 5: Run and verify**

Run:
```
uv run pytest tests/unit/test_series_service.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_series_api.py tests/integration/test_preview_api.py -q -m "not live"
```
Expected: PASS (existing series/preview tests unaffected; the created flag only flips when a key is reused).

- [ ] **Step 6: Commit**

```bash
git add app/schemas/series.py app/db/repositories/series_repository.py app/services/series_service.py app/api/routes/series.py tests/unit/test_series_service.py tests/integration/test_series_api.py
git commit -m "feat: series create-or-get by external_quest_series_id (D3)"
```

## Task 6: D4 `unrated` mode + D5 reason-required for forfeit/override modes

**Spec anchors:** §4.4 D4 (unrated ⇒ no ELO AND no win/loss/matches counters, distinct from `forfeit_result_only`), §4.4 D5 (reason required for `manual_override`/`forfeit_no_rating`/`forfeit_result_only` even when official == calculated), §5.6 (policy table).

**Files:**
- Modify: `app/domain/ratings/policy.py`, `app/schemas/series.py`, `app/services/rating_service.py`, `tests/unit/test_rating_policy.py`, `tests/integration/test_finalize_policy.py`, `tests/integration/test_finalization.py`
- Test: `tests/unit/test_rating_policy.py`, `tests/integration/test_finalize_policy.py`, `tests/integration/test_finalization.py`

- [ ] **Step 1: Write the failing policy tests**

Append to `tests/unit/test_rating_policy.py`:

```python
def test_rating_modes_include_unrated() -> None:
    assert "unrated" in RATING_MODES


def test_unrated_never_rates_and_never_counts() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_A,
        calculated_winner_id=TEAM_A,
        override_reason=None,
        explicit_mode="unrated",
    )
    assert decision.mode == "unrated"
    assert decision.rate_series is False


def test_unrated_requires_no_reason() -> None:
    decision = resolve_rating_policy(
        official_winner_id=TEAM_A,
        calculated_winner_id=TEAM_A,
        override_reason=None,
        explicit_mode="unrated",
    )
    assert decision.override_reason is None


def test_forfeit_modes_require_reason_even_when_official_equals_calculated() -> None:
    # D5: official == calculated still demands a reason for forfeit/override modes.
    for mode in ("manual_override", "forfeit_no_rating", "forfeit_result_only"):
        with pytest.raises(RatingPolicyRequiredError):
            resolve_rating_policy(
                official_winner_id=TEAM_A,
                calculated_winner_id=TEAM_A,
                override_reason=None,
                explicit_mode=mode,  # type: ignore[arg-type]
            )
        with pytest.raises(RatingPolicyRequiredError):
            resolve_rating_policy(
                official_winner_id=TEAM_A,
                calculated_winner_id=TEAM_A,
                override_reason="   ",
                explicit_mode=mode,  # type: ignore[arg-type]
            )


def test_blank_reason_rejected_for_forfeit_mode_even_with_override() -> None:
    with pytest.raises(RatingPolicyRequiredError):
        resolve_rating_policy(
            official_winner_id=TEAM_B,
            calculated_winner_id=TEAM_A,
            override_reason="\t\n ",
            explicit_mode="forfeit_result_only",
        )
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_rating_policy.py -q`
Expected: FAIL (three ways: `RATING_MODES` lacks `unrated`; `explicit_mode="unrated"` raises `ValueError: unknown rating mode`; forfeit modes with official==calculated do not raise).

- [ ] **Step 3: Implement policy + schema + service changes**

`app/domain/ratings/policy.py`:
1. `RATING_MODES` → `("normal", "unrated", "forfeit_no_rating", "forfeit_result_only", "manual_override")`
2. Add a public reason helper (the D6 anchor-waiver check reuses it):
```python
def is_non_empty(value: str | None) -> bool:
    """True for a non-whitespace, non-empty string (public: used by the
    anchor-waiver check in ``rating_service`` too)."""
    return value is not None and value.strip() != ""
```
3. Add the D5 constant and gate at the top of `resolve_rating_policy` (right after the unknown-mode check):
```python
# D5 (spec §4.4): these modes require a non-empty reason whenever they are
# SELECTED — even when the official winner equals the calculated winner.
_REASON_REQUIRED_MODES = frozenset({"manual_override", "forfeit_no_rating", "forfeit_result_only"})
```
```python
    if explicit_mode in _REASON_REQUIRED_MODES and not is_non_empty(override_reason):
        raise RatingPolicyRequiredError(f"{explicit_mode} requires a non-empty override reason")
```
4. Update the module docstring to mention D4 (`unrated`) and D5.

`app/schemas/series.py` — `RatingMode = Literal["normal", "unrated", "forfeit_no_rating", "forfeit_result_only", "manual_override"]` and update the sync comment.

`app/services/rating_service.py` — `apply_rating_policy`: the `unrated` mode falls into the existing `not decision.rate_series` branch. It is NOT `forfeit_result_only`, so it records nothing (no ELO, no counters). No code change needed; add a comment to that branch: `# ``unrated``/``forfeit_no_rating``: no ELO, no counters; ``forfeit_result_only``: counters only (D4).`

- [ ] **Step 4: Update the pinned-mode tests**

In `tests/unit/test_rating_policy.py`:
- Replace `test_rating_modes_are_exactly_the_locked_modes` with:
```python
def test_rating_modes_are_exactly_the_locked_modes() -> None:
    assert RATING_MODES == (
        "normal",
        "unrated",
        "forfeit_no_rating",
        "forfeit_result_only",
        "manual_override",
    )
```
- Update `test_official_none_with_explicit_forfeit_mode_defaults_and_honors` (it passes `override_reason=None` with `explicit_mode="forfeit_result_only"`, which D5 now rejects) to pass a reason:
```python
def test_official_none_with_explicit_forfeit_mode_defaults_and_honors() -> None:
    decision = resolve_rating_policy(
        official_winner_id=None,
        calculated_winner_id=TEAM_A,
        override_reason="declared after play",
        explicit_mode="forfeit_result_only",
    )
    assert decision.official_winner_id == TEAM_A
    assert decision.mode == "forfeit_result_only"
    assert decision.rate_series is False
```

- [ ] **Step 5: Add the integration policy tests**

Append to `tests/integration/test_finalize_policy.py`:

```python
async def test_finalize_policy_unrated_mode_is_explicit(session_factory) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")
    await _attach(session_factory, series_id, matches["m1"].id, 1)

    decision = await _resolve(
        session_factory, series_id, FinalizeRequest(rating_mode="unrated")  # type: ignore[arg-type]
    )

    assert decision.mode == "unrated"
    assert decision.rate_series is False


async def test_finalize_policy_forfeit_without_reason_is_rejected_even_when_official_equals_calculated(
    session_factory,
) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")
    await _attach(session_factory, series_id, matches["m1"].id, 1)

    try:
        await _resolve(
            session_factory,
            series_id,
            FinalizeRequest(
                official_winner_id=team_a_id, rating_mode="forfeit_result_only"  # type: ignore[arg-type]
            ),
        )
    except Exception as exc:  # noqa: BLE001
        assert getattr(exc, "code", None) == "RATING_POLICY_REQUIRED"
        assert getattr(exc, "status", None) == 409
    else:
        pytest.fail("expected RATING_POLICY_REQUIRED")
```

- [ ] **Step 6: Add the finalize behavioral test (unrated ⇒ no events, no counters)**

Append to `tests/integration/test_finalization.py` (mirrors `test_forfeit_finalize_persists_distinct_rating_mode`):

```python
async def test_unrated_finalize_writes_no_events_and_no_counters(session_factory) -> None:
    team_a_id, team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, format_="bo1", winners=["A"], offset=30
    )
    result = await _finalize(
        session_factory,
        series_id,
        FinalizeRequest(rating_mode="unrated"),  # type: ignore[arg-type]
    )

    assert result.rating_mode == "unrated"
    assert result.events == []
    series = await _series_row(session_factory, series_id)
    assert series.rating_mode == "unrated"
    assert series.status == "finalized"
    team_a = await _team_row(session_factory, team_a_id)
    team_b = await _team_row(session_factory, team_b_id)
    # D4: NO win/loss/matches counters and no ELO change — distinct from
    # ``forfeit_result_only`` which updates counters.
    assert team_a.series_wins == 0 and team_a.series_losses == 0
    assert team_b.series_wins == 0 and team_b.series_losses == 0
    assert team_a.matches_played == 0 and team_b.matches_played == 0
    assert team_a.current_elo == Decimal(1000) and team_b.current_elo == Decimal(1000)
```

- [ ] **Step 7: Run and verify**

Run:
```
uv run pytest tests/unit/test_rating_policy.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_finalize_policy.py tests/integration/test_finalization.py -q -m "not live"
```
Expected: PASS. Existing forfeit-mode tests already pass reasons, so they remain green; the DB CHECK already accepts `unrated` (Task 1).

- [ ] **Step 8: Commit**

```bash
git add app/domain/ratings/policy.py app/schemas/series.py app/services/rating_service.py tests/unit/test_rating_policy.py tests/integration/test_finalize_policy.py tests/integration/test_finalization.py
git commit -m "feat: unrated rating mode + reason-required forfeit/override modes (D4/D5)"
```

---

## Task 7: D6 — anchor persistence at create + anchor verification at rated finalize

**Spec anchors:** §4.4 D6, §5.3 (anchors carried into create), §5.5 (verification for rated modes; `ANCHOR_MISMATCH` 409; audited override waiver), §11.4 step 8.

**Files:**
- Create: `app/domain/series/anchor.py`, `tests/unit/test_anchor.py`, `tests/integration/test_anchor_verification.py`
- Modify: `app/services/player_service.py`, `app/services/series_service.py`, `app/services/rating_service.py`, `app/db/repositories/match_repository.py`, `app/db/repositories/series_repository.py`, `app/schemas/series.py`, `app/api/dependencies.py`, `tests/unit/test_rating_service.py`, `tests/unit/test_series_service.py`, `tests/integration/test_finalization.py` (helpers gain anchors; `test_rankings_api.py` inherits them)

**Anchor fixture facts:** `tests/fixtures/henrik/match_detail_v4/completed_custom.json` has exactly two players — `PlayerA#A` on Red (`puuid_p_a`) and `PlayerB#B` on Blue (`puuid_p_b`). Match import persists `match_players.puuid_snapshot`/`side`. After import, `players` rows exist with `current_name`/`current_tag` = `PlayerA`/`A` and `PlayerB`/`B`, so anchor resolution via the player cache needs no network.

- [ ] **Step 1: Write the failing pure-helper unit tests**

Create `tests/unit/test_anchor.py`:

```python
"""Pure anchor-verification unit tests (spec §4.4 D6)."""

from __future__ import annotations

import uuid

from app.domain.series.anchor import verify_opposing_anchors

M1 = uuid.UUID("10000000-0000-0000-0000-000000000001")
M2 = uuid.UUID("10000000-0000-0000-0000-000000000002")
A, B = "puuid_a", "puuid_b"


def test_opposing_anchors_pass() -> None:
    sides = {M1: {A: "red", B: "blue"}, M2: {A: "blue", B: "red"}}
    assert verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1, M2], sides_by_match=sides) == []


def test_missing_anchor_a_fails() -> None:
    sides = {M1: {B: "blue"}}
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1], sides_by_match=sides)
    assert len(errors) == 1
    assert "anchor A" in errors[0]


def test_missing_anchor_b_fails() -> None:
    sides = {M1: {A: "red"}}
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1], sides_by_match=sides)
    assert any("anchor B" in e for e in errors)


def test_same_side_fails() -> None:
    sides = {M1: {A: "red", B: "red"}}
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1], sides_by_match=sides)
    assert any("opposing sides" in e for e in errors)


def test_game_with_no_data_fails_for_both_anchors() -> None:
    errors = verify_opposing_anchors(anchor_a=A, anchor_b=B, match_ids=[M1, M2], sides_by_match={})
    assert len(errors) == 4
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_anchor.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.domain.series.anchor'`).

- [ ] **Step 3: Implement the pure helper**

Create `app/domain/series/anchor.py`:

```python
"""Anchor identity verification (spec §4.4 D6, §5.5). Pure, no I/O.

For rated finalization both anchor PUUIDs must appear in ``match_players`` on
OPPOSING sides of every attached game. Failure is 409 ``ANCHOR_MISMATCH``
unless the admin supplies an explicit ``override_reason`` + explicit rated
mode (the audited override path, enforced in ``rating_service``).
"""

from __future__ import annotations

import uuid


def verify_opposing_anchors(
    *,
    anchor_a: str,
    anchor_b: str,
    match_ids: list[uuid.UUID],
    sides_by_match: dict[uuid.UUID, dict[str, str]],
) -> list[str]:
    """Return per-game verification errors (empty == verified).

    ``sides_by_match`` maps ``match_id -> {puuid: side}`` for the two anchors
    only (the caller pre-filters by the anchor puuids). A game missing from
    the map carries neither anchor.
    """
    errors: list[str] = []
    for match_id in match_ids:
        sides = sides_by_match.get(match_id, {})
        side_a = sides.get(anchor_a)
        side_b = sides.get(anchor_b)
        if side_a is None:
            errors.append(f"game {match_id}: anchor A not found on either side")
        if side_b is None:
            errors.append(f"game {match_id}: anchor B not found on either side")
        if side_a is not None and side_b is not None and side_a == side_b:
            errors.append(f"game {match_id}: anchors are not on opposing sides")
    return errors
```

- [ ] **Step 4: Refactor `PlayerService` for uncommitted resolution**

Modify `app/services/player_service.py` — split `resolve` into a non-committing variant the series-create path can share:

```python
    async def resolve(self, name: str, tag: str, *, force: bool = False) -> Player:
        player = await self.resolve_uncommitted(name, tag, force=force)
        await self._session.commit()
        return player

    async def resolve_uncommitted(self, name: str, tag: str, *, force: bool = False) -> Player:
        """Resolve a Riot ID without committing (caller owns the transaction).

        Same cache-then-Henrik semantics as ``resolve``; the series-create
        path uses this so anchor resolution commits atomically with the series
        row instead of splitting the transaction boundary.
        """
        name, tag = _normalize_identity(name, tag)
        if not force:
            cached = await self._repo.get_by_name_tag(name, tag)
            if cached is not None:
                return cached
        try:
            account = await self._henrik.get_account(name, tag, force=force)
            if not account.puuid:
                raise HenrikProtocolError("henrik account resolved without a puuid")
        except HenrikError as exc:
            raise _translate_henrik_error(exc) from exc
        return await self._repo.upsert_by_puuid(
            puuid=account.puuid,
            current_name=account.name,
            current_tag=account.tag,
            affinity=account.region,
            platforms=account.platforms,
            henrik_updated_at=account.updated_at,
        )
```

- [ ] **Step 5: Wire anchor resolution into series create**

`app/schemas/series.py` — add `from app.schemas.match_search import PlayerRef` and add to `SeriesCreate`:
```python
    anchor_player_a: PlayerRef | None = None
    anchor_player_b: PlayerRef | None = None
```

`app/services/series_service.py`:
1. Constructor:
```python
    def __init__(
        self,
        session: AsyncSession,
        series_repo: SeriesRepository,
        match_repo: MatchRepository,
        player_svc: PlayerService | None = None,
    ) -> None:
        self._session = session
        self._series_repo = series_repo
        self._match_repo = match_repo
        self._player_svc = player_svc
```
(add `from app.services.player_service import PlayerService`.)
2. Extend `create_or_get` (after the team-equality check, before the `try:`):
```python
        anchor_a_puuid: str | None = None
        anchor_b_puuid: str | None = None
        if req.anchor_player_a is not None or req.anchor_player_b is not None:
            if self._player_svc is None:
                raise AppError("SERIES_INVALID", 409, "anchor resolution is not configured")
            if req.anchor_player_a is None or req.anchor_player_b is None:
                raise AppError("SERIES_INVALID", 409, "both anchors are required together")
            anchor_a_puuid = (
                await self._player_svc.resolve_uncommitted(req.anchor_player_a.name, req.anchor_player_a.tag)
            ).puuid
            anchor_b_puuid = (
                await self._player_svc.resolve_uncommitted(req.anchor_player_b.name, req.anchor_player_b.tag)
            ).puuid
```
and pass `anchor_a_puuid=anchor_a_puuid, anchor_b_puuid=anchor_b_puuid` to `self._series_repo.create_series(...)`.

`app/db/repositories/series_repository.py::create_series` — add params `anchor_a_puuid: str | None, anchor_b_puuid: str | None` and pass them into the `Series(...)` constructor.

`app/api/dependencies.py::get_series_service` — inject the player service:
```python
async def get_series_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    henrik: Annotated[HenrikClient, Depends(get_henrik_client)],
) -> SeriesService:
    """Request-scoped ``SeriesService``; anchors resolve through the player
    service (cache-first, Henrik on miss) and persist with the create txn."""
    return SeriesService(
        session=session,
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
        player_svc=PlayerService(session=session, henrik=henrik, repo=PlayerRepository(session)),
    )
```

- [ ] **Step 6: Add the anchor-sides query + wire rating service**

`app/db/repositories/match_repository.py` — add after `get_players_for_match`:
```python
    async def get_anchor_player_sides(
        self, match_ids: list[uuid.UUID], anchor_a: str, anchor_b: str
    ) -> dict[uuid.UUID, dict[str, str]]:
        """``{match_id: {puuid: side}}`` for the two anchors among the matches.

        Pre-filtered to the two anchor puuids — the only rows the anchor
        verification reads (spec §5.5).
        """
        if not match_ids:
            return {}
        result = await self._session.execute(
            select(MatchPlayer.match_id, MatchPlayer.puuid_snapshot, MatchPlayer.side).where(
                MatchPlayer.match_id.in_(match_ids),
                MatchPlayer.puuid_snapshot.in_((anchor_a, anchor_b)),
            )
        )
        sides: dict[uuid.UUID, dict[str, str]] = {}
        for match_id, puuid, side in result:
            sides.setdefault(match_id, {})[puuid] = side
        return sides
```

`app/services/rating_service.py`:
1. Add imports:
```python
from app.db.repositories.match_repository import MatchRepository
from app.domain.series.anchor import verify_opposing_anchors
from app.domain.ratings.policy import is_non_empty
```
2. Constructor gains the match repo:
```python
    def __init__(
        self,
        session: AsyncSession,
        series_repo: SeriesRepository,
        rating_repo: RatingRepository,
        match_repo: MatchRepository | None = None,
    ) -> None:
        self._session = session
        self._series_repo = series_repo
        self._rating_repo = rating_repo
        self._match_repo = match_repo
```
3. Add `_RATED_MODES = frozenset({"normal", "manual_override"})` next to `_IMPORTANCE_MULTIPLIERS`.
4. In `_finalize_locked`, after the policy-resolution block (after the `decision.official_winner_id not in (team_a.id, team_b.id)` check) and before `_apply_rating_policy`, insert the D6 verification:
```python
        # 5b. Delta D6 (spec §5.5): rated modes require both anchor PUUIDs on
        #     OPPOSING sides of every attached game. Failure is 409
        #     ANCHOR_MISMATCH unless the admin supplied an explicit rated mode
        #     AND a non-empty override reason (the audited override path).
        if decision.mode in _RATED_MODES:
            anchor_errors = await self._anchor_errors(series, canonical_games)
            if anchor_errors:
                waiver = req.rating_mode in _RATED_MODES and is_non_empty(req.override_reason)
                if not waiver:
                    raise AppError("ANCHOR_MISMATCH", 409, "; ".join(anchor_errors))
```
5. Add the helper method:
```python
    async def _anchor_errors(self, series: Series, canonical_games: list) -> list[str]:
        """Per-game anchor verification errors for the attached games."""
        if self._match_repo is None:
            return ["anchor verification is not configured"]
        if series.anchor_a_puuid is None or series.anchor_b_puuid is None:
            return ["series has no anchor identities; rated finalization requires anchors"]
        match_ids = [game.match_id for game in canonical_games]
        sides = await self._match_repo.get_anchor_player_sides(
            match_ids, series.anchor_a_puuid, series.anchor_b_puuid
        )
        return verify_opposing_anchors(
            anchor_a=series.anchor_a_puuid,
            anchor_b=series.anchor_b_puuid,
            match_ids=match_ids,
            sides_by_match=sides,
        )
```

`app/api/dependencies.py::get_rating_service` — inject the match repo:
```python
async def get_rating_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RatingService:
    return RatingService(
        session=session,
        series_repo=SeriesRepository(session),
        rating_repo=RatingRepository(session),
        match_repo=MatchRepository(session),
    )
```

- [ ] **Step 7: Update the existing finalize tests to carry anchors**

`tests/integration/test_finalization.py`:
1. Add a stub Henrik that never reaches the network:
```python
class _NoNetworkHenrik:
    async def get_account(self, *args, **kwargs):
        raise AssertionError("test anchor resolution must hit the player cache")
```
2. `_series_service(session)`:
```python
def _series_service(session) -> SeriesService:
    return SeriesService(
        session=session,
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
        player_svc=PlayerService(session=session, henrik=_NoNetworkHenrik(), repo=PlayerRepository(session)),  # type: ignore[arg-type]
    )
```
(add imports `from app.db.repositories.player_repository import PlayerRepository` and `from app.services.player_service import PlayerService`.)
3. `_create_series(...)`: pass the two fixture anchors:
```python
        series = await svc.create(
            SeriesCreate(
                team_a_id=team_a_id,
                team_b_id=team_b_id,
                format=format_,
                importance="regular",
                played_at=played_at,
                anchor_player_a={"name": "PlayerA", "tag": "A"},
                anchor_player_b={"name": "PlayerB", "tag": "B"},
            )
        )
```
The players exist in `players` (cached from `_seed_matches`), so `resolve_uncommitted` never calls Henrik.

`tests/unit/test_rating_service.py` (in-memory harness):
1. `MemSeries` gains `anchor_a_puuid: str | None = "puuid_a"` and `anchor_b_puuid: str | None = "puuid_b"` (defaults keep every existing rated test green once the match-repo mirror provides opposing sides).
2. `Store` gains `anchor_sides: dict[uuid.UUID, dict[str, str]]`; `_scenario` populates it per game as `{match.id: {"puuid_a": "red", "puuid_b": "blue"}}` and gains a `scenario_anchor_sides` override parameter for negative tests.
3. Add an in-memory match-repo mirror and pass it to `RatingService`:
```python
class InMemoryMatchRepository:
    """Mirrors ``MatchRepository.get_anchor_player_sides`` (the only match-repo
    method ``RatingService`` calls)."""

    def __init__(self, store: Store) -> None:
        self._store = store

    async def get_anchor_player_sides(
        self, match_ids: list[uuid.UUID], anchor_a: str, anchor_b: str
    ) -> dict[uuid.UUID, dict[str, str]]:
        out: dict[uuid.UUID, dict[str, str]] = {}
        for match_id in match_ids:
            sides = self._store.anchor_sides.get(match_id, {})
            selected = {p: s for p, s in sides.items() if p in (anchor_a, anchor_b)}
            if selected:
                out[match_id] = selected
        return out
```
`_service(...)`: add `match_repo=InMemoryMatchRepository(store)` to the `RatingService(...)` call.
4. Add unit tests:
```python
async def test_rated_finalize_without_anchors_raises_anchor_mismatch() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]))
    store.series.anchor_a_puuid = None
    store.series.anchor_b_puuid = None
    svc, _session = _service(store)
    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())
    assert excinfo.value.code == "ANCHOR_MISMATCH"
    assert excinfo.value.status == 409


async def test_rated_finalize_same_side_anchors_raises_anchor_mismatch() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]))
    match_id = next(iter(store.anchor_sides))
    store.anchor_sides[match_id] = {"puuid_a": "red", "puuid_b": "red"}
    svc, _session = _service(store)
    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())
    assert excinfo.value.code == "ANCHOR_MISMATCH"


async def test_anchor_mismatch_waived_by_explicit_rated_mode_and_reason() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]))
    match_id = next(iter(store.anchor_sides))
    store.anchor_sides[match_id] = {"puuid_a": "red", "puuid_b": "red"}
    svc, _session = _service(store)
    result = await svc.finalize(
        store.series.id,
        FinalizeRequest(rating_mode="manual_override", override_reason="audited override"),
    )
    assert result.status == "finalized"
    assert result.rating_mode == "manual_override"


async def test_unrated_finalize_skips_anchor_verification() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]))
    store.series.anchor_a_puuid = None
    store.series.anchor_b_puuid = None
    svc, _session = _service(store)
    result = await svc.finalize(
        store.series.id,
        FinalizeRequest(rating_mode="unrated"),  # type: ignore[arg-type]
    )
    assert result.status == "finalized"
    assert result.events == []
```

- [ ] **Step 8: Add the anchor-verification integration test**

Create `tests/integration/test_anchor_verification.py`:

```python
"""Real-Postgres anchor verification integration tests (spec §4.4 D6, §5.5).

Rated finalization requires both anchor PUUIDs on opposing sides of every
attached game (read from ``match_players``); failure is 409 ``ANCHOR_MISMATCH``
unless the admin supplies an explicit rated mode + non-empty override_reason
(the audited override path). Unrated/forfeit modes skip verification. Skipped
when ``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import json
import uuid
from copy import deepcopy
from pathlib import Path

import pytest
from sqlalchemy import text

from app.api.errors import AppError
from app.db.models import Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.integrations.henrik.mapper import HenrikMapper
from app.schemas.matches import MatchDetailResponse
from app.schemas.series import AttachGameRequest, FinalizeRequest, SeriesCreate
from app.services.match_import_service import MatchImportService
from app.services.player_service import PlayerService
from app.services.rating_service import RatingService
from app.services.series_service import SeriesService

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"

_ID = "00000000-0000-0000-0000-0000000000%s"


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _completed_variant(henrik_match_id: str, *, red_wins: bool, map_name: str) -> dict:
    fixture = deepcopy(_load("completed_custom.json"))
    data = fixture["data"]
    data["metadata"]["match_id"] = henrik_match_id
    data["metadata"]["map"]["name"] = map_name
    red, blue = data["teams"]
    red["rounds"]["won"], red["rounds"]["lost"] = (13, 9) if red_wins else (9, 13)
    blue["rounds"]["won"], blue["rounds"]["lost"] = (9, 13) if red_wins else (13, 9)
    red["won"], blue["won"] = red_wins, not red_wins
    return fixture


class FakeHenrik:
    """Serves pinned match-detail fixtures through the real mapper."""

    def __init__(self, fixtures: dict[str, dict]) -> None:
        self.fixtures = fixtures
        self._mapper = HenrikMapper()

    async def get_match_detail(self, match_id: str, *, affinity: str):
        envelope = self.fixtures[match_id]
        from app.integrations.henrik.models import HenrikMatchDetailEnvelope

        return HenrikMatchDetailEnvelope(
            status=envelope["status"],
            data=self._mapper.to_match_detail(envelope["data"]),
            raw=envelope,
        )


class _NoNetworkHenrik:
    async def get_account(self, *args, **kwargs):
        raise AssertionError("anchor resolution must hit the player cache")


async def _seed_match(session, henrik_match_id: str, fixture: dict) -> MatchDetailResponse:
    service = MatchImportService(
        session=session,
        henrik=FakeHenrik({henrik_match_id: fixture}),  # type: ignore[arg-type]
        player_repo=PlayerRepository(session),
        match_repo=MatchRepository(session),
        mapper=HenrikMapper(),
    )
    result = await service.import_match(henrik_match_id, "eu")
    return result.match


def _series_service(session) -> SeriesService:
    return SeriesService(
        session=session,
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
        player_svc=PlayerService(session=session, henrik=_NoNetworkHenrik(), repo=PlayerRepository(session)),  # type: ignore[arg-type]
    )


def _rating_service(session) -> RatingService:
    return RatingService(
        session=session,
        series_repo=SeriesRepository(session),
        rating_repo=RatingRepository(session),
        match_repo=MatchRepository(session),
    )


async def _seed_scenario(session_factory, *, offset: int = 0) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    async with session_factory() as session:
        alpha = Team(name="Alpha")
        beta = Team(name="Beta")
        session.add_all([alpha, beta])
        await session.commit()
        team_a_id, team_b_id = alpha.id, beta.id
    henrik_id = _ID % f"{1 + offset:02x}"
    async with session_factory() as session:
        match = await _seed_match(session, henrik_id, _completed_variant(henrik_id, red_wins=True, map_name="Ascent"))
    async with session_factory() as session:
        svc = _series_service(session)
        series = await svc.create(
            SeriesCreate(
                team_a_id=team_a_id,
                team_b_id=team_b_id,
                format="bo1",
                importance="regular",
                anchor_player_a={"name": "PlayerA", "tag": "A"},
                anchor_player_b={"name": "PlayerB", "tag": "B"},
            )
        )
        series_id = series.id
    async with session_factory() as session:
        svc = _series_service(session)
        await svc.attach_game(
            series_id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red")
        )
    return team_a_id, team_b_id, series_id, match.id


async def _finalize(session_factory, series_id: uuid.UUID, req: FinalizeRequest):
    async with session_factory() as session:
        svc = _rating_service(session)
        return await svc.finalize(series_id, req)


async def _delete_anchor_b_participant(session_factory, match_id: uuid.UUID) -> None:
    """Remove PlayerB's match_players row so verification finds anchor B missing."""
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM match_players WHERE match_id = :m AND puuid_snapshot = 'puuid_p_b'"),
            {"m": match_id},
        )
        await session.commit()


async def test_rated_finalize_verifies_opposing_anchors(session_factory) -> None:
    team_a_id, _team_b_id, series_id, _match_id = await _seed_scenario(session_factory)
    result = await _finalize(session_factory, series_id, FinalizeRequest())
    assert result.status == "finalized"
    assert result.calculated_winner_id == team_a_id
    assert len(result.events) == 2


async def test_rated_finalize_with_missing_anchor_returns_anchor_mismatch(session_factory) -> None:
    _team_a_id, _team_b_id, series_id, match_id = await _seed_scenario(session_factory, offset=1)
    await _delete_anchor_b_participant(session_factory, match_id)

    with pytest.raises(AppError) as excinfo:
        await _finalize(session_factory, series_id, FinalizeRequest())
    assert excinfo.value.code == "ANCHOR_MISMATCH"
    assert excinfo.value.status == 409


async def test_anchor_mismatch_waived_by_explicit_reason_and_rated_mode(session_factory) -> None:
    team_a_id, _team_b_id, series_id, match_id = await _seed_scenario(session_factory, offset=2)
    await _delete_anchor_b_participant(session_factory, match_id)

    result = await _finalize(
        session_factory,
        series_id,
        FinalizeRequest(
            official_winner_id=team_a_id,
            override_reason="manual roster audit approved the series",
            rating_mode="manual_override",
        ),
    )
    assert result.status == "finalized"
    assert result.rating_mode == "manual_override"
    assert len(result.events) == 2


async def test_unrated_finalize_skips_anchor_verification(session_factory) -> None:
    _team_a_id, _team_b_id, series_id, match_id = await _seed_scenario(session_factory, offset=3)
    await _delete_anchor_b_participant(session_factory, match_id)

    result = await _finalize(
        session_factory,
        series_id,
        FinalizeRequest(rating_mode="unrated"),  # type: ignore[arg-type]
    )
    assert result.status == "finalized"
    assert result.events == []
```

- [ ] **Step 9: Run and verify**

Run:
```
uv run pytest tests/unit/test_anchor.py tests/unit/test_rating_service.py tests/unit/test_series_service.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_anchor_verification.py tests/integration/test_finalization.py tests/integration/test_rankings_api.py tests/integration/test_finalize_policy.py -q -m "not live"
```
Expected: all PASS. (The `_create_series` helper update keeps `test_finalization`/`test_rankings_api` green under the new anchor requirement.)

- [ ] **Step 10: Commit**

```bash
git add app/domain/series/anchor.py app/services/player_service.py app/services/series_service.py app/services/rating_service.py app/db/repositories/match_repository.py app/db/repositories/series_repository.py app/schemas/series.py app/api/dependencies.py tests/unit/test_anchor.py tests/unit/test_rating_service.py tests/unit/test_series_service.py tests/integration/test_anchor_verification.py tests/integration/test_finalization.py
git commit -m "feat: anchor persistence + rated anchor verification (D6)"
```

---

## Task 8: D7 — finalize persists actor/operation audit fields

**Spec anchors:** §4.4 D7, §9.2 (persist `finalized_by_actor_id`/`finalized_by_operation_id` from validated token claims inside the finalize transaction; FastAPI `request_id` ≠ Quest `operation_id`).

**Files:**
- Modify: `app/services/rating_service.py`, `app/api/routes/series.py`, `tests/unit/test_rating_service.py`, `tests/integration/test_finalization.py`
- Test: `tests/unit/test_rating_service.py`, `tests/integration/test_finalization.py`

- [ ] **Step 1: Write the failing unit test**

Append to `tests/unit/test_rating_service.py`:

```python
async def test_finalize_persists_actor_and_operation_audit() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]))
    svc, _session = _service(store)

    result = await svc.finalize(
        store.series.id,
        FinalizeRequest(),
        principal=ServicePrincipal(actor_id="actor-9", operation_id="op-9"),
    )

    assert result.status == "finalized"
    assert store.series.finalized_by_actor_id == "actor-9"
    assert store.series.finalized_by_operation_id == "op-9"


async def test_finalize_without_principal_keeps_audit_columns_null() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]))
    svc, _session = _service(store)

    await svc.finalize(store.series.id, FinalizeRequest())

    assert store.series.finalized_by_actor_id is None
    assert store.series.finalized_by_operation_id is None
```
(add `from app.api.service_token import ServicePrincipal` to the test imports.)

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_rating_service.py -q`
Expected: FAIL (`finalize()` got an unexpected keyword argument 'principal'`; `MemSeries` has no `finalized_by_*` attributes).

- [ ] **Step 3: Implement the audit persistence**

`tests/unit/test_rating_service.py` harness: `MemSeries` gains `finalized_by_actor_id: str | None = None`, `finalized_by_operation_id: str | None = None`.

`app/services/rating_service.py`:
1. Import `from app.api.service_token import ServicePrincipal`.
2. `finalize` signature and pass-through:
```python
    async def finalize(
        self,
        series_id: uuid.UUID,
        req: FinalizeRequest,
        principal: ServicePrincipal | None = None,
    ) -> FinalizeResult:
        """Finalize a series exactly once, atomically. ``principal`` carries the
        validated Quest actor/operation claims persisted onto the series (delta
        D7; spec §9.2). Any error rolls back all changes; the "series
        finalized" audit log is emitted ONLY after a successful commit."""
        try:
            result, log_extra = await self._finalize_locked(series_id, req, principal)
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        logger.info("series finalized", extra=log_extra)
        return result
```
3. `_finalize_locked` signature gains `principal: ServicePrincipal | None = None`, and inside the persist block (with the other `series.*` writes) add:
```python
        series.finalized_by_actor_id = principal.actor_id if principal else None
        series.finalized_by_operation_id = principal.operation_id if principal else None
```
and extend `log_extra` with `"actor_id": series.finalized_by_actor_id, "operation_id": series.finalized_by_operation_id`.

`app/api/routes/series.py::finalize_series` — inject the principal from the validated dependency:
```python
@router.post(
    "/{series_id}/finalize",
    response_model=FinalizeResult,
    dependencies=[Depends(require_service_token)],
)
async def finalize_series(
    series_id: uuid.UUID,
    req: FinalizeRequest,
    principal: Annotated[ServicePrincipal, Depends(require_service_token)],
    svc: _RatingServiceDep,
) -> FinalizeResult:
    """Finalize a series exactly once: atomic locked transaction, strict BO
    revalidation against CURRENT canonical games, legacy ELO, immutable events,
    and idempotent double-finalize protection. Service-token-gated; the signed
    actor/operation claims are persisted as audit fields (delta D7)."""
    return await svc.finalize(series_id, req, principal)
```
(add `from app.api.dependencies import ..., require_service_token` already done in Task 3; add `from app.api.service_token import ServicePrincipal`; `Annotated` is already imported.)

- [ ] **Step 4: Add the API-level audit test**

In `tests/integration/test_finalization.py`, extend `test_finalize_route_is_admin_gated_and_idempotent` (which now sends `service_token_headers(sub="actor-7", operation_id="op-finalize")` from Task 3) with, after the successful finalize POST:

```python
        series_row = await _series_row(session_factory, series_id)
        assert series_row.finalized_by_actor_id == "actor-7"
        assert series_row.finalized_by_operation_id == "op-finalize"
```

- [ ] **Step 5: Run and verify**

Run:
```
uv run pytest tests/unit/test_rating_service.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_finalization.py -q -m "not live"
```
Expected: PASS (audit fields persisted from the service param and from the signed-token/header claims at the API boundary).

- [ ] **Step 6: Commit**

```bash
git add app/services/rating_service.py app/api/routes/series.py tests/unit/test_rating_service.py tests/integration/test_finalization.py
git commit -m "feat: finalize persists actor/operation audit fields (D7)"
```

## Task 9: D8 — chronological guard for rated finalization

**Spec anchors:** §4.4 D8, §8.5 (reject `BACKDATED_SERIES_REJECTED` 409 when `played_at < MAX(played_at)` of finalized rated series; no seven-day window; unrated/forfeit exempt), §2.1 non-goal (no backdated ratings/rebuild promise).

**Files:**
- Modify: `app/db/repositories/series_repository.py`, `app/services/rating_service.py`, `tests/unit/test_rating_service.py`, `tests/integration/test_finalization.py` (seed helper gains `played_at` param)
- Create: `tests/integration/test_backdated_finalization.py`

- [ ] **Step 1: Write the failing unit test**

Append to `tests/unit/test_rating_service.py` (the `InMemorySeriesRepository` mirror gains an attribute `latest_finalized_rated_played_at: datetime | None = None` and a matching method):

```python
async def test_backdated_rated_finalize_is_rejected() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]), played_at=datetime(2026, 1, 1, tzinfo=UTC))
    svc, _session = _service(store)
    series_repo = svc._series_repo
    series_repo.latest_finalized_rated_played_at = datetime(2026, 2, 1, tzinfo=UTC)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())
    assert excinfo.value.code == "BACKDATED_SERIES_REJECTED"
    assert excinfo.value.status == 409


async def test_backdated_unrated_finalize_is_allowed() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]), played_at=datetime(2026, 1, 1, tzinfo=UTC))
    svc, _session = _service(store)
    series_repo = svc._series_repo
    series_repo.latest_finalized_rated_played_at = datetime(2026, 2, 1, tzinfo=UTC)

    result = await svc.finalize(
        store.series.id,
        FinalizeRequest(rating_mode="unrated"),  # type: ignore[arg-type]
    )
    assert result.status == "finalized"
    assert result.events == []


async def test_equal_played_at_is_not_backdated() -> None:
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]), played_at=datetime(2026, 2, 1, tzinfo=UTC))
    svc, _session = _service(store)
    svc._series_repo.latest_finalized_rated_played_at = datetime(2026, 2, 1, tzinfo=UTC)

    result = await svc.finalize(store.series.id, FinalizeRequest())
    assert result.status == "finalized"
    assert len(result.events) == 2
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_rating_service.py -q`
Expected: FAIL (`InMemorySeriesRepository` has no `get_latest_finalized_rated_played_at`; the guard is absent so no `BACKDATED_SERIES_REJECTED`).

- [ ] **Step 3: Implement the repo method and the guard**

`app/db/repositories/series_repository.py` — add `func` to the sqlalchemy import (`from sqlalchemy import func, select, update`) and add:

```python
    async def get_latest_finalized_rated_played_at(self) -> datetime | None:
        """The newest ``played_at`` among finalized RATED series (delta D8).

        Rated modes only (``normal``/``manual_override``): unrated and forfeit
        finalization never affect the chronological boundary.
        """
        result = await self._session.execute(
            select(func.max(Series.played_at)).where(
                Series.status == "finalized",
                Series.rating_mode.in_(("normal", "manual_override")),
            )
        )
        return result.scalar_one_or_none()
```

`app/services/rating_service.py` — in `_finalize_locked`, immediately after the D6 anchor-verification block (and before `_apply_rating_policy`), insert:

```python
        # 5c. Delta D8 (spec §4.4/§8.5): rated finalization must be
        #     chronological — no backdating. Reject when played_at is EARLIER
        #     than the latest already-finalized rated series. No seven-day
        #     window, no backdate override. Unrated/forfeit are exempt.
        if decision.mode in _RATED_MODES:
            latest = await self._series_repo.get_latest_finalized_rated_played_at()
            if latest is not None and series.played_at < latest:
                raise AppError(
                    "BACKDATED_SERIES_REJECTED",
                    409,
                    "cannot rate a series older than the latest rated series",
                )
```

`tests/unit/test_rating_service.py` — `InMemorySeriesRepository.__init__` gains `self.latest_finalized_rated_played_at: datetime | None = None`, plus:
```python
    async def get_latest_finalized_rated_played_at(self) -> datetime | None:
        return self.latest_finalized_rated_played_at
```
(add `datetime`/`UTC` imports if not already present.)

- [ ] **Step 4: Add the integration test**

First extend the `_seed_finalize_scenario` helper in `tests/integration/test_finalization.py` with an optional `played_at` parameter:

```python
async def _seed_finalize_scenario(
    session_factory,
    *,
    format_: Literal["bo1", "bo3", "bo5"] = "bo3",
    winners: list[str],
    offset: int = 0,
    played_at: datetime | None = datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
):
    ...
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_=format_, played_at=played_at)
    ...
```

Create `tests/integration/test_backdated_finalization.py`:

```python
"""Real-Postgres chronological-guard integration tests (spec §4.4 D8, §8.5).

Rated finalization is rejected with 409 ``BACKDATED_SERIES_REJECTED`` when the
series' ``played_at`` predates the latest finalized RATED series; equal
``played_at`` is allowed (strict ``<``); unrated finalization is exempt and
records no events/counters. Skipped when ``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.api.errors import AppError
from app.schemas.series import FinalizeRequest
from tests.integration.test_finalization import _finalize, _seed_finalize_scenario


async def test_rated_series_must_be_chronological(session_factory) -> None:
    # Latest finalized rated series is 2026-02-01.
    await _finalize(
        session_factory,
        (await _seed_finalize_scenario(
            session_factory, winners=["A", "A"], offset=0,
            played_at=datetime(2026, 2, 1, 12, 0, tzinfo=UTC),
        ))[2],
    )

    # Backdated rated finalize -> 409 BACKDATED_SERIES_REJECTED, still a draft.
    _team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, winners=["A", "A"], offset=10,
        played_at=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    with pytest.raises(AppError) as excinfo:
        await _finalize(session_factory, series_id, FinalizeRequest())
    assert excinfo.value.code == "BACKDATED_SERIES_REJECTED"
    assert excinfo.value.status == 409

    from sqlalchemy import select
    from app.db.models import Series

    async with session_factory() as session:
        row = await session.get(Series, series_id)
        assert row is not None
        assert row.status == "draft"
        assert len((await session.execute(select(Series))).scalars().all()) == 2  # no partial commit


async def test_equal_played_at_rated_finalize_is_allowed(session_factory) -> None:
    # Latest finalized rated series is 2026-03-01.
    await _finalize(
        session_factory,
        (await _seed_finalize_scenario(
            session_factory, winners=["A"], offset=0,
            played_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
        ))[2],
    )
    # A later series at the SAME played_at (strict <) is allowed.
    _team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, winners=["A"], offset=1,
        played_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )
    result = await _finalize(session_factory, series_id, FinalizeRequest())
    assert result.status == "finalized"
    assert len(result.events) == 2


async def test_unrated_finalize_is_exempt_from_chronological_guard(session_factory) -> None:
    # Latest finalized rated series is 2026-04-01.
    await _finalize(
        session_factory,
        (await _seed_finalize_scenario(
            session_factory, winners=["A"], offset=0,
            played_at=datetime(2026, 4, 1, 12, 0, tzinfo=UTC),
        ))[2],
    )
    # A backdated UNRATED series finalizes fine with no events and no counters.
    team_a_id, team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, winners=["A"], offset=1,
        played_at=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    result = await _finalize(
        session_factory,
        series_id,
        FinalizeRequest(rating_mode="unrated"),  # type: ignore[arg-type]
    )
    assert result.status == "finalized"
    assert result.events == []

    from decimal import Decimal

    from app.db.models import Team

    async with session_factory() as session:
        team_a = await session.get(Team, team_a_id)
        team_b = await session.get(Team, team_b_id)
        assert team_a is not None and team_b is not None
        assert team_a.series_wins == 0 and team_b.series_wins == 0
        assert team_a.matches_played == 0 and team_b.matches_played == 0
        assert team_a.current_elo == Decimal(1000) and team_b.current_elo == Decimal(1000)
```

- [ ] **Step 5: Run and verify**

Run:
```
uv run pytest tests/unit/test_rating_service.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_backdated_finalization.py tests/integration/test_finalization.py tests/integration/test_rankings_api.py -q -m "not live"
```
Expected: PASS. Note the D8 guard uses the advisory lock's serialization, so the `MAX(played_at)` read inside the finalize transaction is consistent.

- [ ] **Step 6: Commit**

```bash
git add app/db/repositories/series_repository.py app/services/rating_service.py tests/unit/test_rating_service.py tests/integration/test_finalization.py tests/integration/test_backdated_finalization.py
git commit -m "feat: chronological backdate guard for rated finalization (D8)"
```

---

## Task 10: D9 — absolute desired-order endpoint `PUT /series/{id}/games/order`

**Spec anchors:** §4.4 D9 (atomic, draft-only, validates the full desired order, idempotent by absolute values), §5.4 step 4 (single ABSOLUTE desired-order operation; same body converges).

**Files:**
- Modify: `app/schemas/series.py`, `app/db/repositories/series_repository.py`, `app/services/series_service.py`, `app/api/routes/series.py`, `tests/unit/test_route_inventory.py`, `tests/unit/test_series_service.py`, `tests/integration/test_series_api.py`
- Test: `tests/unit/test_series_service.py`, `tests/integration/test_series_api.py`, `tests/unit/test_route_inventory.py`

- [ ] **Step 1: Write the failing route-inventory test update**

Modify `tests/unit/test_route_inventory.py`:
1. Add to the schema import block: `from app.schemas.series import ..., SetGameOrderRequest`.
2. Add the PUT row to `DOCUMENTED_SURFACE` (between the games rows and `preview`):
```python
    "/api/v1/series/{series_id}/games/order": {"put": (SetGameOrderRequest, list[GameView])},
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_route_inventory.py -q`
Expected: FAIL — `ImportError: cannot import name 'SetGameOrderRequest'` (schema not defined) and/or the surface-equality assertion reports the missing route.

- [ ] **Step 3: Implement schema/repo/service/route**

`app/schemas/series.py` — add:
```python
class SetGameOrderItem(BaseModel):
    game_id: uuid.UUID
    game_number: int = Field(ge=1)


class SetGameOrderRequest(BaseModel):
    games: list[SetGameOrderItem] = Field(min_length=1)
```

`app/db/repositories/series_repository.py` — add:
```python
    async def reorder_games(self, series_id: uuid.UUID, desired: dict[uuid.UUID, int]) -> None:
        """Reapply the ABSOLUTE game order inside the series-locked transaction.

        Two-phase renumber (all numbers shifted up by N, then each game to its
        target) so the ``series_games_number_key`` unique constraint is never
        transiently violated. The caller holds the series ``FOR UPDATE`` lock.
        """
        games = await self.get_games(series_id)
        n = len(games)
        for game in games:
            game.game_number += n
        await self._session.flush()
        for game in games:
            game.game_number = desired[game.id]
        await self._session.flush()
```

`app/services/series_service.py` — add (imports: `SetGameOrderRequest`):
```python
    async def set_game_order(self, series_id: uuid.UUID, req: SetGameOrderRequest) -> list[SeriesGame]:
        """Apply the full ABSOLUTE desired game order (delta D9; spec §5.4).

        Draft-only (``_require_draft``), atomic, and idempotent by absolute
        values: the body states the complete desired final order and a retry
        with the same body converges. The desired set must equal the series'
        current games exactly (each game once, game_number a contiguous 1..N
        permutation), else 409 ``SERIES_INVALID``.
        """
        series = await self._require_draft(series_id)
        games = await self._series_repo.get_games(series_id)
        desired = {item.game_id: item.game_number for item in req.games}
        if len(desired) != len(req.games):
            raise AppError("SERIES_INVALID", 409, "duplicate game_id in desired order")
        if set(desired) != {game.id for game in games}:
            raise AppError("SERIES_INVALID", 409, "desired order must include exactly the series' games")
        if sorted(desired.values()) != list(range(1, len(games) + 1)):
            raise AppError("SERIES_INVALID", 409, "game numbers must be a contiguous 1..N permutation")
        if all(game.game_number == desired[game.id] for game in games):
            return games  # idempotent no-op
        try:
            await self._series_repo.reorder_games(series_id, desired)
            await self._recompute_and_validate(series)
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            raise
        return await self._series_repo.get_games(series_id)
```

`app/api/routes/series.py` — add (imports: `SetGameOrderRequest`):
```python
@router.put(
    "/{series_id}/games/order",
    response_model=list[GameView],
    dependencies=[Depends(require_service_token)],
)
async def set_game_order(
    series_id: uuid.UUID,
    req: SetGameOrderRequest,
    svc: _SeriesServiceDep,
) -> list[GameView]:
    """Apply the full ABSOLUTE desired game order (delta D9): draft-only,
    atomic, idempotent by absolute values. ``PATCH`` per-game reorder remains
    for re-siding; Quest drives ordering through this endpoint."""
    games = await svc.set_game_order(series_id, req)
    map_names = await svc.get_match_map_names(game.match_id for game in games)
    return [to_game_view(game, map_names) for game in games]
```

- [ ] **Step 4: Add the unit tests**

Append to `tests/unit/test_series_service.py` (the in-memory repo mirror must implement `reorder_games`, `get_games`, and `_recompute_and_validate` behavior — follow the file's existing fake-repo pattern, tracking `game_number` on the in-memory game rows):

```python
async def test_set_game_order_swaps_absolute_order() -> None:
    team_a, team_b, series, games, _matches = _scenario(format_="bo3", winners=["A", "B", "A"])
    svc = _service(team_a, team_b, series, games)
    g1, g2, g3 = [g.id for g in sorted(games, key=lambda g: g.game_number)]
    ordered = await svc.set_game_order(
        series.id,
        SetGameOrderRequest(games=[
            {"game_id": g3, "game_number": 1},
            {"game_id": g1, "game_number": 2},
            {"game_id": g2, "game_number": 3},
        ]),
    )
    assert [g.game_number for g in sorted(ordered, key=lambda g: g.game_number)] == [1, 2, 3]
    by_id = {g.id: g for g in ordered}
    assert by_id[g1].game_number == 2
    assert by_id[g2].game_number == 3
    assert by_id[g3].game_number == 1


async def test_set_game_order_is_idempotent() -> None:
    team_a, team_b, series, games, _matches = _scenario(format_="bo3", winners=["A", "B", "A"])
    svc = _service(team_a, team_b, series, games)
    ordered = await svc.set_game_order(
        series.id,
        SetGameOrderRequest(games=[
            {"game_id": g.id, "game_number": g.game_number} for g in games
        ]),
    )
    assert len(ordered) == 3  # no-op converges, returns the current order


async def test_set_game_order_rejects_missing_game() -> None:
    team_a, team_b, series, games, _matches = _scenario(format_="bo3", winners=["A", "B", "A"])
    svc = _service(team_a, team_b, series, games)
    g1, g2, _g3 = [g.id for g in sorted(games, key=lambda g: g.game_number)]
    with pytest.raises(AppError) as excinfo:
        await svc.set_game_order(
            series.id,
            SetGameOrderRequest(games=[
                {"game_id": g1, "game_number": 1},
                {"game_id": g2, "game_number": 2},
            ]),
        )
    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409


async def test_set_game_order_rejects_non_contiguous_numbers() -> None:
    team_a, team_b, series, games, _matches = _scenario(format_="bo3", winners=["A", "B", "A"])
    svc = _service(team_a, team_b, series, games)
    g1, g2, g3 = [g.id for g in sorted(games, key=lambda g: g.game_number)]
    with pytest.raises(AppError) as excinfo:
        await svc.set_game_order(
            series.id,
            SetGameOrderRequest(games=[
                {"game_id": g1, "game_number": 1},
                {"game_id": g2, "game_number": 2},
                {"game_id": g3, "game_number": 5},
            ]),
        )
    assert excinfo.value.code == "SERIES_INVALID"
```

- [ ] **Step 5: Add the API integration test**

Append to `tests/integration/test_series_api.py`:

```python
async def test_set_game_order_absolute_and_idempotent(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent"), ("m2", True, "Bind"), ("m3", False, "Split")])
    async with _client(app) as client:
        series = await client.post(f"{BASE}", json={
            "team_a_id": str(team_a_id),
            "team_b_id": str(team_b_id),
            "format": "bo3",
            "importance": "regular",
        })
        series_id = series.json()["id"]
        game_ids = []
        for number, match in ((1, matches["m1"]), (2, matches["m2"]), (3, matches["m3"])):
            game = await client.post(
                f"{BASE}/{series_id}/games",
                json={"match_id": str(match.id), "game_number": number, "team_a_side": "red"},
            )
            assert game.status_code == 201
            game_ids.append(game.json()["id"])

        # Absolute reorder: reverse the maps.
        order = [{"game_id": game_ids[2], "game_number": 1},
                 {"game_id": game_ids[1], "game_number": 2},
                 {"game_id": game_ids[0], "game_number": 3}]
        first = await client.put(f"{BASE}/{series_id}/games/order", json={"games": order})
        assert first.status_code == 200
        assert [g["game_number"] for g in first.json()] == [1, 2, 3]
        assert first.json()[0]["id"] == game_ids[2]

        # Same body converges (idempotent by absolute values).
        second = await client.put(f"{BASE}/{series_id}/games/order", json={"games": order})
        assert second.status_code == 200
        assert [g["id"] for g in second.json()] == [g["id"] for g in first.json()]

        # A body that omits a game is rejected (409 SERIES_INVALID), draft intact.
        bad = await client.put(
            f"{BASE}/{series_id}/games/order",
            json={"games": [{"game_id": game_ids[0], "game_number": 1}]},
        )
        assert bad.status_code == 409
        assert bad.json()["error"]["code"] == "SERIES_INVALID"
```

- [ ] **Step 6: Run and verify**

Run:
```
uv run pytest tests/unit/test_series_service.py tests/unit/test_route_inventory.py -q
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_series_api.py tests/integration/test_preview_api.py -q -m "not live"
```
Expected: PASS (route inventory surface now matches; the PUT order route is service-token-gated in production by construction).

- [ ] **Step 7: Commit**

```bash
git add app/schemas/series.py app/db/repositories/series_repository.py app/services/series_service.py app/api/routes/series.py tests/unit/test_route_inventory.py tests/unit/test_series_service.py tests/integration/test_series_api.py
git commit -m "feat: absolute desired-order games/order endpoint (D9)"
```

---

## Task 11: D10 — ID-naming contract docs and pins

**Spec anchors:** §4.4 D10 (import `match_id` = Henrik TEXT id; `AttachGameRequest.match_id` = VAL internal UUID; no code change beyond documentation + Quest fixture tests — the FastAPI part here is docs + contract pins), §4.1 glossary.

**Files:**
- Modify: `app/schemas/matches.py`, `app/schemas/series.py`
- Create: `tests/unit/test_id_naming_contract.py`

- [ ] **Step 1: Write the failing contract test**

Create `tests/unit/test_id_naming_contract.py`:

```python
"""ID-naming contract pins (spec §4.4 D10, §4.1 glossary).

The same-looking identifier means different things on different endpoints:
``MatchImportRequest.match_id`` is the Henrik TEXT id; ``AttachGameRequest.match_id``
is the internal VAL ``matches.id`` UUID. These pins freeze the two in place so
a future rename cannot silently swap them.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.schemas.matches import MatchDetailResponse, MatchImportRequest
from app.schemas.series import AttachGameRequest


def test_import_match_id_is_henrik_text_id() -> None:
    field = MatchImportRequest.model_fields["match_id"]
    assert field.annotation is str
    assert any(
        "henrik" in (m.description or "").lower() for m in field.metadata if m.description
    ), "MatchImportRequest.match_id must be documented as the Henrik text id"


def test_import_match_id_pattern_rejects_non_hex_text() -> None:
    with pytest.raises(ValidationError):
        MatchImportRequest(match_id="not hex!!!")
    assert MatchImportRequest(match_id="a" * 32).match_id == "a" * 32


def test_attach_game_match_id_is_internal_uuid() -> None:
    assert AttachGameRequest.model_fields["match_id"].annotation is uuid.UUID
    assert any(
        "henrik" in (m.description or "").lower() for m in AttachGameRequest.model_fields["match_id"].metadata if m.description
    ), "AttachGameRequest.match_id must be documented as the internal VAL match UUID (not the Henrik text id)"


def test_detail_response_exposes_both_ids() -> None:
    assert MatchDetailResponse.model_fields["id"].annotation is uuid.UUID
    assert MatchDetailResponse.model_fields["henrik_match_id"].annotation is str
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/unit/test_id_naming_contract.py -v`
Expected: FAIL — no `description` metadata contains "henrik" yet (the field descriptions are absent).

- [ ] **Step 3: Add the documentation**

`app/schemas/matches.py`:
- Extend the module docstring with:
```
``MatchImportRequest.match_id`` is the canonical Henrik TEXT id (never the
internal ``matches.id`` UUID); ``MatchDetailResponse.id`` is the internal UUID
that attach endpoints accept. Do not conflate the two (spec §4.4 D10).
```
- `MatchImportRequest.match_id`:
```python
    match_id: str = Field(
        min_length=8,
        max_length=64,
        pattern=r"^[0-9a-fA-F-]+$",
        description="The canonical Henrik match ID (text id). NOT the internal matches.id UUID.",
    )
```
- `MatchDetailResponse.id`:
```python
    id: uuid.UUID = Field(
        description="Internal VAL match UUID (matches.id); series attach accepts this, not henrik_match_id."
    )
```

`app/schemas/series.py`:
- Extend the module docstring with a note that `AttachGameRequest.match_id` is the internal VAL match UUID while import/display use the Henrik text id (spec §4.4 D10).
- `AttachGameRequest.match_id`:
```python
    match_id: uuid.UUID = Field(
        description="Internal VAL match UUID (matches.id) — NOT the Henrik text match_id used by /matches/import."
    )
```

- [ ] **Step 4: Run and verify**

Run: `uv run pytest tests/unit/test_id_naming_contract.py tests/unit/test_route_inventory.py -v`
Expected: PASS (descriptions now resolve; the OpenAPI document carries the pinned wording).

- [ ] **Step 5: Commit**

```bash
git add app/schemas/matches.py app/schemas/series.py tests/unit/test_id_naming_contract.py
git commit -m "docs: pin henrik vs internal match-id contract (D10)"
```

---

## Task 12: Quest-facing contract/integration tests

**Spec anchors:** §11.2 (FastAPI contract tests assert the exact shapes Quest sends: HMAC headers, `external_quest_series_id`, `anchor_player_*`, `rating_mode` literals, `match_id` vs `henrik_match_id` placement), §11.4 step 1–9 (two-service journey, run here against FastAPI alone through its API), §6.5 error mapping, §8.1 (re-import 200 `created=false`).

**Files:**
- Create: `tests/integration/test_quest_contract.py`

- [ ] **Step 1: Write the failing contract test**

Create `tests/integration/test_quest_contract.py`:

```python
"""Quest-facing contract integration tests (spec §11.2, §11.4).

Drives FastAPI exactly as the Quest backend calls it: team create-or-get by
``quest_saved_team_id``, series create-or-get by ``external_quest_series_id``
with ``anchor_player_*``, import/attach/reorder/preview, rated finalize with
audit (``X-Quest-Actor-Id``/``X-Quest-Operation-Id`` in test env), double
finalize 409, unrated finalize with no counters, and the import ID-naming
contract (Henrik text id in, internal UUID ``matches.id`` out). Skipped when
``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import json
import uuid
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from app.api.dependencies import (
    get_import_service,
    get_rating_service,
    get_series_service,
    get_team_service,
)
from app.db.models import Series, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.db.repositories.team_repository import TeamRepository
from app.integrations.henrik.mapper import HenrikMapper
from app.main import create_app
from app.services.match_import_service import MatchImportService
from app.services.player_service import PlayerService
from app.services.rating_service import RatingService
from app.services.series_service import SeriesService
from app.services.team_service import TeamService

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"
_ID = "00000000-0000-0000-0000-0000000000%s"


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _completed_variant(henrik_match_id: str, *, red_wins: bool, map_name: str) -> dict:
    fixture = deepcopy(_load("completed_custom.json"))
    data = fixture["data"]
    data["metadata"]["match_id"] = henrik_match_id
    data["metadata"]["map"]["name"] = map_name
    red, blue = data["teams"]
    red["rounds"]["won"], red["rounds"]["lost"] = (13, 9) if red_wins else (9, 13)
    blue["rounds"]["won"], blue["rounds"]["lost"] = (9, 13) if red_wins else (13, 9)
    red["won"], blue["won"] = red_wins, not red_wins
    return fixture


class FakeHenrik:
    def __init__(self, fixtures: dict[str, dict]) -> None:
        self.fixtures = fixtures
        self._mapper = HenrikMapper()

    async def get_match_detail(self, match_id: str, *, affinity: str):
        envelope = self.fixtures[match_id]
        from app.integrations.henrik.models import HenrikMatchDetailEnvelope

        return HenrikMatchDetailEnvelope(
            status=envelope["status"],
            data=self._mapper.to_match_detail(envelope["data"]),
            raw=envelope,
        )


class _NoNetworkHenrik:
    async def get_account(self, *args, **kwargs):
        raise AssertionError("anchor resolution must hit the player cache")


def _app(session_factory):
    """App with service overrides bound to the real migrated-schema sessions."""
    app = create_app()

    async def _team_override():
        async with session_factory() as session:
            yield TeamService(session=session, repo=TeamRepository(session))

    async def _series_override():
        async with session_factory() as session:
            yield SeriesService(
                session=session,
                series_repo=SeriesRepository(session),
                match_repo=MatchRepository(session),
                player_svc=PlayerService(session=session, henrik=_NoNetworkHenrik(), repo=PlayerRepository(session)),  # type: ignore[arg-type]
            )

    async def _rating_override():
        async with session_factory() as session:
            yield RatingService(
                session=session,
                series_repo=SeriesRepository(session),
                rating_repo=RatingRepository(session),
                match_repo=MatchRepository(session),
            )

    async def _import_override():
        async with session_factory() as session:
            yield MatchImportService(
                session=session,
                henrik=FakeHenrik({}),  # type: ignore[arg-type]
                player_repo=PlayerRepository(session),
                match_repo=MatchRepository(session),
                mapper=HenrikMapper(),
            )

    app.dependency_overrides[get_team_service] = _team_override
    app.dependency_overrides[get_series_service] = _series_override
    app.dependency_overrides[get_rating_service] = _rating_override
    app.dependency_overrides[get_import_service] = _import_override
    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def quest_app(session_factory):
    """A client over the overridden app with an empty FakeHenrik fixture map
    that tests fill per-request (imports are fixture-driven, no network)."""
    app = _app(session_factory)
    override = app.dependency_overrides[get_import_service]
    return app, override


async def _import_fixture_henrik(app, henrik_match_id: str, fixture: dict) -> None:
    """Point the import override's FakeHenrik at a specific fixture before a call."""
    import_service = None
    gen = app.dependency_overrides[get_import_service]()
    try:
        import_service = await gen.__anext__()
    except StopAsyncIteration:
        return
    finally:
        await gen.aclose()
    import_service._henrik = FakeHenrik({henrik_match_id: fixture})  # type: ignore[attr-defined]


async def test_team_bind_create_or_get_contract(session_factory) -> None:
    app = _app(session_factory)
    async with _client(app) as client:
        payload = {"name": "Sentinels", "short_name": "SEN", "quest_saved_team_id": "quest-team-100"}
        first = await client.post("/api/v1/teams", json=payload)
        assert first.status_code == 201
        second = await client.post("/api/v1/teams", json=payload)
        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]
        assert second.json()["quest_saved_team_id"] == "quest-team-100"


async def test_import_and_series_create_or_get_contract(session_factory, monkeypatch) -> None:
    app = _app(session_factory)
    async with _client(app) as client:
        # Bind both teams.
        team_a = (await client.post("/api/v1/teams", json={"name": "Alpha", "quest_saved_team_id": "qt-a"})).json()
        team_b = (await client.post("/api/v1/teams", json={"name": "Beta", "quest_saved_team_id": "qt-b"})).json()

        # Import a canonical match via the Henrik TEXT id.
        henrik_id = _ID % "01"
        await _import_fixture_henrik(app, henrik_id, _completed_variant(henrik_id, red_wins=True, map_name="Ascent"))
        imported = await client.post("/api/v1/matches/import", json={"match_id": henrik_id, "affinity": "eu"})
        assert imported.status_code == 201
        match = imported.json()["match"]
        assert match["created"] is False or imported.status_code == 201  # created flag inside body
        internal_uuid = uuid.UUID(match["id"])  # internal matches.id
        assert match["henrik_match_id"] == henrik_id

        # Re-import the SAME text id -> 200 created=false, same internal id.
        again = await client.post("/api/v1/matches/import", json={"match_id": henrik_id, "affinity": "eu"})
        assert again.status_code == 200
        assert again.json()["created"] is False
        assert again.json()["match"]["id"] == match["id"]

        # Series create-or-get with external key + anchors.
        series_payload = {
            "team_a_id": team_a["id"],
            "team_b_id": team_b["id"],
            "format": "bo1",
            "importance": "regular",
            "external_quest_series_id": "quest-series-100",
            "anchor_player_a": {"name": "PlayerA", "tag": "A"},
            "anchor_player_b": {"name": "PlayerB", "tag": "B"},
        }
        first = await client.post("/api/v1/series", json=series_payload)
        assert first.status_code == 201
        series_id = first.json()["id"]
        assert first.json()["external_quest_series_id"] == "quest-series-100"
        second = await client.post("/api/v1/series", json=series_payload)
        assert second.status_code == 200
        assert second.json()["id"] == series_id

        # Attach with the INTERNAL uuid.
        attach = await client.post(
            f"/api/v1/series/{series_id}/games",
            json={"match_id": str(internal_uuid), "game_number": 1, "team_a_side": "red"},
        )
        assert attach.status_code == 201
        assert attach.json()["match_id"] == str(internal_uuid)

        # Preview is valid.
        preview = await client.get(f"/api/v1/series/{series_id}/preview")
        assert preview.json()["valid"] is True

        # Rated finalize carries the actor/operation audit from the claims.
        finalize = await client.post(
            f"/api/v1/series/{series_id}/finalize",
            json={"rating_mode": "normal"},
            headers={"X-Quest-Actor-Id": "actor-100", "X-Quest-Operation-Id": "op-100"},
        )
        assert finalize.status_code == 200
        body = finalize.json()
        assert body["status"] == "finalized"
        assert len(body["events"]) == 2

        async with session_factory() as session:
            row = await session.get(Series, uuid.UUID(series_id))
            assert row is not None
            assert row.finalized_by_actor_id == "actor-100"
            assert row.finalized_by_operation_id == "op-100"
            assert row.anchor_a_puuid == "puuid_p_a"
            assert row.anchor_b_puuid == "puuid_p_b"

        # Double finalize -> 409, no re-rating.
        again_finalize = await client.post(
            f"/api/v1/series/{series_id}/finalize",
            json={},
            headers={"X-Quest-Actor-Id": "actor-100", "X-Quest-Operation-Id": "op-101"},
        )
        assert again_finalize.status_code == 409
        assert again_finalize.json()["error"]["code"] == "SERIES_ALREADY_FINALIZED"


async def test_unrated_series_contract_no_counters(session_factory) -> None:
    app = _app(session_factory)
    async with _client(app) as client:
        team_a = (await client.post("/api/v1/teams", json={"name": "Gamma", "quest_saved_team_id": "qt-c"})).json()
        team_b = (await client.post("/api/v1/teams", json={"name": "Delta", "quest_saved_team_id": "qt-d"})).json()
        henrik_id = _ID % "02"
        await _import_fixture_henrik(app, henrik_id, _completed_variant(henrik_id, red_wins=True, map_name="Bind"))
        match = (await client.post("/api/v1/matches/import", json={"match_id": henrik_id})).json()["match"]
        series = (await client.post("/api/v1/series", json={
            "team_a_id": team_a["id"],
            "team_b_id": team_b["id"],
            "format": "bo1",
            "importance": "regular",
        })).json()
        await client.post(
            f"/api/v1/series/{series['id']}/games",
            json={"match_id": match["id"], "game_number": 1, "team_a_side": "red"},
        )
        result = await client.post(
            f"/api/v1/series/{series['id']}/finalize",
            json={"rating_mode": "unrated"},
        )
        assert result.status_code == 200
        assert result.json()["events"] == []
        assert result.json()["rating_mode"] == "unrated"

        async with session_factory() as session:
            team_a_row = await session.get(Team, uuid.UUID(team_a["id"]))
            team_b_row = await session.get(Team, uuid.UUID(team_b["id"]))
            assert team_a_row is not None and team_b_row is not None
            assert team_a_row.matches_played == 0 and team_b_row.matches_played == 0
            assert team_a_row.series_wins == 0 and team_b_row.series_wins == 0
            assert team_a_row.current_elo == Decimal(1000) and team_b_row.current_elo == Decimal(1000)


async def test_by_henrik_id_detail_contract(session_factory) -> None:
    app = _app(session_factory)
    async with _client(app) as client:
        henrik_id = _ID % "03"
        await _import_fixture_henrik(app, henrik_id, _completed_variant(henrik_id, red_wins=False, map_name="Split"))
        imported = await client.post("/api/v1/matches/import", json={"match_id": henrik_id, "affinity": "eu"})
        internal_id = imported.json()["match"]["id"]

        detail = await client.get(f"/api/v1/matches/by-henrik-id/{henrik_id}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["id"] == internal_id  # internal UUID
        assert body["henrik_match_id"] == henrik_id  # text id round-trips
```

Note: replace the `_import_fixture_henrik` helper with a simpler design if preferred — a cleaner approach is to bind the FakeHenrik fixtures at app-build time per test by passing a `fixtures` dict to `_app(session_factory, fixtures=...)`. The helper above works because `MatchImportService._henrik` is the attribute the route-injected service uses; overriding it before the import call is safe inside one test.

- [ ] **Step 2: Run it to verify it fails**

Run:
```
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest tests/integration/test_quest_contract.py -q -m "not live"
```
Expected: PASS immediately if every prior task is complete — this file is the aggregate contract; if any delta is missing, one of the assertions fails with the corresponding code. (If you are executing tasks strictly in order, run this final task only after Tasks 1–11; treat a failure here as a spec-coverage bug in an earlier task.)

- [ ] **Step 3: Run the full suite + lint**

Run:
```
uv run ruff check app tests scripts
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/valorant_platform_test uv run pytest -m "not live" -q
```
Expected: all PASS, ruff clean.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_quest_contract.py
git commit -m "test: quest-facing FastAPI contract integration tests"
```

---

## Self-review (writing-plans checklist — run before declaring the plan complete)

**1. Spec coverage — every requirement maps to a task:**
- D1 service auth → Tasks 2, 3; local/test strategy in Task 2 Step 5; `X-Admin-Key` retained on `/rankings/rebuild` → Task 3 Step 2; health unauthenticated → Task 3 (explicit no-change note + inventory test).
- D2 `quest_saved_team_id` create-or-get → Task 1 (column/index) + Task 4.
- D3 `external_quest_series_id` create-or-get → Task 1 + Task 5.
- D4 `unrated` no ELO/no counters → Task 1 (CHECK) + Task 6.
- D5 reason-required for `manual_override`/`forfeit_no_rating`/`forfeit_result_only` even when official == calculated → Task 6.
- D6 anchor persistence + rated verification (`ANCHOR_MISMATCH` 409, audited override waiver, unrated/forfeit skip) → Task 1 + Task 7.
- D7 finalize actor/operation audit fields → Task 1 + Task 8.
- D8 chronological guard (`BACKDATED_SERIES_REJECTED` 409, rated-only, after the advisory lock) → Task 9.
- D9 absolute desired-order endpoint → Task 10.
- D10 ID-naming docs/tests → Task 11.
- FastAPI-side contract/integration tests → Tasks 1–12 (aggregate in Task 12).
- Error/status contract (internal match UUID vs Henrik text ID; `draft|finalized` status; `INVALID_REQUEST`/`ADMIN_AUTH_REQUIRED`/`RATING_POLICY_REQUIRED`/`SERIES_ALREADY_FINALIZED`; re-import 200 `created=false`) → pinned in §0 and exercised in Tasks 3, 4, 5, 6, 12.

**2. Placeholder scan:** no TBD/TODO; every code step shows the code; every run step has the exact command and expected outcome.

**3. Type consistency:**
- `ServicePrincipal(actor_id, operation_id)` defined in Task 2, consumed in Tasks 3 (dependency), 8 (route + service). Same names throughout.
- `create_or_get(req) -> tuple[X, bool]` used by both `TeamService` (Task 4) and `SeriesService` (Task 5); `create` delegates and keeps the old signature so untouched tests compile.
- `RatingService.finalize(series_id, req, principal=None)` signature introduced in Task 8; `_finalize_locked` consumes it; all earlier call sites still compile (optional arg).
- `_RATED_MODES` defined in Task 7 and reused by Task 9's guard — same name in both.
- `verify_opposing_anchors(anchor_a, anchor_b, match_ids, sides_by_match)` used in Task 7's service call matches the helper signature in `app/domain/series/anchor.py`.
- `SetGameOrderRequest`/`SetGameOrderItem` defined in Task 10 and used by the route, service, and inventory test — the inventory row and schema land in the same commit so the surface-equality test never dangles.
- `AnchorFixture` facts (`puuid_p_a`, `PlayerA#A`, `PlayerB#B`) consistent between Task 7 helpers and Task 12 contract tests.

**Execution handoff:** Plan complete and saved to `QuestEsports/docs/superpowers/plans/2026-08-13-valorant-fastapi-contract-plan.md`. Execution options: (1) Subagent-Driven — dispatch a fresh subagent per task, review between tasks; (2) Inline Execution — execute in-session with executing-plans, batch with checkpoints. Both are external to this document (this plan was authored under the "write only the plan" constraint).
