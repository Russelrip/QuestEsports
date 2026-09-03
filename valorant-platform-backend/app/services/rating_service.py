"""Atomic series finalization (plan Task 15; design §10.3, §13, App. B).

``RatingService.finalize`` is the single most correctness-critical operation:
ONE transaction that

0. acquires the shared ``RATING_WORK_LOCK_KEY`` PostgreSQL advisory xact lock
   (fix round 1) — the FIRST statement of every rating transaction, shared
   with the rankings rebuild, so a rebuild can never race a concurrent (even
   newly inserted) series finalization;
1. locks the series row (``SELECT ... FOR UPDATE``) and rejects an
   already-finalized series (409 ``SERIES_ALREADY_FINALIZED``) and a series
   without a ``played_at`` (409 ``SERIES_INVALID`` — ADR-016);
2. locks both teams ``FOR UPDATE`` in deterministic sorted UUID order (smallest
   id first), so concurrent finalizations of different series sharing a team
   serialize instead of deadlocking;
3. re-reads the CURRENT canonical games (the one-statement joined read shared
   with preview — a refreshed canonical match is always reflected) and re-runs
   the strict best-of gate plus the stored-winner agreement check (any error ->
   422 ``SERIES_INVALID``);
4. resolves the official winner + explicit rating policy (Task 14);
   ``RATING_POLICY_REQUIRED`` -> 409; the official winner must be a team of the
   series;
5. for a rated series applies the verbatim legacy ``EloCalculator`` with the
   persisted ``round(..., 0)`` order (ADR-014) — the unrounded new elos and all
   inputs are preserved in ``calculation_details`` (ADR-013) — inserts one
   immutable event per team under the current ``rating_runs`` row, and updates
   both teams' ``current_elo``/``peak_elo``/``matches_played``/counters;
   ``forfeit_no_rating`` records the result only; ``forfeit_result_only``
   records the winner + counters, both without rating events;
6. writes the derived result (maps won, calculated/official winners, override
   reason) and ``status='finalized'`` + ``finalized_at`` on the series.

Concurrency guarantees: the advisory lock serializes ALL rating work (finalize
vs finalize, finalize vs rebuild); the series row lock serializes concurrent
finalization of the same series; the team row locks serialize cross-series work
sharing a team; the DB unique ``(run_id, series_id, team_id)`` constraint is the
enforced double-rate backstop; and an already-finalized series returns 409 and
never reapplies ELO. Any failure rolls back the whole transaction — nothing is
partially persisted.

``RatingService.finalize_manual`` records an offline/historical series result
(no API/discovery flow, 0016): a create-or-get series finalized immediately
with the winner/maps recorded directly, reusing the SAME
``apply_rating_policy`` math under the same advisory lock — rated manual series
write winner + loser events under the current run, ``unrated`` records the
result only, and a retry on ``external_quest_series_id`` never re-applies ELO.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.api.service_token import ServicePrincipal
from app.db.models import RatingEvent, Series, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.domain.ratings.policy import (
    _RATE_SERIES_MODES,
    RatingPolicyDecision,
    RatingPolicyRequiredError,
    is_non_empty,
    resolve_rating_policy,
)
from app.domain.series.anchor import verify_opposing_anchors
from app.domain.series.bo import GameSnapshot, validate_series_games
from app.domain.series.results import (
    SeriesResult,
    compute_series_result,
    is_future_played_at,
    validate_manual_result,
)
from app.legacy.elo_calculator import EloCalculator
from app.schemas.series import (
    FinalizeRequest,
    FinalizeResult,
    ManualSeriesRequest,
    RatingEventResponse,
)
from app.services.series_service import _winner_agreement_errors, preview_snapshot

logger = logging.getLogger("app.rating")

_IMPORTANCE_MULTIPLIERS = {"regular": 1.0, "playoff": 1.3, "finals": 1.5}

# D6 (spec §4.4/§5.5): the modes whose finalization VERIFIES both anchor PUUIDs
# on opposing sides of every attached game. Alias of the canonical policy set
# ``_RATE_SERIES_MODES`` (spec D4) — the single source of truth for rated modes.
_RATED_MODES = _RATE_SERIES_MODES


class RatingService:
    def __init__(
        self,
        session: AsyncSession,
        series_repo: SeriesRepository,
        rating_repo: RatingRepository,
        match_repo: MatchRepository | None = None,
    ) -> None:
        self._session = session
        self._series_repo = series_repo
        self._rating_repo = rating_repo
        self._match_repo = match_repo

    async def finalize(
        self,
        series_id: uuid.UUID,
        req: FinalizeRequest,
        principal: ServicePrincipal | None = None,
    ) -> FinalizeResult:
        """Finalize a series exactly once, atomically. ``principal`` carries the
        validated Quest actor/operation claims persisted onto the series (delta
        D7; spec §9.2). Any error rolls back all changes; the "series
        finalized" audit log is emitted ONLY after a successful commit."""
        try:
            result, log_extra = await self._finalize_locked(series_id, req, principal)
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        logger.info("series finalized", extra=log_extra)
        return result

    # ------------------------------------------------------------ internals

    async def _finalize_locked(
        self,
        series_id: uuid.UUID,
        req: FinalizeRequest,
        principal: ServicePrincipal | None = None,
    ) -> tuple[FinalizeResult, dict]:
        # 0. Global rating-work serialization (fix round 1): the FIRST statement
        #    of every rating transaction. Finalization and the rankings rebuild
        #    share this advisory lock, so a rebuild can never race a concurrent
        #    (even newly inserted) series finalization.
        await self._rating_repo.acquire_rating_work_lock()

        # 1. Lock the series row; a finalized series is idempotently rejected.
        series = await self._series_repo.get_by_id_for_update(series_id)
        if series is None:
            raise AppError("SERIES_NOT_FOUND", 404, "series not found")
        if series.status == "finalized":
            raise AppError("SERIES_ALREADY_FINALIZED", 409, "series is already finalized")
        if series.played_at is None:
            raise AppError("SERIES_INVALID", 409, "played_at is required to finalize the series")
        # Review finding F1: a future-dated result is invalid data — and a RATED
        # one would brick the D8 chronological guard below (it counts in
        # ``get_latest_finalized_rated_played_at``), with no un-finalize path to
        # recover. Rejected before any rating work.
        if is_future_played_at(series.played_at):
            raise AppError("SERIES_INVALID", 422, "played_at cannot be in the future")

        # 2. Lock both teams in deterministic sorted UUID order.
        team_a, team_b = await self._rating_repo.get_teams_for_update_sorted(
            series.team_a_id, series.team_b_id
        )
        input_ratings = (team_a.current_elo, team_b.current_elo)

        # 3. Re-read the CURRENT canonical games and re-run the strict BO gate.
        #    Every game's rounds/winner derive from the canonical match scores
        #    through the persisted side mapping (the preview contract), so a
        #    refreshed canonical match is always reflected; a stored winner
        #    that now disagrees with the derived winner blocks finalization.
        _series, canonical_games = await self._series_repo.get_series_with_canonical_games(series.id)
        snapshots: list[GameSnapshot] = []
        for game in canonical_games:
            snapshots.append(preview_snapshot(series, game)[0])
        errors = list(validate_series_games(snapshots, series.format))
        errors.extend(_winner_agreement_errors(series, snapshots))
        if errors:
            raise AppError("SERIES_INVALID", 422, "; ".join(errors))

        # 4. Derived calculated winner + resolved official winner/policy.
        result = compute_series_result(snapshots, series.team_a_id, series.team_b_id)
        calculated_winner_id = result.calculated_winner_id
        if req.official_winner_id is not None and req.official_winner_id not in (
            series.team_a_id,
            series.team_b_id,
        ):
            raise AppError("SERIES_INVALID", 409, "official winner must be a team of the series")
        try:
            decision = resolve_rating_policy(
                official_winner_id=req.official_winner_id,
                calculated_winner_id=calculated_winner_id,
                override_reason=req.override_reason,
                explicit_mode=req.rating_mode,
            )
        except RatingPolicyRequiredError as exc:
            raise AppError("RATING_POLICY_REQUIRED", 409, str(exc)) from exc
        if decision.official_winner_id not in (team_a.id, team_b.id):
            raise AppError("SERIES_INVALID", 409, "official winner must be a team of the series")

        # 5b. Delta D6 (spec §5.5): rated modes require both anchor PUUIDs on
        #     OPPOSING sides of every attached game. Failure is 409
        #     ANCHOR_MISMATCH unless the admin supplied an explicit rated mode
        #     AND a non-empty override reason (the audited override path).
        if decision.mode in _RATED_MODES:
            anchor_errors = await self._anchor_errors(series, canonical_games)
            if anchor_errors:
                waiver = req.rating_mode in _RATED_MODES and is_non_empty(req.override_reason)
                if not waiver:
                    raise AppError("ANCHOR_MISMATCH", 409, "; ".join(anchor_errors))

        # 5c. Delta D8 (spec §4.4/§8.5): rated finalization must be
        #     chronological — no backdating. Reject when played_at is EARLIER
        #     than the latest already-finalized rated series. No seven-day
        #     window, no backdate override. Unrated/forfeit are exempt.
        if decision.mode in _RATED_MODES:
            latest = await self._series_repo.get_latest_finalized_rated_played_at(_RATE_SERIES_MODES)
            if latest is not None and series.played_at < latest:
                raise AppError(
                    "BACKDATED_SERIES_REJECTED",
                    409,
                    "cannot rate a series older than the latest rated series",
                )

        events = await self._apply_rating_policy(
            series=series,
            team_a=team_a,
            team_b=team_b,
            snapshots=snapshots,
            result=result,
            decision=decision,
        )

        # 6. Persist the derived result + finalize the series exactly once,
        #    including the resolved rating policy mode (ADR-013) so forfeit
        #    modes stay distinguishable for audit/rebuild even without events.
        series.team_a_maps_won = result.team_a_maps_won
        series.team_b_maps_won = result.team_b_maps_won
        series.calculated_winner_id = calculated_winner_id
        series.official_winner_id = decision.official_winner_id
        series.winner_override_reason = decision.override_reason
        series.rating_mode = decision.mode
        series.status = "finalized"
        series.finalized_at = datetime.now(UTC)
        # D7: persist the validated Quest actor/operation claims (spec §9.2) —
        # the FastAPI request_id is NOT the Quest operation_id; only the signed
        # token claims are durable audit fields.
        series.finalized_by_actor_id = principal.actor_id if principal else None
        series.finalized_by_operation_id = principal.operation_id if principal else None
        await self._session.flush()

        # The audit payload is prepared here but emitted only after COMMIT
        # (the caller logs after a successful commit, never after a rollback).
        log_extra = {
            "series_id": str(series.id),
            "mode": decision.mode,
            "official_winner_id": str(decision.official_winner_id) if decision.official_winner_id else None,
            "teams": {"team_a_id": str(team_a.id), "team_b_id": str(team_b.id)},
            "input_ratings": {"team_a": str(input_ratings[0]), "team_b": str(input_ratings[1])},
            "output_ratings": {"team_a": str(team_a.current_elo), "team_b": str(team_b.current_elo)},
            "rating_event_ids": [str(event.id) for event in events],
            "actor_id": series.finalized_by_actor_id,
            "operation_id": series.finalized_by_operation_id,
        }

        result = FinalizeResult(
            series_id=series.id,
            status="finalized",
            calculated_winner_id=calculated_winner_id,
            official_winner_id=decision.official_winner_id,
            winner_override_reason=decision.override_reason,
            rating_mode=decision.mode,
            events=[to_event_response(event) for event in events],
            team_a_current_elo=team_a.current_elo,
            team_b_current_elo=team_b.current_elo,
        )
        return result, log_extra

    async def _anchor_errors(self, series: Series, canonical_games: list) -> list[str]:
        """Per-game anchor verification errors for the attached games."""
        if self._match_repo is None:
            return ["anchor verification is not configured"]
        if series.anchor_a_puuid is None or series.anchor_b_puuid is None:
            return ["series has no anchor identities; rated finalization requires anchors"]
        match_ids = [game.match_id for game in canonical_games]
        sides = await self._match_repo.get_anchor_player_sides(
            match_ids, series.anchor_a_puuid, series.anchor_b_puuid
        )
        return verify_opposing_anchors(
            anchor_a=series.anchor_a_puuid,
            anchor_b=series.anchor_b_puuid,
            match_ids=match_ids,
            sides_by_match=sides,
        )

    async def _apply_rating_policy(
        self,
        *,
        series: Series,
        team_a: Team,
        team_b: Team,
        snapshots: list[GameSnapshot],
        result: SeriesResult,
        decision: RatingPolicyDecision,
    ) -> list[RatingEvent]:
        """Apply the resolved policy inside the transaction — the module-level
        ``apply_rating_policy`` (shared with the Task 16 rebuild replay) under
        the CURRENT run.

        Rated modes run the legacy calculator, insert one immutable event per
        team under the current run, and update both teams' ratings/counters.
        ``forfeit_no_rating`` records the result only; ``forfeit_result_only``
        records the official winner + win/loss counters without a rating
        change. Returns the inserted events (empty for the forfeit modes).
        """
        if not decision.rate_series:
            return await apply_rating_policy(
                rating_repo=self._rating_repo,
                series=series,
                team_a=team_a,
                team_b=team_b,
                snapshots=snapshots,
                result=result,
                decision=decision,
                run_id=None,
            )
        run = await self._rating_repo.get_current_run()
        if run is None:
            raise AppError("INTERNAL_ERROR", 500, "no active rating run (0007_rating_runs.sql seed missing)")
        return await apply_rating_policy(
            rating_repo=self._rating_repo,
            series=series,
            team_a=team_a,
            team_b=team_b,
            snapshots=snapshots,
            result=result,
            decision=decision,
            run_id=run.id,
        )

    async def finalize_manual(
        self,
        req: ManualSeriesRequest,
        principal: ServicePrincipal | None = None,
    ) -> FinalizeResult:
        """Record an offline/historical series result — no API/discovery flow.

        ONE transaction: create-or-get a series finalized immediately (no
        anchors, no attached games), applying ELO under the current run for
        ``rating_mode="normal"`` (winner + loser events) or recording the result
        only for ``"unrated"``. The winner is given, so the game/anchor
        verification normal finalization runs is skipped. A retry with the same
        ``external_quest_series_id`` converges on the existing finalized series
        and NEVER re-applies ELO (idempotent). Any error rolls back all changes.
        """
        try:
            result, log_extra = await self._finalize_manual_locked(req, principal)
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        logger.info("manual series finalized", extra=log_extra)
        return result

    async def _finalize_manual_locked(
        self,
        req: ManualSeriesRequest,
        principal: ServicePrincipal | None,
    ) -> tuple[FinalizeResult, dict]:
        # 0. Global rating-work serialization (the same advisory lock finalize
        #    and the rebuild take as their FIRST statement): a manual rating can
        #    never race a concurrent finalize or rebuild.
        await self._rating_repo.acquire_rating_work_lock()

        # Review finding F7: a RATED manual result MUST carry the Quest external
        # key — without it the create-or-get idempotency is skipped and every
        # retry creates a new series and re-applies ELO. The unrated/forfeit
        # manual paths may stay unkeyed.
        if req.rating_mode == "normal" and req.external_quest_series_id is None:
            raise AppError(
                "SERIES_INVALID",
                422,
                "external_quest_series_id is required for rated manual series",
            )

        # 1. Create-or-get by the Quest external key (idempotency): a retry
        #    converges on the existing FINALIZED series and re-applies nothing.
        if req.external_quest_series_id is not None:
            existing = await self._series_repo.get_by_external_quest_series_id(req.external_quest_series_id)
            if existing is not None:
                if existing.status != "finalized":
                    raise AppError(
                        "SERIES_INVALID",
                        409,
                        "external_quest_series_id is already used by a non-finalized series",
                    )
                # Review finding F4: the key only converges on an identical
                # payload — the Quest BFF derives the key from the payload, so a
                # distinct payload under the same key (or a corrected
                # resubmission under a different key) must never silently merge
                # into a stored result (double ELO).
                if _manual_payload_mismatch(req, existing):
                    raise AppError(
                        "SERIES_INVALID",
                        409,
                        "external key already used with a different payload",
                    )
                team_a, team_b = await self._rating_repo.get_teams_for_update_sorted(
                    existing.team_a_id, existing.team_b_id
                )
                events = await self._rating_repo.get_events_for_series(existing.id)
                return await self._manual_result(existing, team_a, team_b, events), self._manual_log_extra(
                    existing, team_a, team_b, events, principal
                )

        # Review finding F1: a future-dated manual result is invalid data — and
        # a RATED one would brick the D8 chronological guard (manual series
        # count in ``get_latest_finalized_rated_played_at``), blocking every
        # later rated finalize until real time passes the typo'd date. Rejected
        # before any rating work.
        if is_future_played_at(req.played_at):
            raise AppError("SERIES_INVALID", 422, "played_at cannot be in the future")

        # 2. Request validation: distinct teams (409), winner of the series
        #    (409), and a maps-won pair that is reachable for the format with
        #    the winner holding strictly more maps (422 ``SERIES_INVALID``).
        if req.team_a_id == req.team_b_id:
            raise AppError("SERIES_INVALID", 409, "team_a_id must differ from team_b_id")
        if req.winner_team_id not in (req.team_a_id, req.team_b_id):
            raise AppError("SERIES_INVALID", 409, "winner_team_id must be team_a_id or team_b_id")
        errors = validate_manual_result(
            format_=req.format,
            team_a_id=req.team_a_id,
            team_b_id=req.team_b_id,
            winner_team_id=req.winner_team_id,
            team_a_maps_won=req.team_a_maps_won,
            team_b_maps_won=req.team_b_maps_won,
        )
        if errors:
            raise AppError("SERIES_INVALID", 422, "; ".join(errors))

        # 3. Lock both teams in deterministic sorted UUID order (missing team ->
        #    404 ``TEAM_NOT_FOUND``) so the ratings read below are consistent.
        team_a, team_b = await self._rating_repo.get_teams_for_update_sorted(req.team_a_id, req.team_b_id)
        input_ratings = (team_a.current_elo, team_b.current_elo)

        # 4. Create the manual series (finalized below; no anchors, no games). A
        #    create-or-get race on the external key from a concurrent
        #    non-locked path is reconciled on the unique constraint.
        try:
            series = await self._series_repo.create_manual_series(
                team_a_id=req.team_a_id,
                team_b_id=req.team_b_id,
                format=req.format,
                importance="regular",
                played_at=req.played_at,
                external_quest_series_id=req.external_quest_series_id,
                manual_winner_team_id=req.winner_team_id,
                manual_team_a_maps=req.team_a_maps_won,
                manual_team_b_maps=req.team_b_maps_won,
            )
        except IntegrityError as exc:
            await self._session.rollback()
            key = req.external_quest_series_id
            if key is not None and _is_external_series_key_violation(exc):
                existing = await self._series_repo.get_by_external_quest_series_id(key)
                if existing is not None and existing.status == "finalized":
                    if _manual_payload_mismatch(req, existing):
                        raise AppError(
                            "SERIES_INVALID",
                            409,
                            "external key already used with a different payload",
                        ) from exc
                    team_a, team_b = await self._rating_repo.get_teams_for_update_sorted(
                        existing.team_a_id, existing.team_b_id
                    )
                    events = await self._rating_repo.get_events_for_series(existing.id)
                    return await self._manual_result(existing, team_a, team_b, events), self._manual_log_extra(
                        existing, team_a, team_b, events, principal
                    )
                # Review finding F6: the conflicting row exists but is not
                # finalized — never surface a raw IntegrityError (a 500) for a
                # race we can report with the same stable error the key-hit
                # path uses for a non-finalized key owner.
                raise AppError(
                    "SERIES_INVALID",
                    409,
                    "external_quest_series_id is already used by a non-finalized series",
                ) from exc
            raise

        # 5. Apply the rating policy: ``normal`` rates under the current run,
        #    ``unrated`` records the result only. The winner is given, so no
        #    game/anchor verification runs; snapshots are empty and the
        #    maps/rounds inputs come from the recorded result.
        result = SeriesResult(
            team_a_maps_won=req.team_a_maps_won,
            team_b_maps_won=req.team_b_maps_won,
            calculated_winner_id=req.winner_team_id,
        )
        try:
            decision = resolve_rating_policy(
                official_winner_id=req.winner_team_id,
                calculated_winner_id=req.winner_team_id,
                override_reason=None,
                explicit_mode=req.rating_mode,
            )
        except RatingPolicyRequiredError as exc:
            raise AppError("RATING_POLICY_REQUIRED", 409, str(exc)) from exc
        run_id = None
        if decision.rate_series:
            run = await self._rating_repo.get_current_run()
            if run is None:
                raise AppError("INTERNAL_ERROR", 500, "no active rating run (0007_rating_runs.sql seed missing)")
            run_id = run.id
        events = await apply_rating_policy(
            rating_repo=self._rating_repo,
            series=series,
            team_a=team_a,
            team_b=team_b,
            snapshots=[],
            result=result,
            decision=decision,
            run_id=run_id,
            # No games are attached, so the per-team matches_played increment is
            # the number of maps actually played (the recorded maps-won total).
            games_played=req.team_a_maps_won + req.team_b_maps_won,
        )

        # 6. Persist the derived result + manual fields and finalize the series
        #    exactly once. ``official`` == ``calculated`` == the recorded winner.
        series.team_a_maps_won = req.team_a_maps_won
        series.team_b_maps_won = req.team_b_maps_won
        series.calculated_winner_id = req.winner_team_id
        series.official_winner_id = req.winner_team_id
        series.winner_override_reason = None
        series.rating_mode = decision.mode
        series.status = "finalized"
        series.finalized_at = datetime.now(UTC)
        series.finalized_by_actor_id = principal.actor_id if principal else None
        series.finalized_by_operation_id = principal.operation_id if principal else None
        await self._session.flush()

        log_extra = {
            "series_id": str(series.id),
            "mode": decision.mode,
            "official_winner_id": str(decision.official_winner_id) if decision.official_winner_id else None,
            "teams": {"team_a_id": str(team_a.id), "team_b_id": str(team_b.id)},
            "input_ratings": {"team_a": str(input_ratings[0]), "team_b": str(input_ratings[1])},
            "output_ratings": {"team_a": str(team_a.current_elo), "team_b": str(team_b.current_elo)},
            "rating_event_ids": [str(event.id) for event in events],
            "actor_id": series.finalized_by_actor_id,
            "operation_id": series.finalized_by_operation_id,
        }
        return await self._manual_result(series, team_a, team_b, events), log_extra

    async def _manual_result(
        self, series: Series, team_a: Team, team_b: Team, events: list[RatingEvent]
    ) -> FinalizeResult:
        """FinalizeResult for a manual series — the same shape the normal
        finalize returns, plus the recorded manual fields."""
        return FinalizeResult(
            series_id=series.id,
            status=series.status,
            calculated_winner_id=series.calculated_winner_id,
            official_winner_id=series.official_winner_id,
            winner_override_reason=series.winner_override_reason,
            rating_mode=series.rating_mode,
            events=[to_event_response(event) for event in events],
            team_a_current_elo=team_a.current_elo,
            team_b_current_elo=team_b.current_elo,
            manual_winner_team_id=series.manual_winner_team_id,
            manual_team_a_maps=series.manual_team_a_maps,
            manual_team_b_maps=series.manual_team_b_maps,
        )

    def _manual_log_extra(
        self,
        series: Series,
        team_a: Team,
        team_b: Team,
        events: list[RatingEvent],
        principal: ServicePrincipal | None,
    ) -> dict:
        return {
            "series_id": str(series.id),
            "mode": series.rating_mode,
            "official_winner_id": str(series.official_winner_id) if series.official_winner_id else None,
            "teams": {"team_a_id": str(team_a.id), "team_b_id": str(team_b.id)},
            "rating_event_ids": [str(event.id) for event in events],
            "actor_id": series.finalized_by_actor_id,
            "operation_id": series.finalized_by_operation_id,
        }


