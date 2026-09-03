"""Series draft service (plan Task 12; design §9.2, §10.2–10.3, App. B).

Create a draft series, attach imported canonical matches with a Red/Blue side
mapping, and remove/reorder/edit games while the series is a draft. Rounds and
the per-game winner are derived EXCLUSIVELY from the imported match's mapped
team-A/team-B round totals — ``match.winning_side`` and caller-supplied scores
are never used (fix round 1). ``compute_series_result`` is authoritative: the
series' map counts and ``calculated_winner_id`` are recomputed from the
attached games after every mutation and persisted.

Concurrency (fix round 1): every mutation first locks the owning series row
with ``SELECT ... FOR UPDATE``, then reads/recomputes games from that locked
transaction state, so concurrent mutations serialize and no aggregate is lost.

Draft validity (fix round 1): ``validate_draft_state`` (plus the winner-vs-
rounds agreement check) runs after every mutation; a draft may never hold an
invalid shape — extra maps, gaps, maps after a clinch, tied/scoreless rounds,
and winner disagreement are all rejected with 409 ``SERIES_INVALID``. An
in-progress draft (no winner yet) is allowed only while it stays resumable.
Reorder of an occupied game number atomically swaps the two games' numbers
(fix round 1) instead of failing on the unique constraint.

Invalid side literals surface as the stable 400 ``INVALID_SIDE_MAPPING``; the
API schema still rejects malformed literals with the sanitized 422
``INVALID_REQUEST`` at the boundary.

Finalize input parsing (plan Task 14): ``resolve_finalization_policy`` derives
the calculated winner from the attached games' CURRENT canonical state (the
same single joined read as preview — ``get_series_with_canonical_games``) and
resolves the official winner + explicit rating mode with no writes — an
override requires a reason and an explicit mode (else 409
``RATING_POLICY_REQUIRED``). The finalize transaction that consumes it arrives
in Task 15.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.models import Match, Series, SeriesGame
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.series_repository import SeriesRepository
from app.domain.ratings.policy import (
    RatingPolicyDecision,
    RatingPolicyRequiredError,
    resolve_rating_policy,
)
from app.domain.series.bo import (
    CanonicalGameSnapshot,
    GameSnapshot,
    validate_draft_state,
    validate_series_games,
)
from app.domain.series.results import compute_series_result, is_future_played_at
from app.domain.series.sides import resolve_sides
from app.schemas.series import (
    AttachGameRequest,
    FinalizeRequest,
    GameView,
    SeriesCreate,
    SeriesPreview,
    SetGameOrderRequest,
    UpdateGameRequest,
    UpdateSeriesRequest,
)
from app.services.player_service import PlayerService


class SeriesService:
    def __init__(
        self,
        session: AsyncSession,
        series_repo: SeriesRepository,
        match_repo: MatchRepository,
        player_svc: PlayerService | None = None,
    ) -> None:
        self._session = session
        self._series_repo = series_repo
        self._match_repo = match_repo
        self._player_svc = player_svc

    # ------------------------------------------------------------- mutations

    async def create(self, req: SeriesCreate) -> Series:
        series, _created = await self.create_or_get(req)
        return series

    async def create_or_get(self, req: SeriesCreate) -> tuple[Series, bool]:
        """Create a draft series, or return the existing row keyed on
        ``external_quest_series_id`` (200) when the key already converged
        (delta D3; spec §8.1). Team equality, FK, and anchor rules apply only
        to the create path — a retry with the same key converges.
        """
        if req.external_quest_series_id is not None:
            existing = await self._series_repo.get_by_external_quest_series_id(req.external_quest_series_id)
            if existing is not None:
                return existing, False
        if req.team_a_id == req.team_b_id:
            raise AppError("SERIES_INVALID", 409, "team_a_id must differ from team_b_id")
        # D6 (spec §4.4/§5.3): anchor Riot IDs resolve to PUUIDs here, inside
        # the create transaction, so they persist atomically with the series
        # row. Both anchors are required together; resolution is cache-first
        # (Henrik on miss) through the injected player service.
        anchor_a_puuid: str | None = None
        anchor_b_puuid: str | None = None
        if req.anchor_player_a is not None or req.anchor_player_b is not None:
            if self._player_svc is None:
                raise AppError("SERIES_INVALID", 409, "anchor resolution is not configured")
            if req.anchor_player_a is None or req.anchor_player_b is None:
                raise AppError("SERIES_INVALID", 409, "both anchors are required together")
            anchor_a_puuid = (
                await self._player_svc.resolve_uncommitted(req.anchor_player_a.name, req.anchor_player_a.tag)
            ).puuid
            anchor_b_puuid = (
                await self._player_svc.resolve_uncommitted(req.anchor_player_b.name, req.anchor_player_b.tag)
            ).puuid
        try:
            series = await self._series_repo.create_series(
                team_a_id=req.team_a_id,
                team_b_id=req.team_b_id,
                format=req.format,
                importance=req.importance,
                played_at=req.played_at,
                notes=req.notes,
                external_quest_series_id=req.external_quest_series_id,
                anchor_a_puuid=anchor_a_puuid,
                anchor_b_puuid=anchor_b_puuid,
            )
            await self._session.commit()
            return series, True
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_external_series_key_violation(exc):
                existing = await self._series_repo.get_by_external_quest_series_id(req.external_quest_series_id)
                if existing is not None:
                    return existing, False
            if _is_team_fk_violation(exc):
                raise AppError("TEAM_NOT_FOUND", 404, "team not found") from exc
            raise

    async def attach_game(self, series_id: uuid.UUID, req: AttachGameRequest) -> SeriesGame:
        """Attach an imported, completed match to a draft series.

        ``team_b_side``, both round scores, and ``winner_team_id`` are derived
        from the match through the side mapping (never re-entered). When
        ``req.team_a_side`` is omitted (None) it is derived from the series'
        anchor players on the match: both anchors are required on the series
        (else 409 ``SERIES_INVALID``) and both must appear in the match on
        OPPOSING sides (else 409 ``ANCHOR_NOT_IN_MATCH``), with
        ``anchor_a_puuid``'s side becoming ``team_a_side``. An explicit
        ``team_a_side`` is still honored as before (backward-compat). The match
        must exist (404 ``MATCH_NOT_FOUND``), be completed (422
        ``MATCH_NOT_COMPLETED``), carry round scores (409 ``SERIES_INVALID``
        when scoreless), and not be attached to another series (409
        ``MATCH_ALREADY_ASSIGNED_TO_SERIES``). The resulting draft must satisfy
        ``validate_draft_state`` or the attach is rejected (409).
        """
        series = await self._require_draft(series_id)
        match = await self._match_repo.get_by_id(req.match_id)
        if match is None:
            raise AppError("MATCH_NOT_FOUND", 404, "match not found")
        if not match.is_completed:
            raise AppError("MATCH_NOT_COMPLETED", 422, "match is not completed")
        if await self._series_repo.find_game_by_match_id(req.match_id) is not None:
            raise AppError("MATCH_ALREADY_ASSIGNED_TO_SERIES", 409, "match already attached to a series")

        team_a_side = req.team_a_side
        if team_a_side is None:
            team_a_side = await self._derive_anchor_side(series, match.id)
        team_a_side, team_b_side = _resolve_sides(team_a_side)
        team_a_rounds, team_b_rounds = _scores_for_sides(match, team_a_side)
        winner_team_id = _winner_from_rounds(series, team_a_rounds, team_b_rounds)

        try:
            game = await self._series_repo.insert_game(
                series_id=series.id,
                game_number=req.game_number,
                match_id=match.id,
                team_a_side=team_a_side,
                team_b_side=team_b_side,
                team_a_rounds=team_a_rounds,
                team_b_rounds=team_b_rounds,
                winner_team_id=winner_team_id,
            )
            await self._recompute_and_validate(series)
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_game_number_unique_violation(exc):
                raise AppError(
                    "SERIES_INVALID", 409, f"game number {req.game_number} already used in this series"
                ) from exc
            if _is_match_unique_violation(exc):
                raise AppError(
                    "MATCH_ALREADY_ASSIGNED_TO_SERIES", 409, "match already attached to a series"
                ) from exc
            raise
        except AppError:
            await self._session.rollback()
            raise
        return game

    async def remove_game(self, series_id: uuid.UUID, game_id: uuid.UUID) -> None:
        """Remove an attached game from a draft series.

        The removal must leave a valid draft state: removing a game that would
        create a gap (non-contiguous numbers) or an unresumable shape is
        rejected with 409 ``SERIES_INVALID``.
        """
        series = await self._require_draft(series_id)
        game = await self._series_repo.get_game_by_id(game_id)
        if game is None or game.series_id != series_id:
            raise AppError("SERIES_NOT_FOUND", 404, "series game not found")
        try:
            await self._series_repo.delete_game(game)
            await self._recompute_and_validate(series)
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            raise
        except AppError:
            await self._session.rollback()
            raise

    async def update_game(
        self, series_id: uuid.UUID, game_id: uuid.UUID, req: UpdateGameRequest
    ) -> SeriesGame:
        """Reorder (``game_number``) or re-side (``team_a_side``) a game in a
        draft.

        Reordering onto a free number moves the game there; reordering onto an
        occupied number atomically swaps the two games' numbers (no transient
        unique violation). Re-siding flips ``team_b_side`` to the opposite and
        re-derives rounds and the winner from the match's scores. The resulting
        draft must satisfy ``validate_draft_state`` (409 ``SERIES_INVALID``).
        """
        series = await self._require_draft(series_id)
        game = await self._series_repo.get_game_by_id(game_id)
        if game is None or game.series_id != series_id:
            raise AppError("SERIES_NOT_FOUND", 404, "series game not found")

        try:
            if req.game_number is not None and req.game_number != game.game_number:
                occupant = await self._series_repo.find_game_by_number(series_id, req.game_number)
                if occupant is not None:
                    await self._series_repo.swap_game_numbers(game, occupant)
                else:
                    await self._series_repo.update_game(game, game_number=req.game_number)
            if req.team_a_side is not None:
                team_a_side, team_b_side = _resolve_sides(req.team_a_side)
                match = await self._match_repo.get_by_id(game.match_id)
                if match is None:
                    raise AppError("MATCH_NOT_FOUND", 404, "match not found")
                team_a_rounds, team_b_rounds = _scores_for_sides(match, team_a_side)
                winner_team_id = _winner_from_rounds(series, team_a_rounds, team_b_rounds)
                await self._series_repo.update_game(
                    game,
                    team_a_side=team_a_side,
                    team_b_side=team_b_side,
                    team_a_rounds=team_a_rounds,
                    team_b_rounds=team_b_rounds,
                    winner_team_id=winner_team_id,
                )
            await self._recompute_and_validate(series)
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_game_number_unique_violation(exc):
                raise AppError("SERIES_INVALID", 409, "game number already used in this series") from exc
            raise
        except AppError:
            await self._session.rollback()
            raise
        return game

    async def update_played_at(self, series_id: uuid.UUID, req: UpdateSeriesRequest) -> Series:
        """Update a draft series' ``played_at`` (draft only).

        Draft-only like every other series mutation (``_require_draft``): the
        row is loaded ``FOR UPDATE`` and its status checked before the write,
        so a finalized series rejects the update with 409
        ``SERIES_ALREADY_FINALIZED`` and no other field changes. A future
        ``played_at`` is rejected (422 ``SERIES_INVALID``) — a future-dated
        RATED finalize would brick the D8 chronological guard (review finding
        F1).
        """
        series = await self._require_draft(series_id)
        if is_future_played_at(req.played_at):
            raise AppError("SERIES_INVALID", 422, "played_at cannot be in the future")
        await self._series_repo.update_played_at(series, req.played_at)
        await self._session.commit()
        return series

    async def set_game_order(self, series_id: uuid.UUID, req: SetGameOrderRequest) -> list[SeriesGame]:
        """Apply the full ABSOLUTE desired game order (delta D9; spec §5.4).

        Draft-only (``_require_draft``), atomic, and idempotent by absolute
        values: the body states the complete desired final order and a retry
        with the same body converges. The desired set must equal the series'
        current games exactly (each game once, game_number a contiguous 1..N
        permutation), else 409 ``SERIES_INVALID``.
        """
        series = await self._require_draft(series_id)
        games = await self._series_repo.get_games(series_id)
        desired = {item.game_id: item.game_number for item in req.games}
        if len(desired) != len(req.games):
            raise AppError("SERIES_INVALID", 409, "duplicate game_id in desired order")
        if set(desired) != {game.id for game in games}:
            raise AppError("SERIES_INVALID", 409, "desired order must include exactly the series' games")
        if sorted(desired.values()) != list(range(1, len(games) + 1)):
            raise AppError("SERIES_INVALID", 409, "game numbers must be a contiguous 1..N permutation")
        if all(game.game_number == desired[game.id] for game in games):
            return games  # idempotent no-op
        try:
            await self._series_repo.reorder_games(series_id, desired)
            await self._recompute_and_validate(series)
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            raise
        return await self._series_repo.get_games(series_id)

    async def delete(self, series_id: uuid.UUID) -> None:
        """Hard-delete a draft series (games cascade); draft only."""
        series = await self._require_draft(series_id)
        await self._series_repo.delete_series(series)
        await self._session.commit()

    # --------------------------------------------------------------- reads

    async def get(self, series_id: uuid.UUID) -> Series:
        series = await self._series_repo.get_by_id(series_id)
        if series is None:
            raise AppError("SERIES_NOT_FOUND", 404, "series not found")
        return series

    async def list(self) -> list[Series]:
        return await self._series_repo.list_series()

    async def get_games(self, series_id: uuid.UUID) -> list[SeriesGame]:
        return await self._series_repo.get_games(series_id)

    async def get_games_by_series(self, series_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[SeriesGame]]:
        """Batch games lookup for many series (public list view enrichment)."""
        return await self._series_repo.get_games_by_series_ids(set(series_ids))

    async def get_match_map_names(self, match_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str | None]:
        """``{match_id: map_name}`` for the given matches (view enrichment)."""
        matches = await self._match_repo.get_matches_by_ids(set(match_ids))
        return {match.id: match.map_name for match in matches}

    async def get_relevant_matches(self, series_id: uuid.UUID) -> list[tuple[Match, str]]:
        """Anchor-relevant matches for ``GET /series/{id}/matches``.

        Returns ``(match, anchor_a_side)`` for every imported match where both
        of the series' anchor players appear in ``match_players`` on OPPOSING
        sides — the matches a side-deriving attach (``team_a_side`` omitted)
        would accept. A missing series raises 404 ``SERIES_NOT_FOUND``; a
        series without anchors returns an empty list.
        """
        series = await self.get(series_id)
        return await self._match_repo.get_anchor_opposing_matches(
            series.anchor_a_puuid, series.anchor_b_puuid
        )

    async def preview(self, series_id: uuid.UUID) -> SeriesPreview:
        """Recompute BO validity, map counts, and the calculated winner from the
        attached games' CURRENT canonical data — with no writes (plan Task 13;
        design §10.2–10.3).

        Every game's rounds and winner are derived from the current canonical
        imported ``Match`` row (``red_score``/``blue_score``/``is_completed``)
        through the persisted Red/Blue side mapping — never from the copied
        ``series_games`` round/winner snapshot columns, which go stale when a
        canonical match is refreshed (fix round 1). A stored winner that now
        disagrees with the derived winner is flagged invalid (stable
        ``winner team does not match round scores`` message) rather than echoed.

        ``valid`` is the derived 'ready' signal: the pure finalization gate
        ``validate_series_games`` plus the winner-vs-rounds agreement check.
        Map counts and ``calculated_winner_id`` always come from the
        authoritative ``compute_series_result``, even for invalid shapes.

        Consistency (fix round 1): series, games, and canonical matches are
        read in ONE joined query (``get_series_with_canonical_games``), so
        validation and response can never mix states under concurrent mutation.
        A read-only path: unlike the mutation gate (``_require_draft``), a
        finalized series is still previewable and nothing here ever persists,
        finalizes, overrides, or rates.
        """
        series, canonical_games = await self._series_repo.get_series_with_canonical_games(series_id)
        if series is None:
            raise AppError("SERIES_NOT_FOUND", 404, "series not found")

        errors: list[str] = []
        snapshots: list[GameSnapshot] = []
        games: list[GameView] = []
        for game in canonical_games:
            snapshot, derived_winner, game_errors = preview_snapshot(series, game)
            snapshots.append(snapshot)
            errors.extend(game_errors)
            games.append(
                GameView(
                    id=game.game_id,
                    game_number=game.game_number,
                    match_id=game.match_id,
                    map_name=game.map_name,
                    team_a_side=game.team_a_side,
                    team_b_side=game.team_b_side,
                    team_a_rounds=snapshot.team_a_rounds,
                    team_b_rounds=snapshot.team_b_rounds,
                    winner_team_id=derived_winner,
                )
            )
        errors.extend(validate_series_games(snapshots, series.format))
        errors.extend(_winner_agreement_errors(series, snapshots))

        result = compute_series_result(snapshots, series.team_a_id, series.team_b_id)
        return SeriesPreview(
            valid=not errors,
            team_a_maps_won=result.team_a_maps_won,
            team_b_maps_won=result.team_b_maps_won,
            calculated_winner_id=result.calculated_winner_id,
            games=games,
            errors=errors,
        )

    # ---------------------------------------------------- finalize input parsing

    async def resolve_finalization_policy(
        self, series_id: uuid.UUID, req: FinalizeRequest
    ) -> RatingPolicyDecision:
        """Parse finalize inputs and resolve the official winner + rating policy
        (plan Task 14; design §10.3) — no writes.

        The calculated winner derives from the attached games' CURRENT
        canonical match scores through the persisted side mappings — the same
        one-statement joined read as the Task 13 preview
        (``get_series_with_canonical_games``), so a refreshed canonical match
        is always reflected and the series/games/result can never mix states
        under a concurrent mutation. The official winner defaults to the
        calculated winner; a differing official winner must be one of the
        series' two teams (else 409 ``SERIES_INVALID``) and requires a
        non-empty override reason AND an explicit rating mode (else 409
        ``RATING_POLICY_REQUIRED``) — an ambiguous override is never silently
        defaulted.

        This method only reads; it does not gate on ``status`` or lock rows.
        Task 15's finalize transaction owns the draft gate (``FOR UPDATE`` +
        ``SERIES_ALREADY_FINALIZED``) and consumes the returned decision inside
        its lock before applying ELO or writing any event.
        """
        series, canonical_games = await self._series_repo.get_series_with_canonical_games(series_id)
        if series is None:
            raise AppError("SERIES_NOT_FOUND", 404, "series not found")
        if req.official_winner_id is not None and req.official_winner_id not in (
            series.team_a_id,
            series.team_b_id,
        ):
            raise AppError("SERIES_INVALID", 409, "official winner must be a team of the series")

        # The authoritative result over CURRENT canonical rounds (fix round 1):
        # snapshots derive each game's rounds from the canonical matches through
        # the persisted side mapping, so a refreshed canonical match flips the
        # calculated winner here too — never the stale copied round columns.
        snapshots = [preview_snapshot(series, game)[0] for game in canonical_games]
        result = compute_series_result(snapshots, series.team_a_id, series.team_b_id)
        try:
            return resolve_rating_policy(
                official_winner_id=req.official_winner_id,
                calculated_winner_id=result.calculated_winner_id,
                override_reason=req.override_reason,
                explicit_mode=req.rating_mode,
            )
        except RatingPolicyRequiredError as exc:
            raise AppError("RATING_POLICY_REQUIRED", 409, str(exc)) from exc

    # ------------------------------------------------------------ internals

    async def _derive_anchor_side(self, series: Series, match_id: uuid.UUID) -> str:
        """Derive ``team_a_side`` for an attach from the series' anchor players.

        Pinned contract: ``AttachGameRequest.team_a_side`` is optional; when
        omitted the side mapping is derived from the series anchors. The series
        must carry BOTH anchors (else 409 ``SERIES_INVALID``) and both must
        appear in the match on OPPOSING sides (else 409
        ``ANCHOR_NOT_IN_MATCH``); ``anchor_a_puuid``'s side becomes
        ``team_a_side`` and everything downstream is unchanged.
        """
        if series.anchor_a_puuid is None or series.anchor_b_puuid is None:
            raise AppError(
                "SERIES_INVALID",
                409,
                "cannot derive team_a_side: the series has no anchor players",
            )
        sides = await self._match_repo.get_anchor_player_sides(
            [match_id], series.anchor_a_puuid, series.anchor_b_puuid
        )
        match_sides = sides.get(match_id, {})
        side_a = match_sides.get(series.anchor_a_puuid)
        side_b = match_sides.get(series.anchor_b_puuid)
        if side_a is None or side_b is None or side_a == side_b:
            raise AppError(
                "ANCHOR_NOT_IN_MATCH",
                409,
                "The match does not contain both anchor players on opposing sides.",
            )
        return side_a

    async def _require_draft(self, series_id: uuid.UUID) -> Series:
        """Load and lock the series row; only drafts are mutable.

        The ``FOR UPDATE`` lock serializes concurrent mutations on the same
        series, so every later read/recompute in this transaction sees the
        post-commit state of the previous mutation.
        """
        series = await self._series_repo.get_by_id_for_update(series_id)
        if series is None:
            raise AppError("SERIES_NOT_FOUND", 404, "series not found")
        if series.status != "draft":
            raise AppError("SERIES_ALREADY_FINALIZED", 409, "series is already finalized")
        return series

    async def _recompute_and_validate(self, series: Series) -> None:
        """Validate the post-mutation draft state, then persist the derived
        result. Any validation failure raises ``SERIES_INVALID`` and the
        caller rolls the transaction back — only valid draft states persist.
        """
        snapshots = await self._series_repo.get_game_snapshots(series.id)
        errors = _mutation_errors(series, snapshots)
        if errors:
            raise AppError("SERIES_INVALID", 409, "; ".join(errors))
        result = compute_series_result(snapshots, series.team_a_id, series.team_b_id)
        await self._series_repo.update_series_result(
            series,
            team_a_maps_won=result.team_a_maps_won,
            team_b_maps_won=result.team_b_maps_won,
            calculated_winner_id=result.calculated_winner_id,
        )


# ------------------------------------------------------------- pure helpers


def _resolve_sides(team_a_side: str) -> tuple[str, str]:
    """Return ``(team_a_side, team_b_side)`` or raise the stable
    ``INVALID_SIDE_MAPPING`` (400) — never a ``KeyError``/``ValueError``."""
    try:
        return resolve_sides(team_a_side)
    except ValueError as exc:
        raise AppError("INVALID_SIDE_MAPPING", 400, "invalid side mapping") from exc


def _scores_for_sides(match: Match, team_a_side: str) -> tuple[int, int]:
    """Map the match's ``red_score``/``blue_score`` onto team A/B.

    A completed match must carry both scores; a scoreless match is rejected
    (409 ``SERIES_INVALID``) because no per-game winner can be derived from
    the round totals. Scores are never re-entered by callers.
    """
    if match.red_score is None or match.blue_score is None:
        raise AppError("SERIES_INVALID", 409, "match has no round scores")
    if team_a_side == "red":
        return match.red_score, match.blue_score
    return match.blue_score, match.red_score


def preview_snapshot(
    series: Series, game: CanonicalGameSnapshot
) -> tuple[GameSnapshot, uuid.UUID | None, list[str]]:
    """Build a validation snapshot from a game's CURRENT canonical state.

    Rounds are derived from the current canonical match scores through the
    persisted side mapping — the copied ``series_games`` round columns are
    never trusted, so a refreshed canonical match is always reflected (fix
    round 1). The snapshot's winner is the STORED value so the agreement check
    can flag a stale or corrupt stored winner; ``derived_winner`` is the
    current canonical winner shown in the response. Returns
    ``(snapshot, derived_winner, per_game_errors)``.

    Public (not underscore-prefixed) because finalization and the Task 16
    rebuild replay consume it (fix round 1: no cross-service private helper
    coupling).
    """
    errors: list[str] = []
    if game.red_score is None or game.blue_score is None:
        errors.append(f"game {game.game_number}: match has no round scores")
        team_a_rounds, team_b_rounds = 0, 0
    elif game.team_a_side == "red":
        team_a_rounds, team_b_rounds = game.red_score, game.blue_score
    else:
        team_a_rounds, team_b_rounds = game.blue_score, game.red_score
    derived_winner = _winner_from_rounds(series, team_a_rounds, team_b_rounds)
    snapshot = GameSnapshot(
        game_number=game.game_number,
        match_id=game.match_id,
        team_a_side=game.team_a_side,
        team_b_side=game.team_b_side,
        team_a_rounds=team_a_rounds,
        team_b_rounds=team_b_rounds,
        winner_team_id=game.stored_winner_team_id,
        is_completed=game.is_completed,
    )
    return snapshot, derived_winner, errors


def _winner_from_rounds(series: Series, team_a_rounds: int, team_b_rounds: int) -> uuid.UUID | None:
    """Derive the winner exclusively from the mapped round totals (fix round 1).

    ``match.winning_side`` is never consulted — the round scores are
    authoritative. A tie yields ``None`` (and is rejected by draft
    validation).
    """
    if team_a_rounds > team_b_rounds:
        return series.team_a_id
    if team_b_rounds > team_a_rounds:
        return series.team_b_id
    return None


def _expected_winner(series: Series, game: GameSnapshot) -> uuid.UUID | None:
    """The winner the persisted round totals imply, via the side mapping."""
    return _winner_from_rounds(series, game.team_a_rounds, game.team_b_rounds)


def _mutation_errors(series: Series, snapshots: list[GameSnapshot]) -> list[str]:
    """Draft-state validation errors: the pure BO rules plus the persisted
    winner-vs-rounds agreement check (fix round 1). Empty == valid."""
    errors = list(validate_draft_state(snapshots, series.format))
    errors.extend(_winner_agreement_errors(series, snapshots))
    return errors


def _winner_agreement_errors(series: Series, snapshots: list[GameSnapshot]) -> list[str]:
    """The persisted per-game winner must agree with the winner the mapped
    team-A/team-B round totals imply. Empty == consistent."""
    errors: list[str] = []
    for game in snapshots:
        expected = _expected_winner(series, game)
        if game.winner_team_id != expected:
            errors.append(f"game {game.game_number}: winner team does not match round scores")
    return errors


def _is_team_fk_violation(exc: IntegrityError) -> bool:
    constraint, raw = _constraint_name(exc)
    return constraint in {"series_team_a_id_fkey", "series_team_b_id_fkey"} or any(
        name in raw for name in ("series_team_a_id_fkey", "series_team_b_id_fkey")
    )


def _is_external_series_key_violation(exc: IntegrityError) -> bool:
    constraint, raw = _constraint_name(exc)
    return constraint == "series_external_quest_series_id_key" or "series_external_quest_series_id_key" in raw


def _is_game_number_unique_violation(exc: IntegrityError) -> bool:
    constraint, raw = _constraint_name(exc)
    return constraint == "series_games_number_key" or "series_games_number_key" in raw


def _is_match_unique_violation(exc: IntegrityError) -> bool:
    constraint, raw = _constraint_name(exc)
    return constraint == "series_games_match_key" or "series_games_match_key" in raw


def _constraint_name(exc: IntegrityError) -> tuple[str, str]:
    """Return ``(constraint_name, raw_message)`` for the integrity error.

    Asyncpg can surface the constraint name on ``orig.diag.constraint_name``,
    but through SQLAlchemy's asyncpg adapter the name is usually only present
    in the message text (``unique constraint "series_games_number_key"``), so
    callers also do a containment check against the raw message.
    """
    orig = exc.orig
    constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
    if not constraint:
        constraint = getattr(orig, "constraint_name", None)
    return str(constraint or ""), str(orig)


def to_game_view(game: SeriesGame, map_names: dict) -> GameView:
    """Map an attached game row onto the ``GameView`` response schema.

    Shared by the routes (series/game detail views) and the preview service,
    which also renders ``GameView`` game summaries from the same schema.
    """
    return GameView(
        id=game.id,
        game_number=game.game_number,
        match_id=game.match_id,
        map_name=map_names.get(game.match_id),
        team_a_side=game.team_a_side,
        team_b_side=game.team_b_side,
        team_a_rounds=game.team_a_rounds,
        team_b_rounds=game.team_b_rounds,
        winner_team_id=game.winner_team_id,
    )
