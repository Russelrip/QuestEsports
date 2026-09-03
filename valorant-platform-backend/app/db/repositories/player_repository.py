"""``players`` data access (plan Task 6; design §7.1).

``PlayerRepository`` is the only code that issues ``players`` queries/upserts.
PUUID is the durable identity key; ``name#tag`` is mutable display identity,
indexed case-insensitively (``players_lower_name_tag_idx``) but never unique.

Upsert semantics: PostgreSQL ``INSERT ... ON CONFLICT (puuid) DO UPDATE`` — a
single atomic statement, so concurrent resolves of the same PUUID can never
leak a unique violation and always converge to one canonical row. The insert
branch applies server defaults; the update branch refreshes current display
identity, platforms, affinity, ``henrik_updated_at``, ``updated_at`` and
``last_seen_at`` (the "last resolved-at"). ``first_seen_at``/``created_at``
are never in the update set, so they always survive.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Player


class PlayerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_puuid(self, puuid: str) -> Player | None:
        result = await self._session.execute(select(Player).where(Player.puuid == puuid))
        return result.scalar_one_or_none()

    async def get_by_id(self, player_id: uuid.UUID) -> Player | None:
        return await self._session.get(Player, player_id)

    async def get_by_name_tag(self, name: str, tag: str) -> Player | None:
        """Local-cache lookup on the case-insensitive ``(name, tag)`` index."""
        result = await self._session.execute(
            select(Player).where(
                func.lower(Player.current_name) == name.lower(),
                func.lower(Player.current_tag) == tag.lower(),
            )
        )
        return result.scalar_one_or_none()

    async def upsert_by_puuid(
        self,
        *,
        puuid: str,
        current_name: str,
        current_tag: str,
        affinity: str | None,
        platforms: list[str],
        henrik_updated_at: datetime | None,
    ) -> Player:
        # Single atomic INSERT ... ON CONFLICT DO UPDATE. The conflicting row's
        # first_seen_at/created_at are left untouched (not in ``set_``); the
        # update branch stamps last_seen_at/updated_at with DB transaction time.
        stmt = (
            pg_insert(Player)
            .values(
                puuid=puuid,
                current_name=current_name,
                current_tag=current_tag,
                affinity=affinity,
                platforms=platforms,
                henrik_updated_at=henrik_updated_at,
            )
            .on_conflict_do_update(
                index_elements=[Player.puuid],
                set_={
                    "current_name": current_name,
                    "current_tag": current_tag,
                    "affinity": affinity,
                    "platforms": platforms,
                    "henrik_updated_at": henrik_updated_at,
                    "last_seen_at": func.now(),
                    "updated_at": func.now(),
                },
            )
            .returning(Player)
            # Without this, an ORM INSERT ... ON CONFLICT DO UPDATE RETURNING
            # reuses any identity-map instance already loaded for the row's
            # primary key and returns its STALE attributes; populate_existing
            # forces the RETURNING columns onto the existing object.
            .execution_options(populate_existing=True)
        )
        result = await self._session.execute(stmt)
        # RETURNING fetches every column (including server defaults on insert),
        # so the returned instance is complete and safe to read post-commit.
        return result.scalar_one()

    async def upsert_imported(self, *, puuid: str, current_name: str, current_tag: str) -> Player:
        """Import-path upsert: display identity only, never account metadata.

        Canonical import observes a player's display identity (name/tag) inside
        a match payload, but the match payload carries no account-derived
        metadata (``affinity``, ``platforms``, ``henrik_updated_at``). This
        upsert therefore updates **only** ``current_name``/``current_tag`` (plus
        ``last_seen_at``/``updated_at``) on conflict, and leaves
        ``affinity``/``platforms``/``henrik_updated_at`` untouched — so a stale
        import can never erase a concurrent or earlier account resolution, and
        no fabricated fallback values are ever written. New rows start with
        NULL account metadata (filled by the next account resolve).
        """
        stmt = (
            pg_insert(Player)
            .values(
                puuid=puuid,
                current_name=current_name,
                current_tag=current_tag,
            )
            .on_conflict_do_update(
                index_elements=[Player.puuid],
                set_={
                    "current_name": current_name,
                    "current_tag": current_tag,
                    "last_seen_at": func.now(),
                    "updated_at": func.now(),
                },
            )
            .returning(Player)
            .execution_options(populate_existing=True)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one()
