"""Deterministic versioned rankings rebuild unit tests (plan Task 16; design §13.4).

In-memory repositories + fake session — no network, no DB. The rebuild is driven
through its exact repository surface (all-series lock, new-run creation, team
reset/list, eligible-series selection, canonical-games read, event insert) so the
replay rules are testable without Postgres:

- two finalized series ordered by ``played_at`` replay deterministically into the
  NEW run; old runs' events remain byte-for-byte unchanged (immutable audit);
- every team is reset to the initial ELO with zeroed counters before the replay,
  so earlier pre-rebuild ratings never leak into the new run;
- ``played_at`` ordering is respected: the later series sees the rating the
  earlier series produced (later series applies later);
- equal ``played_at`` tie-breaks by ``(created_at, id)`` — deterministic;
- a ``forfeit_no_rating`` series produces no events and no counters but still
  appears in the replayed run (its order is preserved);
- a ``forfeit_result_only`` series records the official winner + counters on
  replay with no rating change;
- a finalized series whose ``played_at`` is null rejects the rebuild (422
  ``SERIES_INVALID``) — it cannot be ordered deterministically;
- the resolved ``rating_mode``/official winner are reconstructed from the
  persisted series columns (never re-resolved), so ``manual_override`` replays
  on the OFFICIAL winner exactly as the original finalize did;
- fix round 2: every replay event carries a stable per-run ``sequence`` — both
  team events of a series share one value, values follow replay order (the
  earlier-played series holds the lower sequence), and a forfeit series
  consumes no sequence.
"""

from __future__ import annotations

import copy
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.api.errors import AppError
from app.domain.series.bo import CanonicalGameSnapshot
from app.legacy.elo_calculator import EloCalculator
from app.services.ranking_rebuild_service import RankingRebuildService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)

TEAM_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TEAM_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
TEAM_C = uuid.UUID("33333333-3333-3333-3333-333333333333")

RUN_1 = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
RUN_2 = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")


# ------------------------------------------------------------------ in-memory model


@dataclass
class MemTeam:
    id: uuid.UUID
    name: str
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
    created_at: datetime
    official_winner_id: uuid.UUID | None = None
    winner_override_reason: str | None = None
    rating_mode: str | None = None
    manual_winner_team_id: uuid.UUID | None = None
    manual_team_a_maps: int | None = None
    manual_team_b_maps: int | None = None


@dataclass
class MemGame:
    series_id: uuid.UUID
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
    elo_before: Decimal
    elo_after: Decimal
    elo_change: Decimal
    opponent_team_id: uuid.UUID
    result: str
    sequence: int = 1
    k_factor: Decimal | None = None
    expected_score: Decimal | None = None
    performance_multiplier: Decimal | None = None
    importance_multiplier: Decimal | None = None
    upset_bonus: Decimal | None = None
    calculation_details: dict = field(default_factory=dict)
    created_at: datetime = START


class Store:
    """In-memory database state (no transaction semantics needed by rebuild).

    The fake session snapshots the state at commit and restores it on rollback,
    mirroring the real Postgres transaction the service relies on.
    """

    def __init__(
        self,
        *,
        series: list[MemSeries],
        teams: list[MemTeam],
        games: list[MemGame],
        matches: dict[uuid.UUID, MemMatch],
        runs: list[MemRun],
        events: list[MemEvent],
    ) -> None:
        self.series = series
        self.teams: dict[uuid.UUID, MemTeam] = {team.id: team for team in teams}
        self.games = games
        self.matches = matches
        self.runs = list(runs)
        self.events = list(events)
        self._baseline: dict | None = None
        self.checkpoint()

    def checkpoint(self) -> None:
        self._baseline = copy.deepcopy(
            {
                "series": self.series,
                "teams": self.teams,
                "games": self.games,
                "matches": self.matches,
                "runs": self.runs,
                "events": self.events,
            }
        )

    def restore(self) -> None:
        base = copy.deepcopy(self._baseline)
        self.series = base["series"]
        self.teams = base["teams"]
        self.games = base["games"]
        self.matches = base["matches"]
        self.runs = base["runs"]
        self.events = base["events"]

    def team(self, team_id: uuid.UUID) -> MemTeam:
        return self.teams[team_id]


