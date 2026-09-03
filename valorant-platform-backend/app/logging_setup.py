import json
import logging
from datetime import UTC, datetime
from typing import Any

REDACT_KEYS = {"api_key", "authorization", "henrik_api_key", "password"}

# Standard LogRecord attributes that are always re-emitted by the formatter
# and therefore excluded from the "extra" section.
_RESERVED_KEYS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
    "taskName",
    "message",
}


def _redact(value: Any) -> Any:
    """Recursively replace values under any REDACT_KEYS key with [REDACTED].

    Applies at any nesting depth through dicts, lists, tuples and sets, so
    nested sensitive values (e.g. {"request": {"authorization": "secret"}})
    are redacted as well as top-level keys. Non-sensitive nested values are
    preserved unchanged.
    """
    if isinstance(value, dict):
        return {
            key: "[REDACTED]"
            if isinstance(key, str) and key.lower() in REDACT_KEYS
            else _redact(val)
            for key, val in value.items()
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_redact(item) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    """Single-line JSON formatter: ts, level, logger, msg plus redacted extra fields."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        extra = {k: v for k, v in record.__dict__.items() if k not in _RESERVED_KEYS}
        if extra:
            payload["extra"] = _redact(extra)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str = "INFO") -> None:
    """Configure root logging with a single JSON stream handler."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
