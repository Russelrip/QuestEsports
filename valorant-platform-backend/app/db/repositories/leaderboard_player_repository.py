"""``leaderboard_players`` data access (plan Task 1; spec §4).

``LeaderboardPlayerRepository`` is the only code that issues
``leaderboard_players`` queries/inserts/upserts. The leaderboard read is the
Sri Lankan filter: ``elo IS NOT NULL``, ``last_played_match >= now()-14d``, and
``currenttierpatched != 'Unrated'``, and not hidden by an admin (0020), ordered
``elo DESC``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LeaderboardBan, LeaderboardPlayer, LeaderboardPlayerRemoval
from app.db.models.leaderboard_player_removal import REGISTRATION_COLUMNS

_LEADERBOARD_FILTERS = (
    LeaderboardPlayer.elo.is_not(None),
    LeaderboardPlayer.currenttierpatched != "Unrated",
    # Hidden by an admin (0020): still registered, just not on the public board.
    LeaderboardPlayer.hidden_at.is_(None),
)
_LEADERBOARD_WINDOW = timedelta(weeks=2)


def is_listed(player: LeaderboardPlayer, now: datetime | None = None) -> bool:
    """Whether ``list_page`` would show this row — the same filters, in Python.

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
        and player.hidden_at is None
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# Below this a search matches nearly every row, so it is treated as no search.
MIN_QUERY_LENGTH = 2
# Riot tags are 3-5 characters, so a bare hit on one is mostly noise: it still
# matches, but always sorts below a name or Discord hit.
TAG_PENALTY = 3


def _field_score(column, needle: str):
    """0 exact, 1 prefix, 2 substring, NULL no match. ``needle`` is lowercase."""
    escaped = _escape_like(needle)
    value = func.lower(column)
    return case(
        (value == needle, 0),
        (value.like(f"{escaped}%", escape="\\"), 1),
        (value.like(f"%{escaped}%", escape="\\"), 2),
        else_=None,
    )


