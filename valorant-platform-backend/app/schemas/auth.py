"""Auth API schemas (SDD 2026-08-14 leaderboard standardization, task 6).

The Discord OAuth callback returns the ``{user, exists, existing_data}``
envelope exactly as ``valorantsl-new`` shapes it (R13), and the
check-discord/check-puuid responses always carry an explicit ``user`` key —
``null`` on a miss (R22) — so the frontend can rely on the field existing.
"""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class DiscordLoginResponse(BaseModel):
    """The Discord OAuth authorize URL the frontend redirects to."""

    url: str


class DiscordCallbackUser(BaseModel):
    """The authenticated Discord user slice returned by the callback.

    ``discord_id`` is the snowflake coerced to ``str`` (R16); the optional
    fields mirror Discord's ``/users/@me`` payload (``discriminator`` defaults
    to ``"0"`` on Discord's side, ``avatar``/``email`` can be absent).
    """

    discord_id: str
    discord_username: str
    discord_discriminator: str | None = None
    discord_avatar: str | None = None
    discord_email: str | None = None
    access_token: str | None = None


class DiscordExistingData(BaseModel):
    """The already-registered player's data, when the Discord user exists."""

    puuid: str
    name: str
    tag: str
    current_rank: str | None = None


class DiscordCallbackResponse(BaseModel):
    """The callback envelope: the Discord user plus registration status.

    ``existing_data`` is explicitly ``null`` when the Discord user has no
    ``leaderboard_players`` row (R22), never dropped from the response.
    """

    user: DiscordCallbackUser
    exists: bool
    existing_data: DiscordExistingData | None = None


class CheckDiscordRequest(BaseModel):
    """Check-by-discord-id request body; int snowflakes coerce to str (R16)."""

    discord_id: str

    @field_validator("discord_id", mode="before")
    @classmethod
    def _coerce_discord_id(cls, value: object) -> str:
        """Mirror ``RegistrationRequest._coerce_discord_id``: int or str ->
        str, ``None`` -> ""."""
        return str(value) if value is not None else ""


class CheckDiscordUser(BaseModel):
    """The registered player slice for check-discord."""

    puuid: str
    name: str
    tag: str
    discord_username: str
    current_rank: str | None = None


class CheckDiscordResponse(BaseModel):
    """``{exists, user}``; ``user`` is explicitly ``null`` on a miss (R22)."""

    exists: bool
    user: CheckDiscordUser | None = None


class CheckPuuidRequest(BaseModel):
    """Check-by-puuid request body."""

    puuid: str


class CheckPuuidUser(BaseModel):
    """The registered player slice for check-puuid."""

    name: str
    tag: str
    discord_username: str


class CheckPuuidResponse(BaseModel):
    """``{exists, user}``; ``user`` is explicitly ``null`` on a miss (R22)."""

    exists: bool
    user: CheckPuuidUser | None = None
