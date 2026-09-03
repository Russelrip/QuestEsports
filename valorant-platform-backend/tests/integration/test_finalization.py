"""Real-Postgres finalization integration tests (plan Task 15, App. D).

The full finalize flow runs against real Postgres (migrated schema through the
test harness): canonical matches imported through the real mapper (FakeHenrik
fixtures, no network), draft series built through the real mutation flow, then
``RatingService.finalize`` inside the app's real session. Covers design §15.6:

- both rating events + both team updates commit together atomically;
- a simulated mid-transaction failure rolls everything back (no events, teams
  untouched, series still a draft);
- double finalization does not reapply ELO (409 ``SERIES_ALREADY_FINALIZED``);
- concurrent finalization of the SAME series wins exactly once;
- concurrent finalization of two series sharing a team is serialized with no
  lost updates (the shared team's rating reflects BOTH series' events);
- fix round 1: a coordinated barrier + REVERSED team pairs proves the
  deterministic sorted (smallest-UUID-first) team lock order is deadlock-free
  under guaranteed contention;
- fix round 1 (Critical): refresh and finalize serialize on the owning series
  row lock — a finalized rating is always computed from exactly one committed
  canonical state, and refreshing a draft-attached match stays allowed;
- fix round 1: the resolved ``rating_mode`` is persisted on the series and
  exposed by the API (``forfeit_no_rating`` vs ``forfeit_result_only`` stay
  distinguishable);
- fix round 1: ``rating_events`` are DB-immutable (UPDATE/DELETE rejected by
  trigger) with inserts and the unique double-rate guard preserved;
- the immutable event stream replays to the current standings (the rebuild
  basis, exercised fully in Task 16);
- the finalize route is admin-gated and returns the stable error codes.

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
from typing import Literal

import httpx
import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import get_rating_service, get_series_service
from app.db.models import Match, RatingEvent, RatingRun, Series, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.integrations.henrik.mapper import HenrikMapper
from app.legacy.elo_calculator import EloCalculator
from app.main import create_app
from app.schemas.matches import MatchDetailResponse
from app.schemas.series import AttachGameRequest, FinalizeRequest, FinalizeResult, SeriesCreate
from app.services.match_import_service import MatchImportService
from app.services.player_service import PlayerService
from app.services.rating_service import RatingService
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


def _variant_with_scores(henrik_match_id: str, *, red_rounds: int, blue_rounds: int, map_name: str) -> dict:
    """A completed fixture with explicit red/blue round scores (fix round 1:
    the refresh/finalize race test needs two margins of the SAME winner)."""
    fixture = deepcopy(_load("completed_custom.json"))
    data = fixture["data"]
    data["metadata"]["match_id"] = henrik_match_id
    data["metadata"]["map"]["name"] = map_name
    red, blue = data["teams"]
    red["rounds"]["won"], red["rounds"]["lost"] = red_rounds, blue_rounds
    blue["rounds"]["won"], blue["rounds"]["lost"] = blue_rounds, red_rounds
    red["won"], blue["won"] = red_rounds > blue_rounds, blue_rounds > red_rounds
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
        raise AssertionError("test anchor resolution must hit the player cache")


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


async def _refresh_match(session_factory, henrik_match_id: str, fixture: dict):
    """Refresh an already-imported match through the real import service
    (the refresh/finalize race protocol acquires the owning series lock)."""
    async with session_factory() as session:
        service = MatchImportService(
            session=session,
            henrik=FakeHenrik({henrik_match_id: fixture}),  # type: ignore[arg-type]
            player_repo=PlayerRepository(session),
            match_repo=MatchRepository(session),
            mapper=HenrikMapper(),
        )
        return await service.import_match(henrik_match_id, "eu", refresh=True)


def _record_team_lock_order(test_engine) -> list[uuid.UUID]:
    """Record the ACQUISITION order of the ``SELECT ... FOR UPDATE`` team locks
    (after_cursor_execute fires once the lock is held) — the direct proof that
    both finalizes acquire their teams smallest-UUID-first."""
    order: list[uuid.UUID] = []

    def record(conn, cursor, statement, parameters, context, executemany) -> None:
        if "FOR UPDATE" in statement and "FROM teams" in statement:
            for value in _uuid_values(parameters):
                order.append(value)
                break

    sa_event.listen(test_engine.sync_engine, "after_cursor_execute", record)
    return order


def _uuid_values(parameters) -> list[uuid.UUID]:
    found: list[uuid.UUID] = []
    if isinstance(parameters, dict):
        values = list(parameters.values())
    elif isinstance(parameters, (list, tuple)):
        values = list(parameters)
    else:
        values = []
    for value in values:
        if isinstance(value, uuid.UUID):
            found.append(value)
        elif isinstance(value, dict):
            found.extend(_uuid_values(list(value.values())))
        elif isinstance(value, (list, tuple)):
            found.extend(_uuid_values(value))
    return found


async def _seed_team(session_factory, name: str) -> uuid.UUID:
    async with session_factory() as session:
        team = Team(
            name=name,
            current_elo=Decimal(1000),
            peak_elo=Decimal(1000),
            matches_played=0,
            series_wins=0,
            series_losses=0,
            is_active=True,
        )
        session.add(team)
        await session.commit()
        return team.id


async def _seed_teams(session_factory) -> tuple[uuid.UUID, uuid.UUID]:
    return await _seed_team(session_factory, "Alpha"), await _seed_team(session_factory, "Beta")


async def _seed_matches(
    session_factory, specs: list[tuple[str, bool, str]], *, offset: int = 0
) -> dict[str, MatchDetailResponse]:
    """Import matches; ``specs`` = (key, red_wins, map_name) -> ``{key: match}``."""
    imported: dict[str, MatchDetailResponse] = {}
    async with session_factory() as session:
        for index, (key, red_wins, map_name) in enumerate(specs, start=1 + offset):
            henrik_id = _ID % f"{index:02x}"
            match = await _seed_match(
                session, henrik_id, _completed_variant(henrik_id, red_wins=red_wins, map_name=map_name)
            )
            imported[key] = match
    return imported


def _series_service(session) -> SeriesService:
    return SeriesService(
        session=session,
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
        player_svc=PlayerService(
            session=session, henrik=_NoNetworkHenrik(), repo=PlayerRepository(session)
        ),  # type: ignore[arg-type]
    )


def _rating_service(session) -> RatingService:
    return RatingService(
        session=session,
        series_repo=SeriesRepository(session),
        rating_repo=RatingRepository(session),
        match_repo=MatchRepository(session),
    )


async def _create_series(
    session_factory,
    team_a_id: uuid.UUID,
    team_b_id: uuid.UUID,
    *,
    format_: Literal["bo1", "bo3", "bo5"] = "bo3",
    played_at: datetime | None = datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
) -> uuid.UUID:
    async with session_factory() as session:
        svc = _series_service(session)
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
        return series.id


async def _attach(
    session_factory,
    series_id: uuid.UUID,
    match_id: uuid.UUID,
    number: int,
    side: Literal["red", "blue"] = "red",
) -> None:
    async with session_factory() as session:
        svc = _series_service(session)
        await svc.attach_game(
            series_id, AttachGameRequest(match_id=match_id, game_number=number, team_a_side=side)
        )


async def _finalize(session_factory, series_id: uuid.UUID, req: FinalizeRequest | None = None):
    async with session_factory() as session:
        svc = _rating_service(session)
        return await svc.finalize(series_id, req or FinalizeRequest())


async def _series_row(session_factory, series_id: uuid.UUID) -> Series:
    async with session_factory() as session:
        row = await session.get(Series, series_id)
        assert row is not None
        return row


async def _team_row(session_factory, team_id: uuid.UUID) -> Team:
    async with session_factory() as session:
        row = await session.get(Team, team_id)
        assert row is not None
        return row


async def _events_for_series(session_factory, series_id: uuid.UUID) -> list[RatingEvent]:
    async with session_factory() as session:
        result = await session.execute(
            select(RatingEvent).where(RatingEvent.series_id == series_id).order_by(RatingEvent.team_id)
        )
        return list(result.scalars())


async def _events_for_team(session_factory, team_id: uuid.UUID) -> list[RatingEvent]:
    async with session_factory() as session:
        result = await session.execute(
            select(RatingEvent).where(RatingEvent.team_id == team_id).order_by(RatingEvent.created_at)
        )
        return list(result.scalars())


async def _current_run(session_factory) -> RatingRun:
    async with session_factory() as session:
        result = await session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))
        run = result.scalar_one_or_none()
        assert run is not None  # seeded by migration 0007
        return run


async def _seed_finalize_scenario(
    session_factory,
    *,
    format_: Literal["bo1", "bo3", "bo5"] = "bo3",
    winners: list[str],
    offset: int = 0,
    played_at: datetime | None = datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
):
    """Two teams, imported matches, a draft series with one game per ``winners``
    entry (``"A"``/``"B"`` = the team that wins that map) — ready to finalize.
    ``offset`` shifts the match henrik ids so repeated scenarios in one test do
    not collide on the same imported match row. ``played_at`` sets the series'
    ``played_at`` (default ``2026-01-10 12:00 UTC``; the D8 chronological-guard
    tests override it)."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    specs = [(f"m{i}", winner == "A", f"Map{i}") for i, winner in enumerate(winners, start=1)]
    matches = await _seed_matches(session_factory, specs, offset=offset)
    series_id = await _create_series(
        session_factory, team_a_id, team_b_id, format_=format_, played_at=played_at
    )
    for number in range(1, len(winners) + 1):
        await _attach(session_factory, series_id, matches[f"m{number}"].id, number)
    return team_a_id, team_b_id, series_id


