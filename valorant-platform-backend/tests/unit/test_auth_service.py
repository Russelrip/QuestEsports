"""``AuthService`` tests (SDD 2026-08-14 leaderboard standardization, task 6).

Fake ``LeaderboardPlayerRepository`` + injected ``httpx.AsyncClient`` over
``MockTransport`` (no network) prove the minimal Discord OAuth exchange (R21):
login-URL shape, code exchange -> ``/users/@me`` -> response build, the
in-memory code dedupe (409 on reuse; discard on error so retries never 409 —
R24), the ``{exists, user}`` check responses with an explicit ``null`` user on
a miss (R22), and the ``DISCORD_AUTH_FAILED`` (400) mapping for non-200 Discord
responses (R23). The settings reader is monkeypatched so the Discord
credentials are pinned.
"""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest

from app.api.errors import AppError
from app.config import Settings
from app.schemas.auth import CheckDiscordResponse, CheckPuuidResponse, DiscordCallbackResponse
from app.services import auth_service
from app.services.auth_service import AuthService

SETTINGS = Settings(
    app_env="test",
    discord_client_id="12345678901234567",
    discord_client_secret="discord-secret",
    discord_redirect_uri="http://localhost:3000/register",
)

TOKEN_PATH = "/api/oauth2/token"
USER_PATH = "/api/users/@me"


class FakeRepo:
    """In-memory mirror of the ``LeaderboardPlayerRepository`` read surface."""

    def __init__(self, *, by_puuid: dict[str, object] | None = None, by_discord_id: dict[str, object] | None = None) -> None:
        self.by_puuid = by_puuid or {}
        self.by_discord_id = by_discord_id or {}

    async def get_by_puuid(self, puuid: str) -> object | None:
        return self.by_puuid.get(puuid)

    async def get_by_discord_id(self, discord_id: str) -> object | None:
        return self.by_discord_id.get(str(discord_id))


class _Player:
    """Minimal stand-in for a ``LeaderboardPlayer`` row."""

    def __init__(self, **fields: object) -> None:
        self.__dict__.update(fields)


@pytest.fixture(autouse=True)
def _clear_used_codes() -> Iterator[None]:
    """The dedupe set is module-global (single-instance); isolate tests."""
    auth_service._used_codes.clear()
    yield
    auth_service._used_codes.clear()