class InMemorySeriesRepository:
    """Mirrors the ``SeriesRepository`` methods ``RankingRebuildService`` calls."""

    def __init__(self, store: Store) -> None:
        self._store = store
        self.locked: list[uuid.UUID] = []

    async def lock_all_series_for_update(self) -> list[MemSeries]:
        ordered = sorted(self._store.series, key=lambda series: series.id)
        self.locked = [series.id for series in ordered]
        return ordered

    async def get_finalized_series_for_rebuild(self) -> list[MemSeries]:
        eligible = [s for s in self._store.series if s.status == "finalized" and s.played_at is not None]
        return sorted(eligible, key=lambda s: (s.played_at, s.created_at, s.id))

    async def get_series_with_canonical_games(
        self, series_id: uuid.UUID
    ) -> tuple[MemSeries | None, list[CanonicalGameSnapshot]]:
        series = next((s for s in self._store.series if s.id == series_id), None)
        if series is None:
            return None, []
        snapshots: list[CanonicalGameSnapshot] = []
        for game in sorted(
            (g for g in self._store.games if g.series_id == series_id), key=lambda g: g.game_number
        ):
            match = self._store.matches.get(game.match_id)
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


class InMemoryRatingRepository:
    """Mirrors the ``RatingRepository`` methods ``RankingRebuildService`` calls."""

    def __init__(self, store: Store) -> None:
        self._store = store

    async def create_run(self, *, note: str | None = None) -> MemRun:
        run = MemRun(
            id=uuid.uuid4(),
            run_number=max(run.run_number for run in self._store.runs) + 1,
            note=note,
        )
        self._store.runs.append(run)
        return run

    async def acquire_rating_work_lock(self) -> None:
        """In-memory no-op: the advisory lock is a Postgres serialization
        primitive proven by the real-Postgres race tests."""

    async def reserve_event_sequence(self, run_id: uuid.UUID, series_id: uuid.UUID) -> int:
        """Mirror the real max+1 per-run reservation (the rebuild replays in
        deterministic order, so reservations follow replay order)."""
        used = [event.sequence for event in self._store.events if event.run_id == run_id]
        return max(used, default=0) + 1

    async def list_all_teams(self) -> list[MemTeam]:
        return list(self._store.teams.values())

    async def insert_rating_event(self, **values: object) -> MemEvent:
        event = MemEvent(id=uuid.uuid4(), created_at=START, **values)  # type: ignore[arg-type]
        self._store.events.append(event)
        return event


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


def _team(team_id: uuid.UUID, name: str, *, elo: float, matches: int) -> MemTeam:
    return MemTeam(
        id=team_id,
        name=name,
        current_elo=Decimal(str(elo)),
        peak_elo=Decimal(str(elo)),
        matches_played=matches,
        series_wins=0,
        series_losses=0,
    )


def _game(series: MemSeries, number: int, *, winner: uuid.UUID, team_a_side: str = "red") -> tuple[MemGame, MemMatch]:
    """A completed 13-9 map won by ``winner`` through the side mapping."""
    team_a_rounds, team_b_rounds = (13, 9) if winner == series.team_a_id else (9, 13)
    if team_a_side == "red":
        red_score, blue_score = team_a_rounds, team_b_rounds
    else:
        red_score, blue_score = team_b_rounds, team_a_rounds
    match = MemMatch(id=uuid.uuid4(), map_name="Ascent", red_score=red_score, blue_score=blue_score, is_completed=True)
    game = MemGame(
        series_id=series.id,
        game_number=number,
        match_id=match.id,
        team_a_side=team_a_side,
        team_b_side="blue" if team_a_side == "red" else "red",
        stored_winner_team_id=winner,
    )
    return game, match


def _finalized_series(
    *,
    team_a: uuid.UUID,
    team_b: uuid.UUID,
    played_at: datetime | None,
    official_winner: uuid.UUID,
    created_at: datetime | None = None,
    rating_mode: str | None = "normal",
    override_reason: str | None = None,
    format_: str = "bo1",
    id_: uuid.UUID | None = None,
) -> MemSeries:
    return MemSeries(
        id=id_ or uuid.uuid4(),
        team_a_id=team_a,
        team_b_id=team_b,
        format=format_,
        importance="regular",
        status="finalized",
        played_at=played_at,
        created_at=created_at or START,
        official_winner_id=official_winner,
        winner_override_reason=override_reason,
        rating_mode=rating_mode,
    )


def _attach(series: MemSeries, store: Store, *, winners: list[uuid.UUID]) -> None:
    for number, winner in enumerate(winners, start=1):
        game, match = _game(series, number, winner=winner)
        store.games.append(game)
        store.matches[match.id] = match


