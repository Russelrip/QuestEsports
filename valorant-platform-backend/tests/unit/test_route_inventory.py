"""OpenAPI route inventory + service-token-coverage guard (Task 17 final validation).

The plan's API surface (App. A) is enforced here against the live OpenAPI
document and the app's route table, so the inventory can never silently drift:

- every documented route exists with its documented method and **no
  undocumented** ``/api/v1`` route exists;
- every documented route carries the expected **request model** (when it has a
  body) and the expected **response model** — including the import route, whose
  idempotent 200 and canonical 201 are both documented with
  ``MatchImportResponse`` (ADR-019);
- every ``$ref`` in the OpenAPI document resolves to a defined Pydantic schema;
- every domain route is service-token-gated in production
  (``Depends(require_service_token)`` per spec §6.3 / delta D1) except
  ``/api/v1/health`` (unauthenticated) and ``/api/v1/rankings/rebuild`` (the
  sole retained ``X-Admin-Key`` path, ``Depends(require_admin)``, for ops
  tooling).

Router-level ``dependencies=[Depends(require_service_token)]`` (the
match-search router) is propagated by FastAPI into each route's
``.dependencies``, so the check is uniform across per-route and router-level
gates.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import get_args

from fastapi.routing import APIRoute

from app.api.dependencies import require_admin, require_service_token
from app.main import create_app
from app.schemas.auth import (
    CheckDiscordRequest,
    CheckDiscordResponse,
    CheckPuuidRequest,
    CheckPuuidResponse,
    DiscordCallbackResponse,
    DiscordLoginResponse,
)
from app.schemas.leaderboard import LeaderboardEntry, LeaderboardPage, LeaderboardStats
from app.schemas.match_search import TwoPlayerSearchRequest, TwoPlayerSearchResult
from app.schemas.matches import (
    MatchDetailResponse,
    MatchImportRequest,
    MatchImportResponse,
    MatchListResponse,
)
from app.schemas.players import PlayerResolveRequest, PlayerResponse
from app.schemas.rankings import RankingEntry, RebuildResult
from app.schemas.registration import (
    PlayerPreview,
    PreviewRequest,
    RegistrationRequest,
    RegistrationSubmitResponse,
)
from app.schemas.series import (
    AttachGameRequest,
    FinalizeRequest,
    FinalizeResult,
    GameView,
    ManualSeriesRequest,
    RatingEventResponse,
    SeriesCreate,
    SeriesMatchesResponse,
    SeriesPreview,
    SeriesView,
    SetGameOrderRequest,
    UpdateGameRequest,
    UpdateSeriesRequest,
)
from app.schemas.teams import TeamCreate, TeamResponse, TeamUpdate

# The documented API surface: path -> {method: (request_model | None,
# response_model | None)}. ``None`` means the route has no request body / no
# response model (health, 204s).
DOCUMENTED_SURFACE: dict[str, dict[str, tuple[type | None, type | None]]] = {
    "/api/v1/health": {"get": (None, None)},
    "/api/v1/freeze": {"get": (None, None)},
    "/api/v1/leaderboard": {"get": (None, LeaderboardPage)},
    "/api/v1/leaderboard/top/{count}": {"get": (None, list[LeaderboardEntry])},
    "/api/v1/leaderboard/search/{discord_username}": {"get": (None, LeaderboardEntry)},
    "/api/v1/leaderboard/stats": {"get": (None, LeaderboardStats)},
    "/api/v1/players/resolve": {"post": (PlayerResolveRequest, PlayerResponse)},
    "/api/v1/players/{player_id}": {"get": (None, PlayerResponse)},
    "/api/v1/players/by-puuid/{puuid}": {"get": (None, PlayerResponse)},
    "/api/v1/match-search/two-player": {"post": (TwoPlayerSearchRequest, TwoPlayerSearchResult)},
    "/api/v1/matches/import": {"post": (MatchImportRequest, MatchImportResponse)},
    "/api/v1/matches": {"get": (None, MatchListResponse)},
    "/api/v1/matches/{match_id}": {"get": (None, MatchDetailResponse)},
    "/api/v1/matches/by-henrik-id/{henrik_match_id}": {"get": (None, MatchDetailResponse)},
    "/api/v1/teams": {"post": (TeamCreate, TeamResponse), "get": (None, list[TeamResponse])},
    "/api/v1/teams/{team_id}": {"get": (None, TeamResponse), "patch": (TeamUpdate, TeamResponse)},
    "/api/v1/teams/{team_id}/rating-history": {"get": (None, list[RatingEventResponse])},
    "/api/v1/teams/{team_id}/series": {"get": (None, list[SeriesView])},
    "/api/v1/series": {"post": (SeriesCreate, SeriesView), "get": (None, list[SeriesView])},
    "/api/v1/series/manual": {"post": (ManualSeriesRequest, FinalizeResult)},
    "/api/v1/series/{series_id}/games": {"post": (AttachGameRequest, GameView)},
    "/api/v1/series/{series_id}/games/{game_id}": {"delete": (None, None), "patch": (UpdateGameRequest, GameView)},
    "/api/v1/series/{series_id}/games/order": {"put": (SetGameOrderRequest, list[GameView])},
    "/api/v1/series/{series_id}/preview": {"get": (None, SeriesPreview)},
    "/api/v1/series/{series_id}/matches": {"get": (None, SeriesMatchesResponse)},
    "/api/v1/series/{series_id}/finalize": {"post": (FinalizeRequest, FinalizeResult)},
    "/api/v1/series/{series_id}": {
        "get": (None, SeriesView),
        "patch": (UpdateSeriesRequest, SeriesView),
        "delete": (None, None),
    },
    "/api/v1/rankings/teams": {"get": (None, list[RankingEntry])},
    "/api/v1/rankings/rebuild": {"post": (None, RebuildResult)},
    "/api/v1/register/preview": {"post": (PreviewRequest, PlayerPreview)},
    "/api/v1/register/submit": {"post": (RegistrationRequest, RegistrationSubmitResponse)},
    "/api/v1/register/preview/{puuid}": {"get": (None, PlayerPreview)},
    "/api/v1/register": {
        "post": (RegistrationRequest, RegistrationSubmitResponse),
        # An admin-reviewed move to a different PUUID. Quest decides whether the
        # move is legitimate; this endpoint only carries out the decision.
        "put": (RegistrationRequest, RegistrationSubmitResponse),
    },
    "/api/v1/auth/discord/login": {"get": (None, DiscordLoginResponse)},
    "/api/v1/auth/discord/callback": {"get": (None, DiscordCallbackResponse)},
    "/api/v1/auth/check-discord": {"post": (CheckDiscordRequest, CheckDiscordResponse)},
    "/api/v1/auth/check-puuid": {"post": (CheckPuuidRequest, CheckPuuidResponse)},
    "/api/v1/auth/login": {"get": (None, DiscordLoginResponse)},
    "/api/v1/auth/check-discord/{discord_id}": {"get": (None, CheckDiscordResponse)},
    "/api/v1/auth/check-puuid/{puuid}": {"get": (None, CheckPuuidResponse)},
}

# The production gate exceptions (spec §6.3): health stays unauthenticated;
# /rankings/rebuild is the sole retained X-Admin-Key path.
SERVICE_GATED_EXEMPT = {"/api/v1/health"}
ADMIN_ONLY_PATHS = {"/api/v1/rankings/rebuild"}
_REF_PREFIX = "#/components/schemas/"


def _api_routes() -> Iterator[APIRoute]:
    """Yield every APIRoute under the app, including included routers."""
    app = create_app()
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route
        original = getattr(route, "original_router", None)
        if original is not None:
            for sub in original.routes:
                if isinstance(sub, APIRoute):
                    yield sub


def test_documented_surface_is_exactly_the_openapi_inventory() -> None:
    """The /api/v1 OpenAPI inventory equals the documented surface (no drift)."""
    app = create_app()
    openapi_paths = app.openapi()["paths"]
    actual: set[tuple[str, str]] = set()
    for path, operations in openapi_paths.items():
        if not path.startswith("/api/v1"):
            continue
        for method in operations:
            actual.add((path, method))
    expected = {
        (path, method) for path, methods in DOCUMENTED_SURFACE.items() for method in methods
    }
    assert actual == expected, f"unexpected: {sorted(actual - expected)}, missing: {sorted(expected - actual)}"


def test_documented_request_models_resolve_in_openapi() -> None:
    """Every route with a documented body references the expected request
    model; routes documented without a body must have no requestBody."""
    app = create_app()
    openapi = app.openapi()
    schemas = openapi["components"]["schemas"]
    for path, methods in DOCUMENTED_SURFACE.items():
        for method, (request_model, _response_model) in methods.items():
            operation = openapi["paths"][path][method]
            request_body = operation.get("requestBody")
            if request_model is None:
                assert request_body is None, f"{path} {method}: unexpected requestBody"
                continue
            assert request_body is not None, f"{path} {method}: missing requestBody"
            schema = request_body["content"]["application/json"]["schema"]
            ref = _resolve_schema_ref(schema)
            assert ref == request_model.__name__, (
                f"{path} {method}: expected request model {request_model.__name__}, got {ref}"
            )
            assert ref in schemas, f"{path} {method}: request schema {ref} undefined"


def test_documented_response_models_resolve_in_openapi() -> None:
    """Every documented route's response model serializes into OpenAPI and the
    referenced schema exists. The import route must document BOTH its 200
    (created=false) and 201 (created=true) responses with MatchImportResponse."""
    app = create_app()
    openapi = app.openapi()
    schemas = openapi["components"]["schemas"]
    for path, methods in DOCUMENTED_SURFACE.items():
        for method, (_request_model, response_model) in methods.items():
            operation = openapi["paths"][path][method]
            responses = operation["responses"]
            success_statuses = sorted(
                int(status) for status in responses if int(status) in (200, 201, 204)
            )
            assert success_statuses, f"{path} {method}: no success response documented"
            for status in success_statuses:
                content = responses[str(status)].get("content") or {}
                schema = content.get("application/json", {}).get("schema")
                if response_model is None:
                    # health / 204 routes carry no response MODEL: the schema
                    # (if any) must not reference a defined component (health
                    # gets a generic inline object, 204s have no content).
                    assert _resolve_schema_ref(schema) is None, (
                        f"{path} {method} {status}: unexpected component response"
                    )
                    continue
                ref = _resolve_schema_ref(schema)
                expected = _expected_schema_name(response_model)
                assert ref == expected, (
                    f"{path} {method} {status}: expected response model {expected}, got {ref}"
                )
                assert ref in schemas, f"{path} {method} {status}: response schema {ref} undefined"

    # The import route's idempotent double is explicitly documented (ADR-019).
    import_responses = openapi["paths"]["/api/v1/matches/import"]["post"]["responses"]
    for status in ("200", "201"):
        ref = _resolve_schema_ref(import_responses[status]["content"]["application/json"]["schema"])
        assert ref == "MatchImportResponse", f"import {status} must be MatchImportResponse, got {ref}"


def test_all_openapi_refs_resolve_to_defined_schemas() -> None:
    """Every $ref in the whole OpenAPI document points at a defined schema."""
    app = create_app()
    openapi = app.openapi()
    schemas = openapi["components"]["schemas"]

    def walk(node) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if ref is not None:
                assert ref.startswith(_REF_PREFIX), f"unexpected ref target: {ref}"
                name = ref[len(_REF_PREFIX) :]
                assert name in schemas, f"undefined schema ref: {ref}"
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(openapi)


def test_every_domain_route_is_service_token_gated_except_health() -> None:
    """Production posture (spec §6.3): every /api/v1 route except ``/health``
    requires ``Depends(require_service_token)``; ``/rankings/rebuild`` keeps
    the ``X-Admin-Key`` gate for ops tooling; health stays unauthenticated."""
    routes = list(_api_routes())
    api_routes = [r for r in routes if r.path.startswith("/api/v1")]
    assert api_routes, "no /api/v1 routes found"
    for route in api_routes:
        deps = [getattr(dep, "dependency", None) for dep in (getattr(route, "dependencies", None) or [])]
        if route.path in SERVICE_GATED_EXEMPT:
            assert require_service_token not in deps, f"{route.path}: health must stay unauthenticated"
            assert require_admin not in deps
        elif route.path in ADMIN_ONLY_PATHS:
            assert require_admin in deps, f"{route.path}: rebuild must keep the admin-key gate"
            assert require_service_token not in deps
        else:
            assert require_service_token in deps, f"{route.path}: missing service-token gate"
            assert require_admin not in deps, f"{route.path}: must not carry the admin-key gate"


def _expected_schema_name(model: type) -> str:
    """OpenAPI component name for a response model class (list[X] -> X)."""
    args = get_args(model)
    if args:
        return args[0].__name__
    return model.__name__


def _resolve_schema_ref(schema: dict | None) -> str | None:
    """Return the component name for a schema ($ref, inline array, or anyOf).

    ``anyOf`` (e.g. FastAPI's ``LeaderboardEntry | None`` serialization) picks
    the component name of the first member that carries a ``$ref``, skipping
    null/primitive members like ``{"type": "null"}``.
    """
    if schema is None:
        return None
    ref = schema.get("$ref")
    if ref is not None:
        return ref.removeprefix(_REF_PREFIX)
    items = schema.get("items")
    if isinstance(items, dict):
        ref = items.get("$ref")
        if ref is not None:
            return ref.removeprefix(_REF_PREFIX)
    any_of = schema.get("anyOf")
    if isinstance(any_of, list):
        for candidate in any_of:
            ref = (candidate or {}).get("$ref")
            if ref is not None:
                return ref.removeprefix(_REF_PREFIX)
    return None


def _auth_dependency_names(route: APIRoute) -> set[str]:
    return {
        dep.call.__name__
        for dep in getattr(route.dependant, "dependencies", [])
        if getattr(dep.call, "__name__", None)
    }


def test_health_is_the_only_unauthenticated_api_route():
    from app.main import create_app

    app = create_app()
    health_paths = {"/api/v1/health"}
    auth_names = {"require_admin", "require_service_token"}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        path = route.path
        if not path.startswith("/api/v1"):
            continue
        present = _auth_dependency_names(route) & auth_names
        if path in health_paths:
            assert not present, f"health must stay unauthenticated: {path}"
        else:
            assert present, f"route missing auth dependency: {path}"
