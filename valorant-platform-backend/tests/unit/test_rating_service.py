"""Atomic finalization unit tests (plan Task 15; design §10.3, §13, App. B).

In-memory repositories + fake session — no network, no DB. ``RatingService
.finalize`` is driven through its exact repository surface (series lock,
canonical games read, team lock, current run, event insert) so every business
rule is testable without Postgres:

- BO3 2-0 finalize → two events, both team updates, series finalized exactly
  once;
- a simulated mid-transaction failure rolls everything back (nothing persisted);
- double finalize → ``SERIES_ALREADY_FINALIZED`` (no second rating, teams
  untouched);
- equal ratings → the winner event carries ``upset_bonus=5`` and the legacy
  ``+5`` is present in ``elo_change``;
- ``round(..., 0)`` persistence order: the persisted ``current_elo`` is the
  rounded integer while the raw unrounded new elos live in
  ``calculation_details`` (elo_change is ``round(new - input, 0)``, NOT
  ``round(after) - round(before)``);
- ``forfeit_no_rating`` → no events, no rating change, no counters;
  ``forfeit_result_only`` → winner + counters, no rating;
- ``RATING_POLICY_REQUIRED`` when an override carries a reason but no explicit
  mode; official winner must be a team of the series;
- a series with ``played_at IS NULL`` and an invalid BO shape are rejected
  before any rating work;
- the resolved policy ``mode`` is persisted durably on the series (fix round 1)
  so ``forfeit_no_rating`` vs ``forfeit_result_only`` stay distinguishable for
  audit/rebuild;
- the "series finalized" audit log is emitted only after a successful commit
  (fix round 1): a failed commit or mid-transaction rollback never logs success.
"""

from __future__ import annotations

import copy
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.api.errors import AppError
from app.api.service_token import ServicePrincipal
from app.domain.series.bo import CanonicalGameSnapshot
from app.schemas.series import FinalizeRequest
from app.services.rating_service import RatingService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)

TEAM_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TEAM_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
SERIES = uuid.UUID("33333333-3333-3333-3333-333333333333")


# ------------------------------------------------------------------ in-memory model


@dataclass
class MemTeam:
    id: uuid.UUID
    current_elo: Decimal
    peak_elo: Decimal
    matches_played: int
    series_wins: int
    series_losses: int
    is_active: bool = True


@dataclass
class MemSeries:
    id: uuid.UUID
    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    format: str
    importance: str
    status: str
    played_at: datetime | None
    team_a_maps_won: int = 0
    team_b_maps_won: int = 0
    calculated_winner_id: uuid.UUID | None = None
    official_winner_id: uuid.UUID | None = None
    winner_override_reason: str | None = None
    rating_mode: str | None = None
    finalized_at: datetime | None = None
    # D6: anchor PUUIDs (defaults keep every existing rated test green once the
    # match-repo mirror provides opposing sides).
    anchor_a_puuid: str | None = "puuid_a"
    anchor_b_puuid: str | None = "puuid_b"
    # D7: validated Quest actor/operation claims persisted on finalize (None
    # while a draft or when finalize runs without a principal).
    finalized_by_actor_id: str | None = None
    finalized_by_operation_id: str | None = None


@dataclass
class MemGame:
    game_number: int
    match_id: uuid.UUID
    team_a_side: str
    team_b_side: str
    stored_winner_team_id: uuid.UUID | None


@dataclass
class MemMatch:
    id: uuid.UUID
    map_name: str
    red_score: int | None
    blue_score: int | None
    is_completed: bool


@dataclass
class MemRun:
    id: uuid.UUID
    run_number: int
    note: str | None


@dataclass
class MemEvent:
    id: uuid.UUID
    run_id: uuid.UUID
    series_id: uuid.UUID
    team_id: uuid.UUID
    opponent_team_id: uuid.UUID
    result: str
    elo_before: Decimal
    elo_after: Decimal
    elo_change: Decimal
    sequence: int = 1
    k_factor: Decimal | None = None
    expected_score: Decimal | None = None
    performance_multiplier: Decimal | None = None
    importance_multiplier: Decimal | None = None
    upset_bonus: Decimal | None = None
    calculation_details: dict = field(default_factory=dict)
    created_at: datetime = START


