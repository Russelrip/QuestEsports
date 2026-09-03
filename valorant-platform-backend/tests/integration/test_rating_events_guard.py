"""Real-Postgres adversarial tests for the exact-event-pair guard (Task 16 fix rounds 4+5).

Migration 0012 introduces the durable RESERVATION table ``rating_event_sequences`` with
``PRIMARY KEY (run_id, sequence)`` and ``UNIQUE (run_id, series_id)``: a sequence value in
a run is OWNED by exactly one series before any event may use it. Finalize/rebuild reserve
the sequence before inserting the two team events; ``rating_events`` carries a composite
FK to the reservation, and the deferred pair guard validates the pair against it at
COMMIT (exactly two events of the reserved series, teams exactly the series'
``team_a``/``team_b``, no duplicate team). These tests drive the raw table directly:

- a valid application pair (reservation + two team events) commits;
- a partial (one-event) pair cannot commit;
- a pair with a team that is not in the reserved series cannot commit;
- a duplicate same-team pair is rejected;
- a BARRIER-FORCED concurrent reservation race: two transactions reserve the SAME
  ``(run, sequence)`` for DIFFERENT series and insert their pairs before either commits —
  the second reservation INSERT blocks, then exactly one reservation succeeds and the
  other fails; no four-event collision;
- fix round 5: a committed reservation is immutable at the DB level — UPDATE
  (reassigning ``series_id`` or ``sequence``) and DELETE are rejected by the 0013
  trigger, and the events referencing it stay byte-for-byte consistent.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.db.models import RatingRun

_EVENT_COLS = (
    "run_id, series_id, team_id, sequence, elo_before, elo_after, elo_change, "
    " opponent_team_id, result, calculation_details"
)

_RESERVE_SQL = (
    "INSERT INTO rating_event_sequences (run_id, series_id, sequence) VALUES (:run, :series, :seq)"
)


async def _seed_guard_fixture(session_factory) -> dict[str, object]:
    """The seeded run plus series X (teams A/B) and series Y (teams D/E), with
    team C as a wrong-team decoy."""
    async with session_factory() as session:
        run = (await session.execute(select(RatingRun).order_by(RatingRun.run_number.desc()).limit(1))).scalar_one()
        team_a, team_b, team_c, team_d, team_e = (uuid.uuid4() for _ in range(5))
        series_x, series_y = uuid.uuid4(), uuid.uuid4()
        await session.execute(
            text("INSERT INTO teams (id, name) VALUES (:a,'A'),(:b,'B'),(:c,'C'),(:d,'D'),(:e,'E')"),
            {"a": team_a, "b": team_b, "c": team_c, "d": team_d, "e": team_e},
        )
        await session.execute(
            text(
                "INSERT INTO series (id, team_a_id, team_b_id, format, importance, status, played_at) "
                "VALUES (:s,:a,:b,'bo1','regular','finalized', now()), (:y,:d,:e,'bo1','regular','finalized', now())"
            ),
            {"s": series_x, "a": team_a, "b": team_b, "y": series_y, "d": team_d, "e": team_e},
        )
        await session.commit()
        return {
            "run": run.id,
            "team_a": team_a,
            "team_b": team_b,
            "team_c": team_c,
            "team_d": team_d,
            "team_e": team_e,
            "series_x": series_x,
            "series_y": series_y,
        }


def _pair_sql(sequence: int) -> str:
    """A two-row multi-VALUES insert with ``:run/:series`` and the four teams
    parameterized (winner team_a/team_d, loser team_b/team_e by convention)."""
    return (
        f"INSERT INTO rating_events ({_EVENT_COLS}) VALUES "
        f"(:run,:series,:win,{sequence},1000,1027,27,:lose,'win','{{}}'::jsonb),"
        f"(:run,:series,:lose,{sequence},1000,978,-22,:win,'loss','{{}}'::jsonb)"
    )


async def _reserve(session, fixture, series, sequence) -> None:
    await session.execute(text(_RESERVE_SQL), {"run": fixture["run"], "series": series, "seq": sequence})


# ------------------------------------------------------------------ valid pair


async def test_pair_guard_valid_reserved_pair_commits(session_factory) -> None:
    fixture = await _seed_guard_fixture(session_factory)
    async with session_factory() as session:
        await _reserve(session, fixture, fixture["series_x"], 1)
        await session.execute(
            text(_pair_sql(1)),
            {"run": fixture["run"], "series": fixture["series_x"], "win": fixture["team_a"], "lose": fixture["team_b"]},
        )
        await session.commit()

    async with session_factory() as session:
        rows = (await session.execute(text("SELECT team_id FROM rating_events WHERE sequence = 1"))).scalars().all()
        reservations = (await session.execute(
            text("SELECT series_id FROM rating_event_sequences WHERE sequence = 1")
        )).scalars().all()
    assert set(rows) == {fixture["team_a"], fixture["team_b"]}
    assert set(reservations) == {fixture["series_x"]}


# ------------------------------------------------------------------ partial pair


async def test_pair_guard_rejects_a_single_partial_event(session_factory) -> None:
    fixture = await _seed_guard_fixture(session_factory)
    async with session_factory() as session:
        await _reserve(session, fixture, fixture["series_x"], 2)
        with pytest.raises(Exception, match="exactly two events of one series"):
            await session.execute(
                text(
                    "INSERT INTO rating_events (run_id, series_id, team_id, sequence, elo_before, "
                    " elo_after, elo_change, opponent_team_id, result, calculation_details) "
                    "VALUES (:run,:series,:win,2,1000,1027,27,:lose,'win','{}'::jsonb)"
                ),
                {"run": fixture["run"], "series": fixture["series_x"], "win": fixture["team_a"], "lose": fixture["team_b"]},
            )
            await session.commit()  # the deferred pair guard fires at COMMIT
        await session.rollback()

    async with session_factory() as session:
        count = await session.scalar(text("SELECT count(*) FROM rating_events WHERE sequence = 2"))
    assert count == 0


# ------------------------------------------------------------------ wrong team


async def test_pair_guard_rejects_a_wrong_team(session_factory) -> None:
    fixture = await _seed_guard_fixture(session_factory)
    async with session_factory() as session:
        await _reserve(session, fixture, fixture["series_x"], 3)
        with pytest.raises(Exception, match="team_a and team_b"):
            await session.execute(
                text(_pair_sql(3)),
                {"run": fixture["run"], "series": fixture["series_x"], "win": fixture["team_a"], "lose": fixture["team_c"]},
            )
            await session.commit()  # team C is not part of series X
        await session.rollback()

    async with session_factory() as session:
        count = await session.scalar(text("SELECT count(*) FROM rating_events WHERE sequence = 3"))
    assert count == 0


# ------------------------------------------------------------------ duplicate team


async def test_pair_guard_rejects_duplicate_same_team(session_factory) -> None:
    fixture = await _seed_guard_fixture(session_factory)
    async with session_factory() as session:
        await _reserve(session, fixture, fixture["series_x"], 4)
        # Two events for the SAME team in one pair: the unique
        # (run_id, series_id, team_id) key rejects the duplicate immediately.
        with pytest.raises(IntegrityError, match="rating_events_run_series_team_key"):
            await session.execute(
                text(
                    "INSERT INTO rating_events (run_id, series_id, team_id, sequence, elo_before, "
                    " elo_after, elo_change, opponent_team_id, result, calculation_details) "
                    "VALUES (:run,:series,:win,4,1000,1027,27,:lose,'win','{}'::jsonb),"
                    "(:run,:series,:win,4,1000,1027,27,:lose,'win','{}'::jsonb)"
                ),
                {"run": fixture["run"], "series": fixture["series_x"], "win": fixture["team_a"], "lose": fixture["team_b"]},
            )
        await session.rollback()

    async with session_factory() as session:
        count = await session.scalar(text("SELECT count(*) FROM rating_events WHERE sequence = 4"))
    assert count == 0


# ------------------------------------------------------------- reservation race


async def test_concurrent_reservations_same_sequence_exactly_one_wins(session_factory) -> None:
    """fix round 4 (barrier-forced): two transactions reserve the SAME
    ``(run, sequence)`` for DIFFERENT series and prepare their event pairs
    before either commits. The reservation table's ``PRIMARY KEY (run_id,
    sequence)`` serializes them: the second reservation INSERT blocks on the
    first's uncommitted row, and after the first commits it fails with a unique
    violation. Exactly one reservation and exactly one valid pair survive — no
    four-event collision, no mixed pair."""
    fixture = await _seed_guard_fixture(session_factory)
    t1_ready = asyncio.Event()
    release_t1 = asyncio.Event()

    async def transaction_one():
        async with session_factory() as session:
            await _reserve(session, fixture, fixture["series_x"], 5)
            await session.execute(
                text(_pair_sql(5)),
                {"run": fixture["run"], "series": fixture["series_x"], "win": fixture["team_a"], "lose": fixture["team_b"]},
            )
            t1_ready.set()
            await release_t1.wait()  # hold the reservation open
            await session.commit()
            return "one"

    async def transaction_two():
        async with session_factory() as session:
            # Blocks on T1's uncommitted reservation row, then fails with a
            # unique violation once T1 commits — its pair never lands.
            await _reserve(session, fixture, fixture["series_y"], 5)
            await session.execute(
                text(_pair_sql(5)),
                {"run": fixture["run"], "series": fixture["series_y"], "win": fixture["team_d"], "lose": fixture["team_e"]},
            )
            await session.commit()
            return "two"

    t1_task = asyncio.create_task(transaction_one())
    await asyncio.wait_for(t1_ready.wait(), timeout=30)
    # T1 holds the reservation + pair uncommitted. T2 now races the SAME
    # sequence: its reservation INSERT must block until T1 resolves.
    t2_task = asyncio.create_task(transaction_two())
    await asyncio.sleep(0.3)  # give T2 time to reach the blocked INSERT
    assert not t2_task.done(), "T2 must block on the conflicting reservation"

    release_t1.set()
    results = await asyncio.wait_for(asyncio.gather(t1_task, t2_task, return_exceptions=True), timeout=30)
    assert not isinstance(results[0], BaseException), results[0]
    assert isinstance(results[1], BaseException), "the conflicting reservation must fail"

    # Exactly one reservation and exactly one valid pair survive.
    async with session_factory() as session:
        reservations = (await session.execute(
            text("SELECT series_id FROM rating_event_sequences WHERE sequence = 5")
        )).scalars().all()
        events = (await session.execute(
            text("SELECT series_id, team_id FROM rating_events WHERE sequence = 5")
        )).all()
    assert len(reservations) == 1
    assert len(events) == 2  # no four-event collision
    assert len({event[1] for event in events}) == 2  # the series' two teams
    assert events[0][0] == reservations[0]  # events belong to the reserved series


# ---------------------------------------------- reservation immutability (fix round 5)


async def test_committed_reservation_is_immutable_and_events_stay_consistent(session_factory) -> None:
    """fix round 5: a committed ``(run_id, sequence, series_id)`` reservation is
    a durable OWNERSHIP record. The 0013 trigger rejects UPDATE (reassigning the
    series or the sequence value) and DELETE at the DB level — mirroring the
    0010 immutability of ``rating_events`` — and the immutable events that
    reference the reservation remain byte-for-byte consistent. Inserts (runtime
    allocation/backfill) remain valid: a fresh reservation + valid pair still
    commits afterwards."""
    fixture = await _seed_guard_fixture(session_factory)

    # Commit a reservation (sequence 7, series X) with its valid event pair.
    async with session_factory() as session:
        await _reserve(session, fixture, fixture["series_x"], 7)
        await session.execute(
            text(_pair_sql(7)),
            {"run": fixture["run"], "series": fixture["series_x"], "win": fixture["team_a"], "lose": fixture["team_b"]},
        )
        await session.commit()

    # 1. Reassigning the reservation to a DIFFERENT series must fail (this is
    #    the silent-history-rewrite case the round-5 review called out).
    async with session_factory() as session:
        with pytest.raises(Exception, match="immutable"):
            await session.execute(
                text(
                    "UPDATE rating_event_sequences SET series_id = :other "
                    "WHERE run_id = :run AND sequence = 7"
                ),
                {"other": fixture["series_y"], "run": fixture["run"]},
            )
        await session.rollback()

    # 2. Reassigning the sequence value itself must fail.
    async with session_factory() as session:
        with pytest.raises(Exception, match="immutable"):
            await session.execute(
                text(
                    "UPDATE rating_event_sequences SET sequence = 99 "
                    "WHERE run_id = :run AND sequence = 7"
                ),
                {"run": fixture["run"]},
            )
        await session.rollback()

    # 3. Deleting the reservation row must fail.
    async with session_factory() as session:
        with pytest.raises(Exception, match="immutable"):
            await session.execute(
                text("DELETE FROM rating_event_sequences WHERE run_id = :run AND sequence = 7"),
                {"run": fixture["run"]},
            )
        await session.rollback()

    # The reservation is untouched and its immutable events are unchanged and
    # still consistent with it (the pair still belongs to series X).
    async with session_factory() as session:
        reservation = (await session.execute(
            text(
                "SELECT series_id, sequence FROM rating_event_sequences "
                "WHERE run_id = :run AND sequence = 7"
            ),
            {"run": fixture["run"]},
        )).one()
        events = (await session.execute(
            text(
                "SELECT series_id, team_id, elo_before, elo_after FROM rating_events "
                "WHERE run_id = :run AND sequence = 7 ORDER BY team_id"
            ),
            {"run": fixture["run"]},
        )).all()
    assert reservation.series_id == fixture["series_x"]
    assert reservation.sequence == 7
    assert len(events) == 2
    assert {event.series_id for event in events} == {fixture["series_x"]}
    assert {event.team_id for event in events} == {fixture["team_a"], fixture["team_b"]}
    assert {(event.elo_before, event.elo_after) for event in events} == {(1000, 1027), (1000, 978)}

    # Inserts remain valid: a fresh reservation (sequence 8, series Y) with a
    # valid pair still commits — the guard is fully functional after the
    # rejected mutations.
    async with session_factory() as session:
        await _reserve(session, fixture, fixture["series_y"], 8)
        await session.execute(
            text(_pair_sql(8)),
            {"run": fixture["run"], "series": fixture["series_y"], "win": fixture["team_d"], "lose": fixture["team_e"]},
        )
        await session.commit()
        reservations = (await session.execute(
            text("SELECT series_id FROM rating_event_sequences WHERE sequence IN (7, 8) ORDER BY sequence")
        )).scalars().all()
    assert list(reservations) == [fixture["series_x"], fixture["series_y"]]
