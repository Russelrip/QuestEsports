"""``LeaderboardService`` tests (plan task 3).

A fake repo (stub with ``list_page`` / ``get_by_discord_username`` /
``get_stats``) and fake ``LeaderboardPlayer`` rows constructed in memory (no
DB) prove the service's field-exact entry mapping — including
``peak_rank``/``peak_season`` extraction, the dual-shape ``rank_details`` read
via ``get_rank_field``, ``last_played_match`` isoformat, ``top()`` = page-1
slice, ``search()``, and the ``total_pages`` formula (0 rows -> 1).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.api.errors import AppError
from app.db.models import LeaderboardPlayer, LeaderboardPlayerRemoval
from app.db.models.leaderboard_player_removal import REGISTRATION_COLUMNS
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


# ------------------------------------------------------------ admin surface

class FakeAdminRepo:
    """Stub repo for the admin paths: a registration listing and a removal."""

    def __init__(self, rows: list[LeaderboardPlayer] | None = None, total: int = 0) -> None:
        self.rows = rows or []
        self.total = total
        self.removed: list[tuple[str, str | None]] = []

    async def list_registrations(
        self, query: str, page: int, per_page: int, *, hidden_only: bool = False
    ) -> tuple[list[LeaderboardPlayer], int]:
        return self.rows, self.total

    async def get_by_puuid(self, puuid: str) -> LeaderboardPlayer | None:
        return next((row for row in self.rows if row.puuid == puuid), None)

    async def set_hidden(self, puuid: str, *, hidden_by: str | None, reason: str | None) -> LeaderboardPlayer | None:
        row = await self.get_by_puuid(puuid)
        if row is None or row.hidden_at is not None:
            return None
        row.hidden_at, row.hidden_by, row.hidden_reason = NOW, hidden_by, reason
        return row

    async def clear_hidden(self, puuid: str) -> LeaderboardPlayer | None:
        row = await self.get_by_puuid(puuid)
        if row is None or row.hidden_at is None:
            return None
        row.hidden_at, row.hidden_by, row.hidden_reason = None, None, None
        return row

    async def remove(self, puuid: str, *, removed_by: str | None) -> LeaderboardPlayerRemoval | None:
        self.removed.append((puuid, removed_by))
        row = next((row for row in self.rows if row.puuid == puuid), None)
        if row is None:
            return None
        return LeaderboardPlayerRemoval(
            id=uuid.UUID(int=7),
            **{column: getattr(row, column) for column in REGISTRATION_COLUMNS},
            removed_at=NOW,
            removed_by=removed_by,
        )


class FakeSession:
    def __init__(self) -> None:
        self.commits = 0
        self.rolled_back = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rolled_back += 1


async def test_registrations_flag_rows_the_public_board_hides() -> None:
    recent = datetime.now(UTC)
    rows = [
        _row(puuid="listed", last_played_match=recent, updated_at=recent),
        # The row the updater cannot refresh: migrated rank, never a match date.
        _row(puuid="stale", last_played_match=None, updated_at=recent),
        _row(puuid="unrated", currenttierpatched="Unrated", last_played_match=recent, updated_at=recent),
        _row(puuid="hidden", last_played_match=recent, updated_at=recent, hidden_at=recent, hidden_reason="smurf"),
    ]
    page = await _service(FakeAdminRepo(rows=rows, total=4)).registrations("", 1, 50)  # type: ignore[arg-type]

    assert [(entry.puuid, entry.on_leaderboard) for entry in page.entries] == [
        ("listed", True),
        ("stale", False),
        ("unrated", False),
        ("hidden", False),
    ]
    assert page.entries[3].hidden_reason == "smurf"
    assert page.entries[0].hidden_at is None
    assert page.total_pages == 1


async def test_hide_records_the_admin_and_reason_and_unhide_clears_them() -> None:
    row = _row(puuid="p1", last_played_match=datetime.now(UTC), updated_at=NOW)
    session = FakeSession()
    service = LeaderboardService(session=session, repo=FakeAdminRepo(rows=[row]))  # type: ignore[arg-type]

    hidden = await service.hide("p1", "  smurf account  ", "admin-user-id")
    assert (hidden.on_leaderboard, hidden.hidden_by, hidden.hidden_reason) == (False, "admin-user-id", "smurf account")
    assert hidden.hidden_at == NOW.isoformat()

    shown = await service.unhide("p1")
    assert (shown.on_leaderboard, shown.hidden_at, shown.hidden_by, shown.hidden_reason) == (True, None, None, None)
    assert session.commits == 2


async def test_hide_refuses_a_hidden_player_and_unhide_a_visible_one() -> None:
    rows = [_row(puuid="shown", updated_at=NOW), _row(puuid="hidden", updated_at=NOW, hidden_at=NOW)]
    service = LeaderboardService(session=FakeSession(), repo=FakeAdminRepo(rows=rows))  # type: ignore[arg-type]

    with pytest.raises(AppError) as again:
        await service.hide("hidden", "", None)
    with pytest.raises(AppError) as not_hidden:
        await service.unhide("shown")
    with pytest.raises(AppError) as missing:
        await service.hide("nobody", "", None)

    assert (again.value.code, again.value.status) == ("LEADERBOARD_PLAYER_ALREADY_HIDDEN", 409)
    assert (not_hidden.value.code, not_hidden.value.status) == ("LEADERBOARD_PLAYER_NOT_HIDDEN", 409)
    assert (missing.value.code, missing.value.status) == ("LEADERBOARD_PLAYER_NOT_FOUND", 404)


class _RacingRepo(FakeAdminRepo):
    """The row looks one way to the service's read and another to its update."""

    def __init__(self, read: LeaderboardPlayer, now: LeaderboardPlayer | None) -> None:
        super().__init__([read])
        self._reads = [read, now]

    async def get_by_puuid(self, puuid: str) -> LeaderboardPlayer | None:
        return self._reads.pop(0) if len(self._reads) > 1 else self._reads[0]

    async def set_hidden(self, puuid: str, *, hidden_by: str | None, reason: str | None) -> LeaderboardPlayer | None:
        return None

    async def clear_hidden(self, puuid: str) -> LeaderboardPlayer | None:
        return None


