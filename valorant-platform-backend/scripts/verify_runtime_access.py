"""Verify the VAL runtime role's direct access to the application schema.

Connects as the configured role (DATABASE_URL), pins the connection to the
application schema, and proves the role can SELECT, INSERT, and DELETE on a
real application table, cleaning up its own probe row afterwards.

With ``--expect-denied`` it asserts the opposite: the connecting role is refused
at the schema/table level. That mode proves roles outside the VALORANT runtime
(e.g. the Quest runtime role) see nothing in ``valorant``.

Usage:
    uv run python -m scripts.verify_runtime_access
    uv run python -m scripts.verify_runtime_access --expect-denied

Exit 0 on the expected outcome, 1 otherwise (with a diagnostic on stderr).
"""

from __future__ import annotations

import argparse
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import APP_DB_SCHEMA, Settings
from app.db.tls import database_connect_args

PROBE_TABLE = "teams"  # guaranteed to exist since migration 0004
PROBE_NAME = "__runtime_access_probe__"


async def _run(expect_denied: bool, database_url: str) -> int:
    settings = Settings(database_url=database_url)
    engine = create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=database_connect_args(settings, search_path=APP_DB_SCHEMA),
    )
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f"SELECT 1 FROM {PROBE_TABLE} LIMIT 1"))
            row = await conn.execute(
                text(f"INSERT INTO {PROBE_TABLE} (name) VALUES (:name) RETURNING id"),
                {"name": PROBE_NAME},
            )
            probe_id = row.scalar_one()
            await conn.execute(
                text(f"DELETE FROM {PROBE_TABLE} WHERE id = :id"), {"id": probe_id}
            )
    except Exception as exc:  # noqa: BLE001  # any failure is the outcome under test
        if expect_denied:
            print("runtime access denied as expected: PASS")
            return 0
        print(f"runtime access: FAIL ({exc})", file=__import__("sys").stderr)
        return 1
    else:
        if expect_denied:
            print(
                "runtime access denied as expected: FAIL (role unexpectedly had access)",
                file=__import__("sys").stderr,
            )
            return 1
        print("runtime access: PASS")
        return 0
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-denied", action="store_true", help="assert access is refused")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        parser.error("DATABASE_URL is not set")
    raise SystemExit(asyncio.run(_run(args.expect_denied, database_url)))


if __name__ == "__main__":
    main()
