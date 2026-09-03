"""Series API schemas (plan Task 12/15; design §10.3, API surface §11.2).

``AttachGameRequest.match_id`` is the internal VAL match UUID (``matches.id``),
NOT the Henrik TEXT id; import/display of matches use the Henrik text id
(``henrik_match_id``). Do not conflate the two (spec §4.4 D10).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.match_search import PlayerRef

# The locked, explicit rating modes (plan Task 14; design §10.3). Kept in sync
# with ``app.domain.ratings.policy.RATING_MODES`` (asserted by the policy tests).
# D4 (spec §4.4) added ``unrated`` for the Quest integration.
RatingMode = Literal["normal", "unrated", "forfeit_no_rating", "forfeit_result_only", "manual_override"]


class SeriesCreate(BaseModel):
    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    format: Literal["bo1", "bo3", "bo5"]
    importance: Literal["regular", "playoff", "finals"]
    played_at: datetime | None = None
    notes: str | None = None
    external_quest_series_id: str | None = Field(default=None, max_length=64)
    # D6 (spec §4.4/§5.3): anchor Riot IDs resolved to PUUIDs at create and
    # persisted on the series; rated finalization requires them on opposing
    # sides of every attached game.
    anchor_player_a: PlayerRef | None = None
    anchor_player_b: PlayerRef | None = None


class AttachGameRequest(BaseModel):
    match_id: uuid.UUID = Field(
        description="Internal VAL match UUID (matches.id) — NOT the Henrik text match_id used by /matches/import."
    )
    game_number: int = Field(ge=1)
    team_a_side: Literal["red", "blue"] | None = Field(
        default=None,
        description="Red/Blue side for team A; omitted (None) derives it from the series' "
        "anchor players on the match (both anchors required on opposing sides).",
    )


class UpdateGameRequest(BaseModel):
    game_number: int | None = Field(default=None, ge=1)
    team_a_side: Literal["red", "blue"] | None = None


class UpdateSeriesRequest(BaseModel):
    """Draft-only series mutation: update ``played_at`` and nothing else.

    Only the ``played_at`` field may change on this endpoint; a finalized
    series rejects the mutation with 409 ``SERIES_ALREADY_FINALIZED`` (all
    other series mutations keep the same draft gate).
    """

    played_at: datetime


class SetGameOrderItem(BaseModel):
    game_id: uuid.UUID
    game_number: int = Field(ge=1)


class SetGameOrderRequest(BaseModel):
    games: list[SetGameOrderItem] = Field(min_length=1)


class GameView(BaseModel):
    id: uuid.UUID
    game_number: int
    match_id: uuid.UUID
    map_name: str | None = None
    team_a_side: str
    team_b_side: str
    team_a_rounds: int
    team_b_rounds: int
    winner_team_id: uuid.UUID | None = None


class SeriesPreview(BaseModel):
    """Recomputed BO validity, map counts, and calculated winner with no writes.

    ``valid`` is the derived 'ready' signal (``preview.valid == true``); when
    the series is not ready, ``errors`` carries the stable, deterministic
    validation messages. Map counts and the calculated winner are always
    recomputed from the attached games, even for invalid shapes.
    """

    valid: bool
    team_a_maps_won: int
    team_b_maps_won: int
    calculated_winner_id: uuid.UUID | None = None
    games: list[GameView] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class FinalizeRequest(BaseModel):
    """Finalization inputs (plan Task 14; design §10.3, §11.2).

    The official winner defaults to the calculated winner. A differing official
    winner requires a non-empty ``override_reason`` AND an explicit
    ``rating_mode`` — an ambiguous override/forfeit refuses ELO finalization
    (409 ``RATING_POLICY_REQUIRED``). The finalization transaction itself is
    Task 15; this schema makes the policy explicit for it.
    """

    official_winner_id: uuid.UUID | None = None
    override_reason: str | None = None
    rating_mode: RatingMode | None = None


class ManualSeriesRequest(BaseModel):
    """A manual (offline/historical) series result — no API/discovery flow.

    The admin records the winner and per-team map counts directly (no anchors,
    no attached games). ``rating_mode="normal"`` applies ELO under the current
    rating run; ``"unrated"`` records the result only. The nullable unique
    ``external_quest_series_id`` makes retries idempotent: a retry with the
    same key converges on the existing finalized series and never re-applies
    ELO.
    """

    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    format: Literal["bo1", "bo3", "bo5"]
    played_at: datetime
    rating_mode: Literal["normal", "unrated"]
    winner_team_id: uuid.UUID
    team_a_maps_won: int = Field(ge=0)
    team_b_maps_won: int = Field(ge=0)
    external_quest_series_id: str | None = Field(default=None, max_length=64)


class RatingEventResponse(BaseModel):
    """One immutable per-team rating event for a finalized series.

    ``calculation_details`` records the resolved policy (mode + override) and
    the raw unrounded ELO inputs/outputs (ADR-013/ADR-014). ``sequence`` is the
    stable per-run application/replay order the rating-history read sorts by
    (Task 16 fix round 2) — both team events of a series share one value.
    Shared with the Task 16 rating-history read; defined here because Task 15's
    finalize response consumes it.
    """

    id: uuid.UUID
    run_id: uuid.UUID
    series_id: uuid.UUID
    team_id: uuid.UUID
    opponent_team_id: uuid.UUID
    result: Literal["win", "loss"]
    elo_before: Decimal
    elo_after: Decimal
    elo_change: Decimal
    sequence: int
    k_factor: Decimal | None = None
    expected_score: Decimal | None = None
    performance_multiplier: Decimal | None = None
    importance_multiplier: Decimal | None = None
    upset_bonus: Decimal | None = None
    calculation_details: dict = Field(default_factory=dict)
    created_at: datetime


class FinalizeResult(BaseModel):
    """The finalization outcome (plan Task 15; design §11.2).

    ``status`` is ``"finalized"``. ``events`` carries one immutable rating
    event per rated team (empty for the forfeit modes); ``rating_mode`` and the
    winners/override are echoed from the resolved policy so every finalization
    is auditable from the response alone.
    """

    series_id: uuid.UUID
    status: str  # "finalized"
    calculated_winner_id: uuid.UUID | None = None
    official_winner_id: uuid.UUID | None = None
    winner_override_reason: str | None = None
    rating_mode: str | None = None
    events: list[RatingEventResponse] = Field(default_factory=list)
    team_a_current_elo: Decimal
    team_b_current_elo: Decimal
    # Manual-result fields (0016): set only when the series was recorded through
    # POST /api/v1/series/manual — NULL on the normal finalize path.
    manual_winner_team_id: uuid.UUID | None = None
    manual_team_a_maps: int | None = None
    manual_team_b_maps: int | None = None


class SeriesView(BaseModel):
    id: uuid.UUID
    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    format: str
    importance: str
    status: str  # draft | finalized
    calculated_winner_id: uuid.UUID | None = None
    official_winner_id: uuid.UUID | None = None
    winner_override_reason: str | None = None
    team_a_maps_won: int
    team_b_maps_won: int
    played_at: datetime | None = None
    finalized_at: datetime | None = None
    # The persisted resolved rating policy mode (draft rows: None) — makes
    # forfeit_no_rating vs forfeit_result_only auditable after finalization.
    rating_mode: str | None = None
    # Manual-result fields (0016): set only for manual (offline/historical)
    # series recorded via POST /api/v1/series/manual.
    manual_winner_team_id: uuid.UUID | None = None
    manual_team_a_maps: int | None = None
    manual_team_b_maps: int | None = None
    notes: str | None = None
    games: list[GameView] = Field(default_factory=list)
    external_quest_series_id: str | None = None


class SeriesMatchSummary(BaseModel):
    """A ``GET /api/v1/matches`` list-item shape (id, henrik_match_id, affinity,
    platform, map_name, mode, queue, started_at, is_completed, red_score,
    blue_score, winning_side) PLUS ``anchor_a_side`` — the side the series'
    ``anchor_a_puuid`` played on that match. Items come from
    ``GET /api/v1/series/{series_id}/matches``: imported matches where both
    anchor players appear in ``match_players`` (by ``puuid_snapshot``) on
    opposing sides."""

    id: uuid.UUID
    henrik_match_id: str
    affinity: str
    platform: str
    map_name: str
    mode: str | None = None
    queue: str | None = None
    started_at: datetime
    is_completed: bool
    red_score: int | None = None
    blue_score: int | None = None
    winning_side: str | None = None
    # Always one of "red"/"blue" (the DB CHECK-constrained ``side`` column the
    # value derives from); typed ``str`` like ``GameView.team_a_side``.
    anchor_a_side: str


class SeriesMatchesResponse(BaseModel):
    matches: list[SeriesMatchSummary] = Field(default_factory=list)
