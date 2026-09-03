"""``match_players`` ORM model — mirrors ``supabase/migrations/0003_match_players.sql``."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class MatchPlayer(Base):
    """One player's participation in one match (identity/stat snapshots)."""

    __tablename__ = "match_players"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    match_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), nullable=False
    )
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    puuid_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    tag_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    side: Mapped[str] = mapped_column(Text, nullable=False)
    agent_id: Mapped[str | None] = mapped_column(Text)
    agent_name: Mapped[str | None] = mapped_column(Text)
    score_total: Mapped[int | None] = mapped_column(Integer)
    kills: Mapped[int | None] = mapped_column(Integer)
    deaths: Mapped[int | None] = mapped_column(Integer)
    assists: Mapped[int | None] = mapped_column(Integer)
    damage_dealt: Mapped[int | None] = mapped_column(Integer)
    damage_received: Mapped[int | None] = mapped_column(Integer)
    headshots: Mapped[int | None] = mapped_column(Integer)
    bodyshots: Mapped[int | None] = mapped_column(Integer)
    legshots: Mapped[int | None] = mapped_column(Integer)
    raw_player_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("match_id", "player_id", name="match_players_match_player_key"),
        CheckConstraint("side IN ('red','blue')", name="match_players_side_check"),
        Index("match_players_puuid_snapshot_idx", "puuid_snapshot"),
        Index("match_players_player_id_idx", "player_id"),
    )
