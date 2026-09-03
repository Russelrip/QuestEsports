"""Contract tests for the validation write boundary."""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


def test_validation_freeze_blocks_mutations_and_callback(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("WRITE_FREEZE_MODE", "validation")
    get_settings.cache_clear()
    client = TestClient(create_app())

    for method, path in (
        ("post", "/api/v1/teams"),
        ("patch", "/api/v1/teams/1"),
        ("get", "/api/v1/auth/discord/callback"),
    ):
        response = getattr(client, method)(path)
        assert response.status_code == 503
        assert response.headers["retry-after"] == "60"
        assert response.headers["x-write-freeze"] == "validation"
        assert response.headers["x-request-id"]
        assert response.json()["error"]["code"] == "WRITE_FREEZE_ACTIVE"

    status = client.get("/api/v1/freeze")
    assert status.status_code == 200
    assert status.json() == {"mode": "validation", "active": True}


def test_validation_freeze_leaves_health_unblocked(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("WRITE_FREEZE_MODE", "validation")
    get_settings.cache_clear()
    client = TestClient(create_app())
    response = client.get("/api/v1/health")
    assert response.headers.get("x-write-freeze") is None


def test_invalid_freeze_mode_is_rejected(monkeypatch) -> None:
    monkeypatch.setenv("WRITE_FREEZE_MODE", "invalid")
    get_settings.cache_clear()
    try:
        get_settings()
    except ValueError:
        pass
    else:  # pragma: no cover - pydantic currently raises ValidationError (a ValueError)
        raise AssertionError("invalid WRITE_FREEZE_MODE was accepted")
    finally:
        get_settings.cache_clear()


def test_frozen_request_keeps_standard_request_observability(monkeypatch, caplog) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("WRITE_FREEZE_MODE", "validation")
    get_settings.cache_clear()
    client = TestClient(create_app())
    root_logger = logging.getLogger()
    caplog_handler = caplog.handler
    handler_was_attached = caplog_handler in root_logger.handlers
    if not handler_was_attached:
        root_logger.addHandler(caplog_handler)
    caplog.set_level("INFO", logger="app.request")

    try:
        response = client.post("/api/v1/teams")

        request_id = response.headers["x-request-id"]
        completed = [record for record in caplog.records if record.getMessage() == "request completed"]
        assert completed
        assert completed[-1].request_id == request_id
        assert completed[-1].status_code == 503
    finally:
        if not handler_was_attached and caplog_handler in root_logger.handlers:
            root_logger.removeHandler(caplog_handler)
