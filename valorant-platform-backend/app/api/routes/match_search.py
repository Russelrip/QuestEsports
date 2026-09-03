"""Two-player match-search routes (plan Task 7; API surface §11.1, App. B).

Service-token-gated at the router level (delta D1; spec §6.3) like every
domain route: search resolves/upserts players and consumes Henrik. The
endpoint itself is a pure read — no candidate is ever persisted.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_discovery_service, require_service_token
from app.schemas.match_search import TwoPlayerSearchRequest, TwoPlayerSearchResult
from app.services.match_discovery_service import MatchDiscoveryService

router = APIRouter(
    prefix="/api/v1/match-search",
    tags=["match-search"],
    dependencies=[Depends(require_service_token)],
)

_DiscoveryServiceDep = Annotated[MatchDiscoveryService, Depends(get_discovery_service)]


@router.post("/two-player", response_model=TwoPlayerSearchResult, status_code=200)
async def two_player_search(
    req: TwoPlayerSearchRequest,
    svc: _DiscoveryServiceDep,
) -> TwoPlayerSearchResult:
    return await svc.search_two_player(req)
