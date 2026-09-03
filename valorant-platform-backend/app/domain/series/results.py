"""Calculated series result derivation (plan Task 12; design §10.3).

Pure, no I/O. ``compute_series_result`` is the authoritative calculated
result: per-game winners are derived from the persisted team-A/team-B round
scores, mapped to team ids, and the team with strictly more map wins is the
calculated winner (``None`` on a tie or an empty series — "no reach").
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.domain.series.bo import GameSnapshot

# Clock-skew tolerance for the future-``played_at`` rejection (review finding
# F1): a ``played_at`` up to this far past "now" is treated as present (clock
# drift), anything beyond it is a future-dated result and rejected.
_PLAYED_AT_FUTURE_TOLERANCE = timedelta(minutes=5)


def is_future_played_at(played_at: datetime) -> bool:
    """True when ``played_at`` lies beyond ``now(UTC)`` + the clock-skew tolerance.

    Every path that accepts a ``played_at`` (manual create, normal finalize,
    draft ``PATCH``) rejects a future-dated result as 422 ``SERIES_INVALID``:
    a future ``played_at`` is invalid data AND, for a RATED series, would brick
    the D8 chronological guard (rated manual series count in
    ``get_latest_finalized_rated_played_at``) for every later rated finalize
    until real time passes the typo'd date.

    A NAIVE ``played_at`` (no offset — the Pydantic ``datetime`` fields on
    ``ManualSeriesRequest``/``UpdateSeriesRequest`` accept one) is normalized
    to UTC before the comparison, so ``naive > aware`` never raises
    ``TypeError`` (review finding N1).
    """
    if played_at.tzinfo is None:
        played_at = played_at.replace(tzinfo=UTC)
    return played_at > datetime.now(UTC) + _PLAYED_AT_FUTURE_TOLERANCE


@dataclass(frozen=True)
class SeriesResult:
    team_a_maps_won: int
    team_b_maps_won: int
    calculated_winner_id: uuid.UUID | None


def compute_series_result(
    games: list[GameSnapshot], team_a_id: uuid.UUID, team_b_id: uuid.UUID
) -> SeriesResult:
    """Per-game winners -> maps won -> calculated winner (None when no reach)."""
    team_a_maps_won = sum(1 for game in games if game.team_a_rounds > game.team_b_rounds)
    team_b_maps_won = sum(1 for game in games if game.team_b_rounds > game.team_a_rounds)

    if team_a_maps_won > team_b_maps_won:
        calculated_winner_id = team_a_id
    elif team_b_maps_won > team_a_maps_won:
        calculated_winner_id = team_b_id
    else:
        calculated_winner_id = None

    return SeriesResult(team_a_maps_won, team_b_maps_won, calculated_winner_id)


# The only maps-won pairs a COMPLETED best-of series can hold, per format.
_MANUAL_VALID_SCORES: dict[str, frozenset[tuple[int, int]]] = {
    "bo1": frozenset({(1, 0), (0, 1)}),
    "bo3": frozenset({(2, 0), (0, 2), (2, 1), (1, 2)}),
    "bo5": frozenset({(3, 0), (0, 3), (3, 1), (1, 3), (3, 2), (2, 3)}),
}


def validate_manual_result(
    *,
    format_: str,
    team_a_id: uuid.UUID,
    team_b_id: uuid.UUID,
    winner_team_id: uuid.UUID,
    team_a_maps_won: int,
    team_b_maps_won: int,
) -> list[str]:
    """Validation errors for a manual (offline/historical) series result.

    Empty list == valid. Pure, no I/O. Checks the winner is one of the two
    series teams, the maps-won pair is reachable for the format, and the winner
    won strictly more maps than the loser — the winner is recorded directly
    (no attached games to derive it from), so an inconsistent score/winner pair
    must be rejected here.
    """
    errors: list[str] = []
    if winner_team_id not in (team_a_id, team_b_id):
        errors.append("winner_team_id must be team_a_id or team_b_id")
    valid_scores = _MANUAL_VALID_SCORES.get(format_)
    if valid_scores is None:
        errors.append(f"unknown format: {format_}")
        return errors
    pair = (team_a_maps_won, team_b_maps_won)
    if pair not in valid_scores:
        errors.append(f"maps won {team_a_maps_won}-{team_b_maps_won} is not a valid {format_} result")
        return errors
    if winner_team_id not in (team_a_id, team_b_id):
        return errors
    if winner_team_id == team_a_id:
        winner_maps, loser_maps = team_a_maps_won, team_b_maps_won
    else:
        winner_maps, loser_maps = team_b_maps_won, team_a_maps_won
    if winner_maps <= loser_maps:
        errors.append("the winner must have won more maps than the loser")
    return errors
