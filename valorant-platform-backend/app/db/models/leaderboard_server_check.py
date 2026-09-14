from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class LeaderboardServerMatch(Base):
    """The server one competitive match of a leaderboard player was played on (0018)."""

    __tablename__ = "leaderboard_player_server_matches"

    puuid: Mapped[str] = mapped_column(Text, primary_key=True)
    match_id: Mapped[str] = mapped_column(Text, primary_key=True)
    cluster: Mapped[str | None] = mapped_column(Text)
    shard: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("leaderboard_player_server_matches_started_idx", "puuid", "started_at"),
    )


class LeaderboardServerCheck(Base):
    """When a player's servers were last fetched, and any admin clearance (0018)."""

    __tablename__ = "leaderboard_player_server_checks"

    puuid: Mapped[str] = mapped_column(Text, primary_key=True)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cleared_by: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "cleared_by IS NULL OR cleared_at IS NOT NULL",
            name="leaderboard_player_server_checks_cleared_by_check",
        ),
    )
