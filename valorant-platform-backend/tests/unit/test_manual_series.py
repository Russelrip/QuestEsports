"""Manual-result series flow unit tests (0016 migration).

In-memory repositories + fake session — no network, no DB. ``RatingService
.finalize_manual`` is driven through its exact repository surface (advisory
lock, external-key create-or-get, team lock, current run, event insert) so the
manual flow's business rules are testable without Postgres:

- rated manual series compute ELO: the winner gains, the loser loses, two
  immutable events land under the CURRENT run, and both teams' current/peak
  elo, counters, and ``matches_played`` (the recorded maps-won total) update;
- the recorded manual margin drives the performance multiplier and the
  matches_played increment (no games are attached);
- ``unrated`` records the result only: no events, no ELO, no counters;
- an idempotent retry on ``external_quest_series_id`` converges on the existing
  finalized series and never re-applies ELO;
- validation rejects the wrong winner (409), a score pair the format cannot
  reach (422), and a winner with fewer maps than the loser (422);
- a mid-transaction failure rolls everything back (nothing persisted).
"""

from __future__ import annotations

import copy
import types
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.api.errors import AppError
from app.api.service_token import ServicePrincipal
from app.domain.series.results import is_future_played_at, validate_manual_result
from app.schemas.series import ManualSeriesRequest
from app.services.rating_service import RatingService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)

TEAM_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TEAM_B = uuid.UUID("22222222-2222-2222-2222-222222222222")


def _constraint_error(constraint: str) -> IntegrityError:
    """An IntegrityError whose ``orig.diag.constraint_name`` names the DB
    constraint (the shape ``_is_external_series_key_violation`` inspects)."""
    orig = types.SimpleNamespace(diag=types.SimpleNamespace(constraint_name=constraint))
    return IntegrityError("statement", {}, orig)


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
    external_quest_series_id: str | None
    team_a_maps_won: int = 0
    team_b_maps_won: int = 0
    calculated_winner_id: uuid.UUID | None = None
    official_winner_id: uuid.UUID | None = None
    winner_override_reason: str | None = None
    rating_mode: str | None = None
    manual_winner_team_id: uuid.UUID | None = None
    manual_team_a_maps: int | None = None
    manual_team_b_maps: int | None = None
    finalized_at: datetime | None = None
    finalized_by_actor_id: str | None = None
    finalized_by_operation_id: str | None = None


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


class ManualStore:
    """Transactional in-memory state: writes land only on ``commit``."""

    def __init__(self, *, teams: list[MemTeam], run: MemRun | None = None) -> None:
        self.teams: dict[uuid.UUID, MemTeam] = {team.id: team for team in teams}
        self.series: list[MemSeries] = []
        self.by_external: dict[str, MemSeries] = {}
        self.events: list[MemEvent] = []
        self.run = run or MemRun(id=uuid.uuid4(), run_number=1, note="initial live run")
        self.fail_on_insert: int | None = None  # raise on the Nth event insert
        self._insert_calls = 0
        self._baseline: dict | None = None
        self.checkpoint()

    def checkpoint(self) -> None:
        self._baseline = copy.deepcopy(
            {
                "teams": self.teams,
                "series": self.series,
                "by_external": self.by_external,
                "events": self.events,
                "run": self.run,
            }
        )

    def restore(self) -> None:
        base = copy.deepcopy(self._baseline)
        self.teams = base["teams"]
        self.series = base["series"]
        self.by_external = base["by_external"]
        self.events = base["events"]
        self.run = base["run"]

    def team(self, team_id: uuid.UUID) -> MemTeam:
        return self.teams[team_id]

    def series_count(self) -> int:
        return len(self.series)


