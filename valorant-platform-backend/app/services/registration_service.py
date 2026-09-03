"""Registration service (SDD 2026-08-14 leaderboard standardization, task 5).

Ports ``valorantsl-new`` ``backend/app/routers/registration.py``
``preview_player`` / ``submit_registration`` (including the two aliases) into
the standard layering. ``preview`` 409s on an already-registered PUUID, then
mirrors the upstream preview (MMR + last competitive match -> ``PlayerPreview``);
an unranked player (Henrik 200 with no ``current``) still previews as
``current_rank="Unrated"`` / ``elo=0`` — exactly like valorantsl-new, never a
404. ``submit`` 409s on a duplicate discord id or PUUID, upserts the
``leaderboard_players`` row, and returns the ``{success, message, player}``
envelope (R13). Henrik failures map to stable ``AppError`` codes (R14) instead
of valorantsl-new's blank ``None``-then-404 / generic 500.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.config import get_settings
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikError,
    HenrikNotFoundError,
    HenrikProtocolError,
    HenrikRateLimitError,
    HenrikUnavailableError,
    HenrikValidationError,
)
from app.schemas.registration import (
    PlayerPreview,
    RegistrationPlayer,
    RegistrationSubmitResponse,
)


class RegistrationService:
    def __init__(
        self,
        session: AsyncSession,
        henrik: HenrikClient,
        repo: LeaderboardPlayerRepository,
    ) -> None:
        self._session = session
        self._henrik = henrik
        self._repo = repo

    async def preview(self, puuid: str) -> PlayerPreview:
        """Pre-registration snapshot, or 409/404/upstream ``AppError``."""
        settings = get_settings()
        if await self._repo.get_by_puuid(puuid) is not None:
            raise AppError("PUUID_ALREADY_REGISTERED", 409, "puuid already registered")
        try:
            mmr = await self._henrik.get_player_mmr(
                puuid,
                affinity=settings.leaderboard_affinity,
                platform=settings.leaderboard_platform,
            )
        except HenrikError as exc:
            raise _translate_henrik_error(exc) from exc
        if not mmr or not mmr.get("name"):
            raise AppError("PLAYER_NOT_FOUND", 404, "player not found or has no competitive data")
        try:
            last_played = await self._henrik.get_last_competitive_match(
                puuid,
                affinity=settings.leaderboard_affinity,
                platform=settings.leaderboard_platform,
            )
        except HenrikError as exc:
            raise _translate_henrik_error(exc) from exc
        return PlayerPreview(
            puuid=puuid,
            name=mmr["name"],
            tag=mmr["tag"],
            current_rank=mmr["rank_details"]["currenttierpatched"],
            elo=mmr["rank_details"]["elo"],
            peak_rank=mmr["peak_rank"]["tier_name"],
            peak_season=mmr["peak_rank"]["season_short"],
            last_played=last_played,
        )

    async def submit(
        self,
        *,
        discord_id: str,
        discord_username: str,
        puuid: str,
    ) -> RegistrationSubmitResponse:
        """Register the player (upsert + commit) and return the success envelope."""
        settings = get_settings()
        if await self._repo.get_by_discord_id(discord_id) is not None:
            raise AppError("DISCORD_ALREADY_REGISTERED", 409, "discord already registered")
        if await self._repo.get_by_puuid(puuid) is not None:
            raise AppError("PUUID_ALREADY_REGISTERED", 409, "puuid already registered")
        try:
            mmr = await self._henrik.get_player_mmr(
                puuid,
                affinity=settings.leaderboard_affinity,
                platform=settings.leaderboard_platform,
            )
        except HenrikError as exc:
            raise _translate_henrik_error(exc) from exc
        if not mmr or not mmr.get("name"):
            raise AppError("PLAYER_NOT_FOUND", 404, "player not found or has no competitive data")
        try:
            last_played = await self._henrik.get_last_competitive_match(
                puuid,
                affinity=settings.leaderboard_affinity,
                platform=settings.leaderboard_platform,
            )
        except HenrikError as exc:
            raise _translate_henrik_error(exc) from exc
        player = await self._repo.upsert(
            puuid=puuid,
            name=mmr["name"],
            tag=mmr["tag"],
            region=settings.leaderboard_affinity,
            discord_id=discord_id,
            discord_username=discord_username,
            elo=mmr["rank_details"]["elo"],
            currenttierpatched=mmr["rank_details"]["currenttierpatched"],
            rank_details=mmr["rank_details"],
            peak_rank=mmr["peak_rank"],
            seasonal_ranks=mmr["seasonal_ranks"],
            last_played_match=_parse_last_played(last_played),
            update_source="registration_service",
        )
        await self._session.commit()
        return RegistrationSubmitResponse(
            success=True,
            message="Registration successful",
            player=RegistrationPlayer(
                puuid=player.puuid,
                name=player.name,
                tag=player.tag,
                current_rank=player.currenttierpatched,
                elo=player.elo,
            ),
        )


def _parse_last_played(last_played: str | None) -> datetime | None:
    """ISO string -> ``datetime`` for the ``last_played_match`` column;
    ``None``/empty stays ``None``."""
    if not last_played:
        return None
    return datetime.fromisoformat(last_played)


def _translate_henrik_error(exc: HenrikError) -> AppError:
    """Map a Henrik exception to a stable ``AppError`` (R14).

    Mirrors ``player_service._translate_henrik_error`` adapted: the
    ``PLAYER_REGION_UNKNOWN`` sub-code-23 case is deliberately NOT ported (the
    registration MMR fetch has no region resolution step).
    """
    if isinstance(exc, HenrikNotFoundError):
        return AppError(
            "PLAYER_NOT_FOUND",
            404,
            "player not found or has no competitive data",
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
        return AppError("INVALID_RIOT_ID", 422, "invalid Riot ID", detail=_error_detail(exc))
    if isinstance(exc, HenrikProtocolError):
        # Malformed/contract-violating upstream response: stable error, no
        # upstream text echoed.
        return AppError("HENRIK_UNAVAILABLE", 503, "henrik unavailable", detail=_error_detail(exc))
    # Any other HenrikError: upstream behaved unexpectedly; never a 200.
    return AppError("HENRIK_UNAVAILABLE", 503, "henrik unavailable", detail=_error_detail(exc))


def _error_detail(exc: HenrikError, **values) -> dict | None:
    """Henrik error detail (request id + optional metadata), or ``None``."""
    detail: dict = {}
    request_id = getattr(exc, "request_id", None)
    if request_id:
        detail["henrik_request_id"] = request_id
    for key, value in values.items():
        if value is not None:
            detail[key] = value
    return detail or None
