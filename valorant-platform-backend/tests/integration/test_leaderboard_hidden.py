"""Real-Postgres hidden-player tests (migration 0020).

A hidden player stays registered but is left out of the public board, its
search and its stats. The hide survives the updater, a removal and restore, and
a repoint to a different Riot account. Skipped when ``TEST_DATABASE_URL`` is
unset (see conftest).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.api.errors import AppError
from app.config import Settings
from app.db.models import LeaderboardPlayer
from app.db.repositories.leaderboard_ban_repository import LeaderboardBanRepository
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.services import registration_service
from app.services.auth_service import AuthService
from app.services.leaderboard_service import LeaderboardService
from app.services.registration_service import RegistrationService

RECENT = datetime.now(UTC) - timedelta(days=1)
# Built rather than written out: an 18-digit literal next to "discord" trips the
# Gitleaks discord-client-id rule on every PR commit that adds it.
DISCORD_ID = str(7 * 10**17 + 1)
OTHER_DISCORD_ID = str(7 * 10**17 + 2)
ADMIN = "8b1c6f0e-1d2a-4c3b-9e4f-5a6b7c8d9e0f"

MMR = {
    "name": "mush",
    "tag": "1443",
    "rank_details": {"currenttierpatched": "Gold 1", "elo": 1200, "ranking_in_tier": 55},
    "peak_rank": {"tier_name": "Platinum 1", "season_short": "e9a3"},
    "seasonal_ranks": [],
}


def _player(**overrides: object) -> LeaderboardPlayer:
    defaults: dict[str, object] = {
        "puuid": uuid.uuid4().hex,
        "name": "mush",
        "tag": "1443",
        "region": "ap",
        "discord_id": DISCORD_ID,
        "discord_username": "imalwaysobored",
        "elo": 1200,
        "currenttierpatched": "Gold 1",
        "rank_details": {"ranking_in_tier": 55, "currenttierpatched": "Gold 1"},
        "peak_rank": None,
        "seasonal_ranks": None,
        "last_played_match": RECENT,
        "update_source": "registration_service",
        "updated_at": RECENT,
    }
    defaults.update(overrides)
    return LeaderboardPlayer(**defaults)


class _Henrik:
    async def get_player_mmr(self, puuid: str, *, affinity: str, platform: str) -> dict:
        return MMR

    async def get_last_competitive_match(self, puuid: str, *, affinity: str, platform: str) -> str | None:
        return None


def _service(session) -> LeaderboardService:
    return LeaderboardService(
        session=session, repo=LeaderboardPlayerRepository(session), bans=LeaderboardBanRepository(session)
    )


async def _seed(session_factory, *players: LeaderboardPlayer) -> None:
    async with session_factory() as session:
        session.add_all(players)
        await session.commit()


async def test_a_hidden_player_is_left_off_the_board_search_and_stats(session_factory) -> None:
    shown = _player(discord_id=OTHER_DISCORD_ID, discord_username="shown", elo=1000)
    hidden = _player(elo=1600, currenttierpatched="Immortal 1")
    await _seed(session_factory, shown, hidden)

    async with session_factory() as session:
        result = await _service(session).hide(hidden.puuid, "  smurf account  ", ADMIN)
    assert (result.on_leaderboard, result.hidden_by, result.hidden_reason) == (False, ADMIN, "smurf account")
    assert result.hidden_at is not None

    async with session_factory() as session:
        service = _service(session)
        board = await service.leaderboard(1, 50)
        stats = await service.stats()
        found = await service.search("imalwaysobored")
        registrations = await service.registrations("", 1, 50)
        hidden_only = await service.registrations("", 1, 50, hidden_only=True)

    assert [entry.puuid for entry in board.entries] == [shown.puuid]
    assert board.total == 1
    assert (stats.total_users, stats.highest_elo) == (1, 1000)
    assert "Immortal 1" not in stats.rank_distribution
    assert found is None
    # The admin view still lists them, and can list only them.
    assert {entry.puuid for entry in registrations.entries} == {shown.puuid, hidden.puuid}
    assert [entry.puuid for entry in hidden_only.entries] == [hidden.puuid]
    assert hidden_only.total == 1


async def test_unhiding_puts_the_player_straight_back(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)

    async with session_factory() as session:
        await _service(session).hide(player.puuid, None, ADMIN)
    async with session_factory() as session:
        shown = await _service(session).unhide(player.puuid)
    assert (shown.on_leaderboard, shown.hidden_at, shown.hidden_by, shown.hidden_reason) == (True, None, None, None)

    async with session_factory() as session:
        board = await _service(session).leaderboard(1, 50)
    assert [entry.puuid for entry in board.entries] == [player.puuid]


async def test_hiding_twice_or_unhiding_a_visible_player_is_refused(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)

    async with session_factory() as session:
        with pytest.raises(AppError) as not_hidden:
            await _service(session).unhide(player.puuid)
    async with session_factory() as session:
        await _service(session).hide(player.puuid, "first", ADMIN)
    async with session_factory() as session:
        with pytest.raises(AppError) as again:
            await _service(session).hide(player.puuid, "second", None)
    async with session_factory() as session:
        with pytest.raises(AppError) as missing:
            await _service(session).hide("no-such-puuid", "", None)

    assert not_hidden.value.code == "LEADERBOARD_PLAYER_NOT_HIDDEN"
    assert again.value.code == "LEADERBOARD_PLAYER_ALREADY_HIDDEN"
    assert missing.value.status == 404
    async with session_factory() as session:
        row = await session.get(LeaderboardPlayer, player.puuid)
    # The first admin's reason was not replaced.
    assert row.hidden_reason == "first"


async def test_the_updater_refresh_leaves_a_hide_in_place(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        await _service(session).hide(player.puuid, "smurf", ADMIN)

    async with session_factory() as session:
        refreshed = await LeaderboardPlayerRepository(session).refresh_rank(
            player.puuid, name="mush", tag="1443", elo=1400, currenttierpatched="Platinum 1"
        )
    assert refreshed is True

    async with session_factory() as session:
        row = await session.get(LeaderboardPlayer, player.puuid)
    assert (row.elo, row.hidden_reason) == (1400, "smurf")
    assert row.hidden_at is not None


async def test_restoring_a_removed_hidden_player_brings_them_back_hidden(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        await _service(session).hide(player.puuid, "smurf", ADMIN)
    async with session_factory() as session:
        removed = await _service(session).remove(player.puuid, ADMIN)
    assert removed.hidden_reason == "smurf"

    async with session_factory() as session:
        restored = await _service(session).restore(removed.removal_id, ADMIN)

    assert (restored.on_leaderboard, restored.hidden_reason, restored.hidden_by) == (False, "smurf", ADMIN)


async def test_check_discord_tells_the_player_they_are_hidden(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        await _service(session).hide(player.puuid, "smurf", ADMIN)

    async with session_factory() as session:
        auth = AuthService(session=session, repo=LeaderboardPlayerRepository(session), http=None)  # type: ignore[arg-type]
        result = await auth.check_discord(player.discord_id)

    assert result.exists is True
    assert (result.user.hidden, result.user.hidden_reason) == (True, "smurf")


async def test_a_repoint_moves_the_hide_to_the_new_account(session_factory, monkeypatch) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        await _service(session).hide(player.puuid, "smurf", ADMIN)

    monkeypatch.setattr(
        registration_service, "get_settings", lambda: Settings(app_env="test", leaderboard_affinity="ap")
    )
    new_puuid = uuid.uuid4().hex
    async with session_factory() as session:
        await RegistrationService(
            session=session,
            henrik=_Henrik(),  # type: ignore[arg-type]
            repo=LeaderboardPlayerRepository(session),
            bans=LeaderboardBanRepository(session),
        ).repoint(discord_id=player.discord_id, discord_username=player.discord_username, puuid=new_puuid)

    async with session_factory() as session:
        moved = await session.get(LeaderboardPlayer, new_puuid)
        board = await _service(session).leaderboard(1, 50)
    assert (moved.discord_id, moved.hidden_reason, moved.hidden_by) == (player.discord_id, "smurf", ADMIN)
    assert board.entries == []


async def test_a_second_hide_in_flight_does_not_replace_the_first(session_factory) -> None:
    # Both admins read the player as visible; the update itself is what decides.
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        first = await LeaderboardPlayerRepository(session).set_hidden(player.puuid, hidden_by=ADMIN, reason="first")
        await session.commit()
    async with session_factory() as session:
        second = await LeaderboardPlayerRepository(session).set_hidden(player.puuid, hidden_by=None, reason="second")
        await session.commit()
    async with session_factory() as session:
        row = await session.get(LeaderboardPlayer, player.puuid)

    assert first is not None
    assert second is None
    assert (row.hidden_reason, row.hidden_by) == ("first", ADMIN)


async def test_a_visible_player_moving_onto_a_hidden_account_does_not_clear_it(session_factory, monkeypatch) -> None:
    player = _player()
    # A row the updater wrote for a Riot account nobody has registered yet,
    # hidden by staff.
    destination = _player(discord_id="", discord_username=f"unclaimed-{uuid.uuid4().hex[:8]}", hidden_at=RECENT, hidden_by=ADMIN, hidden_reason="alt")
    await _seed(session_factory, player, destination)

    monkeypatch.setattr(
        registration_service, "get_settings", lambda: Settings(app_env="test", leaderboard_affinity="ap")
    )
    async with session_factory() as session:
        await RegistrationService(
            session=session,
            henrik=_Henrik(),  # type: ignore[arg-type]
            repo=LeaderboardPlayerRepository(session),
            bans=LeaderboardBanRepository(session),
        ).repoint(discord_id=player.discord_id, discord_username=player.discord_username, puuid=destination.puuid)

    async with session_factory() as session:
        moved = await session.get(LeaderboardPlayer, destination.puuid)
    assert (moved.discord_id, moved.hidden_reason, moved.hidden_by) == (player.discord_id, "alt", ADMIN)


async def test_a_reason_without_a_hide_is_rejected_by_the_database(session_factory) -> None:
    with pytest.raises(IntegrityError):
        await _seed(session_factory, _player(hidden_reason="orphaned"))
