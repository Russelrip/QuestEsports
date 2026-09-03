"""Real-Postgres team API integration tests (plan Task 11, App. D).

The full API flow runs against the app with ``get_team_service`` overridden to
bind a real migrated-schema session. Covers:

- create: 201 with ``current_elo``/``peak_elo`` == 1000 and zeroed counters;
- ``seeding_elo`` round-trips without touching ``current_elo`` (legacy compat);
- list: ``active_only`` default hides retired teams;
- get by id; missing id → 404 ``TEAM_NOT_FOUND``;
- patch: field updates and deactivation via ``is_active=false``; explicit
  ``slug: null`` clears the column while an omitted slug is preserved;
- oversized PATCH ``name``/``short_name``/``slug`` → 422 (same max lengths as
  create);
- duplicate slug → 409 ``TEAM_SLUG_TAKEN`` (DB unique index);
- DB CHECK constraints reject negative ``current_elo``/``peak_elo`` and
  negative ``matches_played``/``series_wins``/``series_losses``;
- no DELETE route (retirement is PATCH ``is_active=false``);
- service-token gate: mutations and reads require a Quest service token in
  ``production`` (delta D1; spec §6.3);
- malformed team UUID path → 422.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import get_team_service
from app.db.models import Team
from app.db.repositories.team_repository import TeamRepository
from app.main import create_app
from app.services.team_service import TeamService
from tests.token_helpers import production_settings, service_token_headers

BASE = "/api/v1/teams"
INITIAL_ELO = Decimal(1000)


def _app(monkeypatch: pytest.MonkeyPatch, session_factory, *, app_env: str = "test"):
    """Build the app with service-token bypass/protection and the service override.

    ``get_settings`` is patched inside ``app.api.dependencies`` (the same seam
    ``require_service_token`` reads), so ``app_env="test"`` bypasses the gate
    and ``app_env="production"`` enforces it.
    """
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: production_settings(app_env=app_env),
    )
    app = create_app()

    async def _override():
        async with session_factory() as session:
            yield TeamService(session=session, repo=TeamRepository(session))

    app.dependency_overrides[get_team_service] = _override
    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _elo(value) -> Decimal:
    return Decimal(str(value))


async def _count(session_factory) -> int:
    async with session_factory() as session:
        return await session.scalar(select(func.count()).select_from(Team))


async def _row(session_factory, team_id: str) -> Team:
    async with session_factory() as session:
        row = await session.get(Team, uuid.UUID(team_id))
        assert row is not None
        return row


# ------------------------------------------------------------------ create


async def test_create_team_round_trips(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.post(
            BASE,
            json={
                "name": "Sentinels",
                "short_name": "SEN",
                "slug": "sentinels",
                "logo_url": "https://x/sen.png",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Sentinels"
        assert body["short_name"] == "SEN"
        assert body["slug"] == "sentinels"
        assert body["logo_url"] == "https://x/sen.png"
        assert _elo(body["current_elo"]) == INITIAL_ELO
        assert _elo(body["peak_elo"]) == INITIAL_ELO
        assert body["seeding_elo"] is None
        assert body["matches_played"] == 0
        assert body["series_wins"] == 0
        assert body["series_losses"] == 0
        assert body["is_active"] is True

        row = await _row(session_factory, body["id"])
        assert row.current_elo == INITIAL_ELO
        assert row.peak_elo == INITIAL_ELO
        assert row.created_at is not None  # server default applied
        assert await _count(session_factory) == 1


async def test_create_with_seeding_elo_keeps_current_elo_at_1000(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.post(BASE, json={"name": "Legacy", "seeding_elo": "1200.5"})
        assert resp.status_code == 201
        body = resp.json()
        assert _elo(body["seeding_elo"]) == Decimal("1200.5")
        assert _elo(body["current_elo"]) == INITIAL_ELO  # never a rating input
        assert _elo(body["peak_elo"]) == INITIAL_ELO


# ------------------------------------------------------------------- list


async def test_list_active_only_hides_retired_teams(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        active = await client.post(BASE, json={"name": "Active"})
        retired = await client.post(BASE, json={"name": "Retired"})
        assert active.status_code == 201 and retired.status_code == 201
        patch = await client.patch(f"{BASE}/{retired.json()['id']}", json={"is_active": False})
        assert patch.status_code == 200
        assert patch.json()["is_active"] is False

        listed = await client.get(BASE)
        assert listed.status_code == 200
        ids = [team["id"] for team in listed.json()]
        assert active.json()["id"] in ids
        assert retired.json()["id"] not in ids  # default active_only

        with_retired = await client.get(BASE, params={"active_only": False})
        all_ids = [team["id"] for team in with_retired.json()]
        assert {active.json()["id"], retired.json()["id"]} <= set(all_ids)


# -------------------------------------------------------------------- get


async def test_get_team_by_id(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "Fnatic", "slug": "fnatic"})
        team_id = created.json()["id"]

        resp = await client.get(f"{BASE}/{team_id}")

        assert resp.status_code == 200
        assert resp.json()["name"] == "Fnatic"
        assert resp.json()["slug"] == "fnatic"


async def test_get_missing_team_returns_team_not_found(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/00000000-0000-0000-0000-000000000099")

        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "TEAM_NOT_FOUND"


async def test_malformed_team_uuid_returns_422(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/not-a-uuid")

        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"


# ------------------------------------------------------------------ update


async def test_patch_updates_fields_and_deactivates(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "G2", "slug": "g2"})
        team_id = created.json()["id"]

        resp = await client.patch(
            f"{BASE}/{team_id}",
            json={"name": "G2 Esports", "short_name": "G2", "is_active": False},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "G2 Esports"
        assert body["short_name"] == "G2"
        assert body["is_active"] is False
        assert body["slug"] == "g2"  # untouched field preserved
        assert _elo(body["current_elo"]) == INITIAL_ELO  # ratings never touched

        row = await _row(session_factory, team_id)
        assert row.name == "G2 Esports"
        assert row.is_active is False
        assert row.updated_at is not None


async def test_patch_slug_null_clears_slug(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "Rebrand", "slug": "old-slug"})
        team_id = created.json()["id"]

        resp = await client.patch(f"{BASE}/{team_id}", json={"slug": None})

        assert resp.status_code == 200
        assert resp.json()["slug"] is None  # explicit null clears the column
        row = await _row(session_factory, team_id)
        assert row.slug is None


async def test_patch_omitted_slug_preserved(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "Keep", "slug": "kept"})
        team_id = created.json()["id"]

        resp = await client.patch(f"{BASE}/{team_id}", json={"name": "Keep Renamed"})

        assert resp.status_code == 200
        assert resp.json()["slug"] == "kept"  # omitted field untouched
        assert resp.json()["name"] == "Keep Renamed"


# --------------------------------------- oversized PATCH fields → 422


async def test_patch_oversized_name_returns_422(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "G2"})
        team_id = created.json()["id"]

        resp = await client.patch(f"{BASE}/{team_id}", json={"name": "x" * 65})

        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"


async def test_patch_oversized_short_name_returns_422(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "G2"})
        team_id = created.json()["id"]

        resp = await client.patch(f"{BASE}/{team_id}", json={"short_name": "x" * 17})

        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"


async def test_patch_oversized_slug_returns_422(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "G2"})
        team_id = created.json()["id"]

        resp = await client.patch(f"{BASE}/{team_id}", json={"slug": "x" * 65})

        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"


# -------------------------------------------------------- duplicate slug


async def test_duplicate_slug_on_create_returns_409(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        first = await client.post(BASE, json={"name": "First", "slug": "shared"})
        assert first.status_code == 201

        second = await client.post(BASE, json={"name": "Second", "slug": "shared"})

        assert second.status_code == 409
        assert second.json()["error"]["code"] == "TEAM_SLUG_TAKEN"
        assert await _count(session_factory) == 1  # nothing partial persisted


async def test_duplicate_slug_on_update_returns_409(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        await client.post(BASE, json={"name": "Holder", "slug": "taken"})
        other = await client.post(BASE, json={"name": "Other"})
        other_id = other.json()["id"]

        resp = await client.patch(f"{BASE}/{other_id}", json={"slug": "taken"})

        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "TEAM_SLUG_TAKEN"


async def test_own_slug_update_is_allowed(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "Mine", "slug": "mine"})
        team_id = created.json()["id"]

        resp = await client.patch(f"{BASE}/{team_id}", json={"slug": "mine"})

        assert resp.status_code == 200
        assert resp.json()["slug"] == "mine"


# -------------------------------------------------- DB CHECK constraints


async def test_check_constraint_rejects_negative_current_elo(session_factory) -> None:
    async with session_factory() as session:
        session.add(Team(name="Bad", current_elo=Decimal(-1)))
        with pytest.raises(IntegrityError, match="teams_current_elo_nonneg"):
            await session.commit()
        await session.rollback()


async def test_check_constraint_rejects_negative_peak_elo(session_factory) -> None:
    async with session_factory() as session:
        session.add(Team(name="Bad", peak_elo=Decimal("-0.01")))
        with pytest.raises(IntegrityError, match="teams_peak_elo_nonneg"):
            await session.commit()
        await session.rollback()


async def test_check_constraint_rejects_negative_matches_played(session_factory) -> None:
    async with session_factory() as session:
        session.add(Team(name="Bad", matches_played=-1))
        with pytest.raises(IntegrityError, match="teams_matches_played_nonneg"):
            await session.commit()
        await session.rollback()


async def test_check_constraint_rejects_negative_series_wins(session_factory) -> None:
    async with session_factory() as session:
        session.add(Team(name="Bad", series_wins=-1))
        with pytest.raises(IntegrityError, match="teams_series_wins_nonneg"):
            await session.commit()
        await session.rollback()


async def test_check_constraint_rejects_negative_series_losses(session_factory) -> None:
    async with session_factory() as session:
        session.add(Team(name="Bad", series_losses=-1))
        with pytest.raises(IntegrityError, match="teams_series_losses_nonneg"):
            await session.commit()
        await session.rollback()


# ----------------------------------------------------------- no DELETE


async def test_no_delete_route_retirement_is_patch(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        created = await client.post(BASE, json={"name": "Eternal"})
        team_id = created.json()["id"]

        resp = await client.delete(f"{BASE}/{team_id}")

        assert resp.status_code == 405
        # the team still exists (never hard-deleted)
        assert (await _row(session_factory, team_id)).is_active is True


# ------------------------------------------------------- service-token gate


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


async def test_reads_require_service_token_in_production(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory, app_env="production")
    async with _client(app) as client:
        listed = await client.get(BASE)
        assert listed.status_code == 401

        ok = await client.get(BASE, headers=service_token_headers())
        assert ok.status_code == 200
        assert ok.json() == []


# ------------------------------------ create-or-get by quest_saved_team_id


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
