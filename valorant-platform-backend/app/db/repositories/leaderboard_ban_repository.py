"""``leaderboard_bans`` data access (0019).

A ban names a Riot PUUID and/or a Discord id that may not register while it is
active. Registration and restore check it; banning also removes whatever is
registered under either identity.

Checking and writing are separate statements, so a registration could read "not
banned" while a ban of the same player commits. The advisory lock closes that:
banning holds it exclusively, and every write that would add a registration
holds it shared from its ban check until it commits. Registrations still run
alongside each other; they only wait for a ban in progress, and a ban only
waits for the registrations already past their check.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LeaderboardBan
from app.db.repositories.leaderboard_player_repository import MIN_QUERY_LENGTH

# Fixed forever once deployed: a changed key would split the lock between
# releases (see ``RATING_WORK_LOCK_KEY``). Visible in ``pg_locks`` as objid.
LEADERBOARD_BAN_LOCK_KEY = 7_301_993_450_219

BanStatus = Literal["active", "lifted", "all"]


def _active_match(puuid: str | None, discord_id: str | None):
    """Active bans naming ``puuid`` or ``discord_id``; ``None`` when neither is given.

    '' counts as absent: it is the "no Discord owner" value on registrations and
    must never match.
    """
    matches = []
    if puuid:
        matches.append(LeaderboardBan.puuid == puuid)
    if discord_id:
        matches.append(LeaderboardBan.discord_id == discord_id)
    if not matches:
        return None
    return (LeaderboardBan.lifted_at.is_(None), or_(*matches))


class LeaderboardBanRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def lock_for_registration(self) -> None:
        """Wait out any ban in progress; held until the transaction ends."""
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock_shared(:key)"), {"key": LEADERBOARD_BAN_LOCK_KEY}
        )

    async def lock_for_ban(self) -> None:
        """Wait out registrations past their ban check; held until the transaction ends."""
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": LEADERBOARD_BAN_LOCK_KEY}
        )

    async def active_for(self, *, puuid: str | None, discord_id: str | None) -> list[LeaderboardBan]:
        where = _active_match(puuid, discord_id)
        if where is None:
            return []
        return list((await self._session.execute(select(LeaderboardBan).where(*where))).scalars().all())

    async def create(self, **fields) -> LeaderboardBan:
        """Insert a ban; the caller commits. A second active ban of the same
        identity surfaces as ``IntegrityError`` on flush."""
        ban = LeaderboardBan(**fields)
        self._session.add(ban)
        await self._session.flush()
        await self._session.refresh(ban)
        return ban

    async def get_for_update(self, ban_id: uuid.UUID) -> LeaderboardBan | None:
        """One ban, row-locked so two lifts of it cannot both proceed."""
        return (await self._session.execute(
            select(LeaderboardBan).where(LeaderboardBan.id == ban_id).with_for_update()
        )).scalar_one_or_none()

    async def lift(self, ban: LeaderboardBan, *, lifted_by: str | None) -> LeaderboardBan:
        ban.lifted_at = datetime.now(UTC)
        ban.lifted_by = lifted_by
        await self._session.flush()
        return ban

    async def list_bans(
        self, status: BanStatus, query: str, page: int, per_page: int
    ) -> tuple[list[LeaderboardBan], int]:
        """Bans newest first. A query matches Riot name, ``name#tag`` or Discord
        username as a case-insensitive substring, like the removals list."""
        filters = []
        if status == "active":
            filters.append(LeaderboardBan.lifted_at.is_(None))
        elif status == "lifted":
            filters.append(LeaderboardBan.lifted_at.is_not(None))
        needle = query.strip().lstrip("@").lower()
        if len(needle) >= MIN_QUERY_LENGTH:
            pattern = f"%{needle}%"
            filters.append(or_(
                func.lower(LeaderboardBan.name + "#" + LeaderboardBan.tag).like(pattern),
                func.lower(LeaderboardBan.discord_username).like(pattern),
            ))
        rows = (await self._session.execute(
            select(LeaderboardBan)
            .where(*filters)
            .order_by(LeaderboardBan.banned_at.desc(), LeaderboardBan.id)
            .offset((page - 1) * per_page)
            .limit(per_page)
        )).scalars().all()
        total = (await self._session.execute(
            select(func.count()).select_from(LeaderboardBan).where(*filters)
        )).scalar_one()
        return list(rows), total
