"""``players`` ORM model — mirrors ``supabase/migrations/0001_players.sql``."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class Player(Base):
    """A resolved VALORANT player (Henrik account identity + lifecycle)."""

    __tablename__ = "players"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    puuid: Mapped[str] = mapped_column(Text, nullable=False)
    current_name: Mapped[str] = mapped_column(Text, nullable=False)
    current_tag: Mapped[str] = mapped_column(Text, nullable=False)
    affinity: Mapped[str | None] = mapped_column(Text)
    platforms: Mapped[list[str] | None] = mapped_column(JSONB)
    henrik_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("players_puuid_key", "puuid", unique=True),
        Index("players_lower_name_tag_idx", text("lower(current_name)"), text("lower(current_tag)")),
        Index("players_affinity_idx", "affinity"),
    )