# ------------------------------------------------------------------ atomic commit


async def test_finalize_commits_events_and_team_updates_atomically(session_factory) -> None:
    team_a_id, team_b_id, series_id = await _seed_finalize_scenario(session_factory, winners=["A", "A"])

    result = await _finalize(session_factory, series_id)

    assert result.status == "finalized"
    assert result.rating_mode == "normal"
    assert result.official_winner_id == team_a_id
    assert result.team_a_current_elo == Decimal(1034)
    assert result.team_b_current_elo == Decimal(971)

    series = await _series_row(session_factory, series_id)
    assert series.status == "finalized"
    assert series.calculated_winner_id == team_a_id
    assert series.official_winner_id == team_a_id
    assert series.team_a_maps_won == 2
    assert series.team_b_maps_won == 0
    assert series.rating_mode == "normal"  # durable policy mode (fix round 1)
    assert series.finalized_at is not None

    # Exactly two immutable events under the CURRENT run.
    run = await _current_run(session_factory)
    events = await _events_for_series(session_factory, series_id)
    assert len(events) == 2
    assert {event.run_id for event in events} == {run.id}
    by_team = {event.team_id: event for event in events}
    win = by_team[team_a_id]
    loss = by_team[team_b_id]
    assert win.result == "win" and loss.result == "loss"
    assert win.elo_before == Decimal(1000) and win.elo_after == Decimal(1034)
    assert win.elo_change == Decimal(34) and win.upset_bonus == Decimal(5)
    assert loss.elo_after == Decimal(971) and loss.elo_change == Decimal(-29)
    assert win.calculation_details["mode"] == "normal"
    assert win.calculation_details["raw_unrounded_new_elos"]["winner"] == pytest.approx(1034.0, abs=1e-9)

    # Both teams updated together.
    team_a = await _team_row(session_factory, team_a_id)
    team_b = await _team_row(session_factory, team_b_id)
    assert team_a.current_elo == Decimal(1034)
    assert team_a.peak_elo == Decimal(1034)
    assert team_a.matches_played == 2
    assert team_a.series_wins == 1
    assert team_b.current_elo == Decimal(971)
    assert team_b.peak_elo == Decimal(1000)
    assert team_b.matches_played == 2
    assert team_b.series_losses == 1


