"""Shared API dependencies (plan Task 3; Global Constraints 11).

``require_admin`` gates mutation routes and Henrik-consuming discovery routes.
It is bypassed in ``local``/``test`` environments; elsewhere the ``X-Admin-Key``
header is compared in constant time against the configured key, and the request
is denied whenever no key is configured.
"""

import secrets
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.service_token import (
    ServicePrincipal,
    ServiceTokenError,
    parse_secrets_map,
    verify_service_token,
)
from app.config import get_settings
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.db.repositories.team_repository import TeamRepository
from app.db.session import get_session
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.mapper import HenrikMapper
from app.services.auth_service import AuthService
from app.services.leaderboard_service import LeaderboardService
from app.services.match_discovery_service import MatchDiscoveryService
from app.services.match_import_service import MatchImportService
from app.services.match_library_service import MatchLibraryService
from app.services.player_service import PlayerService
from app.services.ranking_rebuild_service import RankingRebuildService
from app.services.ranking_service import RankingService
from app.services.rating_service import RatingService
from app.services.registration_service import RegistrationService
from app.services.series_service import SeriesService
from app.services.team_service import TeamService

_ADMIN_AUTH_ERROR = {
    "error": {"code": "ADMIN_AUTH_REQUIRED", "message": "admin key required"},
}

_SERVICE_AUTH_ERROR = {
    "error": {"code": "ADMIN_AUTH_REQUIRED", "message": "service token required"},
}


async def require_admin(x_admin_key: str | None = Header(default=None, alias="X-Admin-Key")) -> None:
    settings = get_settings()
    if settings.app_env in {"local", "test"}:
        return
    expected = settings.admin_api_key
    if not expected or x_admin_key is None:
        raise HTTPException(status_code=401, detail=_ADMIN_AUTH_ERROR)
    try:
        matches = secrets.compare_digest(x_admin_key, expected)
    except TypeError:  # e.g. non-ASCII header value; never crash on hostile input
        matches = False
    if not matches:
        raise HTTPException(status_code=401, detail=_ADMIN_AUTH_ERROR)


async def require_service_token(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_quest_actor_id: str | None = Header(default=None, alias="X-Quest-Actor-Id"),
    x_quest_operation_id: str | None = Header(default=None, alias="X-Quest-Operation-Id"),
) -> ServicePrincipal:
    """Gate every domain route with a signed Quest service token (delta D1).

    In ``local``/``test`` the gate is bypassed exactly like ``require_admin``
    today, and a synthetic principal is built from the optional
    ``X-Quest-Actor-Id``/``X-Quest-Operation-Id`` headers (test-only seam so
    audit persistence is exercisable without HMAC). In production the
    HMAC-SHA256 bearer token is validated (``kid`` -> secret, ``iss``/``aud``,
    ``exp``/``nbf`` with skew) and the claims are authoritative — FastAPI
    never trusts an unsigned header. A malformed secrets config (operator
    error) propagates as a 500 rather than silently allowing requests.
    """
    settings = get_settings()
    if settings.app_env in {"local", "test"}:
        return ServicePrincipal(
            actor_id=x_quest_actor_id,
            operation_id=x_quest_operation_id or str(uuid.uuid4()),
        )
    secrets = parse_secrets_map(settings.quest_service_shared_secrets)
    if not secrets:
        raise HTTPException(status_code=401, detail=_SERVICE_AUTH_ERROR)
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail=_SERVICE_AUTH_ERROR)
    try:
        return verify_service_token(
            authorization.removeprefix("Bearer "),
            secrets_by_kid=secrets,
            issuer=settings.quest_service_issuer,
            audience=settings.quest_service_audience,
            max_skew_seconds=settings.service_token_max_skew_seconds,
        )
    except ServiceTokenError as exc:
        raise HTTPException(status_code=401, detail=_SERVICE_AUTH_ERROR) from exc


_henrik_client: HenrikClient | None = None


def get_henrik_client() -> HenrikClient:
    """Return the lazily built, process-lifetime Henrik client (never per-request)."""
    global _henrik_client
    if _henrik_client is None:
        _henrik_client = HenrikClient(get_settings())
    return _henrik_client


