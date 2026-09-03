"""Real-Postgres integration harness (Task 4).

SQLite is never used. The harness requires ``TEST_DATABASE_URL`` (asyncpg URL);
when it is unset every integration test skips (``pytest.skip``) so the
non-live suite stays runnable without a database.

Layout (Appendix D of the implementation plan):

- ``migrated_schema`` (session-scoped): creates a fresh, uniquely named schema
  and applies every ``supabase/migrations/*.sql`` file there in filename order
  via ``scripts.apply_migrations``. The schema is dropped on session teardown.
- ``test_engine`` (function-scoped): an engine bound to the migrated schema
  through per-connection ``search_path``, so models/unqualified SQL resolve
  inside the isolated schema.
- ``clean_tables`` (function-scoped): truncates the known tables that exist in
  the migrated schema between tests (the Phase 2 tables may not exist yet, so
  only tables actually present are truncated — in FK-safe parent/child order).
- ``session_factory`` (function-scoped): an ``async_sessionmaker`` over the
  test engine, ready for tests to insert/query through the ORM models.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from scripts.apply_migrations import apply_migrations

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = PROJECT_ROOT / "supabase" / "migrations"

# Tables truncated between tests, parents last (children first). Only tables
# that already exist in the migrated schema are truncated (Phase 2 tables land
# in Tasks 11/12/15 and will be covered automatically once present).
TRUNCATE_ORDER = (
    "rating_events",
    "rating_event_sequences",
    "rating_runs",
    "series_games",
    "series",
    "teams",
    "match_players",
    "matches",
    "players",
    "leaderboard_players",
)


@pytest.fixture(scope="session")
def database_url() -> str:
    """Skip the whole integration module when TEST_DATABASE_URL is unset."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set")
    return TEST_DATABASE_URL


@asynccontextmanager
async def _schema_scope(database_url: str, apply_fn) -> AsyncIterator[str]:
    """Create a fresh, uniquely named schema, run ``apply_fn(schema)``, yield,
    and guarantee the schema is dropped afterwards — including when schema
    creation, ``apply_fn``, or the assertion inside it raises before the yield.
    """
    schema = f"it_{uuid.uuid4().hex[:10]}"
    try:
        admin = create_async_engine(database_url)
        try:
            async with admin.begin() as conn:
                await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        finally:
            await admin.dispose()
        await apply_fn(schema)
        yield schema
    finally:
        admin = create_async_engine(database_url)
        try:
            async with admin.begin() as conn:
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        finally:
            await admin.dispose()


@pytest.fixture
def schema_scope():
    """Expose the schema lifecycle helper so tests can prove cleanup behavior."""
    return _schema_scope


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def migrated_schema(database_url: str) -> AsyncIterator[str]:
    """Create a fresh schema, apply all migrations there, drop it afterwards."""

    async def apply_all(schema: str) -> None:
        result = await apply_migrations(database_url, MIGRATIONS_DIR, search_path=schema)
        missing = {
            "0001_players.sql",
            "0002_matches.sql",
            "0003_match_players.sql",
            "0004_teams.sql",
        } - set(result.applied)
        assert not missing, f"migration runner did not apply: {sorted(missing)}"

    async with _schema_scope(database_url, apply_all) as schema:
        yield schema


def _engine_for_schema(database_url: str, schema: str) -> AsyncEngine:
    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"server_settings": {"search_path": schema}},
    )


async def _truncate_existing(engine: AsyncEngine) -> None:
    """Truncate the known tables that exist in the connection's schema.

    ``rating_runs`` is versioned fixture data: migration ``0007`` seeds the
    initial (live) run that every finalization writes under. Truncation removes
    it, so the harness re-seeds it afterwards — finalization must always have a
    current run (the seed is never part of per-test state).
    """
    async with engine.begin() as conn:
        result = await conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
        )
        existing = {row[0] for row in result}
        to_truncate = [name for name in TRUNCATE_ORDER if name in existing]
        if to_truncate:
            await conn.execute(text(f"TRUNCATE TABLE {', '.join(to_truncate)}"))
        if "rating_runs" in existing:
            await conn.execute(text("INSERT INTO rating_runs (note) VALUES ('initial live run')"))


@pytest_asyncio.fixture
async def test_engine(database_url: str, migrated_schema: str) -> AsyncIterator[AsyncEngine]:
    """Function-scoped engine bound to the migrated schema."""
    engine = _engine_for_schema(database_url, migrated_schema)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def clean_tables(test_engine: AsyncEngine) -> AsyncIterator[None]:
    """Truncate the migrated tables before each test."""
    await _truncate_existing(test_engine)
    yield


@pytest_asyncio.fixture
async def session_factory(
    clean_tables: None, test_engine: AsyncEngine
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """An ORM session factory over the clean, migrated schema."""
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    yield factory