@pytest.mark.parametrize(
    ("action", "read", "now", "expected"),
    [
        # Another admin hid them first: their reason stands, this one gets a 409.
        ("hide", {}, {"hidden_at": NOW, "hidden_reason": "first"}, ("LEADERBOARD_PLAYER_ALREADY_HIDDEN", 409)),
        ("unhide", {"hidden_at": NOW}, {}, ("LEADERBOARD_PLAYER_NOT_HIDDEN", 409)),
        # Removed in between.
        ("hide", {}, None, ("LEADERBOARD_PLAYER_NOT_FOUND", 404)),
        ("unhide", {"hidden_at": NOW}, None, ("LEADERBOARD_PLAYER_NOT_FOUND", 404)),
    ],
)
async def test_hide_and_unhide_lose_a_race_cleanly(action, read, now, expected) -> None:
    repo = _RacingRepo(_row(puuid="p1", **read), None if now is None else _row(puuid="p1", **now))
    session = FakeSession()
    service = LeaderboardService(session=session, repo=repo)  # type: ignore[arg-type]

    with pytest.raises(AppError) as lost:
        if action == "hide":
            await service.hide("p1", "second", "admin-2")
        else:
            await service.unhide("p1")

    assert (lost.value.code, lost.value.status) == expected
    assert session.rolled_back == 1


async def test_search_does_not_find_a_hidden_player() -> None:
    class _Repo:
        async def get_by_discord_username(self, discord_username: str) -> LeaderboardPlayer:
            return _row(hidden_at=NOW)

    assert await _service(_Repo()).search("player") is None  # type: ignore[arg-type]


async def test_remove_commits_and_returns_the_removed_row() -> None:
    row = _row(puuid="gone", update_source="migration", last_played_match=None, updated_at=NOW)
    repo = FakeAdminRepo(rows=[row])
    session = FakeSession()
    service = LeaderboardService(session=session, repo=repo)  # type: ignore[arg-type]

    removed = await service.remove("gone", "admin-user-id")

    assert removed.puuid == "gone"
    assert removed.update_source == "migration"
    assert removed.on_leaderboard is False
    assert removed.removal_id == str(uuid.UUID(int=7))
    assert repo.removed == [("gone", "admin-user-id")]
    assert session.commits == 1


async def test_remove_unknown_player_is_404_and_commits_nothing() -> None:
    session = FakeSession()
    service = LeaderboardService(session=session, repo=FakeAdminRepo())  # type: ignore[arg-type]

    with pytest.raises(AppError) as excinfo:
        await service.remove("ghost")

    assert excinfo.value.code == "LEADERBOARD_PLAYER_NOT_FOUND"
    assert excinfo.value.status == 404
    assert session.commits == 0
