"""Real-Postgres finalize-input policy integration tests (plan Task 14, App. D).

End-to-end ``SeriesService.resolve_finalization_policy`` on a real Postgres-
backed series: canonical matches imported through the real mapper (FakeHenrik
fixtures, no network), draft series built through the real mutation flow. The
calculated winner the policy resolves against derives from CURRENT canonical
match data (single joined read, the preview contract):

- no override → official defaults to the current canonical calculated winner;
- refreshing a canonical match (flips a map winner) flips the policy's
  calculated winner, and an override that previously differed from it becomes
  a no-op — the stale stored winner/rounds are never trusted;
- the parse never writes: the series row is untouched and the session is never
  committed/rolled back;
- the official winner must be a team of the series (``SERIES_INVALID``);
- under a concurrent attach, every parse observes exactly one consistent state
  (pre- or post-commit), never a mixture.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from typing import Literal

import pytest
from sqlalchemy import select

from app.db.models import Series, SeriesGame, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.series_repository import SeriesRepository
from app.domain.ratings.policy import RatingPolicyDecision
from app.integrations.henrik.mapper import HenrikMapper
from app.schemas.matches import MatchDetailResponse
from app.schemas.series import AttachGameRequest, FinalizeRequest, SeriesCreate
from app.services.match_import_service import MatchImportService
from app.services.series_service import SeriesService

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"

_ID = "00000000-0000-0000-0000-0000000000%s"


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _completed_variant(henrik_match_id: str, *, red_wins: bool, map_name: str) -> dict:
    """A completed fixture with the winner flipped to blue when ``red_wins`` is false."""
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


async def _seed_match(
    session, henrik_match_id: str, fixture: dict, *, refresh: bool = False
) -> MatchDetailResponse:
    service = MatchImportService(
        session=session,
        henrik=FakeHenrik({henrik_match_id: fixture}),  # type: ignore[arg-type]
        player_repo=PlayerRepository(session),
        match_repo=MatchRepository(session),
        mapper=HenrikMapper(),
    )
    result = await service.import_match(henrik_match_id, "eu", refresh=refresh)
    return result.match


async def _seed_teams(session_factory) -> tuple[uuid.UUID, uuid.UUID]:
    async with session_factory() as session:
        alpha = Team(
            name="Alpha",
            current_elo=Decimal(1000),
            peak_elo=Decimal(1000),
            matches_played=0,
            series_wins=0,
            series_losses=0,
            is_active=True,
        )
        beta = Team(
            name="Beta",
            current_elo=Decimal(1000),
            peak_elo=Decimal(1000),
            matches_played=0,
            series_wins=0,
            series_losses=0,
            is_active=True,
        )
        session.add_all([alpha, beta])
        await session.commit()
        return alpha.id, beta.id


async def _seed_matches(
    session_factory, specs: list[tuple[str, bool, str]]
) -> dict[str, MatchDetailResponse]:
    """Import matches; ``specs`` = (key, red_wins, map_name) -> ``{key: match}``."""
    imported: dict[str, MatchDetailResponse] = {}
    async with session_factory() as session:
        for index, (key, red_wins, map_name) in enumerate(specs, start=1):
            henrik_id = _ID % f"{index:02x}"
            match = await _seed_match(
                session, henrik_id, _completed_variant(henrik_id, red_wins=red_wins, map_name=map_name)
            )
            imported[key] = match
    return imported


def _series_service(session) -> SeriesService:
    return SeriesService(
        session=session,
        series_repo=SeriesRepository(session),
        match_repo=MatchRepository(session),
    )


async def _create_series(
    session_factory,
    team_a_id: uuid.UUID,
    team_b_id: uuid.UUID,
    *,
    format_: Literal["bo1", "bo3", "bo5"],
) -> uuid.UUID:
    async with session_factory() as session:
        svc = _series_service(session)
        series = await svc.create(
            SeriesCreate(team_a_id=team_a_id, team_b_id=team_b_id, format=format_, importance="regular")
        )
        return series.id


async def _attach(
    session_factory,
    series_id: uuid.UUID,
    match_id: uuid.UUID,
    number: int,
    side: Literal["red", "blue"] = "red",
) -> None:
    async with session_factory() as session:
        svc = _series_service(session)
        await svc.attach_game(
            series_id, AttachGameRequest(match_id=match_id, game_number=number, team_a_side=side)
        )


async def _resolve(session_factory, series_id: uuid.UUID, req: FinalizeRequest) -> RatingPolicyDecision:
    async with session_factory() as session:
        svc = _series_service(session)
        return await svc.resolve_finalization_policy(series_id, req)


async def _series_row(session_factory, series_id: uuid.UUID) -> Series:
    async with session_factory() as session:
        row = await session.get(Series, series_id)
        assert row is not None
        return row


# ------------------------------------------------------------------ canonical


async def test_finalize_policy_defaults_to_current_canonical_winner(session_factory) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(
        session_factory, [("m1", True, "Ascent"), ("m2", True, "Bind"), ("m3", False, "Split")]
    )
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo3")
    await _attach(session_factory, series_id, matches["m1"].id, 1)
    await _attach(session_factory, series_id, matches["m2"].id, 2)

    decision = await _resolve(session_factory, series_id, FinalizeRequest())

    # BO3 2-0: calculated winner is team A; official defaults to it.
    assert decision.mode == "normal"
    assert decision.rate_series is True
    assert decision.official_winner_id == team_a_id


async def test_finalize_policy_reflects_refreshed_canonical_match(session_factory) -> None:
    """Refreshing a canonical match flips the map winner: the policy's
    calculated winner follows the CURRENT canonical data, never the stale
    stored winner/rounds, and the parse writes nothing."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")
    await _attach(session_factory, series_id, matches["m1"].id, 1)

    before = await _resolve(session_factory, series_id, FinalizeRequest())
    assert before.official_winner_id == team_a_id

    # The canonical match is refreshed: blue (team B) now won.
    async with session_factory() as session:
        await _seed_match(
            session,
            _ID % "01",
            _completed_variant(_ID % "01", red_wins=False, map_name="Ascent"),
            refresh=True,
        )

    after = await _resolve(session_factory, series_id, FinalizeRequest())

    # Current canonical winner (team B), not the stale attached-game winner (A).
    assert after.mode == "normal"
    assert after.official_winner_id == team_b_id

    # The parse never writes: the stored row still says team A.
    row = await _series_row(session_factory, series_id)
    assert row.status == "draft"
    assert row.calculated_winner_id == team_a_id
    assert row.official_winner_id is None
    assert row.winner_override_reason is None


