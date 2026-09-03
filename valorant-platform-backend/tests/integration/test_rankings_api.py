"""Real-Postgres rankings API integration tests (plan Task 16, App. D).

The full rankings/history/rebuild flow runs against real Postgres (migrated
schema through the test harness): teams seeded, canonical matches imported
through the real mapper (FakeHenrik fixtures, no network), series finalized
through the real ``RatingService``, then the rankings/history/rebuild surfaces
exercised. Covers the plan Task 16 step-5 contract:

- finalize 3 series → ``GET /api/v1/rankings/teams`` order is correct
  (``current_elo DESC``, rank = 1-based);
- ``GET /api/v1/teams/{id}/rating-history`` explains every current rating (the
  event chain ``1000 + sum(elo_change)`` replays to ``current_elo``);
- ``GET /api/v1/teams/{id}/series`` lists the team's series newest first with
  games + map names;
- ``rebuild()`` reproduces standings: standings before vs after are identical;
- run versions: after rebuild a team's history contains events from BOTH runs
  (immutable audit preserved) while the current-run (API) events match the
  final standings;
- the rebuild route is admin-gated (401 without the key, 200 with it) while
  the standings read is service-token-gated (401 without the token, 200 with
  it; delta D1 / spec §6.3);
- a finalized series whose ``played_at`` is null rejects the rebuild with 422
  ``SERIES_INVALID``;
- fix round 1 (Critical): a NEW series inserted and finalized WHILE a rebuild
  holds the shared advisory lock is serialized behind it and rated under the
  new run — nothing is overwritten or excluded;
- fix round 1 (Important): rating-history orders events by replay chronology
  (the owning series' ``played_at``), not transaction-stable insert order, and
  a repeated rebuild reproduces identical standings/history;
- fix round 1 (Important): ``run_number`` stays sequential (``max+1``) across a
  rolled-back rebuild — no identity-sequence gap;
- fix round 2 (blocker): every rating event carries a stable per-run
  ``sequence`` in ACTUAL application/replay order; out-of-chronology
  finalization chains ``elo_before``/``elo_after`` in sequence order, both team
  events of a series share one sequence, rebuilds re-derive events in replay
  order, and a repeated rebuild reproduces identical standings/history;
- fix round 3 (blocker): the exact-pair invariant is enforced by a DEFERRED
  constraint trigger at COMMIT (exactly two events per ``(run, sequence,
  series)``, teams exactly the series' pair, no duplicate/wrong/partial pair),
  and pre-0011 backfill preserves the persisted application-order proxy
  (earliest ``created_at``/``id``), never ``played_at``.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select, text

from app.api.dependencies import get_ranking_service, get_rebuild_service
from app.db.models import RatingEvent, RatingRun, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.db.repositories.team_repository import TeamRepository
from app.legacy.elo_calculator import EloCalculator
from app.main import create_app
from app.services.ranking_rebuild_service import RankingRebuildService
from app.services.ranking_service import RankingService
from tests.integration.test_finalization import (
    _attach,
    _create_series,
    _events_for_team,
    _finalize,
    _seed_finalize_scenario,
    _seed_matches,
    _seed_team,
    _seed_teams,
)
from tests.token_helpers import production_settings, service_token_headers

BASE = "/api/v1/rankings"
TEAMS_BASE = "/api/v1/teams"

INITIAL_ELO = Decimal(1000)


async def _seed_standings(session_factory, *, offset: int = 0) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Three teams + three finalized series (A > B, B > C, A > C), finalized in
    the same ``played_at`` order the rebuild replays:
    S1 (Jan 10) A beats B bo3 2-0; S2 (Jan 11) B beats C bo1; S3 (Jan 12) A
    beats C bo1. Returns ``(team_a, team_b, team_c)``."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    team_c_id = await _seed_team(session_factory, "Gamma")
    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),  # S1 map 1: A (red) wins
            ("m2", True, "Bind"),  # S1 map 2: A (red) wins
            ("m3", True, "Split"),  # S2 map: B (red) wins
            ("m4", True, "Haven"),  # S3 map: A (red) wins
        ],
        offset=offset,
    )
    series_1 = await _create_series(
        session_factory, team_a_id, team_b_id, played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
    )
    series_2 = await _create_series(
        session_factory,
        team_b_id,
        team_c_id,
        format_="bo1",
        played_at=datetime(2026, 1, 11, 12, 0, tzinfo=UTC),
    )
    series_3 = await _create_series(
        session_factory,
        team_a_id,
        team_c_id,
        format_="bo1",
        played_at=datetime(2026, 1, 12, 12, 0, tzinfo=UTC),
    )
    await _attach(session_factory, series_1, matches["m1"].id, 1)
    await _attach(session_factory, series_1, matches["m2"].id, 2)
    await _attach(session_factory, series_2, matches["m3"].id, 1)
    await _attach(session_factory, series_3, matches["m4"].id, 1)
    for series_id in (series_1, series_2, series_3):
        await _finalize(session_factory, series_id)
    return team_a_id, team_b_id, team_c_id


def _expected_standings() -> dict[str, Decimal]:
    """The exact ratings the seeded scenario produces (verified through the
    legacy calculator, mirroring the finalization tests)."""
    a_after_s1, b_after_s1 = EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 26, 18, "regular", "bo3", 2, 0)
    b_after_s2, c_after_s2 = EloCalculator.calculate_new_elo(
        round(b_after_s1, 0), 1000.0, 2, 0, 13, 9, "regular", "bo1"
    )
    a_after_s3, c_after_s3 = EloCalculator.calculate_new_elo(
        round(a_after_s1, 0), round(c_after_s2, 0), 2, 1, 13, 9, "regular", "bo1"
    )
    return {
        "a": Decimal(str(round(a_after_s3, 0))),
        "b": Decimal(str(round(b_after_s2, 0))),
        "c": Decimal(str(round(c_after_s3, 0))),
    }


async def _rankings_rows(session_factory) -> dict[uuid.UUID, dict]:
    """``{team_id: row}`` via the ranking service (before/after comparisons)."""
    async with session_factory() as session:
        svc = RankingService(
            session=session,
            rating_repo=RatingRepository(session),
            series_repo=SeriesRepository(session),
            match_repo=MatchRepository(session),
            team_repo=TeamRepository(session),
        )
        return {entry.team_id: entry.model_dump() for entry in await svc.rankings()}


async def _rebuild(session_factory, *, note: str | None = None):
    async with session_factory() as session:
        svc = RankingRebuildService(
            session=session,
            rating_repo=RatingRepository(session),
            series_repo=SeriesRepository(session),
        )
        return await svc.rebuild(note=note)


def _app(monkeypatch: pytest.MonkeyPatch, session_factory, *, app_env: str = "test"):
    """Build the app with gate bypass/protection and the service overrides.

    The ``admin_api_key`` is retained because ``/rebuild`` keeps the
    ``X-Admin-Key`` gate (spec §6.3) even after the standings read moved to
    service tokens (delta D1).
    """
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: production_settings(app_env=app_env, admin_api_key="s3cret-key"),
    )
    app = create_app()

    async def _ranking_override():
        async with session_factory() as session:
            yield RankingService(
                session=session,
                rating_repo=RatingRepository(session),
                series_repo=SeriesRepository(session),
                match_repo=MatchRepository(session),
                team_repo=TeamRepository(session),
            )

    async def _rebuild_override():
        async with session_factory() as session:
            yield RankingRebuildService(
                session=session,
                rating_repo=RatingRepository(session),
                series_repo=SeriesRepository(session),
            )

    app.dependency_overrides[get_ranking_service] = _ranking_override
    app.dependency_overrides[get_rebuild_service] = _rebuild_override
    return app


# ------------------------------------------------------------------ standings + history


async def test_rankings_order_and_rating_history_explain_current_elo(session_factory, monkeypatch) -> None:
    team_a, team_b, team_c = await _seed_standings(session_factory)
    expected = _expected_standings()
    app = _app(monkeypatch, session_factory)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"{BASE}/teams")
        assert resp.status_code == 200
        body = resp.json()
        assert [uuid.UUID(row["team_id"]) for row in body] == [team_a, team_b, team_c]  # A > B > C
        assert [row["rank"] for row in body] == [1, 2, 3]
        by_id = {row["team_id"]: row for row in body}
        assert Decimal(by_id[str(team_a)]["current_elo"]) == expected["a"]
        assert Decimal(by_id[str(team_b)]["current_elo"]) == expected["b"]
        assert Decimal(by_id[str(team_c)]["current_elo"]) == expected["c"]
        assert by_id[str(team_a)]["peak_elo"] == by_id[str(team_a)]["current_elo"]
        assert by_id[str(team_b)]["matches_played"] == 3  # bo3 (2) + bo1 (1)
        assert by_id[str(team_c)]["series_losses"] == 2  # S2 + S3

        # Every team's current-run history replays exactly to its rating.
        for team_id, expected_elo in ((team_a, expected["a"]), (team_b, expected["b"]), (team_c, expected["c"])):
            history = (await client.get(f"{TEAMS_BASE}/{team_id}/rating-history")).json()
            assert history, f"team {team_id} has no history"
            assert all(event["run_id"] == history[0]["run_id"] for event in history)  # one current run
            replayed = INITIAL_ELO + sum((Decimal(event["elo_change"]) for event in history), Decimal(0))
            assert replayed == expected_elo, f"team {team_id} history diverges from its rating"


async def test_team_series_read_lists_series_newest_first(session_factory, monkeypatch) -> None:
    team_a, _team_b, _team_c = await _seed_standings(session_factory)
    app = _app(monkeypatch, session_factory)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"{TEAMS_BASE}/{team_a}/series")
        assert resp.status_code == 200
        series = resp.json()
        assert len(series) == 2  # S1 (A vs B) + S3 (A vs C)
        # Newest played first: S3 (Jan 12) before S1 (Jan 10).
        assert series[0]["played_at"] > series[1]["played_at"]
        assert series[0]["team_b_id"] == str(_team_c)
        assert series[1]["team_b_id"] == str(_team_b)
        assert series[0]["status"] == "finalized"
        assert len(series[0]["games"]) == 1  # S3 is a bo1
        assert series[0]["games"][0]["map_name"] == "Haven"
        assert series[1]["games"][0]["map_name"] == "Ascent"

        # A missing team is 404 on both new reads.
        missing = (await client.get(f"{TEAMS_BASE}/00000000-0000-0000-0000-000000000099/rating-history")).json()
        assert missing["error"]["code"] == "TEAM_NOT_FOUND"


# ------------------------------------------------------------------ rebuild

async def test_rebuild_reproduces_standings_and_preserves_old_run_events(session_factory, monkeypatch) -> None:
    team_a, team_b, team_c = await _seed_standings(session_factory)
    expected = _expected_standings()

    before = await _rankings_rows(session_factory)
    old_events_before = {team: await _events_for_team(session_factory, team) for team in (team_a, team_b, team_c)}

    result = await _rebuild(session_factory, note="integration rebuild")

    assert result.note == "integration rebuild"
    assert result.series_count == 3
    assert result.event_count == 6  # 3 rated series x 2 events
    assert result.teams_reset == 3

    # Rebuild reproduces standings exactly.
    after = await _rankings_rows(session_factory)
    assert {team: row["current_elo"] for team, row in after.items()} == {
        team: row["current_elo"] for team, row in before.items()
    }
    assert {team: row["current_elo"] for team, row in after.items()} == {
        team_a: Decimal(str(expected["a"])),
        team_b: Decimal(str(expected["b"])),
        team_c: Decimal(str(expected["c"])),
    }
    for team in (team_a, team_b, team_c):
        assert before[team]["series_wins"] == after[team]["series_wins"]
        assert before[team]["series_losses"] == after[team]["series_losses"]
        assert before[team]["matches_played"] == after[team]["matches_played"]

    # Run versions: the team's history now contains events from BOTH runs —
    # every prior run's events are preserved byte-for-byte (immutable audit).
    for team in (team_a, team_b, team_c):
        events = await _events_for_team(session_factory, team)
        old_ids = {event.id for event in old_events_before[team]}
        new_ids = {event.id for event in events}
        assert old_ids <= new_ids  # nothing deleted
        assert len(new_ids) == len(old_ids) * 2  # one replay event per old event
        runs = {event.run_id for event in events}
        assert len(runs) == 2

    # The CURRENT-run events (the API history) match the final standings.
    app = _app(monkeypatch, session_factory)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for team_id, expected_elo in ((team_a, expected["a"]), (team_b, expected["b"]), (team_c, expected["c"])):
            history = (await client.get(f"{TEAMS_BASE}/{team_id}/rating-history")).json()
            run_ids = {event["run_id"] for event in history}
            assert len(run_ids) == 1  # the current run only
            assert run_ids == {str(result.run_id)}
            replayed = INITIAL_ELO + sum((Decimal(event["elo_change"]) for event in history), Decimal(0))
            assert replayed == expected_elo


# ------------------------------------------------------------------ API surface

async def test_rankings_reads_service_token_gated_and_rebuild_admin_gated(session_factory, monkeypatch) -> None:
    await _seed_standings(session_factory)
    app = _app(monkeypatch, session_factory, app_env="production")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # Standings reads are service-token-gated: 401 without the token,
        # 200 with it.
        denied = await client.get(f"{BASE}/teams")
        assert denied.status_code == 401

        standings = await client.get(f"{BASE}/teams", headers=service_token_headers())
        assert standings.status_code == 200
        assert len(standings.json()) == 3

        # Rebuild is admin-gated: 401 without the key, 200 with it.
        denied = await client.post(f"{BASE}/rebuild")
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"

        ok = await client.post(f"{BASE}/rebuild", params={"note": "api rebuild"}, headers={"X-Admin-Key": "s3cret-key"})
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["note"] == "api rebuild"
        assert body["series_count"] == 3
        assert body["event_count"] == 6
        assert body["run_number"] >= 2
        assert isinstance(body["run_id"], str) and body["run_id"]

# ------------------------------------------------------------------ rejection gate


async def test_rebuild_and_concurrent_finalize_serialize_on_series_lock(session_factory) -> None:
    """The rebuild's all-series ``FOR UPDATE`` lock is shared with finalization:
    a rebuild racing a finalize of a still-draft series can never interleave or
    lose updates. Whichever order wins, the final state is the same — both
    series rated once under the CURRENT run, both team ratings reflecting both
    series (chronological replay), no unique violation, no deadlock."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),  # finalized series F: A beats B
            ("m2", True, "Bind"),  # draft series D: A beats B
        ],
    )
    finalized = await _create_series(
        session_factory, team_a_id, team_b_id, format_="bo1",
        played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
    )
    draft = await _create_series(
        session_factory, team_a_id, team_b_id, format_="bo1",
        played_at=datetime(2026, 1, 20, 12, 0, tzinfo=UTC),
    )
    await _attach(session_factory, finalized, matches["m1"].id, 1)
    await _attach(session_factory, draft, matches["m2"].id, 1)
    await _finalize(session_factory, finalized)

    async def do_finalize():
        return await _finalize(session_factory, draft)

    async def do_rebuild():
        return await _rebuild(session_factory, note="racing rebuild")

    results = await asyncio.wait_for(
        asyncio.gather(do_finalize(), do_rebuild(), return_exceptions=True), timeout=30
    )
    for result in results:
        assert not isinstance(result, BaseException), result

    # Both series rated exactly once under the CURRENT (new) run — 4 events.
    async with session_factory() as session:
        run = (await session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))).scalar_one()
        events = (
            (await session.execute(select(RatingEvent).where(RatingEvent.run_id == run.id))).scalars().all()
        )
        teams = (await session.execute(select(Team))).scalars().all()
    assert len(events) == 4
    assert len({event.series_id for event in events}) == 2

    # Both orders converge on the same final ratings: reset to 1000, replay F
    # (Jan 10), then D (Jan 20) — A 1046, B 953.
    expected_a, expected_b = EloCalculator.calculate_new_elo(
        round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[0], 0),
        round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[1], 0),
        1, 1, 13, 9, "regular", "bo1",
    )
    by_id = {team.id: team for team in teams}
    assert by_id[team_a_id].current_elo == Decimal(str(round(expected_a, 0)))
    assert by_id[team_b_id].current_elo == Decimal(str(round(expected_b, 0)))
    assert by_id[team_a_id].series_wins == 2
    assert by_id[team_b_id].series_losses == 2


