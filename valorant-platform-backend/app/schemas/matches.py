"""Match import + Match Library API schemas (plan Tasks 8–9; API surface §11.1, App. B).

``MatchImportRequest`` pins a UUID-ish ``match_id`` (hex + hyphens, 8–64
chars) so malformed identifiers are rejected before any upstream call; the
service re-validates the same shape so direct callers get the stable
``INVALID_RIOT_ID`` error. ``MatchDetailResponse`` mirrors the normalized
``matches`` + ``match_players`` columns (scores/winner derived at import time);
``raw_payload_available`` reports that the full upstream detail envelope is
retained, while ``raw_payload`` (the content itself) is only ever echoed when
``Settings.raw_payload_in_responses`` opts in (design §14.3). When it is not
set the key is *omitted* from serialization entirely — never ``null`` (fix
round 1). ``MatchListResponse`` is the Match Library list surface: filterable,
keyset-paginated summaries.

``MatchImportRequest.match_id`` is the canonical Henrik TEXT id (never the
internal ``matches.id`` UUID); ``MatchDetailResponse.id`` is the internal UUID
that attach endpoints accept. Do not conflate the two (spec §4.4 D10).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_serializer


class MatchImportRequest(BaseModel):
    match_id: str = Field(
        min_length=8,
        max_length=64,
        pattern=r"^[0-9a-fA-F-]+$",
        description="The canonical Henrik match ID (text id). NOT the internal matches.id UUID.",
    )
    affinity: str = "eu"
    refresh: bool = False


class MatchPlayerResponse(BaseModel):
    """A participant snapshot at match time (identity + optional stats)."""

    id: uuid.UUID
    player_id: uuid.UUID
    puuid: str
    name: str
    tag: str
    side: str
    agent_id: str | None = None
    agent_name: str | None = None
    score_total: int | None = None
    kills: int | None = None
    deaths: int | None = None
    assists: int | None = None
    damage_dealt: int | None = None
    damage_received: int | None = None
    headshots: int | None = None
    bodyshots: int | None = None
    legshots: int | None = None


class MatchDetailResponse(BaseModel):
    id: uuid.UUID = Field(
        description="Internal VAL match UUID (matches.id); series attach accepts this, not henrik_match_id."
    )
    henrik_match_id: str
    affinity: str
    platform: str
    map_id: str | None = None
    map_name: str
    mode: str | None = None
    queue: str | None = None
    started_at: datetime
    duration_ms: int | None = None
    is_completed: bool
    red_score: int | None = None
    blue_score: int | None = None
    winning_side: str | None = None
    game_version: str | None = None
    players: list[MatchPlayerResponse] = []
    raw_payload_available: bool
    raw_payload: dict | None = None

    @model_serializer(mode="wrap")
    def _serialize_omitting_unset_raw_payload(self, handler):
        """Omit ``raw_payload`` when it is ``None`` (default/opt-out state).

        The opt-in response includes the content verbatim; every other response
        shape stays identical but never emits a ``"raw_payload": null`` key.
        """
        data = handler(self)
        if data.get("raw_payload") is None:
            data.pop("raw_payload", None)
        return data


class MatchSummaryResponse(BaseModel):
    """A Match Library list item: full match metadata without participant
    snapshots and without raw payload content (the availability flag only)."""

    id: uuid.UUID
    henrik_match_id: str
    affinity: str
    platform: str
    map_id: str | None = None
    map_name: str
    mode: str | None = None
    queue: str | None = None
    started_at: datetime
    duration_ms: int | None = None
    is_completed: bool
    red_score: int | None = None
    blue_score: int | None = None
    winning_side: str | None = None
    game_version: str | None = None
    raw_payload_available: bool


class MatchListResponse(BaseModel):
    items: list[MatchSummaryResponse]
    next_cursor: uuid.UUID | None = None
    total: int | None = None


class MatchImportResponse(BaseModel):
    match: MatchDetailResponse
    created: bool
