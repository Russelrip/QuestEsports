"""``teams`` ORM model — mirrors ``supabase/migrations/0004_teams.sql``.

Ratings start at ``INITIAL_ELO`` (1000) for both ``current_elo`` and
``peak_elo``. ``seeding_elo`` is legacy compatibility only (nullable, never a
rating input). Referenced teams are never hard-deleted — retirement is
``is_active=false``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class Team(Base):
    """A competitive VALORANT team; the durable Phase 2 entity."""

    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    short_name: Mapped[str | None] = mapped_column(Text)
    slug: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(Text)
    quest_saved_team_id: Mapped[str | None] = mapped_column(Text)
    current_elo: Mapped[Decimal] = mapped_column(Numeric, nullable=False, server_default=text("1000"))
    peak_elo: Mapped[Decimal] = mapped_column(Numeric, nullable=False, server_default=text("1000"))
    seeding_elo: Mapped[Decimal | None] = mapped_column(Numeric)
    matches_played: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    series_wins: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    series_losses: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("slug", name="teams_slug_key"),
        CheckConstraint("current_elo >= 0", name="teams_current_elo_nonneg"),
        CheckConstraint("peak_elo >= 0", name="teams_peak_elo_nonneg"),
        CheckConstraint("matches_played >= 0", name="teams_matches_played_nonneg"),
        CheckConstraint("series_wins >= 0", name="teams_series_wins_nonneg"),
        CheckConstraint("series_losses >= 0", name="teams_series_losses_nonneg"),
        Index("teams_is_active_idx", "is_active"),
        Index(
            "teams_quest_saved_team_id_key",
            "quest_saved_team_id",
            unique=True,
            postgresql_where=text("quest_saved_team_id IS NOT NULL"),
        ),
    )