def _scenario(**kwargs) -> Store:
    """Teams A/B/C plus two finalized BO1 series (A beats B then B beats C).

    ``S1`` (A vs B) is played earlier and ``S2`` (B vs C) later, so a correct
    chronological replay rates S2 against B's post-S1 rating. The teams start in
    a deliberately "dirty" pre-rebuild state (wrong ratings/counters) to prove
    the reset happens before replay.
    """
    teams = [
        _team(TEAM_A, "Alpha", elo=1500.0, matches=9),
        _team(TEAM_B, "Beta", elo=1400.0, matches=9),
        _team(TEAM_C, "Gamma", elo=1300.0, matches=9),
    ]
    s1 = _finalized_series(
        team_a=TEAM_A, team_b=TEAM_B, played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
        official_winner=TEAM_A, rating_mode=kwargs.get("s1_mode"),
    )
    s2 = _finalized_series(
        team_a=TEAM_B, team_b=TEAM_C, played_at=datetime(2026, 1, 12, 12, 0, tzinfo=UTC),
        official_winner=TEAM_B, rating_mode=kwargs.get("s2_mode"),
    )
    store = Store(
        series=[s1, s2],
        teams=teams,
        games=[],
        matches={},
        runs=[
            MemRun(id=RUN_1, run_number=1, note="initial live run"),
            MemRun(id=RUN_2, run_number=2, note="prior rebuild"),
        ],
        events=[
            MemEvent(
                id=uuid.uuid4(), run_id=RUN_1, series_id=uuid.uuid4(), team_id=TEAM_A,
                elo_before=Decimal(1000), elo_after=Decimal(1027), elo_change=Decimal(27),
                opponent_team_id=TEAM_B, result="win",
            ),
            MemEvent(
                id=uuid.uuid4(), run_id=RUN_1, series_id=uuid.uuid4(), team_id=TEAM_B,
                elo_before=Decimal(1000), elo_after=Decimal(978), elo_change=Decimal(-22),
                opponent_team_id=TEAM_A, result="loss",
            ),
        ],
    )
    _attach(s1, store, winners=[TEAM_A])
    _attach(s2, store, winners=[TEAM_B])
    return store


def _service(store: Store, *, fail_commit: bool = False):
    session = FakeSession(store)
    session.fail_commit = fail_commit
    svc = RankingRebuildService(
        session=session,  # type: ignore[arg-type]
        rating_repo=InMemoryRatingRepository(store),  # type: ignore[arg-type]
        series_repo=InMemorySeriesRepository(store),  # type: ignore[arg-type]
    )
    return svc, session


def _events_in_run(store: Store, run_id: uuid.UUID) -> list[MemEvent]:
    return [event for event in store.events if event.run_id == run_id]


def _event(events: list[MemEvent], team_id: uuid.UUID) -> MemEvent:
    return next(event for event in events if event.team_id == team_id)


def _event_in_series(events: list[MemEvent], team_id: uuid.UUID, opponent_id: uuid.UUID) -> MemEvent:
    """The team's event against a specific opponent (a team plays once per
    opponent in these scenarios, so this uniquely selects the series' event)."""
    return next(event for event in events if event.team_id == team_id and event.opponent_team_id == opponent_id)


# ------------------------------------------------- deterministic chronological replay