async def test_finalize_policy_override_uses_current_canonical_after_refresh(session_factory) -> None:
    """An override is only an override against the CURRENT canonical calculated
    winner: after the refresh flips the calculated winner onto the requested
    official winner, the same request resolves to normal (no reason/mode needed)."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")
    await _attach(session_factory, series_id, matches["m1"].id, 1)

    # Before the refresh the official winner (B) differs from calculated (A):
    # an override -> reason + mode required.
    with pytest.raises(Exception) as excinfo:
        await _resolve(
            session_factory,
            series_id,
            FinalizeRequest(official_winner_id=team_b_id, override_reason="ruling"),
        )
    assert getattr(excinfo.value, "code", None) == "RATING_POLICY_REQUIRED"
    assert getattr(excinfo.value, "status", None) == 409

    # Refresh flips the canonical winner to team B: the same request is now a
    # no-op override (official == current calculated) -> normal.
    async with session_factory() as session:
        await _seed_match(
            session,
            _ID % "01",
            _completed_variant(_ID % "01", red_wins=False, map_name="Ascent"),
            refresh=True,
        )
    decision = await _resolve(
        session_factory,
        series_id,
        FinalizeRequest(official_winner_id=team_b_id, override_reason="stale ruling"),
    )

    assert decision.mode == "normal"
    assert decision.rate_series is True
    assert decision.official_winner_id == team_b_id


async def test_finalize_policy_official_winner_must_be_a_team_of_series(session_factory) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")
    await _attach(session_factory, series_id, matches["m1"].id, 1)

    stranger = uuid.uuid4()
    try:
        await _resolve(
            session_factory,
            series_id,
            FinalizeRequest(official_winner_id=stranger, override_reason="x", rating_mode="manual_override"),
        )
    except Exception as exc:  # noqa: BLE001 — AppError carries the stable code/status
        assert exc.__class__.__name__ == "AppError"
        assert exc.code == "SERIES_INVALID"  # type: ignore[attr-defined]
        assert exc.status == 409  # type: ignore[attr-defined]
    else:
        pytest.fail("expected SERIES_INVALID")


async def test_finalize_policy_consistent_read_under_concurrent_attach(session_factory) -> None:
    """The parse derives its result from ONE joined read: under a concurrent
    attach it observes exactly one committed state (pre- or post-commit), never
    a mixture. BO5 with game 1 (A wins) and the four later games raced one at a
    time; the observed states oscillate between team A leading (1-0/2-1) and a
    tie (1-1/2-2, calculated None), so every no-override decision must be
    official ∈ {team_a, None} — a mixed read would leak team B or crash."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),  # A wins
            ("m2", False, "Bind"),  # B wins
            ("m3", True, "Split"),  # A wins
            ("m4", False, "Haven"),  # B wins
            ("m5", True, "Icebox"),  # A wins
        ],
    )
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo5")
    await _attach(session_factory, series_id, matches["m1"].id, 1)  # 1-0, calculated A

    async def parse_once() -> RatingPolicyDecision:
        return await _resolve(session_factory, series_id, FinalizeRequest())

    for match_key, game_number in (("m2", 2), ("m3", 3), ("m4", 4), ("m5", 5)):
        match_id = matches[match_key].id

        async def attach_once(match_id=match_id, game_number=game_number) -> None:
            await _attach(session_factory, series_id, match_id, game_number)

        results = await asyncio.gather(*(parse_once() for _ in range(6)), attach_once())
        for decision in results:
            if decision is None:
                continue  # the attach task
            assert decision.mode == "normal"
            assert decision.rate_series is True
            # Consistent with exactly one observed state (A leading or tied).
            assert decision.official_winner_id in {team_a_id, None}

    # The persisted row is internally consistent with its games afterwards.
    row = await _series_row(session_factory, series_id)
    games = await _attached_games(session_factory, series_id)
    assert [g.game_number for g in games] == [1, 2, 3, 4, 5]
    assert row.team_a_maps_won == 3
    assert row.team_b_maps_won == 2
    assert row.calculated_winner_id == team_a_id


