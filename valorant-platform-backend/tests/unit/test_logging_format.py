import io
import json
import logging

import pytest

from app.logging_setup import REDACT_KEYS, JsonFormatter


def _capture_logger(name: str) -> tuple[logging.Logger, io.StringIO, logging.StreamHandler]:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    return logger, stream, handler


def test_json_formatter_output_is_parseable_json() -> None:
    logger, stream, handler = _capture_logger("test.json")
    try:
        logger.info("hello %s", "world", extra={"request_id": "abc-123"})
    finally:
        logger.removeHandler(handler)

    raw = stream.getvalue()
    parsed = json.loads(raw)
    assert parsed["msg"] == "hello world"
    assert parsed["logger"] == "test.json"
    assert parsed["level"] == "INFO"
    assert parsed["ts"].endswith("+00:00")
    assert parsed["extra"]["request_id"] == "abc-123"


@pytest.mark.parametrize("sensitive_key", sorted(REDACT_KEYS))
def test_json_formatter_redacts_sensitive_keys(sensitive_key: str) -> None:
    logger, stream, handler = _capture_logger("test.redact")
    secret = "supersecretvalue"
    try:
        logger.info("login attempt", extra={sensitive_key: secret, "request_id": "r1"})
    finally:
        logger.removeHandler(handler)

    raw = stream.getvalue()
    assert secret not in raw
    parsed = json.loads(raw)
    assert parsed["extra"][sensitive_key] == "[REDACTED]"
    assert parsed["extra"]["request_id"] == "r1"


def test_json_formatter_redacts_nested_sensitive_values() -> None:
    logger, stream, handler = _capture_logger("test.nested-redact")
    secret = "nested-secret-value"
    try:
        logger.info(
            "request",
            extra={
                "request": {
                    "authorization": secret,
                    "headers": {"henrik_api_key": secret, "x-request-id": "r1"},
                    "ids": [{"password": secret}, {"request_id": "r2"}],
                }
            },
        )
    finally:
        logger.removeHandler(handler)

    raw = stream.getvalue()
    assert secret not in raw
    parsed = json.loads(raw)
    request = parsed["extra"]["request"]
    assert request["authorization"] == "[REDACTED]"
    assert request["headers"]["henrik_api_key"] == "[REDACTED]"
    assert request["ids"][0]["password"] == "[REDACTED]"
    assert request["headers"]["x-request-id"] == "r1"
    assert request["ids"][1]["request_id"] == "r2"


def test_json_formatter_preserves_nested_non_sensitive_values() -> None:
    logger, stream, handler = _capture_logger("test.nested-keep")
    try:
        logger.info(
            "request",
            extra={
                "request": {
                    "method": "POST",
                    "headers": {"x-request-id": "abc", "user_agent": "curl/8.0"},
                    "items": [{"name": "valorant", "count": 2}, ["a", "b"]],
                }
            },
        )
    finally:
        logger.removeHandler(handler)

    parsed = json.loads(stream.getvalue())
    assert parsed["extra"]["request"] == {
        "method": "POST",
        "headers": {"x-request-id": "abc", "user_agent": "curl/8.0"},
        "items": [{"name": "valorant", "count": 2}, ["a", "b"]],
    }
