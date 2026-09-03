"""Rankings routes (plan Task 16; API surface §11.4, error table App. B).

The standings read is service-token-gated (delta D1; spec §6.3); the rebuild
command keeps the ``X-Admin-Key`` gate — the sole retained admin path — as the
internal/operational recovery path (design §13.4), not a public route.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import (
    get_ranking_service,
    get_rebuild_service,
    require_admin,
    require_service_token,
)
from app.schemas.rankings import RankingEntry, RebuildResult
from app.services.ranking_rebuild_service import RankingRebuildService
from app.services.ranking_service import RankingService

router = APIRouter(prefix="/api/v1/rankings", tags=["rankings"])

_RankingServiceDep = Annotated[RankingService, Depends(get_ranking_service)]
_RebuildServiceDep = Annotated[RankingRebuildService, Depends(get_rebuild_service)]


@router.get("/teams", response_model=list[RankingEntry], dependencies=[Depends(require_service_token)])
async def rankings_teams(svc: _RankingServiceDep) -> list[RankingEntry]:
    """Current standings: ``current_elo DESC`` with the 1-based rank."""
    return await svc.rankings()


@router.post(
    "/rebuild",
    response_model=RebuildResult,
    status_code=200,
    dependencies=[Depends(require_admin)],
)
async def rebuild_rankings(
    svc: _RebuildServiceDep,
    note: str | None = None,
) -> RebuildResult:
    """Deterministic versioned rebuild (internal/admin command): one transaction
    that creates a new ``rating_runs`` row, resets all teams, and replays every
    eligible finalized series into the new run — prior runs' events stay intact.
    """
    return await svc.rebuild(note=note)