# ------------------------------------------------------------- pure helpers


async def apply_rating_policy(
    rating_repo: RatingRepository,
    *,
    series: Series,
    team_a: Team,
    team_b: Team,
    snapshots: list[GameSnapshot],
    result: SeriesResult,
    decision: RatingPolicyDecision,
    run_id: uuid.UUID | None,
    games_played: int | None = None,
) -> list[RatingEvent]:
    """Apply a resolved rating policy — the rating math shared by finalization
    (Task 15), the deterministic rebuild replay (Task 16), and the manual
    result flow (0016), so all three run the EXACT same calculation (plan Task
    16; design §13.4).

    Rated modes run the verbatim legacy ``EloCalculator`` with the persisted
    ``round(..., 0)`` order (ADR-014), insert one immutable event per team under
    ``run_id``, and update both teams' ratings/counters (current + peak,
    ``matches_played`` += ``games_played``, counters by the OFFICIAL winner —
    ADR-011). ``forfeit_no_rating`` records the result only;
    ``forfeit_result_only`` records the official winner + win/loss counters
    without a rating change. ``run_id`` is required for rated modes (the rebuild
    passes the NEW run's id, finalize the current run's id) and ignored for the
    forfeit modes.

    ``games_played`` overrides the per-team ``matches_played`` increment
    (defaults to the number of attached games). Manual series have no attached
    games — the manual flow and its rebuild replay pass the recorded maps-won
    total so the K-factor progression stays identical across finalize and
    replay.

    Returns the inserted events (empty for the forfeit modes).
    """
    if not decision.rate_series:
        # ``unrated``/``forfeit_no_rating``: no ELO, no counters; ``forfeit_result_only``: counters only (D4).
        if decision.mode == "forfeit_result_only" and decision.official_winner_id is not None:
            if decision.official_winner_id == team_a.id:
                team_a.series_wins += 1
                team_b.series_losses += 1
            elif decision.official_winner_id == team_b.id:
                team_b.series_wins += 1
                team_a.series_losses += 1
        return []
    if run_id is None:
        raise AppError("INTERNAL_ERROR", 500, "no active rating run (0007_rating_runs.sql seed missing)")

    games_played = len(snapshots) if games_played is None else games_played

    if decision.official_winner_id == team_a.id:
        winner, loser = team_a, team_b
        winner_rounds = sum(game.team_a_rounds for game in snapshots)
        loser_rounds = sum(game.team_b_rounds for game in snapshots)
        winner_maps, loser_maps = result.team_a_maps_won, result.team_b_maps_won
    else:
        winner, loser = team_b, team_a
        winner_rounds = sum(game.team_b_rounds for game in snapshots)
        loser_rounds = sum(game.team_a_rounds for game in snapshots)
        winner_maps, loser_maps = result.team_b_maps_won, result.team_a_maps_won

    winner_elo = float(winner.current_elo)
    loser_elo = float(loser.current_elo)
    # K for each team is read inside the transaction (pre-increment counts).
    k_winner = EloCalculator.get_k_factor(winner.matches_played)
    k_loser = EloCalculator.get_k_factor(loser.matches_played)
    importance_multiplier = _IMPORTANCE_MULTIPLIERS.get(series.importance, 1.0)
    k_winner_post = k_winner * importance_multiplier
    k_loser_post = k_loser * importance_multiplier
    expected_winner = EloCalculator.expected_score(winner_elo, loser_elo)
    expected_loser = EloCalculator.expected_score(loser_elo, winner_elo)
    performance_multiplier = _performance_multiplier(
        series.format, winner_maps, loser_maps, winner_rounds, loser_rounds
    )
    upset_bonus = EloCalculator.get_upset_bonus(winner_elo, loser_elo)

    # Verbatim legacy calculation (Task 10 characterization parity).
    # The legacy signature types the maps args as int despite None being
    # the documented BO1 sentinel — matches the verbatim module.
    new_winner_elo, new_loser_elo = EloCalculator.calculate_new_elo(
        winner_elo,
        loser_elo,
        winner.matches_played,
        loser.matches_played,
        winner_rounds,
        loser_rounds,
        series.importance,
        series.format,
        None if series.format == "bo1" else winner_maps,  # type: ignore[arg-type]
        None if series.format == "bo1" else loser_maps,  # type: ignore[arg-type]
    )

    # Legacy persistence order (ADR-014): round each new elo, then the
    # change is round(new - input, 0) — never the difference of rounds.
    persisted_winner_elo = round(new_winner_elo, 0)
    persisted_loser_elo = round(new_loser_elo, 0)
    winner_base_change = k_winner_post * (1 - expected_winner) * performance_multiplier
    loser_base_change = k_loser_post * (0 - expected_loser) * performance_multiplier
    winner_change = round(new_winner_elo - winner_elo, 0)
    loser_change = round(new_loser_elo - loser_elo, 0)

    details = {
        "mode": decision.mode,
        "official_winner_id": str(decision.official_winner_id),
        "override_reason": decision.override_reason,
        "is_override": (
            decision.official_winner_id != result.calculated_winner_id
            and decision.override_reason is not None
        ),
        "raw_unrounded_new_elos": {"winner": new_winner_elo, "loser": new_loser_elo},
        "base_changes": {"winner": winner_base_change, "loser": loser_base_change},
        "inputs": {
            "winner_elo": winner_elo,
            "loser_elo": loser_elo,
            "winner_matches": winner.matches_played,
            "loser_matches": loser.matches_played,
            "winner_rounds": winner_rounds,
            "loser_rounds": loser_rounds,
            "winner_maps": winner_maps,
            "loser_maps": loser_maps,
            "importance": series.importance,
            "format": series.format,
            "expected_scores": {"winner": expected_winner, "loser": expected_loser},
            "k_factors": {"winner": k_winner_post, "loser": k_loser_post},
            "performance_multiplier": performance_multiplier,
            "importance_multiplier": importance_multiplier,
            "upset_bonus": upset_bonus,
        },
    }

    # Reserve the per-run application/replay sequence ONCE for this series
    # (Task 16 fix round 4): the durable ownership row in
    # ``rating_event_sequences``, then BOTH team events reference it. Safe
    # because every caller holds the rating-work advisory lock (finalize and
    # rebuild); the reservation table's unique ``(run_id, sequence)`` is the
    # DB-enforced serialization point for any concurrent use.
    sequence = await rating_repo.reserve_event_sequence(run_id, series.id)

    winner_event = await rating_repo.insert_rating_event(
        run_id=run_id,
        series_id=series.id,
        team_id=winner.id,
        sequence=sequence,
        elo_before=winner.current_elo,
        elo_after=_as_decimal(persisted_winner_elo),
        elo_change=_as_decimal(winner_change),
        opponent_team_id=loser.id,
        result="win",
        k_factor=_as_decimal(k_winner_post),
        expected_score=_as_decimal(expected_winner),
        performance_multiplier=_as_decimal(performance_multiplier),
        importance_multiplier=_as_decimal(importance_multiplier),
        upset_bonus=_as_decimal(upset_bonus),
        calculation_details=details,
    )
    loser_event = await rating_repo.insert_rating_event(
        run_id=run_id,
        series_id=series.id,
        team_id=loser.id,
        sequence=sequence,
        elo_before=loser.current_elo,
        elo_after=_as_decimal(persisted_loser_elo),
        elo_change=_as_decimal(loser_change),
        opponent_team_id=winner.id,
        result="loss",
        k_factor=_as_decimal(k_loser_post),
        expected_score=_as_decimal(expected_loser),
        performance_multiplier=_as_decimal(performance_multiplier),
        importance_multiplier=_as_decimal(importance_multiplier),
        upset_bonus=_as_decimal(0),
        calculation_details=details,
    )

    # Team updates: current + peak, matches_played += games, counters by
    # the OFFICIAL winner (ADR-011).
    winner.current_elo = _as_decimal(persisted_winner_elo)
    winner.peak_elo = max(winner.peak_elo, _as_decimal(persisted_winner_elo))
    winner.matches_played += games_played
    winner.series_wins += 1
    loser.current_elo = _as_decimal(persisted_loser_elo)
    loser.peak_elo = max(loser.peak_elo, _as_decimal(persisted_loser_elo))
    loser.matches_played += games_played
    loser.series_losses += 1

    return [winner_event, loser_event]