# ------------------------------------------------------------------ rollback


async def test_finalize_mid_transaction_failure_rolls_back_everything(session_factory, monkeypatch) -> None:
    """A failure after the winner event was already inserted rolls back the
    WHOLE transaction on real Postgres: no events, teams untouched, series a
    draft — the winner event is not half-committed."""
    team_a_id, team_b_id, series_id = await _seed_finalize_scenario(session_factory, winners=["A", "A"])
    calls = {"n": 0}
    original = RatingRepository.insert_rating_event

    async def poisoned(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] >= 2:  # winner event lands, loser insert raises
            raise RuntimeError("simulated mid-transaction failure")
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(RatingRepository, "insert_rating_event", poisoned)

    with pytest.raises(RuntimeError, match="mid-transaction"):
        await _finalize(session_factory, series_id)

    assert calls["n"] == 2
    assert await _events_for_series(session_factory, series_id) == []
    series = await _series_row(session_factory, series_id)
    assert series.status == "draft"
    assert series.official_winner_id is None
    assert series.finalized_at is None
    team_a = await _team_row(session_factory, team_a_id)
    team_b = await _team_row(session_factory, team_b_id)
    assert team_a.current_elo == Decimal(1000)
    assert team_a.matches_played == 0
    assert team_b.current_elo == Decimal(1000)
    assert team_b.series_losses == 0


