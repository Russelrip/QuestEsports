"""Quest-facing contract integration tests (spec §11.2, §11.4; plan Task 12).

Drives the FastAPI app exactly as the Quest backend calls it — the aggregate
contract that pins the Quest surface end to end:

- team create-or-get by ``quest_saved_team_id`` (delta D2; §8.1);
- series create-or-get by ``external_quest_series_id`` with
  ``anchor_player_*`` Riot IDs (deltas D3/D6);
- the ID-naming contract: Henrik TEXT id in, internal UUID ``matches.id`` out
  (delta D10 / spec §4.4), re-import is a 200 ``created=false`` (ADR-019);
- attach by internal UUID -> preview -> rated finalize with the actor/operation
  audit persisted from the ``X-Quest-Actor-Id``/``X-Quest-Operation-Id``
  headers (delta D7; the test-env synthetic-principal seam), double-finalize
  409 ``SERIES_ALREADY_FINALIZED``;
- unrated finalize records no ELO and no counters (delta D4);
- the ``by-henrik-id`` detail read serves the internal UUID for a TEXT id.

Every mutation goes through the real routes with the real migrated-schema
services; only the Henrik client is stubbed (FakeHenrik fixtures bound at
app-build time, real mapper, no network). Skipped when ``TEST_DATABASE_URL`` is
unset (see ``tests/integration/conftest.py``).
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
    get_library_service,
    get_rating_service,
    get_series_service,
    get_team_service,
)
from app.config import Settings
from app.db.models import Series, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.db.repositories.team_repository import TeamRepository
from app.integrations.henrik.mapper import HenrikMapper
from app.main import create_app
from app.services.match_import_service import MatchImportService
from app.services.match_library_service import MatchLibraryService
from app.services.player_service import PlayerService
from app.services.rating_service import RatingService
from app.services.series_service import SeriesService
from app.services.team_service import TeamService

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"
_ID = "00000000-0000-0000-0000-0000000000%s"

# Anchors (spec anchor facts, Task 7 helpers): PlayerA#A resolves to
# ``puuid_p_a`` and plays the Red side; PlayerB#B resolves to ``puuid_p_b``
# and plays Blue. Imported players satisfy the player cache, so anchor
# resolution at series-create must never touch the network.
ANCHOR_A = {"name": "PlayerA", "tag": "A"}
ANCHOR_B = {"name": "PlayerB", "tag": "B"}
SERIES_PLAYED_AT = "2026-08-12T18:40:00Z"  # finalize requires played_at (ADR-016)


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _completed_variant(henrik_match_id: str, *, red_wins: bool, map_name: str) -> dict:
    """A completed fixture, winner flipped to blue when ``red_wins`` is false."""
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
    """Anchor resolution at series-create must hit the player cache."""

    async def get_account(self, *args, **kwargs):
        raise AssertionError("anchor resolution must hit the player cache")


def _app(
    monkeypatch: pytest.MonkeyPatch,
    session_factory,
    *,
    fixtures: dict[str, dict] | None = None,
):
    """App with the service overrides bound to the real migrated-schema sessions.

    The import service's FakeHenrik is bound HERE, at app-build time, from the
    per-test ``fixtures`` map ({henrik text id -> fixture envelope}) — the
    cleaner design the Task 12 brief explicitly permits over the
    ``_import_fixture_henrik`` override-mutation hack. ``get_settings`` is
    patched to ``app_env="test"`` so the service-token gate bypasses and builds
    its synthetic principal from the optional audit headers.
    """
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: Settings(app_env="test"),
    )
    app = create_app()
    henrik = FakeHenrik(fixtures or {})

    async def _team_override():
        async with session_factory() as session:
            yield TeamService(session=session, repo=TeamRepository(session))

    async def _series_override():
        async with session_factory() as session:
            yield SeriesService(
                session=session,
                series_repo=SeriesRepository(session),
                match_repo=MatchRepository(session),
                player_svc=PlayerService(
                    session=session, henrik=_NoNetworkHenrik(), repo=PlayerRepository(session)  # type: ignore[arg-type]
                ),
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
                henrik=henrik,  # type: ignore[arg-type]
                player_repo=PlayerRepository(session),
                match_repo=MatchRepository(session),
                mapper=HenrikMapper(),
            )

    async def _library_override():
        async with session_factory() as session:
            yield MatchLibraryService(
                session=session,
                match_repo=MatchRepository(session),
                settings=Settings(app_env="test"),
            )

    app.dependency_overrides[get_team_service] = _team_override
    app.dependency_overrides[get_series_service] = _series_override
    app.dependency_overrides[get_rating_service] = _rating_override
    app.dependency_overrides[get_import_service] = _import_override
    app.dependency_overrides[get_library_service] = _library_override
    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _bind_teams(client, names: list[tuple[str, str]]) -> dict[str, str]:
    """Create-or-get the fixture teams through the API; return ``{name: id}``."""
    bound: dict[str, str] = {}
    for name, quest_id in names:
        resp = await client.post(
            "/api/v1/teams", json={"name": name, "quest_saved_team_id": quest_id}
        )
        assert resp.status_code == 201
        bound[name] = resp.json()["id"]
    return bound


async def _import(client, henrik_id: str, *, affinity: str = "eu") -> dict:
    resp = await client.post("/api/v1/matches/import", json={"match_id": henrik_id, "affinity": affinity})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


# ------------------------------------------------------------------ contracts


async def test_team_bind_create_or_get_contract(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        payload = {"name": "Sentinels", "short_name": "SEN", "quest_saved_team_id": "quest-team-100"}
        first = await client.post("/api/v1/teams", json=payload)
        assert first.status_code == 201
        second = await client.post("/api/v1/teams", json=payload)
        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]
        assert second.json()["quest_saved_team_id"] == "quest-team-100"


async def test_import_and_series_create_or_get_contract(session_factory, monkeypatch) -> None:
    henrik_id = _ID % "01"
    app = _app(
        monkeypatch,
        session_factory,
        fixtures={henrik_id: _completed_variant(henrik_id, red_wins=True, map_name="Ascent")},
    )
    async with _client(app) as client:
        # Bind both teams through the create-or-get surface.
        teams = await _bind_teams(client, [("Alpha", "qt-a"), ("Beta", "qt-b")])
        team_a_id, team_b_id = teams["Alpha"], teams["Beta"]

        # Import via the canonical Henrik TEXT id -> internal matches.id UUID.
        imported = await client.post(
            "/api/v1/matches/import", json={"match_id": henrik_id, "affinity": "eu"}
        )
        assert imported.status_code == 201
        assert imported.json()["created"] is True  # top level, not inside "match"
        match = imported.json()["match"]
        internal_uuid = uuid.UUID(match["id"])  # internal matches.id
        assert match["henrik_match_id"] == henrik_id  # the text id round-trips
        assert match["map_name"] == "Ascent"

        # Re-import the SAME text id -> 200 created=false, same internal id.
        again = await client.post(
            "/api/v1/matches/import", json={"match_id": henrik_id, "affinity": "eu"}
        )
        assert again.status_code == 200
        assert again.json()["created"] is False
        assert again.json()["match"]["id"] == match["id"]

        # Series create-or-get keyed on the external Quest id + anchor Riot IDs.
        series_payload = {
            "team_a_id": team_a_id,
            "team_b_id": team_b_id,
            "format": "bo1",
            "importance": "regular",
            "played_at": SERIES_PLAYED_AT,  # finalize requires played_at (ADR-016)
            "external_quest_series_id": "quest-series-100",
            "anchor_player_a": ANCHOR_A,
            "anchor_player_b": ANCHOR_B,
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

        # Preview is the derived "ready" signal.
        preview = await client.get(f"/api/v1/series/{series_id}/preview")
        assert preview.status_code == 200
        assert preview.json()["valid"] is True

        # Rated finalize carries the actor/operation audit from the headers.
        finalize = await client.post(
            f"/api/v1/series/{series_id}/finalize",
            json={"rating_mode": "normal"},
            headers={"X-Quest-Actor-Id": "actor-100", "X-Quest-Operation-Id": "op-100"},
        )
        assert finalize.status_code == 200
        body = finalize.json()
        assert body["status"] == "finalized"
        assert body["rating_mode"] == "normal"
        assert len(body["events"]) == 2  # one immutable event per rated team

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


async def test_unrated_series_contract_no_counters(session_factory, monkeypatch) -> None:
    henrik_id = _ID % "02"
    app = _app(
        monkeypatch,
        session_factory,
        fixtures={henrik_id: _completed_variant(henrik_id, red_wins=True, map_name="Bind")},
    )
    async with _client(app) as client:
        teams = await _bind_teams(client, [("Gamma", "qt-c"), ("Delta", "qt-d")])
        team_a_id, team_b_id = teams["Gamma"], teams["Delta"]

        imported = await _import(client, henrik_id, affinity="eu")
        assert imported["created"] is True

        series = (
            await client.post(
                "/api/v1/series",
                json={
                    "team_a_id": team_a_id,
                    "team_b_id": team_b_id,
                    "format": "bo1",
                    "importance": "regular",
                    "played_at": SERIES_PLAYED_AT,  # finalize requires played_at (ADR-016)
                },
            )
        ).json()
        attach = await client.post(
            f"/api/v1/series/{series['id']}/games",
            json={"match_id": imported["match"]["id"], "game_number": 1, "team_a_side": "red"},
        )
        assert attach.status_code == 201

        result = await client.post(
            f"/api/v1/series/{series['id']}/finalize",
            json={"rating_mode": "unrated"},
        )
        assert result.status_code == 200
        assert result.json()["events"] == []
        assert result.json()["rating_mode"] == "unrated"

        async with session_factory() as session:
            team_a_row = await session.get(Team, uuid.UUID(team_a_id))
            team_b_row = await session.get(Team, uuid.UUID(team_b_id))
            assert team_a_row is not None and team_b_row is not None
            # No counters, no ELO movement (delta D4).
            assert team_a_row.matches_played == 0 and team_b_row.matches_played == 0
            assert team_a_row.series_wins == 0 and team_b_row.series_wins == 0
            assert team_a_row.current_elo == Decimal(1000) and team_b_row.current_elo == Decimal(1000)


async def test_by_henrik_id_detail_contract(session_factory, monkeypatch) -> None:
    henrik_id = _ID % "03"
    app = _app(
        monkeypatch,
        session_factory,
        fixtures={henrik_id: _completed_variant(henrik_id, red_wins=False, map_name="Split")},
    )
    async with _client(app) as client:
        imported = await client.post(
            "/api/v1/matches/import", json={"match_id": henrik_id, "affinity": "eu"}
        )
        assert imported.status_code == 201
        internal_id = imported.json()["match"]["id"]

        # Detail by the Henrik TEXT id, served from Supabase only.
        detail = await client.get(f"/api/v1/matches/by-henrik-id/{henrik_id}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["id"] == internal_id  # internal UUID, not the text id
        assert body["henrik_match_id"] == henrik_id  # text id round-trips
