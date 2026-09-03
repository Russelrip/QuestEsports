"""``teams`` data access (plan Task 11; design §9.1).

``TeamRepository`` is the only code that issues ``teams`` queries/inserts/updates.
The durable identity key is ``id``; ``slug`` is a unique mutable label enforced
by the ``teams_slug_key`` unique index. There is no hard-delete path: retirement
is ``is_active=false`` (the service owns that business rule).
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Team


class TeamRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, team_id: uuid.UUID) -> Team | None:
        return await self._session.get(Team, team_id)

    async def get_by_quest_saved_team_id(self, quest_saved_team_id: str) -> Team | None:
        """The team converged on the Quest saved-team key (delta D2)."""
        result = await self._session.execute(
            select(Team).where(Team.quest_saved_team_id == quest_saved_team_id)
        )
        return result.scalar_one_or_none()

    async def list_teams(self, *, active_only: bool = True) -> list[Team]:
        """Return teams in deterministic ``(name, id)`` order.

        ``active_only=True`` (the default) keeps only ``is_active=true`` rows;
        ``active_only=False`` includes retired teams.
        """
        stmt = select(Team)
        if active_only:
            stmt = stmt.where(Team.is_active.is_(True))
        stmt = stmt.order_by(Team.name.asc(), Team.id.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def list_teams_ranked(self, *, active_only: bool = True) -> list[Team]:
        """Teams in standings order — ``current_elo DESC, name ASC, id ASC``
        (deterministic; the Task 16 rankings read). ``active_only=True`` keeps
        only ``is_active=true`` rows, matching the team-list default."""
        stmt = select(Team)
        if active_only:
            stmt = stmt.where(Team.is_active.is_(True))
        stmt = stmt.order_by(Team.current_elo.desc(), Team.name.asc(), Team.id.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def create_team(
        self,
        *,
        name: str,
        short_name: str | None,
        slug: str | None,
        logo_url: str | None,
        seeding_elo: Decimal | None,
        current_elo: Decimal,
        peak_elo: Decimal,
        quest_saved_team_id: str | None,
    ) -> Team:
        """Persist a new team; server defaults (``id``, timestamps, counters)
        are fetched via RETURNING on flush, so the returned row is complete."""
        team = Team(
            name=name,
            short_name=short_name,
            slug=slug,
            logo_url=logo_url,
            quest_saved_team_id=quest_saved_team_id,
            seeding_elo=seeding_elo,
            current_elo=current_elo,
            peak_elo=peak_elo,
        )
        self._session.add(team)
        await self._session.flush()
        return team

    async def update_team(self, team: Team, **values: object) -> Team:
        """Apply field changes to a loaded team row and flush (no commit)."""
        for key, value in values.items():
            setattr(team, key, value)
        await self._session.flush()
        return team
