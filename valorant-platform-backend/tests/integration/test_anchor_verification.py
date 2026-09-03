"""Real-Postgres anchor verification integration tests (spec §4.4 D6, §5.5).

Rated finalization requires both anchor PUUIDs on opposing sides of every
attached game (read from ``match_players``); failure is 409 ``ANCHOR_MISMATCH``
unless the admin supplies an explicit rated mode + non-empty override_reason
(the audited override path). Unrated/forfeit modes skip verification. Skipped
when ``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import text

from app.api.errors import AppError
from app.db.models import Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.integrations.henrik.mapper import HenrikMapper
from app.schemas.matches import MatchDetailResponse
from app.schemas.series import AttachGameRequest, FinalizeRequest, SeriesCreate
from app.services.match_import_service import MatchImportService
from app.services.player_service import PlayerService
from app.services.rating_service import RatingService
from app.services.series_service import SeriesService

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"

_ID = "00000000-0000-0000-0000-0000000000%s"


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _completed_variant(henrik_match_id: str, *, red_wins: bool, map_name: str) -> dict:
    fixture = deepcopy(_load("completed_custom.json"))
    data = fixture["data"]
    data["metadata"]["match_id"] = henrik_match_id
    data["metadata"]["map"]["name"] = map_name
    red, blue = data["teams"]
    red["rounds"]["won"], red["rounds"]["lost"] = (13, 9) if red_wins else (9, 13)
    blue["rounds"]["won"], blue["rounds"]["lost"] = (9, 13) if red_wins else (13, 9)
    red["won"], blue["won"] = red_wins, not red_wins
    return fixture


class FakeHenrik:
    """Serves pinned match-detail fixtures through the real mapper."""

    def __init__(self, fixtures: dict[str, dict]) -> None:
        self.fixtures = fixtures
        self._mapper = HenrikMapper()

    async def get_match_detail(self, match_id: str, *, affinity: str):
        envelope = self.fixtures[match_id]
        from app.integrations.henrik.models import HenrikMatchDetailEnvelope

        return HenrikMatchDetailEnvelope(
            status=envelope["status"],
            data=self._mapper.to_match_detail(envelope["data"]),
            raw=envelope,
        )


class _NoNetworkHenrik:
    async def get_account(self, *args, **kwargs):
        raise AssertionError("anchor resolution must hit the player cache")


async def _seed_match(session, henrik_match_id: str, fixture: dict) -> MatchDetailResponse:
    service = MatchImportService(
        session=session,
        henrik=FakeHenrik({henrik_match_id: fixture}),  # type: ignore[arg-type]
        player_repo=PlayerRepository(session),
        match_repo=MatchRepository(session),
        mapper=HenrikMapper(),
    )
    result = await service.import_match(henrik_match_id, "eu")
    return result.match


def _series_service(session) -> SeriesService:
    return SeriesService(
        session=session,
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
        player_svc=PlayerService(session=session, henrik=_NoNetworkHenrik(), repo=PlayerRepository(session)),  # type: ignore[arg-type]
    )


def _rating_service(session) -> RatingService:
    return RatingService(
        session=session,
        series_repo=SeriesRepository(session),
        rating_repo=RatingRepository(session),
        match_repo=MatchRepository(session),
    )


async def _seed_scenario(session_factory, *, offset: int = 0) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    async with session_factory() as session:
        alpha = Team(name="Alpha")
        beta = Team(name="Beta")
        session.add_all([alpha, beta])
        await session.commit()
        team_a_id, team_b_id = alpha.id, beta.id
    henrik_id = _ID % f"{1 + offset:02x}"
    async with session_factory() as session:
        match = await _seed_match(session, henrik_id, _completed_variant(henrik_id, red_wins=True, map_name="Ascent"))
    async with session_factory() as session:
        svc = _series_service(session)
        series = await svc.create(
            SeriesCreate(
                team_a_id=team_a_id,
                team_b_id=team_b_id,
                format="bo1",
                importance="regular",
                played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC),  # finalize requires played_at (ADR-016)
                anchor_player_a={"name": "PlayerA", "tag": "A"},
                anchor_player_b={"name": "PlayerB", "tag": "B"},
            )
        )
        series_id = series.id
    async with session_factory() as session:
        svc = _series_service(session)
        await svc.attach_game(
            series_id, AttachGameRequest(match_id=match.id, game_number=1, team_a_side="red")
        )
    return team_a_id, team_b_id, series_id, match.id


async def _finalize(session_factory, series_id: uuid.UUID, req: FinalizeRequest):
    async with session_factory() as session:
        svc = _rating_service(session)
        return await svc.finalize(series_id, req)


async def _delete_anchor_b_participant(session_factory, match_id: uuid.UUID) -> None:
    """Remove PlayerB's match_players row so verification finds anchor B missing."""
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM match_players WHERE match_id = :m AND puuid_snapshot = 'puuid_p_b'"),
            {"m": match_id},
        )
        await session.commit()


async def test_rated_finalize_verifies_opposing_anchors(session_factory) -> None:
    team_a_id, _team_b_id, series_id, _match_id = await _seed_scenario(session_factory)
    result = await _finalize(session_factory, series_id, FinalizeRequest())
    assert result.status == "finalized"
    assert result.calculated_winner_id == team_a_id
    assert len(result.events) == 2


async def test_rated_finalize_with_missing_anchor_returns_anchor_mismatch(session_factory) -> None:
    _team_a_id, _team_b_id, series_id, match_id = await _seed_scenario(session_factory, offset=1)
    await _delete_anchor_b_participant(session_factory, match_id)

    with pytest.raises(AppError) as excinfo:
        await _finalize(session_factory, series_id, FinalizeRequest())
    assert excinfo.value.code == "ANCHOR_MISMATCH"
    assert excinfo.value.status == 409


async def test_anchor_mismatch_waived_by_explicit_reason_and_rated_mode(session_factory) -> None:
    team_a_id, _team_b_id, series_id, match_id = await _seed_scenario(session_factory, offset=2)
    await _delete_anchor_b_participant(session_factory, match_id)

    result = await _finalize(
        session_factory,
        series_id,
        FinalizeRequest(
            official_winner_id=team_a_id,
            override_reason="manual roster audit approved the series",
            rating_mode="manual_override",
        ),
    )
    assert result.status == "finalized"
    assert result.rating_mode == "manual_override"
    assert len(result.events) == 2


async def test_unrated_finalize_skips_anchor_verification(session_factory) -> None:
    _team_a_id, _team_b_id, series_id, match_id = await _seed_scenario(session_factory, offset=3)
    await _delete_anchor_b_participant(session_factory, match_id)

    result = await _finalize(
        session_factory,
        series_id,
        FinalizeRequest(rating_mode="unrated"),  # type: ignore[arg-type]
    )
    assert result.status == "finalized"
    assert result.events == []
