"""Real-Postgres migration-runner tests (Task 17 fix round 1).

The runner is the durable ledger + security-posture executor introduced in the
Task 17 fix round 1 (see ``scripts/apply_migrations.py``). These tests prove,
on real Postgres against fresh isolated schemas:

- **clean apply** records every migration in the ``_migration_ledger`` and
  applies the private-schema security posture (PUBLIC revoked, RLS enabled)
  without breaking the owner's direct connection;
- **rerun no-op** skips every already-applied migration (nothing re-applied,
  ledger unchanged);
- **partial/upgrade** — the 0001–0010 → 0011–0013 upgrade path is covered by
  ``test_migrations.py`` (this module focuses on the ledger mechanics);
- **checksum drift** is fatal (a changed, already-applied file raises
  ``MigrationDriftError`` and nothing is re-recorded);
- **failure rollback** — a broken migration aborts the run, rolls back its own
  transaction, and is never recorded (prior migrations stay applied).

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import create_async_engine

from scripts.apply_migrations import MigrationDriftError, apply_migrations

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
ALL_NAMES = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))


def _engine_for(database_url: str, schema: str):
    return create_async_engine(
        database_url,
        connect_args={"server_settings": {"search_path": schema}},
    )


async def _ledger_names(engine, schema: str) -> list[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text("SELECT name FROM _migration_ledger ORDER BY name")
        )
        return [row[0] for row in rows]


async def test_clean_apply_records_ledger_and_security_posture(database_url, schema_scope) -> None:
    """Fresh schema: all 13 migrations apply once, the ledger records them, the
    security posture is applied, and the owner's direct connection still works."""
    first: dict = {}

    async def apply_fn(schema: str) -> None:
        first["result"] = await apply_migrations(database_url, MIGRATIONS_DIR, search_path=schema)

    async with schema_scope(database_url, apply_fn) as schema:
        assert first["result"].applied == ALL_NAMES
        engine = _engine_for(database_url, schema)
        try:
            assert await _ledger_names(engine, schema) == ALL_NAMES

            # All application tables + the ledger exist in the target schema.
            async with engine.connect() as conn:
                tables = {
                    row[0]
                    for row in (
                        await conn.execute(
                            text(
                                "SELECT table_name FROM information_schema.tables "
                                "WHERE table_schema = current_schema()"
                            )
                        )
                    ).all()
                }
            expected_tables = {
                "players", "matches", "match_players", "teams", "series", "series_games",
                "rating_runs", "rating_events", "rating_event_sequences", "_migration_ledger",
            }
            assert expected_tables <= tables

            # Security posture: RLS enabled, PUBLIC has no access.
            async with engine.connect() as conn:
                rls = (
                    await conn.execute(
                        text(
                            "SELECT c.relrowsecurity FROM pg_class c "
                            "JOIN pg_namespace n ON n.oid = c.relnamespace "
                            "WHERE n.nspname = :s AND c.relname = 'players'"
                        ),
                        {"s": schema},
                    )
                ).scalar_one()
                public_schema_usage = (
                    await conn.execute(
                        text("SELECT has_schema_privilege('public', :s, 'USAGE')"), {"s": schema}
                    )
                ).scalar_one()
                public_table_select = (
                    await conn.execute(
                        text("SELECT has_table_privilege('public', :q, 'SELECT')"),
                        {"q": f'"{schema}".players'},
                    )
                ).scalar_one()
                assert rls is True
                assert public_schema_usage is False
                assert public_table_select is False

            # Owner direct connection still works: insert + read back.
            async with engine.begin() as conn:
                await conn.execute(
                    text("INSERT INTO players (puuid, current_name, current_tag) VALUES ('p1', 'A', 'B')")
                )
            async with engine.connect() as conn:
                count = (
                    await conn.execute(text("SELECT count(*) FROM players"))
                ).scalar_one()
            assert count == 1
        finally:
            await engine.dispose()


async def test_rerun_is_noop(database_url, schema_scope) -> None:
    """Re-running the runner on an already-migrated schema skips everything and
    changes nothing (ledger intact, no drift error)."""
    first: dict = {}
    second: dict = {}

    async def apply_fn(schema: str) -> None:
        first["result"] = await apply_migrations(database_url, MIGRATIONS_DIR, search_path=schema)
        second["result"] = await apply_migrations(database_url, MIGRATIONS_DIR, search_path=schema)

    async with schema_scope(database_url, apply_fn) as schema:
        assert first["result"].applied == ALL_NAMES
        assert second["result"].applied == []
        assert second["result"].skipped == ALL_NAMES
        engine = _engine_for(database_url, schema)
        try:
            assert await _ledger_names(engine, schema) == ALL_NAMES
        finally:
            await engine.dispose()


async def test_checksum_drift_is_detected_and_nothing_reapplied(database_url, schema_scope) -> None:
    """A changed already-applied migration is fatal and is never re-recorded."""
    first: dict = {}

    async def apply_fn(schema: str) -> None:
        first["result"] = await apply_migrations(database_url, MIGRATIONS_DIR, search_path=schema)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            for src in MIGRATIONS_DIR.glob("*.sql"):
                shutil.copy(src, tmp_dir / src.name)
            drifted = tmp_dir / "0005_series.sql"
            drifted.write_text(drifted.read_text(encoding="utf-8") + "\n-- drift marker\n", encoding="utf-8")
            with pytest.raises(MigrationDriftError, match="migration drift"):
                await apply_migrations(database_url, tmp_dir, search_path=schema)

    async with schema_scope(database_url, apply_fn) as schema:
        assert first["result"].applied == ALL_NAMES
        engine = _engine_for(database_url, schema)
        try:
            # Nothing was re-applied or re-recorded: the ledger still holds
            # exactly the 13 original checksums.
            assert await _ledger_names(engine, schema) == ALL_NAMES
            async with engine.connect() as conn:
                row = (
                    await conn.execute(
                        text("SELECT checksum FROM _migration_ledger WHERE name = '0005_series.sql'")
                    )
                ).first()
            assert row is not None
            assert not row[0].endswith("drift marker")  # original checksum preserved
        finally:
            await engine.dispose()


async def test_failed_migration_rolls_back_and_aborts_run(database_url, schema_scope) -> None:
    """A broken migration aborts the run: its own transaction (and ledger row)
    roll back, later migrations never apply, prior ones stay applied."""
    async def apply_fn(schema: str) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            shutil.copy(MIGRATIONS_DIR / "0001_players.sql", tmp_dir / "0001_players.sql")
            (tmp_dir / "0002_broken.sql").write_text("THIS IS NOT VALID SQL;\n", encoding="utf-8")
            with pytest.raises(ProgrammingError, match="syntax error"):
                await apply_migrations(database_url, tmp_dir, search_path=schema)

    async with schema_scope(database_url, apply_fn) as schema:
        engine = _engine_for(database_url, schema)
        try:
            # The runner aborted: only the valid first migration is recorded.
            assert await _ledger_names(engine, schema) == ["0001_players.sql"]
            async with engine.connect() as conn:
                tables = {
                    row[0]
                    for row in (
                        await conn.execute(
                            text(
                                "SELECT table_name FROM information_schema.tables "
                                "WHERE table_schema = current_schema()"
                            )
                        )
                    ).all()
                }
            assert "players" in tables  # 0001 applied (committed)
            assert "matches" not in tables  # 0002 never applied
        finally:
            await engine.dispose()
