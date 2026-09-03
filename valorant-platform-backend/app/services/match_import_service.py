"""Canonical match import service (plan Task 8; design §5.4, §7.2–7.4, §11.1).

``import_match`` implements the canonical import contract:

1. Validate the UUID-ish ``match_id`` (else ``INVALID_RIOT_ID`` 422).
2. The canonical ``GET /valorant/v4/match/{affinity}/{match_id}`` fetch and the
   full payload validation happen **before any database access** (fix round 1):
   an upstream failure can never leave an open write transaction behind, and a
   malformed or mismatched payload is rejected without touching the DB.
3. Identity binding: the detail's ``metadata.match_id`` must be present,
   non-empty, and exactly equal to the requested ``match_id`` — otherwise the
   payload is rejected (``HenrikProtocolError`` → ``HENRIK_UNAVAILABLE``) and
   nothing is inserted/updated. This makes it impossible to import a match
   under an upstream ID different from the request, and impossible for a
   refresh to rename an existing row.
4. Required-field gate, with raw-key presence so model defaults can never hide
   a malformed payload: ``metadata.is_completed`` must be present and a real
   boolean (missing/null → ``HENRIK_UNAVAILABLE``; only ``false`` →
   ``MATCH_NOT_COMPLETED`` 422, ADR-018); the map name and ``started_at`` are
   required; participants must be non-empty with non-empty puuid/name/tag and
   a normalized side. All contract violations raise ``HenrikProtocolError``
   with stable, non-leaking messages.
5. Only then does the DB transaction open — for the idempotency recheck
   (``matches.henrik_match_id`` present and no ``refresh`` → existing row,
   ``created=false``) and the writes.
6. ``refresh=true`` is rejected with ``MATCH_REFRESH_REJECTED`` (409) when the
   match is attached to a finalized series (fix round 1: the refresh acquires
   the OWNING series row lock before touching the match, so it serializes
   against finalization of that series); a draft-attached or unattached match
   is re-fetched and updated in place (``created=false``, the ``henrik_match_id``
   is never renamed because it is bound to the request).
7. Player rows are upserted by PUUID with **display identity only**
   (``PlayerRepository.upsert_imported``): account-derived ``affinity``,
   ``platforms`` and ``henrik_updated_at`` are never overwritten by import data
   and no fabricated fallback values are written. The match row is inserted
   with the full upstream detail ``data`` object persisted verbatim as
   ``matches.raw_payload`` (design §7.4) plus derived ``red_score``/
   ``blue_score`` (``teams[].rounds.won``) and ``winning_side``
   (``teams[].won``, tolerant ``draw``/``unknown``); ``match_players``
   snapshots carry the payload's identity values verbatim plus optional stats.
8. Concurrency (design §7.3): the unique ``henrik_match_id`` constraint is the
   real gate. On ``IntegrityError`` the savepoint is rolled back, the row that
   won the race is re-selected, and it is returned with ``created=false``.
9. Commit → ``created=true`` (the route maps this to HTTP 201).
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.models import Match, MatchPlayer
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.domain.matches.derivation import derive_scores, derive_winning_side
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikError,
    HenrikNotFoundError,
    HenrikProtocolError,
    HenrikRateLimitError,
    HenrikUnavailableError,
    HenrikValidationError,
)
from app.integrations.henrik.mapper import HenrikMapper
from app.integrations.henrik.models import HenrikMatchDetail, HenrikPlayer
from app.schemas.matches import (
    MatchDetailResponse,
    MatchImportResponse,
    MatchPlayerResponse,
)

# Mirrors ``MatchImportRequest.match_id``: UUID-ish hex + hyphens, 8–64 chars.
_UUIDISH_RE = re.compile(r"^[0-9a-fA-F-]+$")
_UUIDISH_MIN = 8
_UUIDISH_MAX = 64

# The v4 match-detail endpoint is platform-agnostic; matches default to PC.
_IMPORT_PLATFORM = "pc"


class MatchImportService:
    def __init__(
        self,
        session: AsyncSession,
        henrik: HenrikClient,
        player_repo: PlayerRepository,
        match_repo: MatchRepository,
        mapper: HenrikMapper,
    ) -> None:
        self._session = session
        self._henrik = henrik
        self._player_repo = player_repo
        self._match_repo = match_repo
        self._mapper = mapper

    async def import_match(
        self, match_id: str, affinity: str, *, refresh: bool = False
    ) -> MatchImportResponse:
        """Import a canonical match; returns the row and whether it was created."""
        if not _is_uuidish(match_id):
            raise AppError("INVALID_RIOT_ID", 422, "invalid match id")

        # Canonical fetch + payload validation happen BEFORE any DB access
        # (fix round 1): an upstream failure never leaves an open write
        # transaction/connection behind, and the payload's identity is bound to
        # the request before anything can be persisted.
        try:
            envelope = await self._henrik.get_match_detail(match_id, affinity=affinity)
            _require_importable(envelope.data, requested_match_id=match_id)
        except HenrikError as exc:
            raise _translate_henrik_error(exc) from exc

        # The DB transaction opens only now: idempotency recheck + writes.
        existing = await self._match_repo.get_by_henrik_match_id(match_id)
        if existing is not None and not refresh:
            return await self._existing_response(existing)

        if refresh and existing is not None:
            # Refresh/finalize race protocol (Task 15 fix round 1): a refresh
            # of a match attached to a series acquires the OWNING series row
            # lock before touching the match, serializing against finalization
            # of that series. Whoever wins the lock first defines the order: a
            # finalize that follows a committed refresh rates on the refreshed
            # canonical state; a refresh that follows a committed finalize sees
            # status='finalized' and is rejected. A draft-attached match may be
            # refreshed (the finalize that consumes it reads the new state).
            owning = await self._match_repo.get_owning_series_for_update(existing.id)
            if owning is not None and owning.status == "finalized":
                raise AppError("MATCH_REFRESH_REJECTED", 409, "match is attached to a finalized series")

        if existing is not None:
            return await self._refresh(existing, envelope.data, affinity, match_id)

        return await self._insert_new(envelope.data, affinity, match_id)

    # ------------------------------------------------------------ internals

    async def _insert_new(
        self, detail: HenrikMatchDetail, affinity: str, match_id: str
    ) -> MatchImportResponse:
        """Insert the match + players + snapshots; resolve the unique-conflict
        race to the row that wins it (created=false for the loser)."""
        values = _match_values(detail, affinity, match_id)
        try:
            async with self._session.begin_nested():
                player_ids = await self._upsert_players(detail)
                match = await self._match_repo.insert_match(**values)
                await self._match_repo.insert_match_players(
                    match_id=match.id, snapshots=_player_snapshots(detail, player_ids)
                )
        except IntegrityError:
            # Another transaction imported this match first. Roll the savepoint
            # back, re-select, and return the winning row (design §7.3).
            await self._session.rollback()
            winner = await self._match_repo.get_by_henrik_match_id(match_id)
            if winner is None:
                raise
            return await self._existing_response(winner)
        await self._session.commit()
        players = await self._match_repo.get_players_for_match(match.id)
        return MatchImportResponse(match=_to_match_detail_response(match, players), created=True)

    async def _refresh(
        self, existing: Match, detail: HenrikMatchDetail, affinity: str, match_id: str
    ) -> MatchImportResponse:
        """Re-fetch an already-imported match and refresh it in place.

        ``henrik_match_id`` is bound to the request (validated above), so a
        refresh can never rename the row — only the fetched payload's mutable
        columns and snapshots are replaced.
        """
        values = _match_values(detail, affinity, match_id)
        player_ids = await self._upsert_players(detail)
        match = await self._match_repo.update_match(
            match_id=existing.id, **values, refreshed_at=datetime.now(UTC)
        )
        await self._match_repo.replace_match_players(
            match_id=match.id, snapshots=_player_snapshots(detail, player_ids)
        )
        await self._session.commit()
        players = await self._match_repo.get_players_for_match(match.id)
        return MatchImportResponse(match=_to_match_detail_response(match, players), created=False)

    async def _upsert_players(self, detail: HenrikMatchDetail) -> dict[str, uuid.UUID]:
        """Upsert every participant by PUUID; return ``{puuid: player_id}``.

        Uses ``upsert_imported`` (display identity only): account-derived
        affinity/platforms/``henrik_updated_at`` are never overwritten by match
        payload data and no fabricated fallbacks are ever written.
        """
        player_ids: dict[str, uuid.UUID] = {}
        for player in detail.players:
            row = await self._player_repo.upsert_imported(
                puuid=player.puuid,
                current_name=player.name,
                current_tag=player.tag,
            )
            player_ids[player.puuid] = row.id
        return player_ids

    async def _existing_response(self, match: Match) -> MatchImportResponse:
        players = await self._match_repo.get_players_for_match(match.id)
        return MatchImportResponse(match=_to_match_detail_response(match, players), created=False)


# ------------------------------------------------------------- pure helpers


def _is_uuidish(match_id: str) -> bool:
    return _UUIDISH_MIN <= len(match_id) <= _UUIDISH_MAX and _UUIDISH_RE.fullmatch(match_id) is not None


def _require_importable(detail: HenrikMatchDetail, *, requested_match_id: str) -> None:
    """Reject incomplete imports, identity mismatches, and missing required
    fields with stable non-leaking errors.

    Completion: ``metadata.is_completed`` must be *present* and a real boolean
    (the model defaults a missing field to ``False``, so raw key presence is
    inspected to keep malformed payloads distinguishable); only an explicit
    ``false`` is ``MATCH_NOT_COMPLETED`` (ADR-018). Missing/null completion and
    every other contract violation raise ``HenrikProtocolError`` (the caller
    maps it to ``HENRIK_UNAVAILABLE``; no upstream value is ever echoed).

    Identity binding: ``metadata.match_id`` must be non-empty and exactly equal
    to the requested ID — import never uses an upstream ID different from the
    request, and refresh can therefore never rename a row.
    """
    raw_meta = _raw_metadata(detail)
    raw_completed = raw_meta.get("is_completed")
    if "is_completed" not in raw_meta or not isinstance(raw_completed, bool):
        raise HenrikProtocolError("match detail missing required is_completed")
    if not detail.metadata.is_completed:
        raise AppError("MATCH_NOT_COMPLETED", 422, "match is not completed")

    meta_match_id = detail.metadata.match_id
    if not meta_match_id:
        raise HenrikProtocolError("match detail missing required match_id")
    if meta_match_id != requested_match_id:
        raise HenrikProtocolError("match detail match_id does not match request")

    meta = detail.metadata
    if meta.map is None or not meta.map.name:
        raise HenrikProtocolError("match detail missing required map name")
    if meta.started_at is None:
        raise HenrikProtocolError("match detail missing required started_at")

    if not detail.players:
        raise HenrikProtocolError("match detail has no players")
    for player in detail.players:
        if not player.puuid or not player.name or not player.tag:
            raise HenrikProtocolError("match detail player missing required identity")
        if player.team_id is None:
            raise HenrikProtocolError("match detail player missing required team_id")


def _raw_metadata(detail: HenrikMatchDetail) -> dict:
    """The original upstream ``metadata`` dict (verbatim, key-presence safe).

    ``metadata.raw`` is attached by the mapper and retains ignored extras and
    key absence, so model defaults cannot hide malformed payloads.
    """
    raw = getattr(detail.metadata, "raw", None)
    if isinstance(raw, dict):
        return raw
    meta = detail.raw.get("metadata")
    return meta if isinstance(meta, dict) else {}


def _match_values(detail: HenrikMatchDetail, affinity: str, match_id: str) -> dict:
    """Column values for a canonical match row (raw payload verbatim; the
    persisted ``henrik_match_id`` is always the request-bound, validated id)."""
    meta = detail.metadata
    red_score, blue_score = derive_scores(detail.teams)
    return {
        "henrik_match_id": match_id,
        "affinity": affinity,
        "platform": _IMPORT_PLATFORM,
        "map_id": meta.map.id if meta.map is not None else None,
        "map_name": meta.map.name if meta.map is not None else None,
        "mode": meta.mode,
        "queue": meta.queue,
        "started_at": meta.started_at,
        "duration_ms": _raw_meta_int(detail.raw, "duration_ms"),
        "is_completed": meta.is_completed,
        "red_score": red_score,
        "blue_score": blue_score,
        "winning_side": derive_winning_side(detail.teams),
        "game_version": _raw_meta_str(detail.raw, "game_version"),
        "raw_payload": detail.raw,
    }


def _player_snapshots(detail: HenrikMatchDetail, player_ids: dict[str, uuid.UUID]) -> list[dict]:
    """Snapshot column values per participant (identity verbatim from payload)."""
    return [_player_snapshot(player, player_ids[player.puuid]) for player in detail.players]


def _player_snapshot(player: HenrikPlayer, player_id: uuid.UUID) -> dict:
    stats = player.stats
    return {
        "player_id": player_id,
        "puuid_snapshot": player.puuid,
        "name_snapshot": player.name,
        "tag_snapshot": player.tag,
        "side": player.team_id,
        # `agent_id` was never written at all, and `character` is the pre-v4
        # name path that current payloads do not send, so both agent columns
        # stayed NULL on every import. Prefer the v4 object; fall back to the
        # legacy name.
        "agent_id": player.agent.id if player.agent else None,
        "agent_name": (player.agent.name if player.agent else None) or player.character,
        "score_total": stats.score if stats is not None else None,
        "kills": stats.kills if stats is not None else None,
        "deaths": stats.deaths if stats is not None else None,
        "assists": stats.assists if stats is not None else None,
        "damage_dealt": stats.damage_dealt if stats is not None else None,
        "damage_received": stats.damage_received if stats is not None else None,
        "headshots": stats.headshots if stats is not None else None,
        "bodyshots": stats.bodyshots if stats is not None else None,
        "legshots": stats.legshots if stats is not None else None,
        "raw_player_payload": player.raw,
    }


def _raw_meta_value(raw: dict, key: str):
    """Read ``key`` from the raw detail data, preferring ``metadata``."""
    meta = raw.get("metadata")
    if isinstance(meta, dict) and key in meta:
        return meta[key]
    return raw.get(key)


def _raw_meta_int(raw: dict, key: str) -> int | None:
    value = _raw_meta_value(raw, key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _raw_meta_str(raw: dict, key: str) -> str | None:
    value = _raw_meta_value(raw, key)
    return value if isinstance(value, str) else None


def _to_match_detail_response(match: Match, players: list[MatchPlayer]) -> MatchDetailResponse:
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
    )


def _to_match_player_response(player: MatchPlayer) -> MatchPlayerResponse:
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


def _translate_henrik_error(exc: HenrikError) -> AppError:
    """Stable AppError codes for the canonical match-detail call (design §5.6).

    A 404 on the dedicated match endpoint is ``MATCH_NOT_FOUND`` regardless of
    the upstream sub-code; malformed/contract-violating responses map to the
    stable ``HENRIK_UNAVAILABLE`` (no upstream text is ever echoed).
    """
    if isinstance(exc, HenrikNotFoundError):
        return AppError(
            "MATCH_NOT_FOUND", 404, "match not found", detail=_error_detail(exc, henrik_code=exc.sub_code)
        )
    if isinstance(exc, HenrikAuthenticationError):
        return AppError("HENRIK_AUTH_FAILED", 502, "henrik authentication failed", detail=_error_detail(exc))
    if isinstance(exc, HenrikRateLimitError):
        return AppError(
            "HENRIK_RATE_LIMITED",
            429,
            "henrik rate limit exceeded",
            detail=_error_detail(
                exc, retry_after_seconds=exc.retry_after, rate_limit_reset=exc.rate_limit_reset
            ),
        )
    if isinstance(exc, HenrikUnavailableError):
        return AppError("HENRIK_UNAVAILABLE", 503, "henrik unavailable", detail=_error_detail(exc))
    if isinstance(exc, HenrikValidationError):
        return AppError("HENRIK_VALIDATION_ERROR", 422, "henrik validation error", detail=_error_detail(exc))
    # Malformed/contract-violating upstream payload (including missing
    # import-required fields and identity mismatches): stable error, no
    # upstream text.
    return AppError("HENRIK_UNAVAILABLE", 503, "henrik unavailable", detail=_error_detail(exc))


def _error_detail(exc: HenrikError, **values) -> dict | None:
    detail: dict = {}
    request_id = getattr(exc, "request_id", None)
    if request_id:
        detail["henrik_request_id"] = request_id
    for key, value in values.items():
        if value is not None:
            detail[key] = value
    return detail or None
