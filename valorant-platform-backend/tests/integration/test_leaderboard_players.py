"""Real-Postgres ``leaderboard_players`` migration + repository tests (plan Task 1).

Proves migration 0015 creates the table and its four indexes, and that
``LeaderboardPlayerRepository`` implements the leaderboard contract: the
``elo IS NOT NULL AND last_played_match >= now()-14d AND currenttierpatched
!= 'Unrated'`` filter with ``elo DESC`` ordering and pagination, case-insensitive
``get_by_discord_username``, ``get_stats`` aggregation, and puuid-conflict
``upsert``. Skipped when ``TEST_DATABASE_URL`` is unset (see conftest).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text

from app.db.models import LeaderboardPlayer
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository

NOW = datetime.now(UTC)
RECENT = NOW - timedelta(days=1)
OLD = NOW - timedelta(days=30)


def _player(**overrides: object) -> LeaderboardPlayer:
    """A minimal valid ``leaderboard_players`` row (unique discord_username)."""
    defaults: dict[str, object] = {
        "puuid": uuid.uuid4().hex,
        "name": "Player",
        "tag": "TAG",
        "region": "ap",
        "discord_username": uuid.uuid4().hex,
        "elo": 1000,
        "currenttierpatched": "Gold 1",
        "last_played_match": RECENT,
    }
    defaults.update(overrides)
    return LeaderboardPlayer(**defaults)


async def test_migration_creates_table_and_indexes(session_factory) -> None:
    async with session_factory() as session:
        table = (
            await session.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = current_schema() AND table_name = 'leaderboard_players'"
                )
            )
        ).scalar_one_or_none()
        assert table == "leaderboard_players"

        indexes = set(
            (
                await session.execute(
                    text(
                        "SELECT indexname FROM pg_indexes "
                        "WHERE schemaname = current_schema() AND tablename = 'leaderboard_players'"
                    )
                )
            ).scalars().all()
        )
    assert {
        "leaderboard_players_discord_username_key",
        "leaderboard_players_discord_id_key",
        "leaderboard_players_elo_idx",
        "leaderboard_players_last_played_idx",
    } <= indexes


async def test_list_page_filters_orders_and_paginates(session_factory) -> None:
    players = [
        _player(puuid="p1", elo=1500, currenttierpatched="Diamond 3"),
        _player(puuid="p2", elo=1200, currenttierpatched="Platinum 2"),
        _player(puuid="p3", elo=1800, currenttierpatched="Immortal 1", last_played_match=OLD),
        _player(puuid="p4", elo=1700, currenttierpatched="Unrated"),
        _player(puuid="p5", elo=None, currenttierpatched="Gold 1"),
        _player(puuid="p6", elo=1600, currenttierpatched="Ascendant 1"),
    ]
    async with session_factory() as session:
        session.add_all(players)
        await session.commit()
        repo = LeaderboardPlayerRepository(session)

        page1, total1 = await repo.list_page(page=1, per_page=2)
        page2, total2 = await repo.list_page(page=2, per_page=2)

    # p3 (old), p4 (Unrated), p5 (elo NULL) are filtered out; p6 > p1 > p2 by elo.
    assert total1 == 3
    assert total2 == 3
    assert [p.puuid for p in page1] == ["p6", "p1"]
    assert [p.puuid for p in page2] == ["p2"]
    assert [p.elo for p in page1 + page2] == [1600, 1500, 1200]


async def test_get_by_discord_username_is_case_insensitive(session_factory) -> None:
    async with session_factory() as session:
        session.add(_player(puuid="p1", discord_username="MixedCaseUser", elo=1400))
        await session.commit()
        repo = LeaderboardPlayerRepository(session)

        row = await repo.get_by_discord_username("  mixedcaseuser  ")
        assert row is not None
        assert row.puuid == "p1"

        assert await repo.get_by_discord_username("nope") is None


async def test_get_stats_aggregates(session_factory) -> None:
    rows = [
        _player(puuid="s1", elo=1000, currenttierpatched="Bronze 1"),
        _player(puuid="s2", elo=1200, currenttierpatched="Silver 2"),
        _player(puuid="s3", elo=1200, currenttierpatched="Silver 2"),
        _player(puuid="s4", elo=1600, currenttierpatched="Gold 3"),
        _player(puuid="s5", elo=None, currenttierpatched="Unrated"),
    ]
    async with session_factory() as session:
        session.add_all(rows)
        await session.commit()
        stats = await LeaderboardPlayerRepository(session).get_stats()

    assert stats["total_users"] == 4  # elo IS NOT NULL only
    assert stats["highest_elo"] == 1600
    assert stats["lowest_elo"] == 1000
    assert float(stats["average_elo"]) == pytest.approx(1250.0)
    assert stats["rank_distribution"] == {
        "Bronze 1": 1,
        "Silver 2": 2,
        "Gold 3": 1,
        "Unrated": 1,
    }


async def test_upsert_inserts_then_updates_on_puuid_conflict(session_factory) -> None:
    # One session end-to-end: insert, then re-upsert the SAME puuid on the
    # SAME session. The returned instance must reflect the NEW values — without
    # ``populate_existing=True`` the identity-map instance from the insert
    # would be reused with STALE attributes (elo would still read 1000).
    async with session_factory() as session:
        repo = LeaderboardPlayerRepository(session)
        created = await repo.upsert(
            puuid="puuid-1",
            name="Alpha",
            tag="AAA",
            region="ap",
            discord_username="alpha",
            discord_id="disc-1",
            elo=1000,
            currenttierpatched="Gold 1",
        )
        await session.commit()
        assert created.elo == 1000
        assert created.discord_username == "alpha"
        assert created.updated_at is not None  # server default fetched via RETURNING

        updated = await repo.upsert(
            puuid="puuid-1",
            name="Alpha",
            tag="AAA",
            region="ap",
            discord_username="alpha2",
            discord_id="disc-2",
            elo=1400,
            currenttierpatched="Platinum 1",
        )
        await session.commit()

        count = (await session.execute(select(func.count()).select_from(LeaderboardPlayer))).scalar_one()
        assert count == 1  # same puuid -> updated, not duplicated

        assert updated.puuid == "puuid-1"
        assert updated.elo == 1400
        assert updated.discord_username == "alpha2"
        assert updated.currenttierpatched == "Platinum 1"

        fresh = await repo.get_by_puuid("puuid-1")
        assert fresh is not None
        assert fresh.elo == 1400
        assert fresh.discord_username == "alpha2"