class Store:
    """Transactional in-memory state: writes land only on ``commit``.

    The fake session snapshots the state at every commit and restores it on
    rollback — mirroring the real Postgres transaction the service relies on,
    so a simulated mid-transaction failure provably persists nothing.
    """

    def __init__(
        self,
        *,
        series: MemSeries,
        teams: list[MemTeam],
        games: list[MemGame],
        matches: dict[uuid.UUID, MemMatch],
        run: MemRun,
        anchor_sides: dict[uuid.UUID, dict[str, str]] | None = None,
    ) -> None:
        self._series = series
        self._teams: dict[uuid.UUID, MemTeam] = {team.id: team for team in teams}
        self._games = list(games)
        self._matches = dict(matches)
        self._run = run
        self.events: list[MemEvent] = []
        self.anchor_sides: dict[uuid.UUID, dict[str, str]] = dict(anchor_sides or {})
        self._baseline: dict | None = None
        self.checkpoint()

    def checkpoint(self) -> None:
        self._baseline = copy.deepcopy(
            {
                "series": self._series,
                "teams": self._teams,
                "games": self._games,
                "matches": self._matches,
                "run": self._run,
                "events": self.events,
                "anchor_sides": self.anchor_sides,
            }
        )

    def restore(self) -> None:
        baseline = self._baseline
        assert baseline is not None
        base = copy.deepcopy(baseline)
        self._series = base["series"]
        self._teams = base["teams"]
        self._games = base["games"]
        self._matches = base["matches"]
        self._run = base["run"]
        self.events = base["events"]
        self.anchor_sides = base["anchor_sides"]
        self._series = base["series"]
        self._teams = base["teams"]
        self._games = base["games"]
        self._matches = base["matches"]
        self._run = base["run"]
        self.events = base["events"]
        self.anchor_sides = base["anchor_sides"]

    @property
    def series(self) -> MemSeries:
        return self._series

    def team(self, team_id: uuid.UUID) -> MemTeam:
        return self._teams[team_id]

    def teams(self) -> list[MemTeam]:
        return list(self._teams.values())


class InMemorySeriesRepository:
    """Mirrors the ``SeriesRepository`` methods ``RatingService`` calls."""

    def __init__(self, store: Store) -> None:
        self._store = store
        self.locks: list[uuid.UUID] = []
        # D8: the newest played_at among finalized rated series (None = none yet).
        self.latest_finalized_rated_played_at: datetime | None = None

    async def get_by_id_for_update(self, series_id: uuid.UUID) -> MemSeries | None:
        self.locks.append(series_id)
        if self._store.series.id != series_id:
            return None
        return self._store.series

    async def get_series_with_canonical_games(
        self, series_id: uuid.UUID
    ) -> tuple[MemSeries | None, list[CanonicalGameSnapshot]]:
        series = self._store.series
        if series.id != series_id:
            return None, []
        snapshots: list[CanonicalGameSnapshot] = []
        for game in sorted(self._store._games, key=lambda g: g.game_number):
            match = self._store._matches.get(game.match_id)
            if match is None:
                continue
            snapshots.append(
                CanonicalGameSnapshot(
                    game_id=uuid.uuid4(),
                    game_number=game.game_number,
                    match_id=game.match_id,
                    map_name=match.map_name,
                    team_a_side=game.team_a_side,
                    team_b_side=game.team_b_side,
                    stored_winner_team_id=game.stored_winner_team_id,
                    red_score=match.red_score,
                    blue_score=match.blue_score,
                    is_completed=match.is_completed,
                )
            )
        return series, snapshots

    async def get_latest_finalized_rated_played_at(self, rated_modes=None) -> datetime | None:
        return self.latest_finalized_rated_played_at


