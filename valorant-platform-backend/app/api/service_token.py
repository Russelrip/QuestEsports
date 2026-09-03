"""Quest service-token signing/verification (spec §6.3, delta D1).

Quest signs an HMAC-SHA256 bearer token (``alg=HS256``, ``kid``-selected
shared secret) with claims ``iss``/``aud``/``sub``/``operation_id``/``iat``/
``nbf``/``exp``. This module owns signing (used by integration tests and ops
tooling) and verification (used by the ``require_service_token`` dependency).
Tokens, secrets, and raw payloads are never logged.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


class ServiceTokenError(Exception):
    """Base for token verification failures (mapped to 401 at the API)."""


@dataclass(frozen=True)
class ServicePrincipal:
    """Validated caller identity propagated to the domain layer.

    ``actor_id`` is the signed Quest ``sub`` (``users.id``); ``operation_id``
    is the signed Quest operation UUID — the durable cross-service correlation
    key (spec §9.2). Never derived from an unsigned header in production.
    """

    actor_id: str | None
    operation_id: str


def parse_secrets_map(raw: str | None) -> dict[str, str]:
    """Parse ``QUEST_SERVICE_SHARED_SECRETS="kid1=secret1,kid2=secret2"``."""
    secrets: dict[str, str] = {}
    if not raw:
        return secrets
    for pair in raw.split(","):
        key, sep, value = pair.partition("=")
        if not sep or not key.strip() or not value.strip():
            raise ValueError(f"malformed shared-secret pair: {pair!r}")
        secrets[key.strip()] = value.strip()
    return secrets


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(payload: str) -> bytes:
    padded = payload + "=" * (-len(payload) % 4)
    return base64.urlsafe_b64decode(padded)


def sign_service_token(
    *,
    secret: str,
    kid: str,
    issuer: str,
    audience: str,
    subject: str,
    operation_id: str | None = None,
    issued_at: datetime | None = None,
    ttl_seconds: int = 300,
) -> str:
    """Sign an HMAC-SHA256 service token (test/ops helper)."""
    now = issued_at or datetime.now(UTC)
    header = {"alg": "HS256", "typ": "JWT", "kid": kid}
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": subject,
        "operation_id": operation_id or str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    signing_input = (
        _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        + "."
        + _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    )
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return signing_input + "." + _b64url_encode(signature)


def verify_service_token(
    token: str,
    *,
    secrets_by_kid: dict[str, str],
    issuer: str,
    audience: str,
    max_skew_seconds: int = 30,
) -> ServicePrincipal:
    """Validate signature, ``iss``/``aud``, and ``exp``/``nbf`` with skew.

    Returns the validated principal; raises ``ServiceTokenError`` for every
    rejection (the dependency maps it to 401 ``ADMIN_AUTH_REQUIRED``). The
    ``kid`` header selects the shared secret (dual-key rotation window).
    """
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
        if not isinstance(header, dict) or not isinstance(payload, dict):
            raise ServiceTokenError("malformed token")
        signature = _b64url_decode(signature_b64)
    except (ValueError, json.JSONDecodeError) as exc:
        raise ServiceTokenError("malformed token") from exc
    kid = header.get("kid")
    if not isinstance(kid, str) or kid not in secrets_by_kid:
        raise ServiceTokenError("unknown kid")
    expected = hmac.new(
        secrets_by_kid[kid].encode("utf-8"),
        (header_b64 + "." + payload_b64).encode("ascii"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(signature, expected):
        raise ServiceTokenError("bad signature")
    if payload.get("iss") != issuer:
        raise ServiceTokenError("unexpected issuer")
    if payload.get("aud") != audience:
        raise ServiceTokenError("unexpected audience")
    nbf = payload.get("nbf")
    exp = payload.get("exp")
    if not isinstance(nbf, (int, float)) or not isinstance(exp, (int, float)):
        raise ServiceTokenError("missing nbf/exp")
    now = datetime.now(UTC).timestamp()
    if now < nbf - max_skew_seconds:
        raise ServiceTokenError("token not yet valid")
    if now > exp + max_skew_seconds:
        raise ServiceTokenError("token expired")
    subject = payload.get("sub")
    operation_id = payload.get("operation_id")
    if not isinstance(subject, str) or not isinstance(operation_id, str):
        raise ServiceTokenError("missing sub/operation_id")
    return ServicePrincipal(actor_id=subject, operation_id=operation_id)
