"""Live-test opt-in guard (plan App. D; Task 17 fix round 1).

Live tests are opt-in by design: they hit the real Henrik API and consume rate
units, so nothing here runs unless the operator explicitly enables it.

The autouse module-scoped guard below is the single safety net for the whole
package: it skips every live test unless BOTH ``RUN_LIVE_HENRIK=1`` and
``HENRIK_API_KEY`` are set. Combined with the ``live`` pytest marker
(``pyproject.toml``), the documented command
``uv run pytest -m "not live" -q`` deselects this package entirely, so the
standard and real-Postgres suites never collect a live test and never touch the
network. ``pytest -m live`` (or a bare ``pytest``) selects it, and the guard
still skips without the opt-in environment.
"""

from __future__ import annotations

import os

import pytest

_RUN_LIVE = os.environ.get("RUN_LIVE_HENRIK") == "1"
_API_KEY = os.environ.get("HENRIK_API_KEY") or ""


@pytest.fixture(autouse=True, scope="module")
def _live_opt_in_guard() -> None:
    """Skip the whole module unless the operator explicitly opted in.

    Both conditions are required so a stale ``HENRIK_API_KEY`` in the
    environment can never accidentally enable live tests by itself.
    """
    if not (_RUN_LIVE and _API_KEY):
        pytest.skip("live tests require both RUN_LIVE_HENRIK=1 and HENRIK_API_KEY")


@pytest.fixture
def live_henrik_key() -> str:
    """The operator-provided Henrik key (guaranteed present past the guard).

    Live tests use this key with small ``size=1`` pages only (rate-limit
    etiquette; see docs/henrik-integration-notes.md).
    """
    assert _RUN_LIVE and _API_KEY, "live opt-in guard must run first"
    return _API_KEY
