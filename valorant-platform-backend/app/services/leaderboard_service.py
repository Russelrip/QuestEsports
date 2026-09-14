"""Leaderboard read service (SDD 2026-08-14 leaderboard standardization, task 3).

Pure read paths over ``leaderboard_players`` (plan task 3; spec §4): the
paginated leaderboard, the top-N slice, the case-insensitive discord-username
search, and the aggregate stats. The Sri Lankan filter lives in the repository
(``LeaderboardPlayerRepository.list_page``), which the service never
duplicates; the 404 for an out-of-range page is raised by the router, not here.
The per-row entry mapping mirrors ``valorantsl-new`` ``database.py:164-185``
exactly (field-for-field, including ``peak_rank``/``peak_season`` extraction
and the dual-shape ``rank_details`` read).
"""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.models import LeaderboardPlayer, LeaderboardPlayerRemoval
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository, is_listed
from app.schemas.leaderboard import (
    LeaderboardEntry,
    LeaderboardPage,
    LeaderboardRegistration,
    LeaderboardRegistrationPage,
    LeaderboardRemoval,
    LeaderboardRemovalPage,
    LeaderboardRemovedRegistration,
    LeaderboardRestoredRegistration,
    LeaderboardStats,
)
from app.services.rank_field import get_rank_field


def _already_registered() -> AppError:
    return AppError(
        "LEADERBOARD_PLAYER_ALREADY_REGISTERED",
        409,
        "this player is registered on the leaderboard again, so there is nothing to restore",
    )


def _discord_taken() -> AppError:
    return AppError(
        "LEADERBOARD_DISCORD_ALREADY_REGISTERED",
        409,
        "this player's Discord account is now registered to another leaderboard player",
    )


