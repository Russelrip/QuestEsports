"""Two-player match-search API schemas (plan Task 7; API surface §11.1, App. B).

``from`` is aliased to ``from_`` (Pydantic reserved-adjacent name) with
``populate_by_name`` so callers may use either ``"from"`` or ``from_``.
Naive (timezone-less) ``from``/``to`` bounds are interpreted as UTC so the
service's comparisons against Henrik's aware ``started_at`` never raise
``TypeError``. Candidate scores are surfaced from ``teams[].rounds.won`` on
history objects; search never calls match detail, so nothing beyond these
fields is returned. ``affinity`` on a candidate is the compatible search
affinity the history was fetched with — exactly what a later import needs.
Candidates carry both sides of the ID-naming contract (delta D10): the
upstream ``henrik_match_id`` (TEXT, what ``POST /api/v1/matches/import``
takes) plus ``match_id`` — the internal ``matches.id`` UUID, present only
when the match is already imported (null otherwise). Matches already
attached to a series are excluded from discovery entirely.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.players import PlayerResponse


class PlayerRef(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    tag: str = Field(min_length=1, max_length=16)


class TwoPlayerSearchRequest(BaseModel):
    player_a: PlayerRef
    player_b: PlayerRef
    platform: str = Field(default="pc", pattern=r"^(pc|console)$")
    map: str | None = None
    mode: str | None = None
    from_: datetime | None = Field(default=None, alias="from")
    to: datetime | None = None
    page_size: int = Field(default=10, ge=1, le=50)
    # Kept in step with ``Settings.match_search_max_pages``. The service clamps
    # to that setting; this bound only rejects nonsense at the edge, so raising
    # the ceiling here alone never deepens a search on its own.
    max_pages: int = Field(default=1, ge=1, le=10)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("from_", "to")
    @classmethod
    def _attach_utc_to_naive_bounds(cls, value: datetime | None) -> datetime | None:
        """Interpret timezone-naive bounds as UTC (never leave them naive)."""
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class SearchMeta(BaseModel):
    page_size: int
    pages_examined: int


class MatchCandidate(BaseModel):
    match_id: str | None = None  # VAL matches.id (UUID) when already imported, else null
    henrik_match_id: str  # upstream Henrik TEXT id; what a later import takes
    affinity: str  # compatible search affinity; what a later import needs
    map: str | None = None
    started_at: datetime | None = None
    mode: str | None = None
    queue: str | None = None
    is_completed: bool
    red_score: int | None = None
    blue_score: int | None = None
    already_imported: bool


class TwoPlayerSearchResult(BaseModel):
    players: dict[str, PlayerResponse]  # {"a": ..., "b": ...}
    candidates: list[MatchCandidate] = []
    search: SearchMeta