class InMemoryRatingRepository:
    """Mirrors the ``RatingRepository`` methods ``RatingService`` calls."""

    def __init__(self, store: Store) -> None:
        self._store = store
        self.insert_calls = 0
        self.fail_on_insert: int | None = None  # raise on the Nth insert call

    async def get_current_run(self) -> MemRun:
        return self._store._run

    async def acquire_rating_work_lock(self) -> None:
        """In-memory no-op: the advisory lock is a Postgres serialization
        primitive proven by the real-Postgres race tests."""

    async def reserve_event_sequence(self, run_id: uuid.UUID, series_id: uuid.UUID) -> int:
        """Mirror the real max+1 per-run reservation (events carry the reserved
        sequence, so the in-memory store reads them)."""
        used = [event.sequence for event in self._store.events if event.run_id == run_id]
        return max(used, default=0) + 1

    async def get_teams_for_update_sorted(
        self, team_a_id: uuid.UUID, team_b_id: uuid.UUID
    ) -> tuple[MemTeam, MemTeam]:
        teams = self._store._teams
        return teams[team_a_id], teams[team_b_id]

    async def insert_rating_event(self, **values: object) -> MemEvent:
        self.insert_calls += 1
        if self.fail_on_insert is not None and self.insert_calls >= self.fail_on_insert:
            raise RuntimeError("simulated mid-transaction failure")
        event = MemEvent(id=uuid.uuid4(), created_at=START, **values)  # type: ignore[arg-type]
        self._store.events.append(event)
        return event


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


class FakeSession:
    def __init__(self, store: Store) -> None:
        self._store = store
        self.committed = 0
        self.rolled_back = 0
        self.fail_commit = False

    async def flush(self) -> None:
        """In-memory writes are already applied; nothing to emit."""

    async def commit(self) -> None:
        if self.fail_commit:
            raise RuntimeError("simulated commit failure")
        self.committed += 1
        self._store.checkpoint()

    async def rollback(self) -> None:
        self.rolled_back += 1
        self._store.restore()


# --------------------------------------------------------------------- helpers


def _team(team_id: uuid.UUID, *, elo: float, matches: int) -> MemTeam:
    return MemTeam(
        id=team_id,
        current_elo=Decimal(str(elo)),
        peak_elo=Decimal(str(elo)),
        matches_played=matches,
        series_wins=0,
        series_losses=0,
    )


def _scenario(
    *,
    format_: str,
    rounds: list[tuple[int, int]],
    played_at: datetime | None = START,
    team_a_elo: float = 1000.0,
    team_b_elo: float = 1000.0,
    team_a_matches: int = 0,
    team_b_matches: int = 0,
    importance: str = "regular",
    scenario_anchor_sides: dict[uuid.UUID, dict[str, str]] | None = None,
) -> Store:
    """Two teams + a draft series + one game per ``rounds`` entry.

    ``rounds`` is a list of ``(team_a_rounds, team_b_rounds)``; the per-game
    stored winner is derived from the round totals (mirroring the real flow).
    Every game's ``anchor_sides`` default to opposing anchors
    (``puuid_a``/``puuid_b`` on red/blue); ``scenario_anchor_sides`` overrides
    per-game sides for the negative verification tests.
    """
    team_a = _team(TEAM_A, elo=team_a_elo, matches=team_a_matches)
    team_b = _team(TEAM_B, elo=team_b_elo, matches=team_b_matches)
    series = MemSeries(
        id=SERIES,
        team_a_id=team_a.id,
        team_b_id=team_b.id,
        format=format_,
        importance=importance,
        status="draft",
        played_at=played_at,
    )
    games: list[MemGame] = []
    matches: dict[uuid.UUID, MemMatch] = {}
    anchor_sides: dict[uuid.UUID, dict[str, str]] = {}
    for number, (team_a_rounds, team_b_rounds) in enumerate(rounds, start=1):
        winner = team_a.id if team_a_rounds > team_b_rounds else team_b.id
        match = MemMatch(
            id=uuid.uuid4(),
            map_name="Ascent",
            red_score=team_a_rounds,
            blue_score=team_b_rounds,
            is_completed=True,
        )
        matches[match.id] = match
        games.append(
            MemGame(
                game_number=number,
                match_id=match.id,
                team_a_side="red",
                team_b_side="blue",
                stored_winner_team_id=winner,
            )
        )
        anchor_sides[match.id] = {"puuid_a": "red", "puuid_b": "blue"}
    if scenario_anchor_sides is not None:
        anchor_sides.update(scenario_anchor_sides)
    run = MemRun(id=uuid.uuid4(), run_number=1, note="initial live run")
    return Store(
        series=series,
        teams=[team_a, team_b],
        games=games,
        matches=matches,
        run=run,
        anchor_sides=anchor_sides,
    )


