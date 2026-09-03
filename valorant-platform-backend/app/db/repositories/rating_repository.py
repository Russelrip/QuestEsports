"""``rating_runs`` / ``rating_events`` / locked-team data access (plan Task 15).

``RatingRepository`` is the only code that issues ``rating_runs`` /
``rating_events`` SQL, plus the team row locks finalization needs (it owns the
deterministic sorted lock order, so concurrent finalizations of different
series sharing a team serialize instead of deadlocking). Writes are never
committed here — ``RatingService`` owns the transaction boundaries.

``get_current_run`` returns the row with the max ``run_number`` (the migration
``0007`` seeds the initial live run, so normal finalization always has a run to
write under). Events are immutable by design: this repository only ever inserts.

Rating-work serialization (Task 16 fix round 1): ``acquire_rating_work_lock``
takes the single shared PostgreSQL advisory xact lock (``RATING_WORK_LOCK_KEY``)
that BOTH finalization and the rankings rebuild acquire as the FIRST statement
of their transaction. ``pg_advisory_xact_lock`` blocks until the key is free
and is held until the transaction ends (commit/rollback), so a rebuild can
never race a concurrent — even newly inserted — series finalization: whichever
acquired the lock first runs to completion before the other begins.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.models import RatingEvent, RatingEventSequence, RatingRun, Team

# The stable key of the advisory lock that serializes ALL rating work. Fixed so
# every connection uses the same lock; documented so operators can debug with
# ``pg_locks``/``pg_stat_activity``. Any constant is fine — it just must never
# change once deployed (a changed key would silently split the lock).
RATING_WORK_LOCK_KEY = 4_266_611_572_813


class RatingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------- runs

    async def get_current_run(self) -> RatingRun | None:
        """The current (max ``run_number``) rating run, or ``None`` if the
        ``0007`` seed row is missing (a deployment/setup error)."""
        result = await self._session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))
        return result.scalar_one_or_none()

    async def acquire_rating_work_lock(self) -> None:
        """Acquire the shared advisory xact lock that serializes ALL rating work.

        BOTH ``RatingService.finalize`` and ``RankingRebuildService.rebuild``
        call this as their FIRST statement inside the transaction (Task 16 fix
        round 1). It blocks until the key is free and is released when the
        current transaction ends, so:

        - a rebuild cannot race a finalize of an already-finalized series;
        - a rebuild cannot race a NEWLY INSERTED series being finalized (the
          insert itself is lock-free, but the finalize waits for the rebuild);
        - a finalize cannot race a rebuild's reset/replay (no lost/excluded
          ratings).

        No row locks are taken here, so the existing series/team ``FOR UPDATE``
        order (sorted-UUID team locks) is fully preserved.
        """
        await self._session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": RATING_WORK_LOCK_KEY})

    async def create_run(self, *, note: str | None = None) -> RatingRun:
        """Persist a new rating run with the documented sequential ``max+1``
        allocation (plan Task 16).

        ``run_number`` is computed inside the transaction as ``max(run_number)
        + 1`` and inserted with ``OVERRIDING SYSTEM VALUE`` — NOT drawn from
        the ``GENERATED ALWAYS AS IDENTITY`` sequence, whose values advance even
        when the transaction rolls back (a rolled-back rebuild would otherwise
        leave a permanent gap, violating the sequential contract). This is
        transaction-safe because the caller always holds the
        ``RATING_WORK_LOCK_KEY`` advisory lock, so no other run insert can
        interleave. The new row becomes the current run when the transaction
        commits; prior runs' events stay untouched (ADR-007).
        """
        max_number = await self._session.scalar(select(func.max(RatingRun.run_number)))
        next_number = (max_number or 0) + 1
        result = await self._session.execute(
            text(
                "INSERT INTO rating_runs (run_number, note) OVERRIDING SYSTEM VALUE "
                "VALUES (:run_number, :note) RETURNING id, run_number, created_at"
            ),
            {"run_number": next_number, "note": note},
        )
        row = result.one()
        return RatingRun(id=row.id, run_number=row.run_number, note=note, created_at=row.created_at)

    # ------------------------------------------------------------- teams

    async def get_teams_for_update_sorted(
        self, team_a_id: uuid.UUID, team_b_id: uuid.UUID
    ) -> tuple[Team, Team]:
        """Lock both teams ``FOR UPDATE`` in deterministic sorted UUID order.

        The smaller id is always locked first, one statement at a time, so two
        finalizations that touch overlapping teams acquire the locks in the
        same order — serializing on the first shared team instead of
        deadlocking. Returns ``(team_a, team_b)`` in the caller's order.
        """
        ordered = sorted((team_a_id, team_b_id))
        by_id: dict[uuid.UUID, Team] = {}
        for team_id in ordered:
            result = await self._session.execute(select(Team).where(Team.id == team_id).with_for_update())
            team = result.scalar_one_or_none()
            if team is None:
                raise AppError("TEAM_NOT_FOUND", 404, "team not found")
            by_id[team.id] = team
        return by_id[team_a_id], by_id[team_b_id]

    async def list_all_teams(self) -> list[Team]:
        """Every team row in deterministic ascending id order (the rebuild
        reset/replay — plan Task 16)."""
        result = await self._session.execute(select(Team).order_by(Team.id))
        return list(result.scalars())

    # ------------------------------------------------------------- events

    async def reserve_event_sequence(self, run_id: uuid.UUID, series_id: uuid.UUID) -> int:
        """Reserve the next per-run application/replay sequence for ONE series
        (Task 16 fix round 4) — the durable ownership record
        (``rating_event_sequences``) that makes the exact-event-pair invariant
        concurrency-safe.

        ``sequence`` is ``max(sequence) + 1`` within the run, computed inside
        the transaction and written to ``rating_event_sequences``. The table's
        ``PRIMARY KEY (run_id, sequence)`` is the DB-enforced serialization
        point: two transactions racing to use the same sequence for different
        series — the second reservation INSERT blocks on the first's uncommitted
        row and fails with a unique violation when the first commits, so exactly
        one series can ever own a sequence. ``UNIQUE (run_id, series_id)`` gives
        a series one sequence per run. Returns the reserved sequence; the
        caller then inserts the two team events against it (their composite FK
        references this reservation).
        """
        max_sequence = await self._session.scalar(
            select(func.max(RatingEventSequence.sequence)).where(RatingEventSequence.run_id == run_id)
        )
        next_sequence = int(max_sequence or 0) + 1
        self._session.add(
            RatingEventSequence(run_id=run_id, series_id=series_id, sequence=next_sequence)
        )
        await self._session.flush()
        return next_sequence

    async def insert_rating_event(
        self,
        *,
        run_id: uuid.UUID,
        series_id: uuid.UUID,
        team_id: uuid.UUID,
        sequence: int,
        elo_before: Decimal,
        elo_after: Decimal,
        elo_change: Decimal,
        opponent_team_id: uuid.UUID,
        result: str,
        k_factor: Decimal | None,
        expected_score: Decimal | None,
        performance_multiplier: Decimal | None,
        importance_multiplier: Decimal | None,
        upset_bonus: Decimal | None,
        calculation_details: dict[str, Any],
    ) -> RatingEvent:
        """Persist one immutable rating event under the current run; the
        ``id``/``created_at`` server defaults are fetched via RETURNING on
        flush. ``sequence`` is the per-run application/replay order shared by
        the series' two team events (allocated by the caller under the rating
        work advisory lock). The caller owns the flush/commit/rollback."""
        event = RatingEvent(
            run_id=run_id,
            series_id=series_id,
            team_id=team_id,
            sequence=sequence,
            elo_before=elo_before,
            elo_after=elo_after,
            elo_change=elo_change,
            opponent_team_id=opponent_team_id,
            result=result,
            k_factor=k_factor,
            expected_score=expected_score,
            performance_multiplier=performance_multiplier,
            importance_multiplier=importance_multiplier,
            upset_bonus=upset_bonus,
            calculation_details=calculation_details,
        )
        self._session.add(event)
        await self._session.flush()
        return event

    async def get_events_for_series(self, series_id: uuid.UUID) -> list[RatingEvent]:
        """The immutable events recorded for a series (deterministic order)."""
        result = await self._session.execute(
            select(RatingEvent).where(RatingEvent.series_id == series_id).order_by(RatingEvent.team_id)
        )
        return list(result.scalars())

    async def get_events_for_team(self, team_id: uuid.UUID) -> list[RatingEvent]:
        """A team's events across all runs/series (deterministic order).

        Consumed by the Task 16 rating-history read; kept here with the other
        event reads so every ``rating_events`` statement lives in this
        repository.
        """
        result = await self._session.execute(
            select(RatingEvent).where(RatingEvent.team_id == team_id).order_by(RatingEvent.created_at)
        )
        return list(result.scalars())

    async def get_events_for_team_in_run(self, team_id: uuid.UUID, run_id: uuid.UUID) -> list[RatingEvent]:
        """A team's immutable events under ONE run (the Task 16 rating-history
        read).

        The current-run events are the ones that explain the team's current
        rating; earlier runs remain intact for audit but are not part of the
        active standings. Ordering is the stable per-run APPLICATION/REPLAY
        ``sequence`` (Task 16 fix round 2) — never the transaction-stable
        ``created_at``/random-UUID insert order — so ``elo_before``/
        ``elo_after`` chain in actual application/replay order even when
        finalization order differs from ``played_at``. ``created_at``/``id``
        remain as a final deterministic tie-breaker.
        """
        result = await self._session.execute(
            select(RatingEvent)
            .where(RatingEvent.team_id == team_id, RatingEvent.run_id == run_id)
            .order_by(RatingEvent.sequence, RatingEvent.created_at, RatingEvent.id)
        )
        return list(result.scalars())