class InMemorySeriesRepository:
    """Mirrors the ``SeriesRepository`` methods ``RatingService.finalize_manual``
    calls."""

    def __init__(self, store: ManualStore) -> None:
        self._store = store
        # Simulates a concurrent create-or-get race: the losing request's
        # pre-lookup runs before the winner's insert commits, so it sees
        # nothing while the key already exists in the store. One-shot.
        self.miss_next_lookups = 0
        # Keys whose insert trips the ``series_external_quest_series_id_key``
        # unique constraint (the race winner already owns them).
        self.duplicate_keys: set[str] = set()

    async def get_by_external_quest_series_id(self, external_quest_series_id: str) -> MemSeries | None:
        if self.miss_next_lookups > 0:
            self.miss_next_lookups -= 1
            return None
        return self._store.by_external.get(external_quest_series_id)

    async def create_manual_series(
        self,
        *,
        team_a_id,
        team_b_id,
        format,
        importance,
        played_at,
        external_quest_series_id,
        manual_winner_team_id,
        manual_team_a_maps,
        manual_team_b_maps,
    ) -> MemSeries:
        if external_quest_series_id in self.duplicate_keys:
            raise _constraint_error("series_external_quest_series_id_key")
        series = MemSeries(
            id=uuid.uuid4(),
            team_a_id=team_a_id,
            team_b_id=team_b_id,
            format=format,
            importance=importance,
            status="draft",  # the service finalizes it in the same transaction
            played_at=played_at,
            external_quest_series_id=external_quest_series_id,
            manual_winner_team_id=manual_winner_team_id,
            manual_team_a_maps=manual_team_a_maps,
            manual_team_b_maps=manual_team_b_maps,
        )
        self._store.series.append(series)
        if external_quest_series_id is not None:
            self._store.by_external[external_quest_series_id] = series
        return series


class InMemoryRatingRepository:
    """Mirrors the ``RatingRepository`` methods ``RatingService.finalize_manual``
    calls."""

    def __init__(self, store: ManualStore) -> None:
        self._store = store

    async def acquire_rating_work_lock(self) -> None:
        """In-memory no-op: the advisory lock is a Postgres serialization
        primitive proven by the real-Postgres race tests."""

    async def get_teams_for_update_sorted(
        self, team_a_id: uuid.UUID, team_b_id: uuid.UUID
    ) -> tuple[MemTeam, MemTeam]:
        if team_a_id not in self._store.teams or team_b_id not in self._store.teams:
            raise AppError("TEAM_NOT_FOUND", 404, "team not found")
        return self._store.teams[team_a_id], self._store.teams[team_b_id]

    async def get_current_run(self) -> MemRun:
        return self._store.run

    async def reserve_event_sequence(self, run_id: uuid.UUID, series_id: uuid.UUID) -> int:
        used = [event.sequence for event in self._store.events if event.run_id == run_id]
        return max(used, default=0) + 1

    async def insert_rating_event(self, **values: object) -> MemEvent:
        self._store._insert_calls += 1
        if self._store.fail_on_insert is not None and self._store._insert_calls >= self._store.fail_on_insert:
            raise RuntimeError("simulated mid-transaction failure")
        event = MemEvent(id=uuid.uuid4(), created_at=START, **values)  # type: ignore[arg-type]
        self._store.events.append(event)
        return event

    async def get_events_for_series(self, series_id: uuid.UUID) -> list[MemEvent]:
        return [event for event in self._store.events if event.series_id == series_id]


class FakeSession:
    def __init__(self, store: ManualStore) -> None:
        self._store = store
        self.committed = 0
        self.rolled_back = 0

    async def flush(self) -> None:
        """In-memory writes are already applied; nothing to emit."""

    async def commit(self) -> None:
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


def _request(
    *,
    format_: str = "bo3",
    winner_team_id: uuid.UUID = TEAM_A,
    team_a_maps_won: int = 2,
    team_b_maps_won: int = 1,
    rating_mode: str = "normal",
    external_quest_series_id: str | None = "quest-series-1",
    team_a_id: uuid.UUID = TEAM_A,
    team_b_id: uuid.UUID = TEAM_B,
    played_at: datetime = START,
) -> ManualSeriesRequest:
    """A manual request keyed by default (F7): rated creates require the Quest
    external key, so only requests that explicitly pass ``None`` (or the
    unrated/forfeit paths) exercise the unkeyed shape."""
    return ManualSeriesRequest(
        team_a_id=team_a_id,
        team_b_id=team_b_id,
        format=format_,  # type: ignore[arg-type]
        played_at=played_at,
        rating_mode=rating_mode,  # type: ignore[arg-type]
        winner_team_id=winner_team_id,
        team_a_maps_won=team_a_maps_won,
        team_b_maps_won=team_b_maps_won,
        external_quest_series_id=external_quest_series_id,
    )


