"""Rankings API schemas (plan Task 16; API surface §11.4, design §13.4).

``RankingEntry`` is the standings row; ``RebuildResult`` reports the new
versioned run a rebuild created. The rating-history response reuses
``RatingEventResponse`` from ``app.schemas.series`` (the Task 15 schema) so the
finalize response and the history read never diverge.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel


class RankingEntry(BaseModel):
    """One ranked team in the current standings.

    ``rank`` is the 1-based position after sorting ``current_elo DESC`` (ties
    broken by name, then id, for a deterministic order).
    """

    rank: int
    team_id: uuid.UUID
    name: str
    short_name: str | None = None
    current_elo: Decimal
    peak_elo: Decimal
    series_wins: int
    series_losses: int
    matches_played: int


class RebuildResult(BaseModel):
    """The outcome of a ``rebuild_rankings()`` invocation.

    A new ``rating_runs`` row (``run_id``/``run_number``) was created and every
    eligible finalized series was replayed into it; prior runs' events are
    untouched (immutable audit, ADR-007).
    """

    run_id: uuid.UUID
    run_number: int
    note: str | None = None
    series_count: int
    event_count: int
    teams_reset: int