def _service(
    store: Store,
    rating_repo: InMemoryRatingRepository | None = None,
    *,
    fail_commit: bool = False,
):
    session = FakeSession(store)
    session.fail_commit = fail_commit
    svc = RatingService(
        session=session,  # type: ignore[arg-type]
        series_repo=InMemorySeriesRepository(store),  # type: ignore[arg-type]
        rating_repo=rating_repo or InMemoryRatingRepository(store),  # type: ignore[arg-type]
        match_repo=InMemoryMatchRepository(store),  # type: ignore[arg-type]
    )
    return svc, session


def _winning_rounds(winners: list[str]) -> list[tuple[int, int]]:
    """``winners`` of ``"A"``/``"B"`` -> ``(13, 9)``/``(9, 13)`` games."""
    return [(13, 9) if winner == "A" else (9, 13) for winner in winners]


def _event_by_team(events: list[MemEvent], team_id: uuid.UUID) -> MemEvent:
    return next(event for event in events if event.team_id == team_id)


# --------------------------------------------------------------- happy path


async def test_finalize_bo3_sweep_writes_two_events_and_updates_teams() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, session = _service(store)

    result = await svc.finalize(store.series.id, FinalizeRequest())

    # Response contract.
    assert result.status == "finalized"
    assert result.rating_mode == "normal"
    assert result.calculated_winner_id == TEAM_A
    assert result.official_winner_id == TEAM_A
    assert result.team_a_current_elo == Decimal(1034)
    assert result.team_b_current_elo == Decimal(971)
    assert len(result.events) == 2

    # Series finalized exactly once with the derived result recorded.
    series = store.series
    assert series.status == "finalized"
    assert series.calculated_winner_id == TEAM_A
    assert series.official_winner_id == TEAM_A
    assert series.team_a_maps_won == 2
    assert series.team_b_maps_won == 0
    assert series.rating_mode == "normal"  # durable policy mode (fix round 1)
    assert series.finalized_at is not None
    assert session.committed == 1

    # Both teams updated: current + peak, matches_played += games, counters.
    team_a = store.team(TEAM_A)
    team_b = store.team(TEAM_B)
    assert team_a.current_elo == Decimal(1034)
    assert team_a.peak_elo == Decimal(1034)
    assert team_a.matches_played == 2
    assert team_a.series_wins == 1
    assert team_a.series_losses == 0
    assert team_b.current_elo == Decimal(971)
    assert team_b.peak_elo == Decimal(1000)  # peak never drops
    assert team_b.matches_played == 2
    assert team_b.series_wins == 0
    assert team_b.series_losses == 1

    # Two immutable events under the current run, one per team.
    assert len(store.events) == 2
    win = _event_by_team(store.events, TEAM_A)
    loss = _event_by_team(store.events, TEAM_B)
    assert win.run_id == store._run.id
    assert win.series_id == SERIES
    assert win.result == "win" and win.opponent_team_id == TEAM_B
    assert win.elo_before == Decimal(1000)
    assert win.elo_after == Decimal(1034)
    assert win.elo_change == Decimal(34)
    assert win.k_factor == Decimal(40)
    assert win.expected_score == Decimal("0.5")
    assert win.performance_multiplier == Decimal("1.45")
    assert win.importance_multiplier == Decimal(1)
    assert win.upset_bonus == Decimal(5)
    assert loss.result == "loss" and loss.opponent_team_id == TEAM_A
    assert loss.elo_before == Decimal(1000)
    assert loss.elo_after == Decimal(971)
    assert loss.elo_change == Decimal(-29)
    assert loss.upset_bonus == Decimal(0)

    # calculation_details records the policy, raw unrounded elos, base changes.
    details = win.calculation_details
    assert details["mode"] == "normal"
    assert details["is_override"] is False
    assert details["raw_unrounded_new_elos"]["winner"] == pytest.approx(1034.0, abs=1e-9)
    assert details["raw_unrounded_new_elos"]["loser"] == pytest.approx(971.0, abs=1e-9)
    assert details["base_changes"]["winner"] == pytest.approx(29.0, abs=1e-9)
    assert details["base_changes"]["loser"] == pytest.approx(-29.0, abs=1e-9)
    assert details["inputs"]["winner_elo"] == 1000.0
    assert details["inputs"]["winner_rounds"] == 26
    assert details["inputs"]["loser_rounds"] == 18
    assert details["inputs"]["winner_maps"] == 2
    assert details["inputs"]["loser_maps"] == 0
    assert details["inputs"]["format"] == "bo3"
    assert details["inputs"]["importance"] == "regular"
    assert details["inputs"]["upset_bonus"] == 5


