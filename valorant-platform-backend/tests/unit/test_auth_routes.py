"""Auth route tests (SDD 2026-08-14 leaderboard standardization, task 6).

``TestClient(create_app())`` with ``app.dependency_overrides[get_auth_service]``
pointing at a fake service (no DB, no Discord network) proves the seven routes'
exact JSON shapes (including the explicit ``null`` ``user``/``existing_data`` on
misses — R22), the ``OAUTH_CODE_ALREADY_USED`` 409 on a reused code, and — with
``app_env="production"`` — the service-token gate (401 with no or garbage bearer
header). The settings reader is monkeypatched inside ``app.api.dependencies``
(the same seam the registration route tests use).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_auth_service
from app.api.errors import AppError
from app.config import Settings
from app.main import create_app
from app.schemas.auth import (
    CheckDiscordResponse,
    CheckDiscordUser,
    CheckPuuidResponse,
    CheckPuuidUser,
    DiscordCallbackResponse,
    DiscordCallbackUser,
    DiscordExistingData,
    DiscordLoginResponse,
)

LOGIN_URL = (
    "https://discord.com/oauth2/authorize?client_id=12345678901234567"
    "&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fregister"
    "&response_type=code&scope=identify%20email"
)

CALLBACK_RESPONSE = DiscordCallbackResponse(
    user=DiscordCallbackUser(
        discord_id="12345678901234567",
        discord_username="playerone",
        discord_discriminator="0",
        discord_avatar="abc123",
        discord_email="player@example.com",
        access_token="tok-123",
    ),
    exists=True,
    existing_data=DiscordExistingData(
        puuid="puuid-1",
        name="PlayerA",
        tag="A",
        current_rank="Gold 1",
    ),
)

CHECK_DISCORD_RESPONSE = CheckDiscordResponse(
    exists=True,
    user=CheckDiscordUser(
        puuid="puuid-1",
        name="PlayerA",
        tag="A",
        discord_username="playerone",
        current_rank="Gold 1",
    ),
)

CHECK_PUUID_RESPONSE = CheckPuuidResponse(
    exists=True,
    user=CheckPuuidUser(name="PlayerA", tag="A", discord_username="playerone"),
)


class _FakeAuthService:
    """Stub service returning whatever the routes were pointed at."""

    def __init__(
        self,
        *,
        login_url: str = LOGIN_URL,
        callback_response: DiscordCallbackResponse | None = None,
        callback_error: AppError | None = None,
        check_discord: CheckDiscordResponse | None = None,
        check_puuid: CheckPuuidResponse | None = None,
    ) -> None:
        self._login_url = login_url
        self._callback_response = callback_response
        self._callback_error = callback_error
        self._check_discord = check_discord
        self._check_puuid = check_puuid

    def login_url(self) -> str:
        return self._login_url

    async def callback(self, code: str) -> DiscordCallbackResponse:
        if self._callback_error is not None:
            raise self._callback_error
        assert self._callback_response is not None, "callback() not stubbed"
        return self._callback_response

    async def check_discord(self, discord_id: str) -> CheckDiscordResponse:
        assert self._check_discord is not None, "check_discord() not stubbed"
        return self._check_discord

    async def check_puuid(self, puuid: str) -> CheckPuuidResponse:
        assert self._check_puuid is not None, "check_puuid() not stubbed"
        return self._check_puuid


def _app(
    monkeypatch: pytest.MonkeyPatch,
    fake: _FakeAuthService,
    settings: Settings | None = None,
) -> FastAPI:
    """App with the settings reader patched (auth bypass seam) and the auth
    service dependency overridden with the fake."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: settings if settings is not None else Settings(app_env="test"),
    )
    app = create_app()

    async def _stub_auth_service():
        yield fake

    app.dependency_overrides[get_auth_service] = _stub_auth_service
    return app


def test_get_discord_login_returns_url(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeAuthService()))
    resp = client.get("/api/v1/auth/discord/login")
    assert resp.status_code == 200
    assert resp.json() == DiscordLoginResponse(url=LOGIN_URL).model_dump()


def test_get_login_alias_returns_url(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeAuthService()))
    resp = client.get("/api/v1/auth/login")
    assert resp.status_code == 200
    assert resp.json() == {"url": LOGIN_URL}


def test_get_callback_returns_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeAuthService(callback_response=CALLBACK_RESPONSE)))
    resp = client.get("/api/v1/auth/discord/callback", params={"code": "some-code"})
    assert resp.status_code == 200
    assert resp.json() == CALLBACK_RESPONSE.model_dump()


def test_post_check_discord_returns_user(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeAuthService(check_discord=CHECK_DISCORD_RESPONSE)))
    resp = client.post("/api/v1/auth/check-discord", json={"discord_id": 123456789})
    assert resp.status_code == 200
    assert resp.json() == CHECK_DISCORD_RESPONSE.model_dump()


def test_get_check_discord_alias_returns_user(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeAuthService(check_discord=CHECK_DISCORD_RESPONSE)))
    resp = client.get("/api/v1/auth/check-discord/123456789")
    assert resp.status_code == 200
    assert resp.json() == CHECK_DISCORD_RESPONSE.model_dump()


def test_post_check_puuid_returns_user(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeAuthService(check_puuid=CHECK_PUUID_RESPONSE)))
    resp = client.post("/api/v1/auth/check-puuid", json={"puuid": "puuid-1"})
    assert resp.status_code == 200
    assert resp.json() == CHECK_PUUID_RESPONSE.model_dump()


def test_get_check_puuid_alias_returns_user(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(_app(monkeypatch, _FakeAuthService(check_puuid=CHECK_PUUID_RESPONSE)))
    resp = client.get("/api/v1/auth/check-puuid/puuid-1")
    assert resp.status_code == 200
    assert resp.json() == CHECK_PUUID_RESPONSE.model_dump()


def test_callback_reused_code_returns_409(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeAuthService(
        callback_error=AppError("OAUTH_CODE_ALREADY_USED", 409, "OAuth code already used")
    )
    client = TestClient(_app(monkeypatch, fake))
    resp = client.get("/api/v1/auth/discord/callback", params={"code": "reused"})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "OAUTH_CODE_ALREADY_USED"


def test_auth_requires_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    app = _app(
        monkeypatch,
        _FakeAuthService(check_discord=CHECK_DISCORD_RESPONSE),
        settings=Settings(app_env="production", quest_service_shared_secrets="kid=secret"),
    )
    client = TestClient(app)
    no_header = client.post("/api/v1/auth/check-discord", json={"discord_id": "123"})
    assert no_header.status_code == 401
    assert no_header.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
    garbage = client.post(
        "/api/v1/auth/check-discord",
        json={"discord_id": "123"},
        headers={"Authorization": "Bearer garbage"},
    )
    assert garbage.status_code == 401
    assert garbage.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