def _performance_multiplier(
    format_: str, winner_maps: int, loser_maps: int, winner_rounds: int, loser_rounds: int
) -> float:
    """The exact performance multiplier the legacy calculator applies to a
    rating pair — series multiplier for BO3/BO5, round differential for BO1."""
    if format_ in ("bo3", "bo5"):
        return EloCalculator.get_series_multiplier(
            winner_maps, loser_maps, winner_rounds, loser_rounds, format_
        )
    return EloCalculator.get_round_differential_multiplier(winner_rounds, loser_rounds)


def _as_decimal(value: float) -> Decimal:
    """Exact decimal string representation of a float for numeric columns."""
    return Decimal(str(value))


def to_event_response(event) -> RatingEventResponse:
    """Map an immutable rating event onto the shared ``RatingEventResponse``.

    Public (not underscore-prefixed) because the Task 16 ranking service's
    rating-history read consumes it (fix round 1: no cross-service private
    helper coupling).
    """
    return RatingEventResponse(
        id=event.id,
        run_id=event.run_id,
        series_id=event.series_id,
        team_id=event.team_id,
        opponent_team_id=event.opponent_team_id,
        result=event.result,
        elo_before=event.elo_before,
        elo_after=event.elo_after,
        elo_change=event.elo_change,
        sequence=event.sequence,
        k_factor=event.k_factor,
        expected_score=event.expected_score,
        performance_multiplier=event.performance_multiplier,
        importance_multiplier=event.importance_multiplier,
        upset_bonus=event.upset_bonus,
        calculation_details=event.calculation_details,
        created_at=event.created_at,
    )


