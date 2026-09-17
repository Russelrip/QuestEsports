"""Leaderboard API schemas (SDD 2026-08-14 leaderboard standardization, task 2).

``LeaderboardEntry`` is one player row of the leaderboard; ``LeaderboardPage``
is a paginated slice of entries; ``LeaderboardStats`` is the aggregate
summary. Field names are snake_case and mirror ``valorantsl-new`` exactly so
Quest's Phase-1 client mapping is unchanged.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


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


class LeaderboardRegistration(BaseModel):
    """One ``leaderboard_players`` row as an admin sees it.

    Covers every registration, including the ones the public board filters
    out; ``on_leaderboard`` says which side of that filter the row is on.
    """

    puuid: str
    name: str
    tag: str
    discord_username: str
    current_tier: str | None = None
    elo: int | None = None
    last_played_match: str | None = None
    update_source: str | None = None
    updated_at: str
    on_leaderboard: bool


class LeaderboardRegistrationPage(BaseModel):
    """A paginated page of registrations for the admin view."""

    entries: list[LeaderboardRegistration]
    total: int
    page: int
    per_page: int
    total_pages: int


class LeaderboardRemovedRegistration(LeaderboardRegistration):
    """The registration as it was when removed, and the removal that can restore it."""

    removal_id: str


class LeaderboardRestoredRegistration(LeaderboardRegistration):
    """The registration as put back, and the removal it undid."""

    removal_id: str
    removed_at: str
    removed_by: str | None = None


class LeaderboardRemoval(BaseModel):
    """One removed registration as an admin sees it (0017).

    ``restorable`` is the summary: not yet restored, the PUUID is not
    registered again (``registered_again``), no later removal of the same
    PUUID exists (``superseded``), and no active ban names the player
    (``banned``, 0019). A Discord identity taken by someone else is
    only found out on restore.
    """

    removal_id: str
    puuid: str
    name: str
    tag: str
    discord_username: str
    current_tier: str | None = None
    elo: int | None = None
    last_played_match: str | None = None
    removed_at: str
    removed_by: str | None = None
    restored_at: str | None = None
    restored_by: str | None = None
    registered_again: bool
    superseded: bool
    banned: bool = False
    restorable: bool


class LeaderboardRemovalPage(BaseModel):
    """A paginated page of removals, newest first."""

    entries: list[LeaderboardRemoval]
    total: int
    page: int
    per_page: int
    total_pages: int


class LeaderboardBanRequest(BaseModel):
    """Why a player is being banned; kept on the ban for the admin list."""

    reason: str = Field("", max_length=500)


class LeaderboardBan(BaseModel):
    """One ban as an admin sees it (0019).

    ``name``, ``tag`` and ``discord_username`` are the player as they were when
    banned. The Discord id itself is not returned; ``discord_banned`` says
    whether the ban covers one.
    """

    ban_id: str
    puuid: str | None = None
    discord_banned: bool
    name: str
    tag: str
    discord_username: str
    reason: str | None = None
    banned_at: str
    banned_by: str | None = None
    lifted_at: str | None = None
    lifted_by: str | None = None
    active: bool


class LeaderboardBanPage(BaseModel):
    """A paginated page of bans, newest first."""

    entries: list[LeaderboardBan]
    total: int
    page: int
    per_page: int
    total_pages: int


class LeaderboardBanResult(BaseModel):
    """A new ban, and every registration it took off the leaderboard."""

    ban: LeaderboardBan
    removed: list[LeaderboardRemovedRegistration]
