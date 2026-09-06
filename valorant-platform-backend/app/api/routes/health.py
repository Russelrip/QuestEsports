from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.service_token import ServiceTokenError, parse_secrets_map, verify_service_token
from app.config import get_settings

router = APIRouter(tags=["health"])


async def _db_status() -> str:
    """SELECT 1 against the async engine.

    Returns "up" when the probe succeeds, "down" when the engine is present but
    unreachable, and "unknown" when the engine is not yet available (Task 4) or
    failed to initialize/import — import failures must never surface as 500s.
    """
    try:
        from app.db.session import engine
    except Exception:  # noqa: BLE001  # any import/init failure -> unknown, never 500
        return "unknown"
    if engine is None:
        return "unknown"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "up"
    except Exception:  # noqa: BLE001  # any connection/probe failure -> down
        return "down"


def _service_token_compatibility(settings, authorization: str | None) -> bool:
    """Verify the actual Quest-signed token at the VALORANT boundary.

    A valid local secret map alone cannot prove that Quest's token will be
    accepted. Production readiness therefore verifies the same HMAC, issuer,
    audience, and clock contract used by protected API routes.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return False
    try:
        secrets = parse_secrets_map(settings.quest_service_shared_secrets)
        verify_service_token(
            authorization.removeprefix("Bearer "),
            secrets_by_kid=secrets,
            issuer=settings.quest_service_issuer,
            audience=settings.quest_service_audience,
            max_skew_seconds=settings.service_token_max_skew_seconds,
        )
    except (ServiceTokenError, ValueError):
        return False
    return True


def _integration_checks(authorization: str | None = None) -> dict[str, str]:
    """Check integration configuration without making network or DB writes."""
    settings = get_settings()
    if settings.app_env != "production":
        return {}

    errors = set(settings.production_validation_errors())
    service_token_ok = _service_token_compatibility(settings, authorization)
    return {
        "service_token": (
            "ready"
            if service_token_ok
            and not errors.intersection(
                {
                    "QUEST_SERVICE_SHARED_SECRETS_FORMAT",
                    "QUEST_SERVICE_SHARED_SECRETS",
                    "QUEST_SERVICE_ISSUER",
                    "QUEST_SERVICE_AUDIENCE",
                }
            )
            else "not_ready"
        ),
        "henrik": (
            "ready"
            if not errors.intersection({"HENRIK_API_KEY", "HENRIK_BASE_URL", "HENRIK_AUTH_SCHEME"})
            else "not_ready"
        ),
        "discord_oauth": "ready"
        if not errors.intersection({"DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"})
        else "not_ready",
        "oauth_redirect": "ready" if "DISCORD_REDIRECT_URI" not in errors else "not_ready",
        "discord_workers": "ready"
        if not errors.intersection({"DISCORD_TOKEN_1", "DISCORD_TOKEN_2", "DISCORD_GUILD_ID"})
        else "not_ready",
        "tls": "ready"
        if not errors.intersection(
            {
                "DATABASE_URL",
                "DIRECT_URL",
                "VALORANT_DATABASE_SSL_VERIFY",
                "VALORANT_DATABASE_SSL_CA_FILE",
                "VALORANT_DATABASE_SSL_SERVER_HOSTNAME",
            }
        )
        else "not_ready",
    }


@router.get("/api/v1/health")
async def health(authorization: str | None = Header(default=None, alias="Authorization")) -> dict:
    db = await _db_status()
    if db != "up":
        return JSONResponse(status_code=503, content={"status": "degraded", "db": db})
    checks = _integration_checks(authorization)
    if not checks:
        # Keep development and test behavior intentionally unchanged. In
        # production the integration result below is mandatory, so a database
        # probe alone can never authorize a release.
        return {"status": "ok", "db": "up"}
    integration = "ready" if all(value == "ready" for value in checks.values()) else "not_ready"
    if integration != "ready":
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": "up", "integration": integration, "checks": checks},
        )
    return {"status": "ok", "db": "up", "integration": integration, "checks": checks}
