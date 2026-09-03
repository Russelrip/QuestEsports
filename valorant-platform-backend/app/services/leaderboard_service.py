"""Leaderboard read service (SDD 2026-08-14 leaderboard standardization, task 3).

Pure read paths over ``leaderboard_players`` (plan task 3; spec §4): the
paginated leaderboard, the top-N slice, the case-insensitive discord-username
search, and the aggregate stats. The Sri Lankan filter lives in the repository
(``LeaderboardPlayerRepository.list_page``), which the service never
duplicates; the 404 for an out-of-range page is raised by the router, not here.
The per-row entry mapping mirrors ``valorantsl-new`` ``database.py:164-185``
exactly (field-for-field, including ``peak_rank``/``peak_season`` extraction
and the dual-shape ``rank_details`` read).
"""

from __future__ import annotations

import math

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LeaderboardPlayer
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.schemas.leaderboard import LeaderboardEntry, LeaderboardPage, LeaderboardStats
from app.services.rank_field import get_rank_field


class LeaderboardService:
    def __init__(self, session: AsyncSession, repo: LeaderboardPlayerRepository) -> None:
        self._session = session
        self._repo = repo

    async def leaderboard(self, page: int, per_page: int) -> LeaderboardPage:
        """One paginated page of leaderboard entries, newest-filtered and
        ``elo DESC`` (the repository owns the query)."""
        rows, total = await self._repo.list_page(page, per_page)
        entries = [self._to_entry(player) for player in rows]
        # valorantsl-new parity: an empty result still reports exactly 1 page.
        total_pages = math.ceil(total / per_page) if total > 0 else 1
        return LeaderboardPage(
            entries=entries,
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )

    async def top(self, count: int) -> list[LeaderboardEntry]:
        """The top ``count`` players: page-1 slice of the leaderboard."""
        return (await self.leaderboard(1, count)).entries

    async def search(self, discord_username: str) -> LeaderboardEntry | None:
        """Case-insensitive exact ``discord_username`` match, or ``None``."""
        player = await self._repo.get_by_discord_username(discord_username)
        if player is None:
            return None
        return self._to_entry(player)

    async def stats(self) -> LeaderboardStats:
        """Aggregate stats; ``average_elo`` is surfaced as a ``float``."""
        stats = await self._repo.get_stats()
        return LeaderboardStats(
            total_users=stats["total_users"],
            highest_elo=stats["highest_elo"],
            lowest_elo=stats["lowest_elo"],
            average_elo=float(stats["average_elo"]),
            rank_distribution=stats["rank_distribution"],
        )

    # ------------------------------------------------------------ internals

    @staticmethod
    def _to_entry(player: LeaderboardPlayer) -> LeaderboardEntry:
        """Field-exact port of ``valorantsl-new`` ``database.py:164-185``."""
        peak_rank = player.peak_rank or {}
        return LeaderboardEntry(
            puuid=player.puuid,
            name=player.name,
            tag=player.tag,
            discord_username=player.discord_username,
            current_tier=player.currenttierpatched,
            elo=player.elo,
            rank_in_tier=get_rank_field(player.rank_details, "ranking_in_tier"),
            peak_rank=peak_rank.get("tier_name"),
            peak_season=peak_rank.get("season_short"),
            last_played_match=player.last_played_match.isoformat()
            if player.last_played_match
            else None,
        )
