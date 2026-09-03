"""Pydantic request/response schemas for the API surface."""

from app.schemas.match_search import (
    MatchCandidate,
    PlayerRef,
    SearchMeta,
    TwoPlayerSearchRequest,
    TwoPlayerSearchResult,
)
from app.schemas.matches import (
    MatchDetailResponse,
    MatchImportRequest,
    MatchImportResponse,
    MatchPlayerResponse,
)
from app.schemas.players import PlayerResolveRequest, PlayerResponse
from app.schemas.teams import TeamCreate, TeamResponse, TeamUpdate

__all__ = [
    "MatchCandidate",
    "MatchDetailResponse",
    "MatchImportRequest",
    "MatchImportResponse",
    "MatchPlayerResponse",
    "PlayerRef",
    "PlayerResolveRequest",
    "PlayerResponse",
    "SearchMeta",
    "TeamCreate",
    "TeamResponse",
    "TeamUpdate",
    "TwoPlayerSearchRequest",
    "TwoPlayerSearchResult",
]
