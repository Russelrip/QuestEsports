"""Real-Postgres chronological-guard integration tests (spec §4.4 D8, §8.5).

Rated finalization is rejected with 409 ``BACKDATED_SERIES_REJECTED`` when the
series' ``played_at`` predates the latest finalized RATED series; equal
``played_at`` is allowed (strict ``<``); unrated finalization is exempt and
records no events/counters. Skipped when ``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.api.errors import AppError
from app.db.models import Series, Team
from app.schemas.series import FinalizeRequest
from tests.integration.test_finalization import _finalize, _seed_finalize_scenario


async def test_rated_series_must_be_chronological(session_factory) -> None:
    # Latest finalized rated series is 2026-02-01.
    await _finalize(
        session_factory,
        (await _seed_finalize_scenario(
            session_factory, winners=["A", "A"], offset=0,
            played_at=datetime(2026, 2, 1, 12, 0, tzinfo=UTC),
        ))[2],
    )

    # Backdated rated finalize -> 409 BACKDATED_SERIES_REJECTED, still a draft.
    _team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, winners=["A", "A"], offset=10,
        played_at=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    with pytest.raises(AppError) as excinfo:
        await _finalize(session_factory, series_id, FinalizeRequest())
    assert excinfo.value.code == "BACKDATED_SERIES_REJECTED"
    assert excinfo.value.status == 409

    async with session_factory() as session:
        row = await session.get(Series, series_id)
        assert row is not None
        assert row.status == "draft"
        assert len((await session.execute(select(Series))).scalars().all()) == 2  # no partial commit


async def test_equal_played_at_rated_finalize_is_allowed(session_factory) -> None:
    # Latest finalized rated series is 2026-03-01.
    await _finalize(
        session_factory,
        (await _seed_finalize_scenario(
            session_factory, format_="bo1", winners=["A"], offset=0,
            played_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
        ))[2],
    )
    # A later series at the SAME played_at (strict <) is allowed.
    _team_a_id, _team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, format_="bo1", winners=["A"], offset=1,
        played_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )
    result = await _finalize(session_factory, series_id, FinalizeRequest())
    assert result.status == "finalized"
    assert len(result.events) == 2


async def test_unrated_finalize_is_exempt_from_chronological_guard(session_factory) -> None:
    # Latest finalized rated series is 2026-04-01.
    await _finalize(
        session_factory,
        (await _seed_finalize_scenario(
            session_factory, format_="bo1", winners=["A"], offset=0,
            played_at=datetime(2026, 4, 1, 12, 0, tzinfo=UTC),
        ))[2],
    )
    # A backdated UNRATED series finalizes fine with no events and no counters.
    team_a_id, team_b_id, series_id = await _seed_finalize_scenario(
        session_factory, format_="bo1", winners=["A"], offset=1,
        played_at=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
    )
    result = await _finalize(
        session_factory,
        series_id,
        FinalizeRequest(rating_mode="unrated"),  # type: ignore[arg-type]
    )
    assert result.status == "finalized"
    assert result.events == []

    async with session_factory() as session:
        team_a = await session.get(Team, team_a_id)
        team_b = await session.get(Team, team_b_id)
        assert team_a is not None and team_b is not None
        assert team_a.series_wins == 0 and team_b.series_wins == 0
        assert team_a.matches_played == 0 and team_b.matches_played == 0
        assert team_a.current_elo == Decimal(1000) and team_b.current_elo == Decimal(1000)
