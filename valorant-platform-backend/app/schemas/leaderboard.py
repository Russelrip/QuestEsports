"""Leaderboard API schemas (SDD 2026-08-14 leaderboard standardization, task 2).

``LeaderboardEntry`` is one player row of the leaderboard; ``LeaderboardPage``
is a paginated slice of entries; ``LeaderboardStats`` is the aggregate
summary. Field names are snake_case and mirror ``valorantsl-new`` exactly so
Quest's Phase-1 client mapping is unchanged.
"""

from __future__ import annotations

from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    """One player on the leaderboard.

    Identity fields (``puuid``, ``name``, ``tag``, ``discord_username``) are
    required; rating and activity fields default to ``None`` when absent.
    """

    puuid: str
    name: str
    tag: str
    discord_username: str
    current_tier: str | None = None
    elo: int | None = None
    rank_in_tier: int | None = None
    peak_rank: str | None = None
    peak_season: str | None = None
    last_played_match: str | None = None


class LeaderboardPage(BaseModel):
    """A paginated page of leaderboard entries."""

    entries: list[LeaderboardEntry]
    total: int
    page: int
    per_page: int
    total_pages: int


class LeaderboardStats(BaseModel):
    """Aggregate statistics across the whole leaderboard."""

    total_users: int
    highest_elo: int
    lowest_elo: int
    average_elo: float
    rank_distribution: dict[str, int]
