"""Real-Postgres leaderboard server check tests (migration 0018).

The updater records servers per match (stored once per match, stamped per
check); the service flags from them at read time, a clearance covers only the
matches before it, and removing a registration leaves the evidence alone.
Skipped when ``TEST_DATABASE_URL`` is unset (see conftest).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.api.errors import AppError
from app.config import Settings
from app.db.models import LeaderboardPlayer, LeaderboardServerCheck, LeaderboardServerMatch
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.db.repositories.leaderboard_server_check_repository import LeaderboardServerCheckRepository
from app.integrations.henrik.models import HenrikServerMatch
from app.services.leaderboard_service import LeaderboardService
from app.services.server_check_service import ServerCheckService

NOW = datetime.now(UTC)
ADMIN = "8b1c6f0e-1d2a-4c3b-9e4f-5a6b7c8d9e0f"


def _player(name: str, **overrides: object) -> LeaderboardPlayer:
    defaults: dict[str, object] = {
        "puuid": uuid.uuid4().hex,
        "name": name,
        "tag": "SL",
        "region": "ap",
        "discord_id": f"{name.lower()}-id",
        "discord_username": name.lower(),
        "elo": 1500,
        "currenttierpatched": "Diamond 1",
        "last_played_match": NOW - timedelta(days=1),
        "updated_at": NOW,
    }
    defaults.update(overrides)
    return LeaderboardPlayer(**defaults)


def _matches(prefix: str, cluster: str | None, count: int, *, days_ago: float = 1) -> list[HenrikServerMatch]:
    return [
        HenrikServerMatch(
            match_id=f"{prefix}-{cluster}-{days_ago}-{i}",
            cluster=cluster,
            shard="ap",
            started_at=NOW - timedelta(days=days_ago, minutes=i),
        )
        for i in range(count)
    ]


def _service(session) -> ServerCheckService:
    return ServerCheckService(
        session=session,
        repo=LeaderboardServerCheckRepository(session),
        players=LeaderboardPlayerRepository(session),
        settings=Settings(),
    )


async def _seed(session_factory, *players: LeaderboardPlayer) -> None:
    async with session_factory() as session:
        session.add_all(players)
        await session.commit()


async def _record(session_factory, puuid: str, matches: list[HenrikServerMatch]) -> None:
    async with session_factory() as session:
        await LeaderboardServerCheckRepository(session).record_servers(puuid, matches)


async def test_record_servers_stores_each_match_once_and_stamps_the_check(session_factory) -> None:
    player = _player("Home")
    await _seed(session_factory, player)
    batch = _matches("a", "Singapore", 3)

    await _record(session_factory, player.puuid, batch)
    async with session_factory() as session:
        first_stamp = (await session.get(LeaderboardServerCheck, player.puuid)).checked_at
    await _record(session_factory, player.puuid, batch + _matches("b", "Mumbai", 2))

    async with session_factory() as session:
        stored = (await session.execute(
            select(LeaderboardServerMatch.cluster, func.count()).group_by(LeaderboardServerMatch.cluster)
        )).all()
        check = await session.get(LeaderboardServerCheck, player.puuid)
        by_puuid = await LeaderboardServerCheckRepository(session).checked_at_by_puuid()

    assert dict(stored) == {"Singapore": 3, "Mumbai": 2}
    assert check.checked_at >= first_stamp
    assert check.cleared_at is None
    assert set(by_puuid) == {player.puuid}


async def test_record_servers_with_no_matches_still_stamps(session_factory) -> None:
    player = _player("NoMatches", region="eu")
    await _seed(session_factory, player)
    await _record(session_factory, player.puuid, [])
    async with session_factory() as session:
        assert (await session.get(LeaderboardServerCheck, player.puuid)).checked_at is not None


async def test_matches_past_retention_are_pruned_on_the_next_check(session_factory) -> None:
    player = _player("Pruned")
    await _seed(session_factory, player)
    await _record(session_factory, player.puuid, _matches("old", "Sydney", 2, days_ago=200))
    await _record(session_factory, player.puuid, _matches("new", "Mumbai", 1))
    async with session_factory() as session:
        clusters = (await session.execute(select(LeaderboardServerMatch.cluster))).scalars().all()
    assert clusters == ["Mumbai"]


async def test_list_flags_away_and_off_shard_players_and_summarises(session_factory) -> None:
    home = _player("Home")
    sydney = _player("Sydney")
    tokyo_old = _player("TokyoLongAgo")
    eu = _player("Europe", region="eu")
    unchecked = _player("Unchecked")
    await _seed(session_factory, home, sydney, tokyo_old, eu, unchecked)
    await _record(session_factory, home.puuid, _matches("h", "Singapore", 10) + _matches("h", "Mumbai", 10))
    await _record(session_factory, sydney.puuid, _matches("s", "Sydney", 9) + _matches("s", "Mumbai", 1))
    # Outside the 30-day window, so it does not count.
    await _record(session_factory, tokyo_old.puuid, _matches("t", "Tokyo", 10, days_ago=45))
    await _record(session_factory, eu.puuid, [])

    async with session_factory() as session:
        page = await _service(session).list_checks("flagged", "", 1, 20)

    assert [(e.name, e.reasons) for e in page.entries] == [
        ("Sydney", ["away_servers"]),
        ("Europe", ["account_region"]),
    ]
    flagged = page.entries[0]
    assert (flagged.away_matches, flagged.known_matches, flagged.away_share) == (9, 10, 0.9)
    assert [(s.cluster, s.matches, s.home) for s in flagged.servers] == [("Sydney", 9, False), ("Mumbai", 1, True)]
    assert page.summary.model_dump(exclude={"servers"}) == {"registered": 5, "checked": 4, "flagged": 2, "cleared": 0}
    assert page.rule.home_clusters == ["Singapore", "Mumbai"]


async def test_list_search_matches_riot_id_and_discord(session_factory) -> None:
    a = _player("Kangaroo")
    b = _player("Wallaby", discord_username="outback.fan")
    await _seed(session_factory, a, b)
    for player in (a, b):
        await _record(session_factory, player.puuid, _matches(player.name, "Sydney", 6))
    async with session_factory() as session:
        service = _service(session)
        assert [e.name for e in (await service.list_checks("flagged", "kangaroo#s", 1, 20)).entries] == ["Kangaroo"]
        assert [e.name for e in (await service.list_checks("flagged", "@OUTBACK", 1, 20)).entries] == ["Wallaby"]


async def test_clear_covers_earlier_matches_and_new_away_matches_flag_again(session_factory) -> None:
    player = _player("Traveller")
    await _seed(session_factory, player)
    await _record(session_factory, player.puuid, _matches("before", "Sydney", 8, days_ago=2))

    async with session_factory() as session:
        cleared = await _service(session).clear(player.puuid, ADMIN)
    assert cleared.status == "cleared"
    assert cleared.cleared_by == ADMIN
    assert cleared.matches == 0

    async with session_factory() as session:
        service = _service(session)
        assert (await service.list_checks("flagged", "", 1, 20)).total == 0
        assert [e.name for e in (await service.list_checks("cleared", "", 1, 20)).entries] == ["Traveller"]

    # Played after the clearance: judged on their own.
    after = [
        HenrikServerMatch(match_id=f"after-{i}", cluster="Sydney", shard="ap", started_at=datetime.now(UTC) + timedelta(minutes=i + 1))
        for i in range(5)
    ]
    await _record(session_factory, player.puuid, after)
    async with session_factory() as session:
        page = await _service(session).list_checks("flagged", "", 1, 20)
    assert [(e.name, e.away_matches) for e in page.entries] == [("Traveller", 5)]
    assert page.entries[0].cleared_at is not None


async def test_reopen_counts_every_match_in_the_window_again(session_factory) -> None:
    player = _player("Reopened")
    await _seed(session_factory, player)
    await _record(session_factory, player.puuid, _matches("r", "Sydney", 8))
    async with session_factory() as session:
        await _service(session).clear(player.puuid, ADMIN)
    async with session_factory() as session:
        reopened = await _service(session).reopen(player.puuid)
    assert reopened.status == "flagged"
    assert reopened.cleared_at is None
    assert reopened.cleared_by is None


async def test_clear_and_reopen_refuse_when_there_is_nothing_to_do(session_factory) -> None:
    player = _player("Nothing")
    await _seed(session_factory, player)
    await _record(session_factory, player.puuid, _matches("n", "Mumbai", 8))

    async with session_factory() as session:
        service = _service(session)
        with pytest.raises(AppError) as not_flagged:
            await service.clear(player.puuid, ADMIN)
        with pytest.raises(AppError) as not_cleared:
            await service.reopen(player.puuid)
        with pytest.raises(AppError) as missing:
            await service.clear("ghost", ADMIN)

    assert (not_flagged.value.status, not_flagged.value.code) == (409, "LEADERBOARD_SERVER_CHECK_NOT_FLAGGED")
    assert (not_cleared.value.status, not_cleared.value.code) == (409, "LEADERBOARD_SERVER_CHECK_NOT_CLEARED")
    assert (missing.value.status, missing.value.code) == (404, "LEADERBOARD_PLAYER_NOT_FOUND")


async def test_removal_keeps_the_evidence_and_restore_brings_the_flag_back(session_factory) -> None:
    player = _player("Removed")
    await _seed(session_factory, player)
    await _record(session_factory, player.puuid, _matches("x", "Sydney", 7))

    async with session_factory() as session:
        removal = await LeaderboardService(session, LeaderboardPlayerRepository(session)).remove(player.puuid, ADMIN)
    async with session_factory() as session:
        page = await _service(session).list_checks("flagged", "", 1, 20)
        stored = (await session.execute(select(func.count()).select_from(LeaderboardServerMatch))).scalar_one()
    assert page.total == 0
    assert page.summary.registered == 0
    assert stored == 7

    async with session_factory() as session:
        await LeaderboardService(session, LeaderboardPlayerRepository(session)).restore(removal.removal_id, ADMIN)
    async with session_factory() as session:
        assert [e.name for e in (await _service(session).list_checks("flagged", "", 1, 20)).entries] == ["Removed"]


async def test_cleared_list_is_newest_clearance_first(session_factory) -> None:
    first = _player("First")
    second = _player("Second")
    await _seed(session_factory, first, second)
    for player in (first, second):
        await _record(session_factory, player.puuid, _matches(player.name, "Sydney", 6))
        async with session_factory() as session:
            await _service(session).clear(player.puuid, ADMIN)
    async with session_factory() as session:
        await session.execute(
            update(LeaderboardServerCheck)
            .where(LeaderboardServerCheck.puuid == first.puuid)
            .values(cleared_at=datetime.now(UTC) - timedelta(hours=1))
        )
        await session.commit()
    async with session_factory() as session:
        page = await _service(session).list_checks("cleared", "", 1, 20)
    assert [e.name for e in page.entries] == ["Second", "First"]


async def test_all_lists_every_registration_by_name_with_server_totals(session_factory) -> None:
    mumbai = _player("Mumbai")
    both = _player("Both")
    sydney = _player("Sydney")
    unchecked = _player("Unchecked")
    await _seed(session_factory, mumbai, both, sydney, unchecked)
    await _record(session_factory, mumbai.puuid, _matches("m", "Mumbai", 6))
    await _record(session_factory, both.puuid, _matches("b", "Mumbai", 2) + _matches("b", "Singapore", 3) + _matches("b", None, 1))
    await _record(session_factory, sydney.puuid, _matches("s", "Sydney", 7))

    async with session_factory() as session:
        page = await _service(session).list_checks("all", "", 1, 20)

    assert [(e.name, e.status) for e in page.entries] == [
        ("Both", "clear"),
        ("Mumbai", "clear"),
        ("Sydney", "flagged"),
        ("Unchecked", "not_checked"),
    ]
    assert [(t.cluster, t.matches, t.players, t.home) for t in page.summary.servers] == [
        ("Mumbai", 8, 2, True),
        ("Sydney", 7, 1, False),
        ("Singapore", 3, 1, True),
    ]


async def test_server_filter_lists_players_on_that_server_most_matches_first(session_factory) -> None:
    few = _player("Few")
    many = _player("Many")
    elsewhere = _player("Elsewhere")
    await _seed(session_factory, few, many, elsewhere)
    await _record(session_factory, few.puuid, _matches("f", "Sydney", 1) + _matches("f", "Mumbai", 9))
    await _record(session_factory, many.puuid, _matches("m", "Sydney", 8))
    await _record(session_factory, elsewhere.puuid, _matches("e", "Singapore", 8))

    async with session_factory() as session:
        service = _service(session)
        everyone = await service.list_checks("all", "", 1, 20, "sydney")
        flagged = await service.list_checks("flagged", "", 1, 20, "Sydney")

    assert [e.name for e in everyone.entries] == ["Many", "Few"]
    assert everyone.total == 2
    # The server filter narrows a status view too; the totals still cover everyone.
    assert [e.name for e in flagged.entries] == ["Many"]
    assert {t.cluster for t in flagged.summary.servers} == {"Sydney", "Mumbai", "Singapore"}


async def test_sort_orders_any_view_with_missing_values_last(session_factory) -> None:
    radiant = _player("Radiant", elo=2800, last_played_match=NOW - timedelta(days=5))
    gold = _player("Gold", elo=1300, last_played_match=NOW - timedelta(hours=2))
    unrated = _player("Unrated", elo=None, last_played_match=None)
    iron = _player("Iron", elo=300, last_played_match=NOW - timedelta(days=1))
    await _seed(session_factory, radiant, gold, unrated, iron)
    await _record(session_factory, radiant.puuid, _matches("r", "Sydney", 6) + _matches("r", "Mumbai", 4))
    await _record(session_factory, gold.puuid, _matches("g", "Sydney", 5))
    await _record(session_factory, unrated.puuid, _matches("u", "Mumbai", 20))
    await _record(session_factory, iron.puuid, _matches("i", "Singapore", 2))

    async with session_factory() as session:
        service = _service(session)

        async def names(status, sort, server=""):
            return [e.name for e in (await service.list_checks(status, "", 1, 20, server, sort)).entries]

        assert await names("all", "rank") == ["Radiant", "Gold", "Iron", "Unrated"]
        assert await names("all", "rank_low") == ["Iron", "Gold", "Radiant", "Unrated"]
        assert await names("all", "matches") == ["Unrated", "Radiant", "Gold", "Iron"]
        assert await names("all", "recent") == ["Gold", "Iron", "Radiant", "Unrated"]
        assert await names("all", "away") == ["Gold", "Radiant", "Iron", "Unrated"]
        assert await names("all", "name") == ["Gold", "Iron", "Radiant", "Unrated"]
        # Flagged by default is most away first; by rank, highest first.
        assert await names("flagged", "default") == ["Gold", "Radiant"]
        assert await names("flagged", "rank") == ["Radiant", "Gold"]
        # A server filter keeps its own order unless a sort is chosen.
        assert await names("all", "default", "Sydney") == ["Radiant", "Gold"]
        assert await names("all", "rank_low", "Sydney") == ["Gold", "Radiant"]
