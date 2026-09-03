"""Service-token signing/verification unit tests (spec §6.3, delta D1).

HMAC-SHA256 bearer tokens signed by Quest carry ``iss``/``aud``/``sub``/
``operation_id``/``iat``/``nbf``/``exp`` and a ``kid`` header selecting the
shared secret. FastAPI verifies only; the signer here is the same code
integration tests and ops tooling use to mint tokens.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.api.service_token import (
    ServicePrincipal,
    ServiceTokenError,
    _b64url_decode,
    _b64url_encode,
    parse_secrets_map,
    sign_service_token,
    verify_service_token,
)

SECRET = "test-secret"
SECRETS = {"kid-1": SECRET, "kid-2": "previous-secret"}


def _token(**overrides) -> str:
    kwargs = {
        "secret": SECRET,
        "kid": "kid-1",
        "issuer": "quest-esports",
        "audience": "valorant-platform",
        "subject": "actor-1",
        "operation_id": "op-1",
    }
    kwargs.update(overrides)
    return sign_service_token(**kwargs)


def _verify(token: str, **overrides) -> ServicePrincipal:
    kwargs = {
        "secrets_by_kid": SECRETS,
        "issuer": "quest-esports",
        "audience": "valorant-platform",
        "max_skew_seconds": 30,
    }
    kwargs.update(overrides)
    return verify_service_token(token, **kwargs)


def test_parse_secrets_map_round_trips() -> None:
    assert parse_secrets_map("key-a=first-value,key-b=second-value") == {
        "key-a": "first-value",
        "key-b": "second-value",
    }
    assert parse_secrets_map(None) == {}


def test_parse_secrets_map_rejects_malformed_pair() -> None:
    with pytest.raises(ValueError):
        parse_secrets_map("kid-with-no-equals")


def test_valid_token_verifies_to_principal() -> None:
    principal = _verify(_token())
    assert principal.actor_id == "actor-1"
    assert principal.operation_id == "op-1"


def test_dual_key_overlap_window() -> None:
    old = _token(secret="previous-secret", kid="kid-2")
    assert _verify(old).actor_id == "actor-1"


def test_wrong_signature_rejected() -> None:
    parts = _token().split(".")
    tampered = parts[0] + "." + parts[1] + ".AAAA"
    with pytest.raises(ServiceTokenError, match="bad signature"):
        _verify(tampered)


def test_unknown_kid_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="unknown kid"):
        _verify(_token(kid="kid-3"))


def test_wrong_issuer_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="unexpected issuer"):
        _verify(_token(issuer="someone-else"))


def test_wrong_audience_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="unexpected audience"):
        _verify(_token(audience="other-aud"))


def test_expired_token_rejected() -> None:
    issued = datetime.now(UTC) - timedelta(minutes=10)
    with pytest.raises(ServiceTokenError, match="expired"):
        _verify(_token(issued_at=issued, ttl_seconds=300))


def test_expired_token_within_skew_accepted() -> None:
    issued = datetime.now(UTC) - timedelta(seconds=310)  # exp 10s ago, skew 30s
    assert _verify(_token(issued_at=issued, ttl_seconds=300)).actor_id == "actor-1"


def test_not_yet_valid_rejected() -> None:
    issued = datetime.now(UTC) + timedelta(minutes=2)
    with pytest.raises(ServiceTokenError, match="not yet valid"):
        _verify(_token(issued_at=issued, ttl_seconds=300))


def test_missing_sub_or_operation_id_rejected() -> None:
    token = _token()
    payload = json.loads(_b64url_decode(token.split(".")[1]))
    del payload["operation_id"]
    signing_input = token.split(".")[0] + "." + _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    sig = hmac.new(SECRET.encode(), signing_input.encode(), hashlib.sha256).digest()
    forged = signing_input + "." + _b64url_encode(sig)
    with pytest.raises(ServiceTokenError, match="sub/operation_id"):
        _verify(forged)


def test_malformed_token_rejected() -> None:
    with pytest.raises(ServiceTokenError, match="malformed"):
        _verify("not.a.token")


def test_non_object_header_json_rejected() -> None:
    _, payload_b64, signature_b64 = _token().split(".")
    forged = _b64url_encode(b"[]") + "." + payload_b64 + "." + signature_b64
    with pytest.raises(ServiceTokenError, match="malformed token"):
        _verify(forged)


def test_operation_id_defaults_to_uuid() -> None:
    principal = _verify(_token(operation_id=None))
    uuid.UUID(principal.operation_id)  # must parse
