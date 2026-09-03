"""Real-Postgres series preview API integration tests (plan Task 13, App. D).

End-to-end preview route on a real Postgres-backed series. Valid shapes are
built through the canonical import + attach flow; invalid persisted shapes are
seeded directly (bypassing the mutation gate, which would refuse them) so the
preview endpoint can be exercised against exactly the states the design
describes. Covers:

- valid BO1/BO3/BO5 shapes (1-0, 2-0, 2-1, 3-2) → 200 ``valid=true`` with the
  recomputed map counts, calculated winner, and game summaries (map names);
- invalid shapes → 200 ``valid=false`` with the stable, deterministic error
  messages (1-1 no winner; a sixth BO5 map after clinch; an empty series; an
  incomplete match; a stored winner disagreeing with the round scores) while
  map counts are still recomputed;
- missing series → 404 ``SERIES_NOT_FOUND``;
- preview requires a Quest service token in ``production`` (delta D1; spec
  §6.3);
- preview never mutates: a deliberately stale stored result stays stale after
  the request.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

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


async def _seed_match(
    session, henrik_match_id: str, fixture: dict, *, refresh: bool = False
) -> MatchDetailResponse:
    service = MatchImportService(
        session=session,
        henrik=FakeHenrik({henrik_match_id: fixture}),  # type: ignore[arg-type]
        player_repo=PlayerRepository(session),
        match_repo=MatchRepository(session),
        mapper=HenrikMapper(),
    )
    result = await service.import_match(henrik_match_id, "eu", refresh=refresh)
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


async def _seed_raw_series(
    session_factory,
    team_a_id: uuid.UUID,
    team_b_id: uuid.UUID,
    *,
    format_: str,
    games: list[tuple[int, uuid.UUID, str, int, int, uuid.UUID | None]],
    status: str = "draft",
    stale_maps: tuple[int, int] = (0, 0),
) -> str:
    """Insert a series + games directly (bypassing the service's mutation gate)
    so the preview endpoint can be exercised against invalid/stale persisted
    states that the draft attach flow would never produce."""
    async with session_factory() as session:
        series = Series(
            team_a_id=team_a_id,
            team_b_id=team_b_id,
            format=format_,
            importance="regular",
            status=status,
            team_a_maps_won=stale_maps[0],
            team_b_maps_won=stale_maps[1],
        )
        session.add(series)
        await session.commit()
        series_id = series.id
    async with session_factory() as session:
        for number, match_id, side, team_a_rounds, team_b_rounds, winner_team_id in games:
            session.add(
                SeriesGame(
                    series_id=series_id,
                    game_number=number,
                    match_id=match_id,
                    team_a_side=side,
                    team_b_side="blue" if side == "red" else "red",
                    team_a_rounds=team_a_rounds,
                    team_b_rounds=team_b_rounds,
                    winner_team_id=winner_team_id,
                )
            )
        await session.commit()
    return str(series_id)


def _games_spec(
    team_a_id: uuid.UUID,
    team_b_id: uuid.UUID,
    matches: dict[str, Match],
    winners: list[str],
) -> list[tuple[int, uuid.UUID, str, int, int, uuid.UUID | None]]:
    """Game tuples for ``winners`` (``"A"``/``"B"`` = team winning that map);
    team A plays red and winners derive from the mapped round scores."""
    games = []
    for number, winner in enumerate(winners, start=1):
        red_wins = winner == "A"
        team_a_rounds, team_b_rounds = (13, 9) if red_wins else (9, 13)
        winner_id = team_a_id if red_wins else team_b_id
        games.append((number, matches[f"m{number}"].id, "red", team_a_rounds, team_b_rounds, winner_id))
    return games


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
    body = {
        "team_a_id": str(team_a_id),
        "team_b_id": str(team_b_id),
        "format": "bo3",
        "importance": "regular",
    }
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


# ------------------------------------------------------------- valid shapes


@pytest.mark.parametrize(
    ("format_", "winners", "expected_a", "expected_b"),
    [
        ("bo1", ["A"], 1, 0),
        ("bo3", ["A", "A"], 2, 0),
        ("bo3", ["A", "B", "A"], 2, 1),
        ("bo5", ["A", "B", "A", "B", "A"], 3, 2),
    ],
)
async def test_preview_valid_shape_is_ready(
    session_factory, monkeypatch, format_, winners, expected_a, expected_b
) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    specs = [(f"m{i}", winner == "A", f"Map {i}") for i, winner in enumerate(winners, start=1)]
    matches = await _seed_matches(session_factory, specs)
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id, format=format_)
        for number, winner in enumerate(winners, start=1):
            await _attach(client, series["id"], str(matches[f"m{number}"].id), number, side="red")

        resp = await client.get(f"{BASE}/{series['id']}/preview")
        assert resp.status_code == 200, resp.text
        body = resp.json()

    assert body["valid"] is True
    assert body["errors"] == []
    assert body["team_a_maps_won"] == expected_a
    assert body["team_b_maps_won"] == expected_b
    assert body["calculated_winner_id"] == str(team_a_id)
    assert [game["game_number"] for game in body["games"]] == list(range(1, len(winners) + 1))
    assert [game["map_name"] for game in body["games"]] == [f"Map {i}" for i in range(1, len(winners) + 1)]


# ------------------------------------------------------------ invalid shapes


@pytest.mark.parametrize(
    ("format_", "winners", "expected_a", "expected_b", "expected_error"),
    [
        ("bo3", ["A", "B"], 1, 1, "no team reached the required wins"),
        ("bo5", ["A", "B", "A", "B", "A", "B"], 3, 3, "no game after the series was already clinched"),
    ],
)
async def test_preview_invalid_shape_reports_stable_errors(
    session_factory, monkeypatch, format_, winners, expected_a, expected_b, expected_error
) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    specs = [(f"m{i}", winner == "A", f"Map {i}") for i, winner in enumerate(winners, start=1)]
    matches = await _seed_matches(session_factory, specs)
    games = _games_spec(team_a_id, team_b_id, matches, winners)
    series_id = await _seed_raw_series(session_factory, team_a_id, team_b_id, format_=format_, games=games)

    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/{series_id}/preview")
        assert resp.status_code == 200, resp.text
        body = resp.json()

    assert body["valid"] is False
    assert any(expected_error in error for error in body["errors"])
    # Map counts are still recomputed from the games (authoritative).
    assert body["team_a_maps_won"] == expected_a
    assert body["team_b_maps_won"] == expected_b


async def test_preview_empty_series_is_not_ready(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    series_id = await _seed_raw_series(session_factory, team_a_id, team_b_id, format_="bo3", games=[])

    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        body = (await client.get(f"{BASE}/{series_id}/preview")).json()

    assert body["valid"] is False
    assert body["errors"] == ["no team reached the required wins"]
    assert body["games"] == []
    assert body["calculated_winner_id"] is None


async def test_preview_incomplete_match_reports_error(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        # Canonical import rejects incomplete matches, so seed the row directly.
        incomplete = Match(
            henrik_match_id=_ID % "99",
            affinity="eu",
            map_name="Ascent",
            started_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
            is_completed=False,
            red_score=5,
            blue_score=3,
            winning_side=None,
            raw_payload={},
        )
        session.add(incomplete)
        await session.commit()
        incomplete_id = incomplete.id
    series_id = await _seed_raw_series(
        session_factory,
        team_a_id,
        team_b_id,
        format_="bo3",
        games=[(1, incomplete_id, "red", 13, 9, team_a_id)],
    )

    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        body = (await client.get(f"{BASE}/{series_id}/preview")).json()

    assert body["valid"] is False
    assert any("game 1: match is not completed" in error for error in body["errors"])


async def test_preview_stored_winner_disagreement_reports_error(session_factory, monkeypatch) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    # Round scores say team A (red 13-9), but the stored winner is team B.
    games = [(1, matches["m1"].id, "red", 13, 9, team_b_id)]
    series_id = await _seed_raw_series(session_factory, team_a_id, team_b_id, format_="bo3", games=games)

    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        body = (await client.get(f"{BASE}/{series_id}/preview")).json()

    assert body["valid"] is False
    assert any("game 1: winner team does not match round scores" in error for error in body["errors"])


# -------------------------------------------------------------- not found


async def test_preview_missing_series_returns_404(session_factory, monkeypatch) -> None:
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        resp = await client.get(f"{BASE}/{uuid.uuid4()}/preview")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "SERIES_NOT_FOUND"


# -------------------------------------------------- service-token-gated read


async def test_preview_requires_service_token_in_production(session_factory, monkeypatch) -> None:
    """Preview is a domain read — it needs a Quest service token in production."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _seed_raw_series(
        session_factory,
        team_a_id,
        team_b_id,
        format_="bo1",
        games=[(1, matches["m1"].id, "red", 13, 9, team_a_id)],
    )

    app = _app(monkeypatch, session_factory, app_env="production")
    async with _client(app) as client:
        denied = await client.get(f"{BASE}/{series_id}/preview")
        assert denied.status_code == 401

        resp = await client.get(f"{BASE}/{series_id}/preview", headers=service_token_headers())
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["valid"] is True
        assert body["calculated_winner_id"] == str(team_a_id)


