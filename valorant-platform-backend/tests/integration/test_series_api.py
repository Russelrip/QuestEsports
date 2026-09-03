"""Real-Postgres series API integration tests (plan Task 12, App. D).

The full flow runs against the app with ``get_series_service`` overridden to a
real migrated-schema session. Matches are seeded through the canonical import
service with fixture-driven FakeHenrik (real mapper, no network). Covers:

- end-to-end: import three matches → create a draft series → attach games →
  GET shows derived sides/rounds/winner, map counts, calculated winner;
- API error paths: ``team_a == team_b`` → 409 ``SERIES_INVALID``; non-completed
  match → 422 ``MATCH_NOT_COMPLETED``; reused match → 409
  ``MATCH_ALREADY_ASSIGNED_TO_SERIES``; duplicate game number → 409
  ``SERIES_INVALID``; missing series → 404 ``SERIES_NOT_FOUND``;
- fix round 1: BO draft validity is enforced on every mutation — a BO1 second
  map, a game after a 2-0 BO3 clinch, and gapped game numbers are all 409
  ``SERIES_INVALID``; removing a game that would create a gap is rejected and
  rolled back; PATCH of an occupied game number atomically swaps the two games;
  invalid side literals stay a sanitized 422 at the schema boundary; concurrent
  attaches to one series serialize (no lost aggregates);
- PATCH re-side re-derives sides/rounds/winner; DELETE removes the draft
  series and its games (cascade);
- DB constraints reject same-side games, duplicate ``(series_id, game_number)``
  (isolated from the duplicate-match constraint), and duplicate ``match_id``
  across series; the winner-in-owning-series trigger fires for a foreign winner
  (raw trigger proof);
- service-token gate: mutations and reads require a Quest service token in
  ``production`` (delta D1; spec §6.3);
- pinned contract: attach with ``team_a_side`` omitted derives the side from
  the series anchors on the match (missing/same-side anchor → 409
  ``ANCHOR_NOT_IN_MATCH``); ``GET /series/{id}/matches`` returns only matches
  where both anchors played on opposing sides (empty for anchor-less series).

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import get_series_service
from app.db.models import Match, Series, SeriesGame, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.series_repository import SeriesRepository
from app.integrations.henrik.mapper import HenrikMapper
from app.main import create_app
from app.schemas.matches import MatchDetailResponse
from app.services.match_import_service import MatchImportService
from app.services.series_service import SeriesService
from tests.token_helpers import production_settings, service_token_headers

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"

BASE = "/api/v1/series"
_ID = "00000000-0000-0000-0000-0000000000%s"


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _completed_variant(henrik_match_id: str, *, red_wins: bool, map_name: str) -> dict:
    """A completed fixture with the winner flipped to blue when ``red_wins`` is false."""
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


async def _seed_teams(session_factory) -> tuple[uuid.UUID, uuid.UUID]:
    async with session_factory() as session:
        alpha = Team(
            name="Alpha",
            current_elo=Decimal(1000),
            peak_elo=Decimal(1000),
            matches_played=0,
            series_wins=0,
            series_losses=0,
            is_active=True,
        )
        beta = Team(
            name="Beta",
            current_elo=Decimal(1000),
            peak_elo=Decimal(1000),
            matches_played=0,
            series_wins=0,
            series_losses=0,
            is_active=True,
        )
        session.add_all([alpha, beta])
        await session.commit()
        return alpha.id, beta.id


async def _seed_matches(session_factory, specs: list[tuple[str, bool, str]]) -> dict[str, Match]:
    """Import matches; ``specs`` = (key, red_wins, map_name) -> ``{key: Match}``.

    Henrik match IDs are generated as hex suffixes because the canonical import
    path requires UUID-ish IDs (``_is_uuidish``)."""
    imported: dict[str, Match] = {}
    async with session_factory() as session:
        for index, (key, red_wins, map_name) in enumerate(specs, start=1):
            henrik_id = _ID % f"{index:02x}"
            match = await _seed_match(
                session, henrik_id, _completed_variant(henrik_id, red_wins=red_wins, map_name=map_name)
            )
            imported[key] = match
    return imported


def _app(monkeypatch: pytest.MonkeyPatch, session_factory, *, app_env: str = "test"):
    """Build the app with service-token bypass/protection and the service override."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: production_settings(app_env=app_env),
    )
    app = create_app()

    async def _override():
        async with session_factory() as session:
            yield SeriesService(
                session=session,
                series_repo=SeriesRepository(session),
                match_repo=MatchRepository(session),
            )

    app.dependency_overrides[get_series_service] = _override
    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _create_series(client, team_a_id: uuid.UUID, team_b_id: uuid.UUID, **overrides) -> dict:
    body = {"team_a_id": str(team_a_id), "team_b_id": str(team_b_id), "format": "bo3", "importance": "regular"}
    body.update(overrides)
    resp = await client.post(BASE, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _attach(client, series_id: str, match_id: str, game_number: int, side: str = "red") -> dict:
    resp = await client.post(
        f"{BASE}/{series_id}/games",
        json={"match_id": match_id, "game_number": game_number, "team_a_side": side},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ------------------------------------------------------------------ end-to-end


async def test_import_create_attach_get_round_trips(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        red_win = await _seed_match(session, _ID % "21", _completed_variant(_ID % "21", red_wins=True, map_name="Ascent"))
        blue_win = await _seed_match(session, _ID % "22", _completed_variant(_ID % "22", red_wins=False, map_name="Bind"))
        red_win_2 = await _seed_match(session, _ID % "23", _completed_variant(_ID % "23", red_wins=True, map_name="Haven"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        assert series["status"] == "draft"
        assert series["team_a_maps_won"] == 0
        assert series["team_b_maps_won"] == 0
        assert series["games"] == []

        game_1 = await _attach(client, series["id"], str(red_win.id), 1)
        assert game_1["team_a_side"] == "red"
        assert game_1["team_b_side"] == "blue"
        assert game_1["team_a_rounds"] == 13
        assert game_1["team_b_rounds"] == 9
        assert game_1["winner_team_id"] == str(team_a_id)
        assert game_1["map_name"] == "Ascent"

        game_2 = await _attach(client, series["id"], str(blue_win.id), 2)
        assert game_2["team_a_rounds"] == 9
        assert game_2["team_b_rounds"] == 13
        assert game_2["winner_team_id"] == str(team_b_id)

        game_3 = await _attach(client, series["id"], str(red_win_2.id), 3)
        assert game_3["winner_team_id"] == str(team_a_id)

        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        assert detail["team_a_maps_won"] == 2
        assert detail["team_b_maps_won"] == 1
        assert detail["calculated_winner_id"] == str(team_a_id)
        assert [game["game_number"] for game in detail["games"]] == [1, 2, 3]
        assert [game["map_name"] for game in detail["games"]] == ["Ascent", "Bind", "Haven"]

        listed = (await client.get(BASE)).json()
        assert series["id"] in [entry["id"] for entry in listed]


async def test_get_missing_series_returns_404(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/{uuid.uuid4()}")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "SERIES_NOT_FOUND"


# ----------------------------------------------------------------- error paths


async def test_create_same_team_returns_409(session_factory, monkeypatch) -> None:
    team_a_id, _ = await _seed_teams(session_factory)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.post(
            BASE,
            json={"team_a_id": str(team_a_id), "team_b_id": str(team_a_id), "format": "bo3", "importance": "regular"},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SERIES_INVALID"


async def test_attach_non_completed_match_returns_422(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    incomplete_fixture = _load("incomplete.json")
    data = incomplete_fixture["data"]
    async with session_factory() as session:
        # Canonical import rejects incomplete matches, so seed the row directly
        # to prove the attach path refuses to attach it.
        incomplete = Match(
            henrik_match_id=data["metadata"]["match_id"],
            affinity="eu",
            map_name=data["metadata"]["map"]["name"],
            started_at=datetime.fromisoformat(data["metadata"]["started_at"]),
            is_completed=False,
            red_score=5,
            blue_score=3,
            winning_side=None,
            raw_payload=data,
        )
        session.add(incomplete)
        await session.commit()
        incomplete_id = incomplete.id
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        resp = await client.post(
            f"{BASE}/{series['id']}/games",
            json={"match_id": str(incomplete_id), "game_number": 1, "team_a_side": "red"},
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "MATCH_NOT_COMPLETED"


async def test_attach_match_reused_in_another_series_returns_409(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(session, _ID % "41", _completed_variant(_ID % "41", red_wins=True, map_name="Ascent"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        first = await _create_series(client, team_a_id, team_b_id)
        second = await _create_series(client, team_a_id, team_b_id)
        await _attach(client, first["id"], str(match.id), 1)

        resp = await client.post(
            f"{BASE}/{second['id']}/games",
            json={"match_id": str(match.id), "game_number": 1, "team_a_side": "red"},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "MATCH_ALREADY_ASSIGNED_TO_SERIES"


async def test_attach_duplicate_game_number_returns_409(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        red = await _seed_match(session, _ID % "51", _completed_variant(_ID % "51", red_wins=True, map_name="Ascent"))
        blue = await _seed_match(session, _ID % "52", _completed_variant(_ID % "52", red_wins=False, map_name="Bind"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        await _attach(client, series["id"], str(red.id), 1)

        resp = await client.post(
            f"{BASE}/{series['id']}/games",
            json={"match_id": str(blue.id), "game_number": 1, "team_a_side": "red"},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SERIES_INVALID"


async def test_attach_to_missing_series_returns_404(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.post(
            f"{BASE}/{uuid.uuid4()}/games",
            json={"match_id": str(uuid.uuid4()), "game_number": 1, "team_a_side": "red"},
        )
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "SERIES_NOT_FOUND"


# --------------------------------------- BO draft validation (fix round 1)


async def test_attach_second_map_to_bo1_returns_409(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        first = await _seed_match(session, _ID % "b1", _completed_variant(_ID % "b1", red_wins=True, map_name="Ascent"))
        second = await _seed_match(session, _ID % "b2", _completed_variant(_ID % "b2", red_wins=False, map_name="Bind"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id, format="bo1")
        await _attach(client, series["id"], str(first.id), 1)

        resp = await client.post(
            f"{BASE}/{series['id']}/games",
            json={"match_id": str(second.id), "game_number": 2, "team_a_side": "red"},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SERIES_INVALID"
        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        assert len(detail["games"]) == 1  # rolled back: only the first game


async def test_attach_game_after_bo3_clinch_returns_409(session_factory, monkeypatch) -> None:
    """BO3 2-0 is a valid settled draft; a third game is a game after clinch."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        a1 = await _seed_match(session, _ID % "c1", _completed_variant(_ID % "c1", red_wins=True, map_name="Ascent"))
        a2 = await _seed_match(session, _ID % "c2", _completed_variant(_ID % "c2", red_wins=True, map_name="Bind"))
        a3 = await _seed_match(session, _ID % "c3", _completed_variant(_ID % "c3", red_wins=True, map_name="Haven"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)  # bo3
        await _attach(client, series["id"], str(a1.id), 1)
        await _attach(client, series["id"], str(a2.id), 2)

        resp = await client.post(
            f"{BASE}/{series['id']}/games",
            json={"match_id": str(a3.id), "game_number": 3, "team_a_side": "red"},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SERIES_INVALID"
        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        assert len(detail["games"]) == 2  # rolled back


async def test_attach_gapped_game_number_returns_409(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        first = await _seed_match(session, _ID % "d1", _completed_variant(_ID % "d1", red_wins=True, map_name="Ascent"))
        third = await _seed_match(session, _ID % "d2", _completed_variant(_ID % "d2", red_wins=False, map_name="Bind"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        await _attach(client, series["id"], str(first.id), 1)

        resp = await client.post(
            f"{BASE}/{series['id']}/games",
            json={"match_id": str(third.id), "game_number": 3, "team_a_side": "red"},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SERIES_INVALID"
        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        assert len(detail["games"]) == 1  # rolled back


async def test_remove_creating_gap_returns_409_and_rolls_back(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        a1 = await _seed_match(session, _ID % "e1", _completed_variant(_ID % "e1", red_wins=True, map_name="Ascent"))
        b1 = await _seed_match(session, _ID % "e2", _completed_variant(_ID % "e2", red_wins=False, map_name="Bind"))
        a2 = await _seed_match(session, _ID % "e3", _completed_variant(_ID % "e3", red_wins=True, map_name="Haven"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id, format="bo5")
        game_1 = await _attach(client, series["id"], str(a1.id), 1)
        game_2 = await _attach(client, series["id"], str(b1.id), 2)
        game_3 = await _attach(client, series["id"], str(a2.id), 3)

        resp = await client.delete(f"{BASE}/{series['id']}/games/{game_2['id']}")
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SERIES_INVALID"

        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        assert {g["id"] for g in detail["games"]} == {game_1["id"], game_2["id"], game_3["id"]}


async def test_patch_swap_occupied_game_numbers_returns_200(session_factory, monkeypatch) -> None:
    """PATCHing an occupied game number atomically swaps the two games."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        a1 = await _seed_match(session, _ID % "f1", _completed_variant(_ID % "f1", red_wins=True, map_name="Ascent"))
        b1 = await _seed_match(session, _ID % "f2", _completed_variant(_ID % "f2", red_wins=False, map_name="Bind"))
        a2 = await _seed_match(session, _ID % "f3", _completed_variant(_ID % "f3", red_wins=True, map_name="Haven"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id, format="bo5")
        game_1 = await _attach(client, series["id"], str(a1.id), 1)
        game_2 = await _attach(client, series["id"], str(b1.id), 2)
        game_3 = await _attach(client, series["id"], str(a2.id), 3)

        resp = await client.patch(f"{BASE}/{series['id']}/games/{game_1['id']}", json={"game_number": 3})
        assert resp.status_code == 200
        assert resp.json()["game_number"] == 3

        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        by_number = {game["game_number"]: game for game in detail["games"]}
        assert set(by_number) == {1, 2, 3}
        assert by_number[3]["id"] == game_1["id"]
        assert by_number[1]["id"] == game_3["id"]
        assert by_number[2]["id"] == game_2["id"]
        assert detail["team_a_maps_won"] == 2  # pure reorder: result unchanged
        assert detail["team_b_maps_won"] == 1


async def test_invalid_side_literal_returns_sanitized_422(session_factory, monkeypatch) -> None:
    """Malformed side literals stay a schema-level 422; the raw value is never
    echoed (error redaction preserved — fix round 1)."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)

        resp = await client.post(
            f"{BASE}/{series['id']}/games",
            json={"match_id": str(uuid.uuid4()), "game_number": 1, "team_a_side": "Green"},
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"
        assert "Green" not in resp.text  # sanitized validation output


async def test_concurrent_attach_no_lost_update(session_factory, monkeypatch) -> None:
    """Two concurrent attaches to one series serialize on the row lock: both
    games persist and the recomputed aggregate includes both (fix round 1)."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        red_win = await _seed_match(session, _ID % "9a", _completed_variant(_ID % "9a", red_wins=True, map_name="Ascent"))
        blue_win = await _seed_match(session, _ID % "9b", _completed_variant(_ID % "9b", red_wins=False, map_name="Bind"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)

        async def attach(match_id: str, game_number: int) -> httpx.Response:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as c:
                return await c.post(
                    f"{BASE}/{series['id']}/games",
                    json={"match_id": match_id, "game_number": game_number, "team_a_side": "red"},
                )

        responses = await asyncio.gather(
            attach(str(red_win.id), 1),
            attach(str(blue_win.id), 2),
        )
        assert [response.status_code for response in responses] == [201, 201], [
            response.text for response in responses
        ]

        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        assert len(detail["games"]) == 2  # both games persisted
        assert detail["team_a_maps_won"] == 1  # aggregate includes both
        assert detail["team_b_maps_won"] == 1  # no lost update


# ------------------------------------------------------------- draft mutations


async def test_patch_reside_derives_sides_rounds_and_winner(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(session, _ID % "61", _completed_variant(_ID % "61", red_wins=True, map_name="Ascent"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        game = await _attach(client, series["id"], str(match.id), 1)
        assert game["winner_team_id"] == str(team_a_id)

        resp = await client.patch(f"{BASE}/{series['id']}/games/{game['id']}", json={"team_a_side": "blue"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["team_a_side"] == "blue"
        assert body["team_b_side"] == "red"
        assert body["team_a_rounds"] == 9
        assert body["team_b_rounds"] == 13
        assert body["winner_team_id"] == str(team_b_id)


async def test_delete_draft_series_cascades_games(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(session, _ID % "71", _completed_variant(_ID % "71", red_wins=True, map_name="Ascent"))
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        await _attach(client, series["id"], str(match.id), 1)

        resp = await client.delete(f"{BASE}/{series['id']}")
        assert resp.status_code == 204

        async with session_factory() as session:
            assert await session.get(Series, uuid.UUID(series["id"])) is None
            count = await session.scalar(
                select(func.count()).select_from(SeriesGame).where(
                    SeriesGame.series_id == uuid.UUID(series["id"])
                )
            )
            assert count == 0  # cascade


# ------------------------------------------------------- update played_at (draft only)


async def test_patch_played_at_in_draft_updates_only_played_at(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        played_at = "2026-08-14T18:30:00Z"

        resp = await client.patch(f"{BASE}/{series['id']}", json={"played_at": played_at})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["played_at"] == played_at
        assert body["status"] == "draft"
        assert body["team_a_maps_won"] == 0
        assert body["team_b_maps_won"] == 0
        assert body["finalized_at"] is None

        detail = (await client.get(f"{BASE}/{series['id']}")).json()
        assert detail["played_at"] == played_at  # persisted, visible on GET


async def test_patch_played_at_on_finalized_series_returns_409(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)
        async with session_factory() as session:
            row = await session.get(Series, uuid.UUID(series["id"]))
            row.status = "finalized"
            await session.commit()

        resp = await client.patch(f"{BASE}/{series['id']}", json={"played_at": "2026-08-14T18:30:00Z"})
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "SERIES_ALREADY_FINALIZED"

        async with session_factory() as session:
            row = await session.get(Series, uuid.UUID(series["id"]))
            assert row.played_at is None  # nothing changed


async def test_patch_played_at_missing_series_returns_404(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.patch(f"{BASE}/{uuid.uuid4()}", json={"played_at": "2026-08-14T18:30:00Z"})
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "SERIES_NOT_FOUND"


# ------------------------------------------------------------ DB constraints


async def _seed_series_and_match(session_factory) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """One draft series plus one red-winning match; returns (series, match, team_a, team_b)."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(session, _ID % "81", _completed_variant(_ID % "81", red_wins=True, map_name="Ascent"))
    async with session_factory() as session:
        series = Series(
            team_a_id=team_a_id,
            team_b_id=team_b_id,
            format="bo3",
            importance="regular",
            status="draft",
            team_a_maps_won=0,
            team_b_maps_won=0,
        )
        session.add(series)
        await session.commit()
        series_id = series.id
    return series_id, match.id, team_a_id, team_b_id


async def test_db_rejects_same_side_for_both_teams(session_factory) -> None:
    series_id, match_id, _, _ = await _seed_series_and_match(session_factory)
    async with session_factory() as session:
        session.add(
            SeriesGame(
                series_id=series_id,
                game_number=1,
                match_id=match_id,
                team_a_side="red",
                team_b_side="red",
                team_a_rounds=13,
                team_b_rounds=9,
            )
        )
        with pytest.raises(IntegrityError, match="series_games_sides_check"):
            await session.commit()
        await session.rollback()


async def test_db_rejects_duplicate_series_game_number(session_factory) -> None:
    # Two DISTINCT matches force only the (series_id, game_number) unique
    # constraint to fire — never the duplicate-match constraint (fix round 1).
    series_id, match_id, _, _ = await _seed_series_and_match(session_factory)
    async with session_factory() as session:
        other_match = await _seed_match(
            session, _ID % "83", _completed_variant(_ID % "83", red_wins=False, map_name="Bind")
        )
    async with session_factory() as session:
        session.add(
            SeriesGame(
                series_id=series_id,
                game_number=1,
                match_id=match_id,
                team_a_side="red",
                team_b_side="blue",
                team_a_rounds=13,
                team_b_rounds=9,
            )
        )
        session.add(
            SeriesGame(
                series_id=series_id,
                game_number=1,
                match_id=other_match.id,
                team_a_side="red",
                team_b_side="blue",
                team_a_rounds=9,
                team_b_rounds=13,
            )
        )
        with pytest.raises(IntegrityError, match="series_games_number_key"):
            await session.commit()
        await session.rollback()


async def test_db_rejects_duplicate_match_id_across_series(session_factory) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(session, _ID % "82", _completed_variant(_ID % "82", red_wins=True, map_name="Ascent"))
        first = Series(team_a_id=team_a_id, team_b_id=team_b_id, format="bo3", importance="regular", status="draft")
        second = Series(team_a_id=team_a_id, team_b_id=team_b_id, format="bo3", importance="regular", status="draft")
        session.add_all([first, second])
        await session.commit()
        session.add(
            SeriesGame(
                series_id=first.id,
                game_number=1,
                match_id=match.id,
                team_a_side="red",
                team_b_side="blue",
                team_a_rounds=13,
                team_b_rounds=9,
            )
        )
        session.add(
            SeriesGame(
                series_id=second.id,
                game_number=1,
                match_id=match.id,
                team_a_side="red",
                team_b_side="blue",
                team_a_rounds=13,
                team_b_rounds=9,
            )
        )
        with pytest.raises(IntegrityError, match="series_games_match_key"):
            await session.commit()
        await session.rollback()


async def test_winner_in_owning_series_trigger_rejects_foreign_winner(session_factory) -> None:
    series_id, match_id, _team_a_id, _ = await _seed_series_and_match(session_factory)
    async with session_factory() as session:
        outsider = Team(
            name="Outsider",
            current_elo=Decimal(1000),
            peak_elo=Decimal(1000),
            matches_played=0,
            series_wins=0,
            series_losses=0,
            is_active=True,
        )
        session.add(outsider)
        await session.commit()
        session.add(
            SeriesGame(
                series_id=series_id,
                game_number=1,
                match_id=match_id,
                team_a_side="red",
                team_b_side="blue",
                team_a_rounds=13,
                team_b_rounds=9,
                winner_team_id=outsider.id,  # not one of the owning series' teams
            )
        )
        with pytest.raises(Exception, match="team of the owning series"):
            await session.commit()
        await session.rollback()


async def test_db_rejects_same_team_series(session_factory) -> None:
    team_a_id, _ = await _seed_teams(session_factory)
    async with session_factory() as session:
        session.add(
            Series(
                team_a_id=team_a_id,
                team_b_id=team_a_id,
                format="bo3",
                importance="regular",
                status="draft",
            )
        )
        with pytest.raises(IntegrityError, match="series_team_distinct"):
            await session.commit()
        await session.rollback()


# ------------------------------------------------------ service-token gate


async def test_mutations_require_service_token_in_production(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    app = _app(monkeypatch, session_factory, app_env="production")
    async with _client(app) as client:
        post = await client.post(
            BASE,
            json={"team_a_id": str(team_a_id), "team_b_id": str(team_b_id), "format": "bo3", "importance": "regular"},
        )
        assert post.status_code == 401
        assert post.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"

        attach = await client.post(
            f"{BASE}/{uuid.uuid4()}/games",
            json={"match_id": str(uuid.uuid4()), "game_number": 1, "team_a_side": "red"},
        )
        assert attach.status_code == 401


async def test_reads_require_service_token_in_production(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory, app_env="production")
    async with _client(app) as client:
        denied = await client.get(BASE)
        assert denied.status_code == 401

        listed = await client.get(BASE, headers=service_token_headers())
        assert listed.status_code == 200
        assert listed.json() == []

        unknown = await client.get(f"{BASE}/{uuid.uuid4()}", headers=service_token_headers())
        assert unknown.status_code == 404
        assert unknown.json()["error"]["code"] == "SERIES_NOT_FOUND"


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


async def test_set_game_order_absolute_and_idempotent(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent"), ("m2", False, "Bind"), ("m3", True, "Split")])
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


# ------------------- anchor-derived attach side + relevant matches (pinned contract)


async def _seed_anchored_series(
    session_factory, team_a_id: uuid.UUID, team_b_id: uuid.UUID, *, with_anchors: bool = True
) -> str:
    """Seed a draft series directly (anchors bypass player resolution); returns
    the series id. The import fixture's two players are ``puuid_p_a`` (red) and
    ``puuid_p_b`` (blue)."""
    async with session_factory() as session:
        series = Series(
            team_a_id=team_a_id,
            team_b_id=team_b_id,
            format="bo3",
            importance="regular",
            status="draft",
            team_a_maps_won=0,
            team_b_maps_won=0,
        )
        if with_anchors:
            series.anchor_a_puuid = "puuid_p_a"
            series.anchor_b_puuid = "puuid_p_b"
        session.add(series)
        await session.commit()
        return str(series.id)


async def test_attach_omitted_side_derives_team_a_side_from_anchors(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(session, _ID % "a1", _completed_variant(_ID % "a1", red_wins=True, map_name="Ascent"))
    series_id = await _seed_anchored_series(session_factory, team_a_id, team_b_id)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.post(
            f"{BASE}/{series_id}/games",
            json={"match_id": str(match.id), "game_number": 1},
        )
        assert resp.status_code == 201, resp.text
        game = resp.json()
        assert game["team_a_side"] == "red"  # puuid_p_a is on red
        assert game["team_b_side"] == "blue"
        assert game["team_a_rounds"] == 13
        assert game["team_b_rounds"] == 9
        assert game["winner_team_id"] == str(team_a_id)


async def test_attach_omitted_side_with_missing_anchor_returns_409(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(session, _ID % "a2", _completed_variant(_ID % "a2", red_wins=True, map_name="Ascent"))
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM match_players WHERE match_id = :m AND puuid_snapshot = 'puuid_p_b'"),
            {"m": match.id},
        )
        await session.commit()
    series_id = await _seed_anchored_series(session_factory, team_a_id, team_b_id)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.post(
            f"{BASE}/{series_id}/games",
            json={"match_id": str(match.id), "game_number": 1},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "ANCHOR_NOT_IN_MATCH"


async def test_series_matches_returns_only_opposing_anchor_matches(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        opposing = await _seed_match(session, _ID % "b1", _completed_variant(_ID % "b1", red_wins=True, map_name="Ascent"))
        same_side = await _seed_match(session, _ID % "b2", _completed_variant(_ID % "b2", red_wins=False, map_name="Bind"))
        missing_a = await _seed_match(session, _ID % "b3", _completed_variant(_ID % "b3", red_wins=True, map_name="Haven"))
        # Flip anchor B onto the same side as anchor A in this match...
        await session.execute(
            text("UPDATE match_players SET side = 'red' WHERE match_id = :m AND puuid_snapshot = 'puuid_p_b'"),
            {"m": same_side.id},
        )
        # ...and drop anchor A from the third match entirely.
        await session.execute(
            text("DELETE FROM match_players WHERE match_id = :m AND puuid_snapshot = 'puuid_p_a'"),
            {"m": missing_a.id},
        )
        await session.commit()
    series_id = await _seed_anchored_series(session_factory, team_a_id, team_b_id)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/{series_id}/matches")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == {"matches"}
        matches = body["matches"]
        assert len(matches) == 1
        item = matches[0]
        assert item["id"] == str(opposing.id)
        assert item["henrik_match_id"] == opposing.henrik_match_id
        assert item["affinity"] == "eu"
        assert item["platform"] == "pc"
        assert item["map_name"] == "Ascent"
        assert item["is_completed"] is True
        assert item["red_score"] == 13
        assert item["blue_score"] == 9
        assert item["winning_side"] == "red"
        assert item["anchor_a_side"] == "red"  # puuid_p_a's side on this match


async def test_series_matches_returns_empty_when_series_has_no_anchors(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        await _seed_match(session, _ID % "b4", _completed_variant(_ID % "b4", red_wins=True, map_name="Ascent"))
    series_id = await _seed_anchored_series(session_factory, team_a_id, team_b_id, with_anchors=False)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/{series_id}/matches")
        assert resp.status_code == 200
        assert resp.json() == {"matches": []}


async def test_series_matches_missing_series_returns_404(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/{uuid.uuid4()}/matches")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "SERIES_NOT_FOUND"
