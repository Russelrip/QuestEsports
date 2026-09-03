"""Error response contract tests (plan Task 3; design §14.1).

Every error response carries the shape ``{"error": {"code", "message",
"request_id"?}}``; the middleware correlation ID is authoritative and matches
body, header, and logs; unhandled exceptions map to a 500 ``INTERNAL_ERROR``
that is fully contained inside the app (no secret escapes response, logs, or
the ASGI/test-server channel); validation errors never echo raw input or
validator messages; ``HTTPException`` headers are preserved.
"""

import io
import json
import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, field_validator

import app.main as main_module
from app.api.dependencies import get_import_service, get_player_service
from app.api.errors import AppError
from app.config import Settings
from app.logging_setup import JsonFormatter
from app.main import create_app


class _EchoIn(BaseModel):
    name: str


class _TokenIn(BaseModel):
    token: str

    @field_validator("token")
    @classmethod
    def _check_token(cls, value: str) -> str:
        if value == "TOPSECRET":
            raise ValueError("invalid token TOPSECRET")
        return value


def _make_app() -> FastAPI:
    app = create_app()

    @app.get("/app-error")
    async def app_error() -> None:
        raise AppError(code="TEST_ERROR", status=422, message="test boom")

    @app.get("/app-error-detail")
    async def app_error_detail() -> None:
        raise AppError(
            code="TEST_CONFLICT",
            status=409,
            message="conflict happened",
            detail={"field": "x"},
        )

    @app.get("/empty-detail")
    async def empty_detail() -> None:
        raise AppError(code="EMPTY_DETAIL", status=400, message="empty detail", detail={})

    @app.get("/conflicting-app-request-id")
    async def conflicting_app_request_id() -> None:
        raise AppError(
            code="TEST_ERROR",
            status=409,
            message="caller id must lose",
            request_id="caller-controlled",
        )

    @app.get("/generic-http")
    async def generic_http() -> None:
        raise HTTPException(
            status_code=418,
            detail="teapot",
            headers={"Retry-After": "120", "WWW-Authenticate": 'Bearer realm="teapot"'},
        )

    @app.get("/www-auth")
    async def www_auth() -> None:
        raise HTTPException(
            status_code=401,
            detail="unauthorized",
            headers={"WWW-Authenticate": 'Bearer realm="valorant"'},
        )

    @app.get("/conflicting-http-request-id")
    async def conflicting_http_request_id() -> None:
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "CALLER", "message": "m", "request_id": "caller-controlled"}},
        )

    @app.get("/crash")
    async def crash() -> None:
        raise RuntimeError("internal secret detail")

    @app.post("/echo")
    async def echo(item: _EchoIn) -> dict:
        return {"name": item.name}

    @app.post("/token")
    async def token(item: _TokenIn) -> dict:
        return {"token": item.token}

    return app


def _attach_handler(logger_name: str) -> tuple[io.StringIO, logging.StreamHandler]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logging.getLogger(logger_name).addHandler(handler)
    return stream, handler


def test_app_error_returns_error_shape() -> None:
    client = TestClient(_make_app())
    resp = client.get("/app-error")
    assert resp.status_code == 422
    body = resp.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "TEST_ERROR"
    assert body["error"]["message"] == "test boom"
    assert body["error"]["request_id"]
    # The correlation ID is also echoed on the response.
    assert resp.headers["x-request-id"] == body["error"]["request_id"]


def test_app_error_includes_detail() -> None:
    client = TestClient(_make_app())
    resp = client.get("/app-error-detail")
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "TEST_CONFLICT"
    assert body["error"]["detail"] == {"field": "x"}


def test_app_error_empty_detail_preserved() -> None:
    client = TestClient(_make_app())
    resp = client.get("/empty-detail")
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"]["code"] == "EMPTY_DETAIL"
    assert body["error"]["detail"] == {}


def test_app_error_callers_request_id_is_not_authoritative() -> None:
    client = TestClient(_make_app())
    resp = client.get("/conflicting-app-request-id")
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["request_id"] != "caller-controlled"
    assert body["error"]["request_id"] == resp.headers["x-request-id"]


def test_generic_http_exception_preserves_headers_and_correlation() -> None:
    client = TestClient(_make_app())
    resp = client.get("/generic-http")
    assert resp.status_code == 418
    body = resp.json()
    assert body["error"]["code"] == "HTTP_ERROR"
    assert body["error"]["message"] == "teapot"
    assert body["error"]["request_id"]
    assert resp.headers["retry-after"] == "120"
    assert resp.headers["www-authenticate"] == 'Bearer realm="teapot"'
    assert resp.headers["x-request-id"] == body["error"]["request_id"]


