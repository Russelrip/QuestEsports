import logging
import re
import uuid
from collections.abc import Iterable
from time import perf_counter

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.errors import _error_body, _sanitized_validation_errors, register_error_handlers
from app.api.routes import (
    auth,
    health,
    leaderboard,
    match_search,
    matches,
    players,
    rankings,
    registration,
    series,
    teams,
)
from app.config import get_settings
from app.logging_setup import setup_logging
from app.middleware.write_freeze import WriteFreezeMiddleware
from app.middleware.write_freeze import router as freeze_router

logger = logging.getLogger("app.request")


def _log_request_completed(request: Request, status_code: int, elapsed_seconds: float) -> None:
    logger.info(
        "request completed",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "method": request.method,
            "path": request.url.path,
            "status_code": status_code,
            "duration_ms": round(elapsed_seconds * 1000.0, 1),
        },
    )


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assign the authoritative per-request correlation ID, echoed on the response."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.request_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Exactly one structured "request completed" line per request.

    Handled errors return normally; unhandled exceptions re-raise through
    ``call_next`` and are logged here (status 500) before the catch-all
    handler builds the response, so every request yields exactly one line.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        start = perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            _log_request_completed(request, 500, perf_counter() - start)
            raise
        _log_request_completed(request, response.status_code, perf_counter() - start)
        return response


class SanitizeExceptionMiddleware:
    """Outermost ASGI barrier: keep unhandled exceptions inside the app.

    FastAPI always places ServerErrorMiddleware at the outermost layer, and it
    re-raises after sending its 500 response so the server can log it — which
    would leak the original exception's message/traceback (potentially
    secret-bearing) through the ASGI/test-server channel. This wrapper is
    installed outside ServerErrorMiddleware and swallows that re-raise; the
    sanitized 500 has already been sent by the registered ``Exception``
    handler. Only HTTP is handled; other scope types pass through untouched.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def sender(message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, sender)
        except Exception:  # noqa: BLE001  # sanitized 500 already sent by the handler
            if not response_started:
                # Handler itself failed before sending; emit a minimal sanitized 500.
                body = b'{"error": {"code": "INTERNAL_ERROR", "message": "internal server error"}}'
                await send(
                    {
                        "type": "http.response.start",
                        "status": 500,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send({"type": "http.response.body", "body": body})


def _install_exception_barrier(app: FastAPI) -> None:
    """Wrap the full middleware stack with SanitizeExceptionMiddleware.

    ServerErrorMiddleware is hardcoded as the outermost layer of
    ``build_middleware_stack``; overriding the method on the instance lets us
    place the sanitizing barrier outside it without changing FastAPI/Starlette.
    """

    def build_stack():
        return SanitizeExceptionMiddleware(original_build())

    original_build = app.build_middleware_stack
    app.build_middleware_stack = build_stack  # type: ignore[method-assign]


_INVALID_RIOT_ID_PREFIX = "/api/v1/players"
_INVALID_RIOT_ID_IMPORT_PATH = "/api/v1/matches/import"
# GET /api/v1/matches/{match_id} — exactly one segment after /matches/.
_MATCHES_DETAIL_PATH = re.compile(r"^/api/v1/matches/[^/]+$")


def _is_invalid_riot_id_validation(path: str, errors: Iterable[dict]) -> bool:
    """Decide whether a RequestValidationError surfaces as ``INVALID_RIOT_ID``.

    Player routes (``/api/v1/players*``) keep the path-wide mapping: every
    body/path validation error there is an identifier error (name/tag/UUID).
    The canonical import route maps to ``INVALID_RIOT_ID`` only when the error
    is located on the request's ``match_id`` field — unrelated body errors
    (invalid ``refresh``, malformed JSON located on ``body`` only, or a future
    field) keep the global ``INVALID_REQUEST`` response. The Match Library
    detail route (``GET /api/v1/matches/{match_id}``) maps only its malformed
    internal-UUID path parameter to ``INVALID_RIOT_ID``; list/query errors
    (bad ``limit``, unparsable ``from``/``to``) keep ``INVALID_REQUEST``.
    """
    if path.startswith(_INVALID_RIOT_ID_PREFIX):
        return True
    if path == _INVALID_RIOT_ID_IMPORT_PATH:
        return _errors_located_on_match_id(errors)
    return bool(_MATCHES_DETAIL_PATH.match(path)) and _errors_located_on_path_match_id(errors)


def _errors_located_on_path_match_id(errors: Iterable[dict]) -> bool:
    """True only when every validation error is located on the detail route's
    ``match_id`` path parameter (``path.match_id``) — the UUID parse failure.
    """
    if not errors:
        return False
    for error in errors:
        if tuple(error.get("loc") or ()) != ("path", "match_id"):
            return False
    return True


def _errors_located_on_match_id(errors: Iterable[dict]) -> bool:
    """True only when every validation error is located on the import
    request's ``match_id`` field (``body.match_id``) — e.g. a pattern/length/
    type/missing error for that field. An error on any other field keeps
    ``INVALID_REQUEST``."""
    if not errors:
        return False
    for error in errors:
        loc = error.get("loc") or ()
        parts = [part for part in loc if part != "body"]
        if not parts or parts[0] != "match_id":
            return False
    return True


async def _request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Path- and location-aware validation handler registered after
    ``register_error_handlers``.

    Malformed player identifiers — an invalid ``name``/``tag`` body or a
    malformed player UUID path parameter — a malformed canonical import
    ``match_id``, and a malformed Match Library internal-UUID path parameter
    all surface as ``INVALID_RIOT_ID`` (422) per the Task 6/Task 8/Task 9
    error contract. On the import route only errors located on ``match_id``
    map to ``INVALID_RIOT_ID``; unrelated body errors (invalid ``refresh``,
    malformed JSON, future fields) keep the global sanitized
    ``INVALID_REQUEST`` response unchanged, as do library list/query errors.
    Validation detail is sanitized the same way as the global handler (no raw
    ``input``/``ctx``/``msg``).
    """
    request_id = getattr(request.state, "request_id", None)
    detail = {"errors": _sanitized_validation_errors(exc)}
    if _is_invalid_riot_id_validation(request.url.path, exc.errors()):
        return JSONResponse(
            status_code=422,
            content=_error_body("INVALID_RIOT_ID", "invalid Riot ID or player identifier", request_id, detail),
        )
    return JSONResponse(
        status_code=422,
        content=_error_body("INVALID_REQUEST", "request validation failed", request_id, detail),
    )


def create_app() -> FastAPI:
    setup_logging(get_settings().log_level)
    app = FastAPI(title="VALORANT Platform Backend", version="0.1.0")
    app.add_middleware(WriteFreezeMiddleware)
    # add_middleware prepends, so the last registration is outermost:
    # request-id runs first, logging records both normal and frozen requests,
    # and the freeze gate is the innermost application middleware.
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health.router)
    app.include_router(players.router)
    app.include_router(match_search.router)
    app.include_router(matches.router)
    app.include_router(teams.router)
    app.include_router(series.router)
    app.include_router(rankings.router)
    app.include_router(leaderboard.router)
    app.include_router(registration.router)
    app.include_router(auth.router)
    app.include_router(freeze_router)
    register_error_handlers(app)
    # Replaces the global RequestValidationError handler with the path-aware
    # variant above (non-players paths behave identically).
    app.exception_handler(RequestValidationError)(_request_validation_error_handler)
    _install_exception_barrier(app)
    return app


app = create_app()
