"""Team routes (plan Task 11; API surface §11.4, error table App. B).

Every domain route requires a Quest service token in production (delta D1;
spec §6.3); there is no public read surface. There is no DELETE route:
retirement is ``PATCH is_active=false``. A duplicate ``slug`` surfaces as 409
``TEAM_SLUG_TAKEN``.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.api.dependencies import get_ranking_service, get_team_service, require_service_token
from app.db.models import Team
from app.schemas.series import RatingEventResponse, SeriesView
from app.schemas.teams import TeamCreate, TeamResponse, TeamUpdate
from app.services.ranking_service import RankingService
from app.services.team_service import TeamService

router = APIRouter(prefix="/api/v1/teams", tags=["teams"])

_TeamServiceDep = Annotated[TeamService, Depends(get_team_service)]
_RankingServiceDep = Annotated[RankingService, Depends(get_ranking_service)]


@router.post(
    "",
    response_model=TeamResponse,
    status_code=201,
    dependencies=[Depends(require_service_token)],
    responses={200: {"model": TeamResponse, "description": "existing team keyed on quest_saved_team_id (created=false)"}},
)
async def create_team(
    req: TeamCreate,
    response: Response,
    svc: _TeamServiceDep,
) -> TeamResponse:
    team, created = await svc.create_or_get(req)
    if not created:
        response.status_code = 200
    return _to_response(team)


@router.get("", response_model=list[TeamResponse], dependencies=[Depends(require_service_token)])
async def list_teams(
    svc: _TeamServiceDep,
    active_only: bool = True,
) -> list[TeamResponse]:
    return [_to_response(team) for team in await svc.list(active_only=active_only)]


@router.get("/{team_id}", response_model=TeamResponse, dependencies=[Depends(require_service_token)])
async def get_team(
    team_id: uuid.UUID,
    svc: _TeamServiceDep,
) -> TeamResponse:
    return _to_response(await svc.get(team_id))


@router.patch("/{team_id}", response_model=TeamResponse, dependencies=[Depends(require_service_token)])
async def update_team(
    team_id: uuid.UUID,
    req: TeamUpdate,
    svc: _TeamServiceDep,
) -> TeamResponse:
    return _to_response(await svc.update(team_id, req))


@router.get(
    "/{team_id}/rating-history",
    response_model=list[RatingEventResponse],
    dependencies=[Depends(require_service_token)],
)
async def team_rating_history(
    team_id: uuid.UUID,
    svc: _RankingServiceDep,
) -> list[RatingEventResponse]:
    """A team's immutable rating events under the CURRENT run, in event order
    (plan Task 16) — the events that explain its current rating."""
    return await svc.team_rating_history(team_id)


@router.get("/{team_id}/series", response_model=list[SeriesView], dependencies=[Depends(require_service_token)])
async def team_series(
    team_id: uuid.UUID,
    svc: _RankingServiceDep,
) -> list[SeriesView]:
    """The series a team played in (either side), newest first (plan Task 16)."""
    return await svc.team_series(team_id)


def _to_response(team: Team) -> TeamResponse:
    return TeamResponse(
        id=team.id,
        name=team.name,
        short_name=team.short_name,
        slug=team.slug,
        quest_saved_team_id=team.quest_saved_team_id,
        logo_url=team.logo_url,
        current_elo=team.current_elo,
        peak_elo=team.peak_elo,
        seeding_elo=team.seeding_elo,
        matches_played=team.matches_played,
        series_wins=team.series_wins,
        series_losses=team.series_losses,
        is_active=team.is_active,
    )
