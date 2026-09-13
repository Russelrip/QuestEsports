"""``leaderboard_players`` data access (plan Task 1; spec §4).

``LeaderboardPlayerRepository`` is the only code that issues
``leaderboard_players`` queries/inserts/upserts. The leaderboard read is the
Sri Lankan filter: ``elo IS NOT NULL``, ``last_played_match >= now()-14d``, and
``currenttierpatched != 'Unrated'``, ordered ``elo DESC``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LeaderboardPlayer

_LEADERBOARD_FILTERS = (
    LeaderboardPlayer.elo.is_not(None),
    LeaderboardPlayer.currenttierpatched != "Unrated",
)
_LEADERBOARD_WINDOW = timedelta(weeks=2)


def is_listed(player: LeaderboardPlayer, now: datetime | None = None) -> bool:
    """Whether ``list_page`` would show this row — the same three filters, in Python.

    ``currenttierpatched != 'Unrated'`` is NULL (so false) in SQL for a NULL
    tier, which is why a missing tier counts as unlisted here too.
    """
    cutoff = (now or datetime.now(UTC)) - _LEADERBOARD_WINDOW
    return (
        player.elo is not None
        and player.currenttierpatched is not None
        and player.currenttierpatched != "Unrated"
        and player.last_played_match is not None
        and player.last_played_match >= cutoff
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class LeaderboardPlayerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_page(self, page: int, per_page: int) -> tuple[list[LeaderboardPlayer], int]:
        cutoff = datetime.now(UTC) - _LEADERBOARD_WINDOW
        filters = (*_LEADERBOARD_FILTERS, LeaderboardPlayer.last_played_match >= cutoff)
        rows = (await self._session.execute(
            select(LeaderboardPlayer).where(*filters)
            .order_by(LeaderboardPlayer.elo.desc())
            .offset((page - 1) * per_page).limit(per_page)
        )).scalars().all()
        total = (await self._session.execute(
            select(func.count()).select_from(LeaderboardPlayer).where(*filters)
        )).scalar_one()
        return rows, total

    async def list_all(self) -> list[LeaderboardPlayer]:
        """Every ``leaderboard_players`` row, ordered by ``puuid`` (R26; updater pull)."""
        return list((await self._session.execute(
            select(LeaderboardPlayer).order_by(LeaderboardPlayer.puuid)
        )).scalars().all())

    async def list_registrations(
        self, query: str, page: int, per_page: int
    ) -> tuple[list[LeaderboardPlayer], int]:
        """Every registration, listed or not, for the admin view.

        Unlike ``list_page`` nothing is filtered out: the rows an admin most
        needs to find are exactly the ones the public board hides. ``query``
        matches a Riot name, tag, ``name#tag``, Discord username or PUUID as a
        case-insensitive substring. Least recently refreshed first, so rows the
        updater keeps failing on sit at the top.
        """
        filters = []
        needle = query.strip().lstrip("@")
        if needle:
            pattern = f"%{_escape_like(needle)}%"
            filters.append(
                or_(
                    LeaderboardPlayer.name.ilike(pattern, escape="\\"),
                    LeaderboardPlayer.tag.ilike(pattern, escape="\\"),
                    (LeaderboardPlayer.name + "#" + LeaderboardPlayer.tag).ilike(pattern, escape="\\"),
                    LeaderboardPlayer.discord_username.ilike(pattern, escape="\\"),
                    LeaderboardPlayer.puuid.ilike(pattern, escape="\\"),
                )
            )
        rows = (await self._session.execute(
            select(LeaderboardPlayer).where(*filters)
            .order_by(LeaderboardPlayer.updated_at.asc(), LeaderboardPlayer.puuid)
            .offset((page - 1) * per_page).limit(per_page)
        )).scalars().all()
        total = (await self._session.execute(
            select(func.count()).select_from(LeaderboardPlayer).where(*filters)
        )).scalar_one()
        return list(rows), total

    async def delete(self, puuid: str) -> LeaderboardPlayer | None:
        """Delete one registration and return the row as it was, or ``None``.

        The caller commits. Nothing references ``leaderboard_players`` by key,
        so the delete cannot cascade into match, series or rating data.
        """
        return (await self._session.execute(
            delete(LeaderboardPlayer)
            .where(LeaderboardPlayer.puuid == puuid)
            .returning(LeaderboardPlayer)
            .execution_options(synchronize_session=False)
        )).scalar_one_or_none()

    async def refresh_rank(self, puuid: str, *, name: str, tag: str, **fields) -> bool:
        """Write the updater's fresh Riot data onto an EXISTING row and commit.

        ``False`` when the row is gone. The updater walks a list it read at the
        start of a pass that runs for most of an hour, so an admin can remove a
        player it has not reached yet; ``upsert`` would quietly re-insert them.

        Commits per player for the same reason ``update_name_tag`` does, and one
        more: a pass-long transaction held every refreshed row locked until the
        pass ended, so a removal would have waited the better part of an hour.
        """
        result = await self._session.execute(
            update(LeaderboardPlayer)
            .where(LeaderboardPlayer.puuid == puuid)
            .values(name=name, tag=tag, updated_at=func.now(), **fields)
            .execution_options(synchronize_session=False)
        )
        await self._session.commit()
        return result.rowcount > 0

    async def get_by_discord_username(self, discord_username: str) -> LeaderboardPlayer | None:
        return (await self._session.execute(
            select(LeaderboardPlayer)
            .where(func.lower(LeaderboardPlayer.discord_username) == discord_username.strip().lower())
            .limit(1)
        )).scalar_one_or_none()

    async def get_by_discord_id(self, discord_id: str) -> LeaderboardPlayer | None:
        """One row matching the given ``discord_id`` (snowflake or handle,
        stored as text), or ``None`` (R17)."""
        return (await self._session.execute(
            select(LeaderboardPlayer)
            .where(LeaderboardPlayer.discord_id == str(discord_id))
            .limit(1)
        )).scalar_one_or_none()

    async def get_stats(self) -> dict:
        total, highest, lowest, average = (await self._session.execute(
            select(func.count(), func.max(LeaderboardPlayer.elo), func.min(LeaderboardPlayer.elo), func.avg(LeaderboardPlayer.elo))
            .where(LeaderboardPlayer.elo.is_not(None))
        )).one()
        dist = (await self._session.execute(
            select(LeaderboardPlayer.currenttierpatched, func.count())
            .where(LeaderboardPlayer.currenttierpatched.is_not(None))
            .group_by(LeaderboardPlayer.currenttierpatched)
        )).all()
        return {
            "total_users": total,
            "highest_elo": highest if highest is not None else 0,
            "lowest_elo": lowest if lowest is not None else 0,
            "average_elo": round(average, 2) if average is not None else 0,
            "rank_distribution": {tier: cnt for tier, cnt in dist},
        }

    async def get_by_puuid(self, puuid: str) -> LeaderboardPlayer | None:
        return await self._session.get(LeaderboardPlayer, puuid)

    async def update_name_tag(self, puuid: str, name: str, tag: str) -> bool:
        """Correct name/tag drift on an EXISTING row (R33; name-audit).

        ``False`` when the row is missing — the audit only ever updates players
        that are already registered (never inserts, unlike ``upsert``). Commits
        per player (fix round 1): a per-player commit is what makes the audit's
        failure isolation actually preserve earlier corrections — a failed write
        for one player rolls back only that player's transaction, never the
        whole run.
        """
        row = await self._session.get(LeaderboardPlayer, puuid)
        if row is None:
            return False
        row.name = name
        row.tag = tag
        row.updated_at = datetime.now(UTC)
        await self._session.commit()
        return True

    async def update_discord_identity(self, puuid: str, discord_id: str, discord_username: str) -> bool:
        """Correct discord_id/discord_username drift on an EXISTING row (R39; discord-bot).

        ``False`` when the row is missing — the bot only ever corrects players
        that are already registered (never inserts, unlike ``upsert``). Commits
        per player (mirroring ``update_name_tag``): a failed write for one
        member rolls back only that member's write, never the whole bot pass.
        """
        row = await self._session.get(LeaderboardPlayer, puuid)
        if row is None:
            return False
        row.discord_id = discord_id
        row.discord_username = discord_username
        row.updated_at = datetime.now(UTC)
        await self._session.commit()
        return True

    async def rollback(self) -> None:
        """Roll back the current transaction (name-audit per-player isolation).

        After a failed per-player commit, resets the session so the remaining
        players are not poisoned by the aborted transaction (fix round 1).
        """
        await self._session.rollback()

    async def release_discord(self, puuid: str) -> None:
        """Detach the Discord owner from a row without deleting it.

        A registration is re-pointed by moving its Discord identity to a
        different PUUID, and this is the half that lets go. The old row stays:
        it is a real player's ranking history, tournament and series data point
        at it, and `discord_id` is unique-per-registration rather than the
        row's identity.

        Nothing is needed to hide the abandoned account from the leaderboard —
        `list_page` already filters on `last_played_match` inside the last two
        weeks, so an account somebody stopped playing falls off on its own
        rather than showing the same human twice.
        """
        await self._session.execute(
            update(LeaderboardPlayer)
            .where(LeaderboardPlayer.puuid == puuid)
            .values(discord_id="", discord_username="")
        )

    async def upsert(self, *, puuid: str, name: str, tag: str, region: str, **fields) -> LeaderboardPlayer:
        # ``discord_username`` is NOT NULL with no default: a bare INSERT that
        # omits it is rejected by Postgres BEFORE the ON CONFLICT arbiter fires
        # (the NOT NULL check precedes the unique-conflict check). Callers that
        # carry no Discord identity (the updater) therefore supply '' so the
        # proposed tuple is valid and the arbiter can run. On conflict the
        # Discord columns are deliberately NOT updated (see set_ below) — only
        # callers that passed them explicitly (registration) write them.
        insert_fields = dict(fields)
        insert_fields.setdefault("discord_id", "")
        insert_fields.setdefault("discord_username", "")
        stmt = pg_insert(LeaderboardPlayer).values(
            puuid=puuid, name=name, tag=tag, region=region, **insert_fields
        )
        # R27/R28: on conflict, correct name/tag drift (the updater is the
        # source of truth for the Riot identity), apply every passed ``fields``,
        # and stamp ``updated_at``; ``region`` is deliberately NOT updated
        # (valorantsl-new: "region intentionally not updated").
        stmt = (
            stmt.on_conflict_do_update(
                index_elements=[LeaderboardPlayer.puuid],
                set_={
                    "name": stmt.excluded.name,
                    "tag": stmt.excluded.tag,
                    **{k: stmt.excluded[k] for k in fields},
                    "updated_at": func.now(),
                },
            )
            .returning(LeaderboardPlayer)
            # Without this, an ORM INSERT ... ON CONFLICT DO UPDATE RETURNING
            # reuses any identity-map instance already loaded for the row's
            # primary key and returns its STALE attributes; populate_existing
            # forces the RETURNING columns onto the existing object.
            .execution_options(populate_existing=True)
        )
        return (await self._session.execute(stmt)).scalar_one()
