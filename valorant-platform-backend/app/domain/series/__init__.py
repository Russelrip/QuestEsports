"""Pure series domain rules (plan Task 12; design §10.2–10.3).

Best-of validation (``bo``), side mapping (``sides``), and calculated-result
derivation (``results``). No I/O — consumers (the series service, preview) call
these with persisted state.
"""

from app.domain.series.bo import (
    FORMAT_MAX_GAMES,
    FORMAT_REQUIRED_WINS,
    CanonicalGameSnapshot,
    GameSnapshot,
    is_clinched,
    validate_draft_state,
    validate_series_games,
)
from app.domain.series.results import SeriesResult, compute_series_result
from app.domain.series.sides import OPPOSITE_SIDE, resolve_sides, validate_side_literal

__all__ = [
    "FORMAT_MAX_GAMES",
    "FORMAT_REQUIRED_WINS",
    "OPPOSITE_SIDE",
    "CanonicalGameSnapshot",
    "GameSnapshot",
    "SeriesResult",
    "compute_series_result",
    "is_clinched",
    "resolve_sides",
    "validate_draft_state",
    "validate_series_games",
    "validate_side_literal",
]
