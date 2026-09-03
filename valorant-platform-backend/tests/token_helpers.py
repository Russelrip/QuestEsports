"""Shared helpers for production-env API tests that must authenticate as Quest.

Every domain route is service-token-gated in production (delta D1; spec §6.3).
These helpers build the exact settings shape and mint a valid HMAC bearer
header via the production signing code (``app.api.service_token``).
"""

from __future__ import annotations

import uuid

from app.api.service_token import sign_service_token
from app.config import Settings

TEST_SECRET = "test-secret"
TEST_KID = "kid-1"


def production_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "app_env": "production",
        "quest_service_shared_secrets": f"{TEST_KID}={TEST_SECRET}",
        "quest_service_issuer": "quest-esports",
        "quest_service_audience": "valorant-platform",
    }
    base.update(overrides)
    return Settings(**base)


def service_token_headers(
    *, sub: str = "actor-1", operation_id: str | None = None, ttl_seconds: int = 300
) -> dict[str, str]:
    token = sign_service_token(
        secret=TEST_SECRET,
        kid=TEST_KID,
        issuer="quest-esports",
        audience="valorant-platform",
        subject=sub,
        operation_id=operation_id or str(uuid.uuid4()),
        ttl_seconds=ttl_seconds,
    )
    return {"Authorization": f"Bearer {token}"}
