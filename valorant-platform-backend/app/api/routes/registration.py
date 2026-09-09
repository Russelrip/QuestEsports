"""Registration routes (SDD 2026-08-14 leaderboard standardization, task 5).

Four service-token-gated endpoints (R15: no geo-gating — ``valorantsl-new``'s
``require_allowed_country`` is NOT ported): the ``POST /preview`` +
``GET /preview/{puuid}`` snapshot pair and the ``POST /submit`` + ``POST /``
alias pair, plus ``PUT /`` for an admin-reviewed move to a different PUUID — the latter keeps the frontend's ``/api/v1/register`` contract
working unchanged (mirrors ``valorantsl-new``'s alias routes).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_registration_service, require_service_token
from app.schemas.registration import (
    PlayerPreview,
    PreviewRequest,
    RegistrationRequest,
    RegistrationSubmitResponse,
)
from app.services.registration_service import RegistrationService

router = APIRouter(prefix="/api/v1/register", tags=["registration"])

_RegistrationServiceDep = Annotated[RegistrationService, Depends(get_registration_service)]


@router.post("/preview", response_model=PlayerPreview, dependencies=[Depends(require_service_token)])
async def preview_player(body: PreviewRequest, svc: _RegistrationServiceDep) -> PlayerPreview:
    """Pre-registration snapshot for a PUUID (rank, peak, last played)."""
    return await svc.preview(body.puuid)


@router.get("/preview/{puuid}", response_model=PlayerPreview, dependencies=[Depends(require_service_token)])
async def preview_player_get(puuid: str, svc: _RegistrationServiceDep) -> PlayerPreview:
    """GET alias matching the frontend's ``/api/v1/preview/{puuid}`` expectation."""
    return await svc.preview(puuid)


@router.post("/submit", response_model=RegistrationSubmitResponse, dependencies=[Depends(require_service_token)])
async def submit_registration(
    body: RegistrationRequest, svc: _RegistrationServiceDep
) -> RegistrationSubmitResponse:
    """Final registration: upsert the player onto the leaderboard."""
    return await svc.submit(
        discord_id=body.discord_id,
        discord_username=body.discord_username,
        puuid=body.puuid,
    )


@router.put("", response_model=RegistrationSubmitResponse, dependencies=[Depends(require_service_token)])
async def repoint_registration(
    body: RegistrationRequest, svc: _RegistrationServiceDep
) -> RegistrationSubmitResponse:
    """Move an existing registration to a different PUUID.

    ``submit`` registers once and refuses afterwards, which cannot tell a
    stranger apart from a player who changed Riot accounts. Quest decides which
    it is — the move is reviewed by an admin there — and calls this once that
    decision is recorded.
    """
    return await svc.repoint(
        discord_id=body.discord_id,
        discord_username=body.discord_username,
        puuid=body.puuid,
    )


@router.post("", response_model=RegistrationSubmitResponse, dependencies=[Depends(require_service_token)])
async def submit_registration_root(
    body: RegistrationRequest, svc: _RegistrationServiceDep
) -> RegistrationSubmitResponse:
    """POST alias matching the frontend's ``/api/v1/register`` expectation."""
    return await svc.submit(
        discord_id=body.discord_id,
        discord_username=body.discord_username,
        puuid=body.puuid,
    )
