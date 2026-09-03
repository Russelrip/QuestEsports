"""Async engine, session factory, and FastAPI session dependency.

The engine is built lazily-free from ``DATABASE_URL`` at import time (no
connection is opened until first use, so importing this module never requires
a live database). Every connection pins its ``search_path`` to the private
application schema (``app.config.APP_DB_SCHEMA`` = ``valorant``), which the
migration runner creates and migrates (Task 17 fix round 1; ADR-001) — the
unqualified table names in the models resolve inside that schema. Repository/
service layers receive sessions from ``SessionFactory``; FastAPI routes use the
``get_session`` dependency.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import APP_DB_SCHEMA, get_settings
from app.db.tls import database_connect_args

settings = get_settings()
engine: AsyncEngine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args=database_connect_args(settings, search_path=APP_DB_SCHEMA),
)
SessionFactory: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped async session."""
    async with SessionFactory() as session:
        yield session
