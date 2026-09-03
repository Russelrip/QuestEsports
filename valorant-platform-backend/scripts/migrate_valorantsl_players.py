"""One-time migration: ``valorantsl-new`` Supabase ``public.players`` → ``valorant.leaderboard_players``.

Run-once script (SDD 2026-08-14 leaderboard standardization, task 10; spec §9).
Reads valorantsl-new's ``public.players`` through a dedicated source engine
(DSN from the ``VALORANTSL_SOURCE_DB_DSN`` env var or ``--source-dsn``), dedupes
``discord_username`` keeping the newest row per username (the target column is
unique), maps the source columns onto ``leaderboard_players`` (dropping the
legacy extras), and upserts on ``puuid`` via ``LeaderboardPlayerRepository``.
``rank_details`` is passed through untouched — the dual-shape tolerance is
preserved, never normalized.

Dry-run by default (prints the summary, writes nothing); ``--apply`` writes.
Run once; re-running is idempotent (upsert on ``puuid``).

Usage:
    uv run python -m scripts.migrate_valorantsl_players            # dry run
    uv run python -m scripts.migrate_valorantsl_players --apply    # write
    uv run python -m scripts.migrate_valorantsl_players --source-dsn postgresql://...

Note: ``app.db.session.SessionFactory`` (the target engine) pins its
``search_path`` to the ``valorant`` schema, so the unqualified model tables
resolve there; the source engine qualifies ``public.players`` explicitly.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.db.session import SessionFactory

# --- Column mapping (R41) -------------------------------------------------
# ``SOURCE_COLUMNS`` mirrors valorantsl-new's ``public.players`` (updater/
# database.py Player model). Target columns = SOURCE_COLUMNS - DROPPED_COLUMNS;
# the legacy extras are dropped because ``leaderboard_players`` has no such
# columns. ``last_updated``/``updated_at`` are dropped from the TARGET but still
# read from the source: dedupe_by_discord_username() uses them to pick the
# newest row (``updated_at`` is stamped on write by the repository's ``upsert``,
# so mapping it over would be silently overridden anyway).
SOURCE_COLUMNS = [
    "puuid",
    "name",
    "tag",
    "region",
    "discord_id",
    "discord_username",
    "elo",
    "currenttierpatched",
    "rank_details",
    "peak_rank",
    "seasonal_ranks",
    "match_stats",
    "last_played_match",
    "updated_at",
    "seasonal_extended_at",
    "last_updated",
    "update_source",
    "account_level",
    "card",
    "raw_source",
    "row_created_at",
    "row_updated_at",
]

DROPPED_COLUMNS = [
    "match_stats",
    "account_level",
    "card",
    "raw_source",
    "seasonal_extended_at",
    "last_updated",
    "row_created_at",
    "row_updated_at",
    "updated_at",
]

TARGET_COLUMNS = [column for column in SOURCE_COLUMNS if column not in set(DROPPED_COLUMNS)]


def _to_aware_datetime(value: Any) -> datetime | None:
    """Coerce a datetime, ISO/space string, or None into an aware UTC datetime.

    Verbatim port of valorantsl-new's ``updater/database.py`` ``_to_aware_datetime``
    (lines 52-62): strings parse via ``fromisoformat``, naive datetimes are
    assumed UTC, anything else (including garbage) becomes ``None``.
    """
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value
    return None


def _row_freshness(row: dict) -> datetime:
    """Newest of ``updated_at``/``last_updated`` (aware UTC); rows with neither are oldest."""
    candidates = [
        _to_aware_datetime(row.get("updated_at")),
        _to_aware_datetime(row.get("last_updated")),
    ]
    aware = [value for value in candidates if value is not None]
    return max(aware) if aware else datetime.min.replace(tzinfo=UTC)


def map_to_leaderboard_player(row: dict) -> dict:
    """Map one source ``public.players`` row to a ``leaderboard_players`` dict (R42).

    Pure function (no DB): the returned keys are exactly ``TARGET_COLUMNS``.
    ``rank_details`` is passed through untouched (dual-shape tolerance — never
    normalized); ``last_played_match`` is coerced defensively via
    ``_to_aware_datetime``; ``update_source`` falls back to ``"migration"``;
    ``discord_id`` falls back to ``""``. ``updated_at`` is deliberately NOT
    mapped: the repository's ``upsert`` stamps it (``func.now()``) on write, so
    any carried-over value would be silently overridden.
    """
    return {
        "puuid": row["puuid"],
        "name": row["name"],
        "tag": row["tag"],
        "region": row["region"],
        "discord_id": row.get("discord_id") or "",
        "discord_username": row["discord_username"],
        "elo": row.get("elo"),
        "currenttierpatched": row.get("currenttierpatched"),
        "rank_details": row.get("rank_details") or {},
        "peak_rank": row.get("peak_rank"),
        "seasonal_ranks": row.get("seasonal_ranks"),
        "last_played_match": _to_aware_datetime(row.get("last_played_match")),
        "update_source": row.get("update_source") or "migration",
    }


def dedupe_by_discord_username(rows: list[dict]) -> list[dict]:
    """Keep the newest row per ``discord_username`` (R42; unique-index safety).

    Pure function (no DB). ``leaderboard_players.discord_username`` is unique,
    so every source username must appear at most once in the migrated data —
    rows with empty/``None`` ``discord_username`` form one group (newest kept)
    so the unique index is never violated. Newest = largest
    ``max(updated_at, last_updated)``; rows missing both datetimes sort oldest.
    Group and tie order follow the input row order (deterministic).
    """
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row.get("discord_username") or "", []).append(row)
    return [max(group, key=_row_freshness) for group in groups.values()]


def _as_async_dsn(dsn: str) -> str:
    """Make a postgres DSN asyncpg-compatible.

    Supabase connection strings use the plain sync ``postgresql://`` scheme;
    SQLAlchemy's asyncio extension requires an async driver
    (``postgresql+asyncpg://``). valorantsl-new's own config already uses the
    asyncpg scheme, so both forms work here.
    """
    for prefix in ("postgresql://", "postgres://"):
        if dsn.startswith(prefix):
            return dsn.replace(prefix, "postgresql+asyncpg://", 1)
    return dsn


async def fetch_source_rows(source_dsn: str) -> list[dict]:
    """SELECT every ``public.players`` row from the valorantsl-new source DB (R41).

    Raw SQL: the source table is NOT a model in this repo (the migration is
    one-time), so a dedicated source engine reads it and is disposed afterwards.
    ``SOURCE_COLUMNS`` is a module constant, so the f-string interpolates no
    user input.
    """
    engine = create_async_engine(_as_async_dsn(source_dsn), pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text(f"SELECT {', '.join(SOURCE_COLUMNS)} FROM public.players ORDER BY puuid")
            )
            return [dict(row) for row in result.mappings().all()]
    finally:
        await engine.dispose()


async def migrate(source_dsn: str, *, apply: bool) -> dict:
    """Fetch → dedupe → map → (optional) upsert; returns the run summary (R41).

    ``written`` is 0 unless ``apply`` is true. All upserts share one session and
    one commit: a failure rolls the whole migration back (run-once semantics —
    fail loudly, fix, re-run).
    """
    rows = await fetch_source_rows(source_dsn)
    deduped = dedupe_by_discord_username(rows)
    mapped = [map_to_leaderboard_player(row) for row in deduped]

    written = 0
    if apply:
        session = SessionFactory()
        try:
            repo = LeaderboardPlayerRepository(session)
            for target in mapped:
                await repo.upsert(**target)
                written += 1
            await session.commit()
        finally:
            await session.close()

    return {
        "source_rows": len(rows),
        "deduped_rows": len(deduped),
        "mapped_rows": len(mapped),
        "written": written,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dsn",
        default=os.environ.get("VALORANTSL_SOURCE_DB_DSN"),
        help="valorantsl-new Supabase postgres DSN (defaults to the VALORANTSL_SOURCE_DB_DSN env var)",
    )
    parser.add_argument("--apply", action="store_true", help="write upserts (default is a dry run)")
    args = parser.parse_args()
    if not args.source_dsn:
        parser.error("VALORANTSL_SOURCE_DB_DSN is not set (pass --source-dsn)")

    summary = asyncio.run(migrate(args.source_dsn, apply=args.apply))
    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"[{mode}] source rows: {summary['source_rows']}")
    print(f"[{mode}] deduped rows: {summary['deduped_rows']}")
    print(f"[{mode}] mapped rows: {summary['mapped_rows']}")
    print(f"[{mode}] written: {summary['written']}")
    if not args.apply:
        print("DRY RUN — no writes (pass --apply to upsert)")


if __name__ == "__main__":
    main()
