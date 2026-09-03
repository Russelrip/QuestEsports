"""Regression test: the leaderboard ``upsert`` must always produce a valid
INSERT tuple.

``discord_username`` is NOT NULL with no default. PostgreSQL rejects a proposed
INSERT that omits it *before* the ``ON CONFLICT (puuid)`` arbiter fires, so the
updater (which carries no Discord identity) crashed with ``NotNullViolationError``
on its first live pass. The fix defaults ``discord_id``/``discord_username`` to
``''`` in the INSERT values while keeping them OUT of the conflict-update
``set_``, so the arbiter fires and the existing Discord identity is preserved.
"""

from __future__ import annotations

import pytest

from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository


class _FakeResult:
    def scalar_one(self) -> None:
        return None


class _FakeSession:
    def __init__(self) -> None:
        self.stmt = None

    async def execute(self, stmt):
        self.stmt = stmt
        return _FakeResult()


@pytest.mark.asyncio
async def test_upsert_without_discord_identity_includes_defaults_in_insert_only() -> None:
    session = _FakeSession()
    repo = LeaderboardPlayerRepository(session)  # type: ignore[arg-type]

    await repo.upsert(
        puuid="0080e2b2-fcff-53a2-b473-23575863772d",
        name="AlviN",
        tag="PiK4",
        region="ap",
        elo=1720,
        currenttierpatched="Diamond 3",
        rank_details={"elo": 1720},
        update_source="updater_service",
    )

    assert session.stmt is not None
    sql = str(session.stmt)
    insert_columns = sql.split("VALUES", 1)[0]
    update_set = sql.split("DO UPDATE SET", 1)[1].split("RETURNING", 1)[0]

    # Discord columns are present in the INSERT tuple (valid NOT NULL) ...
    assert "discord_username" in insert_columns
    assert "discord_id" in insert_columns
    # ... but are NOT in the conflict-update SET (updater must not overwrite them)
    assert "discord_username" not in update_set
    assert "discord_id" not in update_set
    assert "ON CONFLICT (puuid)" in sql
