"""Leaderboard server check schemas (0018).

Admin-only: the servers a registered player recently played competitive on, and
whether that makes them worth reviewing. ``since`` is where the evidence starts,
the window start or the clearance, whichever is later.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ServerMatchCount(BaseModel):
    cluster: str | None = None
    matches: int
    # None for a match whose server Henrik did not report.
    home: bool | None = None


class LeaderboardServerCheckEntry(BaseModel):
    puuid: str
    name: str
    tag: str
    discord_username: str
    current_tier: str | None = None
    elo: int | None = None
    last_played_match: str | None = None
    on_leaderboard: bool
    account_region: str
    status: Literal["flagged", "cleared", "clear", "not_enough_matches", "not_checked"]
    reasons: list[Literal["account_region", "away_servers"]]
    matches: int
    known_matches: int
    away_matches: int
    away_share: float | None = None
    servers: list[ServerMatchCount]
    since: str
    checked_at: str | None = None
    cleared_at: str | None = None
    cleared_by: str | None = None


class ServerCheckSummary(BaseModel):
    registered: int
    checked: int
    flagged: int
    cleared: int


class ServerCheckRule(BaseModel):
    """The rule in force, so the admin page can explain a flag without restating it."""

    home_clusters: list[str]
    home_shard: str
    window_days: int
    min_matches: int
    away_share: float


class LeaderboardServerCheckPage(BaseModel):
    entries: list[LeaderboardServerCheckEntry]
    total: int
    page: int
    per_page: int
    total_pages: int
    summary: ServerCheckSummary
    rule: ServerCheckRule