# ------------------------------------------------------------------ idempotency


async def test_double_finalize_does_not_reapply_elo(session_factory) -> None:
    team_a_id, team_b_id, series_id = await _seed_finalize_scenario(session_factory, winners=["A", "A"])

    first = await _finalize(session_factory, series_id)
    assert len(first.events) == 2

    with pytest.raises(Exception) as excinfo:
        await _finalize(session_factory, series_id)
    assert getattr(excinfo.value, "code", None) == "SERIES_ALREADY_FINALIZED"
    assert getattr(excinfo.value, "status", None) == 409

    # No second rating: still exactly two events and the same team ratings.
    assert len(await _events_for_series(session_factory, series_id)) == 2
    assert (await _team_row(session_factory, team_a_id)).current_elo == Decimal(1034)
    assert (await _team_row(session_factory, team_b_id)).current_elo == Decimal(971)


# ------------------------------------------------------------------ concurrency


async def test_concurrent_same_series_finalize_wins_exactly_once(session_factory) -> None:
    """Two concurrent finalizes of the SAME series: the series ``FOR UPDATE``
    lock serializes them — exactly one succeeds and the other gets
    ``SERIES_ALREADY_FINALIZED``. Exactly two events are ever written."""
    _team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(session_factory, winners=["A", "A"])

    async def finalize_once() -> object:
        return await _finalize(session_factory, series_id)

    results = await asyncio.gather(finalize_once(), finalize_once(), return_exceptions=True)
    successes = [r for r in results if not isinstance(r, BaseException)]
    errors = [r for r in results if isinstance(r, BaseException)]
    assert len(successes) == 1
    assert len(errors) == 1
    assert errors[0].code == "SERIES_ALREADY_FINALIZED"  # type: ignore[union-attr]
    assert errors[0].status == 409  # type: ignore[union-attr]

    assert len(await _events_for_series(session_factory, series_id)) == 2
    series = await _series_row(session_factory, series_id)
    assert series.status == "finalized"


