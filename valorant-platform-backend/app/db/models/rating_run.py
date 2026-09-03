"""``rating_runs`` ORM model — mirrors ``supabase/migrations/0007_rating_runs.sql``.

Versioned runs make ``rating_events`` immutable audit records across rebuilds:
normal finalization inserts events under the current run (max ``run_number``);
a rebuild creates a NEW run and replays finalized series into it without ever
touching prior runs. ``run_number`` is ``GENERATED ALWAYS AS IDENTITY`` in the
migration; the model mirrors it with ``Identity(always=True)`` so SQLAlchemy
never emits a value for it. The initial (live) run is seeded by the migration.

Run allocation (Task 16 fix round 1): the rebuild does NOT draw ``run_number``
from the identity sequence (whose values advance even on rollback, leaving
gaps). ``RatingRepository.create_run`` computes ``max(run_number) + 1`` inside
the transaction and inserts it with ``OVERRIDING SYSTEM VALUE`` under the
shared ``RATING_WORK_LOCK_KEY`` advisory lock, so the documented sequential
``max+1`` contract holds exactly — including across rolled-back rebuilds. The
identity column remains the migration's baseline for the seed row and any
out-of-band inserts.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Identity, Index, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class RatingRun(Base):
    """One versioned rating run; events reference the run that produced them."""

    __tablename__ = "rating_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    run_number: Mapped[int] = mapped_column(BigInteger, Identity(always=True), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("rating_runs_run_number_key", "run_number", unique=True),)
