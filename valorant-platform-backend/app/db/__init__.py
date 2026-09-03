"""Database package: async session factory (``app.db.session``) and SQLAlchemy
2.x ORM models (``app.db.models``). The schema itself is owned exclusively by
the plain-SQL migrations in ``supabase/migrations`` (no Alembic)."""

from app.db.models import Base

__all__ = ["Base"]
