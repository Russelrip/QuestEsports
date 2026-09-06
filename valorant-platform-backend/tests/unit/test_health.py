"""Health endpoint tests (plan Task 3).

``GET /api/v1/health`` reports ``db`` as up/down/unknown without ever surfacing
a 500: import/initialization failures and a missing/None engine mean
``unknown``, an unreachable engine means ``down`` (both are HTTP 503). A
healthy response is the strict Quest smoke shape and every response carries the
correlation ID header.
"""

import sys
import types
from types import SimpleNamespace
from typing import Self

from fastapi.testclient import TestClient

from app.api.routes import health as health_routes
from app.api.service_token import sign_service_token
from app.main import create_app

_MISSING = object()


class _FakeConn:
    def __init__(self, ok: bool) -> None:
        self.ok = ok

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def execute(self, *args: object, **kwargs: object) -> None:
        if not self.ok:
            raise RuntimeError("connection failed")


class _FakeEngine:
    def __init__(self, ok: bool) -> None:
        self.ok = ok

    def connect(self) -> _FakeConn:
        return _FakeConn(self.ok)


def _install_fake_db(monkeypatch, engine=_MISSING) -> None:
    """Inject a fake ``app.db.session``.

    Default: module importable but has no ``engine`` attribute (import failure).
    ``engine=_MISSING`` is required to mean "no attribute"; passing ``engine=None``
    simulates a module whose ``engine`` attribute is explicitly None.
    """
    monkeypatch.setitem(sys.modules, "app.db", types.ModuleType("app.db"))
    if engine is _MISSING:
        module = types.ModuleType("app.db.session")
    else:
        module = SimpleNamespace(engine=engine)
    monkeypatch.setitem(sys.modules, "app.db.session", module)


def test_health(monkeypatch) -> None:
    """Deterministic happy path: fake engine is reachable, so db is up.

    The real ``app.db.session`` engine targets the default ``DATABASE_URL``
    (or nothing in CI, where only ``TEST_DATABASE_URL`` is set), so every
    health test fakes the exact DB module/engine state it asserts instead of
    depending on an accidentally available or missing local database.
    """
    _install_fake_db(monkeypatch, engine=_FakeEngine(ok=True))
    resp = TestClient(create_app()).get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"status": "ok", "db": "up"}
    assert resp.headers["x-request-id"]


def test_health_db_unknown_when_engine_unavailable(monkeypatch) -> None:
    """Engine module unavailable -> ``unknown``.

    Post-Task-4 the real ``app.db.session`` always exists, so the "engine
    unavailable" state is simulated deterministically: ``None`` in
    ``sys.modules`` makes ``from app.db.session import engine`` raise
    ImportError, and the health probe must report ``unknown`` without a 500.
    """
    _install_fake_db(monkeypatch)  # ``app.db`` package exists (Task 4)
    monkeypatch.setitem(sys.modules, "app.db.session", None)
    resp = TestClient(create_app()).get("/api/v1/health")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["db"] == "unknown"
    assert resp.headers["x-request-id"]


def test_health_db_unknown_on_import_failure(monkeypatch) -> None:
    _install_fake_db(monkeypatch)  # module importable, but no `engine` attribute
    resp = TestClient(create_app()).get("/api/v1/health")
    body = resp.json()
    assert body["db"] == "unknown"
    assert resp.status_code == 503
    assert body["status"] == "degraded"
    assert resp.headers["x-request-id"]


def test_health_db_unknown_when_engine_is_none(monkeypatch) -> None:
    _install_fake_db(monkeypatch, engine=None)  # module imports, engine is None
    resp = TestClient(create_app()).get("/api/v1/health")
    body = resp.json()
    assert body["db"] == "unknown"
    assert resp.status_code == 503
    assert body["status"] == "degraded"
    assert resp.headers["x-request-id"]


def test_health_db_up(monkeypatch) -> None:
    _install_fake_db(monkeypatch, engine=_FakeEngine(ok=True))
    resp = TestClient(create_app()).get("/api/v1/health")
    body = resp.json()
    assert body == {"status": "ok", "db": "up"}
    assert resp.headers["x-request-id"]


def test_health_db_down_is_degraded(monkeypatch) -> None:
    _install_fake_db(monkeypatch, engine=_FakeEngine(ok=False))
    resp = TestClient(create_app()).get("/api/v1/health")
    body = resp.json()
    assert resp.status_code == 503
    assert body == {"status": "degraded", "db": "down"}
    assert resp.headers["x-request-id"]


def test_production_health_requires_a_quest_compatible_service_token(monkeypatch) -> None:
    settings = SimpleNamespace(
        app_env="production",
        quest_service_shared_secrets="current=shared-secret",
        quest_service_issuer="quest-esports",
        quest_service_audience="valorant-platform",
        service_token_max_skew_seconds=30,
        production_validation_errors=lambda: (),
    )
    monkeypatch.setattr(health_routes, "get_settings", lambda: settings)
    _install_fake_db(monkeypatch, engine=_FakeEngine(ok=True))
    token = sign_service_token(
        secret="shared-secret",
        kid="current",
        issuer="quest-esports",
        audience="valorant-platform",
        subject="quest-health",
    )

    accepted = TestClient(create_app()).get(
        "/api/v1/health", headers={"Authorization": f"Bearer {token}"}
    )
    assert accepted.status_code == 200
    assert accepted.json()["checks"]["service_token"] == "ready"

    rejected = TestClient(create_app()).get(
        "/api/v1/health", headers={"Authorization": "Bearer not-a-valid-quest-token"}
    )
    assert rejected.status_code == 503
    assert rejected.json()["checks"]["service_token"] == "not_ready"