async def test_rebuild_replays_finalized_series_in_played_at_order() -> None:
    store = _scenario()
    svc, session = _service(store)

    result = await svc.rebuild(note="post-bugfix rebuild")

    # A new run supersedes the prior ones; run_number = max + 1.
    assert session.committed == 1
    assert len(store.runs) == 3
    assert store.runs[-1].note == "post-bugfix rebuild"
    assert result.run_id == store.runs[-1].id
    assert result.run_number == 3
    assert result.note == "post-bugfix rebuild"
    assert result.series_count == 2
    assert result.event_count == 4  # two rated series x two events
    assert result.teams_reset == 3

    # Teams were RESET to 1000 (from the dirty 1500/1400/1300) before replay.
    team_a = store.team(TEAM_A)
    team_b = store.team(TEAM_B)
    team_c = store.team(TEAM_C)
    expected_a = round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[0], 0)
    b_after_s1 = round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[1], 0)
    expected_b, expected_c = EloCalculator.calculate_new_elo(
        b_after_s1, 1000.0, 1, 0, 13, 9, "regular", "bo1"
    )
    assert team_a.current_elo == Decimal(str(expected_a))
    assert team_a.matches_played == 1
    assert team_a.series_wins == 1
    assert team_a.peak_elo == Decimal(str(expected_a))
    assert team_b.current_elo == Decimal(str(round(expected_b, 0)))
    assert team_b.matches_played == 2
    assert team_b.series_wins == 1
    assert team_b.series_losses == 1
    assert team_c.current_elo == Decimal(str(round(expected_c, 0)))
    assert team_c.matches_played == 1
    assert team_c.series_losses == 1
    assert team_c.peak_elo == Decimal(1000)  # peak never exceeds the reset floor after a loss

    # All four replay events live under the NEW run.
    new_events = _events_in_run(store, result.run_id)
    assert len(new_events) == 4
    b_s2 = _event_in_series(new_events, TEAM_B, TEAM_C)
    # ORDERING: B's second-series event starts from its post-S1 rating (978),
    # proving the later series applied later — never the reset 1000.
    assert b_s2.elo_before == Decimal(str(b_after_s1))

    # Per-run sequences follow replay order (fix round 2): S1's two team
    # events share sequence 1, S2's two share sequence 2.
    series_by_sequence = {event.sequence: event.series_id for event in new_events}
    assert sorted(series_by_sequence) == [1, 2]
    s1_events = [e for e in new_events if e.sequence == 1]
    s2_events = [e for e in new_events if e.sequence == 2]
    assert len(s1_events) == 2 and len(s2_events) == 2  # exactly two per series
    assert {e.series_id for e in s1_events} != {e.series_id for e in s2_events}
    # S1 (played earlier) holds the lower sequence.
    s1_id = s1_events[0].series_id
    s1_row = next(s for s in store.series if s.id == s1_id)
    s2_id = s2_events[0].series_id
    s2_row = next(s for s in store.series if s.id == s2_id)
    assert s1_row.played_at is not None and s2_row.played_at is not None
    assert s1_row.played_at < s2_row.played_at

    # Prior runs' events are untouched (immutable audit) — byte-for-byte intact.
    assert len(_events_in_run(store, RUN_1)) == 2
    assert len(_events_in_run(store, RUN_2)) == 0
    old = [e for e in store.events if e.run_id == RUN_1]
    assert all(e.elo_after == Decimal(1027) or e.elo_after == Decimal(978) for e in old)


async def test_rebuild_tie_breaks_same_played_at_by_created_at_then_id() -> None:
    """Two series with the SAME ``played_at`` replay in stable
    ``(created_at, id)`` order — the later-created series sees the earlier one's
    rating, so the replay is deterministic across invocations."""
    teams = [
        _team(TEAM_A, "Alpha", elo=1500.0, matches=9),
        _team(TEAM_B, "Beta", elo=1400.0, matches=9),
        _team(TEAM_C, "Gamma", elo=1300.0, matches=9),
    ]
    same_played_at = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
    s1 = _finalized_series(
        team_a=TEAM_A, team_b=TEAM_B, played_at=same_played_at, official_winner=TEAM_A,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    s2 = _finalized_series(
        team_a=TEAM_B, team_b=TEAM_C, played_at=same_played_at, official_winner=TEAM_B,
        created_at=datetime(2026, 1, 2, tzinfo=UTC),
    )
    store = Store(
        series=[s1, s2], teams=teams, games=[], matches={},
        runs=[MemRun(id=RUN_1, run_number=1, note="initial live run")], events=[],
    )
    _attach(s1, store, winners=[TEAM_A])
    _attach(s2, store, winners=[TEAM_B])
    svc, _session = _service(store)

    first = await svc.rebuild(note="first")
    svc2 = _service(store)[0]
    await svc2.rebuild(note="second")

    # The replay was deterministic: the second rebuild reproduced the same
    # final ratings/counters as the first (standings identical).
    team_a = store.team(TEAM_A)
    team_b = store.team(TEAM_B)
    team_c = store.team(TEAM_C)
    b_after_s1 = round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[1], 0)
    expected_a = round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[0], 0)
    expected_b, expected_c = EloCalculator.calculate_new_elo(b_after_s1, 1000.0, 1, 0, 13, 9, "regular", "bo1")
    assert team_a.current_elo == Decimal(str(expected_a))
    assert team_b.current_elo == Decimal(str(round(expected_b, 0)))
    assert team_c.current_elo == Decimal(str(round(expected_c, 0)))
    # S1 (A beats B) was replayed before S2: B's S2 event starts from 978.
    new_events = _events_in_run(store, store.runs[-1].id)
    assert _event_in_series(new_events, TEAM_B, TEAM_C).elo_before == Decimal(str(b_after_s1))
    # The first invocation's events are still preserved (three runs now).
    assert first.run_number == 2 and store.runs[-1].run_number == 3


