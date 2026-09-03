"""Migration 0014 contract tests (spec §4.4 D2/D3/D4/D6/D7).

Proves the Quest-integration columns/constraints on the migrated schema:
the partial-unique ``quest_saved_team_id`` on ``teams``; the nullable-unique
``external_quest_series_id`` on ``series``; the two anchor PUUID columns and
the two finalize-audit columns; and the widened ``series_rating_mode_check``
that now accepts ``unrated``. Skipped when ``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import Series, Team


async def _insert_team(session_factory, *, name: str, quest_saved_team_id: str | None) -> None:
    async with session_factory() as session:
        session.add(Team(name=name, quest_saved_team_id=quest_saved_team_id))
        await session.commit()


async def test_teams_quest_saved_team_id_partial_unique(session_factory) -> None:
    await _insert_team(session_factory, name="Alpha", quest_saved_team_id="quest-team-1")
    async with session_factory() as session:
        session.add(Team(name="Beta", quest_saved_team_id="quest-team-1"))
        with pytest.raises(IntegrityError, match="teams_quest_saved_team_id_key"):
            await session.commit()
        await session.rollback()
    await _insert_team(session_factory, name="Gamma", quest_saved_team_id=None)
    await _insert_team(session_factory, name="Delta", quest_saved_team_id=None)


async def test_series_external_quest_series_id_unique_nullable(session_factory) -> None:
    async with session_factory() as session:
        a, b, c, d = Team(name="A"), Team(name="B"), Team(name="C"), Team(name="D")
        session.add_all([a, b, c, d])
        await session.commit()
        team_a, team_b, team_c, team_d = a.id, b.id, c.id, d.id
    async with session_factory() as session:
        session.add(
            Series(team_a_id=team_a, team_b_id=team_b, format="bo1", importance="regular",
                   external_quest_series_id="quest-series-1")
        )
        session.add(
            Series(team_a_id=team_c, team_b_id=team_d, format="bo1", importance="regular",
                   external_quest_series_id=None)
        )
        await session.commit()
    async with session_factory() as session:
        session.add(
            Series(team_a_id=team_a, team_b_id=team_b, format="bo1", importance="regular",
                   external_quest_series_id="quest-series-1")
        )
        with pytest.raises(IntegrityError, match="series_external_quest_series_id_key"):
            await session.commit()
        await session.rollback()


async def test_series_anchor_and_audit_columns_round_trip(session_factory) -> None:
    async with session_factory() as session:
        a, b = Team(name="A"), Team(name="B")
        session.add_all([a, b])
        await session.commit()
        row = Series(team_a_id=a.id, team_b_id=b.id, format="bo1", importance="regular",
                     anchor_a_puuid="puuid_a", anchor_b_puuid="puuid_b",
                     finalized_by_actor_id="actor-1", finalized_by_operation_id="op-1")
        session.add(row)
        await session.commit()
        loaded = await session.get(Series, row.id)
        assert loaded.anchor_a_puuid == "puuid_a"
        assert loaded.anchor_b_puuid == "puuid_b"
        assert loaded.finalized_by_actor_id == "actor-1"
        assert loaded.finalized_by_operation_id == "op-1"


async def test_series_rating_mode_check_accepts_unrated(session_factory) -> None:
    async with session_factory() as session:
        a, b = Team(name="A"), Team(name="B")
        session.add_all([a, b])
        await session.commit()
        session.add(Series(team_a_id=a.id, team_b_id=b.id, format="bo1", importance="regular",
                           rating_mode="unrated"))
        await session.commit()
    async with session_factory() as session:
        c, d = Team(name="C"), Team(name="D")
        session.add_all([c, d])
        await session.commit()
        session.add(Series(team_a_id=c.id, team_b_id=d.id, format="bo1", importance="regular",
                           rating_mode="void"))
        with pytest.raises(IntegrityError, match="series_rating_mode_check"):
            await session.commit()
        await session.rollback()