async def test_concurrent_cross_series_same_team_is_serialized(session_factory) -> None:
    """Two different series sharing team C are finalized concurrently: the team
    row locks (acquired smallest-UUID-first) serialize them, so team C's
    rating reflects BOTH series — no lost updates and exactly two events per
    series. Each series' only opponent series is identical, so C's final
    rating is deterministic regardless of which finalize wins the race."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    team_c_id = await _seed_team(session_factory, "Gamma")

    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),  # A beats C
            ("m2", True, "Bind"),  # B beats C
        ],
    )
    series_1 = await _create_series(session_factory, team_a_id, team_c_id, format_="bo1")
    series_2 = await _create_series(session_factory, team_b_id, team_c_id, format_="bo1")
    await _attach(session_factory, series_1, matches["m1"].id, 1)
    await _attach(session_factory, series_2, matches["m2"].id, 1)

    async def finalize_series(series_id: uuid.UUID) -> object:
        return await _finalize(session_factory, series_id)

    results = await asyncio.gather(
        finalize_series(series_1), finalize_series(series_2), return_exceptions=True
    )
    for result in results:
        assert not isinstance(result, BaseException), result

    # Exactly two events per series, all under the current run.
    assert len(await _events_for_series(session_factory, series_1)) == 2
    assert len(await _events_for_series(session_factory, series_2)) == 2
    assert len(await _events_for_team(session_factory, team_c_id)) == 2

    # Team C lost both series (13-9 BO1 losses, K=40 both times): its final
    # rating is order-independent — both orders start C at 1000 vs 1000 (loses
    # to 978), then move it from 978 to 957. The winner teams each gained 1027.
    _, c_after_first = EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")
    assert round(c_after_first, 0) == 978.0
    _, c_after_second = EloCalculator.calculate_new_elo(
        1000.0, round(c_after_first, 0), 0, 2, 13, 9, "regular", "bo1"
    )
    expected_c = round(c_after_second, 0)

    team_c = await _team_row(session_factory, team_c_id)
    assert team_c.current_elo == Decimal(str(expected_c))
    assert team_c.matches_played == 2
    assert team_c.series_losses == 2
    assert team_c.series_wins == 0
    # The winners' ratings ARE order-dependent: whichever winner faced C at
    # 1000 gained 1027, the other faced C at 978 and gained 1021 — both orders
    # are valid under the race, and both are reflected (no lost updates).
    assert {
        t.current_elo
        for t in (await _team_row(session_factory, team_a_id), await _team_row(session_factory, team_b_id))
    } == {
        Decimal(1021),
        Decimal(1027),
    }


async def test_concurrent_reversed_team_pairs_deadlock_free_with_sorted_locks(
    session_factory, test_engine
) -> None:
    """fix round 2 (advisory lock): two series with the SAME team pair in
    REVERSED team_a/team_b order are finalized concurrently. Since fix round 1
    every rating transaction first takes the shared ``RATING_WORK_LOCK_KEY``
    advisory lock, the two finalizes serialize globally — the pre-fix barrier
    (contending on the shared team rows) can no longer occur, and its premise
    is subsumed by the advisory lock. The recorded ``FOR UPDATE`` acquisition
    order still proves each finalize acquires its two teams smallest-UUID-first
    (sorted), and both complete with the deterministic double 2-0 sweep."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),  # series 1 map 1: A wins
            ("m2", True, "Bind"),  # series 1 map 2: A wins
            ("m3", False, "Split"),  # series 2 map 1: blue (A) wins
            ("m4", False, "Haven"),  # series 2 map 2: blue (A) wins
        ],
    )
    series_1 = await _create_series(session_factory, team_a_id, team_b_id)  # A vs B
    series_2 = await _create_series(session_factory, team_b_id, team_a_id)  # B vs A (reversed)
    await _attach(session_factory, series_1, matches["m1"].id, 1)
    await _attach(session_factory, series_1, matches["m2"].id, 2)
    await _attach(session_factory, series_2, matches["m3"].id, 1)
    await _attach(session_factory, series_2, matches["m4"].id, 2)

    min_team = min(team_a_id, team_b_id)
    max_team = max(team_a_id, team_b_id)
    lock_order = _record_team_lock_order(test_engine)

    async def finalize_series(series_id: uuid.UUID) -> object:
        return await _finalize(session_factory, series_id)

    results = await asyncio.wait_for(
        asyncio.gather(finalize_series(series_1), finalize_series(series_2), return_exceptions=True),
        timeout=30,
    )
    for result in results:
        assert not isinstance(result, BaseException), result

    # Both finalizes acquired their two teams smallest-UUID-first.
    assert lock_order == [min_team, max_team, min_team, max_team]

    # Exactly two events per series; A won both series, B lost both.
    assert len(await _events_for_series(session_factory, series_1)) == 2
    assert len(await _events_for_series(session_factory, series_2)) == 2
    team_a = await _team_row(session_factory, team_a_id)
    team_b = await _team_row(session_factory, team_b_id)
    assert team_a.series_wins == 2 and team_b.series_losses == 2
    assert team_a.matches_played == 4 and team_b.matches_played == 4
    # Deterministic double 2-0 sweep: A 1000 -> 1027 -> 1046; B 1000 -> 978 -> 959.
    w1, l1 = EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 26, 18, "regular", "bo3", 2, 0)
    w2, l2 = EloCalculator.calculate_new_elo(round(w1, 0), round(l1, 0), 2, 2, 26, 18, "regular", "bo3", 2, 0)
    assert team_a.current_elo == Decimal(str(round(w2, 0)))
    assert team_b.current_elo == Decimal(str(round(l2, 0)))


