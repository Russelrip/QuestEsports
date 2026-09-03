"""Registration API schemas (SDD 2026-08-14 leaderboard standardization, task 5).

``PreviewRequest`` is the PUUID-only preview body and ``PlayerPreview`` is the
pre-registration snapshot (rank, peak, last played). ``RegistrationRequest`` is
the final submission and ``RegistrationSubmitResponse`` is the
``{success, message, player}`` envelope returned on success — the exact
``valorantsl-new`` shape (R13), so Quest's frontend mapping is unchanged.
"""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class PreviewRequest(BaseModel):
    """PUUID-only preview request body."""

    puuid: str


class RegistrationRequest(BaseModel):
    """Final registration submission.

    ``discord_id`` accepts an int snowflake or a str handle (R16); both are
    coerced to ``str`` before validation so the stored column stays text.
    """

    puuid: str
    discord_id: str
    discord_username: str

    @field_validator("discord_id", mode="before")
    @classmethod
    def _coerce_discord_id(cls, value: object) -> str:
        """Mirror ``valorantsl-new`` ``_coerce_discord_id``: int or str ->
        str, ``None`` -> ""."""
        return str(value) if value is not None else ""


class PlayerPreview(BaseModel):
    """Player preview data before registration (mirrors ``valorantsl-new``)."""

    puuid: str
    name: str
    tag: str
    current_rank: str
    elo: int
    peak_rank: str
    peak_season: str
    last_played: str | None = None


class RegistrationPlayer(BaseModel):
    """The registered player slice echoed in the submit response."""

    puuid: str
    name: str
    tag: str
    current_rank: str
    elo: int


class RegistrationSubmitResponse(BaseModel):
    """Submit result envelope (R13): ``{success, message, player}`` exactly as
    ``valorantsl-new`` returns it."""

    success: bool
    message: str
    player: RegistrationPlayer
