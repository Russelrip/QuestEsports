"""CLI surface of scripts/verify_runtime_access.py (deployment plan Task 2)."""

import pytest

from scripts.verify_runtime_access import _run


@pytest.mark.asyncio
async def test_probe_run_against_missing_database_fails_cleanly() -> None:
    # _run catches the connection failure internally (that same catch is what
    # --expect-denied mode relies on) and reports it as exit code 1 rather than
    # raising, so the test asserts the returned exit code instead.
    result = await _run(False, "postgresql+asyncpg://nobody:nobody@127.0.0.1:1/nope")
    assert result == 1