async def test_rebuild_rejects_finalized_series_without_played_at(session_factory) -> None:
    team_a, _team_b, _team_c = await _seed_standings(session_factory)
    # Corrupt a finalized series' played_at (a state normal finalization can
    # never produce — simulated for the deterministic-ordering guard).
    async with session_factory() as session:
        await session.execute(text("UPDATE series SET played_at = NULL WHERE team_a_id = :team_a"), {"team_a": team_a})
        await session.commit()

    before = await _rankings_rows(session_factory)

    from app.api.errors import AppError

    with pytest.raises(AppError) as excinfo:
        await _rebuild(session_factory)
    assert excinfo.value.code == "SERIES_INVALID"
    assert excinfo.value.status == 422

    # All-or-nothing: nothing changed (no new run, no reset).
    after = await _rankings_rows(session_factory)
    assert after == before
    async with session_factory() as session:
        event_count = await session.scalar(select(func.count()).select_from(RatingEvent))
        run_count = await session.scalar(text("SELECT count(*) FROM rating_runs"))
    assert event_count == 6  # the 3 rated series' events, untouched
    assert run_count == 1  # only the seeded initial live run (new run rolled back)


# ------------------------------------------------------ fix round 1 (advisory lock)


async def test_new_series_finalized_during_rebuild_is_serialized_and_not_lost(
    session_factory, monkeypatch
) -> None:
    """fix round 1 (Critical): the shared ``RATING_WORK_LOCK_KEY`` advisory lock
    is acquired first by BOTH finalization and rebuild. Here a rebuild holds the
    lock while a NEW series is inserted (draft insert is lock-free) and then
    finalized: the finalize provably BLOCKS on the advisory lock and only runs
    after the rebuild commits — so the new series is rated under the new run
    (never orphaned under an old run) and no ratings are overwritten/excluded.
    Both tasks serialize; the final state is deterministic."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),  # finalized series F: A beats B (bo1)
            ("m2", True, "Bind"),  # new series D: A beats B (bo1)
        ],
    )
    finalized = await _create_series(
        session_factory, team_a_id, team_b_id, format_="bo1",
        played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
    )
    await _attach(session_factory, finalized, matches["m1"].id, 1)
    await _finalize(session_factory, finalized)

    rebuild_holding = asyncio.Event()
    release_rebuild = asyncio.Event()
    original_lock = RatingRepository.acquire_rating_work_lock

    async def gated_lock(self):
        await original_lock(self)
        gate = getattr(self, "_gate_after_lock", None)
        if gate is not None:
            gate["holding"].set()
            await gate["release"].wait()

    monkeypatch.setattr(RatingRepository, "acquire_rating_work_lock", gated_lock)

    async def do_rebuild():
        async with session_factory() as session:
            repo = RatingRepository(session)
            repo._gate_after_lock = {"holding": rebuild_holding, "release": release_rebuild}  # type: ignore[attr-defined]
            svc = RankingRebuildService(session=session, rating_repo=repo, series_repo=SeriesRepository(session))
            return await svc.rebuild(note="racing rebuild")

    rebuild_task = asyncio.create_task(do_rebuild())
    await asyncio.wait_for(rebuild_holding.wait(), timeout=30)
    # The rebuild now holds the advisory lock (and has locked all series rows).

    # A NEW series is inserted DURING the rebuild (draft insert is lock-free)...
    new_series = await _create_series(
        session_factory, team_a_id, team_b_id, format_="bo1",
        played_at=datetime(2026, 1, 20, 12, 0, tzinfo=UTC),
    )
    await _attach(session_factory, new_series, matches["m2"].id, 1)

    # ...and finalized concurrently: the finalize BLOCKS on the advisory lock.
    finalize_task = asyncio.create_task(_finalize(session_factory, new_series))
    await asyncio.sleep(0.1)  # give it a moment to reach the advisory lock
    assert not finalize_task.done(), "finalize must wait for the rebuild's advisory lock"

    release_rebuild.set()
    results = await asyncio.wait_for(
        asyncio.gather(rebuild_task, finalize_task, return_exceptions=True), timeout=30
    )
    for result in results:
        assert not isinstance(result, BaseException), result

    # No ratings overwritten/excluded: the CURRENT run holds BOTH series'
    # events (F from the rebuild replay, D from the post-rebuild finalize).
    async with session_factory() as session:
        run = (await session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))).scalar_one()
        events = (await session.execute(select(RatingEvent).where(RatingEvent.run_id == run.id))).scalars().all()
        teams = (await session.execute(select(Team))).scalars().all()
    assert len(events) == 4
    assert {event.series_id for event in events} == {finalized, new_series}

    # The new series was finalized AFTER the rebuild, on top of the replay:
    # reset to 1000, replay F (A 1027), then finalize D (A beats B at 1027/978).
    expected_a, expected_b = EloCalculator.calculate_new_elo(
        round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[0], 0),
        round(EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 13, 9, "regular", "bo1")[1], 0),
        1, 1, 13, 9, "regular", "bo1",
    )
    by_id = {team.id: team for team in teams}
    assert by_id[team_a_id].current_elo == Decimal(str(round(expected_a, 0)))
    assert by_id[team_b_id].current_elo == Decimal(str(round(expected_b, 0)))
    assert by_id[team_a_id].series_wins == 2
    assert by_id[team_b_id].series_losses == 2
    assert by_id[team_a_id].matches_played == 2


# ------------------------------------------------ history sequence (fix round 2)


async def test_out_of_chronology_finalization_chains_elo_in_sequence_order(
    session_factory, monkeypatch
) -> None:
    """fix round 2 (blocker): every rating event carries a stable per-run
    ``sequence`` in ACTUAL application/replay order. When finalization order
    differs from the rebuild's replay order, the LIVE-run history follows the
    finalization (application) order and ``elo_before``/``elo_after`` chain in
    it; a rebuild re-derives the events in replay order with the SAME chaining.
    Both team events of a series share one sequence value, and old runs stay
    immutable."""
    team_a_id, team_b_id = await _seed_teams(session_factory)
    team_c_id = await _seed_team(session_factory, "Gamma")
    matches = await _seed_matches(
        session_factory,
        [
            ("m1", True, "Ascent"),  # S1 map 1: A (red) wins
            ("m2", True, "Bind"),  # S1 map 2: A (red) wins
            ("m3", True, "Split"),  # S3 map: A (red) wins
        ],
    )
    s1 = await _create_series(
        session_factory, team_a_id, team_b_id, played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC)
    )
    s3 = await _create_series(
        session_factory, team_a_id, team_c_id, format_="bo1",
        played_at=datetime(2026, 1, 10, 12, 0, tzinfo=UTC),
    )
    await _attach(session_factory, s1, matches["m1"].id, 1)
    await _attach(session_factory, s1, matches["m2"].id, 2)
    await _attach(session_factory, s3, matches["m3"].id, 1)
    # FINALIZE S3 first, out of replay order: the live-run history must follow
    # APPLICATION order (S3 before S1), and the elos must chain in that order.
    # D8 (delta backdate guard) forbids finalizing a rated series EARLIER than
    # the latest rated series, so S3 shares S1's played_at — the rebuild's
    # (played_at, created_at, id) order still replays S1 before S3 (S1 was
    # created first), preserving the application-vs-replay divergence below.
    await _finalize(session_factory, s3)
    await _finalize(session_factory, s1)

    async def _history(team_id: uuid.UUID) -> list[dict]:
        app = _app(monkeypatch, session_factory)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return (await client.get(f"{TEAMS_BASE}/{team_id}/rating-history")).json()

    live = await _history(team_a_id)
    assert [event["series_id"] for event in live] == [str(s3), str(s1)]
    assert [event["sequence"] for event in live] == [1, 2]
    assert Decimal(live[0]["elo_before"]) == INITIAL_ELO
    assert Decimal(live[0]["elo_after"]) == Decimal(live[1]["elo_before"])  # chain
    assert Decimal(live[1]["elo_after"]) == Decimal("1054.0")
    assert {event["run_id"] for event in live} == {live[0]["run_id"]}

    # The two team events of each series share ONE sequence value (DB check).
    async with session_factory() as session:
        run = (await session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))).scalar_one()
        for series_id in (s1, s3):
            seqs = (
                (await session.execute(
                    select(RatingEvent.sequence).where(
                        RatingEvent.run_id == run.id, RatingEvent.series_id == series_id
                    )
                )).scalars().all()
            )
            assert len(seqs) == 2 and len(set(seqs)) == 1  # exactly two share one sequence

    # Rebuild re-derives events in played_at order (S1 then S3) with chaining.
    result = await _rebuild(session_factory, note="chronological rebuild")
    replay = await _history(team_a_id)
    assert [event["series_id"] for event in replay] == [str(s1), str(s3)]
    assert [event["sequence"] for event in replay] == [1, 2]
    assert {event["run_id"] for event in replay} == {str(result.run_id)}
    # S1 replay: A 1000 -> 1034; S3 replay: A 1034 -> 1054 — chained.
    expected_s1_after = Decimal(str(round(
        EloCalculator.calculate_new_elo(1000.0, 1000.0, 0, 0, 26, 18, "regular", "bo3", 2, 0)[0], 0
    )))
    assert Decimal(replay[0]["elo_before"]) == INITIAL_ELO
    assert Decimal(replay[0]["elo_after"]) == expected_s1_after
    assert Decimal(replay[1]["elo_before"]) == expected_s1_after  # chain
    expected_s3_after = Decimal(str(round(
        EloCalculator.calculate_new_elo(float(expected_s1_after), 1000.0, 2, 0, 13, 9, "regular", "bo1")[0], 0
    )))
    assert Decimal(replay[1]["elo_after"]) == expected_s3_after

    # Old (live) run is untouched: S3 seq 1, S1 seq 2 with the LIVE elo values.
    async with session_factory() as session:
        old_events = (await session.execute(
            select(RatingEvent).where(
                RatingEvent.run_id == live[0]["run_id"], RatingEvent.team_id == team_a_id
            ).order_by(RatingEvent.sequence)
        )).scalars().all()
    assert [(event.series_id, event.sequence, event.elo_after) for event in old_events] == [
        (s3, 1, Decimal("1027.0")),
        (s1, 2, Decimal("1054.0")),
    ]


async def test_repeated_rebuild_history_and_sequences_stable(session_factory, monkeypatch) -> None:
    """fix round 2: a repeated rebuild reproduces identical standings AND an
    identical current-run history — the same series order, the same per-run
    ``sequence`` values, and the same chained ``elo_before``/``elo_after`` —
    with sequential (gap-free) ``run_number`` values. Old runs' events are
    preserved."""
    team_a, team_b, team_c = await _seed_standings(session_factory)

    first = await _rebuild(session_factory, note="first")
    after_first = await _rankings_rows(session_factory)
    second = await _rebuild(session_factory, note="second")
    after_second = await _rankings_rows(session_factory)
    assert second.run_number == first.run_number + 1  # sequential, no gap
    assert after_second == after_first

    app = _app(monkeypatch, session_factory)
    expected_sequences = {team_a: [1, 3], team_b: [1, 2], team_c: [2, 3]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for team_id in (team_a, team_b, team_c):
            history = (await client.get(f"{TEAMS_BASE}/{team_id}/rating-history")).json()
            assert [event["sequence"] for event in history] == expected_sequences[team_id]
            # elo chain within the current run: each event starts where the
            # previous ended, first at the reset 1000.
            running = INITIAL_ELO
            for event in history:
                assert Decimal(event["elo_before"]) == running
                running = Decimal(event["elo_after"])
            assert running == after_second[team_id]["current_elo"]

    # The run-2 and run-3 histories are identical event-for-event (stability).
    async with session_factory() as session:
        async def _signature(run_id):
            rows = (await session.execute(
                select(RatingEvent).where(RatingEvent.run_id == run_id)
            )).scalars().all()
            return sorted(
                (e.team_id, e.sequence, e.series_id, e.elo_before, e.elo_after, e.elo_change)
                for e in rows
            )

        run_2 = await _signature(first.run_id)
        run_3 = await _signature(second.run_id)
    assert run_2 == run_3
    # Old runs' events are preserved (the original live run's 6 events remain).
    async with session_factory() as session:
        original_run = (await session.execute(
            select(RatingRun).order_by(RatingRun.run_number.asc()).limit(1)
        )).scalar_one()
        original_count = (await session.execute(
            select(func.count()).select_from(RatingEvent).where(RatingEvent.run_id == original_run.id)
        )).scalar_one()
    assert original_count == 6  # the live run's 6 events were never touched


# ----------------------------------------------------------- run_number (fix r1)


async def test_run_number_stays_sequential_across_a_rolled_back_rebuild(session_factory, monkeypatch) -> None:
    """fix round 1 (Important): ``run_number`` follows the documented sequential
    ``max+1`` contract even when a rebuild rolls back. A rebuild that fails
    mid-transaction must not consume a ``run_number`` (no identity-sequence
    gap): the next successful rebuild reuses the same number."""
    await _seed_standings(session_factory)

    first = await _rebuild(session_factory, note="first")
    assert first.run_number >= 2  # the seed row is run 1 in a fresh schema

    # A second rebuild fails mid-transaction (2nd event insert raises) and
    # rolls back — the new run it created must vanish.
    calls = {"n": 0}
    original_insert = RatingRepository.insert_rating_event

    async def poisoned(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise RuntimeError("simulated mid-transaction failure")
        return await original_insert(self, *args, **kwargs)

    monkeypatch.setattr(RatingRepository, "insert_rating_event", poisoned)
    with pytest.raises(RuntimeError, match="mid-transaction"):
        await _rebuild(session_factory, note="rolled back")
    # Restore the real insert before the next rebuild.
    monkeypatch.setattr(RatingRepository, "insert_rating_event", original_insert)

    # The rolled-back attempt left no run_number gap: the next rebuild gets
    # exactly first + 1 (not first + 2).
    third = await _rebuild(session_factory, note="third")
    assert third.run_number == first.run_number + 1

    async with session_factory() as session:
        numbers = list((await session.execute(text("SELECT run_number FROM rating_runs ORDER BY run_number"))).scalars())
    # Contiguous: seed, first, third — the rolled-back attempt left no gap.
    assert numbers == list(range(first.run_number - 1, third.run_number + 1))


# ------------------------------------------- sequence guard trigger (fix round 2)


async def test_sequence_guard_rejects_another_series_reusing_a_sequence(session_factory) -> None:
    """fix round 3 (DB-level): every (run, sequence) value belongs to exactly
    TWO events of ONE series. A raw insert for a DIFFERENT series claiming an
    already-used sequence is rejected at COMMIT by the deferred pair-guard
    constraint trigger (the unique per-team key alone cannot catch this
    cross-series case)."""
    team_a_id, team_b_id, series_id = await _seed_finalize_scenario(session_factory, winners=["A", "A"])
    await _finalize(session_factory, series_id)
    # A new (draft) series — FK-valid, no events yet.
    new_series = await _create_series(session_factory, team_a_id, team_b_id, format_="bo1")

    async with session_factory() as session:
        run = (await session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))).scalar_one()
        with pytest.raises(Exception, match="exactly two events of one series"):
            await session.execute(
                text(
                    "INSERT INTO rating_events "
                    "(run_id, series_id, team_id, sequence, elo_before, elo_after, elo_change, "
                    " opponent_team_id, result, calculation_details) "
                    "VALUES (:run_id, :series_id, :team_id, 1, 1, 1, 0, :opponent, 'win', '{}'::jsonb)"
                ),
                {"run_id": run.id, "series_id": new_series, "team_id": team_a_id, "opponent": team_b_id},
            )
            await session.commit()  # the deferred pair guard fires here
        await session.rollback()

    # The finalized series' two events (and their sequence 1) are untouched.
    async with session_factory() as session:
        run = (await session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))).scalar_one()
        events = (await session.execute(
            select(RatingEvent).where(RatingEvent.run_id == run.id)
        )).scalars().all()
    assert len(events) == 2
    assert {event.sequence for event in events} == {1}
