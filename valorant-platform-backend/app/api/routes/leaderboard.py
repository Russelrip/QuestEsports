"""Leaderboard routes (SDD 2026-08-14 leaderboard standardization, task 4).

Four service-token-gated reads over the ``leaderboard_players`` snapshot
(spec §4-§5): the paginated leaderboard, the top-N slice, the
case-insensitive discord-username search, and the aggregate stats. The
out-of-range-page 404 is raised here as ``AppError``
(``LEADERBOARD_PAGE_NOT_FOUND``); the search miss is a deliberate 200
``null`` per spec §5.1 (``LeaderboardEntry | null``).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.api.dependencies import get_leaderboard_service, require_service_token
from app.api.errors import AppError
from app.schemas.leaderboard import LeaderboardEntry, LeaderboardPage, LeaderboardStats
from app.services.leaderboard_service import LeaderboardService

router = APIRouter(prefix="/api/v1", tags=["leaderboard"])

_ServiceDep = Annotated[LeaderboardService, Depends(get_leaderboard_service)]


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