async def get_player_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    henrik: Annotated[HenrikClient, Depends(get_henrik_client)],
) -> PlayerService:
    """Request-scoped ``PlayerService`` bound to the request session."""
    return PlayerService(session=session, henrik=henrik, repo=PlayerRepository(session))


async def get_discovery_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    henrik: Annotated[HenrikClient, Depends(get_henrik_client)],
) -> MatchDiscoveryService:
    """Request-scoped ``MatchDiscoveryService`` sharing one session/player service."""
    return MatchDiscoveryService(
        session=session,
        player_svc=PlayerService(session=session, henrik=henrik, repo=PlayerRepository(session)),
        henrik=henrik,
        match_repo=MatchRepository(session),
    )


async def get_import_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    henrik: Annotated[HenrikClient, Depends(get_henrik_client)],
) -> MatchImportService:
    """Request-scoped ``MatchImportService`` bound to the request session."""
    return MatchImportService(
        session=session,
        henrik=henrik,
        player_repo=PlayerRepository(session),
        match_repo=MatchRepository(session),
        mapper=HenrikMapper(),
    )


async def get_library_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MatchLibraryService:
    """Request-scoped ``MatchLibraryService`` bound to the request session.

    A pure Supabase read service: it deliberately takes no ``HenrikClient``,
    so library reads can never invoke upstream (design §5.5.5, §8.5).
    """
    return MatchLibraryService(
        session=session,
        match_repo=MatchRepository(session),
        settings=get_settings(),
    )


async def get_team_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TeamService:
    """Request-scoped ``TeamService`` bound to the request session."""
    return TeamService(session=session, repo=TeamRepository(session))


async def get_leaderboard_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> LeaderboardService:
    """Request-scoped ``LeaderboardService`` bound to the request session."""
    return LeaderboardService(session=session, repo=LeaderboardPlayerRepository(session))


async def get_registration_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    henrik: Annotated[HenrikClient, Depends(get_henrik_client)],
) -> RegistrationService:
    """Request-scoped ``RegistrationService`` bound to the request session."""
    return RegistrationService(
        session=session,
        henrik=henrik,
        repo=LeaderboardPlayerRepository(session),
    )


async def get_series_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    henrik: Annotated[HenrikClient, Depends(get_henrik_client)],
) -> SeriesService:
    """Request-scoped ``SeriesService``; anchors resolve through the player
    service (cache-first, Henrik on miss) and persist with the create txn."""
    return SeriesService(
        session=session,
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
        player_svc=PlayerService(session=session, henrik=henrik, repo=PlayerRepository(session)),
    )


async def get_rating_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RatingService:
    """Request-scoped ``RatingService`` bound to the request session.

    Finalization shares the request session's transaction: the route only
    calls ``finalize``, which owns BEGIN..COMMIT/ROLLBACK. The match repo
    serves the D6 anchor verification read (spec §5.5).
    """
    return RatingService(
        session=session,
        series_repo=SeriesRepository(session),
        rating_repo=RatingRepository(session),
        match_repo=MatchRepository(session),
    )


async def get_ranking_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RankingService:
    """Request-scoped ``RankingService`` bound to the request session (pure
    read paths over the current versioned run)."""
    return RankingService(
        session=session,
        rating_repo=RatingRepository(session),
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
        team_repo=TeamRepository(session),
    )


async def get_rebuild_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RankingRebuildService:
    """Request-scoped ``RankingRebuildService`` bound to the request session.

    Rebuild shares the request session's transaction: the route only calls
    ``rebuild``, which owns BEGIN..COMMIT/ROLLBACK.
    """
    return RankingRebuildService(
        session=session,
        rating_repo=RatingRepository(session),
        series_repo=SeriesRepository(session),
    )


async def get_auth_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthService:
    """Request-scoped ``AuthService`` bound to the request session.

    No ``HenrikClient``: the service builds its own short-lived ``httpx``
    client for the Discord OAuth exchange (R21), or accepts an injected one
    (test seam).
    """
    return AuthService(session=session, repo=LeaderboardPlayerRepository(session))
