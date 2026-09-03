"""Match Library read service (plan Task 9; design §8.5, §14.3).

``MatchLibraryService`` is the durable read surface of Phase 1: list with
filters + keyset cursor pagination, detail by internal UUID, and detail by
canonical Henrik Match ID. Every read is served entirely from Supabase —
the service never touches a ``HenrikClient`` and never mutates data.

Raw payload handling (design §14.3): ``raw_payload_available`` is always
``True`` for imported matches (the full v4 envelope is retained in
``matches.raw_payload``); the *content* (``raw_payload``) is echoed only when
``Settings.raw_payload_in_responses`` opts in (and serialization omits the key
entirely when it is absent — never ``null``). List summaries never carry raw
content (the flag only) so pages stay lean. ``from``/``to`` bounds that are
timezone-naive are interpreted as UTC so comparisons against the database's
aware ``started_at`` never raise ``TypeError``.

Fix round 1 (review): ``MATCH_NOT_FOUND`` is built fresh at every raise via
``_match_not_found()`` — never a module-global instance — so traceback state
is never shared across calls or retained by a singleton. List ``total`` is a
separate point-in-time count query: under concurrent writes it is best-effort
and may briefly diverge from ``items``; ordering, filters, and the cursor
contract are otherwise fully deterministic.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.config import Settings, get_settings
from app.db.models import Match
from app.db.repositories.match_repository import MatchRepository
from app.schemas.matches import (
    MatchDetailResponse,
    MatchListResponse,
    MatchPlayerResponse,
    MatchSummaryResponse,
)

_MATCH_NOT_FOUND_MSG = "match not found"


def _match_not_found() -> AppError:
    """A fresh ``MATCH_NOT_FOUND`` instance per raise.

    Raising one shared module-global exception instance is unsafe: Python
    rebinds ``__traceback__`` on every raise, so a singleton churns/retains
    traceback state across calls and concurrent coroutines (review round 1).
    """
    return AppError("MATCH_NOT_FOUND", 404, _MATCH_NOT_FOUND_MSG)


class MatchLibraryService:
    def __init__(
        self,
        session: AsyncSession,
        match_repo: MatchRepository,
        settings: Settings | None = None,
    ) -> None:
        self._session = session
        self._match_repo = match_repo
        self._settings = settings if settings is not None else get_settings()

    async def list_matches(
        self,
        *,
        map_name: str | None,
        from_: datetime | None,
        to: datetime | None,
        player_puuid: str | None,
        limit: int,
        cursor: uuid.UUID | None,
    ) -> MatchListResponse:
        """Filtered, keyset-paginated Match Library list.

        Filters: ``map_name`` equality; inclusive ``started_at`` ``[from, to]``
        range (naive bounds treated as UTC); participant ``player_puuid``
        (exists in ``match_players.puuid_snapshot``). ``total`` counts the
        filtered set ignoring ``limit``/``cursor``; ``next_cursor`` is the id
        of the last returned item when another page exists. ``cursor`` must
        name a match that satisfies the *same* active filters (the repository
        rejects cross-filter cursors with ``MATCH_NOT_FOUND``).

        Snapshot semantics: ``items`` and ``total`` are two separate queries
        within the request. On an otherwise idle dataset they are consistent;
        under concurrent writes the ``total`` is best-effort and may briefly
        reflect a slightly different point in time than ``items``. Rows are
        always returned in the deterministic ``(started_at DESC, id DESC)``
        order, so repeated requests over unchanged data are identical.
        """
        from_ = _as_utc(from_)
        to = _as_utc(to)
        rows, next_cursor = await self._match_repo.list_matches(
            map_name=map_name,
            from_=from_,
            to=to,
            player_puuid=player_puuid,
            limit=limit,
            cursor=cursor,
        )
        total = await self._match_repo.count_matches(
            map_name=map_name,
            from_=from_,
            to=to,
            player_puuid=player_puuid,
        )
        return MatchListResponse(
            items=[_to_match_summary(row) for row in rows],
            next_cursor=next_cursor,
            total=total,
        )

    async def get_by_id(self, match_id: uuid.UUID) -> MatchDetailResponse:
        """Detail by internal UUID, entirely from Supabase."""
        match = await self._match_repo.get_by_id(match_id)
        if match is None:
            raise _match_not_found()
        return await self._detail(match)

    async def get_by_henrik_id(self, henrik_match_id: str) -> MatchDetailResponse:
        """Detail by the canonical Henrik Match ID, entirely from Supabase."""
        match = await self._match_repo.get_by_henrik_match_id(henrik_match_id)
        if match is None:
            raise _match_not_found()
        return await self._detail(match)

    # ------------------------------------------------------------ internals

    async def _detail(self, match: Match) -> MatchDetailResponse:
        players = await self._match_repo.get_players_for_match(match.id)
        return MatchDetailResponse(
            id=match.id,
            henrik_match_id=match.henrik_match_id,
            affinity=match.affinity,
            platform=match.platform,
            map_id=match.map_id,
            map_name=match.map_name,
            mode=match.mode,
            queue=match.queue,
            started_at=match.started_at,
            duration_ms=match.duration_ms,
            is_completed=match.is_completed,
            red_score=match.red_score,
            blue_score=match.blue_score,
            winning_side=match.winning_side,
            game_version=match.game_version,
            players=[_to_match_player_response(player) for player in players],
            raw_payload_available=True,
            raw_payload=match.raw_payload if self._settings.raw_payload_in_responses else None,
        )


# ------------------------------------------------------------- pure helpers


def _as_utc(value: datetime | None) -> datetime | None:
    """Interpret timezone-naive bounds as UTC (never leave them naive)."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _to_match_summary(match: Match) -> MatchSummaryResponse:
    return MatchSummaryResponse(
        id=match.id,
        henrik_match_id=match.henrik_match_id,
        affinity=match.affinity,
        platform=match.platform,
        map_id=match.map_id,
        map_name=match.map_name,
        mode=match.mode,
        queue=match.queue,
        started_at=match.started_at,
        duration_ms=match.duration_ms,
        is_completed=match.is_completed,
        red_score=match.red_score,
        blue_score=match.blue_score,
        winning_side=match.winning_side,
        game_version=match.game_version,
        raw_payload_available=True,
    )


def _to_match_player_response(player) -> MatchPlayerResponse:
    return MatchPlayerResponse(
        id=player.id,
        player_id=player.player_id,
        puuid=player.puuid_snapshot,
        name=player.name_snapshot,
        tag=player.tag_snapshot,
        side=player.side,
        agent_id=player.agent_id,
        agent_name=player.agent_name,
        score_total=player.score_total,
        kills=player.kills,
        deaths=player.deaths,
        assists=player.assists,
        damage_dealt=player.damage_dealt,
        damage_received=player.damage_received,
        headshots=player.headshots,
        bodyshots=player.bodyshots,
        legshots=player.legshots,
    )
