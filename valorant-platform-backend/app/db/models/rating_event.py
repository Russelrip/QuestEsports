"""``rating_events`` ORM model — mirrors ``supabase/migrations/0008_rating_events.sql``.

Immutable audit records: one row per team per finalized series per run. Never
updated, never deleted — rebuilds insert under a new ``rating_runs`` row and
reads use the current run (max ``run_number``). The unique
``(run_id, series_id, team_id)`` is the DB-enforced at-most-once rating guard
for a series in a run. ``calculation_details`` (jsonb) records the resolved
rating policy (mode + override) and the raw unrounded ELO inputs/outputs per
ADR-013/ADR-014.

``sequence`` (0011 migration; Task 16 fix round 3) is the stable per-run
APPLICATION/REPLAY order: ordinary finalization allocates ``max(sequence)+1``
within the run under the shared ``RATING_WORK_LOCK_KEY`` advisory lock and
writes BOTH team events with it; a rebuild assigns sequences in deterministic
replay order. The DB enforces the exact-pair invariant with a DEFERRED
constraint trigger (0011) that runs at COMMIT: every ``(run, sequence)`` holds
exactly TWO events of ONE series, the two teams are exactly the series'
``team_a``/``team_b`` (no duplicate team, no wrong team, no partial pair), and
a series uses exactly one sequence per run. Pre-0011 rows were backfilled from
the persisted application proxy (earliest ``created_at``/``id`` per series) —
legacy order, never ``played_at``. History reads order by ``sequence`` so
``elo_before``/``elo_after`` chain in actual application/replay order — never
transaction-stable ``now()``/random-UUID order.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class RatingEvent(Base):
    """One team's immutable rating event for one finalized series in one run."""

    __tablename__ = "rating_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rating_runs.id"), nullable=False)
    series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("series.id"), nullable=False)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), nullable=False)
    elo_before: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    elo_after: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    elo_change: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    opponent_team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), nullable=False)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    # Stable per-run application/replay order (Task 16 fix round 2): both team
    # events of a series share one value; finalization allocates max+1 under the
    # rating-work advisory lock, rebuilds assign values in replay order.
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    k_factor: Mapped[Decimal | None] = mapped_column(Numeric)
    expected_score: Mapped[Decimal | None] = mapped_column(Numeric)
    performance_multiplier: Mapped[Decimal | None] = mapped_column(Numeric)
    importance_multiplier: Mapped[Decimal | None] = mapped_column(Numeric)
    upset_bonus: Mapped[Decimal | None] = mapped_column(Numeric)
    calculation_details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("run_id", "series_id", "team_id", name="rating_events_run_series_team_key"),
        CheckConstraint("result IN ('win','loss')", name="rating_events_result_check"),
        Index("rating_events_team_id_idx", "team_id"),
        Index("rating_events_series_id_idx", "series_id"),
        Index("rating_events_run_id_idx", "run_id"),
    )