async def test_finalize_equal_ratings_applies_legacy_five_upset() -> None:
    """Equal ratings are not ``elo_diff < 0``, so the legacy ``+5`` upset is
    applied and lands in the winner's ``elo_change`` (29 base + 5 upset)."""
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    await svc.finalize(store.series.id, FinalizeRequest())

    win = _event_by_team(store.events, TEAM_A)
    assert win.upset_bonus == Decimal(5)
    assert win.calculation_details["inputs"]["upset_bonus"] == 5
    # Base change without the upset would be +29; with the legacy +5 it is +34.
    assert win.calculation_details["base_changes"]["winner"] == pytest.approx(29.0, abs=1e-9)
    assert win.elo_change == Decimal(34)


async def test_finalize_persists_rounded_ratings_with_unrounded_details() -> None:
    """``round(..., 0)`` persistence order (ADR-014, characterization-pinned):
    the persisted ``current_elo`` is the rounded integer while the raw
    unrounded new elos live in ``calculation_details``. ``elo_change`` is
    ``round(new - input, 0)`` — NOT ``round(after) - round(before)``, which
    differs for fractional inputs."""
    store = _scenario(
        format_="bo1",
        rounds=[(13, 5)],
        team_a_elo=1500.5,
        team_b_elo=1000.5,
        team_a_matches=10,
        team_b_matches=5,
    )
    svc, _session = _service(store)

    result = await svc.finalize(store.series.id, FinalizeRequest())

    assert result.team_a_current_elo == Decimal(1503)
    assert result.team_b_current_elo == Decimal(998)
    assert store.team(TEAM_A).current_elo == Decimal(1503)
    assert store.team(TEAM_B).current_elo == Decimal(998)

    win = _event_by_team(store.events, TEAM_A)
    loss = _event_by_team(store.events, TEAM_B)
    # Persisted elo_before is the input rating; elo_after is round(new, 0).
    assert win.elo_before == Decimal("1500.5")
    assert win.elo_after == Decimal(1503)
    assert loss.elo_after == Decimal(998)

    # elo_change is round(new - input, 0) — the legacy order. The winner's
    # persisted after-before difference (2.5) differs from the change (2.0),
    # proving the difference is rounded FIRST (never the difference of rounds).
    assert win.elo_change == Decimal(2)
    assert loss.elo_change == Decimal(-3)
    assert win.elo_after - win.elo_before == Decimal("2.5")
    assert win.elo_change != win.elo_after - win.elo_before

    # The raw unrounded new elos are preserved for audit/rebuild.
    details = win.calculation_details
    assert details["raw_unrounded_new_elos"]["winner"] == pytest.approx(1502.736089038485, abs=1e-9)
    assert details["raw_unrounded_new_elos"]["loser"] == pytest.approx(997.5185479486867, abs=1e-9)


