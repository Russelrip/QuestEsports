"""Registration route tests (SDD 2026-08-14 leaderboard standardization, task 5).

``TestClient(create_app())`` with ``app.dependency_overrides[get_registration_service]``
pointing at a fake service (no DB) proves the four routes' exact JSON shapes,
the ``PLAYER_NOT_FOUND`` 404 on a preview miss, the 409 conflict codes, and —
with ``app_env="production"`` — the service-token gate (401 with no or garbage
bearer header). The settings reader is monkeypatched inside
``app.api.dependencies`` (the same seam the leaderboard route tests use).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_registration_service
from app.api.errors import AppError
from app.config import Settings
from app.main import create_app
from app.schemas.registration import PlayerPreview, RegistrationSubmitResponse


class _FakeRegistrationService:
    """Stub service returning whatever preview/submit it was built with."""

    def __init__(
        self,
        *,
        preview: PlayerPreview | None = None,
        submit_response: RegistrationSubmitResponse | None = None,
        preview_error: AppError | None = None,
        submit_error: AppError | None = None,
    ) -> None:
        self._preview = preview
        self._submit_response = submit_response
        self._preview_error = preview_error
        self._submit_error = submit_error

    async def preview(self, puuid: str) -> PlayerPreview:
        if self._preview_error is not None:
            raise self._preview_error
        assert self._preview is not None, "preview() not stubbed"
        return self._preview

    async def submit(
        self, *, discord_id: str, discord_username: str, puuid: str
    ) -> RegistrationSubmitResponse:
        if self._submit_error is not None:
            raise self._submit_error
        assert self._submit_response is not None, "submit() not stubbed"
        return self._submit_response


PREVIEW_DICT = {
    "puuid": "puuid-1",
    "name": "PlayerA",
    "tag": "A",
    "current_rank": "Gold 1",
    "elo": 1200,
    "peak_rank": "Platinum 1",
    "peak_season": "e9a3",
    "last_played": "2026-01-02T03:04:05+00:00",
}

SUBMIT_DICT = {
    "success": True,
    "message": "Registration successful",
    "player": {"puuid": "puuid-1", "name": "PlayerA", "tag": "A", "current_rank": "Gold 1", "elo": 1200},
}

SUBMIT_BODY = {"puuid": "puuid-1", "discord_id": 123456789, "discord_username": "playerone"}


def _app(
    monkeypatch: pytest.MonkeyPatch,
    fake: _FakeRegistrationService,
    settings: Settings | None = None,
) -> FastAPI:
    """App with the settings reader patched (auth bypass seam) and the
    registration service dependency overridden with the fake."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: settings if settings is not None else Settings(app_env="test"),
    )
    app = create_app()

    async def _stub_registration_service():
        yield fake

    app.dependency_overrides[get_registration_service] = _stub_registration_service
    return app


def test_post_preview_returns_preview_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    preview = PlayerPreview(**PREVIEW_DICT)
    client = TestClient(_app(monkeypatch, _FakeRegistrationService(preview=preview)))
    resp = client.post("/api/v1/register/preview", json={"puuid": "puuid-1"})
    assert resp.status_code == 200
    assert resp.json() == preview.model_dump()


def test_get_preview_alias_returns_preview_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    preview = PlayerPreview(**PREVIEW_DICT)
    client = TestClient(_app(monkeypatch, _FakeRegistrationService(preview=preview)))
    resp = client.get("/api/v1/register/preview/puuid-1")
    assert resp.status_code == 200
    assert resp.json() == preview.model_dump()


def test_post_submit_returns_submit_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    response = RegistrationSubmitResponse(**SUBMIT_DICT)
    client = TestClient(_app(monkeypatch, _FakeRegistrationService(submit_response=response)))
    resp = client.post("/api/v1/register/submit", json=SUBMIT_BODY)
    assert resp.status_code == 200
    assert resp.json() == SUBMIT_DICT


def test_post_register_root_alias_returns_submit_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    response = RegistrationSubmitResponse(**SUBMIT_DICT)
    client = TestClient(_app(monkeypatch, _FakeRegistrationService(submit_response=response)))
    resp = client.post("/api/v1/register", json=SUBMIT_BODY)
    assert resp.status_code == 200
    assert resp.json() == SUBMIT_DICT


def test_preview_miss_returns_404(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRegistrationService(
        preview_error=AppError("PLAYER_NOT_FOUND", 404, "player not found or has no competitive data")
    )
    client = TestClient(_app(monkeypatch, fake))
    resp = client.post("/api/v1/register/preview", json={"puuid": "ghost"})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "PLAYER_NOT_FOUND"


def test_preview_conflict_returns_409(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRegistrationService(
        preview_error=AppError("PUUID_ALREADY_REGISTERED", 409, "puuid already registered")
    )
    client = TestClient(_app(monkeypatch, fake))
    resp = client.get("/api/v1/register/preview/puuid-1")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "PUUID_ALREADY_REGISTERED"


def test_submit_conflict_returns_409(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRegistrationService(
        submit_error=AppError("DISCORD_ALREADY_REGISTERED", 409, "discord already registered")
    )
    client = TestClient(_app(monkeypatch, fake))
    resp = client.post("/api/v1/register/submit", json=SUBMIT_BODY)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "DISCORD_ALREADY_REGISTERED"


def test_register_requires_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRegistrationService(submit_response=RegistrationSubmitResponse(**SUBMIT_DICT))
    app = _app(
        monkeypatch,
        fake,
        settings=Settings(app_env="production", quest_service_shared_secrets="kid=secret"),
    )
    client = TestClient(app)
    no_header = client.post("/api/v1/register", json=SUBMIT_BODY)
    assert no_header.status_code == 401
    assert no_header.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
    garbage = client.post("/api/v1/register", json=SUBMIT_BODY, headers={"Authorization": "Bearer garbage"})
    assert garbage.status_code == 401
    assert garbage.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
