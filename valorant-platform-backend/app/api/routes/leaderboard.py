"""Leaderboard routes (SDD 2026-08-14 leaderboard standardization, task 4).

Service-token-gated reads over the ``leaderboard_players`` snapshot
(spec §4-§5): the paginated leaderboard, the top-N slice, the
case-insensitive discord-username search, and the aggregate stats. The
out-of-range-page 404 is raised here as ``AppError``
(``LEADERBOARD_PAGE_NOT_FOUND``); the search miss is a deliberate 200
``null`` per spec §5.1 (``LeaderboardEntry | null``). The ``/players`` pair
is the admin surface: every registration regardless of the board filter, and
removal of one. The ``/removals`` pair lists removals and restores one. The
``/server-checks`` routes list players the server check flags, and clear or
reopen a flag.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query

from app.api.dependencies import get_leaderboard_service, get_server_check_service, require_service_token
from app.api.errors import AppError
from app.api.service_token import ServicePrincipal
from app.schemas.leaderboard import (
    LeaderboardEntry,
    LeaderboardPage,
    LeaderboardRegistrationPage,
    LeaderboardRemovalPage,
    LeaderboardRemovedRegistration,
    LeaderboardRestoredRegistration,
    LeaderboardStats,
)
from app.schemas.server_checks import LeaderboardServerCheckEntry, LeaderboardServerCheckPage
from app.services.leaderboard_service import LeaderboardService
from app.services.server_check_service import ServerCheckService

router = APIRouter(prefix="/api/v1", tags=["leaderboard"])

_ServiceDep = Annotated[LeaderboardService, Depends(get_leaderboard_service)]
_ServerCheckDep = Annotated[ServerCheckService, Depends(get_server_check_service)]
_PrincipalDep = Annotated[ServicePrincipal, Depends(require_service_token)]


@router.get("/leaderboard", response_model=LeaderboardPage, dependencies=[Depends(require_service_token)])
async def get_leaderboard(
    svc: _ServiceDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
) -> LeaderboardPage:
    result = await svc.leaderboard(page, per_page)
    if page > result.total_pages:
        raise AppError(
            "LEADERBOARD_PAGE_NOT_FOUND",
            404,
            f"Page {page} not found. Total pages: {result.total_pages}",
        )
    return result


@router.get("/leaderboard/top/{count}", response_model=list[LeaderboardEntry], dependencies=[Depends(require_service_token)])
async def get_top_players(svc: _ServiceDep, count: int = Path(..., ge=1, le=100)) -> list[LeaderboardEntry]:
    return await svc.top(count)


@router.get("/leaderboard/search/{discord_username}", response_model=LeaderboardEntry | None, dependencies=[Depends(require_service_token)])
async def find_user_in_leaderboard(svc: _ServiceDep, discord_username: str) -> LeaderboardEntry | None:
    return await svc.search(discord_username)


@router.get("/leaderboard/stats", response_model=LeaderboardStats, dependencies=[Depends(require_service_token)])
async def get_leaderboard_stats(svc: _ServiceDep) -> LeaderboardStats:
    return await svc.stats()


@router.get(
    "/leaderboard/players",
    response_model=LeaderboardRegistrationPage,
    dependencies=[Depends(require_service_token)],
)
async def list_registrations(
    svc: _ServiceDep,
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
) -> LeaderboardRegistrationPage:
    """Every registration, including rows the public board hides (admin view)."""
    return await svc.registrations(q, page, per_page)


@router.delete(
    "/leaderboard/players/{puuid}",
    response_model=LeaderboardRemovedRegistration,
    dependencies=[Depends(require_service_token)],
)
async def remove_registration(
    svc: _ServiceDep,
    principal: _PrincipalDep,
    puuid: str,
) -> LeaderboardRemovedRegistration:
    """Remove a registration; returns the row as it was so Quest can audit it.

    A copy is kept under ``removal_id`` so the removal can be restored.
    """
    return await svc.remove(puuid, principal.actor_id)


@router.get(
    "/leaderboard/removals",
    response_model=LeaderboardRemovalPage,
    dependencies=[Depends(require_service_token)],
)
async def list_removals(
    svc: _ServiceDep,
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> LeaderboardRemovalPage:
    """Removed registrations, newest first, with whether each can be restored."""
    return await svc.removals(q, page, per_page)


@router.post(
    "/leaderboard/removals/{removal_id}/restore",
    response_model=LeaderboardRestoredRegistration,
    dependencies=[Depends(require_service_token)],
)
async def restore_removal(
    svc: _ServiceDep,
    principal: _PrincipalDep,
    removal_id: str,
) -> LeaderboardRestoredRegistration:
    """Put a removed registration back exactly as it was (409 if it cannot be)."""
    return await svc.restore(removal_id, principal.actor_id)


@router.get(
    "/leaderboard/server-checks",
    response_model=LeaderboardServerCheckPage,
    dependencies=[Depends(require_service_token)],
)
async def list_server_checks(
    svc: _ServerCheckDep,
    status: Literal["flagged", "cleared"] = Query("flagged"),
    q: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> LeaderboardServerCheckPage:
    """Players whose recent competitive servers need a review, or the ones already cleared."""
    return await svc.list_checks(status, q, page, per_page)


@router.post(
    "/leaderboard/server-checks/{puuid}/clear",
    response_model=LeaderboardServerCheckEntry,
    dependencies=[Depends(require_service_token)],
)
async def clear_server_check(
    svc: _ServerCheckDep,
    principal: _PrincipalDep,
    puuid: str,
) -> LeaderboardServerCheckEntry:
    """Keep a flagged player; only matches after now can flag them again (409 if not flagged)."""
    return await svc.clear(puuid, principal.actor_id)


@router.delete(
    "/leaderboard/server-checks/{puuid}/clear",
    response_model=LeaderboardServerCheckEntry,
    dependencies=[Depends(require_service_token)],
)
async def reopen_server_check(svc: _ServerCheckDep, puuid: str) -> LeaderboardServerCheckEntry:
    """Undo a clearance (409 if the player was not cleared)."""
    return await svc.reopen(puuid)
