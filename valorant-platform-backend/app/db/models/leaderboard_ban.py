from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class LeaderboardBan(Base):
    """A PUUID and/or Discord id that may not register while the ban is active (0019)."""

    __tablename__ = "leaderboard_bans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    puuid: Mapped[str | None] = mapped_column(Text)
    discord_id: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    tag: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    discord_username: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    reason: Mapped[str | None] = mapped_column(Text)
    banned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    banned_by: Mapped[str | None] = mapped_column(Text)
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lifted_by: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("puuid IS NOT NULL OR discord_id IS NOT NULL", name="leaderboard_bans_identity_check"),
        CheckConstraint("puuid IS NULL OR puuid <> ''", name="leaderboard_bans_puuid_check"),
        CheckConstraint("discord_id IS NULL OR discord_id <> ''", name="leaderboard_bans_discord_id_check"),
        CheckConstraint("lifted_by IS NULL OR lifted_at IS NOT NULL", name="leaderboard_bans_lifted_by_check"),
        Index(
            "leaderboard_bans_active_puuid_key",
            "puuid",
            unique=True,
            postgresql_where=text("lifted_at IS NULL AND puuid IS NOT NULL"),
        ),
        Index(
            "leaderboard_bans_active_discord_id_key",
            "discord_id",
            unique=True,
            postgresql_where=text("lifted_at IS NULL AND discord_id IS NOT NULL"),
        ),
        Index("leaderboard_bans_banned_at_idx", "banned_at"),
    )
