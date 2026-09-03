"""Series routes (plan Task 12; API surface §11.2, error table App. B).

Every domain route requires a Quest service token in production (delta D1;
spec §6.3); there is no public read surface. A draft series supports
attach/remove/reorder/update played_at/delete; a finalized series rejects
every mutation with 409 ``SERIES_ALREADY_FINALIZED``.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.api.dependencies import get_rating_service, get_series_service, require_service_token
from app.api.service_token import ServicePrincipal
from app.db.models import Match, Series, SeriesGame
from app.schemas.series import (
    AttachGameRequest,
    FinalizeRequest,
    FinalizeResult,
    GameView,
    ManualSeriesRequest,
    SeriesCreate,
    SeriesMatchesResponse,
    SeriesMatchSummary,
    SeriesPreview,
    SeriesView,
    SetGameOrderRequest,
    UpdateGameRequest,
    UpdateSeriesRequest,
)
from app.services.rating_service import RatingService
from app.services.series_service import SeriesService, to_game_view

router = APIRouter(prefix="/api/v1/series", tags=["series"])

_SeriesServiceDep = Annotated[SeriesService, Depends(get_series_service)]
_RatingServiceDep = Annotated[RatingService, Depends(get_rating_service)]


@router.post(
    "",
    response_model=SeriesView,
    status_code=201,
    dependencies=[Depends(require_service_token)],
    responses={200: {"model": SeriesView, "description": "existing series keyed on external_quest_series_id (created=false)"}},
)
async def create_series(
    req: SeriesCreate,
    response: Response,
    svc: _SeriesServiceDep,
) -> SeriesView:
    series, created = await svc.create_or_get(req)
    if not created:
        response.status_code = 200
    return await _view_for(svc, series)


@router.post(
    "/manual",
    response_model=FinalizeResult,
    dependencies=[Depends(require_service_token)],
)
async def create_manual_series(
    req: ManualSeriesRequest,
    principal: Annotated[ServicePrincipal, Depends(require_service_token)],
    svc: _RatingServiceDep,
) -> FinalizeResult:
    """Record an offline/historical series result (no API/discovery flow): an
    atomic create-or-get that finalizes immediately, applies ELO under the
    current run for ``rating_mode="normal"`` (or records the result only for
    ``"unrated"``), and converges idempotently on ``external_quest_series_id``
    without ever re-applying ELO."""
    return await svc.finalize_manual(req, principal)


@router.post(
    "/{series_id}/games",
    response_model=GameView,
    status_code=201,
    dependencies=[Depends(require_service_token)],
)
async def attach_game(
    series_id: uuid.UUID,
    req: AttachGameRequest,
    svc: _SeriesServiceDep,
) -> GameView:
    game = await svc.attach_game(series_id, req)
    return to_game_view(game, await svc.get_match_map_names({game.match_id}))


@router.delete(
    "/{series_id}/games/{game_id}",
    status_code=204,
    dependencies=[Depends(require_service_token)],
)
async def remove_game(
    series_id: uuid.UUID,
    game_id: uuid.UUID,
    svc: _SeriesServiceDep,
) -> None:
    await svc.remove_game(series_id, game_id)


@router.patch(
    "/{series_id}/games/{game_id}",
    response_model=GameView,
    dependencies=[Depends(require_service_token)],
)
async def update_game(
    series_id: uuid.UUID,
    game_id: uuid.UUID,
    req: UpdateGameRequest,
    svc: _SeriesServiceDep,
) -> GameView:
    game = await svc.update_game(series_id, game_id, req)
    return to_game_view(game, await svc.get_match_map_names({game.match_id}))


@router.put(
    "/{series_id}/games/order",
    response_model=list[GameView],
    dependencies=[Depends(require_service_token)],
)
async def set_game_order(
    series_id: uuid.UUID,
    req: SetGameOrderRequest,
    svc: _SeriesServiceDep,
) -> list[GameView]:
    """Apply the full ABSOLUTE desired game order (delta D9): draft-only,
    atomic, idempotent by absolute values. ``PATCH`` per-game reorder remains
    for re-siding; Quest drives ordering through this endpoint."""
    games = await svc.set_game_order(series_id, req)
    map_names = await svc.get_match_map_names(game.match_id for game in games)
    return [to_game_view(game, map_names) for game in games]


@router.get("", response_model=list[SeriesView], dependencies=[Depends(require_service_token)])
async def list_series(
    svc: _SeriesServiceDep,
) -> list[SeriesView]:
    # Constant query count (3 for any N): series, all games, all maps — never
    # the 2N+1 per-series lookups a naive loop would issue (fix round 1).
    series_list = await svc.list()
    if not series_list:
        return []
    games_by_series = await svc.get_games_by_series(series.id for series in series_list)
    match_ids = {game.match_id for games in games_by_series.values() for game in games}
    map_names = await svc.get_match_map_names(match_ids)
    return [_to_series_view(series, games_by_series.get(series.id, []), map_names) for series in series_list]


@router.get("/{series_id}", response_model=SeriesView, dependencies=[Depends(require_service_token)])
async def get_series(
    series_id: uuid.UUID,
    svc: _SeriesServiceDep,
) -> SeriesView:
    return await _view_for(svc, await svc.get(series_id))


@router.get(
    "/{series_id}/matches",
    response_model=SeriesMatchesResponse,
    dependencies=[Depends(require_service_token)],
)
async def series_matches(
    series_id: uuid.UUID,
    svc: _SeriesServiceDep,
) -> SeriesMatchesResponse:
    """Anchor-relevant matches for the series (pinned contract).

    Every imported match where BOTH anchor players appear in ``match_players``
    (by ``puuid_snapshot``) on opposing sides, each item mirroring the ``GET
    /api/v1/matches`` list shape (id, henrik_match_id, affinity, platform,
    map_name, mode, queue, started_at, is_completed, red_score, blue_score,
    winning_side) PLUS ``anchor_a_side`` — the side the series'
    ``anchor_a_puuid`` played on that match. A series without anchors returns
    an empty list.
    """
    rows = await svc.get_relevant_matches(series_id)
    return SeriesMatchesResponse(
        matches=[_to_series_match(match, anchor_a_side) for match, anchor_a_side in rows]
    )


@router.get(
    "/{series_id}/preview",
    response_model=SeriesPreview,
    dependencies=[Depends(require_service_token)],
)
async def preview_series(
    series_id: uuid.UUID,
    svc: _SeriesServiceDep,
) -> SeriesPreview:
    """Recompute BO validity, map counts, and the calculated winner with no
    writes — the derived 'ready' signal. Works for draft and finalized series
    alike."""
    return await svc.preview(series_id)


@router.post(
    "/{series_id}/finalize",
    response_model=FinalizeResult,
    dependencies=[Depends(require_service_token)],
)
async def finalize_series(
    series_id: uuid.UUID,
    req: FinalizeRequest,
    principal: Annotated[ServicePrincipal, Depends(require_service_token)],
    svc: _RatingServiceDep,
) -> FinalizeResult:
    """Finalize a series exactly once: atomic locked transaction, strict BO
    revalidation against CURRENT canonical games, legacy ELO, immutable events,
    and idempotent double-finalize protection. Service-token-gated; the signed
    actor/operation claims are persisted as audit fields (delta D7)."""
    return await svc.finalize(series_id, req, principal)


@router.patch(
    "/{series_id}",
    response_model=SeriesView,
    dependencies=[Depends(require_service_token)],
)
async def update_series(
    series_id: uuid.UUID,
    req: UpdateSeriesRequest,
    svc: _SeriesServiceDep,
) -> SeriesView:
    """Draft-only mutation: update the series' ``played_at``. A finalized
    series rejects the update with 409 ``SERIES_ALREADY_FINALIZED``; no other
    field changes."""
    series = await svc.update_played_at(series_id, req)
    return await _view_for(svc, series)


@router.delete("/{series_id}", status_code=204, dependencies=[Depends(require_service_token)])
async def delete_series(
    series_id: uuid.UUID,
    svc: _SeriesServiceDep,
) -> None:
    await svc.delete(series_id)


# -------------------------------------------------------------- view helpers


async def _view_for(svc: SeriesService, series: Series) -> SeriesView:
    games = await svc.get_games(series.id)
    map_names = await svc.get_match_map_names(game.match_id for game in games)
    return _to_series_view(series, games, map_names)


def _to_series_view(series: Series, games: list[SeriesGame], map_names: dict) -> SeriesView:
    return SeriesView(
        id=series.id,
        team_a_id=series.team_a_id,
        team_b_id=series.team_b_id,
        format=series.format,
        importance=series.importance,
        status=series.status,
        calculated_winner_id=series.calculated_winner_id,
        official_winner_id=series.official_winner_id,
        winner_override_reason=series.winner_override_reason,
        team_a_maps_won=series.team_a_maps_won,
        team_b_maps_won=series.team_b_maps_won,
        played_at=series.played_at,
        finalized_at=series.finalized_at,
        rating_mode=series.rating_mode,
        manual_winner_team_id=series.manual_winner_team_id,
        manual_team_a_maps=series.manual_team_a_maps,
        manual_team_b_maps=series.manual_team_b_maps,
        notes=series.notes,
        games=[to_game_view(game, map_names) for game in games],
        external_quest_series_id=series.external_quest_series_id,
    )


def _to_series_match(match: Match, anchor_a_side: str) -> SeriesMatchSummary:
    """Map a relevant ``Match`` onto the ``GET /matches`` list-item shape plus
    ``anchor_a_side`` (the side the series' ``anchor_a_puuid`` played)."""
    return SeriesMatchSummary(
        id=match.id,
        henrik_match_id=match.henrik_match_id,
        affinity=match.affinity,
        platform=match.platform,
        map_name=match.map_name,
        mode=match.mode,
        queue=match.queue,
        started_at=match.started_at,
        is_completed=match.is_completed,
        red_score=match.red_score,
        blue_score=match.blue_score,
        winning_side=match.winning_side,
        anchor_a_side=anchor_a_side,
    )
