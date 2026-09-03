"""Real-Postgres player resolve integration tests (plan Task 6, App. D).

The full API flow runs against the app with ``get_player_service`` overridden to
bind a real migrated-schema session and a fixture-driven fake Henrik transport:
``httpx.MockTransport`` feeds the checked-in Wave 0 fixtures through the real
``HenrikClient`` (envelope validation + mapper included). No live Henrik calls.
Service-token protection (delta D1; spec §6.3) applies to every player route in
the ``production`` environment. Everything else runs with ``app_env=test`` so
``require_service_token`` is bypassed. Skipped when
``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app.api.dependencies import get_player_service
from app.config import Settings
from app.db.models import Player
from app.db.repositories.player_repository import PlayerRepository
from app.integrations.henrik.client import HenrikClient
from app.main import create_app
from app.services.player_service import PlayerService
from tests.token_helpers import production_settings, service_token_headers

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik"
BASE_URL = "https://api.henrikdev.xyz"
VALID_ACCOUNT = "account_v2/valid.json"
ERROR_404_CODE22 = "account_v2/error_404_code22.json"


def _load(relative: str) -> dict:
    with (FIXTURE_DIR / relative).open(encoding="utf-8") as fh:
        return json.load(fh)


def _fake_henrik(fixture: dict, status: int = 200) -> HenrikClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=fixture)

    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return HenrikClient(Settings(henrik_api_key="test-key"), http=http)


def _fake_henrik_sequence(fixtures: list[dict], status: int = 200) -> HenrikClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=fixtures.pop(0))

    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return HenrikClient(Settings(henrik_api_key="test-key"), http=http)


def _app_with_henrik(monkeypatch: pytest.MonkeyPatch, session_factory, henrik: HenrikClient, *, app_env: str = "test"):
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
            yield PlayerService(session=session, henrik=henrik, repo=PlayerRepository(session))

    app.dependency_overrides[get_player_service] = _override
    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _player_count(session_factory) -> int:
    async with session_factory() as session:
        return await session.scalar(select(func.count()).select_from(Player))


async def _seed_player(session_factory, *, puuid: str = "puuid_p_a", name: str = "PlayerA", tag: str = "A") -> str:
    """Insert a player through the repository (fully-loaded RETURNING row)."""
    async with session_factory() as session:
        player = await PlayerRepository(session).upsert_by_puuid(
            puuid=puuid,
            current_name=name,
            current_tag=tag,
            affinity="eu",
            platforms=["PC"],
            henrik_updated_at=None,
        )
        await session.commit()
        return str(player.id)


# ------------------------------------------------------------ resolve + lookup

async def test_resolve_persists_row_and_lookup_routes_return_it(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(VALID_ACCOUNT))
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post("/api/v1/players/resolve", json={"name": "PlayerA", "tag": "A"})
            assert resp.status_code == 200
            body = resp.json()
            assert body["puuid"] == "puuid_p_a"
            assert body["name"] == "PlayerA"
            assert body["tag"] == "A"
            assert body["affinity"] == "eu"
            assert body["platforms"] == ["PC"]
            player_id = body["id"]

            # a row was actually persisted
            assert await _player_count(session_factory) == 1
            async with session_factory() as session:
                row = (
                    await session.execute(select(Player).where(Player.puuid == "puuid_p_a"))
                ).scalar_one()
                assert row.current_name == "PlayerA"
                assert row.current_tag == "A"
                assert row.affinity == "eu"
                # platforms round-trips as a JSON list, never a dict
                assert isinstance(row.platforms, list)
                assert row.platforms == ["PC"]
                assert row.first_seen_at is not None
                assert row.henrik_updated_at is not None

            get_resp = await client.get(f"/api/v1/players/{player_id}")
            assert get_resp.status_code == 200
            assert get_resp.json()["puuid"] == "puuid_p_a"

            by_puuid_resp = await client.get("/api/v1/players/by-puuid/puuid_p_a")
            assert by_puuid_resp.status_code == 200
            assert by_puuid_resp.json()["id"] == player_id
    finally:
        await henrik.aclose()


async def test_duplicate_resolve_returns_same_id_without_new_row(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(VALID_ACCOUNT))
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            first = await client.post("/api/v1/players/resolve", json={"name": "PlayerA", "tag": "A"})
            second = await client.post("/api/v1/players/resolve", json={"name": "PlayerA", "tag": "A"})
            assert first.status_code == 200
            assert second.status_code == 200
            assert first.json()["id"] == second.json()["id"]
            assert await _player_count(session_factory) == 1
    finally:
        await henrik.aclose()


async def test_reresolve_changed_name_same_puuid_updates_display_keeps_first_seen(session_factory, monkeypatch) -> None:
    renamed = deepcopy(_load(VALID_ACCOUNT))
    renamed["data"]["name"] = "PlayerB"
    renamed["data"]["tag"] = "B"
    henrik = _fake_henrik_sequence([_load(VALID_ACCOUNT), renamed])
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            first = await client.post("/api/v1/players/resolve", json={"name": "PlayerA", "tag": "A"})
            assert first.status_code == 200
            first_id = first.json()["id"]

            async with session_factory() as session:
                before = (await session.get(Player, first_id)).first_seen_at

            second = await client.post("/api/v1/players/resolve", json={"name": "PlayerB", "tag": "B"})
            assert second.status_code == 200
            assert second.json()["id"] == first_id  # same row, no new row
            assert second.json()["name"] == "PlayerB"
            assert second.json()["tag"] == "B"

            async with session_factory() as session:
                row = await session.get(Player, first_id)
                assert row.current_name == "PlayerB"
                assert row.current_tag == "B"
                assert row.first_seen_at == before  # never changes
                assert row.last_seen_at >= before
            assert await _player_count(session_factory) == 1
    finally:
        await henrik.aclose()


# --------------------------------------------------------------- Henrik 404/22

async def test_resolve_henrik_404_code22_returns_player_not_found(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(ERROR_404_CODE22), status=404)
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post("/api/v1/players/resolve", json={"name": "Ghost", "tag": "X"})
            assert resp.status_code == 404
            body = resp.json()
            assert body["error"]["code"] == "PLAYER_NOT_FOUND"
            assert body["error"]["request_id"]
        assert await _player_count(session_factory) == 0  # nothing persisted
    finally:
        await henrik.aclose()


# ------------------------------------------------------- invalid identifiers

async def test_resolve_malformed_name_returns_invalid_riot_id(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(VALID_ACCOUNT))
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post("/api/v1/players/resolve", json={"name": "A$B", "tag": "A"})
            assert resp.status_code == 422
            assert resp.json()["error"]["code"] == "INVALID_RIOT_ID"
    finally:
        await henrik.aclose()


async def test_get_player_malformed_uuid_returns_invalid_riot_id(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(VALID_ACCOUNT))
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.get("/api/v1/players/not-a-uuid")
            assert resp.status_code == 422
            assert resp.json()["error"]["code"] == "INVALID_RIOT_ID"
    finally:
        await henrik.aclose()


async def test_get_unknown_player_by_id_returns_player_not_found(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(VALID_ACCOUNT))
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.get("/api/v1/players/00000000-0000-0000-0000-000000000099")
            assert resp.status_code == 404
            assert resp.json()["error"]["code"] == "PLAYER_NOT_FOUND"
    finally:
        await henrik.aclose()


# ------------------------------------------------------ service-token gate

async def test_resolve_requires_service_token_in_production(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(VALID_ACCOUNT))
    app = _app_with_henrik(monkeypatch, session_factory, henrik, app_env="production")
    try:
        async with _client(app) as client:
            resp = await client.post("/api/v1/players/resolve", json={"name": "PlayerA", "tag": "A"})
            assert resp.status_code == 401
            assert resp.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
    finally:
        await henrik.aclose()


async def test_get_routes_require_service_token_in_production(session_factory, monkeypatch) -> None:
    henrik = _fake_henrik(_load(VALID_ACCOUNT))
    app = _app_with_henrik(monkeypatch, session_factory, henrik, app_env="production")
    player_id = await _seed_player(session_factory)
    try:
        async with _client(app) as client:
            denied = await client.get(f"/api/v1/players/{player_id}")
            assert denied.status_code == 401

            headers = service_token_headers()
            by_id = await client.get(f"/api/v1/players/{player_id}", headers=headers)
            assert by_id.status_code == 200
            assert by_id.json()["puuid"] == "puuid_p_a"

            by_puuid = await client.get("/api/v1/players/by-puuid/puuid_p_a", headers=headers)
            assert by_puuid.status_code == 200
            assert by_puuid.json()["id"] == player_id

            # identifiers are still validated behind the service-token gate
            malformed = await client.get("/api/v1/players/not-a-uuid", headers=headers)
            assert malformed.status_code == 422
            assert malformed.json()["error"]["code"] == "INVALID_RIOT_ID"

            unknown = await client.get("/api/v1/players/00000000-0000-0000-0000-000000000099", headers=headers)
            assert unknown.status_code == 404
            assert unknown.json()["error"]["code"] == "PLAYER_NOT_FOUND"
    finally:
        await henrik.aclose()


# ---------------------------------------------- malformed upstream accounts

async def test_resolve_empty_upstream_puuid_returns_henrik_unavailable(session_factory, monkeypatch) -> None:
    fixture = deepcopy(_load(VALID_ACCOUNT))
    fixture["data"]["puuid"] = ""
    henrik = _fake_henrik(fixture)
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post("/api/v1/players/resolve", json={"name": "PlayerA", "tag": "A"})
            assert resp.status_code == 503
            body = resp.json()
            assert body["error"]["code"] == "HENRIK_UNAVAILABLE"
            assert body["error"]["request_id"]
        assert await _player_count(session_factory) == 0  # nothing persisted
    finally:
        await henrik.aclose()


async def test_resolve_missing_upstream_puuid_returns_henrik_unavailable(session_factory, monkeypatch) -> None:
    fixture = deepcopy(_load(VALID_ACCOUNT))
    del fixture["data"]["puuid"]
    henrik = _fake_henrik(fixture)
    app = _app_with_henrik(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post("/api/v1/players/resolve", json={"name": "PlayerA", "tag": "A"})
            assert resp.status_code == 503
            body = resp.json()
            assert body["error"]["code"] == "HENRIK_UNAVAILABLE"
            assert body["error"]["request_id"]
            # stable error only: no upstream validation text leaks
            assert "Field required" not in resp.text
            assert "puuid" not in resp.text
        assert await _player_count(session_factory) == 0
    finally:
        await henrik.aclose()


# --------------------------------------- concurrency-safe upsert (ON CONFLICT)

async def test_upsert_update_preserves_first_seen_at(session_factory) -> None:
    async with session_factory() as session:
        repo = PlayerRepository(session)
        first = await repo.upsert_by_puuid(
            puuid="puuid-fs-1",
            current_name="PlayerA",
            current_tag="A",
            affinity="eu",
            platforms=["PC"],
            henrik_updated_at=None,
        )
        await session.commit()
        first_seen = first.first_seen_at
        player_id = first.id

    async with session_factory() as session:
        repo = PlayerRepository(session)
        second = await repo.upsert_by_puuid(
            puuid="puuid-fs-1",
            current_name="PlayerB",
            current_tag="B",
            affinity="na",
            platforms=["PC", "Console"],
            henrik_updated_at=None,
        )
        await session.commit()

    assert second.id == player_id  # same canonical row
    assert second.current_name == "PlayerB"
    assert second.affinity == "na"
    assert second.platforms == ["PC", "Console"]
    assert isinstance(second.platforms, list)
    assert second.first_seen_at == first_seen  # preserved by ON CONFLICT DO UPDATE
    assert second.created_at is not None


async def test_upsert_refreshes_identity_map_instance_in_same_session(session_factory) -> None:
    """Regression: a conflicting upsert must not return a stale identity-map row.

    ``INSERT ... ON CONFLICT DO UPDATE RETURNING(Player)`` reuses any instance
    already loaded in the session for the row's primary key; without
    ``populate_existing`` the returned object would carry the OLD name/tag/
    platforms while the database already holds the new ones.
    """
    async with session_factory() as session:
        repo = PlayerRepository(session)
        await repo.upsert_by_puuid(
            puuid="puuid-idmap-1",
            current_name="OldName",
            current_tag="A",
            affinity="eu",
            platforms=["PC"],
            henrik_updated_at=None,
        )
        await session.commit()

        # Load the row into this session's identity map...
        loaded = await repo.get_by_puuid("puuid-idmap-1")
        assert loaded.current_name == "OldName"
        first_seen = loaded.first_seen_at

        # ...then run a conflicting upsert in the SAME session. The returned
        # object must carry the new values, never the stale identity map.
        updated = await repo.upsert_by_puuid(
            puuid="puuid-idmap-1",
            current_name="NewName",
            current_tag="B",
            affinity="na",
            platforms=["PC", "Console"],
            henrik_updated_at=None,
        )
        assert updated.current_name == "NewName"
        assert updated.current_tag == "B"
        assert updated.affinity == "na"
        assert updated.platforms == ["PC", "Console"]
        assert updated.first_seen_at == first_seen  # still preserved
        await session.commit()

        # subsequent reads in the same session agree with the write
        reread = await repo.get_by_puuid("puuid-idmap-1")
        assert reread.current_name == "NewName"
        assert reread.platforms == ["PC", "Console"]
        assert reread.first_seen_at == first_seen

    # a fresh session confirms the persisted values
    async with session_factory() as session:
        row = (
            await session.execute(select(Player).where(Player.puuid == "puuid-idmap-1"))
        ).scalar_one()
        assert row.current_name == "NewName"
        assert row.platforms == ["PC", "Console"]
        assert row.first_seen_at == first_seen


async def test_concurrent_upsert_same_puuid_converges_to_one_row(session_factory) -> None:
    puuid = "puuid-race-1"

    async def upsert(name: str) -> None:
        async with session_factory() as session:
            repo = PlayerRepository(session)
            await repo.upsert_by_puuid(
                puuid=puuid,
                current_name=name,
                current_tag="T",
                affinity="eu",
                platforms=["PC"],
                henrik_updated_at=None,
            )
            await session.commit()

    # 8 sessions race to insert/update the same PUUID simultaneously; the
    # atomic INSERT ... ON CONFLICT DO UPDATE must let every one succeed
    # (no unique violation escapes) and converge to a single canonical row.
    results = await asyncio.gather(*(upsert(f"Player{i}") for i in range(8)), return_exceptions=True)
    failures = [r for r in results if isinstance(r, Exception)]
    assert not failures, f"concurrent upsert leaked an error: {failures!r}"

    async with session_factory() as session:
        rows = (await session.execute(select(Player).where(Player.puuid == puuid))).scalars().all()
    assert len(rows) == 1
    assert rows[0].current_name.startswith("Player")
