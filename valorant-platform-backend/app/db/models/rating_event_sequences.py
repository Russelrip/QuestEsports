"""``rating_event_sequences`` ORM model — mirrors
``supabase/migrations/0012_rating_event_sequences.sql`` (Task 16 fix round 4)
and ``0013_rating_event_sequences_immutable.sql`` (Task 16 fix round 5).

One row per rating application: the durable RESERVATION of a per-run ``sequence``
by exactly one ``series``. ``PRIMARY KEY (run_id, sequence)`` makes a sequence
value owned by exactly one series per run — the concurrency-safe serialization
point (two transactions racing to use the same sequence for different series:
the second reservation INSERT blocks on the first's uncommitted row and then
fails with a unique violation). ``UNIQUE (run_id, series_id)`` gives a series at
most one sequence per run.

Finalize/rebuild reserve the sequence here BEFORE inserting the two team rating
events (inside the shared ``RATING_WORK_LOCK_KEY`` advisory-lock transaction);
``rating_events`` carries a composite FK back to this table, so an unreserved
``(run, sequence)`` can never appear on an event. The deferred pair guard
(0011/0012) validates the two events against the reservation.

Ownership is immutable: the 0013 trigger rejects UPDATE and DELETE on these rows
(exactly like ``rating_events`` in 0010), so a committed ``(run, sequence,
series_id)`` reservation can never be reassigned or deleted. Only INSERTs are
valid — runtime allocation (``reserve_event_sequence``), the 0012 backfill, and
manual seeding. TRUNCATE is unaffected (per-row trigger), so the test harness
keeps working.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class RatingEventSequence(Base):
    """One reserved sequence (run, series) — the ownership of a per-run order."""

    __tablename__ = "rating_event_sequences"

    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rating_runs.id"), primary_key=True)
    sequence: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("series.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("run_id", "series_id", name="rating_event_sequences_run_series_key"),
        Index("rating_event_sequences_series_id_idx", "series_id"),
    )
