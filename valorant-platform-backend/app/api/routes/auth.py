"""Auth routes (SDD 2026-08-14 leaderboard standardization, task 6).

Seven service-token-gated Discord OAuth endpoints ported from
``valorantsl-new`` ``backend/app/routers/auth.py``: the login-URL + callback
pair (minimal ``httpx`` OAuth exchange per R21), the POST
check-discord/check-puuid existence checks (R22), and the three GET aliases
the frontend relies on. No geo-gating anywhere (R15).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_auth_service, require_service_token
from app.schemas.auth import (
    CheckDiscordRequest,
    CheckDiscordResponse,
    CheckPuuidRequest,
    CheckPuuidResponse,
    DiscordCallbackResponse,
    DiscordLoginResponse,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


@router.get(
    "/discord/login",
    response_model=DiscordLoginResponse,
    dependencies=[Depends(require_service_token)],
)
async def discord_login(svc: _AuthServiceDep) -> DiscordLoginResponse:
    """The Discord OAuth authorize URL for the frontend's register flow."""
    return DiscordLoginResponse(url=svc.login_url())


@router.get(
    "/discord/callback",
    response_model=DiscordCallbackResponse,
    dependencies=[Depends(require_service_token)],
)
async def discord_callback(code: str, svc: _AuthServiceDep) -> DiscordCallbackResponse:
    """Exchange a Discord authorization code and report registration state."""
    return await svc.callback(code)


@router.post(
    "/check-discord",
    response_model=CheckDiscordResponse,
    dependencies=[Depends(require_service_token)],
)
async def check_discord_exists(
    body: CheckDiscordRequest, svc: _AuthServiceDep
) -> CheckDiscordResponse:
    """Whether a Discord user already has a ``leaderboard_players`` row."""
    return await svc.check_discord(body.discord_id)


@router.post(
    "/check-puuid",
    response_model=CheckPuuidResponse,
    dependencies=[Depends(require_service_token)],
)
async def check_puuid_exists(body: CheckPuuidRequest, svc: _AuthServiceDep) -> CheckPuuidResponse:
    """Whether a PUUID already has a ``leaderboard_players`` row."""
    return await svc.check_puuid(body.puuid)


@router.get(
    "/login",
    response_model=DiscordLoginResponse,
    dependencies=[Depends(require_service_token)],
)
async def discord_login_alias(svc: _AuthServiceDep) -> DiscordLoginResponse:
    """GET alias returning the same Discord OAuth URL (frontend contract)."""
    return DiscordLoginResponse(url=svc.login_url())


@router.get(
    "/check-discord/{discord_id}",
    response_model=CheckDiscordResponse,
    dependencies=[Depends(require_service_token)],
)
async def check_discord_exists_get(
    discord_id: str, svc: _AuthServiceDep
) -> CheckDiscordResponse:
    """GET alias for check-discord (int or str id, coerced by the service)."""
    return await svc.check_discord(discord_id)


@router.get(
    "/check-puuid/{puuid}",
    response_model=CheckPuuidResponse,
    dependencies=[Depends(require_service_token)],
)
async def check_puuid_exists_get(puuid: str, svc: _AuthServiceDep) -> CheckPuuidResponse:
    """GET alias for check-puuid."""
    return await svc.check_puuid(puuid)