# ------------------------------------------- refresh/finalize protocol (fix round 1)


async def test_draft_series_match_refresh_allowed_and_reflected_in_rating(session_factory) -> None:
    """fix round 1: refreshing a match attached to a DRAFT series is allowed,
    and the finalize that follows reads the refreshed canonical state and rates
    on it (a 13-9 rating of 1027 becomes a 13-4 rating of 1035)."""
    team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, format_="bo1", winners=["A"]
    )
    henrik_id = _ID % "01"
    refreshed = await _refresh_match(
        session_factory,
        henrik_id,
        _variant_with_scores(henrik_id, red_rounds=13, blue_rounds=4, map_name="Ascent"),
    )
    assert refreshed.created is False

    result = await _finalize(session_factory, series_id)

    assert result.calculated_winner_id == team_a_id
    assert result.team_a_current_elo == Decimal("1035.0")
    assert result.team_b_current_elo == Decimal("970.0")
    win = next(e for e in result.events if e.result == "win")
    details = win.calculation_details["inputs"]
    # The rating was computed from the REFRESHED canonical margin (13-4), not
    # the stale attach-time copy (13-9).
    assert (details["winner_rounds"], details["loser_rounds"]) == (13, 4)
    series = await _series_row(session_factory, series_id)
    assert series.status == "finalized"
    assert series.rating_mode == "normal"


async def test_refresh_and_finalize_race_uses_one_committed_canonical_state(session_factory) -> None:
    """fix round 1 (Critical): a refresh of an attached match and a finalize of
    its series are serialized on the OWNING series row lock. The finalize's
    rating inputs are ALWAYS the canonical state committed at its locked read —
    never a mixed or uncommitted state: if the refresh commits first the rating
    reflects the new margin (13-4 -> 1035), and if the finalize commits first
    the refresh is rejected (409) and the match stays untouched (13-9 -> 1027)."""
    team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, format_="bo1", winners=["A"]
    )
    henrik_id = _ID % "01"
    refresh_fixture = _variant_with_scores(henrik_id, red_rounds=13, blue_rounds=4, map_name="Ascent")

    async def do_finalize():
        return await _finalize(session_factory, series_id)

    async def do_refresh():
        return await _refresh_match(session_factory, henrik_id, refresh_fixture)

    results = await asyncio.wait_for(
        asyncio.gather(do_finalize(), do_refresh(), return_exceptions=True), timeout=30
    )
    finalize_result = next(r for r in results if isinstance(r, FinalizeResult))
    refresh_outcome = next(r for r in results if r is not finalize_result)

    # The final committed canonical state after the race:
    async with session_factory() as session:
        match = (await session.execute(select(Match).where(Match.henrik_match_id == henrik_id))).scalar_one()
        red, blue = match.red_score, match.blue_score

    if isinstance(refresh_outcome, BaseException):
        # Finalize won the series lock first: refresh rejected, match unchanged.
        assert getattr(refresh_outcome, "code", None) == "MATCH_REFRESH_REJECTED"
        assert (red, blue) == (13, 9)
    else:
        # Refresh won the series lock first: match updated to the new margin.
        assert getattr(refresh_outcome, "created", None) is False
        assert (red, blue) == (13, 4)

    # The rating is ALWAYS computed from the final committed canonical state —
    # the same scores the (now committed) match row holds — never a mixture.
    assert finalize_result.calculated_winner_id == team_a_id
    win = next(e for e in finalize_result.events if e.result == "win")
    details = win.calculation_details["inputs"]
    assert (details["winner_rounds"], details["loser_rounds"]) == (red, blue)
    expected_winner = round(
        EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, red, blue, "regular", "bo1")[0], 0
    )
    assert win.elo_after == Decimal(str(expected_winner))
    # Exactly two events were ever written (no double rating).
    assert len(await _events_for_series(session_factory, series_id)) == 2