def _harness() -> tuple[ManualStore, RatingService, FakeSession]:
    store = ManualStore(teams=[_team(TEAM_A, elo=1000.0, matches=0), _team(TEAM_B, elo=1000.0, matches=0)])
    session = FakeSession(store)
    svc = RatingService(
        session=session,  # type: ignore[arg-type]
        series_repo=InMemorySeriesRepository(store),  # type: ignore[arg-type]
        rating_repo=InMemoryRatingRepository(store),  # type: ignore[arg-type]
    )
    return store, svc, session


def _event_by_team(events: list[MemEvent], team_id: uuid.UUID) -> MemEvent:
    return next(event for event in events if event.team_id == team_id)


# --------------------------------------------------------------- rated happy path


async def test_manual_rated_bo3_applies_elo_and_records_events() -> None:
    store, svc, session = _harness()

    result = await svc.finalize_manual(_request(format_="bo3", team_a_maps_won=2, team_b_maps_won=1))

    # Response contract: the normal FinalizeResult shape plus the manual fields.
    assert result.status == "finalized"
    assert result.rating_mode == "normal"
    assert result.calculated_winner_id == TEAM_A
    assert result.official_winner_id == TEAM_A
    assert result.winner_override_reason is None
    assert len(result.events) == 2
    assert result.manual_winner_team_id == TEAM_A
    assert result.manual_team_a_maps == 2
    assert result.manual_team_b_maps == 1
    # bo3 2-1 from equal 1000 ratings: winner +27 (22 base + 5 upset), loser -22.
    assert result.team_a_current_elo == Decimal(1027)
    assert result.team_b_current_elo == Decimal(978)

    # Series finalized exactly once, storing the derived + manual result.
    assert session.committed == 1
    series = store.series[0]
    assert series.status == "finalized"
    assert series.finalized_at is not None
    assert series.rating_mode == "normal"
    assert series.team_a_maps_won == 2
    assert series.team_b_maps_won == 1
    assert series.calculated_winner_id == TEAM_A
    assert series.official_winner_id == TEAM_A
    assert series.manual_winner_team_id == TEAM_A
    assert series.manual_team_a_maps == 2
    assert series.manual_team_b_maps == 1

    # Both teams updated: current + peak, matches_played += recorded maps, counters.
    team_a = store.team(TEAM_A)
    team_b = store.team(TEAM_B)
    assert team_a.current_elo == Decimal(1027)
    assert team_a.peak_elo == Decimal(1027)
    assert team_a.matches_played == 3  # the recorded maps-won total (2+1)
    assert team_a.series_wins == 1
    assert team_b.current_elo == Decimal(978)
    assert team_b.peak_elo == Decimal(1000)  # peak never drops
    assert team_b.matches_played == 3
    assert team_b.series_losses == 1

    # Two immutable events under the CURRENT run, one per team.
    assert len(store.events) == 2
    win = _event_by_team(store.events, TEAM_A)
    loss = _event_by_team(store.events, TEAM_B)
    assert win.run_id == store.run.id
    assert win.series_id == series.id
    assert win.result == "win" and win.opponent_team_id == TEAM_B
    assert win.elo_before == Decimal(1000)
    assert win.elo_after == Decimal(1027)
    assert win.elo_change == Decimal(27)
    assert win.upset_bonus == Decimal(5)
    assert loss.result == "loss" and loss.opponent_team_id == TEAM_A
    assert loss.elo_after == Decimal(978)
    assert loss.elo_change == Decimal(-22)

    # The recorded margin drives the inputs: bo3 series multiplier 1.1 with zero
    # aggregate rounds (no games attached).
    details = win.calculation_details
    assert details["mode"] == "normal"
    assert details["inputs"]["format"] == "bo3"
    assert details["inputs"]["winner_maps"] == 2
    assert details["inputs"]["loser_maps"] == 1
    assert details["inputs"]["winner_rounds"] == 0
    assert details["inputs"]["loser_rounds"] == 0
    assert details["inputs"]["performance_multiplier"] == 1.1


