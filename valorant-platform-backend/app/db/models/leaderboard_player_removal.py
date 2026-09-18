from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base

# The leaderboard_players columns a removal copies, in one place so the copy and
# the restore cannot drift apart.
REGISTRATION_COLUMNS = (
    "puuid",
    "name",
    "tag",
    "region",
    "discord_id",
    "discord_username",
    "elo",
    "currenttierpatched",
    "rank_details",
    "peak_rank",
    "seasonal_ranks",
    "last_played_match",
    "update_source",
    "updated_at",
    "hidden_at",
    "hidden_by",
    "hidden_reason",
)


class LeaderboardPlayerRemoval(Base):
    """A removed ``leaderboard_players`` row, kept so the removal can be undone (0017)."""

    __tablename__ = "leaderboard_player_removals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    puuid: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    tag: Mapped[str] = mapped_column(Text, nullable=False)
    region: Mapped[str] = mapped_column(Text, nullable=False)
    discord_id: Mapped[str] = mapped_column(Text, nullable=False)
    discord_username: Mapped[str] = mapped_column(Text, nullable=False)
    elo: Mapped[int | None] = mapped_column(Integer)
    currenttierpatched: Mapped[str | None] = mapped_column(Text)
    rank_details: Mapped[dict] = mapped_column(JSONB, nullable=False)
    peak_rank: Mapped[dict | None] = mapped_column(JSONB)
    seasonal_ranks: Mapped[list | None] = mapped_column(JSONB)
    last_played_match: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    update_source: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hidden_by: Mapped[str | None] = mapped_column(Text)
    hidden_reason: Mapped[str | None] = mapped_column(Text)
    removed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    removed_by: Mapped[str | None] = mapped_column(Text)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    restored_by: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "restored_by IS NULL OR restored_at IS NOT NULL",
            name="leaderboard_player_removals_restored_by_check",
        ),
        Index("leaderboard_player_removals_removed_at_idx", "removed_at"),
        Index("leaderboard_player_removals_puuid_idx", "puuid", "removed_at"),
    )
