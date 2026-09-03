"""``matches`` ORM model — mirrors ``supabase/migrations/0002_matches.sql``."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class Match(Base):
    """A single canonical match import; the raw Henrik envelope is retained."""

    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    henrik_match_id: Mapped[str] = mapped_column(Text, nullable=False)
    affinity: Mapped[str] = mapped_column(Text, nullable=False)
    platform: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pc'"))
    map_id: Mapped[str | None] = mapped_column(Text)
    map_name: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str | None] = mapped_column(Text)
    queue: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    is_completed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    red_score: Mapped[int | None] = mapped_column(Integer)
    blue_score: Mapped[int | None] = mapped_column(Integer)
    winning_side: Mapped[str | None] = mapped_column(Text)
    game_version: Mapped[str | None] = mapped_column(Text)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    henrik_api_version: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'v4'"))
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("henrik_match_id", name="matches_henrik_match_id_key"),
        CheckConstraint("red_score IS NULL OR red_score >= 0", name="matches_red_score_nonneg"),
        CheckConstraint("blue_score IS NULL OR blue_score >= 0", name="matches_blue_score_nonneg"),
        CheckConstraint(
            "winning_side IS NULL OR winning_side IN ('red','blue','draw','unknown')",
            name="matches_winning_side_check",
        ),
        CheckConstraint("platform IN ('pc','console')", name="matches_platform_check"),
        Index("matches_started_at_idx", "started_at"),
        Index("matches_map_name_idx", "map_name"),
        Index("matches_mode_idx", "mode"),
    )