# ------------------------------------------------------------- no mutation


async def test_preview_never_mutates_stored_result(session_factory, monkeypatch) -> None:
    """A deliberately stale stored result (0-0) stays stale after preview —
    the request only recomputes and returns; it never persists."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(
        session_factory,
        [("m1", True, "Ascent"), ("m2", False, "Bind"), ("m3", True, "Haven")],
    )
    games = _games_spec(team_a_id, team_b_id, matches, ["A", "B", "A"])
    series_id = await _seed_raw_series(
        session_factory,
        team_a_id,
        team_b_id,
        format_="bo3",
        games=games,
        stale_maps=(0, 0),  # stored row does not reflect the games
    )

    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        body = (await client.get(f"{BASE}/{series_id}/preview")).json()

    assert body["valid"] is True
    assert body["team_a_maps_won"] == 2
    assert body["team_b_maps_won"] == 1
    assert body["calculated_winner_id"] == str(team_a_id)

    async with session_factory() as session:
        row = await session.get(Series, uuid.UUID(series_id))
        assert row is not None
        assert row.team_a_maps_won == 0  # untouched
        assert row.team_b_maps_won == 0  # untouched
        assert row.calculated_winner_id is None  # untouched
        assert row.status == "draft"
        count = await session.scalar(select(SeriesGame).where(SeriesGame.series_id == row.id).limit(1))
        assert count is not None  # games still attached


# ------------------------------- canonical refresh & consistency (fix round 1)


async def test_preview_reflects_refreshed_canonical_match(session_factory, monkeypatch) -> None:
    """Refresh a canonical match through the import service (refresh=True) and
    verify preview derives the flipped map winner from CURRENT canonical data,
    flags the now-stale stored winner as invalid, and never writes."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        match = await _seed_match(
            session, _ID % "d1", _completed_variant(_ID % "d1", red_wins=True, map_name="Ascent")
        )
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id, format="bo1")
        await _attach(client, series["id"], str(match.id), 1)
        before = (await client.get(f"{BASE}/{series['id']}/preview")).json()
        assert before["valid"] is True
        assert before["calculated_winner_id"] == str(team_a_id)

    # The canonical match is refreshed: blue (team B) now won.
    async with session_factory() as session:
        await _seed_match(
            session,
            _ID % "d1",
            _completed_variant(_ID % "d1", red_wins=False, map_name="Ascent"),
            refresh=True,
        )

    async with _client(app) as client:
        after = (await client.get(f"{BASE}/{series['id']}/preview")).json()

    # The preview reflects current canonical data, not the stale stored copies.
    assert after["valid"] is False  # stale stored winner -> inconsistent
    assert after["calculated_winner_id"] == str(team_b_id)  # derived winner flipped
    assert after["team_a_maps_won"] == 0
    assert after["team_b_maps_won"] == 1
    game = after["games"][0]
    assert game["team_a_rounds"] == 9  # current canonical, not stored 13-9
    assert game["team_b_rounds"] == 13
    assert game["winner_team_id"] == str(team_b_id)  # derived
    assert any("winner team does not match round scores" in e for e in after["errors"])

    # The stored series row is untouched (preview never writes).
    async with session_factory() as session:
        row = await session.get(Series, uuid.UUID(series["id"]))
        assert row is not None
        assert row.calculated_winner_id == team_a_id  # stale persisted, unchanged


