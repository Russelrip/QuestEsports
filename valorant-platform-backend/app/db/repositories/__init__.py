"""Repository layer: thin data-access objects over the async session.

Repositories own every SQL statement for their table; services orchestrate
business rules and transactions.
"""

from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.db.repositories.rating_repository import RatingRepository
from app.db.repositories.series_repository import SeriesRepository
from app.db.repositories.team_repository import TeamRepository

__all__ = [
    "MatchRepository",
    "PlayerRepository",
    "RatingRepository",
    "SeriesRepository",
    "TeamRepository",
]