async def test_finalize_manual_override_rates_official_winner_with_details() -> None:
    """An override (official != calculated) + reason + ``manual_override`` rates
    the OFFICIAL winner (ADR-011) using the imported margin as the performance
    input (ADR-012); ``calculation_details`` records the override + mode
    (ADR-013)."""
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    result = await svc.finalize(
        store.series.id,
        FinalizeRequest(
            official_winner_id=TEAM_B,
            override_reason="eligibility ruling",
            rating_mode="manual_override",
        ),
    )

    assert result.rating_mode == "manual_override"
    assert result.official_winner_id == TEAM_B
    assert result.calculated_winner_id == TEAM_A  # games still say team A
    assert len(store.events) == 2

    win = _event_by_team(store.events, TEAM_B)
    loss = _event_by_team(store.events, TEAM_A)
    assert win.result == "win" and loss.result == "loss"
    # Official winner (B) gained rating; official loser (A) lost it.
    assert win.elo_after == Decimal(1027)
    assert win.elo_change == Decimal(27)
    assert loss.elo_after == Decimal(978)
    assert loss.elo_change == Decimal(-22)

    details = win.calculation_details
    assert details["mode"] == "manual_override"
    assert details["override_reason"] == "eligibility ruling"
    assert details["is_override"] is True
    # ADR-012: the imported margin drives the performance multiplier even when
    # the official winner differs from the calculated winner (winner_maps 0).
    assert details["inputs"]["winner_maps"] == 0
    assert details["inputs"]["loser_maps"] == 2

    # Series records both winners and the override reason.
    series = store.series
    assert series.status == "finalized"
    assert series.calculated_winner_id == TEAM_A
    assert series.official_winner_id == TEAM_B
    assert series.winner_override_reason == "eligibility ruling"
    assert series.rating_mode == "manual_override"  # durable policy mode


# --------------------------------------------------------------- rollback & idempotency


async def test_finalize_mid_transaction_failure_rolls_back_everything(caplog) -> None:
    """A failure after the winner event was already inserted rolls back the
    whole transaction: no events, no team updates, series still a draft, and
    no "series finalized" success log is emitted (fix round 1)."""
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    rating_repo = InMemoryRatingRepository(store)
    rating_repo.fail_on_insert = 2  # winner event lands, loser insert raises
    svc, session = _service(store, rating_repo=rating_repo)

    with (
        caplog.at_level(logging.INFO, logger="app.rating"),
        pytest.raises(RuntimeError, match="mid-transaction"),
    ):
        await svc.finalize(store.series.id, FinalizeRequest())

    assert session.rolled_back == 1
    assert session.committed == 0
    assert not any("series finalized" in record.message for record in caplog.records)
    assert store.events == []
    assert store.series.status == "draft"
    assert store.series.official_winner_id is None
    assert store.series.finalized_at is None
    assert store.series.rating_mode is None
    assert all(team.current_elo == Decimal(1000) for team in store.teams())
    assert all(team.matches_played == 0 for team in store.teams())
    assert all(team.series_wins == 0 and team.series_losses == 0 for team in store.teams())


async def test_double_finalize_is_rejected_and_never_reapplies_elo() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    first = await svc.finalize(store.series.id, FinalizeRequest())
    assert len(store.events) == 2

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())

    assert excinfo.value.code == "SERIES_ALREADY_FINALIZED"
    assert excinfo.value.status == 409
    assert len(store.events) == 2  # no second rating
    assert store.team(TEAM_A).current_elo == Decimal(1034)  # unchanged
    assert store.team(TEAM_B).current_elo == Decimal(971)
    assert first.team_a_current_elo == Decimal(1034)


# --------------------------------------------------------------- forfeit modes