def test_http_exception_401_preserves_www_authenticate() -> None:
    client = TestClient(_make_app())
    resp = client.get("/www-auth")
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"]["code"] == "HTTP_ERROR"
    assert body["error"]["message"] == "unauthorized"
    assert resp.headers["www-authenticate"] == 'Bearer realm="valorant"'
    assert resp.headers["x-request-id"] == body["error"]["request_id"]


def test_http_exception_callers_request_id_is_not_authoritative() -> None:
    client = TestClient(_make_app())
    resp = client.get("/conflicting-http-request-id")
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"]["code"] == "CALLER"
    assert body["error"]["request_id"] != "caller-controlled"
    assert body["error"]["request_id"] == resp.headers["x-request-id"]


def test_unknown_route_returns_error_shape() -> None:
    # Router-level 404s are raised as the base Starlette HTTPException; the
    # handler is registered under that class so the shape is consistent.
    client = TestClient(_make_app())
    resp = client.get("/definitely-not-a-route")
    assert resp.status_code == 404
    body = resp.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "HTTP_ERROR"
    assert body["error"]["request_id"]
    assert resp.headers["x-request-id"] == body["error"]["request_id"]


def test_unhandled_exception_returns_internal_error() -> None:
    # Default TestClient (raise_server_exceptions=True): the sanitizing barrier
    # must contain the exception, so this call never raises.
    client = TestClient(_make_app())
    resp = client.get("/crash")
    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == "internal server error"
    assert body["error"]["request_id"]
    assert resp.headers["x-request-id"] == body["error"]["request_id"]
    # No secret is ever echoed.
    assert "internal secret detail" not in resp.text


def test_unhandled_exception_logged_once_and_safely() -> None:
    app = _make_app()
    request_stream, request_handler = _attach_handler("app.request")
    diag_stream, diag_handler = _attach_handler("app.api.errors")
    try:
        client = TestClient(app)
        resp = client.get("/crash")
    finally:
        logging.getLogger("app.request").removeHandler(request_handler)
        logging.getLogger("app.api.errors").removeHandler(diag_handler)

    assert resp.status_code == 500
    # Exactly one structured "request completed" line, status 500, no exception text.
    request_lines = [line for line in request_stream.getvalue().splitlines() if line]
    assert len(request_lines) == 1
    log = json.loads(request_lines[0])
    assert log["msg"] == "request completed"
    assert log["extra"]["request_id"] == resp.headers["x-request-id"]
    assert log["extra"]["method"] == "GET"
    assert log["extra"]["path"] == "/crash"
    assert log["extra"]["status_code"] == 500
    assert 0 <= log["extra"]["duration_ms"] < 60_000
    assert "internal secret detail" not in request_stream.getvalue()
    assert "Traceback" not in request_stream.getvalue()
    # Separate safe server-side diagnostic: exception type + correlation ID only.
    diag_lines = [line for line in diag_stream.getvalue().splitlines() if line]
    assert len(diag_lines) == 1
    diag = json.loads(diag_lines[0])
    assert diag["msg"] == "unhandled exception"
    assert diag["extra"]["exception_type"] == "RuntimeError"
    assert diag["extra"]["request_id"] == resp.headers["x-request-id"]
    assert "internal secret detail" not in diag_stream.getvalue()
    assert "Traceback" not in diag_stream.getvalue()


def test_validation_error_returns_error_shape() -> None:
    client = TestClient(_make_app())
    resp = client.post("/echo", json={"wrong": "payload"})
    assert resp.status_code == 422
    body = resp.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert body["error"]["request_id"]


def test_validation_error_never_echoes_sensitive_input() -> None:
    client = TestClient(_make_app())
    secret = "hunter2secretvalue"
    resp = client.post("/echo", json={"name": {"password": secret}})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert body["error"]["request_id"]
    assert secret not in resp.text
    for err in body["error"]["detail"]["errors"]:
        for key in ("input", "ctx", "msg"):
            assert key not in err


