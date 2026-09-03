"""``matches`` / ``match_players`` data access (plan Tasks 7–9; design §7.2–7.4, §8.3, §8.5).

``MatchRepository`` is the only code that issues ``matches`` /
``match_players`` SQL. Task 7 added the read helpers used by discovery (the
``already_imported`` batch lookup). Task 8 adds the full write surface for
canonical import: idempotency pre-check reads, transactional inserts, snapshot
persistence, refresh updates, and (fix round 1) the owning-series lock for the
refresh/finalize race protocol. Task 9 adds the Match Library read surface: the
filterable, keyset-paginated list (plus the matching count for ``total``) used
by the library service. Writes are never committed here — the import service
owns the transaction boundaries.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.errors import AppError
from app.db.models import Match, MatchPlayer, Series, SeriesGame


class MatchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------ reads (T7)
    async def get_imported_henrik_match_ids(self, henrik_match_ids: Iterable[str]) -> dict[str, uuid.UUID]:
        """Return ``{henrik_match_id: matches.id}`` for the given upstream ids.

        ``matches.henrik_match_id`` is unique, so membership is exact. This is
        the ``already_imported`` + candidate ``match_id`` lookup used by
        two-player discovery: a henrik id present in the returned dict is
        already imported, and its value is the internal UUID a caller needs to
        attach it. An empty input returns an empty dict without issuing SQL.
        """
        ids = set(henrik_match_ids)
        if not ids:
            return {}
        result = await self._session.execute(
            select(Match.henrik_match_id, Match.id).where(Match.henrik_match_id.in_(ids))
        )
        return {henrik_id: match_id for henrik_id, match_id in result}

    async def get_attached_henrik_match_ids(self, henrik_match_ids: Iterable[str]) -> set[str]:
        """Which of the given upstream match ids are attached to any series.

        A match is "attached" when its canonical ``matches`` row is referenced
        by a ``series_games`` row (imported AND part of a series). Because
        ``series_games.match_id`` is unique, a match belongs to at most one
        series, so once attached it must never reappear as a discovery
        candidate. The candidate exclusion is a pure membership test over the
        returned set (``NOT EXISTS`` over games, filtered by the caller by
        ``henrik_match_id``). An empty input returns an empty set.
        """
        ids = set(henrik_match_ids)
        if not ids:
            return set()
        result = await self._session.execute(
            select(Match.henrik_match_id)
            .where(Match.henrik_match_id.in_(ids))
            .where(exists(select(SeriesGame.match_id).where(SeriesGame.match_id == Match.id)))
        )
        return {row[0] for row in result}

    # ------------------------------------------------------- reads (Task 8)
    async def get_by_henrik_match_id(self, henrik_match_id: str) -> Match | None:
        """Idempotency pre-check: the canonical match row, if already imported."""
        result = await self._session.execute(select(Match).where(Match.henrik_match_id == henrik_match_id))
        return result.scalar_one_or_none()

    async def get_by_id(self, match_id: uuid.UUID) -> Match | None:
        return await self._session.get(Match, match_id)

    async def get_matches_by_ids(self, match_ids: set[uuid.UUID]) -> list[Match]:
        """Batch match lookup by internal id (series game views resolve
        ``map_name`` through this; an empty input returns an empty list)."""
        if not match_ids:
            return []
        result = await self._session.execute(select(Match).where(Match.id.in_(match_ids)))
        return list(result.scalars())

    async def get_players_for_match(self, match_id: uuid.UUID) -> list[MatchPlayer]:
        """Return the persisted participant snapshots for a match.

        Ordered deterministically by ``id`` (no upstream-order column exists),
        so repeated detail reads return participants in a stable order.
        """
        result = await self._session.execute(
            select(MatchPlayer).where(MatchPlayer.match_id == match_id).order_by(MatchPlayer.id)
        )
        return list(result.scalars())

    async def get_anchor_player_sides(
        self, match_ids: list[uuid.UUID], anchor_a: str, anchor_b: str
    ) -> dict[uuid.UUID, dict[str, str]]:
        """``{match_id: {puuid: side}}`` for the two anchors among the matches.

        Pre-filtered to the two anchor puuids — the only rows the anchor
        verification reads (spec §5.5).
        """
        if not match_ids:
            return {}
        result = await self._session.execute(
            select(MatchPlayer.match_id, MatchPlayer.puuid_snapshot, MatchPlayer.side).where(
                MatchPlayer.match_id.in_(match_ids),
                MatchPlayer.puuid_snapshot.in_((anchor_a, anchor_b)),
            )
        )
        sides: dict[uuid.UUID, dict[str, str]] = {}
        for match_id, puuid, side in result:
            sides.setdefault(match_id, {})[puuid] = side
        return sides

    async def get_anchor_opposing_matches(
        self, anchor_a: str | None, anchor_b: str | None
    ) -> list[tuple[Match, str]]:
        """Matches where both anchors played on opposing sides + ``anchor_a_side``.

        A match qualifies when ``anchor_a`` and ``anchor_b`` both appear in
        ``match_players`` (by ``puuid_snapshot``) on DIFFERENT sides; each
        returned pair is ``(match, anchor_a_side)``. Ordered like the Match
        Library list (``started_at DESC, id DESC``). An empty list is returned
        when either anchor is ``None`` — a series without anchors has no
        anchor-relevant matches.
        """
        if anchor_a is None or anchor_b is None:
            return []
        mp_a = aliased(MatchPlayer, name="anchor_a")
        mp_b = aliased(MatchPlayer, name="anchor_b")
        stmt = (
            select(Match, mp_a.side.label("anchor_a_side"))
            .join(mp_a, and_(Match.id == mp_a.match_id, mp_a.puuid_snapshot == anchor_a))
            .join(mp_b, and_(Match.id == mp_b.match_id, mp_b.puuid_snapshot == anchor_b))
            .where(mp_a.side != mp_b.side)
            .order_by(Match.started_at.desc(), Match.id.desc())
        )
        result = await self._session.execute(stmt)
        return [(match, side) for match, side in result]

    # ------------------------------------------------- reads (Task 9, Match Library)
    async def list_matches(
        self,
        *,
        map_name: str | None = None,
        from_: datetime | None = None,
        to: datetime | None = None,
        player_puuid: str | None = None,
        limit: int,
        cursor: uuid.UUID | None = None,
    ) -> tuple[list[Match], uuid.UUID | None]:
        """Match Library list: filters + keyset cursor pagination (design §8.5).

        Ordering is deterministic: ``started_at DESC, id DESC``, so pages are
        stable even when ``started_at`` ties. ``cursor`` is the internal UUID
        of the last row of the previous page; it is resolved (against the
        *same active filters* — a cross-filter cursor is rejected, never
        silently accepted) to that row's ``(started_at, id)`` tuple and used as
        the keyset anchor, so page boundaries never shift when new rows land
        between pages. Returns ``(rows, next_cursor)``: at most ``limit`` rows
        plus the id of the last returned row when another page exists
        (``limit + 1`` is fetched to detect it), else ``None``. A cursor that
        does not exist or does not satisfy the active filters raises
        ``MATCH_NOT_FOUND`` 404 (fix round 1).
        """
        conditions = _match_filters(map_name=map_name, from_=from_, to=to, player_puuid=player_puuid)
        stmt = select(Match).where(*conditions).order_by(Match.started_at.desc(), Match.id.desc())
        if cursor is not None:
            # Resolve the anchor within the filtered set (not the whole table):
            # a cursor from a different filter window is invalid and must not
            # skip rows arbitrarily in this window.
            anchor = (
                await self._session.execute(select(Match).where(*conditions, Match.id == cursor))
            ).scalar_one_or_none()
            if anchor is None:
                raise AppError("MATCH_NOT_FOUND", 404, "cursor match not found")
            stmt = stmt.where(
                or_(
                    Match.started_at < anchor.started_at,
                    and_(Match.started_at == anchor.started_at, Match.id < anchor.id),
                )
            )
        rows = list((await self._session.execute(stmt.limit(limit + 1))).scalars())
        if len(rows) <= limit:
            return rows, None
        return rows[:limit], rows[limit - 1].id

    async def count_matches(
        self,
        *,
        map_name: str | None = None,
        from_: datetime | None = None,
        to: datetime | None = None,
        player_puuid: str | None = None,
    ) -> int:
        """Count matches matching the list filters (ignoring limit/cursor) —
        the ``total`` for a Match Library list response."""
        conditions = _match_filters(map_name=map_name, from_=from_, to=to, player_puuid=player_puuid)
        result = await self._session.execute(select(func.count()).select_from(Match).where(*conditions))
        return int(result.scalar_one())

    # ----------------------------------------------------------- writes (T8)
    async def insert_match(
        self,
        *,
        henrik_match_id: str,
        affinity: str,
        platform: str,
        map_id: str | None,
        map_name: str,
        mode: str | None,
        queue: str | None,
        started_at,
        duration_ms: int | None,
        is_completed: bool,
        red_score: int | None,
        blue_score: int | None,
        winning_side: str | None,
        game_version: str | None,
        raw_payload: dict,
    ) -> Match:
        """Persist a canonical match row (``henrik_match_id`` is unique).

        Server defaults (``id``, ``imported_at``, timestamps) are fetched via
        RETURNING on flush, so the returned row is fully populated and safe to
        read after the caller commits.
        """
        match = Match(
            henrik_match_id=henrik_match_id,
            affinity=affinity,
            platform=platform,
            map_id=map_id,
            map_name=map_name,
            mode=mode,
            queue=queue,
            started_at=started_at,
            duration_ms=duration_ms,
            is_completed=is_completed,
            red_score=red_score,
            blue_score=blue_score,
            winning_side=winning_side,
            game_version=game_version,
            raw_payload=raw_payload,
        )
        self._session.add(match)
        await self._session.flush()
        return match

    async def insert_match_players(self, *, match_id: uuid.UUID, snapshots: list[dict]) -> list[MatchPlayer]:
        """Persist participant snapshots for a match; the unique
        ``(match_id, player_id)`` constraint guards against duplicates."""
        rows = [MatchPlayer(match_id=match_id, **snapshot) for snapshot in snapshots]
        self._session.add_all(rows)
        await self._session.flush()
        return rows

    async def update_match(self, *, match_id: uuid.UUID, **values) -> Match:
        """Update an existing match row in place (import ``refresh`` path)."""
        match = await self.get_by_id(match_id)
        if match is None:
            raise AppError("MATCH_NOT_FOUND", 404, "match not found")
        for key, value in values.items():
            setattr(match, key, value)
        await self._session.flush()
        return match

    async def replace_match_players(self, *, match_id: uuid.UUID, snapshots: list[dict]) -> list[MatchPlayer]:
        """Replace a match's snapshots (import ``refresh`` path)."""
        await self._session.execute(delete(MatchPlayer).where(MatchPlayer.match_id == match_id))
        return await self.insert_match_players(match_id=match_id, snapshots=snapshots)

    async def get_owning_series_for_update(self, match_id: uuid.UUID) -> Series | None:
        """Lock the series that owns ``match_id`` (via ``series_games``) FOR UPDATE.

        Part of the import-refresh contract (Task 15 fix round 1): refreshing a
        match attached to a series must serialize against finalization of that
        series. The owning series row is locked in the caller's transaction, so
        a refresh and a finalize can never interleave on the canonical state —
        whoever acquires the series lock first wins, and the loser re-reads the
        post-commit state: a finalize that follows a committed refresh rates on
        the refreshed scores, and a refresh that follows a committed finalize
        sees ``status='finalized'`` and is rejected. Returns ``None`` when the
        match is not attached to any series (refreshing it needs no lock).
        """
        result = await self._session.execute(
            select(Series)
            .join(SeriesGame, SeriesGame.series_id == Series.id)
            .where(SeriesGame.match_id == match_id)
            .with_for_update(of=Series)
        )
        return result.scalars().first()


def _match_filters(
    *,
    map_name: str | None,
    from_: datetime | None,
    to: datetime | None,
    player_puuid: str | None,
) -> list:
    """Shared WHERE conditions for the Match Library list and count queries.

    ``map`` → ``map_name`` equality; ``from``/``to`` → inclusive ``started_at``
    range; ``player_puuid`` → the puuid exists among the match's participant
    snapshots (``match_players.puuid_snapshot``).
    """
    conditions: list = []
    if map_name is not None:
        conditions.append(Match.map_name == map_name)
    if from_ is not None:
        conditions.append(Match.started_at >= from_)
    if to is not None:
        conditions.append(Match.started_at <= to)
    if player_puuid is not None:
        conditions.append(
            Match.id.in_(select(MatchPlayer.match_id).where(MatchPlayer.puuid_snapshot == player_puuid))
        )
    return conditions
