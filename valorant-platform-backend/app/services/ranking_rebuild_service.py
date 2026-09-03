"""Deterministic versioned rankings rebuild (plan Task 16; design §13.4, ADR-007).

``rebuild()`` runs inside ONE transaction (all-or-nothing per invocation):

1. acquires the shared ``RATING_WORK_LOCK_KEY`` PostgreSQL advisory xact lock
   (fix round 1) — the FIRST statement of every rating transaction, shared
   with finalization, so a rebuild can never race a concurrent — even newly
   inserted — series finalization (whichever acquired the lock first runs to
   completion before the other begins);
2. locks EVERY series row ``FOR UPDATE`` (ascending id), blocking any refresh
   of an attached match and any remaining row-level interleave;
3. rejects (422 ``SERIES_INVALID``) any finalized series whose ``played_at`` is
   null — it cannot be ordered deterministically;
4. creates a new ``rating_runs`` row with the transaction-safe sequential
   ``run_number = max+1`` allocation (inserted ``OVERRIDING SYSTEM VALUE``, so
   a rolled-back rebuild leaves no identity-sequence gap) — the new current
   run;
5. resets ALL teams to the configured ``default_initial_elo`` with zeroed
   counters/peaks (the ``default_initial_elo`` setting is the rebuild reset
   path's initial value — the plan Task 11 contract);
6. replays every eligible finalized series ordered by ``(played_at, created_at,
   id)`` through the SAME rating math as finalize (``apply_rating_policy``) —
   no status transitions, no re-validation writes — inserting events under the
   NEW run while team ratings/counters evolve deterministically. The resolved
   policy is reconstructed from the PERSISTED series columns
   (``rating_mode``/``official_winner_id``/``winner_override_reason``), never
   re-resolved, so forfeit semantics survive the replay;
7. COMMIT. Prior runs' events are never deleted or updated (immutable audit).

Any failure rolls back the new run, the resets, and every inserted event.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.config import get_settings
from app.db.models import Series, Team
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.domain.ratings.policy import decision_from_persisted_state
from app.domain.series.bo import GameSnapshot
from app.domain.series.results import SeriesResult, compute_series_result
from app.schemas.rankings import RebuildResult
from app.services.rating_service import apply_rating_policy
from app.services.series_service import preview_snapshot

logger = logging.getLogger("app.ranking")


class RankingRebuildService:
    def __init__(
        self,
        session: AsyncSession,
        rating_repo: RatingRepository,
        series_repo: SeriesRepository,
    ) -> None:
        self._session = session
        self._rating_repo = rating_repo
        self._series_repo = series_repo

    async def rebuild(self, *, note: str | None = None) -> RebuildResult:
        """Replay every eligible finalized series into a NEW rating run.

        One transaction (see the module docstring); the "rankings rebuilt"
        audit log is emitted only after a successful commit, so a failed
        commit never produces a success log.
        """
        try:
            result = await self._rebuild_locked(note)
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        logger.info(
            "rankings rebuilt",
            extra={
                "run_id": str(result.run_id),
                "run_number": result.run_number,
                "note": result.note,
                "series_count": result.series_count,
                "event_count": result.event_count,
                "teams_reset": result.teams_reset,
            },
        )
        return result

    # ------------------------------------------------------------ internals

    async def _rebuild_locked(self, note: str | None) -> RebuildResult:
        # 1. Global rating-work serialization (fix round 1): the FIRST statement
        #    of every rating transaction. A rebuild and any concurrent finalize
        #    (even of a newly inserted series) serialize here — no rating can be
        #    overwritten or excluded by the race.
        await self._rating_repo.acquire_rating_work_lock()

        # 2. Lock every series row FOR UPDATE (ascending id), which also blocks
        #    any refresh of an attached match mid-replay.
        series_rows = await self._series_repo.lock_all_series_for_update()

        # 3. Deterministic chronological ordering needs a non-null played_at.
        unordered = [s for s in series_rows if s.status == "finalized" and s.played_at is None]
        if unordered:
            raise AppError(
                "SERIES_INVALID",
                422,
                "finalized series without played_at cannot be replayed deterministically",
            )

        # 4. New current run; sequential run_number = max+1, allocated
        #    transaction-safely under the advisory lock (no identity gaps).
        run = await self._rating_repo.create_run(note=note)

        # 5. Reset ALL teams before replay: current/peak to the configured
        #    initial ELO, counters and matches to zero.
        teams = await self._rating_repo.list_all_teams()
        reset_elo = get_settings().default_initial_elo
        teams_by_id: dict[uuid.UUID, Team] = {}
        for team in teams:
            team.current_elo = reset_elo
            team.peak_elo = reset_elo
            team.matches_played = 0
            team.series_wins = 0
            team.series_losses = 0
            teams_by_id[team.id] = team

        # 6. Replay every eligible finalized series in deterministic order.
        eligible = await self._series_repo.get_finalized_series_for_rebuild()
        event_count = 0
        for series in eligible:
            snapshots, result = await self._canonical_state(series)
            team_a = teams_by_id[series.team_a_id]
            team_b = teams_by_id[series.team_b_id]
            decision = decision_from_persisted_state(
                mode=series.rating_mode or "normal",
                official_winner_id=series.official_winner_id,
                override_reason=series.winner_override_reason,
            )
            if decision.official_winner_id not in (team_a.id, team_b.id):
                raise AppError("SERIES_INVALID", 422, "finalized series has no valid official winner")
            events = await apply_rating_policy(
                rating_repo=self._rating_repo,
                series=series,
                team_a=team_a,
                team_b=team_b,
                snapshots=snapshots,
                result=result,
                decision=decision,
                run_id=run.id,
                # A manual series has no attached games; the maps-won total is
                # the per-team matches_played increment (mirrors finalize).
                games_played=(
                    (series.manual_team_a_maps or 0) + (series.manual_team_b_maps or 0)
                    if series.manual_winner_team_id is not None
                    else None
                ),
            )
            event_count += len(events)
        await self._session.flush()

        return RebuildResult(
            run_id=run.id,
            run_number=run.run_number,
            note=note,
            series_count=len(eligible),
            event_count=event_count,
            teams_reset=len(teams),
        )

    async def _canonical_state(self, series: Series) -> tuple[list[GameSnapshot], SeriesResult]:
        """The series' CURRENT canonical games and derived result (the same
        joined read + snapshot derivation preview/finalize use — a refreshed
        canonical match is always reflected). A MANUAL series (no attached
        games — the winner and maps were recorded directly) replays from its
        persisted manual-result fields instead, so the rebuild applies the
        EXACT same rating as the original manual finalize."""
        if series.manual_winner_team_id is not None:
            return [], SeriesResult(
                team_a_maps_won=series.manual_team_a_maps or 0,
                team_b_maps_won=series.manual_team_b_maps or 0,
                calculated_winner_id=series.manual_winner_team_id,
            )
        _series, canonical_games = await self._series_repo.get_series_with_canonical_games(series.id)
        snapshots = [preview_snapshot(series, game)[0] for game in canonical_games]
        result = compute_series_result(snapshots, series.team_a_id, series.team_b_id)
        return snapshots, result