async def test_finalize_forfeit_no_rating_records_result_only() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    result = await svc.finalize(
        store.series.id, FinalizeRequest(rating_mode="forfeit_no_rating", override_reason="team B no-show")
    )

    assert result.rating_mode == "forfeit_no_rating"
    assert result.events == []
    assert result.team_a_current_elo == Decimal(1000)
    assert result.team_b_current_elo == Decimal(1000)
    assert store.events == []
    assert store.series.status == "finalized"
    assert store.series.calculated_winner_id == TEAM_A
    assert store.series.official_winner_id == TEAM_A
    assert store.series.rating_mode == "forfeit_no_rating"  # durable policy mode
    # No events, no rating, and no win/loss counters.
    assert store.team(TEAM_A).current_elo == Decimal(1000)
    assert store.team(TEAM_A).series_wins == 0
    assert store.team(TEAM_B).series_losses == 0
    assert store.team(TEAM_A).matches_played == 0


async def test_finalize_forfeit_result_only_records_winner_and_counters() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    result = await svc.finalize(
        store.series.id,
        FinalizeRequest(rating_mode="forfeit_result_only", override_reason="team A forfeits the series"),
    )

    assert result.rating_mode == "forfeit_result_only"
    assert result.events == []
    assert store.events == []
    assert store.series.status == "finalized"
    assert store.series.official_winner_id == TEAM_A
    assert store.series.rating_mode == "forfeit_result_only"  # durable policy mode
    # Official winner + counters are recorded; no rating change, no events.
    assert store.team(TEAM_A).series_wins == 1
    assert store.team(TEAM_B).series_losses == 1
    assert store.team(TEAM_A).current_elo == Decimal(1000)
    assert store.team(TEAM_B).current_elo == Decimal(1000)
    assert store.team(TEAM_A).matches_played == 0


async def test_finalize_forfeit_modes_stay_distinguishable_for_audit() -> None:
    """fix round 1: the durable ``rating_mode`` on the series keeps
    ``forfeit_no_rating`` vs ``forfeit_result_only`` distinguishable for audit
    and rebuild even though neither writes rating events."""
    no_rating_store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    result_only_store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc_no, _s1 = _service(no_rating_store)
    svc_res, _s2 = _service(result_only_store)

    await svc_no.finalize(
        no_rating_store.series.id, FinalizeRequest(rating_mode="forfeit_no_rating", override_reason="no-show")
    )
    await svc_res.finalize(
        result_only_store.series.id,
        FinalizeRequest(rating_mode="forfeit_result_only", override_reason="forfeit"),
    )

    assert no_rating_store.series.rating_mode == "forfeit_no_rating"
    assert result_only_store.series.rating_mode == "forfeit_result_only"
    # The counter outcome differs (ADR-013/forfeit policy): no counters vs
    # winner+counters, both with no events and no ELO change.
    assert no_rating_store.team(TEAM_A).series_wins == 0
    assert result_only_store.team(TEAM_A).series_wins == 1
    assert no_rating_store.events == [] and result_only_store.events == []


# ------------------------------------------------------- audit logging (fix round 1)


async def test_finalize_success_log_emitted_only_after_commit(caplog) -> None:
    """The "series finalized" audit log is emitted exactly once, and only after
    the commit succeeded — never after a rollback."""
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, session = _service(store)

    with caplog.at_level(logging.INFO, logger="app.rating"):
        await svc.finalize(store.series.id, FinalizeRequest())

    assert session.committed == 1
    assert [record.message for record in caplog.records].count("series finalized") == 1


async def test_finalize_commit_failure_emits_no_success_log(caplog) -> None:
    """A failed COMMIT (e.g. the unique ``(run_id, series_id, team_id)`` guard
    firing) rolls everything back and must NOT emit the success audit log."""
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, session = _service(store, fail_commit=True)

    with (
        caplog.at_level(logging.INFO, logger="app.rating"),
        pytest.raises(RuntimeError, match="commit failure"),
    ):
        await svc.finalize(store.series.id, FinalizeRequest())

    assert session.rolled_back == 1
    assert session.committed == 0
    assert not any("series finalized" in record.message for record in caplog.records)
    assert store.events == []
    assert store.series.status == "draft"


# --------------------------------------------------------------- rejection gates


