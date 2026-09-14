"""Real-Postgres leaderboard removal archive + restore tests (migration 0017).

Removal must keep an exact, restorable copy in the same transaction as the
delete; restore must put that copy back unchanged, at most once, and never
over a registration that exists again. Skipped when ``TEST_DATABASE_URL`` is
unset (see conftest).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.api.errors import AppError
from app.db.models import LeaderboardPlayer, LeaderboardPlayerRemoval
from app.db.models.leaderboard_player_removal import REGISTRATION_COLUMNS
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.services.leaderboard_service import LeaderboardService

RECENT = datetime.now(UTC) - timedelta(days=1)
ADMIN = "8b1c6f0e-1d2a-4c3b-9e4f-5a6b7c8d9e0f"


def _player(**overrides: object) -> LeaderboardPlayer:
    defaults: dict[str, object] = {
        "puuid": uuid.uuid4().hex,
        "name": "CasperYT",
        "tag": "1991",
        "region": "ap",
        "discord_id": "janithbokula.",
        "discord_username": "janithbokula.",
        "elo": 1621,
        "currenttierpatched": "Diamond 2",
        "rank_details": {"ranking_in_tier": 21},
        "peak_rank": {"tier_name": "Diamond 2", "season_short": "e11a5"},
        "seasonal_ranks": [{"season": "e11a5", "wins": 3}],
        "last_played_match": RECENT,
        "update_source": "updater_service",
        "updated_at": RECENT,
    }
    defaults.update(overrides)
    return LeaderboardPlayer(**defaults)


def _service(session) -> LeaderboardService:
    return LeaderboardService(session=session, repo=LeaderboardPlayerRepository(session))


def _columns(row: object) -> dict[str, object]:
    return {column: getattr(row, column) for column in REGISTRATION_COLUMNS}


async def _seed(session_factory, *players: LeaderboardPlayer) -> None:
    async with session_factory() as session:
        session.add_all(players)
        await session.commit()


async def _refusal(coro) -> AppError:
    with pytest.raises(AppError) as excinfo:
        await coro
    return excinfo.value


async def test_remove_keeps_an_exact_copy_and_deletes_the_registration(session_factory) -> None:
    player = _player()
    expected = _columns(player)
    await _seed(session_factory, player)

    async with session_factory() as session:
        removed = await _service(session).remove(player.puuid, ADMIN)

    async with session_factory() as session:
        assert await session.get(LeaderboardPlayer, player.puuid) is None
        archive = (await session.execute(select(LeaderboardPlayerRemoval))).scalars().all()

    assert len(archive) == 1
    assert _columns(archive[0]) == expected
    assert archive[0].removed_by == ADMIN
    assert archive[0].restored_at is None
    assert removed.removal_id == str(archive[0].id)
    assert removed.name == "CasperYT"


async def test_restore_puts_the_row_back_unchanged_exactly_once(session_factory) -> None:
    player = _player()
    expected = _columns(player)
    await _seed(session_factory, player)
    async with session_factory() as session:
        removed = await _service(session).remove(player.puuid, ADMIN)

    async with session_factory() as session:
        restored = await _service(session).restore(removed.removal_id, "restorer")

    async with session_factory() as session:
        row = await session.get(LeaderboardPlayer, player.puuid)
        removal = await session.get(LeaderboardPlayerRemoval, uuid.UUID(removed.removal_id))
        assert row is not None
        assert _columns(row) == expected
        assert removal.restored_by == "restorer"
        assert removal.restored_at is not None
        again = await _refusal(_service(session).restore(removed.removal_id, "restorer"))

    assert restored.removed_by == ADMIN
    assert restored.on_leaderboard is True
    assert (again.status, again.code) == (409, "LEADERBOARD_REMOVAL_ALREADY_RESTORED")


async def test_restore_refuses_when_the_player_registered_again(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        removed = await _service(session).remove(player.puuid, ADMIN)
    # They registered again themselves, with fresh data.
    await _seed(session_factory, _player(puuid=player.puuid, elo=1700))

    async with session_factory() as session:
        refusal = await _refusal(_service(session).restore(removed.removal_id, "restorer"))
        page = await _service(session).removals("", 1, 20)

    async with session_factory() as session:
        row = await session.get(LeaderboardPlayer, player.puuid)
        removal = await session.get(LeaderboardPlayerRemoval, uuid.UUID(removed.removal_id))

    assert (refusal.status, refusal.code) == (409, "LEADERBOARD_PLAYER_ALREADY_REGISTERED")
    assert row.elo == 1700, "the current registration must not be overwritten"
    assert removal.restored_at is None, "a refused restore leaves the removal restorable later"
    assert [(e.registered_again, e.restorable) for e in page.entries] == [(True, False)]


@pytest.mark.parametrize(
    "holder",
    [
        {"discord_id": "janithbokula.", "discord_username": "someone-else"},
        {"discord_id": "999", "discord_username": "JanithBokula."},
    ],
    ids=["same discord id", "same discord username in another case"],
)
async def test_restore_refuses_when_the_discord_account_is_taken(session_factory, holder) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        removed = await _service(session).remove(player.puuid, ADMIN)
    await _seed(session_factory, _player(puuid="other", name="Other", tag="0001", **holder))

    async with session_factory() as session:
        refusal = await _refusal(_service(session).restore(removed.removal_id, "restorer"))
        count = (await session.execute(select(func.count()).select_from(LeaderboardPlayer))).scalar_one()

    assert (refusal.status, refusal.code) == (409, "LEADERBOARD_DISCORD_ALREADY_REGISTERED")
    assert count == 1


async def test_only_the_latest_removal_of_a_player_is_restorable(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        first = await _service(session).remove(player.puuid, ADMIN)
    await _seed(session_factory, _player(puuid=player.puuid, elo=1800))
    async with session_factory() as session:
        second = await _service(session).remove(player.puuid, ADMIN)

    async with session_factory() as session:
        page = await _service(session).removals("", 1, 20)
        refusal = await _refusal(_service(session).restore(first.removal_id, "restorer"))
    async with session_factory() as session:
        restored = await _service(session).restore(second.removal_id, "restorer")

    assert [(e.removal_id, e.superseded, e.restorable) for e in page.entries] == [
        (second.removal_id, False, True),
        (first.removal_id, True, False),
    ]
    assert (refusal.status, refusal.code) == (409, "LEADERBOARD_REMOVAL_SUPERSEDED")
    assert restored.elo == 1800


async def test_removals_search_matches_riot_id_and_discord(session_factory) -> None:
    casper = _player()
    other = _player(puuid="m4", name="M4HITH", tag="Rogue", discord_id="casperyt", discord_username="casperyt")
    await _seed(session_factory, casper, other)
    async with session_factory() as session:
        await _service(session).remove(casper.puuid, ADMIN)
        await _service(session).remove(other.puuid, ADMIN)

    async with session_factory() as session:
        by_riot_id = await _service(session).removals("casperyt#19", 1, 20)
        by_discord = await _service(session).removals("@CASPERYT", 1, 20)
        too_short = await _service(session).removals("c", 1, 20)

    assert [e.name for e in by_riot_id.entries] == ["CasperYT"]
    assert sorted(e.name for e in by_discord.entries) == ["CasperYT", "M4HITH"]
    assert too_short.total == 2


async def test_restore_of_an_unknown_removal_is_404(session_factory) -> None:
    async with session_factory() as session:
        missing = await _refusal(_service(session).restore(str(uuid.uuid4()), "restorer"))
        malformed = await _refusal(_service(session).restore("not-a-uuid", "restorer"))

    assert (missing.status, missing.code) == (404, "LEADERBOARD_REMOVAL_NOT_FOUND")
    assert (malformed.status, malformed.code) == (404, "LEADERBOARD_REMOVAL_NOT_FOUND")


async def test_removing_an_unknown_player_archives_nothing(session_factory) -> None:
    async with session_factory() as session:
        refusal = await _refusal(_service(session).remove("ghost", ADMIN))
        count = (await session.execute(select(func.count()).select_from(LeaderboardPlayerRemoval))).scalar_one()

    assert (refusal.status, refusal.code) == (404, "LEADERBOARD_PLAYER_NOT_FOUND")
    assert count == 0
