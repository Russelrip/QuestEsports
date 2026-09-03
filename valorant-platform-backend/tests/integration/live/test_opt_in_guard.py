"""Live opt-in guard test (Task 17 fix round 1).

A no-network test that proves the opt-in machinery itself works: it is marked
``live`` (deselected by every ``-m "not live"`` run), and when it IS selected
the package's autouse guard skips it unless ``RUN_LIVE_HENRIK=1`` and
``HENRIK_API_KEY`` are both set. The assertion below never touches the network
— it only proves the guard handed the test a usable key.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.live


def test_live_opt_in_guard_provides_key(live_henrik_key: str) -> None:
    """Past the guard, the fixture returns the operator-provided key."""
    assert live_henrik_key
    assert len(live_henrik_key) > 0
