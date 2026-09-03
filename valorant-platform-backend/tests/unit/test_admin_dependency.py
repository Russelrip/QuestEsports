"""Admin dependency tests (plan Task 3; Global Constraints 11).

``require_admin`` gates mutation-style routes with the ``X-Admin-Key`` header
(compared in constant time); it is bypassed entirely in ``local``/``test``
environments and denied whenever no key is configured.
"""

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.api.dependencies import require_admin
from app.config import Settings
from app.main import create_app


def _build_client(monkeypatch: pytest.MonkeyPatch, **settings_kwargs: object) -> TestClient:
    settings = Settings(**settings_kwargs)
    monkeypatch.setattr("app.api.dependencies.get_settings", lambda: settings)
    app = create_app()
    router = APIRouter()
    # A path that no real route owns, so the probe route always wins the match
    # (Task 11 now registers the real ``POST /api/v1/teams`` in ``create_app``).
    @router.post("/api/v1/_admin-probe", dependencies=[Depends(require_admin)])
    async def create_team() -> dict:
        return {"ok": True}

    app.include_router(router)
    return TestClient(app)


def test_missing_admin_key_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client(monkeypatch, app_env="production", admin_api_key="s3cret-key")
    resp = client.post("/api/v1/_admin-probe")
    assert resp.status_code == 401
    body = resp.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "ADMIN_AUTH_REQUIRED"
    assert body["error"]["message"] == "admin key required"
    assert body["error"]["request_id"]
    assert "s3cret-key" not in resp.text


def test_correct_admin_key_allows_request(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client(monkeypatch, app_env="production", admin_api_key="s3cret-key")
    resp = client.post("/api/v1/_admin-probe", headers={"X-Admin-Key": "s3cret-key"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_wrong_admin_key_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client(monkeypatch, app_env="production", admin_api_key="s3cret-key")
    resp = client.post("/api/v1/_admin-probe", headers={"X-Admin-Key": "wrong-key"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"


def test_production_without_configured_key_denies_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client(monkeypatch, app_env="production", admin_api_key=None)
    resp = client.post("/api/v1/_admin-probe", headers={"X-Admin-Key": "anything"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"


def test_test_env_bypasses_admin_key(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client(monkeypatch, app_env="test", admin_api_key=None)
    resp = client.post("/api/v1/_admin-probe")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_local_env_bypasses_admin_key(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build_client(monkeypatch, app_env="local", admin_api_key=None)
    resp = client.post("/api/v1/_admin-probe")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
