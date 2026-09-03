"""``series`` / ``series_games`` data access (plan Task 12; design §9.2, §10.3).

``SeriesRepository`` is the only code that issues ``series`` /
``series_games`` SQL. Writes are never committed here — the series service owns
the transaction boundaries. Mutations read the owning series row with
``SELECT ... FOR UPDATE`` (``get_by_id_for_update``) so concurrent attach/
remove/reorder serialize and recomputes never lose updates. The
``series_games_winner_check`` trigger (DB-side) guards winner ownership; the
derived map counts and ``calculated_winner_id`` are refreshed onto the owning
series row after every mutation.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Match, Series, SeriesGame
from app.domain.series.bo import CanonicalGameSnapshot, GameSnapshot


class SeriesRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------- reads

    async def get_by_id(self, series_id: uuid.UUID) -> Series | None:
        return await self._session.get(Series, series_id)

    async def get_by_external_quest_series_id(self, external_quest_series_id: str) -> Series | None:
        """The series converged on the Quest external key (delta D3)."""
        result = await self._session.execute(
            select(Series).where(Series.external_quest_series_id == external_quest_series_id)
        )
        return result.scalar_one_or_none()

    async def get_by_id_for_update(self, series_id: uuid.UUID) -> Series | None:
        """Lock the series row for the current transaction (fix round 1).

        Every draft mutation acquires this lock before reading/recomputing its
        games, so concurrent mutations serialize and the recomputed result is
        always derived from the post-commit state — no lost updates.
        """
        result = await self._session.execute(select(Series).where(Series.id == series_id).with_for_update())
        return result.scalar_one_or_none()

    async def list_series(self) -> list[Series]:
        """Return all series in deterministic ``created_at DESC, id DESC`` order."""
        result = await self._session.execute(
            select(Series).order_by(Series.created_at.desc(), Series.id.desc())
        )
        return list(result.scalars())

    async def get_series_for_team(self, team_id: uuid.UUID) -> list[Series]:
        """The series a team played in (either side), newest first.

        Deterministic order for the Task 16 ``teams/{id}/series`` read:
        ``played_at DESC NULLS LAST, created_at DESC, id DESC`` — drafts
        (no ``played_at``) sort last, newest first.
        """
        result = await self._session.execute(
            select(Series)
            .where((Series.team_a_id == team_id) | (Series.team_b_id == team_id))
            .order_by(
                Series.played_at.desc().nulls_last(),
                Series.created_at.desc(),
                Series.id.desc(),
            )
        )
        return list(result.scalars())

    async def lock_all_series_for_update(self) -> list[Series]:
        """Lock EVERY series row ``FOR UPDATE`` in ascending id order.

        The shared concurrency lock between rebuild and finalization (plan Task
        16; design §13.4): both take exclusive locks on the series rows, so a
        rebuild and a concurrent finalize can never interleave — a finalize
        either commits before the rebuild starts replaying (and is included in
        the replay) or waits until the new run is active. Locking all rows (not
        just eligible ones) is what blocks a concurrent finalize of a still-
        draft series; the ascending-id acquisition matches finalize's
        single-row lock, so no deadlock is possible.
        """
        result = await self._session.execute(select(Series).order_by(Series.id.asc()).with_for_update())
        return list(result.scalars())

    async def get_finalized_series_for_rebuild(self) -> list[Series]:
        """Eligible finalized series in the deterministic rebuild order.

        ``(played_at, created_at, id)`` — chronological with stable tie-breakers
        (plan Task 16; design §13.4). ``played_at IS NOT NULL`` is guaranteed by
        the rebuild's pre-scan (a null value cannot be ordered deterministically
        and is rejected with 422 ``SERIES_INVALID``).
        """
        result = await self._session.execute(
            select(Series)
            .where(Series.status == "finalized", Series.played_at.is_not(None))
            .order_by(Series.played_at, Series.created_at, Series.id)
        )
        return list(result.scalars())

    async def get_latest_finalized_rated_played_at(self, rated_modes) -> datetime | None:
        """The newest ``played_at`` among finalized RATED series (delta D8).

        ``rated_modes`` is supplied by the caller (the canonical policy set
        ``_RATE_SERIES_MODES``); only those modes count — unrated and forfeit
        finalization never affect the chronological boundary.
        """
        result = await self._session.execute(
            select(func.max(Series.played_at)).where(
                Series.status == "finalized",
                Series.rating_mode.in_(rated_modes),
            )
        )
        return result.scalar_one_or_none()

    async def get_games(self, series_id: uuid.UUID) -> list[SeriesGame]:
        """Return a series' games ordered by ``game_number``."""
        result = await self._session.execute(
            select(SeriesGame).where(SeriesGame.series_id == series_id).order_by(SeriesGame.game_number)
        )
        return list(result.scalars())

    async def get_games_by_series_ids(self, series_ids: set[uuid.UUID]) -> dict[uuid.UUID, list[SeriesGame]]:
        """Batch games lookup for many series (the public list route), grouped
        by series and ordered by ``game_number`` — one query for any N."""
        if not series_ids:
            return {}
        result = await self._session.execute(
            select(SeriesGame).where(SeriesGame.series_id.in_(series_ids)).order_by(SeriesGame.game_number)
        )
        grouped: dict[uuid.UUID, list[SeriesGame]] = {}
        for game in result.scalars():
            grouped.setdefault(game.series_id, []).append(game)
        return grouped

    async def get_game_by_id(self, game_id: uuid.UUID) -> SeriesGame | None:
        return await self._session.get(SeriesGame, game_id)

    async def find_game_by_match_id(self, match_id: uuid.UUID) -> SeriesGame | None:
        """The game attached to ``match_id`` across all series (unique match)."""
        result = await self._session.execute(select(SeriesGame).where(SeriesGame.match_id == match_id))
        return result.scalar_one_or_none()

    async def find_game_by_number(self, series_id: uuid.UUID, game_number: int) -> SeriesGame | None:
        """The game currently occupying ``game_number`` in a series (reorder)."""
        result = await self._session.execute(
            select(SeriesGame).where(SeriesGame.series_id == series_id, SeriesGame.game_number == game_number)
        )
        return result.scalar_one_or_none()

    async def get_game_snapshots(self, series_id: uuid.UUID) -> list[GameSnapshot]:
        """Pure-domain snapshots (joining ``matches.is_completed``) for the
        best-of/result functions."""
        result = await self._session.execute(
            select(SeriesGame, Match.is_completed)
            .join(Match, SeriesGame.match_id == Match.id)
            .where(SeriesGame.series_id == series_id)
            .order_by(SeriesGame.game_number)
        )
        return [
            GameSnapshot(
                game_number=game.game_number,
                match_id=game.match_id,
                team_a_side=game.team_a_side,
                team_b_side=game.team_b_side,
                team_a_rounds=game.team_a_rounds,
                team_b_rounds=game.team_b_rounds,
                winner_team_id=game.winner_team_id,
                is_completed=is_completed,
            )
            for game, is_completed in result
        ]

    async def get_series_with_canonical_games(
        self, series_id: uuid.UUID
    ) -> tuple[Series | None, list[CanonicalGameSnapshot]]:
        """One-statement read of a series with its attached games' CURRENT
        canonical match state (fix round 1).

        A single joined SELECT snapshots the series, its games, and the matches
        in one consistent read, so the preview endpoint's validation and
        response can never mix states under concurrent mutation. The canonical
        ``matches.red_score``/``blue_score``/``is_completed``/``map_name`` are
        read here (not the copied ``series_games`` round/winner snapshot
        columns): the service derives each game's rounds and winner from them
        through the persisted side mapping, so a refreshed canonical match is
        always reflected. ``stored_winner_team_id`` is carried so the preview
        can flag a stored winner that disagrees with the current derivation.

        LEFT JOINs yield one row with NULL game columns for a series with no
        games. Returns ``(None, [])`` when the series does not exist.
        """
        result = await self._session.execute(
            select(Series, SeriesGame, Match)
            .outerjoin(SeriesGame, SeriesGame.series_id == Series.id)
            .outerjoin(Match, Match.id == SeriesGame.match_id)
            .where(Series.id == series_id)
            .order_by(SeriesGame.game_number)
        )
        rows = result.all()
        if not rows or rows[0][0] is None:
            return None, []
        series = rows[0][0]
        snapshots: list[CanonicalGameSnapshot] = []
        for _, game, match in rows:
            if game is None or match is None:
                continue
            snapshots.append(
                CanonicalGameSnapshot(
                    game_id=game.id,
                    game_number=game.game_number,
                    match_id=game.match_id,
                    map_name=match.map_name,
                    team_a_side=game.team_a_side,
                    team_b_side=game.team_b_side,
                    stored_winner_team_id=game.winner_team_id,
                    red_score=match.red_score,
                    blue_score=match.blue_score,
                    is_completed=match.is_completed,
                )
            )
        return series, snapshots

    # ------------------------------------------------------------- writes

    async def create_series(
        self,
        *,
        team_a_id: uuid.UUID,
        team_b_id: uuid.UUID,
        format: str,
        importance: str,
        played_at: datetime | None,
        notes: str | None,
        external_quest_series_id: str | None,
        anchor_a_puuid: str | None,
        anchor_b_puuid: str | None,
    ) -> Series:
        """Persist a draft series; server defaults (``id``, ``status``, map
        counts, timestamps) are fetched via RETURNING on flush. The anchor
        PUUIDs (D6) are resolved by the service and persist with the create."""
        series = Series(
            team_a_id=team_a_id,
            team_b_id=team_b_id,
            format=format,
            importance=importance,
            played_at=played_at,
            notes=notes,
            external_quest_series_id=external_quest_series_id,
            anchor_a_puuid=anchor_a_puuid,
            anchor_b_puuid=anchor_b_puuid,
        )
        self._session.add(series)
        await self._session.flush()
        return series

    async def create_manual_series(
        self,
        *,
        team_a_id: uuid.UUID,
        team_b_id: uuid.UUID,
        format: str,
        importance: str,
        played_at: datetime,
        external_quest_series_id: str | None,
        manual_winner_team_id: uuid.UUID,
        manual_team_a_maps: int,
        manual_team_b_maps: int,
    ) -> Series:
        """Persist a manual-result series row (offline/historical results).

        Unlike ``create_series`` this row has no anchors and no attached games;
        the recorded winner/map counts are stored directly and the caller
        finalizes it in the same transaction. Server defaults (``id``,
        timestamps) are fetched via RETURNING on flush.
        """
        series = Series(
            team_a_id=team_a_id,
            team_b_id=team_b_id,
            format=format,
            importance=importance,
            played_at=played_at,
            external_quest_series_id=external_quest_series_id,
            manual_winner_team_id=manual_winner_team_id,
            manual_team_a_maps=manual_team_a_maps,
            manual_team_b_maps=manual_team_b_maps,
        )
        self._session.add(series)
        await self._session.flush()
        return series

    async def delete_series(self, series: Series) -> None:
        """Hard-delete a draft series (games cascade via the FK)."""
        await self._session.delete(series)

    async def insert_game(
        self,
        *,
        series_id: uuid.UUID,
        game_number: int,
        match_id: uuid.UUID,
        team_a_side: str,
        team_b_side: str,
        team_a_rounds: int,
        team_b_rounds: int,
        winner_team_id: uuid.UUID | None,
    ) -> SeriesGame:
        """Persist an attached game; rounds/winner are always derived by the
        service from the imported match — never entered by the client."""
        game = SeriesGame(
            series_id=series_id,
            game_number=game_number,
            match_id=match_id,
            team_a_side=team_a_side,
            team_b_side=team_b_side,
            team_a_rounds=team_a_rounds,
            team_b_rounds=team_b_rounds,
            winner_team_id=winner_team_id,
        )
        self._session.add(game)
        await self._session.flush()
        return game

    async def delete_game(self, game: SeriesGame) -> None:
        await self._session.delete(game)

    async def update_game(self, game: SeriesGame, **values: object) -> SeriesGame:
        """Apply field changes to a loaded game row and flush."""
        for key, value in values.items():
            setattr(game, key, value)
        await self._session.flush()
        return game

    async def swap_game_numbers(self, game: SeriesGame, other: SeriesGame) -> None:
        """Atomically exchange two games' numbers (fix round 1).

        The ``series_games_number_key`` unique constraint is non-deferrable and
        checked per-row, so even a single multi-row ``UPDATE ... CASE`` swap
        trips a transient duplicate. Instead the exchange resequences through a
        temporary number that no game in the series uses (``max + 1`` — a valid
        draft's numbers are contiguous, so this is always free), then moves each
        game into the other's now-freed number. Three single-row statements,
        all inside the caller's ``SELECT ... FOR UPDATE`` transaction: either
        all apply or the transaction rolls back — the caller never sees a
        transient unique violation.
        """
        game_number_a, game_number_b = game.game_number, other.game_number
        used = {candidate.game_number for candidate in await self.get_games(game.series_id)}
        temp = max(used) + 1
        await self._session.execute(
            update(SeriesGame).where(SeriesGame.id == game.id).values(game_number=temp)
        )
        await self._session.execute(
            update(SeriesGame).where(SeriesGame.id == other.id).values(game_number=game_number_a)
        )
        await self._session.execute(
            update(SeriesGame).where(SeriesGame.id == game.id).values(game_number=game_number_b)
        )
        # Keep the loaded ORM instances in sync with the statements above.
        game.game_number, other.game_number = game_number_b, game_number_a

    async def reorder_games(self, series_id: uuid.UUID, desired: dict[uuid.UUID, int]) -> None:
        """Reapply the ABSOLUTE game order inside the series-locked transaction.

        Two-phase renumber (all numbers shifted up by N, then each game to its
        target) so the ``series_games_number_key`` unique constraint is never
        transiently violated. The caller holds the series ``FOR UPDATE`` lock.
        """
        games = await self.get_games(series_id)
        n = len(games)
        for game in games:
            game.game_number += n
        await self._session.flush()
        for game in games:
            game.game_number = desired[game.id]
        await self._session.flush()

    async def update_series_result(
        self,
        series: Series,
        *,
        team_a_maps_won: int,
        team_b_maps_won: int,
        calculated_winner_id: uuid.UUID | None,
    ) -> Series:
        """Refresh the derived result columns from ``compute_series_result``."""
        series.team_a_maps_won = team_a_maps_won
        series.team_b_maps_won = team_b_maps_won
        series.calculated_winner_id = calculated_winner_id
        await self._session.flush()
        return series

    async def update_played_at(self, series: Series, played_at: datetime) -> Series:
        """Apply a new ``played_at`` to a loaded (locked) draft series row.

        The caller (series service) holds the ``FOR UPDATE`` lock and has
        already checked ``status == "draft"``; only ``played_at`` changes.
        """
        series.played_at = played_at
        await self._session.flush()
        return series
