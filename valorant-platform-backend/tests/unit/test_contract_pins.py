"""Wave 0 contract pins (design §19.3 U1–U7; plan Appendix E).

Every pin in ``app/integrations/henrik/contract.py`` must be present and valid.
Live-only facts (U1 auth scheme, U4 exact first offset, U5 custom-mode literal)
that could not be verified in this session are represented by the documented
fallback values; assertions encode the fallback invariants so Task 5 mapper
behavior stays deterministic.
"""

from app.integrations.henrik.contract import (
    AUTH_SCHEME_PINNED,
    CUSTOM_MODE_LITERAL,
    FIRST_PAGE_START,
    HENRIK_QUEUE_PARAM,
    SIDE_LITERAL_MAP,
)


def test_auth_scheme_pinned_is_valid_form():
    """U1 — auth header form: bare or Bearer, never empty."""
    assert isinstance(AUTH_SCHEME_PINNED, str)
    assert AUTH_SCHEME_PINNED in {"bare", "Bearer"}


def test_first_page_start_is_safe():
    """U4 — first pagination offset must be one of the contract representations:
    -1 (omission), 0, or 1. Any other value is not a valid pin."""
    assert isinstance(FIRST_PAGE_START, int)
    assert FIRST_PAGE_START in {-1, 0, 1}


def test_side_literal_map_is_nonempty_and_normalizes_red_blue():
    """U2 — side literals map non-empty; Red/Blue fallback pins normalize to lowercase."""
    assert isinstance(SIDE_LITERAL_MAP, dict)
    assert len(SIDE_LITERAL_MAP) > 0
    assert SIDE_LITERAL_MAP["Red"] == "red"
    assert SIDE_LITERAL_MAP["Blue"] == "blue"


def test_custom_mode_literal_none_or_nonempty():
    """U5 — custom-mode literal: verified literal, or None (local filter fallback)."""
    assert CUSTOM_MODE_LITERAL is None or (
        isinstance(CUSTOM_MODE_LITERAL, str) and len(CUSTOM_MODE_LITERAL) > 0
    )


def test_queue_param_never_sent():
    """U3 — the undocumented ``queue`` param is pinned to None; never serialized."""
    assert HENRIK_QUEUE_PARAM is None