# ---------------------------------------------------------------- forfeit modes


async def test_rebuild_forfeit_no_rating_produces_no_events_or_counters() -> None:
    store = _scenario()
    forfeit = _finalized_series(
        team_a=TEAM_A, team_b=TEAM_C,
        played_at=datetime(2026, 1, 14, 12, 0, tzinfo=UTC),
        official_winner=TEAM_A, rating_mode="forfeit_no_rating",
    )
    store.series.append(forfeit)
    svc, _session = _service(store)

    result = await svc.rebuild()

    # The forfeit series is part of the replayed run (order preserved) but
    # produced no events and no win/loss counters for either team.
    assert result.series_count == 3
    assert result.event_count == 4  # only the two rated series wrote events
    new_events = _events_in_run(store, result.run_id)
    assert len(new_events) == 4
    team_a = store.team(TEAM_A)
    team_c = store.team(TEAM_C)
    # A won S1 only; the forfeit did not add a series win for A or a loss for C.
    assert team_a.series_wins == 1
    assert team_c.series_wins == 0
    assert team_c.series_losses == 1  # only S2 (B beat C)
    assert team_c.matches_played == 1
    # The forfeit's order is preserved: it is the LAST eligible series.
    eligible = await InMemorySeriesRepository(store).get_finalized_series_for_rebuild()
    assert eligible[-1].id == forfeit.id

    # The forfeit consumes no sequence (fix round 2): the two rated series
    # still hold the contiguous sequences 1 and 2 — no gap where the forfeit
    # would have been rated.
    sequences = sorted({event.sequence for event in new_events})
    assert sequences == [1, 2]
    assert len({(e.series_id, e.sequence) for e in new_events}) == 2  # one sequence per series


async def test_rebuild_forfeit_result_only_records_winner_and_counters() -> None:
    store = _scenario()
    forfeit = _finalized_series(
        team_a=TEAM_A, team_b=TEAM_C,
        played_at=datetime(2026, 1, 14, 12, 0, tzinfo=UTC),
        official_winner=TEAM_A, rating_mode="forfeit_result_only",
    )
    store.series.append(forfeit)
    svc, _session = _service(store)

    result = await svc.rebuild()

    assert result.series_count == 3
    assert result.event_count == 4  # no rating events for the forfeit
    team_a = store.team(TEAM_A)
    team_c = store.team(TEAM_C)
    # The official winner's counter IS recorded; no rating change, no events.
    assert team_a.series_wins == 2  # S1 win + forfeit win
    assert team_c.series_losses == 2  # S2 loss + forfeit loss
    assert team_c.current_elo == Decimal(str(round(
        EloCalculator.calculate_new_elo(
            round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[1], 0),
            1000.0, 1, 0, 13, 9, "regular", "bo1",
        )[1], 0
    )))
    assert len(_events_in_run(store, result.run_id)) == 4


# ------------------------------------------------------------ override replay


async def test_rebuild_replays_manual_override_on_official_winner() -> None:
    """The persisted ``rating_mode``/official winner are reconstructed from the
    series columns — the replay never re-resolves the policy — so a
    ``manual_override`` series rates the OFFICIAL winner exactly like the
    original finalize did."""
    teams = [
        _team(TEAM_A, "Alpha", elo=1500.0, matches=9),
        _team(TEAM_B, "Beta", elo=1400.0, matches=9),
        _team(TEAM_C, "Gamma", elo=1300.0, matches=9),
    ]
    series = _finalized_series(
        team_a=TEAM_A, team_b=TEAM_B,
        played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
        official_winner=TEAM_B, rating_mode="manual_override", override_reason="eligibility ruling",
        format_="bo1",
    )
    store = Store(
        series=[series], teams=teams, games=[], matches={},
        runs=[MemRun(id=RUN_1, run_number=1, note="initial live run")], events=[],
    )
    _attach(store.series[0], store, winners=[TEAM_A])  # the maps say team A won
    svc, _session = _service(store)

    result = await svc.rebuild()

    assert result.series_count == 1
    assert result.event_count == 2
    team_a = store.team(TEAM_A)
    team_b = store.team(TEAM_B)
    # OFFICIAL winner (B) gained rating; the map winner (A) lost it.
    expected_b, expected_a = EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 9, 13, "regular", "bo1")
    assert team_b.current_elo == Decimal(str(round(expected_b, 0)))
    assert team_a.current_elo == Decimal(str(round(expected_a, 0)))
    assert team_b.series_wins == 1
    assert team_a.series_losses == 1
    new_events = _events_in_run(store, result.run_id)
    assert _event(new_events, TEAM_B).result == "win"
    assert _event(new_events, TEAM_A).result == "loss"


