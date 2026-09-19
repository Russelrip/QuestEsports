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
from app.db.models.leaderboard_ban import LeaderboardBan as LeaderboardBanRow
from app.db.repositories.leaderboard_ban_repository import BanStatus, LeaderboardBanRepository
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository, is_listed
from app.schemas.leaderboard import (
    LeaderboardBan,
    LeaderboardBanPage,
    LeaderboardBanResult,
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


def _player_not_found() -> AppError:
    return AppError("LEADERBOARD_PLAYER_NOT_FOUND", 404, "leaderboard player not found")


def _already_hidden() -> AppError:
    return AppError("LEADERBOARD_PLAYER_ALREADY_HIDDEN", 409, "this player is already hidden")


def _not_hidden() -> AppError:
    return AppError("LEADERBOARD_PLAYER_NOT_HIDDEN", 409, "this player is not hidden")


def _removal_not_found() -> AppError:
    return AppError("LEADERBOARD_REMOVAL_NOT_FOUND", 404, "leaderboard removal not found")


def _already_banned() -> AppError:
    return AppError("LEADERBOARD_PLAYER_ALREADY_BANNED", 409, "this player is already banned")


def _parse_id(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


class LeaderboardService:
    def __init__(
        self,
        session: AsyncSession,
        repo: LeaderboardPlayerRepository,
        bans: LeaderboardBanRepository | None = None,
    ) -> None:
        self._session = session
        self._repo = repo
        self._bans = bans or LeaderboardBanRepository(session)

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
        """Case-insensitive exact ``discord_username`` match, or ``None``.

        A hidden player (0020) is not found: the public search must not show
        what the board leaves out.
        """
        player = await self._repo.get_by_discord_username(discord_username)
        if player is None or player.hidden_at is not None:
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

    async def registrations(
        self, query: str, page: int, per_page: int, *, hidden_only: bool = False
    ) -> LeaderboardRegistrationPage:
        """Every registration matching ``query``, listed on the board or not."""
        rows, total = await self._repo.list_registrations(query, page, per_page, hidden_only=hidden_only)
        now = datetime.now(UTC)
        return LeaderboardRegistrationPage(
            entries=[self._to_registration(player, now) for player in rows],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=math.ceil(total / per_page) if total > 0 else 1,
        )

    async def hide(
        self, puuid: str, reason: str | None, actor_id: str | None = None
    ) -> LeaderboardRegistration:
        """Keep a registered player off the public board (0020).

        Nothing else changes: the player stays registered, the updater keeps
        their rank current and the Discord bot keeps their rank role. 409 when
        they are already hidden, so a second admin cannot silently replace the
        first one's reason.
        """
        player = await self._repo.get_by_puuid(puuid)
        if player is None:
            raise _player_not_found()
        if player.hidden_at is not None:
            raise _already_hidden()
        hidden = await self._repo.set_hidden(puuid, hidden_by=actor_id, reason=(reason or "").strip() or None)
        if hidden is None:
            # Hidden by another admin, or removed, between the read and the update.
            await self._session.rollback()
            if await self._repo.get_by_puuid(puuid) is None:
                raise _player_not_found()
            raise _already_hidden()
        await self._session.commit()
        return self._to_registration(hidden, datetime.now(UTC))

    async def unhide(self, puuid: str) -> LeaderboardRegistration:
        """Put a hidden player back on the public board (409 if not hidden)."""
        player = await self._repo.get_by_puuid(puuid)
        if player is None:
            raise _player_not_found()
        if player.hidden_at is None:
            raise _not_hidden()
        shown = await self._repo.clear_hidden(puuid)
        if shown is None:
            # Shown by another admin, or removed, between the read and the update.
            await self._session.rollback()
            if await self._repo.get_by_puuid(puuid) is None:
                raise _player_not_found()
            raise _not_hidden()
        await self._session.commit()
        return self._to_registration(shown, datetime.now(UTC))

    async def remove(self, puuid: str, actor_id: str | None = None) -> LeaderboardRemovedRegistration:
        """Delete a registration and return what it was, with the removal id.

        The player drops off the board and out of the updater and Discord bot
        passes; they can register again later, or an admin can restore the
        removal. Whether the removal is justified is decided and audited by
        Quest, which is the only caller.
        """
        removal = await self._repo.remove(puuid, removed_by=actor_id)
        if removal is None:
            raise _player_not_found()
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
                self._to_removal(removal, registered_again=registered_again, superseded=superseded, banned=banned)
                for removal, registered_again, superseded, banned in rows
            ],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=math.ceil(total / per_page) if total > 0 else 1,
        )

    async def restore(self, removal_id: str, actor_id: str | None = None) -> LeaderboardRestoredRegistration:
        """Put a removed registration back exactly as it was.

        Refused (409) when it was already restored, when the PUUID was removed
        again later (restore that removal instead), when the PUUID or its
        Discord identity is registered again (restoring must never overwrite or
        duplicate a current registration), or while the player is banned.
        """
        parsed_id = _parse_id(removal_id)
        if parsed_id is None:
            raise _removal_not_found()
        # Restoring adds a registration, so it waits out a ban in progress the
        # way registration does. Taken before the row lock, in the same order as
        # a ban from a removal, so the two cannot deadlock.
        await self._bans.lock_for_registration()
        removal = await self._repo.get_removal_for_update(parsed_id)
        if removal is None:
            await self._session.rollback()
            raise _removal_not_found()
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

    async def bans(self, status: BanStatus, query: str, page: int, per_page: int) -> LeaderboardBanPage:
        """Bans newest first, for the admin view."""
        rows, total = await self._bans.list_bans(status, query, page, per_page)
        return LeaderboardBanPage(
            entries=[self._to_ban(ban) for ban in rows],
            total=total,
            page=page,
            per_page=per_page,
            total_pages=math.ceil(total / per_page) if total > 0 else 1,
        )

    async def ban_registration(
        self, puuid: str, reason: str | None, actor_id: str | None = None
    ) -> LeaderboardBanResult:
        """Ban a registered player and take them off the leaderboard in one step."""
        await self._bans.lock_for_ban()
        player = await self._repo.get_by_puuid(puuid)
        if player is None:
            await self._session.rollback()
            raise _player_not_found()
        return await self._ban(player, reason, actor_id)

    async def ban_removal(
        self, removal_id: str, reason: str | None, actor_id: str | None = None
    ) -> LeaderboardBanResult:
        """Ban a player who was already removed, by the identities the removal kept.

        Anything registered under either identity since then is removed too:
        that is the player coming back, which is what the ban is for.
        """
        parsed_id = _parse_id(removal_id)
        if parsed_id is None:
            raise _removal_not_found()
        await self._bans.lock_for_ban()
        removal = await self._repo.get_removal_for_update(parsed_id)
        if removal is None:
            await self._session.rollback()
            raise _removal_not_found()
        return await self._ban(removal, reason, actor_id)

    async def lift_ban(self, ban_id: str, actor_id: str | None = None) -> LeaderboardBan:
        """Let a banned player register again. The ban is kept, marked lifted."""
        parsed_id = _parse_id(ban_id)
        ban = await self._bans.get_for_update(parsed_id) if parsed_id else None
        if ban is None:
            await self._session.rollback()
            raise AppError("LEADERBOARD_BAN_NOT_FOUND", 404, "leaderboard ban not found")
        if ban.lifted_at is not None:
            await self._session.rollback()
            raise AppError("LEADERBOARD_BAN_ALREADY_LIFTED", 409, "this ban has already been lifted")
        await self._bans.lift(ban, lifted_by=actor_id)
        await self._session.commit()
        return self._to_ban(ban)

    # ------------------------------------------------------------ internals

    async def _ban(
        self,
        source: LeaderboardPlayer | LeaderboardPlayerRemoval,
        reason: str | None,
        actor_id: str | None,
    ) -> LeaderboardBanResult:
        """Ban ``source``'s PUUID and Discord id and remove whatever either holds.

        The caller holds the ban lock, so no registration can land between the
        removals and the commit. An identity another active ban already covers
        is left out of this one (one active ban per identity); when both are
        covered there is nothing to add and the ban is refused.
        """
        puuid = source.puuid or None
        # '' is the "no Discord owner" value, not an identity.
        discord_id = source.discord_id or None
        try:
            active = await self._bans.active_for(puuid=puuid, discord_id=discord_id)
            new_puuid = puuid if puuid not in {ban.puuid for ban in active} else None
            new_discord_id = discord_id if discord_id not in {ban.discord_id for ban in active} else None
            if new_puuid is None and new_discord_id is None:
                raise _already_banned()
            ban = await self._bans.create(
                puuid=new_puuid,
                discord_id=new_discord_id,
                name=source.name,
                tag=source.tag,
                discord_username=source.discord_username,
                reason=(reason or "").strip() or None,
                banned_by=actor_id,
            )
            held = [await self._repo.get_by_puuid(puuid) if puuid else None]
            if discord_id:
                held.append(await self._repo.get_by_discord_id(discord_id))
            removals = []
            for held_puuid in dict.fromkeys(player.puuid for player in held if player is not None):
                removal = await self._repo.remove(held_puuid, removed_by=actor_id)
                if removal is not None:
                    removals.append(removal)
            await self._session.commit()
        except IntegrityError:
            # Another ban of the same identity committed first.
            await self._session.rollback()
            raise _already_banned() from None
        except AppError:
            await self._session.rollback()
            raise
        now = datetime.now(UTC)
        return LeaderboardBanResult(
            ban=self._to_ban(ban),
            removed=[
                LeaderboardRemovedRegistration(
                    **self._to_registration(removal, now).model_dump(), removal_id=str(removal.id)
                )
                for removal in removals
            ],
        )

    async def _refuse_unrestorable(self, removal: LeaderboardPlayerRemoval) -> None:
        if removal.restored_at is not None:
            raise AppError(
                "LEADERBOARD_REMOVAL_ALREADY_RESTORED", 409, "this removal has already been restored"
            )
        if await self._bans.active_for(puuid=removal.puuid, discord_id=removal.discord_id or None):
            raise AppError(
                "LEADERBOARD_PLAYER_BANNED", 409, "this player is banned; lift the ban before restoring them"
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
            hidden_at=player.hidden_at.isoformat() if player.hidden_at else None,
            hidden_by=player.hidden_by,
            hidden_reason=player.hidden_reason,
        )

    @staticmethod
    def _to_ban(ban: LeaderboardBanRow) -> LeaderboardBan:
        return LeaderboardBan(
            ban_id=str(ban.id),
            puuid=ban.puuid,
            discord_banned=ban.discord_id is not None,
            name=ban.name,
            tag=ban.tag,
            discord_username=ban.discord_username,
            reason=ban.reason,
            banned_at=ban.banned_at.isoformat(),
            banned_by=ban.banned_by,
            lifted_at=ban.lifted_at.isoformat() if ban.lifted_at else None,
            lifted_by=ban.lifted_by,
            active=ban.lifted_at is None,
        )

    @staticmethod
    def _to_removal(
        removal: LeaderboardPlayerRemoval, *, registered_again: bool, superseded: bool, banned: bool = False
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
            banned=banned,
            restorable=removal.restored_at is None and not registered_again and not superseded and not banned,
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
