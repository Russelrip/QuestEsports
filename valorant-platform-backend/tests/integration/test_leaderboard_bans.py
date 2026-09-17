"""Real-Postgres leaderboard ban tests (migration 0019).

A ban names a PUUID and/or a Discord id. Banning removes every registration
holding either, registration and restore refuse either while the ban is active,
and lifting keeps the ban as history. Skipped when ``TEST_DATABASE_URL`` is
unset (see conftest).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.errors import AppError
from app.config import Settings
from app.db.models import LeaderboardBan, LeaderboardPlayer, LeaderboardPlayerRemoval
from app.db.repositories.leaderboard_ban_repository import LeaderboardBanRepository
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.services import registration_service
from app.services.leaderboard_service import LeaderboardService
from app.services.registration_service import RegistrationService

RECENT = datetime.now(UTC) - timedelta(days=1)
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
        "discord_id": "700000000000000001",
        "discord_username": "imalwaysobored",
        "elo": 1200,
        "currenttierpatched": "Gold 1",
        "rank_details": {"ranking_in_tier": 55},
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


def _registration(session, monkeypatch, henrik=None) -> RegistrationService:
    monkeypatch.setattr(
        registration_service, "get_settings", lambda: Settings(app_env="test", leaderboard_affinity="ap")
    )
    return RegistrationService(
        session=session,
        henrik=henrik or _Henrik(),  # type: ignore[arg-type]
        repo=LeaderboardPlayerRepository(session),
        bans=LeaderboardBanRepository(session),
    )


async def _seed(session_factory, *players: LeaderboardPlayer) -> None:
    async with session_factory() as session:
        session.add_all(players)
        await session.commit()


async def _refusal(coro) -> AppError:
    with pytest.raises(AppError) as excinfo:
        await coro
    return excinfo.value


async def _count(session_factory, model) -> int:
    async with session_factory() as session:
        return (await session.execute(select(func.count()).select_from(model))).scalar_one()


async def test_banning_a_registration_removes_it_and_blocks_both_accounts(session_factory, monkeypatch) -> None:
    player = _player()
    await _seed(session_factory, player)

    async with session_factory() as session:
        result = await _service(session).ban_registration(player.puuid, "  alt accounts  ", ADMIN)

    assert [removed.puuid for removed in result.removed] == [player.puuid]
    assert result.ban.puuid == player.puuid
    assert result.ban.discord_banned is True
    assert (result.ban.name, result.ban.tag, result.ban.discord_username) == ("mush", "1443", "imalwaysobored")
    assert result.ban.reason == "alt accounts"
    assert (result.ban.banned_by, result.ban.active) == (ADMIN, True)

    async with session_factory() as session:
        assert await session.get(LeaderboardPlayer, player.puuid) is None
        removal = await session.get(LeaderboardPlayerRemoval, uuid.UUID(result.removed[0].removal_id))
        assert removal.removed_by == ADMIN

    # Same Riot account, different Discord: refused at preview and at submit.
    async with session_factory() as session:
        preview = await _refusal(_registration(session, monkeypatch).preview(player.puuid))
    async with session_factory() as session:
        same_riot = await _refusal(
            _registration(session, monkeypatch).submit(discord_id="999", discord_username="fresh", puuid=player.puuid)
        )
    # Same Discord, a brand new Riot account.
    async with session_factory() as session:
        same_discord = await _refusal(
            _registration(session, monkeypatch).submit(
                discord_id=player.discord_id, discord_username="imalwaysobored", puuid="alt-account"
            )
        )

    assert (preview.status, preview.code) == (403, "REGISTRATION_BANNED")
    assert "Riot account" in same_riot.message
    assert (same_discord.status, "Discord account" in same_discord.message) == (403, True)
    assert await _count(session_factory, LeaderboardPlayer) == 0


async def test_banning_from_a_removal_also_removes_an_alt_registered_since(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        removed = await _service(session).remove(player.puuid, ADMIN)
    # Back under a new Riot account with the same Discord, and someone unrelated.
    alt = _player(puuid="alt-account", name="mush2", tag="0001")
    bystander = _player(puuid="bystander", name="Other", discord_id="700000000000000002", discord_username="other")
    await _seed(session_factory, alt, bystander)

    async with session_factory() as session:
        result = await _service(session).ban_removal(removed.removal_id, "came back on an alt", ADMIN)
        page = await _service(session).removals("", 1, 20)

    assert result.ban.puuid == player.puuid
    assert [entry.puuid for entry in result.removed] == ["alt-account"]
    async with session_factory() as session:
        remaining = (await session.execute(select(LeaderboardPlayer.puuid))).scalars().all()
    assert remaining == ["bystander"]
    by_puuid = {entry.puuid: entry for entry in page.entries}
    assert (by_puuid[player.puuid].banned, by_puuid[player.puuid].restorable) == (True, False)
    assert by_puuid["alt-account"].banned is True, "the alt shares the banned Discord id"


async def test_restore_is_refused_while_banned_and_allowed_once_lifted(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        result = await _service(session).ban_registration(player.puuid, None, ADMIN)
    removal_id = result.removed[0].removal_id

    async with session_factory() as session:
        refusal = await _refusal(_service(session).restore(removal_id, "restorer"))
    async with session_factory() as session:
        lifted = await _service(session).lift_ban(result.ban.ban_id, "lifter")
    async with session_factory() as session:
        again = await _refusal(_service(session).lift_ban(result.ban.ban_id, "lifter"))
    async with session_factory() as session:
        restored = await _service(session).restore(removal_id, "restorer")

    assert (refusal.status, refusal.code) == (409, "LEADERBOARD_PLAYER_BANNED")
    assert (lifted.active, lifted.lifted_by) == (False, "lifter")
    assert lifted.lifted_at is not None
    assert (again.status, again.code) == (409, "LEADERBOARD_BAN_ALREADY_LIFTED")
    assert restored.puuid == player.puuid
    assert await _count(session_factory, LeaderboardBan) == 1, "a lifted ban is kept as history"


async def test_a_lifted_ban_lets_the_player_register_again(session_factory, monkeypatch) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        result = await _service(session).ban_registration(player.puuid, None, ADMIN)
    async with session_factory() as session:
        await _service(session).lift_ban(result.ban.ban_id, ADMIN)

    async with session_factory() as session:
        registered = await _registration(session, monkeypatch).submit(
            discord_id=player.discord_id, discord_username="imalwaysobored", puuid=player.puuid
        )

    assert registered.success is True
    assert await _count(session_factory, LeaderboardPlayer) == 1


async def test_banning_an_already_banned_player_is_409(session_factory) -> None:
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        result = await _service(session).ban_registration(player.puuid, None, ADMIN)

    async with session_factory() as session:
        refusal = await _refusal(_service(session).ban_removal(result.removed[0].removal_id, None, ADMIN))

    assert (refusal.status, refusal.code) == (409, "LEADERBOARD_PLAYER_ALREADY_BANNED")
    assert await _count(session_factory, LeaderboardBan) == 1


async def test_a_second_ban_only_covers_the_identity_not_already_banned(session_factory) -> None:
    # An older removal of the same Riot account under a different Discord owner.
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        old = await _service(session).remove(player.puuid, ADMIN)
    await _seed(session_factory, _player(puuid=player.puuid, discord_id="700000000000000003", discord_username="new"))
    async with session_factory() as session:
        await _service(session).ban_registration(player.puuid, None, ADMIN)

    async with session_factory() as session:
        second = await _service(session).ban_removal(old.removal_id, None, ADMIN)

    assert (second.ban.puuid, second.ban.discord_banned) == (None, True)
    assert second.removed == []


async def test_a_removal_without_a_discord_owner_bans_only_the_riot_account(session_factory, monkeypatch) -> None:
    player = _player(discord_id="", discord_username="")
    await _seed(session_factory, player)

    async with session_factory() as session:
        result = await _service(session).ban_registration(player.puuid, None, ADMIN)
    # '' must not be treated as a banned Discord id.
    async with session_factory() as session:
        other = await _registration(session, monkeypatch).submit(
            discord_id="700000000000000009", discord_username="someone", puuid="someone-else"
        )

    assert (result.ban.puuid, result.ban.discord_banned) == (player.puuid, False)
    assert other.success is True


async def test_the_database_allows_one_active_ban_per_identity(session_factory) -> None:
    async with session_factory() as session:
        session.add(LeaderboardBan(puuid="p1", discord_id="d1"))
        await session.commit()
    async with session_factory() as session:
        session.add(LeaderboardBan(discord_id="d1"))
        with pytest.raises(IntegrityError):
            await session.commit()
    async with session_factory() as session:
        ban = (await session.execute(select(LeaderboardBan))).scalar_one()
        ban.lifted_at = datetime.now(UTC)
        session.add(LeaderboardBan(puuid="p1", discord_id="d1"))
        await session.commit()
    async with session_factory() as session:
        session.add(LeaderboardBan(discord_id=""))
        with pytest.raises(IntegrityError):
            await session.commit()


async def test_a_registration_already_past_its_check_is_removed_by_a_concurrent_ban(
    session_factory, monkeypatch
) -> None:
    """The ban waits for the registration holding the lock, then removes it."""
    player = _player()
    await _seed(session_factory, player)
    async with session_factory() as session:
        removed = await _service(session).remove(player.puuid, ADMIN)

    registering = asyncio.Event()
    release = asyncio.Event()

    class _SlowCommitSession:
        """Pauses the registration after its write, holding the shared lock."""

        def __init__(self, session) -> None:
            self._session = session

        def __getattr__(self, name):
            return getattr(self._session, name)

        async def commit(self) -> None:
            registering.set()
            await release.wait()
            await self._session.commit()

    async def register() -> None:
        async with session_factory() as session:
            wrapped = _SlowCommitSession(session)
            svc = RegistrationService(
                session=wrapped,  # type: ignore[arg-type]
                henrik=_Henrik(),  # type: ignore[arg-type]
                repo=LeaderboardPlayerRepository(session),
                bans=LeaderboardBanRepository(session),
            )
            await svc.submit(discord_id=player.discord_id, discord_username="imalwaysobored", puuid=player.puuid)

    async def ban() -> None:
        await registering.wait()
        async with session_factory() as session:
            await _service(session).ban_removal(removed.removal_id, None, ADMIN)

    monkeypatch.setattr(
        registration_service, "get_settings", lambda: Settings(app_env="test", leaderboard_affinity="ap")
    )
    registration = asyncio.create_task(register())
    banning = asyncio.create_task(ban())
    await registering.wait()
    await asyncio.sleep(0.3)
    assert not banning.done(), "the ban must wait for the registration holding the lock"
    release.set()
    await asyncio.gather(registration, banning)

    assert await _count(session_factory, LeaderboardPlayer) == 0
