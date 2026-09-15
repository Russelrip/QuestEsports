"""Updater worker tests (SDD 2026-08-14 leaderboard standardization, task 7).

A fake ``HenrikClient`` (canned MMR + a last-match ISO string) and a fake repo
(``list_all`` returning in-memory ``LeaderboardPlayer`` rows, ``refresh_rank``
recording every call) prove: the ``_in_rank_pause_window`` Sunday boundaries,
the per-player refresh field mapping (incl. tz-aware ``last_played_match`` and
``update_source="updater_service"``), per-player failure isolation (one bad
player is counted ``failed`` and the loop continues), a player removed
mid-pass counted ``removed`` rather than re-created, and the
``{total, updated, removed, failed}`` stats. ``rate_limit_delay=0`` throughout so tests
never sleep.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.exc import SQLAlchemyError

from app.db.models import LeaderboardPlayer
from app.integrations.henrik.exceptions import HenrikNotFoundError
from app.integrations.henrik.models import HenrikServerMatch
from workers.server_check import ServerChecker
from workers.updater import _in_rank_pause_window, update_all_players, update_player_by_puuid

COLOMBO = ZoneInfo("Asia/Colombo")

# 2026-01-04 is a Sunday; 2026-01-03 is the Saturday before it.
SUNDAY = datetime(2026, 1, 4, tzinfo=COLOMBO)

MMR = {
    "name": "PlayerA",
    "tag": "A",
    "rank_details": {
        "currenttierpatched": "Gold 1",
        "current_tier": 21,
        "elo": 1200,
        "ranking_in_tier": 55,
        "games_needed_for_rating": 1,
    },
    "peak_rank": {"tier_name": "Platinum 1", "season_short": "e9a3", "tier": 24},
    "seasonal_ranks": [
        {
            "season_short": "e9a3",
            "season_id": "season-e9a3",
            "wins": 5,
            "games": 10,
            "end_tier": {"id": 21, "name": "Gold 1"},
            "end_rr": 40,
            "ranking_schema": "base",
            "leaderboard_placement": 100,
        }
    ],
}

LAST_MATCH = "2026-01-02T03:04:05+00:00"


def _row(puuid: str) -> LeaderboardPlayer:
    """A minimal in-memory ``leaderboard_players`` row (no DB involved)."""
    return LeaderboardPlayer(
        puuid=puuid,
        name="OldName",
        tag="OLD",
        region="ap",
        discord_username=f"user-{puuid}",
    )


class FakeHenrikClient:
    """Canned MMR + last-match; optionally raises for a set of PUUIDs."""

    def __init__(self, *, fail_for: set[str] | None = None, last_match: str | None = LAST_MATCH) -> None:
        self.fail_for = fail_for or set()
        self.last_match = last_match
        self.calls: list[tuple[str, str, str, str]] = []

    async def get_player_mmr(self, puuid: str, *, affinity: str, platform: str) -> dict:
        self.calls.append(("mmr", puuid, affinity, platform))
        if puuid in self.fail_for:
            raise RuntimeError(f"henrik boom for {puuid}")
        return MMR

    async def get_last_competitive_match(self, puuid: str, *, affinity: str, platform: str) -> str | None:
        self.calls.append(("last", puuid, affinity, platform))
        return self.last_match


class FakeRepo:
    """Stub repo: returns its rows and records every ``refresh_rank`` call."""

    def __init__(
        self,
        players: list[LeaderboardPlayer] | None = None,
        *,
        fail_db_for: set[str] | None = None,
        removed: set[str] | None = None,
    ) -> None:
        self.players = players or []
        self.refreshes: list[dict] = []
        self.rollbacks = 0
        self.fail_db_for = fail_db_for or set()
        self.removed = removed or set()

    async def list_all(self) -> list[LeaderboardPlayer]:
        return list(self.players)

    async def get_by_puuid(self, puuid: str) -> LeaderboardPlayer | None:
        return next((p for p in self.players if p.puuid == puuid), None)

    async def refresh_rank(self, puuid: str, **kwargs) -> bool:
        self.refreshes.append({"puuid": puuid, **kwargs})
        if puuid in self.fail_db_for:
            raise SQLAlchemyError(f"db boom on refresh for {puuid}")
        return puuid not in self.removed

    async def rollback(self) -> None:
        self.rollbacks += 1


# ------------------------------------------------------- _in_rank_pause_window

def test_pause_window_inside_sunday_morning():
    assert _in_rank_pause_window(SUNDAY.replace(hour=3, minute=0))


def test_pause_window_lower_bound_is_inclusive():
    assert _in_rank_pause_window(SUNDAY.replace(hour=1, minute=30))


def test_pause_window_upper_bound_is_exclusive():
    assert not _in_rank_pause_window(SUNDAY.replace(hour=6, minute=0))


def test_pause_window_before_window():
    assert not _in_rank_pause_window(SUNDAY.replace(hour=1, minute=29))


def test_pause_window_after_window():
    assert not _in_rank_pause_window(SUNDAY.replace(hour=6, minute=1))


def test_pause_window_not_sunday():
    saturday = SUNDAY - timedelta(days=1)
    assert not _in_rank_pause_window(saturday.replace(hour=3, minute=0))


# ------------------------------------------------------------- full pass core

async def test_update_all_players_maps_every_field_and_stats():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[_row("p1"), _row("p2")])
    stats = await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )

    assert stats == {"total": 2, "updated": 2, "removed": 0, "failed": 0}
    assert len(repo.refreshes) == 2
    for puuid, call in zip(("p1", "p2"), repo.refreshes, strict=True):
        assert call["puuid"] == puuid
        assert call["name"] == "PlayerA"
        assert call["tag"] == "A"
        assert call["elo"] == 1200
        assert call["currenttierpatched"] == "Gold 1"
        assert call["rank_details"] == MMR["rank_details"]
        assert call["peak_rank"] == MMR["peak_rank"]
        assert call["seasonal_ranks"] == MMR["seasonal_ranks"]
        assert call["update_source"] == "updater_service"
        assert call["last_played_match"] == datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
        assert call["last_played_match"].tzinfo is not None


async def test_update_all_players_continues_after_player_failure():
    client = FakeHenrikClient(fail_for={"p1"})
    repo = FakeRepo(players=[_row("p1"), _row("p2")])
    stats = await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )

    assert stats == {"total": 2, "updated": 1, "removed": 0, "failed": 1}
    # The failing player was attempted and the loop moved on to the next one.
    assert ("mmr", "p1", "ap", "pc") in client.calls
    assert [c["puuid"] for c in repo.refreshes] == ["p2"]
    # A pure Henrik failure happens BEFORE any DB write for that player, so
    # there is nothing to roll back.
    assert repo.rollbacks == 0


async def test_db_write_failure_rolls_back_and_loop_continues():
    # p2's refresh raises a SQLAlchemyError (aborted DB write): that IS rolled
    # back so the rest of the pass is not poisoned, and p3 is still updated.
    client = FakeHenrikClient()
    repo = FakeRepo(players=[_row("p1"), _row("p2"), _row("p3")], fail_db_for={"p2"})
    stats = await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )

    assert stats == {"total": 3, "updated": 2, "removed": 0, "failed": 1}
    assert [c["puuid"] for c in repo.refreshes] == ["p1", "p2", "p3"]
    # A DB-layer failure rolls back the session so the remaining players are not
    # poisoned by the aborted transaction.
    assert repo.rollbacks == 1


async def test_player_removed_mid_pass_is_counted_not_recreated():
    # p2 was deleted by an admin after the pass read the list. The refresh is
    # update-only, so it reports the row gone instead of inserting it again.
    client = FakeHenrikClient()
    repo = FakeRepo(players=[_row("p1"), _row("p2"), _row("p3")], removed={"p2"})
    stats = await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )

    assert stats == {"total": 3, "updated": 2, "removed": 1, "failed": 0}
    assert repo.rollbacks == 0


async def test_update_all_players_last_played_match_none_stays_none():
    client = FakeHenrikClient(last_match=None)
    repo = FakeRepo(players=[_row("p1")])
    await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )
    assert repo.refreshes[0]["last_played_match"] is None


async def test_update_all_players_empty_list_is_noop():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[])
    stats = await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )
    assert stats == {"total": 0, "updated": 0, "removed": 0, "failed": 0}
    assert repo.refreshes == []


# ---------------------------------------------------------- single player path

async def test_update_single_player_by_puuid():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[_row("p1")])
    ok = await update_player_by_puuid(
        client, repo, "p1", affinity="ap", platform="pc",  # type: ignore[arg-type]
    )
    assert ok is True
    assert [c["puuid"] for c in repo.refreshes] == ["p1"]


async def test_update_single_player_missing_puuid_returns_false():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[])
    ok = await update_player_by_puuid(
        client, repo, "nope", affinity="ap", platform="pc",  # type: ignore[arg-type]
    )
    assert ok is False
    assert repo.refreshes == []


# ------------------------------------------------------------ server check (0018)

class FakeServerClient:
    """Canned stored-match servers; raises per PUUID when asked."""

    def __init__(self, *, fail_for: dict[str, Exception] | None = None) -> None:
        self.fail_for = fail_for or {}
        self.calls: list[tuple[str, str, int]] = []

    async def get_stored_competitive_servers(self, puuid: str, *, affinity: str, size: int) -> list:
        self.calls.append((puuid, affinity, size))
        if puuid in self.fail_for:
            raise self.fail_for[puuid]
        return [
            HenrikServerMatch(match_id=f"{puuid}-m1", cluster="Sydney", shard="ap", started_at=LAST_MATCH),
        ]


class FakeServerRepo:
    def __init__(self, checked_at: dict[str, datetime | None] | None = None) -> None:
        self.checked_at = checked_at or {}
        self.recorded: list[tuple[str, list[str]]] = []

    async def checked_at_by_puuid(self) -> dict[str, datetime | None]:
        return dict(self.checked_at)

    async def record_servers(self, puuid: str, matches) -> None:
        self.recorded.append((puuid, [m.match_id for m in matches]))


def _checker(client: FakeServerClient, repo: FakeServerRepo, *, hours: float = 24) -> ServerChecker:
    return ServerChecker(
        client, repo, affinity="ap", match_count=25, interval=timedelta(hours=hours), delay=0,  # type: ignore[arg-type]
    )


async def test_server_check_runs_for_refreshed_players_that_are_due() -> None:
    now = datetime.now(UTC)
    servers = FakeServerClient()
    server_repo = FakeServerRepo({"fresh": now - timedelta(hours=1), "old": now - timedelta(hours=25)})
    repo = FakeRepo(players=[_row("fresh"), _row("old"), _row("never")])

    stats = await update_all_players(
        FakeHenrikClient(), repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
        server_checker=_checker(servers, server_repo),
    )

    assert stats == {
        "total": 3, "updated": 3, "removed": 0, "failed": 0, "servers_checked": 2, "server_check_failed": 0,
    }
    assert [call[0] for call in servers.calls] == ["old", "never"]
    assert servers.calls[0] == ("old", "ap", 25)
    assert server_repo.recorded == [("old", ["old-m1"]), ("never", ["never-m1"])]


async def test_server_check_skips_removed_and_failed_players() -> None:
    servers = FakeServerClient()
    repo = FakeRepo(players=[_row("gone"), _row("broken"), _row("ok")], removed={"gone"})
    stats = await update_all_players(
        FakeHenrikClient(fail_for={"broken"}), repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
        server_checker=_checker(servers, FakeServerRepo()),
    )
    assert stats["servers_checked"] == 1
    assert [call[0] for call in servers.calls] == ["ok"]


async def test_server_check_failure_never_costs_the_rank_refresh() -> None:
    servers = FakeServerClient(fail_for={"p1": RuntimeError("henrik down"), "p2": SQLAlchemyError("db boom")})
    server_repo = FakeServerRepo()
    repo = FakeRepo(players=[_row("p1"), _row("p2"), _row("p3")])
    stats = await update_all_players(
        FakeHenrikClient(), repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
        server_checker=_checker(servers, server_repo),
    )
    assert stats == {
        "total": 3, "updated": 3, "removed": 0, "failed": 0, "servers_checked": 1, "server_check_failed": 2,
    }
    # Nothing was stamped for the failures, so they are retried next pass.
    assert server_repo.recorded == [("p3", ["p3-m1"])]
    assert repo.rollbacks == 1


async def test_a_404_is_recorded_as_a_check_that_found_no_matches() -> None:
    servers = FakeServerClient(fail_for={"p1": HenrikNotFoundError("no matches", sub_code=None, request_id=None)})
    server_repo = FakeServerRepo()
    checker = _checker(servers, server_repo)
    await checker.start_pass()
    assert await checker.check("p1") is True
    assert server_repo.recorded == [("p1", [])]
    # Stamped in memory too, so the same pass does not fetch it again.
    assert await checker.check("p1") is False


async def test_without_a_checker_the_pass_is_unchanged() -> None:
    stats = await update_all_players(
        FakeHenrikClient(), FakeRepo(players=[_row("p1")]), affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )
    assert stats == {"total": 1, "updated": 1, "removed": 0, "failed": 0}