class LeaderboardService:
    def __init__(self, session: AsyncSession, repo: LeaderboardPlayerRepository) -> None:
        self._session = session
        self._repo = repo

    async def leaderboard(self, page: int, per_page: int) -> LeaderboardPage:
        """One paginated page of leaderboard entries, newest-filtered and
        ``elo DESC`` (the repository owns the query)."""
        rows, total = await self._repo.list_page(page, per_page)
        entries = [self._to_entry(player) for player in rows]
        # valorantsl-new parity: an empty result still reports exactly 1 page.
        total_pages = math.ceil(total / per_page) if total > 0 else 1
        return LeaderboardPage(
            entries=entries,
            total=total,
            page=page,
            per_page=per_page,
            total_pages=total_pages,
        )

    async def top(self, count: int) -> list[LeaderboardEntry]:
        """The top ``count`` players: page-1 slice of the leaderboard."""
        return (await self.leaderboard(1, count)).entries

    async def search(self, discord_username: str) -> LeaderboardEntry | None:
        """Case-insensitive exact ``discord_username`` match, or ``None``."""
        player = await self._repo.get_by_discord_username(discord_username)
        if player is None:
            return None
        return self._to_entry(player)

    async def stats(self) -> LeaderboardStats:
        """Aggregate stats; ``average_elo`` is surfaced as a ``float``."""
        stats = await self._repo.get_stats()
        return LeaderboardStats(
            total_users=stats["total_users"],
            highest_elo=stats["highest_elo"],
            lowest_elo=stats["lowest_elo"],
            average_elo=float(stats["average_elo"]),
            rank_distribution=stats["rank_distribution"],
        )

    async def registrations(self, query: str, page: int, per_page: int) -> LeaderboardRegistrationPage:
        """Every registration matching ``query``, listed on the board or not."""
        rows, total = await self._repo.list_registrations(query, page, per_page)
        now = datetime.now(UTC)
        return LeaderboardRegistrationPage(
            entries=[self._to_registration(player, now) for player in rows],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=math.ceil(total / per_page) if total > 0 else 1,
        )

    async def remove(self, puuid: str, actor_id: str | None = None) -> LeaderboardRemovedRegistration:
        """Delete a registration and return what it was, with the removal id.

        The player drops off the board and out of the updater and Discord bot
        passes; they can register again later, or an admin can restore the
        removal. Whether the removal is justified is decided and audited by
        Quest, which is the only caller.
        """
        removal = await self._repo.remove(puuid, removed_by=actor_id)
        if removal is None:
            raise AppError("LEADERBOARD_PLAYER_NOT_FOUND", 404, "leaderboard player not found")
        await self._session.commit()
        return LeaderboardRemovedRegistration(
            **self._to_registration(removal, datetime.now(UTC)).model_dump(),
            removal_id=str(removal.id),
        )

    async def removals(self, query: str, page: int, per_page: int) -> LeaderboardRemovalPage:
        """Removals newest first, restored ones included, for the admin view."""
        rows, total = await self._repo.list_removals(query, page, per_page)
        return LeaderboardRemovalPage(
            entries=[
                self._to_removal(removal, registered_again=registered_again, superseded=superseded)
                for removal, registered_again, superseded in rows
            ],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=math.ceil(total / per_page) if total > 0 else 1,
        )

    async def restore(self, removal_id: str, actor_id: str | None = None) -> LeaderboardRestoredRegistration:
        """Put a removed registration back exactly as it was.

        Refused (409) when it was already restored, when the PUUID was removed
        again later (restore that removal instead), or when the PUUID or its
        Discord identity is registered again: restoring must never overwrite or
        duplicate a current registration.
        """
        try:
            parsed_id = uuid.UUID(removal_id)
        except ValueError:
            raise AppError("LEADERBOARD_REMOVAL_NOT_FOUND", 404, "leaderboard removal not found") from None
        removal = await self._repo.get_removal_for_update(parsed_id)
        if removal is None:
            raise AppError("LEADERBOARD_REMOVAL_NOT_FOUND", 404, "leaderboard removal not found")
        try:
            await self._refuse_unrestorable(removal)
            player = await self._repo.restore(removal, restored_by=actor_id)
            await self._session.commit()
        except IntegrityError:
            # A registration landed between the checks and the insert.
            await self._session.rollback()
            raise _already_registered() from None
        except AppError:
            await self._session.rollback()
            raise
        return LeaderboardRestoredRegistration(
            **self._to_registration(player, datetime.now(UTC)).model_dump(),
            removal_id=str(removal.id),
            removed_at=removal.removed_at.isoformat(),
            removed_by=removal.removed_by,
        )

    # ------------------------------------------------------------ internals

    async def _refuse_unrestorable(self, removal: LeaderboardPlayerRemoval) -> None:
        if removal.restored_at is not None:
            raise AppError(
                "LEADERBOARD_REMOVAL_ALREADY_RESTORED", 409, "this removal has already been restored"
            )
        if await self._repo.has_newer_removal(removal):
            raise AppError(
                "LEADERBOARD_REMOVAL_SUPERSEDED",
                409,
                "this player was removed again later; restore the most recent removal instead",
            )
        if await self._repo.get_by_puuid(removal.puuid) is not None:
            raise _already_registered()
        # discord_id '' is the "no Discord owner" value and may repeat. The
        # username is compared case-insensitively, so a handle that differs only
        # in case still counts as taken.
        if removal.discord_id and await self._repo.get_by_discord_id(removal.discord_id) is not None:
            raise _discord_taken()
        if removal.discord_username and await self._repo.get_by_discord_username(removal.discord_username) is not None:
            raise _discord_taken()

    @staticmethod
    def _to_registration(
        player: LeaderboardPlayer | LeaderboardPlayerRemoval, now: datetime
    ) -> LeaderboardRegistration:
        return LeaderboardRegistration(
            puuid=player.puuid,
            name=player.name,
            tag=player.tag,
            discord_username=player.discord_username,
            current_tier=player.currenttierpatched,
            elo=player.elo,
            last_played_match=player.last_played_match.isoformat()
            if player.last_played_match
            else None,
            update_source=player.update_source,
            updated_at=player.updated_at.isoformat(),
            on_leaderboard=is_listed(player, now),
        )

    @staticmethod
    def _to_removal(
        removal: LeaderboardPlayerRemoval, *, registered_again: bool, superseded: bool
    ) -> LeaderboardRemoval:
        return LeaderboardRemoval(
            removal_id=str(removal.id),
            puuid=removal.puuid,
            name=removal.name,
            tag=removal.tag,
            discord_username=removal.discord_username,
            current_tier=removal.currenttierpatched,
            elo=removal.elo,
            last_played_match=removal.last_played_match.isoformat() if removal.last_played_match else None,
            removed_at=removal.removed_at.isoformat(),
            removed_by=removal.removed_by,
            restored_at=removal.restored_at.isoformat() if removal.restored_at else None,
            restored_by=removal.restored_by,
            registered_again=registered_again,
            superseded=superseded,
            restorable=removal.restored_at is None and not registered_again and not superseded,
        )

    @staticmethod
    def _to_entry(player: LeaderboardPlayer) -> LeaderboardEntry:
        """Field-exact port of ``valorantsl-new`` ``database.py:164-185``."""
        peak_rank = player.peak_rank or {}
        return LeaderboardEntry(
            puuid=player.puuid,
            name=player.name,
            tag=player.tag,
            discord_username=player.discord_username,
            current_tier=player.currenttierpatched,
            elo=player.elo,
            rank_in_tier=get_rank_field(player.rank_details, "ranking_in_tier"),
            peak_rank=peak_rank.get("tier_name"),
            peak_season=peak_rank.get("season_short"),
            last_played_match=player.last_played_match.isoformat()
            if player.last_played_match
            else None,
        )
