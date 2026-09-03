"""Stable application error model and FastAPI error handlers (plan Task 3; design §14.1).

Every error response carries the shape ``{"error": {"code", "message",
"request_id"?}}``. The per-request correlation ID set by the request-id
middleware is the single authoritative ID: it is surfaced in the body, the
``X-Request-ID`` response header, and the structured request log, and no
caller-supplied ID can diverge from it. No secret is ever echoed.
"""

import logging
from dataclasses import dataclass

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.api.errors")

# Keys dropped from Pydantic validation errors: ``input`` can echo the raw
# submitted value (passwords, API keys), ``ctx`` can carry exception context,
# and ``msg`` can embed validator-generated secrets (e.g. "invalid token
# TOPSECRET"). ``type`` + ``loc`` remain for stable machine-readable detail.
_VALIDATION_STRIP_KEYS = frozenset({"input", "ctx", "msg"})


@dataclass
class AppError(Exception):
    """Canonical application error.

    Status classes (full table in the plan Appendix B):
    400 malformed/invalid | 404 missing | 409 conflict | 422 semantic
    | 429 upstream rate limit | 502/503 upstream.

    Not ``frozen=True``: ``contextlib``/``AsyncExitStack`` reassigns
    ``exc.__traceback__`` when a thrown exception propagates through a yielded
    dependency generator, and the frozen ``__setattr__`` raises
    ``FrozenInstanceError`` (Python 3.11+), turning every such error into a
    spurious 500. Fields stay immutable by convention.
    """

    code: str
    status: int
    message: str
    request_id: str | None = None
    detail: dict | None = None


def _error_body(code: str, message: str, request_id: str | None, detail: dict | None = None) -> dict:
    error: dict = {"code": code, "message": message}
    if request_id:
        error["request_id"] = request_id
    if detail is not None:
        error["detail"] = detail
    return {"error": error}


def _sanitized_validation_errors(exc: RequestValidationError) -> list[dict]:
    """Validation errors stripped of raw ``input``, ``ctx``, and ``msg``.

    ``input`` and ``ctx`` can echo submitted secrets; ``msg`` can embed
    validator-generated secrets. Only ``type``/``loc``/``url`` are kept.
    """
    sanitized: list[dict] = []
    for err in jsonable_encoder(exc.errors()):
        sanitized.append({key: value for key, value in err.items() if key not in _VALIDATION_STRIP_KEYS})
    return sanitized


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        # The middleware correlation ID is authoritative; a caller-supplied
        # AppError.request_id is only a fallback when no middleware ran.
        request_id = getattr(request.state, "request_id", None) or exc.request_id
        return JSONResponse(
            status_code=exc.status,
            content=_error_body(exc.code, exc.message, request_id, exc.detail),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Registered under the base Starlette class so it also covers router-level
        # 404s and FastAPI's subclass (fastapi.exceptions.HTTPException).
        request_id = getattr(request.state, "request_id", None)
        headers = dict(exc.headers or {})
        if request_id:
            headers["X-Request-ID"] = request_id
        detail = exc.detail
        if isinstance(detail, dict) and "error" in detail and isinstance(detail["error"], dict):
            # e.g. ADMIN_AUTH_REQUIRED raised by require_admin — already in
            # shape; force the middleware correlation ID so it never diverges.
            error = dict(detail["error"])
            error["request_id"] = request_id
            return JSONResponse(status_code=exc.status_code, content={"error": error}, headers=headers)
        if isinstance(detail, dict):
            message = str(detail["message"]) if "message" in detail else str(detail)
        elif detail is not None:
            message = str(detail)
        else:
            message = ""
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body("HTTP_ERROR", message, request_id),
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=422,
            content=_error_body(
                "INVALID_REQUEST",
                "request validation failed",
                request_id,
                {"errors": _sanitized_validation_errors(exc)},
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        # FastAPI routes the catch-all Exception handler to the outermost
        # ServerErrorMiddleware, so the response bypasses the request-id and
        # request-logging middleware; surface the correlation ID here directly.
        # The structured log deliberately carries no exception text/traceback
        # (free text may embed secrets the key-based redactor cannot scrub);
        # the full traceback remains in the ASGI server's own log channel.
        request_id = getattr(request.state, "request_id", None)
        logger.error(
            "unhandled exception",
            extra={
                "exception_type": type(exc).__name__,
                "request_id": request_id,
            },
        )
        headers = {"X-Request-ID": request_id} if request_id else None
        return JSONResponse(
            status_code=500,
            content=_error_body("INTERNAL_ERROR", "internal server error", request_id),
            headers=headers,
        )