# ------------------------------------------------ durable rating mode (fix round 1)


async def test_forfeit_finalize_persists_distinct_rating_mode(session_factory) -> None:
    """fix round 1: the resolved ``rating_mode`` is persisted atomically on the
    series so ``forfeit_no_rating`` vs ``forfeit_result_only`` stay
    distinguishable for audit/rebuild even though neither writes events."""
    for mode, offset in (("forfeit_no_rating", 0), ("forfeit_result_only", 10)):
        team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(
            session_factory, format_="bo1", winners=["A"], offset=offset
        )
        result = await _finalize(
            session_factory,
            series_id,
            FinalizeRequest(rating_mode=mode, override_reason="declared after play"),  # type: ignore[arg-type]
        )

        assert result.rating_mode == mode
        assert result.events == []
        series = await _series_row(session_factory, series_id)
        assert series.rating_mode == mode
        assert series.status == "finalized"
        team_a = await _team_row(session_factory, team_a_id)
        if mode == "forfeit_result_only":
            assert team_a.series_wins == 1
        else:
            assert team_a.series_wins == 0


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


# ------------------------------------------- rating_events immutability (fix round 1)


async def test_rating_events_are_immutable_at_db_level(session_factory) -> None:
    """fix round 1: the DB trigger rejects UPDATE and DELETE on rating_events
    (immutable audit records); inserts and the unique double-rate guard are
    preserved."""
    _team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(session_factory, winners=["A", "A"])
    await _finalize(session_factory, series_id)
    events = await _events_for_series(session_factory, series_id)
    assert len(events) == 2
    event = events[0]

    async with session_factory() as session:
        with pytest.raises(Exception, match="immutable"):
            await session.execute(
                text("UPDATE rating_events SET elo_after = 1 WHERE id = :event_id"),
                {"event_id": event.id},
            )
        await session.rollback()

    async with session_factory() as session:
        with pytest.raises(Exception, match="immutable"):
            await session.execute(
                text("DELETE FROM rating_events WHERE id = :event_id"),
                {"event_id": event.id},
            )
        await session.rollback()

    # Rows intact; the unique (run_id, series_id, team_id) double-rate guard
    # still fires immediately for a same-team third event (the deferred pair
    # guard covers the partial/wrong/duplicate/third-series cases at COMMIT).
    assert len(await _events_for_series(session_factory, series_id)) == 2
    async with session_factory() as session:
        with pytest.raises(IntegrityError, match="rating_events_run_series_team_key"):
            await session.execute(
                text(
                    "INSERT INTO rating_events "
                    "(run_id, series_id, team_id, sequence, elo_before, elo_after, elo_change, "
                    " opponent_team_id, result, calculation_details) "
                    "VALUES (:run_id, :series_id, :team_id, 1, 1, 1, 0, :opponent, 'win', '{}'::jsonb)"
                ),
                {
                    "run_id": event.run_id,
                    "series_id": event.series_id,
                    "team_id": event.team_id,
                    "opponent": event.opponent_team_id,
                },
            )
        await session.rollback()

    async with session_factory() as session:
        constraint = await session.scalar(
            text(
                "SELECT conname FROM pg_constraint "
                "WHERE conname = 'rating_events_run_series_team_key'"
            )
        )
        assert constraint == "rating_events_run_series_team_key"


# ------------------------------------------------------------------ event replay