async def _attached_games(session_factory, series_id: uuid.UUID) -> list[SeriesGame]:
    async with session_factory() as session:
        result = await session.execute(
            select(SeriesGame).where(SeriesGame.series_id == series_id).order_by(SeriesGame.game_number)
        )
        return list(result.scalars())


# ------------------------------------------------------- D4/D5 (plan Task 6)


async def test_finalize_policy_unrated_mode_is_explicit(session_factory) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")
    await _attach(session_factory, series_id, matches["m1"].id, 1)

    decision = await _resolve(
        session_factory, series_id, FinalizeRequest(rating_mode="unrated")  # type: ignore[arg-type]
    )

    assert decision.mode == "unrated"
    assert decision.rate_series is False


async def test_finalize_policy_forfeit_without_reason_is_rejected_even_when_official_equals_calculated(
    session_factory,
) -> None:
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(session_factory, [("m1", True, "Ascent")])
    series_id = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")
    await _attach(session_factory, series_id, matches["m1"].id, 1)

    try:
        await _resolve(
            session_factory,
            series_id,
            FinalizeRequest(
                official_winner_id=team_a_id, rating_mode="forfeit_result_only"  # type: ignore[arg-type]
            ),
        )
    except Exception as exc:  # noqa: BLE001
        assert getattr(exc, "code", None) == "RATING_POLICY_REQUIRED"
        assert getattr(exc, "status", None) == 409
    else:
        pytest.fail("expected RATING_POLICY_REQUIRED")