# ------------------------------------------------------- manual-result replay


async def test_rebuild_replays_manual_result_series_with_recorded_margin() -> None:
    """A MANUAL series (0016) has no attached games — the replay builds the
    result from the persisted manual fields (winner + maps-won), so it applies
    the EXACT same rating the manual finalize did, including the per-team
    matches_played increment from the recorded maps-won total."""
    teams = [
        _team(TEAM_A, "Alpha", elo=1500.0, matches=9),
        _team(TEAM_B, "Beta", elo=1400.0, matches=9),
    ]
    series = MemSeries(
        id=uuid.uuid4(),
        team_a_id=TEAM_A,
        team_b_id=TEAM_B,
        format="bo3",
        importance="regular",
        status="finalized",
        played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
        created_at=START,
        official_winner_id=TEAM_A,
        rating_mode="normal",
        manual_winner_team_id=TEAM_A,
        manual_team_a_maps=2,
        manual_team_b_maps=1,
    )
    store = Store(
        series=[series], teams=teams, games=[], matches={},
        runs=[MemRun(id=RUN_1, run_number=1, note="initial live run")], events=[],
    )
    svc, _session = _service(store)

    result = await svc.rebuild()

    assert result.series_count == 1
    assert result.event_count == 2
    team_a = store.team(TEAM_A)
    team_b = store.team(TEAM_B)
    # The manual result's recorded margin drives the rating: bo3 2-1 from
    # equal 1000 ratings -> winner +27 (22 base + 5 upset), loser -22.
    assert team_a.current_elo == Decimal(1027)
    assert team_b.current_elo == Decimal(978)
    # matches_played increments by the recorded maps-won total (3), never 0.
    assert team_a.matches_played == 3
    assert team_b.matches_played == 3
    assert team_a.series_wins == 1
    assert team_b.series_losses == 1
    new_events = _events_in_run(store, result.run_id)
    win = _event(new_events, TEAM_A)
    assert win.result == "win"
    assert win.calculation_details["inputs"]["winner_maps"] == 2
    assert win.calculation_details["inputs"]["loser_maps"] == 1
    # No attached games: the aggregate round inputs are zero.
    assert win.calculation_details["inputs"]["winner_rounds"] == 0
    assert win.calculation_details["inputs"]["loser_rounds"] == 0


# ------------------------------------------------------------- rejection gates


async def test_rebuild_rejects_finalized_series_without_played_at() -> None:
    store = _scenario()
    store.series.append(
        _finalized_series(
            team_a=TEAM_A, team_b=TEAM_C, played_at=None, official_winner=TEAM_A,
        )
    )
    before = copy.deepcopy(store.events)
    svc, session = _service(store)

    with pytest.raises(AppError) as excinfo:
        await svc.rebuild()

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    # All-or-nothing: nothing was persisted (no new run, no reset, no events).
    assert session.rolled_back == 1
    assert len(store.runs) == 2
    assert store.events == before
    assert store.team(TEAM_A).current_elo == Decimal(1500)  # reset never applied


async def test_rebuild_commit_failure_rolls_back_everything(caplog) -> None:
    store = _scenario()
    svc, session = _service(store, fail_commit=True)

    with (
        caplog.at_level(logging.INFO, logger="app.ranking"),
        pytest.raises(RuntimeError, match="commit failure"),
    ):
        await svc.rebuild()

    assert session.rolled_back == 1
    assert session.committed == 0
    assert not any("rankings rebuilt" in record.message for record in caplog.records)
    assert len(store.runs) == 2  # new run rolled back
    assert store.team(TEAM_A).current_elo == Decimal(1500)  # reset rolled back
    assert len(_events_in_run(store, store.runs[-1].id)) == 0  # replay rolled back
