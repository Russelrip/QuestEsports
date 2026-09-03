"""Real-Postgres match import integration tests (plan Task 8 + fix round 1, App. D).

The import service runs against real migrated-schema sessions with a
fixture-driven fake ``HenrikClient`` (real mapper, no network). Covers the
concurrency and atomicity guarantees that need a real database:

- concurrent duplicate imports of the same ``henrik_match_id`` converge to
  exactly one row; both calls return the same row with one ``created=true``
  and one ``created=false`` (design §7.3 unique-conflict race);
- a repository failure after the match insert rolls back the whole transaction
  (no match, no players, no snapshots remain);
- ``raw_payload`` is persisted byte-for-byte equal to the fixture ``data``
  envelope (design §7.4);
- double import creates no duplicate ``match_players`` rows;
- fix round 1: an identity-mismatched payload rejects with no writes; an
  upstream failure leaves no open write transaction/connection behind;
  ``refresh=true`` updates an existing match transactionally in place;
  import preserves known account-derived player metadata; the production
  import route enforces service-token auth and maps malformed ``match_id``
  bodies to ``INVALID_RIOT_ID`` 422.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app.api.dependencies import get_import_service
from app.api.errors import AppError
from app.config import Settings
from app.db.models import Match, MatchPlayer, Player
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.integrations.henrik.exceptions import HenrikUnavailableError
from app.integrations.henrik.mapper import HenrikMapper
from app.integrations.henrik.models import HenrikMatchDetailEnvelope
from app.main import create_app
from app.schemas.matches import MatchImportResponse
from app.services.match_import_service import MatchImportService
from tests.token_helpers import production_settings, service_token_headers

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"

MATCH_ID_1 = "00000000-0000-0000-0000-000000000001"


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


class FakeHenrik:
    """Serves pinned match-detail fixtures through the real mapper."""

    def __init__(self, fixtures: dict[str, dict]) -> None:
        self.fixtures = fixtures
        self._mapper = HenrikMapper()

    async def get_match_detail(self, match_id: str, *, affinity: str) -> HenrikMatchDetailEnvelope:
        envelope = self.fixtures[match_id]
        return HenrikMatchDetailEnvelope(
            status=envelope["status"],
            data=self._mapper.to_match_detail(envelope["data"]),
            raw=envelope,
        )


class FailingHenrik:
    """Raises before any payload work — proves no write transaction opens."""

    async def get_match_detail(self, match_id: str, *, affinity: str):
        raise HenrikUnavailableError("upstream down", request_id=None)


class FailingSnapshotsMatchRepository(MatchRepository):
    """Injects a failure after the match insert, inside the import transaction."""

    async def insert_match_players(self, *, match_id, snapshots):
        raise RuntimeError("injected failure after match insert")


def _service(session, match_id: str, fixture: dict) -> MatchImportService:
    return MatchImportService(
        session=session,
        henrik=FakeHenrik({match_id: fixture}),  # type: ignore[arg-type]
        player_repo=PlayerRepository(session),
        match_repo=MatchRepository(session),
        mapper=HenrikMapper(),
    )


# ------------------------------------------------------------- single import


async def test_import_creates_match_players_and_raw_payload(session_factory) -> None:
    fixture = _load("completed_custom.json")
    match_id = fixture["data"]["metadata"]["match_id"]

    async with session_factory() as session:
        result = await _service(session, match_id, fixture).import_match(match_id, "eu")
        assert result.created is True

    async with session_factory() as session:
        row = (
            await session.execute(select(Match).where(Match.henrik_match_id == match_id))
        ).scalar_one()
        assert row.map_name == "Ascent"
        assert row.red_score == 13
        assert row.blue_score == 9
        assert row.winning_side == "red"
        # raw detail data envelope persisted byte-for-byte
        assert row.raw_payload == fixture["data"]
        snapshots = (
            (await session.execute(select(MatchPlayer).where(MatchPlayer.match_id == row.id)))
            .scalars()
            .all()
        )
        assert len(snapshots) == 2
        assert await session.scalar(select(func.count()).select_from(Player)) == 2


# -------------------------------------------------- concurrent duplicate import


async def test_concurrent_duplicate_import_converges_to_one_row(session_factory) -> None:
    fixture = _load("completed_custom.json")
    match_id = fixture["data"]["metadata"]["match_id"]

    async def import_once() -> tuple[bool, str]:
        async with session_factory() as session:
            result = await _service(session, match_id, fixture).import_match(match_id, "eu")
            return result.created, str(result.match.id)

    results = await asyncio.gather(import_once(), import_once())

    # one caller created the row, the other lost the race and re-selected it
    assert {created for created, _ in results} == {True, False}
    assert len({match_id_ for _, match_id_ in results}) == 1

    async with session_factory() as session:
        rows = (
            await session.execute(select(Match).where(Match.henrik_match_id == match_id))
        ).scalars().all()
        assert len(rows) == 1
        snapshots = (
            (await session.execute(select(MatchPlayer).where(MatchPlayer.match_id == rows[0].id)))
            .scalars()
            .all()
        )
        assert len(snapshots) == 2
        assert await session.scalar(select(func.count()).select_from(Player)) == 2


# --------------------------------------------------- rollback on mid-flight failure


async def test_injected_failure_after_match_insert_rolls_back_everything(session_factory) -> None:
    fixture = _load("completed_custom.json")
    match_id = fixture["data"]["metadata"]["match_id"]

    with pytest.raises(RuntimeError):
        async with session_factory() as session:
            svc = MatchImportService(
                session=session,
                henrik=FakeHenrik({match_id: fixture}),  # type: ignore[arg-type]
                player_repo=PlayerRepository(session),
                match_repo=FailingSnapshotsMatchRepository(session),
                mapper=HenrikMapper(),
            )
            await svc.import_match(match_id, "eu")

    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(Match)) == 0
        assert await session.scalar(select(func.count()).select_from(MatchPlayer)) == 0
        assert await session.scalar(select(func.count()).select_from(Player)) == 0


# --------------------------------------------------- sequential double import


async def test_double_import_creates_no_duplicate_match_players(session_factory) -> None:
    fixture = _load("completed_custom.json")
    match_id = fixture["data"]["metadata"]["match_id"]

    async with session_factory() as session:
        first = await _service(session, match_id, fixture).import_match(match_id, "eu")
        assert first.created is True

    async with session_factory() as session:
        second = await _service(session, match_id, fixture).import_match(match_id, "eu")
        assert second.created is False
        assert second.match.id == first.match.id

    async with session_factory() as session:
        row = (
            await session.execute(select(Match).where(Match.henrik_match_id == match_id))
        ).scalar_one()
        snapshots = (
            (await session.execute(select(MatchPlayer).where(MatchPlayer.match_id == row.id)))
            .scalars()
            .all()
        )
        assert len(snapshots) == 2
        assert await session.scalar(select(func.count()).select_from(Player)) == 2


# ------------------------------------------------------ HTTP route 201/200


async def test_import_route_returns_201_then_200(session_factory, monkeypatch) -> None:
    fixture = _load("completed_custom.json")
    match_id = fixture["data"]["metadata"]["match_id"]

    # app_env=test so require_admin is bypassed (Global Constraints 11)
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: Settings(app_env="test"),
    )
    app = create_app()

    async def _override():
        async with session_factory() as session:
            yield _service(session, match_id, fixture)

    app.dependency_overrides[get_import_service] = _override

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/api/v1/matches/import", json={"match_id": match_id, "affinity": "eu"})
        assert first.status_code == 201
        assert first.json()["created"] is True

        second = await client.post("/api/v1/matches/import", json={"match_id": match_id, "affinity": "eu"})
        assert second.status_code == 200
        assert second.json()["created"] is False
        assert second.json()["match"]["id"] == first.json()["match"]["id"]

    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(Match)) == 1


# -------------------------------------------- identity mismatch: no writes


async def test_match_id_mismatch_rejects_without_writes(session_factory) -> None:
    fixture = deepcopy(_load("completed_custom.json"))
    match_id = fixture["data"]["metadata"]["match_id"]
    fixture["data"]["metadata"]["match_id"] = "00000000-0000-0000-0000-000000000099"

    with pytest.raises(AppError) as excinfo:
        async with session_factory() as session:
            await _service(session, match_id, fixture).import_match(match_id, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(Match)) == 0
        assert await session.scalar(select(func.count()).select_from(MatchPlayer)) == 0
        assert await session.scalar(select(func.count()).select_from(Player)) == 0


# --------------------------------- upstream failure: no open transaction


async def test_upstream_failure_leaves_no_open_transaction(session_factory) -> None:
    async with session_factory() as session:
        svc = MatchImportService(
            session=session,
            henrik=FailingHenrik(),  # type: ignore[arg-type]
            player_repo=PlayerRepository(session),
            match_repo=MatchRepository(session),
            mapper=HenrikMapper(),
        )
        with pytest.raises(AppError) as excinfo:
            await svc.import_match(MATCH_ID_1, "eu")

        assert excinfo.value.code == "HENRIK_UNAVAILABLE"
        assert excinfo.value.status == 503
        # the fetch failed before any write transaction/connection was opened
        assert not session.in_transaction()
        # and the session is still fully usable afterwards
        assert await session.scalar(select(func.count()).select_from(Match)) == 0


# ------------------------------------------------- refresh (real Postgres)


async def test_refresh_updates_match_transactionally(session_factory) -> None:
    fixture_a = _load("completed_custom.json")
    match_id = fixture_a["data"]["metadata"]["match_id"]
    fixture_b = deepcopy(fixture_a)
    fixture_b["data"]["metadata"]["map"]["id"] = "map-bind"
    fixture_b["data"]["metadata"]["map"]["name"] = "Bind"
    fixture_b["data"]["teams"][1]["rounds"]["won"] = 5  # blue_score 13 -> 5

    async def run(fixture: dict, *, refresh: bool) -> MatchImportResponse:
        async with session_factory() as session:
            return await _service(session, match_id, fixture).import_match(
                match_id, "eu", refresh=refresh
            )

    first = await run(fixture_a, refresh=False)
    assert first.created is True
    assert first.match.map_name == "Ascent"

    refreshed = await run(fixture_b, refresh=True)
    assert refreshed.created is False
    assert refreshed.match.id == first.match.id  # same row, never renamed
    assert refreshed.match.henrik_match_id == match_id
    assert refreshed.match.map_name == "Bind"
    assert refreshed.match.blue_score == 5

    async with session_factory() as session:
        row = (
            await session.execute(select(Match).where(Match.henrik_match_id == match_id))
        ).scalar_one()
        assert row.map_name == "Bind"
        assert row.blue_score == 5
        assert row.refreshed_at is not None
        assert await session.scalar(select(func.count()).select_from(Match)) == 1
        snapshots = (
            (await session.execute(select(MatchPlayer).where(MatchPlayer.match_id == row.id)))
            .scalars()
            .all()
        )
        assert len(snapshots) == 2


# ------------------------------------------- player metadata preservation


async def test_import_preserves_known_player_metadata(session_factory) -> None:
    fixture = _load("completed_custom.json")
    match_id = fixture["data"]["metadata"]["match_id"]
    resolved_at = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)

    async with session_factory() as session:
        known = await PlayerRepository(session).upsert_by_puuid(
            puuid="puuid_p_a",
            current_name="PlayerA",
            current_tag="A",
            affinity="eu",
            platforms=["PC", "Console"],
            henrik_updated_at=resolved_at,
        )
        await session.commit()
        known_id = known.id

    async with session_factory() as session:
        result = await _service(session, match_id, fixture).import_match(match_id, "eu")
        assert result.created is True

    async with session_factory() as session:
        row = (await session.execute(select(Player).where(Player.id == known_id))).scalar_one()
        # display identity follows the payload...
        assert row.current_name == "PlayerA"
        assert row.current_tag == "A"
        # ...but account-derived metadata is never overwritten by import data
        assert row.affinity == "eu"
        assert row.platforms == ["PC", "Console"]
        assert row.henrik_updated_at == resolved_at


async def test_account_resolve_after_import_still_updates_metadata(session_factory) -> None:
    """The import-path upsert must not block later account resolution either."""
    fixture = _load("completed_custom.json")
    match_id = fixture["data"]["metadata"]["match_id"]

    async with session_factory() as session:
        result = await _service(session, match_id, fixture).import_match(match_id, "eu")
        assert result.created is True

    async with session_factory() as session:
        player = await PlayerRepository(session).upsert_by_puuid(
            puuid="puuid_p_a",
            current_name="PlayerA",
            current_tag="A",
            affinity="na",
            platforms=["PC"],
            henrik_updated_at=datetime(2026, 8, 12, 14, 0, tzinfo=UTC),
        )
        await session.commit()
        assert player.affinity == "na"
        assert player.henrik_updated_at == datetime(2026, 8, 12, 14, 0, tzinfo=UTC)


# ------------------------------------------------- production token + 422


def _production_app(monkeypatch):
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: production_settings(app_env="production"),
    )
    app = create_app()

    async def _stub_import_service():
        yield object()  # never reached: token/validation gates fire first

    app.dependency_overrides[get_import_service] = _stub_import_service
    return app


async def test_production_import_requires_service_token(monkeypatch) -> None:
    app = _production_app(monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/v1/matches/import", json={"match_id": MATCH_ID_1, "affinity": "eu"})
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"


async def test_production_malformed_match_id_returns_invalid_riot_id(monkeypatch) -> None:
    app = _production_app(monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/matches/import",
            json={"match_id": "not-a-match-id!", "affinity": "eu"},
            headers=service_token_headers(),
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_RIOT_ID"


async def test_production_invalid_refresh_returns_invalid_request(monkeypatch) -> None:
    # Fix round 2: only errors located on match_id map to INVALID_RIOT_ID; an
    # invalid refresh is an unrelated body error that keeps INVALID_REQUEST.
    app = _production_app(monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/matches/import",
            json={"match_id": MATCH_ID_1, "refresh": "nope"},
            headers=service_token_headers(),
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"


async def test_production_malformed_json_returns_invalid_request(monkeypatch) -> None:
    app = _production_app(monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/matches/import",
            content=b'{"match_id": "00000000-0000-0000-0000-000000000001", "refresh":',
            headers={"content-type": "application/json", **service_token_headers()},
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"
