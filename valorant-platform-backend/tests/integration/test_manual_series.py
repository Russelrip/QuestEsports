"""Real-Postgres manual-result series integration tests (0016 migration).

Runs the full ``POST /api/v1/series/manual`` flow (``RatingService
.finalize_manual``) against the migrated schema through the app's real session:
rated manual series apply ELO under the current run with both team rows updated
atomically, unrated records the result only, a retry on
``external_quest_series_id`` converges without re-applying ELO, and the
validation gates reject bad winners/scores with the stable error codes.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.api.errors import AppError
from app.db.models import Series, Team
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.schemas.series import ManualSeriesRequest
from app.services.rating_service import RatingService

PLAYED_AT = datetime(2026, 1, 10, 12, 0, tzinfo=UTC)


def _manual_service(session) -> RatingService:
    return RatingService(
        session=session,
        series_repo=SeriesRepository(session),
        rating_repo=RatingRepository(session),
    )


async def _manual(session_factory, req: ManualSeriesRequest):
    async with session_factory() as session:
        return await _manual_service(session).finalize_manual(req)


async def _team_ids(session_factory) -> tuple[uuid.UUID, uuid.UUID]:
    async with session_factory() as session:
        a, b = Team(name="Alpha"), Team(name="Beta")
        session.add_all([a, b])
        await session.commit()
        return a.id, b.id


async def _team(session_factory, team_id: uuid.UUID) -> Team:
    async with session_factory() as session:
        row = await session.get(Team, team_id)
        assert row is not None
        return row


async def _series_row(session_factory, series_id: uuid.UUID) -> Series:
    async with session_factory() as session:
        row = await session.get(Series, series_id)
        assert row is not None
        return row


def _request(
    *,
    team_a_id: uuid.UUID,
    team_b_id: uuid.UUID,
    format_: str = "bo3",
    rating_mode: str = "normal",
    winner_team_id: uuid.UUID | None = None,
    team_a_maps_won: int = 2,
    team_b_maps_won: int = 1,
    external_quest_series_id: str | None = None,
) -> ManualSeriesRequest:
    return ManualSeriesRequest(
        team_a_id=team_a_id,
        team_b_id=team_b_id,
        format=format_,  # type: ignore[arg-type]
        played_at=PLAYED_AT,
        rating_mode=rating_mode,  # type: ignore[arg-type]
        winner_team_id=winner_team_id or team_a_id,
        team_a_maps_won=team_a_maps_won,
        team_b_maps_won=team_b_maps_won,
        external_quest_series_id=external_quest_series_id,
    )


async def test_manual_rated_applies_elo_and_finalizes_atomically(session_factory) -> None:
    team_a_id, team_b_id = await _team_ids(session_factory)

    result = await _manual(
        session_factory,
        _request(team_a_id=team_a_id, team_b_id=team_b_id, external_quest_series_id="quest-integration-rated"),
    )

    assert result.status == "finalized"
    assert result.rating_mode == "normal"
    assert result.manual_winner_team_id == team_a_id
    assert result.manual_team_a_maps == 2
    assert result.manual_team_b_maps == 1
    assert len(result.events) == 2
    # bo3 2-1 from equal 1000 ratings: winner +27, loser -22.
    assert result.team_a_current_elo == Decimal(1027)
    assert result.team_b_current_elo == Decimal(978)

    series = await _series_row(session_factory, result.series_id)
    assert series.status == "finalized"
    assert series.finalized_at is not None
    assert series.rating_mode == "normal"
    assert series.calculated_winner_id == team_a_id
    assert series.official_winner_id == team_a_id
    assert series.team_a_maps_won == 2
    assert series.team_b_maps_won == 1
    assert series.manual_winner_team_id == team_a_id
    assert series.manual_team_a_maps == 2
    assert series.manual_team_b_maps == 1

    team_a = await _team(session_factory, team_a_id)
    team_b = await _team(session_factory, team_b_id)
    assert team_a.current_elo == Decimal(1027)
    assert team_a.matches_played == 3
    assert team_a.series_wins == 1
    assert team_b.current_elo == Decimal(978)
    assert team_b.matches_played == 3
    assert team_b.series_losses == 1


async def test_manual_unrated_records_result_without_elo(session_factory) -> None:
    team_a_id, team_b_id = await _team_ids(session_factory)

    result = await _manual(
        session_factory,
        _request(team_a_id=team_a_id, team_b_id=team_b_id, rating_mode="unrated"),
    )

    assert result.rating_mode == "unrated"
    assert result.events == []
    assert result.team_a_current_elo == Decimal(1000)
    assert result.team_b_current_elo == Decimal(1000)
    series = await _series_row(session_factory, result.series_id)
    assert series.status == "finalized"
    assert series.rating_mode == "unrated"
    assert series.manual_winner_team_id == team_a_id
    team_a = await _team(session_factory, team_a_id)
    assert team_a.current_elo == Decimal(1000)
    assert team_a.matches_played == 0
    assert team_a.series_wins == 0


async def test_manual_idempotent_retry_does_not_double_apply(session_factory) -> None:
    team_a_id, team_b_id = await _team_ids(session_factory)
    req = _request(
        team_a_id=team_a_id, team_b_id=team_b_id, external_quest_series_id="quest-series-1"
    )

    first = await _manual(session_factory, req)
    second = await _manual(session_factory, req)

    assert first.series_id == second.series_id
    assert len(first.events) == 2
    assert len(second.events) == 2  # the retry echoes the persisted events only
    team_a = await _team(session_factory, team_a_id)
    assert team_a.current_elo == Decimal(1027)  # applied exactly once
    assert team_a.matches_played == 3


async def test_manual_validation_rejects_bad_winner_and_score(session_factory) -> None:
    team_a_id, team_b_id = await _team_ids(session_factory)

    with pytest.raises(AppError) as excinfo:
        await _manual(
            session_factory,
            _request(
                team_a_id=team_a_id,
                team_b_id=team_b_id,
                external_quest_series_id="quest-integration-validate-1",
                winner_team_id=uuid.uuid4(),
            ),
        )
    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 409

    with pytest.raises(AppError) as excinfo:
        await _manual(
            session_factory,
            _request(
                team_a_id=team_a_id,
                team_b_id=team_b_id,
                external_quest_series_id="quest-integration-validate-2",
                format_="bo1",
                team_a_maps_won=2,
                team_b_maps_won=0,
            ),
        )
    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422
