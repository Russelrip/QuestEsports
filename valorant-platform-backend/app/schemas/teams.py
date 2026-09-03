"""Team API schemas (plan Task 11; design §9.1, API surface §11.4)."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    short_name: str | None = Field(default=None, max_length=16)
    slug: str | None = Field(default=None, max_length=64)
    logo_url: str | None = None
    quest_saved_team_id: str | None = Field(default=None, max_length=64)
    seeding_elo: Decimal | None = None  # legacy compatibility; never a rating input

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name must not be blank")
        return cleaned

    @field_validator("short_name", "slug")
    @classmethod
    def _strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    short_name: str | None = Field(default=None, max_length=16)
    slug: str | None = Field(default=None, max_length=64)
    logo_url: str | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name must not be blank")
        return cleaned

    @field_validator("short_name", "slug")
    @classmethod
    def _strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class TeamResponse(BaseModel):
    id: uuid.UUID
    name: str
    short_name: str | None = None
    slug: str | None = None
    quest_saved_team_id: str | None = None
    logo_url: str | None = None
    current_elo: Decimal
    peak_elo: Decimal
    seeding_elo: Decimal | None = None
    matches_played: int
    series_wins: int
    series_losses: int
    is_active: bool