def _service(repo: FakeRepo, http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> AuthService:
    monkeypatch.setattr(auth_service, "get_settings", lambda: SETTINGS)
    return AuthService(session=None, repo=repo, http=http)  # type: ignore[arg-type]


def _ok_handler(seen: dict | None = None):
    """Token exchange + /users/@me both 200, recording the token request body."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == TOKEN_PATH:
            if seen is not None:
                seen["token_body"] = request.content
            return httpx.Response(
                200,
                json={
                    "access_token": "tok-123",
                    "refresh_token": "ref-1",
                    "token_type": "Bearer",
                    "expires_in": 604800,
                    "scope": "identify email",
                },
            )
        if request.url.path == USER_PATH:
            assert request.headers["Authorization"] == "Bearer tok-123"
            return httpx.Response(
                200,
                json={
                    "id": "12345678901234567",
                    "username": "playerone",
                    "discriminator": "0",
                    "avatar": "abc123",
                    "email": "player@example.com",
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    return handler


# ------------------------------------------------------------- login_url

async def test_login_url_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_service, "get_settings", lambda: SETTINGS)
    svc = AuthService(session=None, repo=FakeRepo(), http=None)  # type: ignore[arg-type]
    url = svc.login_url()
    assert url == (
        "https://discord.com/oauth2/authorize?client_id=12345678901234567"
        "&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fregister"
        "&response_type=code&scope=identify%20email"
    )


# ------------------------------------------------------------ callback

async def test_callback_exchanges_fetches_and_builds_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict = {}
    player = _Player(
        puuid="puuid-1",
        name="PlayerA",
        tag="A",
        discord_username="playerone",
        rank_details={"currenttierpatched": "Gold 1", "elo": 1200},
    )
    repo = FakeRepo(by_discord_id={"12345678901234567": player})
    http = httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler(seen)))
    svc = _service(repo, http, monkeypatch)

    resp = await svc.callback("fresh-code")

    assert isinstance(resp, DiscordCallbackResponse)
    assert resp.exists is True
    assert resp.user.discord_id == "12345678901234567"
    assert resp.user.discord_username == "playerone"
    assert resp.user.discord_discriminator == "0"
    assert resp.user.discord_avatar == "abc123"
    assert resp.user.discord_email == "player@example.com"
    assert resp.user.access_token == "tok-123"
    assert resp.existing_data is not None
    assert resp.existing_data.puuid == "puuid-1"
    assert resp.existing_data.name == "PlayerA"
    assert resp.existing_data.tag == "A"
    assert resp.existing_data.current_rank == "Gold 1"
    # The exchange POST carried the auth code + credentials (R21).
    assert b"code=fresh-code" in seen["token_body"]
    assert b"grant_type=authorization_code" in seen["token_body"]
    assert b"client_id=12345678901234567" in seen["token_body"]
    assert b"redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fregister" in seen["token_body"]
    # R24: a successful exchange leaves the code in the dedupe set.
    assert "fresh-code" in auth_service._used_codes


async def test_callback_unknown_discord_user_reports_exists_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler()))
    svc = _service(FakeRepo(), http, monkeypatch)

    resp = await svc.callback("new-code")

    assert resp.exists is False
    assert resp.existing_data is None
    assert resp.user.discord_id == "12345678901234567"


async def test_callback_reused_code_raises_409(monkeypatch: pytest.MonkeyPatch) -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler()))
    svc = _service(FakeRepo(), http, monkeypatch)
    await svc.callback("reuse-code")

    with pytest.raises(AppError) as excinfo:
        await svc.callback("reuse-code")

    assert excinfo.value.code == "OAUTH_CODE_ALREADY_USED"
    assert excinfo.value.status == 409


async def test_callback_user_fetch_non_200_raises_discord_auth_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == TOKEN_PATH:
            return httpx.Response(200, json={"access_token": "tok"})
        return httpx.Response(500, json={"message": "boom"})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    svc = _service(FakeRepo(), http, monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.callback("fail-code")

    assert excinfo.value.code == "DISCORD_AUTH_FAILED"
    assert excinfo.value.status == 400


async def test_callback_token_exchange_non_200_raises_discord_auth_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    svc = _service(FakeRepo(), http, monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.callback("bad-code")

    assert excinfo.value.code == "DISCORD_AUTH_FAILED"
    assert excinfo.value.status == 400
    # R24: the code is discarded on error, so a retry must not 409.
    assert "bad-code" not in auth_service._used_codes


async def test_callback_discards_code_on_error_so_retry_never_409s(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == TOKEN_PATH:
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(500, json={})
            return httpx.Response(200, json={"access_token": "tok"})
        return httpx.Response(200, json={"id": "1", "username": "u"})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    svc = _service(FakeRepo(), http, monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.callback("retry-code")
    assert excinfo.value.code == "DISCORD_AUTH_FAILED"

    resp = await svc.callback("retry-code")
    assert resp.exists is False


# ------------------------------------------------------- check-discord

async def test_check_discord_miss_has_explicit_null_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler()))
    svc = _service(FakeRepo(), http, monkeypatch)

    resp = await svc.check_discord("nobody")

    assert isinstance(resp, CheckDiscordResponse)
    assert resp.exists is False
    assert resp.user is None
    assert resp.model_dump() == {"exists": False, "user": None}


async def test_check_discord_hit_builds_user(monkeypatch: pytest.MonkeyPatch) -> None:
    player = _Player(
        puuid="puuid-1",
        name="PlayerA",
        tag="A",
        discord_username="playerone",
        rank_details={"data": {"currenttierpatched": "Silver 3"}},
    )
    repo = FakeRepo(by_discord_id={"123": player})
    http = httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler()))
    svc = _service(repo, http, monkeypatch)

    resp = await svc.check_discord("123")

    assert resp.exists is True
    assert resp.user is not None
    assert resp.user.puuid == "puuid-1"
    assert resp.user.name == "PlayerA"
    assert resp.user.tag == "A"
    assert resp.user.discord_username == "playerone"
    assert resp.user.current_rank == "Silver 3"  # legacy nested shape via get_rank_field


# --------------------------------------------------------- check-puuid

async def test_check_puuid_miss_has_explicit_null_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler()))
    svc = _service(FakeRepo(), http, monkeypatch)

    resp = await svc.check_puuid("ghost")

    assert isinstance(resp, CheckPuuidResponse)
    assert resp.exists is False
    assert resp.user is None
    assert resp.model_dump() == {"exists": False, "user": None}


async def test_check_puuid_hit_builds_user(monkeypatch: pytest.MonkeyPatch) -> None:
    player = _Player(name="PlayerA", tag="A", discord_username="playerone", rank_details={})
    repo = FakeRepo(by_puuid={"puuid-1": player})
    http = httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler()))
    svc = _service(repo, http, monkeypatch)

    resp = await svc.check_puuid("puuid-1")

    assert resp.exists is True
    assert resp.user is not None
    assert resp.user.name == "PlayerA"
    assert resp.user.tag == "A"
    assert resp.user.discord_username == "playerone"
