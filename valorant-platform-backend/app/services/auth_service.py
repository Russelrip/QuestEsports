"""Discord OAuth service (SDD 2026-08-14 leaderboard standardization, task 6).

Ports ``valorantsl-new`` ``backend/app/routers/auth.py`` into the standard
layering with a minimal ``httpx`` OAuth exchange instead of ``fastapi-discord``
(R21): build the authorize URL, exchange the one-time authorization code for an
access token, fetch ``/users/@me``, and report whether the Discord user already
has a ``leaderboard_players`` row. The in-memory code dedupe mirrors
``valorantsl-new``'s module-level ``_used_codes`` (R24): a code is added before
the exchange and only removed on error, so a successful exchange is never
replayed (single-instance deployment, as today). No geo-gating anywhere (R15).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.config import get_settings
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.schemas.auth import (
    CheckDiscordResponse,
    CheckDiscordUser,
    CheckPuuidResponse,
    CheckPuuidUser,
    DiscordCallbackResponse,
    DiscordCallbackUser,
    DiscordExistingData,
)
from app.services.rank_field import get_rank_field

logger = logging.getLogger(__name__)

_DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
_DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"
_DISCORD_USER_URL = "https://discord.com/api/users/@me"

# In-memory dedupe of consumed Discord authorization codes (single-instance;
# mirrors valorantsl-new's ``_used_codes``). R24.
_used_codes: set[str] = set()


@asynccontextmanager
async def _open_client(http: httpx.AsyncClient | None) -> AsyncIterator[httpx.AsyncClient]:
    """Yield the injected client, or a short-lived one closed on exit (R21)."""
    client = http or httpx.AsyncClient()
    try:
        yield client
    finally:
        if http is None:
            await client.aclose()


class AuthService:
    def __init__(
        self,
        session: AsyncSession,
        repo: LeaderboardPlayerRepository,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self._session = session
        self._repo = repo
        self._http = http

    def login_url(self) -> str:
        """Pure: the Discord authorize URL for the frontend's register flow.

        ``redirect_uri`` and the ``identify email`` scope space are
        URL-encoded (R21); the numeric ``client_id`` is not.
        """
        settings = get_settings()
        return (
            f"{_DISCORD_AUTHORIZE_URL}?client_id={settings.discord_client_id}"
            f"&redirect_uri={quote(settings.discord_redirect_uri, safe='')}"
            "&response_type=code&scope=identify%20email"
        )

    async def callback(self, code: str) -> DiscordCallbackResponse:
        """Exchange a Discord authorization code and report registration state.

        R23/R24: a reused code 409s immediately; on any failure the code is
        discarded (so the flow can be retried), and only a successful exchange
        leaves it in the dedupe set.
        """
        if code in _used_codes:
            raise AppError("OAUTH_CODE_ALREADY_USED", 409, "OAuth code already used")
        _used_codes.add(code)
        try:
            return await self._callback(code)
        except Exception:
            _used_codes.discard(code)
            raise

    async def check_discord(self, discord_id: str) -> CheckDiscordResponse:
        """``{exists, user}`` for a Discord id; ``user`` is ``None`` on a miss."""
        player = await self._repo.get_by_discord_id(discord_id)
        if player is None:
            return CheckDiscordResponse(exists=False, user=None)
        return CheckDiscordResponse(
            exists=True,
            user=CheckDiscordUser(
                puuid=player.puuid,
                name=player.name,
                tag=player.tag,
                discord_username=player.discord_username,
                current_rank=get_rank_field(player.rank_details, "currenttierpatched"),
            ),
        )

    async def check_puuid(self, puuid: str) -> CheckPuuidResponse:
        """``{exists, user}`` for a PUUID; ``user`` is ``None`` on a miss."""
        player = await self._repo.get_by_puuid(puuid)
        if player is None:
            return CheckPuuidResponse(exists=False, user=None)
        return CheckPuuidResponse(
            exists=True,
            user=CheckPuuidUser(
                name=player.name,
                tag=player.tag,
                discord_username=player.discord_username,
            ),
        )

    # ------------------------------------------------------------ internals

    async def _callback(self, code: str) -> DiscordCallbackResponse:
        async with _open_client(self._http) as client:
            access_token = await self._exchange_code(client, code)
            discord_user = await self._fetch_discord_user(client, access_token)
        existing = await self._repo.get_by_discord_id(str(discord_user["id"]))
        logger.info(
            "discord oauth callback",
            extra={"discord_id": str(discord_user["id"]), "exists": existing is not None},
        )
        return DiscordCallbackResponse(
            user=DiscordCallbackUser(
                discord_id=str(discord_user["id"]),
                discord_username=discord_user["username"],
                discord_discriminator=discord_user.get("discriminator", "0"),
                discord_avatar=discord_user.get("avatar"),
                discord_email=discord_user.get("email"),
                access_token=access_token,
            ),
            exists=existing is not None,
            existing_data=(
                DiscordExistingData(
                    puuid=existing.puuid,
                    name=existing.name,
                    tag=existing.tag,
                    current_rank=get_rank_field(existing.rank_details, "currenttierpatched"),
                )
                if existing is not None
                else None
            ),
        )

    async def _exchange_code(self, client: httpx.AsyncClient, code: str) -> str:
        """POST the auth code to Discord's token endpoint; return ``access_token``.

        Discord accepts ``client_id``/``client_secret`` in the form body
        (R21); the refresh token from the response is intentionally not
        retained (the platform never reuses a consumed authorization code).
        """
        settings = get_settings()
        try:
            response = await client.post(
                _DISCORD_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.discord_redirect_uri,
                    "client_id": settings.discord_client_id,
                    "client_secret": settings.discord_client_secret,
                },
            )
        except httpx.RequestError as exc:
            raise AppError("DISCORD_AUTH_FAILED", 400, "failed to get Discord user info") from exc
        if response.status_code != 200:
            raise AppError("DISCORD_AUTH_FAILED", 400, "failed to get Discord user info")
        return response.json()["access_token"]

    async def _fetch_discord_user(self, client: httpx.AsyncClient, access_token: str) -> dict[str, Any]:
        """GET ``/users/@me`` with the bearer token (R21)."""
        try:
            response = await client.get(
                _DISCORD_USER_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        except httpx.RequestError as exc:
            raise AppError("DISCORD_AUTH_FAILED", 400, "failed to get Discord user info") from exc
        if response.status_code != 200:
            raise AppError("DISCORD_AUTH_FAILED", 400, "failed to get Discord user info")
        return response.json()