async def test_finalize_override_without_explicit_mode_raises_policy_required() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(
            store.series.id,
            FinalizeRequest(official_winner_id=TEAM_B, override_reason="ruling"),
        )

    assert excinfo.value.code == "RATING_POLICY_REQUIRED"
    assert excinfo.value.status == 409
    assert store.series.status == "draft"
    assert store.events == []
    assert store.team(TEAM_A).current_elo == Decimal(1000)


async def test_finalize_official_winner_must_be_a_team_of_the_series() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(
            store.series.id,
            FinalizeRequest(
                official_winner_id=uuid.uuid4(),
                override_reason="x",
                rating_mode="manual_override",
            ),
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert store.series.status == "draft"


async def test_finalize_rejects_series_without_played_at() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]), played_at=None)
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert store.series.status == "draft"
    assert store.events == []


async def test_finalize_rejects_invalid_bo_shape() -> None:
    """A resumable-but-unsettled draft (1 game in a BO3) fails the strict BO
    revalidation with 422 ``SERIES_INVALID`` and rates nothing."""
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A"]))
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert store.series.status == "draft"
    assert store.events == []
    assert store.team(TEAM_A).current_elo == Decimal(1000)


async def test_finalize_missing_series_raises_series_not_found() -> None:
    store = _scenario(format_="bo3", rounds=_winning_rounds(["A", "A"]))
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(uuid.uuid4(), FinalizeRequest())

    assert excinfo.value.code == "SERIES_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_finalize_strict_bo_revalidation_uses_current_canonical_winner() -> None:
    """Finalize derives every game's rounds/winner from the CURRENT canonical
    match scores (the preview contract) — never the stale copied rounds — so a
    canonical refresh that flips a map winner is reflected in the rating, and a
    stored winner that now disagrees with the derived winner blocks finalize."""
    store = _scenario(format_="bo1", rounds=_winning_rounds(["A"]))
    # The canonical match is refreshed: blue (team B) now won the map. The
    # stored winner column still says team A — a disagreement finalize rejects.
    match = next(iter(store._matches.values()))
    match.red_score, match.blue_score = 9, 13
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert store.series.status == "draft"
    assert store.events == []


# ------------------------------------------------------- D6 anchor verification


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


# ------------------------------------------------------- D7 actor/operation audit


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


# ------------------------------------------------------- D8 chronological guard


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


# ------------------------------------------------------- F1 future-date guard


async def test_future_dated_rated_finalize_is_rejected() -> None:
    """A future ``played_at`` is invalid data: rating a series that hasn't
    happened yet is rejected 422 SERIES_INVALID before any ELO. A future-dated
    RATED result would also brick the D8 chronological guard below (it counts
    in ``get_latest_finalized_rated_played_at``)."""
    store = _scenario(
        format_="bo1",
        rounds=_winning_rounds(["A"]),
        played_at=datetime.now(UTC) + timedelta(days=30),
    )
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest())

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert "future" in excinfo.value.message
    assert store.series.status == "draft"
    assert store.events == []
    assert store.team(TEAM_A).current_elo == Decimal(1000)


async def test_future_dated_unrated_finalize_is_rejected() -> None:
    """The future-date gate is mode-independent on the normal finalize path."""
    store = _scenario(
        format_="bo1",
        rounds=_winning_rounds(["A"]),
        played_at=datetime.now(UTC) + timedelta(days=30),
    )
    svc, _session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.finalize(store.series.id, FinalizeRequest(rating_mode="unrated"))  # type: ignore[arg-type]

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert store.series.status == "draft"
    assert store.events == []


async def test_played_at_within_future_tolerance_is_accepted() -> None:
    """A ``played_at`` within the clock-skew tolerance of now is not treated as
    future-dated."""
    store = _scenario(
        format_="bo1",
        rounds=_winning_rounds(["A"]),
        played_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    svc, _session = _service(store)

    result = await svc.finalize(store.series.id, FinalizeRequest())

    assert result.status == "finalized"
    assert len(result.events) == 2
