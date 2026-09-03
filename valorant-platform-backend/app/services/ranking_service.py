"""Rankings read service (plan Task 16; API surface §11.4, design §13.4).

Pure read paths over the CURRENT versioned run (max ``run_number``):

- ``rankings()``: active teams sorted ``current_elo DESC`` with the 1-based
  rank (ties broken by name, then id — deterministic);
- ``team_rating_history()``: a team's immutable events under the current run —
  the events that explain its current rating (earlier runs stay intact for
  audit but are not part of the active standings, ADR-007);
- ``team_series()``: the series a team played in (either side), newest first,
  enriched with games + map names.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.db.repositories.team_repository import TeamRepository
from app.schemas.rankings import RankingEntry
from app.schemas.series import RatingEventResponse, SeriesView
from app.services.rating_service import to_event_response
from app.services.series_service import to_game_view


class RankingService:
    def __init__(
        self,
        session: AsyncSession,
        rating_repo: RatingRepository,
        series_repo: SeriesRepository,
        match_repo: MatchRepository,
        team_repo: TeamRepository,
    ) -> None:
        self._session = session
        self._rating_repo = rating_repo
        self._series_repo = series_repo
        self._match_repo = match_repo
        self._team_repo = team_repo

    async def rankings(self) -> list[RankingEntry]:
        """Current standings: ``current_elo DESC``, rank = 1-based position."""
        teams = await self._team_repo.list_teams_ranked()
        return [
            RankingEntry(
                rank=index,
                team_id=team.id,
                name=team.name,
                short_name=team.short_name,
                current_elo=team.current_elo,
                peak_elo=team.peak_elo,
                series_wins=team.series_wins,
                series_losses=team.series_losses,
                matches_played=team.matches_played,
            )
            for index, team in enumerate(teams, start=1)
        ]

    async def team_rating_history(self, team_id: uuid.UUID) -> list[RatingEventResponse]:
        """A team's immutable events under the CURRENT run, in REPLAY
        chronology (the owning series' ``(played_at, created_at, id)`` order,
        not the insert order — fix round 1: a rebuild inserts every event with
        the same ``created_at`` and a random ``id``).

        The event chain replays to the team's ``current_elo`` (verified by the
        integration tests). A missing team is 404 ``TEAM_NOT_FOUND``.
        """
        await self._require_team(team_id)
        run = await self._rating_repo.get_current_run()
        if run is None:
            # No seeded rating run (deployment/setup error): no events to read.
            return []
        events = await self._rating_repo.get_events_for_team_in_run(team_id, run.id)
        return [to_event_response(event) for event in events]

    async def team_series(self, team_id: uuid.UUID) -> list[SeriesView]:
        """The series a team played in (either side), newest first, enriched
        with the attached games and their map names (3 queries for any N)."""
        await self._require_team(team_id)
        series_list = await self._series_repo.get_series_for_team(team_id)
        if not series_list:
            return []
        games_by_series = await self._series_repo.get_games_by_series_ids(
            {series.id for series in series_list}
        )
        match_ids = {game.match_id for games in games_by_series.values() for game in games}
        matches = await self._match_repo.get_matches_by_ids(match_ids)
        map_names = {match.id: match.map_name for match in matches}

        views: list[SeriesView] = []
        for series in series_list:
            games = games_by_series.get(series.id, [])
            views.append(
                SeriesView(
                    id=series.id,
                    team_a_id=series.team_a_id,
                    team_b_id=series.team_b_id,
                    format=series.format,
                    importance=series.importance,
                    status=series.status,
                    calculated_winner_id=series.calculated_winner_id,
                    official_winner_id=series.official_winner_id,
                    winner_override_reason=series.winner_override_reason,
                    team_a_maps_won=series.team_a_maps_won,
                    team_b_maps_won=series.team_b_maps_won,
                    played_at=series.played_at,
                    finalized_at=series.finalized_at,
                    rating_mode=series.rating_mode,
                    notes=series.notes,
                    games=[to_game_view(game, map_names) for game in games],
                )
            )
        return views

    # ------------------------------------------------------------ internals

    async def _require_team(self, team_id: uuid.UUID) -> None:
        if await self._team_repo.get_by_id(team_id) is None:
            raise AppError("TEAM_NOT_FOUND", 404, "team not found")
