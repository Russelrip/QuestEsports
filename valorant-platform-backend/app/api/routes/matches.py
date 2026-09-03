"""Canonical match import + Match Library read routes (plan Tasks 8–9; API
surface §11.1, App. B).

Task 8 (import): ``POST /import`` runs the canonical v4 match-detail import:
201 with ``created=true`` for a new import; 200 with ``created=false`` when
the match already exists (idempotent pre-check or a concurrent import race,
ADR-019). ``refresh=true`` re-fetches an existing match (rejected with 409
``MATCH_REFRESH_REJECTED`` when attached to a finalized series). It is
service-token-gated like every domain route (delta D1; spec §6.3).

Task 9 (Match Library): ``GET /api/v1/matches`` lists with ``map``/``from``/
``to``/``player_puuid`` filters and keyset cursor pagination; ``GET
/api/v1/matches/{id}`` and ``GET /api/v1/matches/by-henrik-id/{match_id}``
serve detail entirely from Supabase. Reads are pure (no Henrik, no writes) but
are service-token-gated in production like every domain route — only
``/api/v1/health`` stays unauthenticated. ``by-henrik-id`` is registered
before ``{match_id}`` so the fixed path wins (both are distinct segment counts
anyway, but order keeps the surface obvious). Malformed internal-UUID paths
surface ``INVALID_RIOT_ID`` (422) via the path-aware validation handler in
``app.main``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.dependencies import get_import_service, get_library_service, require_service_token
from app.schemas.matches import (
    MatchDetailResponse,
    MatchImportRequest,
    MatchImportResponse,
    MatchListResponse,
)
from app.services.match_import_service import MatchImportService
from app.services.match_library_service import MatchLibraryService

router = APIRouter(
    prefix="/api/v1/matches",
    tags=["matches"],
)

_ImportServiceDep = Annotated[MatchImportService, Depends(get_import_service)]
_LibraryServiceDep = Annotated[MatchLibraryService, Depends(get_library_service)]
_FromQuery = Annotated[datetime | None, Query(alias="from")]
_ToQuery = Annotated[datetime | None, Query(alias="to")]
_LimitQuery = Annotated[int, Query(ge=1, le=100)]


@router.post(
    "/import",
    response_model=MatchImportResponse,
    status_code=201,
    dependencies=[Depends(require_service_token)],
    # The 201/200 double is a runtime decision (created=true vs created=false),
    # so BOTH statuses are documented explicitly with the same model — the
    # OpenAPI contract must not hide the idempotent 200 (ADR-019).
    responses={
        200: {"model": MatchImportResponse, "description": "already imported (created=false)"},
    },
)
async def import_match(
    req: MatchImportRequest,
    response: Response,
    svc: _ImportServiceDep,
) -> MatchImportResponse:
    """Import a canonical match.

    ``created=true`` → HTTP 201; ``created=false`` (already imported, refreshed,
    or lost a concurrent race) → HTTP 200. The body is always
    ``MatchImportResponse``. Service-token-gated like every domain route.
    """
    result = await svc.import_match(req.match_id, req.affinity, refresh=req.refresh)
    if not result.created:
        response.status_code = 200
    return result


@router.get("", response_model=MatchListResponse, dependencies=[Depends(require_service_token)])
async def list_matches(
    svc: _LibraryServiceDep,
    *,
    map: str | None = None,
    from_: _FromQuery = None,
    to: _ToQuery = None,
    player_puuid: str | None = None,
    limit: _LimitQuery = 20,
    cursor: uuid.UUID | None = None,
) -> MatchListResponse:
    """List the Match Library with filters and keyset cursor pagination.

    ``map`` matches ``map_name``; ``from``/``to`` bound ``started_at``
    (inclusive, naive values treated as UTC); ``player_puuid`` keeps only
    matches where that puuid participated. Rows are ordered by
    ``started_at DESC, id DESC``; pass the returned ``next_cursor`` to fetch
    the next page with no overlap. ``total`` counts the filtered set.
    """
    return await svc.list_matches(
        map_name=map,
        from_=from_,
        to=to,
        player_puuid=player_puuid,
        limit=limit,
        cursor=cursor,
    )


@router.get(
    "/by-henrik-id/{henrik_match_id}",
    response_model=MatchDetailResponse,
    dependencies=[Depends(require_service_token)],
)
async def get_match_by_henrik_id(
    henrik_match_id: str,
    svc: _LibraryServiceDep,
) -> MatchDetailResponse:
    """Detail by the canonical Henrik Match ID, served entirely from Supabase."""
    return await svc.get_by_henrik_id(henrik_match_id)


@router.get("/{match_id}", response_model=MatchDetailResponse, dependencies=[Depends(require_service_token)])
async def get_match(
    match_id: uuid.UUID,
    svc: _LibraryServiceDep,
) -> MatchDetailResponse:
    """Detail by internal UUID, served entirely from Supabase."""
    return await svc.get_by_id(match_id)
