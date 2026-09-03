"""``LeaderboardService`` tests (plan task 3).

A fake repo (stub with ``list_page`` / ``get_by_discord_username`` /
``get_stats``) and fake ``LeaderboardPlayer`` rows constructed in memory (no
DB) prove the service's field-exact entry mapping — including
``peak_rank``/``peak_season`` extraction, the dual-shape ``rank_details`` read
via ``get_rank_field``, ``last_played_match`` isoformat, ``top()`` = page-1
slice, ``search()``, and the ``total_pages`` formula (0 rows -> 1).
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.db.models import LeaderboardPlayer
from app.schemas.leaderboard import LeaderboardEntry, LeaderboardPage, LeaderboardStats
from app.services.leaderboard_service import LeaderboardService

NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


def _row(**overrides: object) -> LeaderboardPlayer:
    """A minimal in-memory ``leaderboard_players`` row (no DB involved)."""
    defaults: dict[str, object] = {
        "puuid": "p1",
        "name": "Player",
        "tag": "TAG",
        "region": "ap",
        "discord_username": "player",
        "elo": 1200,
        "currenttierpatched": "Gold 1",
        "rank_details": {"ranking_in_tier": 42},
        "peak_rank": {"tier_name": "Platinum 1", "season_short": "e9a3", "tier": 24},
        "seasonal_ranks": [],
        "last_played_match": NOW,
    }
    defaults.update(overrides)
    return LeaderboardPlayer(**defaults)


class FakeLeaderboardRepo:
    """Stub repo: returns whatever rows/stats it was built with."""

    def __init__(
        self,
        rows: list[LeaderboardPlayer] | None = None,
        total: int = 0,
        stats: dict | None = None,
        search_result: LeaderboardPlayer | None = None,
    ) -> None:
        self.rows = rows or []
        self.total = total
        self.stats = stats or {}
        self.search_result = search_result

    async def list_page(self, page: int, per_page: int) -> tuple[list[LeaderboardPlayer], int]:
        start = (page - 1) * per_page
        return self.rows[start : start + per_page], self.total

    async def get_by_discord_username(self, discord_username: str) -> LeaderboardPlayer | None:
        return self.search_result

    async def get_stats(self) -> dict:
        return self.stats


def _service(repo: FakeLeaderboardRepo) -> LeaderboardService:
    return LeaderboardService(session=None, repo=repo)  # type: ignore[arg-type]


# ------------------------------------------------------------ entry mapping

async def test_leaderboard_entry_mapping_is_field_exact():
    row = _row()
    service = _service(FakeLeaderboardRepo(rows=[row], total=1))
    page = await service.leaderboard(1, 50)

    entry = page.entries[0]
    assert entry.puuid == "p1"
    assert entry.name == "Player"
    assert entry.tag == "TAG"
    assert entry.discord_username == "player"
    assert entry.current_tier == "Gold 1"
    assert entry.elo == 1200
    assert entry.rank_in_tier == 42
    assert entry.peak_rank == "Platinum 1"
    assert entry.peak_season == "e9a3"
    assert entry.last_played_match == NOW.isoformat()


async def test_rank_in_tier_reads_legacy_nested_rank_details():
    row = _row(rank_details={"data": {"ranking_in_tier": 7}})
    service = _service(FakeLeaderboardRepo(rows=[row], total=1))
    entry = (await service.leaderboard(1, 50)).entries[0]
    assert entry.rank_in_tier == 7


async def test_rank_in_tier_defaults_when_rank_details_empty():
    row = _row(rank_details={})
    service = _service(FakeLeaderboardRepo(rows=[row], total=1))
    entry = (await service.leaderboard(1, 50)).entries[0]
    assert entry.rank_in_tier is None


async def test_peak_rank_and_season_default_to_none_when_peak_rank_missing():
    row = _row(peak_rank=None)
    service = _service(FakeLeaderboardRepo(rows=[row], total=1))
    entry = (await service.leaderboard(1, 50)).entries[0]
    assert entry.peak_rank is None
    assert entry.peak_season is None


async def test_last_played_match_none_stays_none():
    row = _row(last_played_match=None)
    service = _service(FakeLeaderboardRepo(rows=[row], total=1))
    entry = (await service.leaderboard(1, 50)).entries[0]
    assert entry.last_played_match is None


async def test_paginated_page_fields():
    rows = [_row(puuid=f"p{i}", elo=1500 - i) for i in range(3)]
    service = _service(FakeLeaderboardRepo(rows=rows, total=3))
    page = await service.leaderboard(1, 2)

    assert isinstance(page, LeaderboardPage)
    assert page.page == 1
    assert page.per_page == 2
    assert page.total == 3
    assert len(page.entries) == 2


# ------------------------------------------------------------------ top

async def test_top_is_page_one_slice():
    rows = [_row(puuid=f"p{i}", elo=1500 - i) for i in range(5)]
    service = _service(FakeLeaderboardRepo(rows=rows, total=5))
    top = await service.top(3)

    assert len(top) == 3
    assert all(isinstance(e, LeaderboardEntry) for e in top)
    assert [e.puuid for e in top] == ["p0", "p1", "p2"]


# ----------------------------------------------------------------- search

async def test_search_returns_entry():
    row = _row(puuid="found", discord_username="Target")
    service = _service(FakeLeaderboardRepo(search_result=row))
    entry = await service.search("target")
    assert entry is not None
    assert entry.puuid == "found"
    assert entry.discord_username == "Target"


async def test_search_returns_none_when_no_match():
    service = _service(FakeLeaderboardRepo(search_result=None))
    assert await service.search("nope") is None


# ------------------------------------------------------------------ stats

async def test_stats_surfaces_repo_stats_with_float_average():
    repo_stats = {
        "total_users": 10,
        "highest_elo": 1800,
        "lowest_elo": 300,
        "average_elo": 1050.5,
        "rank_distribution": {"Gold 1": 6, "Silver 2": 4},
    }
    service = _service(FakeLeaderboardRepo(stats=repo_stats))
    stats = await service.stats()

    assert isinstance(stats, LeaderboardStats)
    assert stats.total_users == 10
    assert stats.highest_elo == 1800
    assert stats.lowest_elo == 300
    assert stats.average_elo == 1050.5
    assert isinstance(stats.average_elo, float)
    assert stats.rank_distribution == {"Gold 1": 6, "Silver 2": 4}


# ------------------------------------------------------------ total_pages formula

async def test_total_pages_zero_rows_is_one():
    service = _service(FakeLeaderboardRepo(rows=[], total=0))
    page = await service.leaderboard(1, 50)
    assert page.total_pages == 1


async def test_total_pages_small_total_is_one():
    service = _service(FakeLeaderboardRepo(rows=[], total=5))
    page = await service.leaderboard(1, 50)
    assert page.total_pages == 1


async def test_total_pages_exact_multiple():
    service = _service(FakeLeaderboardRepo(rows=[], total=100))
    page = await service.leaderboard(1, 50)
    assert page.total_pages == 2


async def test_total_pages_rounds_up():
    service = _service(FakeLeaderboardRepo(rows=[], total=51))
    page = await service.leaderboard(1, 50)
    assert page.total_pages == 2


async def test_total_pages_larger_total():
    service = _service(FakeLeaderboardRepo(rows=[], total=151))
    page = await service.leaderboard(1, 50)
    assert page.total_pages == 4
