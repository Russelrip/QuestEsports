"""Updater worker tests (SDD 2026-08-14 leaderboard standardization, task 7).

A fake ``HenrikClient`` (canned MMR + a last-match ISO string) and a fake repo
(``list_all`` returning in-memory ``LeaderboardPlayer`` rows, ``upsert``
recording every call) prove: the ``_in_rank_pause_window`` Sunday boundaries,
the per-player upsert field mapping (incl. tz-aware ``last_played_match`` and
``update_source="updater_service"``), per-player failure isolation (one bad
player is counted ``failed`` and the loop continues), and the
``{total, updated, failed}`` stats. ``rate_limit_delay=0`` throughout so tests
never sleep.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.exc import SQLAlchemyError

from app.db.models import LeaderboardPlayer
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
    """Stub repo: returns its rows and records every ``upsert`` call."""

    def __init__(self, players: list[LeaderboardPlayer] | None = None, *, fail_db_for: set[str] | None = None) -> None:
        self.players = players or []
        self.upserts: list[dict] = []
        self.rollbacks = 0
        self.fail_db_for = fail_db_for or set()

    async def list_all(self) -> list[LeaderboardPlayer]:
        return list(self.players)

    async def get_by_puuid(self, puuid: str) -> LeaderboardPlayer | None:
        return next((p for p in self.players if p.puuid == puuid), None)

    async def upsert(self, **kwargs) -> str:
        self.upserts.append(kwargs)
        if kwargs["puuid"] in self.fail_db_for:
            raise SQLAlchemyError(f"db boom on upsert for {kwargs['puuid']}")
        return kwargs["puuid"]

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

    assert stats == {"total": 2, "updated": 2, "failed": 0}
    assert len(repo.upserts) == 2
    for puuid, call in zip(("p1", "p2"), repo.upserts, strict=True):
        assert call["puuid"] == puuid
        assert call["name"] == "PlayerA"
        assert call["tag"] == "A"
        assert call["region"] == "ap"
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

    assert stats == {"total": 2, "updated": 1, "failed": 1}
    # The failing player was attempted and the loop moved on to the next one.
    assert ("mmr", "p1", "ap", "pc") in client.calls
    assert [c["puuid"] for c in repo.upserts] == ["p2"]
    # A pure Henrik failure happens BEFORE any DB write for that player, so the
    # transaction is still healthy: it must NOT be rolled back, otherwise the
    # earlier players' flushed-but-uncommitted upserts would be discarded and a
    # persistently-failing player would starve the prefix of the pass.
    assert repo.rollbacks == 0


async def test_db_write_failure_rolls_back_and_loop_continues():
    # p2's upsert raises a SQLAlchemyError (aborted DB write): that IS rolled
    # back so the rest of the pass is not poisoned, and p3 is still updated.
    client = FakeHenrikClient()
    repo = FakeRepo(players=[_row("p1"), _row("p2"), _row("p3")], fail_db_for={"p2"})
    stats = await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )

    assert stats == {"total": 3, "updated": 2, "failed": 1}
    assert [c["puuid"] for c in repo.upserts] == ["p1", "p2", "p3"]
    # A DB-layer failure rolls back the session so the remaining players are not
    # poisoned by the aborted transaction.
    assert repo.rollbacks == 1


async def test_update_all_players_last_played_match_none_stays_none():
    client = FakeHenrikClient(last_match=None)
    repo = FakeRepo(players=[_row("p1")])
    await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )
    assert repo.upserts[0]["last_played_match"] is None


async def test_update_all_players_empty_list_is_noop():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[])
    stats = await update_all_players(
        client, repo, affinity="ap", platform="pc", rate_limit_delay=0,  # type: ignore[arg-type]
    )
    assert stats == {"total": 0, "updated": 0, "failed": 0}
    assert repo.upserts == []


# ---------------------------------------------------------- single player path

async def test_update_single_player_by_puuid():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[_row("p1")])
    ok = await update_player_by_puuid(
        client, repo, "p1", affinity="ap", platform="pc",  # type: ignore[arg-type]
    )
    assert ok is True
    assert [c["puuid"] for c in repo.upserts] == ["p1"]


async def test_update_single_player_missing_puuid_returns_false():
    client = FakeHenrikClient()
    repo = FakeRepo(players=[])
    ok = await update_player_by_puuid(
        client, repo, "nope", affinity="ap", platform="pc",  # type: ignore[arg-type]
    )
    assert ok is False
    assert repo.upserts == []