async def test_finalized_events_replay_to_current_standings(session_factory) -> None:
    """The immutable event stream fully explains every current rating: replaying
    ``initial_elo + sum(elo_change)`` per team reproduces ``current_elo``. This
    is the deterministic basis the Task 16 rebuild replays into a new run."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    team_c_id = await _seed_team(session_factory, "Gamma")
    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),
            ("m2", True, "Bind"),
            ("m3", False, "Split"),  # B beats C
            ("m4", True, "Haven"),  # A beats C
        ],
    )
    series_1 = await _create_series(
        session_factory, team_a_id, team_b_id, played_at=datetime(2026, 1, 11, 12, 0, tzinfo=UTC)
    )
    series_2 = await _create_series(
        session_factory,
        team_b_id,
        team_c_id,
        format_="bo1",
        played_at=datetime(2026, 1, 12, 12, 0, tzinfo=UTC),
    )
    series_3 = await _create_series(
        session_factory,
        team_a_id,
        team_c_id,
        format_="bo1",
        played_at=datetime(2026, 1, 13, 12, 0, tzinfo=UTC),
    )
    await _attach(session_factory, series_1, matches["m1"].id, 1)
    await _attach(session_factory, series_1, matches["m2"].id, 2)
    await _attach(session_factory, series_2, matches["m3"].id, 1)
    await _attach(session_factory, series_3, matches["m4"].id, 1)
    for series_id in (series_1, series_2, series_3):
        await _finalize(session_factory, series_id)

    async with session_factory() as session:
        teams = (await session.execute(select(Team))).scalars().all()
        current_by_id = {team.id: team.current_elo for team in teams}

    for team_id in (team_a_id, team_b_id, team_c_id):
        events = await _events_for_team(session_factory, team_id)
        replayed = Decimal(1000) + sum((event.elo_change for event in events), Decimal(0))
        assert replayed == current_by_id[team_id], f"team {team_id} event replay diverges"

    # Every team has a history of exactly one event per rated series.
    assert len(await _events_for_team(session_factory, team_a_id)) == 2  # series_1 win + series_3 win
    assert len(await _events_for_team(session_factory, team_b_id)) == 2  # series_1 loss + series_2 win
    assert len(await _events_for_team(session_factory, team_c_id)) == 2  # two losses


# ------------------------------------------------------------------ API surface


async def test_finalize_route_is_service_token_gated_and_idempotent(session_factory, monkeypatch) -> None:
    """The finalize route requires a Quest service token outside ``test``/
    ``local`` and surfaces the stable error codes through the API: 401 without
    the token, success with it, then 409 ``SERIES_ALREADY_FINALIZED`` on the
    repeat. The signed token claims are persisted as the series audit fields
    (delta D7; spec §9.2)."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: production_settings(app_env="production"),
    )
    app = create_app()

    async def _rating_override():
        async with session_factory() as session:
            yield _rating_service(session)

    app.dependency_overrides[get_rating_service] = _rating_override

    async def _series_override():
        async with session_factory() as session:
            yield _series_service(session)

    app.dependency_overrides[get_series_service] = _series_override
    _team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(session_factory, winners=["A", "A"])

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # No service token -> 401 ADMIN_AUTH_REQUIRED, nothing rated.
        denied = await client.post(f"{BASE}/{series_id}/finalize", json={})
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"

        # With the service token -> 200 finalized with two events.
        ok = await client.post(
            f"{BASE}/{series_id}/finalize",
            json={},
            headers=service_token_headers(sub="actor-7", operation_id="op-finalize"),
        )
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["status"] == "finalized"
        assert body["rating_mode"] == "normal"
        assert len(body["events"]) == 2
        assert body["team_a_current_elo"] == "1034.0"
        assert body["team_b_current_elo"] == "971.0"

        # The signed token claims were persisted as the series audit fields
        # (delta D7): the Quest sub and operation_id, not the request_id.
        series_row = await _series_row(session_factory, series_id)
        assert series_row.finalized_by_actor_id == "actor-7"
        assert series_row.finalized_by_operation_id == "op-finalize"

        # Repeat -> 409 SERIES_ALREADY_FINALIZED, no re-rating.
        again = await client.post(
            f"{BASE}/{series_id}/finalize",
            json={},
            headers=service_token_headers(sub="actor-7", operation_id="op-finalize"),
        )
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "SERIES_ALREADY_FINALIZED"

        # The durable rating mode is exposed through the series reads too.
        detail = (
            await client.get(f"{BASE}/{series_id}", headers=service_token_headers())
        ).json()
        assert detail["status"] == "finalized"
        assert detail["rating_mode"] == "normal"

    assert len(await _events_for_series(session_factory, series_id)) == 2
