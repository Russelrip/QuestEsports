"""Player resolve/lookup routes (plan Task 6; API surface §11, error table App. B).

Every domain route requires a Quest service token in production (delta D1;
spec §6.3) — including the read-only lookups ``GET /api/v1/players/{id}`` and
``GET /api/v1/players/by-puuid/{puuid}``, which still validate their
identifiers. Malformed Riot IDs (invalid ``name``/``tag`` bodies or a
malformed player UUID path parameter) surface as ``INVALID_RIOT_ID`` (422);
the path-aware ``RequestValidationError`` handler is registered on the app in
``app.main`` and delegates every other path to the global ``INVALID_REQUEST``
handler.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_player_service, require_service_token
from app.db.models import Player
from app.schemas.players import PlayerResolveRequest, PlayerResponse
from app.services.player_service import PlayerService

router = APIRouter(prefix="/api/v1/players", tags=["players"])

_PlayerServiceDep = Annotated[PlayerService, Depends(get_player_service)]


@router.post("/resolve", response_model=PlayerResponse, status_code=200, dependencies=[Depends(require_service_token)])
async def resolve_player(
    req: PlayerResolveRequest,
    svc: _PlayerServiceDep,
) -> PlayerResponse:
    return _to_response(await svc.resolve(req.name, req.tag))


@router.get("/{player_id}", response_model=PlayerResponse, dependencies=[Depends(require_service_token)])
async def get_player(
    player_id: uuid.UUID,
    svc: _PlayerServiceDep,
) -> PlayerResponse:
    return _to_response(await svc.get_by_id(player_id))


@router.get("/by-puuid/{puuid}", response_model=PlayerResponse, dependencies=[Depends(require_service_token)])
async def get_player_by_puuid(
    puuid: str,
    svc: _PlayerServiceDep,
) -> PlayerResponse:
    return _to_response(await svc.get_by_puuid(puuid))


def _to_response(player: Player) -> PlayerResponse:
    platforms = player.platforms or []
    return PlayerResponse(
        id=player.id,
        puuid=player.puuid,
        name=player.current_name,
        tag=player.current_tag,
        affinity=player.affinity,
        platforms=[str(item) for item in platforms],
    )