async def test_manual_rated_bo3_sweep_uses_series_multiplier() -> None:
    store, svc, _session = _harness()

    await svc.finalize_manual(_request(format_="bo3", team_a_maps_won=2, team_b_maps_won=0))

    # 2-0 sweep: series multiplier 1.4 -> winner 1000+28+5 = 1033, loser 972.
    assert store.team(TEAM_A).current_elo == Decimal(1033)
    assert store.team(TEAM_B).current_elo == Decimal(972)
    assert store.team(TEAM_A).matches_played == 2
    assert store.team(TEAM_B).matches_played == 2
    win = _event_by_team(store.events, TEAM_A)
    assert win.calculation_details["inputs"]["performance_multiplier"] == 1.4


async def test_manual_rated_bo1_uses_round_differential_multiplier() -> None:
    store, svc, _session = _harness()

    await svc.finalize_manual(_request(format_="bo1", team_a_maps_won=1, team_b_maps_won=0))

    # bo1 from equal 1000: multiplier 1.0 -> winner 1000+20+5 = 1025, loser 980.
    assert store.team(TEAM_A).current_elo == Decimal(1025)
    assert store.team(TEAM_B).current_elo == Decimal(980)
    assert store.team(TEAM_A).matches_played == 1
    win = _event_by_team(store.events, TEAM_A)
    # The details record the actual maps won; the legacy calculator receives
    # the documented bo1 sentinel (None) — round differential drives the 1.0.
    assert win.calculation_details["inputs"]["winner_maps"] == 1
    assert win.calculation_details["inputs"]["performance_multiplier"] == 1.0


async def test_manual_rated_bo5_records_five_maps_played() -> None:
    store, svc, _session = _harness()

    await svc.finalize_manual(_request(format_="bo5", team_a_maps_won=3, team_b_maps_won=2))

    assert store.team(TEAM_A).current_elo == Decimal(1027)
    assert store.team(TEAM_A).matches_played == 5  # 3+2
    assert store.team(TEAM_B).matches_played == 5


async def test_manual_rated_persists_actor_and_operation_audit() -> None:
    store, svc, _session = _harness()

    await svc.finalize_manual(_request(), principal=ServicePrincipal(actor_id="actor-1", operation_id="op-1"))

    assert store.series[0].finalized_by_actor_id == "actor-1"
    assert store.series[0].finalized_by_operation_id == "op-1"


# ------------------------------------------------------------------ unrated path


async def test_manual_unrated_records_result_only() -> None:
    store, svc, session = _harness()

    result = await svc.finalize_manual(_request(rating_mode="unrated"))

    assert result.status == "finalized"
    assert result.rating_mode == "unrated"
    assert result.events == []
    assert result.manual_winner_team_id == TEAM_A
    # No ELO and no counters.
    assert result.team_a_current_elo == Decimal(1000)
    assert result.team_b_current_elo == Decimal(1000)
    assert store.events == []
    assert store.team(TEAM_A).current_elo == Decimal(1000)
    assert store.team(TEAM_A).series_wins == 0
    assert store.team(TEAM_A).matches_played == 0
    assert store.team(TEAM_B).series_losses == 0
    series = store.series[0]
    assert series.status == "finalized"
    assert series.rating_mode == "unrated"
    assert series.official_winner_id == TEAM_A
    assert series.manual_winner_team_id == TEAM_A
    assert series.manual_team_a_maps == 2
    assert series.manual_team_b_maps == 1
    assert session.committed == 1


# ---------------------------------------------------------------- idempotency


async def test_manual_idempotent_retry_does_not_double_apply() -> None:
    store, svc, _session = _harness()
    req = _request(external_quest_series_id="quest-series-1")

    first = await svc.finalize_manual(req)
    second = await svc.finalize_manual(req)

    # Converges on the SAME series; nothing was re-created.
    assert store.series_count() == 1
    assert first.series_id == second.series_id
    assert store.series[0].external_quest_series_id == "quest-series-1"
    # No second rating: still exactly two events, one application.
    assert len(store.events) == 2
    assert store.team(TEAM_A).current_elo == Decimal(1027)
    assert store.team(TEAM_A).matches_played == 3
    assert store.team(TEAM_B).series_losses == 1
    # The retry response echoes the persisted result + current ratings.
    assert second.status == "finalized"
    assert second.rating_mode == "normal"
    assert second.manual_winner_team_id == TEAM_A
    assert len(second.events) == 2
    assert second.team_a_current_elo == Decimal(1027)


