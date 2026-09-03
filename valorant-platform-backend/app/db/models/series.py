"""``series`` ORM model — mirrors ``supabase/migrations/0005_series.sql``.

``calculated_winner_id`` / ``official_winner_id`` / ``winner_override_reason``
are columns only in Task 12 — finalization and the override policy arrive in
later tasks, so the service only ever writes ``calculated_winner_id`` (and the
map counts) from ``compute_series_result``. ``status`` is locked to
``draft``/``finalized`` by the DB CHECK.
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


class Series(Base):
    """A best-of series between two teams; a draft of attached games."""

    __tablename__ = "series"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    team_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), nullable=False)
    team_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), nullable=False)
    format: Mapped[str] = mapped_column(Text, nullable=False)
    importance: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'draft'"))
    calculated_winner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"))
    official_winner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"))
    winner_override_reason: Mapped[str | None] = mapped_column(Text)
    team_a_maps_won: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    team_b_maps_won: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    played_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The resolved rating policy mode, persisted atomically with finalization
    # (0009 migration; ADR-013): ``forfeit_no_rating`` vs ``forfeit_result_only``
    # stay distinguishable for audit/rebuild even without rating events. NULL
    # while the series is a draft.
    rating_mode: Mapped[str | None] = mapped_column(Text)
    external_quest_series_id: Mapped[str | None] = mapped_column(Text)
    anchor_a_puuid: Mapped[str | None] = mapped_column(Text)
    anchor_b_puuid: Mapped[str | None] = mapped_column(Text)
    finalized_by_actor_id: Mapped[str | None] = mapped_column(Text)
    finalized_by_operation_id: Mapped[str | None] = mapped_column(Text)
    # Manual-result fields (0016 migration): set ONLY for manual series recorded
    # via POST /api/v1/series/manual (offline/historical results with no attached
    # games and no anchors) — the recorded winner and per-team map counts. NULL
    # for every normal series.
    manual_winner_team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"))
    manual_team_a_maps: Mapped[int | None] = mapped_column(Integer)
    manual_team_b_maps: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("team_a_id <> team_b_id", name="series_team_distinct"),
        CheckConstraint("format IN ('bo1','bo3','bo5')", name="series_format_check"),
        CheckConstraint("importance IN ('regular','playoff','finals')", name="series_importance_check"),
        CheckConstraint("status IN ('draft','finalized')", name="series_status_check"),
        CheckConstraint(
            "calculated_winner_id IS NULL OR calculated_winner_id IN (team_a_id, team_b_id)",
            name="series_calculated_winner_check",
        ),
        CheckConstraint(
            "official_winner_id IS NULL OR official_winner_id IN (team_a_id, team_b_id)",
            name="series_official_winner_check",
        ),
        CheckConstraint(
            "official_winner_id IS NULL OR official_winner_id = calculated_winner_id "
            "OR (winner_override_reason IS NOT NULL AND length(trim(winner_override_reason)) > 0)",
            name="series_override_reason_check",
        ),
        CheckConstraint(
            "rating_mode IS NULL OR rating_mode IN "
            "('normal','unrated','forfeit_no_rating','forfeit_result_only','manual_override')",
            name="series_rating_mode_check",
        ),
        CheckConstraint(
            "manual_winner_team_id IS NULL OR manual_winner_team_id IN (team_a_id, team_b_id)",
            name="series_manual_winner_check",
        ),
        UniqueConstraint("external_quest_series_id", name="series_external_quest_series_id_key"),
        Index("series_status_idx", "status"),
        Index("series_team_a_idx", "team_a_id"),
        Index("series_team_b_idx", "team_b_id"),
    )
