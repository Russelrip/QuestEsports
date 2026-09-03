"""Player API schemas (plan Task 6; API surface §11)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class PlayerResolveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9 _.-]+$")
    tag: str = Field(min_length=1, max_length=16, pattern=r"^[A-Za-z0-9#_-]+$")


class PlayerResponse(BaseModel):
    id: uuid.UUID
    puuid: str
    name: str
    tag: str
    affinity: str | None = None
    platforms: list[str] = []
