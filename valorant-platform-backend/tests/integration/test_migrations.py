"""Real-Postgres migration tests (Task 4).

These tests prove the Phase 1 schema created by ``supabase/migrations/0001..0003``
and that the SQLAlchemy models map onto it: the tables exist, the unique
constraints and CHECK constraints are DB-enforced, and the harness (fresh
schema + truncation) keeps every test isolated. Skipped when TEST_DATABASE_URL
is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import shutil
import tempfile
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.models import Match, MatchPlayer, Player
from scripts.apply_migrations import apply_migrations

STARTED_AT = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


def _match(**overrides: object) -> Match:
    """A minimal valid ``matches`` row."""
    defaults: dict[str, object] = {
        "henrik_match_id": str(uuid.uuid4()),
        "affinity": "eu",
        "map_name": "Ascent",
        "started_at": STARTED_AT,
        "is_completed": True,
        "raw_payload": {"metadata": {"match_id": "m"}},
    }
    defaults.update(overrides)
    return Match(**defaults)


def _player(**overrides: object) -> Player:
    defaults: dict[str, object] = {"puuid": str(uuid.uuid4()), "current_name": "A", "current_tag": "B"}
    defaults.update(overrides)
    return Player(**defaults)


def _match_player(**overrides: object) -> MatchPlayer:
    defaults: dict[str, object] = {
        "match_id": uuid.uuid4(),
        "player_id": uuid.uuid4(),
        "puuid_snapshot": "p",
        "name_snapshot": "A",
        "tag_snapshot": "B",
        "side": "red",
    }
    defaults.update(overrides)
    return MatchPlayer(**defaults)


async def test_phase1_tables_exist(session_factory) -> None:
    async with session_factory() as session:
        result = await session.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = current_schema()"
            )
        )
        names = {row[0] for row in result}
    assert {"players", "matches", "match_players"} <= names


async def test_duplicate_henrik_match_id_rejected(session_factory) -> None:
    async with session_factory() as session:
        session.add(_match(henrik_match_id="dupe-1"))
        await session.commit()
        session.add(_match(henrik_match_id="dupe-1"))
        with pytest.raises(IntegrityError, match="duplicate key"):
            await session.commit()


async def test_duplicate_match_player_pair_rejected(session_factory) -> None:
    async with session_factory() as session:
        player = _player()
        session.add(player)
        await session.commit()
        match = _match()
        session.add(match)
        await session.commit()
        session.add(
            _match_player(
                match_id=match.id,
                player_id=player.id,
                puuid_snapshot=player.puuid,
                name_snapshot=player.current_name,
                tag_snapshot=player.current_tag,
                side="red",
            )
        )
        await session.commit()
        session.add(
            _match_player(
                match_id=match.id,
                player_id=player.id,
                puuid_snapshot=player.puuid,
                name_snapshot=player.current_name,
                tag_snapshot=player.current_tag,
                side="blue",
            )
        )
        with pytest.raises(IntegrityError, match="duplicate key"):
            await session.commit()


async def test_invalid_side_rejected(session_factory) -> None:
    async with session_factory() as session:
        player = _player()
        match = _match()
        session.add_all([player, match])
        await session.commit()
        session.add(
            _match_player(
                match_id=match.id,
                player_id=player.id,
                puuid_snapshot=player.puuid,
                name_snapshot=player.current_name,
                tag_snapshot=player.current_tag,
                side="green",
            )
        )
        with pytest.raises(IntegrityError, match="match_players_side_check"):
            await session.commit()


async def test_model_rows_round_trip_through_schema(session_factory) -> None:
    """ORM inserts into the migrated schema and reads back the server defaults."""
    async with session_factory() as session:
        player = _player()
        match = _match()
        session.add_all([player, match])
        await session.commit()
        session.add(
            _match_player(
                match_id=match.id,
                player_id=player.id,
                puuid_snapshot=player.puuid,
                name_snapshot=player.current_name,
                tag_snapshot=player.current_tag,
                side="red",
            )
        )
        await session.commit()

        read_match = await session.get(Match, match.id)
        assert read_match is not None
        assert read_match.created_at is not None  # server_default now() applied
        assert read_match.raw_payload == {"metadata": {"match_id": "m"}}
        assert read_match.platform == "pc"  # server default

        read_player = await session.get(Player, player.id)
        assert read_player is not None
        assert read_player.first_seen_at is not None


async def test_schema_cleanup_runs_on_setup_failure(database_url, schema_scope) -> None:
    """A failing migration during harness setup still drops the fresh schema.

    ``_schema_scope`` (used by the session-scoped ``migrated_schema`` fixture)
    must guarantee cleanup even when the apply/assert step raises before the
    yield. This test drives the same code path with a simulated failure and
    verifies the schema no longer exists afterwards.
    """
    created: dict[str, str] = {}

    async def failing_apply(schema: str) -> None:
        created["schema"] = schema
        raise RuntimeError("simulated migration failure")

    with pytest.raises(RuntimeError, match="simulated migration failure"):
        async with schema_scope(database_url, failing_apply):
            pytest.fail("context body must not run after apply failure")

    assert created["schema"], "apply_fn was never called"
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT count(*) FROM pg_namespace WHERE nspname = :n"),
                {"n": created["schema"]},
            )
            assert result.scalar() == 0
    finally:
        await engine.dispose()


# ------------------------------------------------------------------ upgrade 0011/0012/0013


async def test_upgrade_0011_0012_0013_backfills_application_order_not_played_at(database_url, schema_scope) -> None:
    """fix rounds 3+4+5 (blockers): applying 0011+0012+0013 to a pre-0011
    database backfills ``sequence`` from the persisted APPLICATION proxy — each
    run's series ranked by their earliest event's ``(created_at, id)`` — never
    ``played_at``. Events finalized OUT of played_at order therefore keep their
    true application order after the upgrade, the ``elo_before``/``elo_after``
    chain is preserved, and 0012 backfills the sequence RESERVATIONS from those
    events. Afterwards the deferred pair guard is reservation-aware (a valid
    reserved pair commits; a partial pair cannot) and 0013 makes the
    reservations immutable (UPDATE/DELETE rejected)."""
    migrations_dir = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

    async def apply_pre_0011(schema: str) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            for src in sorted(migrations_dir.glob("*.sql")):
                if src.name < "0011_rating_events_sequence.sql":
                    shutil.copy(src, tmp_dir / src.name)
            applied = (await apply_migrations(database_url, tmp_dir, search_path=schema)).applied
        assert "0011_rating_events_sequence.sql" not in applied

    async with schema_scope(database_url, apply_pre_0011) as schema:
        engine = create_async_engine(
            database_url,
            connect_args={"server_settings": {"search_path": schema}},
        )
        try:
            # Seed a pre-0011 live run with events finalized OUT of played_at
            # order: S3 (played Jan 12) was applied FIRST, then S1 (played Jan
            # 10). created_at records the true application order (t1 < t2).
            t1 = datetime(2026, 1, 5, 10, 0, tzinfo=UTC)
            t2 = datetime(2026, 1, 5, 11, 0, tzinfo=UTC)
            async with engine.begin() as conn:
                run = (await conn.execute(text("SELECT id FROM rating_runs ORDER BY run_number LIMIT 1"))).scalar_one()
                team_a, team_b, team_c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
                s1, s3 = uuid.uuid4(), uuid.uuid4()
                await conn.execute(
                    text("INSERT INTO teams (id, name) VALUES (:a,'A'),(:b,'B'),(:c,'C')"),
                    {"a": team_a, "b": team_b, "c": team_c},
                )
                await conn.execute(
                    text(
                        "INSERT INTO series (id, team_a_id, team_b_id, format, importance, status, played_at, "
                        " calculated_winner_id, official_winner_id, rating_mode, team_a_maps_won, team_b_maps_won) "
                        "VALUES (:s,:a,:b,'bo1','regular','finalized',:played,:a,:a,'normal',1,0)"
                    ),
                    {"s": s1, "a": team_a, "b": team_b, "played": datetime(2026, 1, 10, 12, 0, tzinfo=UTC)},
                )
                await conn.execute(
                    text(
                        "INSERT INTO series (id, team_a_id, team_b_id, format, importance, status, played_at, "
                        " calculated_winner_id, official_winner_id, rating_mode, team_a_maps_won, team_b_maps_won) "
                        "VALUES (:s,:a,:c,'bo1','regular','finalized',:played,:a,:a,'normal',1,0)"
                    ),
                    {"s": s3, "a": team_a, "c": team_c, "played": datetime(2026, 1, 12, 12, 0, tzinfo=UTC)},
                )
                # Pre-0011 events (no sequence column): S3 applied FIRST (t1), S1 second (t2).
                await conn.execute(
                    text(
                        "INSERT INTO rating_events (run_id, series_id, team_id, elo_before, elo_after, elo_change, "
                        " opponent_team_id, result, calculation_details, created_at) VALUES "
                        "(:r,:s3,:a,1000,1027,27,:c,'win','{}'::jsonb,:t1),"
                        "(:r,:s3,:c,1000,978,-22,:a,'loss','{}'::jsonb,:t1),"
                        "(:r,:s1,:a,1027,1054,27,:b,'win','{}'::jsonb,:t2),"
                        "(:r,:s1,:b,1000,971,-29,:a,'loss','{}'::jsonb,:t2)"
                    ),
                    {"r": run, "s1": s1, "s3": s3, "a": team_a, "b": team_b, "c": team_c, "t1": t1, "t2": t2},
                )

            # Apply 0011, 0012, 0013 (the full sequencing + reservation upgrade).
            with tempfile.TemporaryDirectory() as tmp:
                tmp_dir = Path(tmp)
                shutil.copy(migrations_dir / "0011_rating_events_sequence.sql", tmp_dir / "0011_rating_events_sequence.sql")
                shutil.copy(migrations_dir / "0012_rating_event_sequences.sql", tmp_dir / "0012_rating_event_sequences.sql")
                shutil.copy(migrations_dir / "0013_rating_event_sequences_immutable.sql", tmp_dir / "0013_rating_event_sequences_immutable.sql")
                upgrade = await apply_migrations(database_url, tmp_dir, search_path=schema)
            assert "0011_rating_events_sequence.sql" in upgrade.applied
            assert "0012_rating_event_sequences.sql" in upgrade.applied
            assert "0013_rating_event_sequences_immutable.sql" in upgrade.applied

            # The ledger records the FULL 0001–0013 sequence after the upgrade
            # (0001–0010 from the first apply, 0011–0013 from the second), so a
            # later rerun against the full directory is a no-op. Scoped to
            # <= 0013: this test never applies 0014, which lives in the same
            # directory but outside its upgrade path.
            async with engine.begin() as conn:
                ledger_names = [
                    row[0]
                    for row in (await conn.execute(text("SELECT name FROM _migration_ledger ORDER BY name"))).all()
                ]
            assert ledger_names == sorted(
                p.name for p in migrations_dir.glob("*.sql") if p.name <= "0013_rating_event_sequences_immutable.sql"
            )

            # Sequences follow APPLICATION order (S3 = 1, S1 = 2), NOT played_at.
            async with engine.begin() as conn:
                rows = (await conn.execute(
                    text("SELECT series_id, sequence, team_id, elo_before, elo_after FROM rating_events")
                )).all()
            by_series: dict[uuid.UUID, list] = {}
            for series_id, seq, _team_id, _before, _after in rows:
                by_series.setdefault(series_id, []).append((seq, _team_id, _before, _after))
            assert {e[0] for e in by_series[s3]} == {1}  # applied first -> sequence 1
            assert {e[0] for e in by_series[s1]} == {2}  # applied second -> sequence 2

            # elo chain preserved in APPLICATION order: team A's S3 event
            # (1000 -> 1027) precedes its S1 event (1027 -> 1054).
            team_a_events = sorted([r for r in rows if r[2] == team_a], key=lambda r: r[1])
            assert [Decimal(r[3]) for r in team_a_events] == [Decimal(1000), Decimal(1027)]
            assert [Decimal(r[4]) for r in team_a_events] == [Decimal(1027), Decimal(1054)]

            # 0012 backfilled one reservation per (run, series) from the events.
            async with engine.begin() as conn:
                reservations = (await conn.execute(
                    text(
                        "SELECT series_id, sequence FROM rating_event_sequences "
                        "ORDER BY sequence"
                    )
                )).all()
            assert [(s, seq) for s, seq in reservations] == [(s3, 1), (s1, 2)]

            # The deferred pair guard is reservation-aware: a valid RESERVED
            # new pair commits...
            async with engine.begin() as conn:
                team_d, team_e = uuid.uuid4(), uuid.uuid4()
                s2 = uuid.uuid4()
                await conn.execute(
                    text("INSERT INTO teams (id, name) VALUES (:d,'D'),(:e,'E')"),
                    {"d": team_d, "e": team_e},
                )
                await conn.execute(
                    text(
                        "INSERT INTO series (id, team_a_id, team_b_id, format, importance, status, played_at) "
                        "VALUES (:s,:d,:e,'bo1','regular','finalized', now())"
                    ),
                    {"s": s2, "d": team_d, "e": team_e},
                )
                await conn.execute(
                    text(
                        "INSERT INTO rating_event_sequences (run_id, series_id, sequence) "
                        "VALUES (:r,:s,3)"
                    ),
                    {"r": run, "s": s2},
                )
                await conn.execute(
                    text(
                        "INSERT INTO rating_events (run_id, series_id, team_id, sequence, elo_before, "
                        " elo_after, elo_change, opponent_team_id, result, calculation_details) "
                        "VALUES (:r,:s,:d,3,1000,1027,27,:e,'win','{}'::jsonb),"
                        "(:r,:s,:e,3,1000,978,-22,:d,'loss','{}'::jsonb)"
                    ),
                    {"r": run, "s": s2, "d": team_d, "e": team_e},
                )
            # ...and a partial pair cannot commit (fresh series, single event).
            with pytest.raises(Exception, match="exactly two events of one series"):
                async with engine.begin() as conn:
                    team_f, team_g = uuid.uuid4(), uuid.uuid4()
                    s4 = uuid.uuid4()
                    await conn.execute(
                        text("INSERT INTO teams (id, name) VALUES (:f,'F'),(:g,'G')"),
                        {"f": team_f, "g": team_g},
                    )
                    await conn.execute(
                        text(
                            "INSERT INTO series (id, team_a_id, team_b_id, format, importance, status, played_at) "
                            "VALUES (:s,:f,:g,'bo1','regular','finalized', now())"
                        ),
                        {"s": s4, "f": team_f, "g": team_g},
                    )
                    await conn.execute(
                        text(
                            "INSERT INTO rating_event_sequences (run_id, series_id, sequence) "
                            "VALUES (:r,:s,6)"
                        ),
                        {"r": run, "s": s4},
                    )
                    await conn.execute(
                        text(
                            "INSERT INTO rating_events (run_id, series_id, team_id, sequence, elo_before, "
                            " elo_after, elo_change, opponent_team_id, result, calculation_details) "
                            "VALUES (:r,:s,:f,6,1000,1027,27,:g,'win','{}'::jsonb)"
                        ),
                        {"r": run, "s": s4, "f": team_f, "g": team_g},
                    )

            # 0013 makes reservations immutable after the upgrade: reassigning
            # the backfilled reservation (UPDATE) and deleting it (DELETE) both
            # fail; the backfilled events remain intact.
            with pytest.raises(Exception, match="immutable"):
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "UPDATE rating_event_sequences SET series_id = :other "
                            "WHERE run_id = :r AND sequence = 1"
                        ),
                        {"other": s1, "r": run},
                    )
            with pytest.raises(Exception, match="immutable"):
                async with engine.begin() as conn:
                    await conn.execute(
                        text("DELETE FROM rating_event_sequences WHERE run_id = :r AND sequence = 1"),
                        {"r": run},
                    )
            async with engine.begin() as conn:
                reservations = (await conn.execute(
                    text(
                        "SELECT series_id, sequence FROM rating_event_sequences "
                        "ORDER BY sequence"
                    )
                )).all()
                events = (await conn.execute(
                    text("SELECT count(*) FROM rating_events")
                )).scalar_one()
            assert [(s, seq) for s, seq in reservations] == [(s3, 1), (s1, 2), (s2, 3)]
            assert events == 6  # S3/S1 backfilled pair + S2 valid pair (the partial pair rolled back)
        finally:
            await engine.dispose()
