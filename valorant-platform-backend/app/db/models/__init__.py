"""SQLAlchemy 2.x declarative models replicating the migrated DDL.

The schema is created exclusively by the plain-SQL migrations in
``supabase/migrations``; these models mirror the migrated columns, indexes,
unique constraints, and CHECK constraints so application code can rely on
DB-enforced integrity. ``Base`` is the single ``DeclarativeBase`` for all
models (``app.db.models.Base``).
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


from app.db.models.leaderboard_player import LeaderboardPlayer
from app.db.models.match import Match
from app.db.models.match_player import MatchPlayer
from app.db.models.player import Player
from app.db.models.rating_event import RatingEvent
from app.db.models.rating_event_sequences import RatingEventSequence
from app.db.models.rating_run import RatingRun
from app.db.models.series import Series
from app.db.models.series_game import SeriesGame
from app.db.models.team import Team

__all__ = [
    "Base",
    "LeaderboardPlayer",
    "Match",
    "MatchPlayer",
    "Player",
    "RatingEvent",
    "RatingEventSequence",
    "RatingRun",
    "Series",
    "SeriesGame",
    "Team",
]