def _manual_payload_mismatch(req: ManualSeriesRequest, series: Series) -> bool:
    """True when a key-hit request's payload differs from the stored manual row.

    The Quest BFF derives ``external_quest_series_id`` from the payload, so the
    key is safe to converge on ONLY when the payload matches: two distinct
    payloads that canonicalize to the same key (or a corrected resubmission
    under a different key) must never silently merge into a stored result and
    double-rate. Compares the six fields that define a manual result (review
    finding F4).
    """
    return (
        req.team_a_id != series.team_a_id
        or req.team_b_id != series.team_b_id
        or req.winner_team_id != series.manual_winner_team_id
        or req.team_a_maps_won != series.manual_team_a_maps
        or req.team_b_maps_won != series.manual_team_b_maps
        or req.rating_mode != series.rating_mode
    )


def _is_external_series_key_violation(exc: IntegrityError) -> bool:
    """True when the integrity error is the ``external_quest_series_id`` unique
    constraint (the manual create-or-get race reconciliation). Asyncpg can
    surface the constraint name on ``orig.diag.constraint_name``, but through
    SQLAlchemy's asyncpg adapter it is usually only present in the message text,
    so both are checked."""
    orig = exc.orig
    constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
    if not constraint:
        constraint = getattr(orig, "constraint_name", None)
    constraint = str(constraint or "")
    return constraint == "series_external_quest_series_id_key" or "series_external_quest_series_id_key" in str(
        orig
    )
