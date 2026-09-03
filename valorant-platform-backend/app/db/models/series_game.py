"""``series_games`` ORM model — mirrors ``supabase/migrations/0006_series_games.sql``.

Rounds and the winner are never entered by clients: they are derived from the
imported canonical match. The DB enforces the shape constraints (unique
``(series_id, game_number)``, unique ``match_id``, opposing sides, nonnegative
rounds) and the winner-in-owning-series trigger.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class SeriesGame(Base):
    """One attached game of a series, side-mapped onto the two series teams."""

    __tablename__ = "series_games"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    series_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    game_number: Mapped[int] = mapped_column(Integer, nullable=False)
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"), nullable=False)
    team_a_side: Mapped[str] = mapped_column(Text, nullable=False)
    team_b_side: Mapped[str] = mapped_column(Text, nullable=False)
    team_a_rounds: Mapped[int] = mapped_column(Integer, nullable=False)
    team_b_rounds: Mapped[int] = mapped_column(Integer, nullable=False)
    winner_team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("series_id", "game_number", name="series_games_number_key"),
        UniqueConstraint("match_id", name="series_games_match_key"),
        CheckConstraint("game_number > 0", name="series_games_number_positive"),
        CheckConstraint(
            "team_a_side IN ('red','blue') AND team_b_side IN ('red','blue') "
            "AND team_a_side <> team_b_side",
            name="series_games_sides_check",
        ),
        CheckConstraint("team_a_rounds >= 0 AND team_b_rounds >= 0", name="series_games_rounds_nonneg"),
        Index("series_games_series_id_idx", "series_id"),
        Index("series_games_match_id_idx", "match_id"),
    )
