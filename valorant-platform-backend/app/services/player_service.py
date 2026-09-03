"""Player identity resolution service (plan Task 6; design §4.2, §7.1, §14.1).

Local-cache semantics: a request for a ``(name, tag)`` that already matches a
stored player's current display identity (case-insensitive index lookup) returns
the cached row without calling Henrik. ``force=True`` always re-resolves through
Henrik and refreshes the display identity.

Re-resolving a Riot ID that maps to a known PUUID updates ``current_name``/
``current_tag``/affinity/platforms and ``last_seen_at`` (= "last resolved-at")
on the same row; ``first_seen_at`` never changes and no new row is created.
Henrik exceptions are translated to stable ``AppError`` codes (§5.6, App. B).
Every malformed account response — an upstream ``HenrikProtocolError`` or a
missing/empty PUUID after ``get_account`` returns — maps to the single stable
``HENRIK_UNAVAILABLE`` (503) error; no upstream body text is ever echoed.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.models import Player
from app.db.repositories.player_repository import PlayerRepository
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


class PlayerService:
    def __init__(self, session: AsyncSession, henrik: HenrikClient, repo: PlayerRepository) -> None:
        self._session = session
        self._henrik = henrik
        self._repo = repo

    async def resolve(self, name: str, tag: str, *, force: bool = False) -> Player:
        player = await self.resolve_uncommitted(name, tag, force=force)
        await self._session.commit()
        return player

    async def resolve_uncommitted(self, name: str, tag: str, *, force: bool = False) -> Player:
        """Resolve a Riot ID without committing (caller owns the transaction).

        Same cache-then-Henrik semantics as ``resolve``; the series-create
        path uses this so anchor resolution commits atomically with the series
        row instead of splitting the transaction boundary.
        """
        name, tag = _normalize_identity(name, tag)
        if not force:
            cached = await self._repo.get_by_name_tag(name, tag)
            if cached is not None:
                return cached
        try:
            account = await self._henrik.get_account(name, tag, force=force)
            if not account.puuid:
                # Missing/empty PUUID is a malformed account response.
                raise HenrikProtocolError("henrik account resolved without a puuid")
        except HenrikError as exc:
            raise _translate_henrik_error(exc) from exc
        return await self._repo.upsert_by_puuid(
            puuid=account.puuid,
            current_name=account.name,
            current_tag=account.tag,
            affinity=account.region,
            platforms=account.platforms,
            henrik_updated_at=account.updated_at,
        )

    async def get_by_id(self, player_id: uuid.UUID) -> Player:
        player = await self._repo.get_by_id(player_id)
        if player is None:
            raise AppError("PLAYER_NOT_FOUND", 404, "player not found")
        return player

    async def get_by_puuid(self, puuid: str) -> Player:
        player = await self._repo.get_by_puuid(puuid)
        if player is None:
            raise AppError("PLAYER_NOT_FOUND", 404, "player not found")
        return player


def _normalize_identity(name: str, tag: str) -> tuple[str, str]:
    """Trim surrounding whitespace; reject blank Riot IDs."""
    cleaned_name = name.strip()
    cleaned_tag = tag.strip()
    if not cleaned_name or not cleaned_tag:
        raise AppError("INVALID_RIOT_ID", 422, "invalid Riot ID")
    return cleaned_name, cleaned_tag


def _translate_henrik_error(exc: HenrikError) -> AppError:
    if isinstance(exc, HenrikNotFoundError):
        if exc.sub_code == 23:
            return AppError(
                "PLAYER_REGION_UNKNOWN",
                404,
                "player region unknown",
                detail=_error_detail(exc, henrik_code=exc.sub_code),
            )
        return AppError(
            "PLAYER_NOT_FOUND", 404, "player not found", detail=_error_detail(exc, henrik_code=exc.sub_code)
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
        # Malformed/contract-violating upstream response (or an account that
        # resolved without a PUUID). Stable error, no upstream text.
        return AppError("HENRIK_UNAVAILABLE", 503, "henrik unavailable", detail=_error_detail(exc))
    # Any other HenrikError: upstream behaved unexpectedly; never a 200, and
    # no upstream body text is echoed.
    return AppError("HENRIK_UNAVAILABLE", 503, "henrik unavailable", detail=_error_detail(exc))


def _error_detail(exc: HenrikError, **values) -> dict | None:
    detail: dict = {}
    request_id = getattr(exc, "request_id", None)
    if request_id:
        detail["henrik_request_id"] = request_id
    for key, value in values.items():
        if value is not None:
            detail[key] = value
    return detail or None