def _match_score(needle: str):
    """A row's best score across the searchable fields, NULL when none match.

    PostgreSQL's ``LEAST`` ignores NULL arguments, so only a row that no field
    matches comes out NULL. The full ``name#tag`` only counts when the query
    has a ``#``: otherwise every tag hit is also a substring of ``name#tag`` and
    would score as a name match, cancelling the tag penalty.
    """
    fields = [
        _field_score(LeaderboardPlayer.discord_username, needle),
        _field_score(LeaderboardPlayer.name, needle),
        _field_score(LeaderboardPlayer.puuid, needle),
        _field_score(LeaderboardPlayer.tag, needle) + TAG_PENALTY,
    ]
    if "#" in needle:
        fields.append(_field_score(LeaderboardPlayer.name + "#" + LeaderboardPlayer.tag, needle))
    return func.least(*fields)


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
        self, query: str, page: int, per_page: int, *, hidden_only: bool = False
    ) -> tuple[list[LeaderboardPlayer], int]:
        """Every registration, listed or not, for the admin view.

        Unlike ``list_page`` nothing is filtered out: the rows an admin most
        needs to find are exactly the ones the public board hides.

        With a query, matching and ordering follow the public leaderboard
        search (Quest ``valorant-leaderboard/service.js``) so the two boxes
        behave the same: a Discord username, Riot name or ``name#tag`` scores 0
        for an exact match, 1 for a prefix and 2 for a substring, and a hit on
        the tag alone scores ``TAG_PENALTY`` higher. The admin view also matches
        a PUUID. Best score first, then highest ELO. A query shorter than
        ``MIN_QUERY_LENGTH`` once a leading ``@`` is dropped is ignored, as on
        the public page.

        Without a query, least recently refreshed first, so rows the updater
        keeps failing on sit at the top. ``hidden_only`` keeps the rows an admin
        hid from the board (0020), most recently hidden first when there is no
        query.
        """
        needle = query.strip().lstrip("@").lower()
        if len(needle) < MIN_QUERY_LENGTH:
            needle = ""

        statement = select(LeaderboardPlayer)
        count = select(func.count()).select_from(LeaderboardPlayer)
        if hidden_only:
            statement = statement.where(LeaderboardPlayer.hidden_at.is_not(None))
            count = count.where(LeaderboardPlayer.hidden_at.is_not(None))
        if needle:
            score = _match_score(needle)
            statement = statement.where(score.is_not(None)).order_by(
                score.asc(),
                LeaderboardPlayer.elo.desc().nulls_last(),
                func.lower(LeaderboardPlayer.name),
                LeaderboardPlayer.puuid,
            )
            count = count.where(score.is_not(None))
        elif hidden_only:
            statement = statement.order_by(LeaderboardPlayer.hidden_at.desc(), LeaderboardPlayer.puuid)
        else:
            statement = statement.order_by(LeaderboardPlayer.updated_at.asc(), LeaderboardPlayer.puuid)

        rows = (await self._session.execute(
            statement.offset((page - 1) * per_page).limit(per_page)
        )).scalars().all()
        total = (await self._session.execute(count)).scalar_one()
        return list(rows), total

    async def remove(self, puuid: str, *, removed_by: str | None) -> LeaderboardPlayerRemoval | None:
        """Delete one registration, keeping a copy that can be restored; ``None`` if absent.

        The copy is written in the same transaction as the delete, so a removal
        can never happen without it. The caller commits. Nothing references
        ``leaderboard_players`` by key, so the delete cannot cascade into match,
        series or rating data.
        """
        player = (await self._session.execute(
            delete(LeaderboardPlayer)
            .where(LeaderboardPlayer.puuid == puuid)
            .returning(LeaderboardPlayer)
            .execution_options(synchronize_session=False)
        )).scalar_one_or_none()
        if player is None:
            return None
        removal = LeaderboardPlayerRemoval(
            **{column: getattr(player, column) for column in REGISTRATION_COLUMNS},
            removed_by=removed_by,
        )
        self._session.add(removal)
        await self._session.flush()
        await self._session.refresh(removal)
        return removal

    async def list_removals(
        self, query: str, page: int, per_page: int
    ) -> tuple[list[tuple[LeaderboardPlayerRemoval, bool, bool, bool]], int]:
        """Removals newest first, each with ``(registered_again, superseded, banned)``.

        ``registered_again``: the PUUID has a registration now, so restoring
        would collide. ``superseded``: the PUUID was removed again later, and
        only the latest removal is the one to restore. ``banned``: an active ban
        names the PUUID or the Discord id. A query matches Riot name,
        ``name#tag`` or Discord username as a case-insensitive substring.
        """
        needle = query.strip().lstrip("@").lower()
        registered_again = exists().where(LeaderboardPlayer.puuid == LeaderboardPlayerRemoval.puuid)
        newer = LeaderboardPlayerRemoval.__table__.alias("newer")
        superseded = exists().where(
            newer.c.puuid == LeaderboardPlayerRemoval.puuid,
            newer.c.removed_at > LeaderboardPlayerRemoval.removed_at,
        )
        banned = exists().where(
            LeaderboardBan.lifted_at.is_(None),
            or_(
                LeaderboardBan.puuid == LeaderboardPlayerRemoval.puuid,
                LeaderboardBan.discord_id == func.nullif(LeaderboardPlayerRemoval.discord_id, ""),
            ),
        )
        filters = []
        if len(needle) >= MIN_QUERY_LENGTH:
            pattern = f"%{needle}%"
            filters.append(or_(
                func.lower(LeaderboardPlayerRemoval.name + "#" + LeaderboardPlayerRemoval.tag).like(pattern),
                func.lower(LeaderboardPlayerRemoval.discord_username).like(pattern),
            ))
        rows = (await self._session.execute(
            select(LeaderboardPlayerRemoval, registered_again.label("registered_again"), superseded.label("superseded"),
                   banned.label("banned"))
            .where(*filters)
            .order_by(LeaderboardPlayerRemoval.removed_at.desc(), LeaderboardPlayerRemoval.id)
            .offset((page - 1) * per_page)
            .limit(per_page)
        )).all()
        total = (await self._session.execute(
            select(func.count()).select_from(LeaderboardPlayerRemoval).where(*filters)
        )).scalar_one()
        return [(row[0], bool(row[1]), bool(row[2]), bool(row[3])) for row in rows], total

    async def get_removal_for_update(self, removal_id: uuid.UUID) -> LeaderboardPlayerRemoval | None:
        """One removal, row-locked so two restores of it cannot both proceed."""
        return (await self._session.execute(
            select(LeaderboardPlayerRemoval)
            .where(LeaderboardPlayerRemoval.id == removal_id)
            .with_for_update()
        )).scalar_one_or_none()

    async def has_newer_removal(self, removal: LeaderboardPlayerRemoval) -> bool:
        return bool((await self._session.execute(
            select(exists().where(
                LeaderboardPlayerRemoval.puuid == removal.puuid,
                LeaderboardPlayerRemoval.removed_at > removal.removed_at,
            ))
        )).scalar_one())

    async def restore(self, removal: LeaderboardPlayerRemoval, *, restored_by: str | None) -> LeaderboardPlayer:
        """Re-insert the removed row exactly as it was and mark the removal restored.

        A plain INSERT, never an upsert: a registration that exists again must
        make this fail rather than be overwritten. The caller checks for that
        first and commits; a unique violation from a race surfaces as
        ``IntegrityError``.
        """
        player = LeaderboardPlayer(**{column: getattr(removal, column) for column in REGISTRATION_COLUMNS})
        self._session.add(player)
        removal.restored_at = datetime.now(UTC)
        removal.restored_by = restored_by
        await self._session.flush()
        return player

    async def set_hidden(
        self, puuid: str, *, hidden_by: str | None, reason: str | None
    ) -> LeaderboardPlayer | None:
        """Hide a registration from the public board (0020); ``None`` if absent or already hidden.

        Only the three hidden columns change, so the updater's concurrent
        ``refresh_rank`` of the same row cannot undo it. Only a visible row is
        updated, so of two admins hiding at once the second gets ``None`` rather
        than replacing the first one's reason. The caller commits.
        """
        return (await self._session.execute(
            update(LeaderboardPlayer)
            .where(LeaderboardPlayer.puuid == puuid, LeaderboardPlayer.hidden_at.is_(None))
            .values(hidden_at=func.now(), hidden_by=hidden_by, hidden_reason=reason)
            .returning(LeaderboardPlayer)
            .execution_options(populate_existing=True, synchronize_session=False)
        )).scalar_one_or_none()

    async def clear_hidden(self, puuid: str) -> LeaderboardPlayer | None:
        """Put a hidden registration back on the board; ``None`` if absent or not hidden. The caller commits."""
        return (await self._session.execute(
            update(LeaderboardPlayer)
            .where(LeaderboardPlayer.puuid == puuid, LeaderboardPlayer.hidden_at.is_not(None))
            .values(hidden_at=None, hidden_by=None, hidden_reason=None)
            .returning(LeaderboardPlayer)
            .execution_options(populate_existing=True, synchronize_session=False)
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
            .where(LeaderboardPlayer.elo.is_not(None), LeaderboardPlayer.hidden_at.is_(None))
        )).one()
        dist = (await self._session.execute(
            select(LeaderboardPlayer.currenttierpatched, func.count())
            .where(LeaderboardPlayer.currenttierpatched.is_not(None), LeaderboardPlayer.hidden_at.is_(None))
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