async def test_manual_rated_without_external_key_is_rejected() -> None:
    """F7: a RATED manual create without the Quest external key is rejected —
    an unkeyed rated create skips create-or-get idempotency and would re-apply
    ELO on every retry (the old behavior this test pinned as "intended")."""
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(_request(external_quest_series_id=None))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert "external_quest_series_id" in excinfo.value.message
    assert store.series_count() == 0
    assert store.events == []
    assert all(team.current_elo == Decimal(1000) for team in store.teams.values())


async def test_manual_unrated_without_external_key_is_allowed() -> None:
    """F7: only ``normal`` (rated) manual creates must carry the key — the
    unrated path still records a result without one."""
    store, svc, _session = _harness()

    result = await svc.finalize_manual(_request(rating_mode="unrated", external_quest_series_id=None))

    assert result.status == "finalized"
    assert result.rating_mode == "unrated"
    assert store.series_count() == 1
    assert store.events == []


async def test_manual_retry_on_non_finalized_key_raises_conflict() -> None:
    store, svc, _session = _harness()
    # A draft created through another path already owns the key (pre-existing
    # DB state, so it must be part of the store's committed baseline).
    draft = MemSeries(
        id=uuid.uuid4(), team_a_id=TEAM_A, team_b_id=TEAM_B, format="bo3", importance="regular",
        status="draft", played_at=START, external_quest_series_id="quest-series-9",
    )
    store.series.append(draft)
    store.by_external["quest-series-9"] = draft
    store.checkpoint()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(_request(external_quest_series_id="quest-series-9"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert store.series_count() == 1  # nothing created
    assert store.events == []


# ------------------------------------------------------- F4 payload-key convergence


async def test_manual_key_hit_with_matching_payload_converges() -> None:
    """F4: a retry whose payload matches the stored row field-by-field (built
    as a FRESH request, not the same object) still converges on the stored
    result — the field comparison must not reject identical payloads."""
    store, svc, _session = _harness()

    first = await svc.finalize_manual(_request(external_quest_series_id="quest-series-1"))
    second = await svc.finalize_manual(_request(external_quest_series_id="quest-series-1"))

    assert second.series_id == first.series_id
    assert store.series_count() == 1
    assert len(store.events) == 2  # applied exactly once
    assert store.team(TEAM_A).current_elo == Decimal(1027)


async def test_manual_key_hit_with_different_winner_is_rejected() -> None:
    """F4: a distinct payload under the same key must not silently merge into
    the stored result (double ELO)."""
    store, svc, _session = _harness()
    await svc.finalize_manual(_request(external_quest_series_id="quest-series-1"))

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(
            _request(
                external_quest_series_id="quest-series-1",
                winner_team_id=TEAM_B,
                team_a_maps_won=1,
                team_b_maps_won=2,
            )
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "different payload" in excinfo.value.message
    assert store.series_count() == 1  # nothing new created
    assert len(store.events) == 2  # ELO applied exactly once


async def test_manual_key_hit_with_different_maps_is_rejected() -> None:
    """F4: the maps-won pair is part of the compared payload."""
    store, svc, _session = _harness()
    await svc.finalize_manual(_request(external_quest_series_id="quest-series-1"))

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(
            _request(external_quest_series_id="quest-series-1", team_a_maps_won=2, team_b_maps_won=0)
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert store.series_count() == 1
    assert len(store.events) == 2


async def test_manual_key_hit_with_different_rating_mode_is_rejected() -> None:
    """F4: ``rating_mode`` is part of the compared payload — a keyed "normal"
    create cannot later be converged on by an "unrated" retry."""
    store, svc, _session = _harness()
    await svc.finalize_manual(_request(external_quest_series_id="quest-series-1"))

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(
            _request(external_quest_series_id="quest-series-1", rating_mode="unrated")
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert store.series_count() == 1
    assert len(store.events) == 2


# ------------------------------------------------------- F6 race reconciliation


async def test_manual_race_on_non_finalized_key_raises_conflict() -> None:
    """F6: when the create-or-get race loses and the conflicting row is NOT
    finalized, the raw IntegrityError must surface as 409 SERIES_INVALID (never
    a 500)."""
    store, svc, session = _harness()
    # A draft already owns the key (committed baseline, pre-existing DB state).
    draft = MemSeries(
        id=uuid.uuid4(), team_a_id=TEAM_A, team_b_id=TEAM_B, format="bo3", importance="regular",
        status="draft", played_at=START, external_quest_series_id="quest-series-race",
    )
    store.series.append(draft)
    store.by_external["quest-series-race"] = draft
    store.checkpoint()
    # The losing side of the race: the pre-lookup misses the winner's
    # not-yet-committed row, the insert trips the unique constraint, and the
    # reconciliation re-read finds the non-finalized row.
    repo = svc._series_repo
    repo.miss_next_lookups = 1
    repo.duplicate_keys.add("quest-series-race")

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(_request(external_quest_series_id="quest-series-race"))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "non-finalized" in excinfo.value.message
    assert session.committed == 0
    assert session.rolled_back >= 1  # the failed insert + the wrapper rollback
    assert store.series_count() == 1  # nothing new persisted
    assert store.events == []


# ------------------------------------------------------- F1 future-date guard


async def test_manual_rated_future_played_at_is_rejected() -> None:
    """F1: a future-dated rated manual series would brick the D8 chronological
    guard (manual series count in ``get_latest_finalized_rated_played_at``) for
    every later rated finalize — rejected before any ELO."""
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(_request(played_at=datetime.now(UTC) + timedelta(days=30)))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert "future" in excinfo.value.message
    assert store.series_count() == 0
    assert store.events == []
    assert all(team.current_elo == Decimal(1000) for team in store.teams.values())


async def test_manual_unrated_future_played_at_is_rejected() -> None:
    """F1: the future-date gate is mode-independent on the manual path — a
    result recorded for a series that hasn't happened is invalid data either
    way."""
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(
            _request(rating_mode="unrated", played_at=datetime.now(UTC) + timedelta(days=30))
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert store.series_count() == 0
    assert store.events == []


# ------------------------------------------------------- N1 naive played_at

N1_NAIVE_PAST = datetime(2026, 1, 2, 3, 4, 5)  # noqa: DTZ001  # naive on purpose: simulates a request without an offset


def test_is_future_played_at_normalizes_naive_datetimes() -> None:
    """N1: the helper normalizes a naive ``played_at`` to UTC before comparing,
    so ``naive > aware`` never raises ``TypeError``."""
    assert is_future_played_at(N1_NAIVE_PAST) is False  # naive past
    assert is_future_played_at(N1_NAIVE_PAST.replace(tzinfo=UTC)) is False  # aware past
    assert is_future_played_at(datetime.now(UTC) + timedelta(days=30)) is True  # aware future
    assert is_future_played_at(datetime.now() + timedelta(days=30)) is True  # noqa: DTZ005  # naive on purpose: future


async def test_manual_rated_naive_future_played_at_is_rejected() -> None:
    """N1: a NAIVE future ``played_at`` on the manual path surfaces as 422
    SERIES_INVALID — never a TypeError/500 from comparing naive vs aware."""
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(
            _request(played_at=datetime.now() + timedelta(days=30))  # noqa: DTZ005  # naive on purpose: a naive request payload
        )

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert store.series_count() == 0
    assert store.events == []
    assert all(team.current_elo == Decimal(1000) for team in store.teams.values())


async def test_manual_rated_naive_past_played_at_passes_the_future_check() -> None:
    """N1: a NAIVE past ``played_at`` is normalized (not TypeError'd) and the
    manual flow completes normally."""
    store, svc, _session = _harness()

    result = await svc.finalize_manual(_request(played_at=N1_NAIVE_PAST))

    assert result.status == "finalized"
    assert store.series_count() == 1
    assert len(store.events) == 2  # ELO applied as normal


# --------------------------------------------------------------- validation


async def test_manual_validation_rejects_winner_outside_the_series() -> None:
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(_request(winner_team_id=uuid.uuid4()))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert "winner" in excinfo.value.message
    assert store.series_count() == 0


async def test_manual_validation_rejects_same_team() -> None:
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(_request(team_a_id=TEAM_A, team_b_id=TEAM_A))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409
    assert store.series_count() == 0


async def test_manual_validation_rejects_unreachable_score_pair() -> None:
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        # bo1 can only finish 1-0; 2-0 is unreachable.
        await svc.finalize_manual(_request(format_="bo1", team_a_maps_won=2, team_b_maps_won=0))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert "not a valid bo1 result" in excinfo.value.message
    assert store.series_count() == 0
    assert store.events == []


async def test_manual_validation_rejects_winner_with_fewer_maps() -> None:
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        # The pair (1,2) is reachable for bo3 but says team B won — team A
        # cannot be the recorded winner with fewer maps.
        await svc.finalize_manual(_request(team_a_maps_won=1, team_b_maps_won=2))

    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
    assert "more maps than the loser" in excinfo.value.message
    assert store.series_count() == 0


async def test_manual_unknown_team_raises_team_not_found() -> None:
    store, svc, _session = _harness()

    with pytest.raises(AppError) as excinfo:
        await svc.finalize_manual(_request(team_b_id=uuid.uuid4()))

    assert excinfo.value.code == "TEAM_NOT_FOUND"
    assert excinfo.value.status == 404
    assert store.series_count() == 0
    assert store.events == []


async def test_manual_validation_failures_apply_nothing() -> None:
    """Every validation gate leaves the store untouched — no series, no ELO."""
    store, svc, _session = _harness()

    for request in (
        _request(winner_team_id=uuid.uuid4()),
        _request(team_a_id=TEAM_A, team_b_id=TEAM_A),
        _request(format_="bo1", team_a_maps_won=2, team_b_maps_won=0),
        _request(team_a_maps_won=1, team_b_maps_won=2),
    ):
        with pytest.raises(AppError):
            await svc.finalize_manual(request)

    assert store.series_count() == 0
    assert store.events == []
    assert all(team.current_elo == Decimal(1000) for team in store.teams.values())


# ------------------------------------------------------------------ rollback


async def test_manual_mid_transaction_failure_rolls_back_everything(caplog) -> None:
    import logging

    store, svc, session = _harness()
    store.fail_on_insert = 2  # winner event lands, loser insert raises

    with (
        caplog.at_level(logging.INFO, logger="app.rating"),
        pytest.raises(RuntimeError, match="mid-transaction"),
    ):
        await svc.finalize_manual(_request())

    assert session.rolled_back == 1
    assert session.committed == 0
    assert store.series_count() == 0  # the series row rolled back
    assert store.events == []
    assert all(team.current_elo == Decimal(1000) for team in store.teams.values())
    assert all(team.matches_played == 0 for team in store.teams.values())


# ----------------------------------------------------------- pure validator


def test_validate_manual_result_accepts_all_reachable_pairs() -> None:
    valid = {
        "bo1": [(1, 0), (0, 1)],
        "bo3": [(2, 0), (0, 2), (2, 1), (1, 2)],
        "bo5": [(3, 0), (0, 3), (3, 1), (1, 3), (3, 2), (2, 3)],
    }
    for format_, pairs in valid.items():
        for team_a_maps, team_b_maps in pairs:
            winner = TEAM_A if team_a_maps > team_b_maps else TEAM_B
            assert (
                validate_manual_result(
                    format_=format_, team_a_id=TEAM_A, team_b_id=TEAM_B, winner_team_id=winner,
                    team_a_maps_won=team_a_maps, team_b_maps_won=team_b_maps,
                )
                == []
            ), f"{format_} {team_a_maps}-{team_b_maps}"


def test_validate_manual_result_rejects_unreachable_and_inconsistent() -> None:
    assert validate_manual_result(
        format_="bo3", team_a_id=TEAM_A, team_b_id=TEAM_B, winner_team_id=TEAM_A,
        team_a_maps_won=3, team_b_maps_won=0,
    )
    assert validate_manual_result(
        format_="bo1", team_a_id=TEAM_A, team_b_id=TEAM_B, winner_team_id=TEAM_A,
        team_a_maps_won=0, team_b_maps_won=1,
    )
    assert validate_manual_result(
        format_="bo3", team_a_id=TEAM_A, team_b_id=TEAM_B, winner_team_id=TEAM_A,
        team_a_maps_won=1, team_b_maps_won=2,
    )
    assert validate_manual_result(
        format_="bo5", team_a_id=TEAM_A, team_b_id=TEAM_B, winner_team_id=uuid.uuid4(),
        team_a_maps_won=3, team_b_maps_won=2,
    )
    assert validate_manual_result(
        format_="bo7", team_a_id=TEAM_A, team_b_id=TEAM_B, winner_team_id=TEAM_A,
        team_a_maps_won=1, team_b_maps_won=0,
    )
