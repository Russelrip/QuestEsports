"""Validation-mode write admission for the FastAPI process and workers.

The release validation window is deliberately an application-level gate.  It
does not change database grants, and it is therefore safe to turn off without
restarting the database or migration boundary.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.dependencies import require_service_token
from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

FREEZE_MODE_OFF = "off"
FREEZE_MODE_VALIDATION = "validation"
_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_CALLBACK_PATH = "/api/v1/auth/discord/callback"

router = APIRouter(tags=["operations"])


def freeze_status(settings: Settings | None = None) -> dict[str, object]:
    """Return the small, machine-readable freeze status contract."""
    mode = (settings or get_settings()).write_freeze_mode
    return {"mode": mode, "active": mode == FREEZE_MODE_VALIDATION}


def writer_admitted(settings: Settings | None = None) -> bool:
    """Whether a worker may construct clients or sessions and begin writing."""
    return (settings or get_settings()).write_freeze_mode == FREEZE_MODE_OFF


def refuse_writer_start(worker_name: str, settings: Settings | None = None) -> bool:
    """Log a visible skip and return whether the writer should start."""
    admitted = writer_admitted(settings)
    if not admitted:
        logger.warning("writer admission denied: worker=%s mode=validation", worker_name)
    return admitted


@router.get("/api/v1/freeze", dependencies=[Depends(require_service_token)])
async def get_freeze_status() -> dict[str, object]:
    """Authenticated operational status used during a validation window."""
    return freeze_status()


class WriteFreezeMiddleware(BaseHTTPMiddleware):
    """Reject mutating routes and the OAuth callback while validation is active."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        settings = get_settings()
        frozen = settings.write_freeze_mode == FREEZE_MODE_VALIDATION
        is_callback = request.url.path.rstrip("/") == _CALLBACK_PATH
        if frozen and (request.method in _WRITE_METHODS or is_callback):
            logger.warning(
                "request rejected by write freeze: method=%s path=%s mode=validation",
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=503,
                headers={
                    "Retry-After": str(settings.write_freeze_retry_after_seconds),
                    "X-Write-Freeze": FREEZE_MODE_VALIDATION,
                    "Cache-Control": "no-store",
                },
                content={
                    "error": {
                        "code": "WRITE_FREEZE_ACTIVE",
                        "message": "writes are temporarily frozen for validation",
                        "retryable": True,
                    },
                    "write_freeze": freeze_status(settings),
                },
            )
        return await call_next(request)