def test_validation_error_never_echoes_validator_secret() -> None:
    client = TestClient(_make_app())
    resp = client.post("/token", json={"token": "TOPSECRET"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert body["error"]["request_id"]
    assert "TOPSECRET" not in resp.text
    errors = body["error"]["detail"]["errors"]
    assert errors
    for err in errors:
        assert "type" in err and "loc" in err
        for key in ("input", "ctx", "msg"):
            assert key not in err


def test_successful_request_has_correlation_id_and_structured_log() -> None:
    app = _make_app()
    stream, handler = _attach_handler("app.request")
    try:
        client = TestClient(app)
        resp = client.post("/echo", json={"name": "a"})
    finally:
        logging.getLogger("app.request").removeHandler(handler)
    assert resp.status_code == 200
    # The middleware echoes the per-request correlation ID on the response.
    assert resp.headers["x-request-id"]
    # ...and emits a single-line JSON "request completed" log for it.
    lines = [line for line in stream.getvalue().splitlines() if line]
    assert len(lines) == 1
    log = json.loads(lines[0])
    assert log["msg"] == "request completed"
    assert log["extra"]["request_id"] == resp.headers["x-request-id"]
    assert log["extra"]["method"] == "POST"
    assert log["extra"]["path"] == "/echo"
    assert log["extra"]["status_code"] == 200
    assert 0 <= log["extra"]["duration_ms"] < 60_000


def test_request_log_duration_ms_is_milliseconds(monkeypatch) -> None:
    app = _make_app()
    stream, handler = _attach_handler("app.request")
    clock = iter([10.0, 11.25])  # 1.25 seconds elapsed
    monkeypatch.setattr(main_module, "perf_counter", lambda: next(clock))
    try:
        client = TestClient(app)
        resp = client.post("/echo", json={"name": "a"})
    finally:
        logging.getLogger("app.request").removeHandler(handler)
    assert resp.status_code == 200
    lines = [line for line in stream.getvalue().splitlines() if line]
    assert len(lines) == 1
    log = json.loads(lines[0])
    assert log["extra"]["duration_ms"] == 1250.0  # 1.25 s * 1000, not 1.25


# ----------------------------- import-route validation mapping (fix round 2)


MATCH_ID_1 = "00000000-0000-0000-0000-000000000001"


def _import_app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    """App with admin bypass (app_env=test) and stubbed service dependencies.

    Validation errors surface before the endpoint runs, but FastAPI resolves
    the endpoint's service dependencies first, so the DB/upstream-bound
    dependencies are stubbed to keep this DB-free.
    """
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: Settings(app_env="test"),
    )
    app = create_app()

    async def _stub_import_service():
        yield object()

    async def _stub_player_service():
        yield object()

    app.dependency_overrides[get_import_service] = _stub_import_service
    app.dependency_overrides[get_player_service] = _stub_player_service
    return app


def test_import_route_malformed_match_id_returns_invalid_riot_id(monkeypatch) -> None:
    client = TestClient(_import_app(monkeypatch))
    resp = client.post("/api/v1/matches/import", json={"match_id": "ZZZ", "affinity": "eu"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "INVALID_RIOT_ID"
    assert body["error"]["request_id"]
    assert resp.headers["x-request-id"] == body["error"]["request_id"]
    # sanitization preserved: no raw input/ctx/msg in the validation detail
    for err in body["error"]["detail"]["errors"]:
        assert "input" not in err and "ctx" not in err and "msg" not in err


def test_import_route_invalid_refresh_keeps_invalid_request(monkeypatch) -> None:
    # The match_id is valid; the error is on an unrelated field, so the global
    # INVALID_REQUEST code is preserved (never INVALID_RIOT_ID).
    client = TestClient(_import_app(monkeypatch))
    resp = client.post(
        "/api/v1/matches/import", json={"match_id": MATCH_ID_1, "refresh": "nope"}
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert body["error"]["request_id"]
    assert resp.headers["x-request-id"] == body["error"]["request_id"]


def test_import_route_malformed_json_keeps_invalid_request(monkeypatch) -> None:
    # A JSON decode failure is located on the body itself, not on match_id.
    client = TestClient(_import_app(monkeypatch))
    resp = client.post(
        "/api/v1/matches/import",
        content=b'{"match_id": "00000000-0000-0000-0000-000000000001", "refresh":',
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


def test_player_resolve_malformed_name_keeps_invalid_riot_id(monkeypatch) -> None:
    # The player-route mapping is unchanged by the import-route change.
    client = TestClient(_import_app(monkeypatch))
    resp = client.post("/api/v1/players/resolve", json={"name": "A$B", "tag": "A"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_RIOT_ID"
