"""Pure rating domain (plan Task 14; design §10.3).

Rating policy resolution: the calculated-vs-official winner separation and the
explicit rating modes (``normal | forfeit_no_rating | forfeit_result_only |
manual_override``). No I/O — the finalization service (Task 15) consumes
``resolve_rating_policy`` with persisted series state.
"""

from app.domain.ratings.policy import (
    RATING_MODES,
    RatingPolicyDecision,
    RatingPolicyError,
    RatingPolicyRequiredError,
    resolve_rating_policy,
)

__all__ = [
    "RATING_MODES",
    "RatingPolicyDecision",
    "RatingPolicyError",
    "RatingPolicyRequiredError",
    "resolve_rating_policy",
]