async def test_preview_shape_invalidated_by_canonical_refresh(session_factory, monkeypatch) -> None:
    """BO3 2-0 becomes 1-1 after refreshing one match: preview reflects the
    current canonical shape and reports the no-winner error."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        a1 = await _seed_match(
            session, _ID % "d1", _completed_variant(_ID % "d1", red_wins=True, map_name="Ascent")
        )
        a2 = await _seed_match(
            session, _ID % "d2", _completed_variant(_ID % "d2", red_wins=True, map_name="Bind")
        )
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)  # bo3
        await _attach(client, series["id"], str(a1.id), 1)
        await _attach(client, series["id"], str(a2.id), 2)
        before = (await client.get(f"{BASE}/{series['id']}/preview")).json()
        assert before["valid"] is True
        assert before["team_a_maps_won"] == 2

    # Refresh the second canonical match so blue (team B) now won.
    async with session_factory() as session:
        await _seed_match(
            session, _ID % "d2", _completed_variant(_ID % "d2", red_wins=False, map_name="Bind"), refresh=True
        )

    async with _client(app) as client:
        after = (await client.get(f"{BASE}/{series['id']}/preview")).json()

    assert after["valid"] is False
    assert after["team_a_maps_won"] == 1
    assert after["team_b_maps_won"] == 1
    assert any("no team reached the required wins" in e for e in after["errors"])


async def test_preview_consistent_read_under_concurrent_mutation(session_factory, monkeypatch) -> None:
    """Preview must never mix states: even while a concurrent attach commits,
    its games list, map counts, and winner are always derived from ONE
    consistent read (the joined query), so the response is internally
    consistent whether it saw the pre- or post-commit state."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    async with session_factory() as session:
        a1 = await _seed_match(
            session, _ID % "c1", _completed_variant(_ID % "c1", red_wins=True, map_name="Ascent")
        )
        b1 = await _seed_match(
            session, _ID % "c2", _completed_variant(_ID % "c2", red_wins=False, map_name="Bind")
        )
    app = _app(monkeypatch, session_factory)
    async with _client(app) as client:
        series = await _create_series(client, team_a_id, team_b_id)  # bo3
        await _attach(client, series["id"], str(a1.id), 1)

        async def preview_once() -> httpx.Response:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
                return await c.get(f"{BASE}/{series['id']}/preview")

        async def attach_once() -> httpx.Response:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
                return await c.post(
                    f"{BASE}/{series['id']}/games",
                    json={"match_id": str(b1.id), "game_number": 2, "team_a_side": "red"},
                )

        for _ in range(5):
            responses = await asyncio.gather(preview_once(), attach_once(), preview_once())
            for response in responses:
                if response.status_code != 200:
                    continue
                body = response.json()
                games = body["games"]
                # Internally consistent in every observed state: contiguous
                # numbers and map counts that recompute from the games list.
                assert [g["game_number"] for g in games] == list(range(1, len(games) + 1))
                assert body["team_a_maps_won"] == sum(
                    1 for g in games if g["team_a_rounds"] > g["team_b_rounds"]
                )
                assert body["team_b_maps_won"] == sum(
                    1 for g in games if g["team_b_rounds"] > g["team_a_rounds"]
                )
