"""Two-player match discovery service (plan Task 7; design §4.2, §7.2, §11.1).

Resolves both players (allowed: resolve upserts player rows), rejects
incompatible affinities, then fetches both histories page by page with
**accumulated pagination**: every page is appended to a running per-player
index by ``metadata.match_id`` and the intersection is taken over the
accumulated sets, so an overlap can be found on a later page even when the
same-page lists are disjoint. Pagination starts at the pinned
``FIRST_PAGE_START`` (= 0, live-verified per U4: ``start=0`` returns the newest
match, ``start=1`` the next, omission equals ``start=0``) and advances ``start``
by ``size``.

No candidate payload is ever persisted as canonical; no match-detail calls are
made during search (candidate scores derive from ``teams[].rounds.won``).

Filtering rules:

- ``map`` is forwarded upstream ("safe when pinned") **and** applied locally to
  returned metadata as a belt-and-suspenders.
- ``mode`` is forwarded upstream only when the pinned ``CUSTOM_MODE_LITERAL``
  matches the requested literal (the client decides); the service always applies
  the requested mode locally to returned metadata (U5 fallback).
- ``from``/``to`` are applied locally against ``metadata.started_at``.
- Pagination stops as soon as the accumulated **exact match-ID intersection** is
  non-empty; the optional local map/mode/date filters are applied afterwards to
  the returned metadata. A raw overlap that the filters exclude simply yields an
  empty candidate list — extra Henrik pages are never consumed just because the
  first raw overlap was filtered out.

Affinity: both players resolving to different **non-null** affinities is a
semantic error (``INVALID_RIOT_ID`` 422, "players resolve to different
affinities"). When exactly one affinity is known, that sole known affinity is
used for both histories; ``settings.default_affinity`` is used only when both
are null. Every candidate carries the compatible affinity used for the search,
so a later import can submit ``(match_id, affinity)`` unchanged. Candidates are
deterministic newest-first (``started_at`` descending, ``henrik_match_id``
tie-breaker). Import state comes from a single batch lookup over the
candidates' henrik ids: ``already_imported`` and the candidate ``match_id``
(the internal ``matches.id`` UUID, null when not imported) are both driven by
the same ``{henrik_match_id: matches.id}`` map. Candidates whose match is
already attached to a series (imported AND referenced by ``series_games``) are
excluded entirely — a match belongs to one series, so once attached it never
reappears in discovery.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.config import Settings, get_settings
from app.db.models import Player
from app.db.repositories.match_repository import MatchRepository
from app.domain.matches.derivation import derive_scores
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.contract import FIRST_PAGE_START
from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikError,
    HenrikNotFoundError,
    HenrikRateLimitError,
    HenrikUnavailableError,
    HenrikValidationError,
)
from app.integrations.henrik.models import HenrikMatchListItem
from app.schemas.match_search import (
    MatchCandidate,
    SearchMeta,
    TwoPlayerSearchRequest,
    TwoPlayerSearchResult,
)
from app.schemas.players import PlayerResponse
from app.services.player_service import PlayerService


class MatchDiscoveryService:
    def __init__(
        self,
        session: AsyncSession,
        player_svc: PlayerService,
        henrik: HenrikClient,
        match_repo: MatchRepository,
    ) -> None:
        self._session = session
        self._player_svc = player_svc
        self._henrik = henrik
        self._match_repo = match_repo

    async def search_two_player(self, req: TwoPlayerSearchRequest) -> TwoPlayerSearchResult:
        settings = get_settings()
        player_a = await self._player_svc.resolve(req.player_a.name, req.player_a.tag)
        player_b = await self._player_svc.resolve(req.player_b.name, req.player_b.tag)
        affinity = _compatible_affinity(player_a, player_b, settings)

        page_size = min(req.page_size, settings.match_search_max_page_size)
        max_pages = min(req.max_pages, settings.match_search_max_pages)

        accum_a: dict[str, HenrikMatchListItem] = {}
        accum_b: dict[str, HenrikMatchListItem] = {}
        overlap: dict[str, HenrikMatchListItem] = {}
        pages_examined = 0

        # Each player gets its own cursor, advanced by the number of matches
        # actually RETURNED rather than by the number requested.
        #
        # Henrik caps a page well below `size` — a `size=50` request comes back
        # with about 10 — so striding by `page_size` walked 0-9, 50-59, 100-109
        # and skipped four matches out of every five. A search deep enough to
        # reach a tournament three weeks back would step straight over it and
        # report no overlap, which is indistinguishable from "these two never
        # played". Two players also burn their histories at different rates, so
        # a single shared cursor desynchronises them after the first page.
        start_a = FIRST_PAGE_START
        start_b = FIRST_PAGE_START
        for _page in range(max_pages):
            try:
                a_page = await self._henrik.get_matches_by_puuid(
                    player_a.puuid,
                    affinity=affinity,
                    platform=req.platform,
                    mode=req.mode,
                    map_name=req.map,
                    size=page_size,
                    start=start_a,
                )
                b_page = await self._henrik.get_matches_by_puuid(
                    player_b.puuid,
                    affinity=affinity,
                    platform=req.platform,
                    mode=req.mode,
                    map_name=req.map,
                    size=page_size,
                    start=start_b,
                )
            except HenrikError as exc:
                raise _translate_henrik_error(exc) from exc
            pages_examined += 1
            start_a += len(a_page)
            start_b += len(b_page)
            # Accumulate this page into the running per-player index (first
            # occurrence wins, so duplicate IDs within a page or across pages
            # never yield duplicate candidates).
            for item in a_page:
                accum_a.setdefault(item.metadata.match_id, item)
            for item in b_page:
                accum_b.setdefault(item.metadata.match_id, item)
            # Raw accumulated intersection by exact match_id. Pagination stops
            # as soon as it is non-empty — local filters run AFTER the loop, so
            # a filtered-out overlap never consumes extra Henrik pages.
            for match_id, item in accum_a.items():
                if match_id not in accum_b or match_id in overlap:
                    continue
                overlap[match_id] = item
            if overlap:
                break
            # Both histories exhausted. Without this the cursors stop advancing
            # and the remaining pages re-request the same empty offset, spending
            # a rate-limited budget to learn nothing.
            if not a_page and not b_page:
                break

        # Local map/mode/date filters run here, AFTER pagination stopped on the
        # raw overlap: a filtered-out overlap yields an empty candidate list
        # without consuming extra Henrik pages.
        filtered = [
            (match_id, item)
            for match_id, item in sorted(
                overlap.items(), key=lambda kv: _candidate_sort_key(kv[1]), reverse=True
            )
            if _matches_local_filters(item, req)
        ]
        imported = await self._match_repo.get_imported_henrik_match_ids(
            match_id for match_id, _ in filtered
        )
        attached = await self._match_repo.get_attached_henrik_match_ids(
            match_id for match_id, _ in filtered
        )
        # A candidate whose match is already attached to ANY series (imported
        # AND referenced by series_games) is excluded: a match belongs to only
        # one series, so once attached it must never reappear in discovery.
        candidates = [
            _to_candidate(item, affinity, match_id in imported, imported.get(match_id))
            for match_id, item in filtered
            if match_id not in attached
        ]
        return TwoPlayerSearchResult(
            players={
                "a": _to_player_response(player_a),
                "b": _to_player_response(player_b),
            },
            candidates=candidates,
            search=SearchMeta(page_size=page_size, pages_examined=pages_examined),
        )


def _compatible_affinity(player_a: Player, player_b: Player, settings: Settings) -> str:
    """Return the single affinity to query both histories with.

    Both players resolving to different **non-null** affinities is rejected
    (they cannot share a server). When exactly one affinity is known, that sole
    known affinity wins (a null affinity carries no information); the configured
    ``default_affinity`` is used only when both players have null affinity.
    """
    aff_a = player_a.affinity
    aff_b = player_b.affinity
    if aff_a is not None and aff_b is not None and aff_a != aff_b:
        raise AppError("INVALID_RIOT_ID", 422, "players resolve to different affinities")
    if aff_a is not None:
        return aff_a
    if aff_b is not None:
        return aff_b
    return settings.default_affinity


def _matches_local_filters(item: HenrikMatchListItem, req: TwoPlayerSearchRequest) -> bool:
    meta = item.metadata
    checks = [
        req.map is None or (meta.map is not None and meta.map.name == req.map),
        req.mode is None or meta.mode == req.mode,
        req.from_ is None or (meta.started_at is not None and meta.started_at >= req.from_),
        req.to is None or (meta.started_at is not None and meta.started_at <= req.to),
    ]
    return all(checks)


def _candidate_sort_key(item: HenrikMatchListItem) -> tuple:
    """Newest-first with a deterministic tie-breaker; unknown times sort last."""
    started_at = item.metadata.started_at
    if started_at is None:
        return (0, "", item.metadata.match_id)
    return (1, started_at, item.metadata.match_id)


def _to_candidate(
    item: HenrikMatchListItem,
    affinity: str,
    already_imported: bool,
    internal_match_id: uuid.UUID | None,
) -> MatchCandidate:
    """Build a candidate summary; ``affinity`` is the compatible search affinity
    the candidate's history was fetched with (what a later import needs).
    ``internal_match_id`` is the ``matches.id`` UUID when the candidate's
    henrik id is already imported (null otherwise), so Quest can attach an
    already-imported match directly (delta D10 ID-naming contract)."""
    red_score, blue_score = derive_scores(item.teams)
    return MatchCandidate(
        match_id=str(internal_match_id) if internal_match_id is not None else None,
        henrik_match_id=item.metadata.match_id,
        affinity=affinity,
        map=item.metadata.map.name if item.metadata.map is not None else None,
        started_at=item.metadata.started_at,
        mode=item.metadata.mode,
        queue=item.metadata.queue,
        is_completed=item.metadata.is_completed,
        red_score=red_score,
        blue_score=blue_score,
        already_imported=already_imported,
    )


def _to_player_response(player: Player) -> PlayerResponse:
    platforms = player.platforms or []
    return PlayerResponse(
        id=player.id,
        puuid=player.puuid,
        name=player.current_name,
        tag=player.current_tag,
        affinity=player.affinity,
        platforms=[str(item) for item in platforms],
    )


def _translate_henrik_error(exc: HenrikError) -> AppError:
    """Stable AppError codes for history-fetch failures (design §5.6, App. B).

    Differs from ``PlayerService``'s translation deliberately: upstream 400s
    during history fetches (invalid mode/map/platform/start) surface as
    ``HENRIK_VALIDATION_ERROR`` (422), not ``INVALID_RIOT_ID``.
    """
    if isinstance(exc, HenrikNotFoundError):
        if exc.sub_code == 23:
            return AppError(
                "PLAYER_REGION_UNKNOWN",
                404,
                "player region unknown",
                detail=_error_detail(exc, henrik_code=exc.sub_code),
            )
        return AppError(
            "PLAYER_NOT_FOUND",
            404,
            "player not found",
            detail=_error_detail(exc, henrik_code=exc.sub_code),
        )
    if isinstance(exc, HenrikAuthenticationError):
        return AppError("HENRIK_AUTH_FAILED", 502, "henrik authentication failed", detail=_error_detail(exc))
    if isinstance(exc, HenrikRateLimitError):
        return AppError(
            "HENRIK_RATE_LIMITED",
            429,
            "henrik rate limit exceeded",
            detail=_error_detail(exc, retry_after_seconds=exc.retry_after, rate_limit_reset=exc.rate_limit_reset),
        )
    if isinstance(exc, HenrikUnavailableError):
        return AppError("HENRIK_UNAVAILABLE", 503, "henrik unavailable", detail=_error_detail(exc))
    if isinstance(exc, HenrikValidationError):
        return AppError(
            "HENRIK_VALIDATION_ERROR",
            422,
            "henrik validation error",
            detail=_error_detail(exc, henrik_code=exc.sub_code),
        )
    # Malformed/contract-violating upstream response: stable error, no text.
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
