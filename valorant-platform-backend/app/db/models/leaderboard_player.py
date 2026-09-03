from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class LeaderboardPlayer(Base):
    """A Sri Lankan Valorant leaderboard entry (Phase 2; distinct from match-engine ``Player``)."""

    __tablename__ = "leaderboard_players"

    puuid: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    tag: Mapped[str] = mapped_column(Text, nullable=False)
    region: Mapped[str] = mapped_column(Text, nullable=False)
    discord_id: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    discord_username: Mapped[str] = mapped_column(Text, nullable=False)
    elo: Mapped[int | None] = mapped_column(Integer)
    currenttierpatched: Mapped[str | None] = mapped_column(Text)
    rank_details: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    peak_rank: Mapped[dict | None] = mapped_column(JSONB)
    seasonal_ranks: Mapped[list | None] = mapped_column(JSONB)
    last_played_match: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    update_source: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("discord_username", name="leaderboard_players_discord_username_key"),
        Index(
            "leaderboard_players_discord_id_key",
            "discord_id",
            unique=True,
            postgresql_where=text("discord_id <> ''"),
        ),
        Index("leaderboard_players_elo_idx", "elo"),
        Index("leaderboard_players_last_played_idx", "last_played_match"),
    )
