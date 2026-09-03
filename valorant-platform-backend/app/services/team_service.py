"""Team service (plan Task 11; design §9.1, §14.1, App. B).

Team creation seeds both ``current_elo`` and ``peak_elo`` at ``INITIAL_ELO``
(1000) — a hard-coded Phase 2 invariant that is independent of the
``default_initial_elo`` environment setting (that setting is consumed by the
future rankings-rebuild reset path, never by team creation). ``seeding_elo`` is
preserved only for legacy compatibility and is never a rating input. ``slug`` is
unique (the ``teams_slug_key`` DB index); a duplicate slug surfaces as 409
``TEAM_SLUG_TAKEN``. There is no delete: retirement is ``PATCH is_active=false``,
so a referenced team is never hard-deleted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import AppError
from app.db.models import Team
from app.db.repositories.team_repository import TeamRepository
from app.schemas.teams import TeamCreate, TeamUpdate

# Phase 2 invariant (design §9.1, plan §11.4): every API-created team starts at
# exactly 1000 for both current_elo and peak_elo. Hard-coded so a mutable
# ``default_initial_elo`` setting can never change the API contract — team
# creation succeeds with any configuration and always writes the invariant.
INITIAL_ELO = Decimal(1000)


class TeamService:
    def __init__(self, session: AsyncSession, repo: TeamRepository) -> None:
        self._session = session
        self._repo = repo

    async def create(self, req: TeamCreate) -> Team:
        team, _created = await self.create_or_get(req)
        return team

    async def create_or_get(self, req: TeamCreate) -> tuple[Team, bool]:
        """Create a team, or return the existing row keyed on
        ``quest_saved_team_id`` (200) when the key already converged (delta
        D2; spec §5.1/§8.1). ``current_elo``/``peak_elo`` start at 1000.
        """
        if req.quest_saved_team_id is not None:
            existing = await self._repo.get_by_quest_saved_team_id(req.quest_saved_team_id)
            if existing is not None:
                return existing, False
        try:
            team = await self._repo.create_team(
                name=req.name,
                short_name=req.short_name,
                slug=req.slug,
                logo_url=req.logo_url,
                seeding_elo=req.seeding_elo,
                current_elo=INITIAL_ELO,
                peak_elo=INITIAL_ELO,
                quest_saved_team_id=req.quest_saved_team_id,
            )
            await self._session.commit()
            return team, True
        except IntegrityError as exc:
            await self._session.rollback()
            if (
                req.quest_saved_team_id is not None
                and _is_quest_saved_team_unique_violation(exc)
            ):
                existing = await self._repo.get_by_quest_saved_team_id(req.quest_saved_team_id)
                if existing is not None:
                    return existing, False
            if _is_slug_unique_violation(exc):
                raise AppError("TEAM_SLUG_TAKEN", 409, "team slug already taken") from exc
            raise

    async def list(self, *, active_only: bool = True) -> list[Team]:
        return await self._repo.list_teams(active_only=active_only)

    async def get(self, team_id: uuid.UUID) -> Team:
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise AppError("TEAM_NOT_FOUND", 404, "team not found")
        return team

    async def update(self, team_id: uuid.UUID, req: TeamUpdate) -> Team:
        """Apply the submitted fields; deactivation is ``is_active=false``.

        ``req.model_fields_set`` is the sentinel that distinguishes an omitted
        field from an explicitly-null one: a field present in the set is applied
        even when its value is ``None``, so ``slug: null`` (and
        ``short_name: null`` / ``logo_url: null``) genuinely clears the column
        while an omitted field is preserved untouched.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise AppError("TEAM_NOT_FOUND", 404, "team not found")

        fields = req.model_fields_set
        changes = req.model_dump(exclude_unset=True)
        values: dict[str, object] = {}
        if "name" in fields and changes.get("name") is not None:
            values["name"] = changes["name"]
        if "short_name" in fields:
            values["short_name"] = changes["short_name"]
        if "slug" in fields:
            values["slug"] = changes["slug"]
        if "logo_url" in fields:
            values["logo_url"] = changes["logo_url"]
        if "is_active" in fields and changes.get("is_active") is not None:
            values["is_active"] = changes["is_active"]
        if not values:
            return team
        values["updated_at"] = datetime.now(UTC)

        try:
            await self._repo.update_team(team, **values)
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_slug_unique_violation(exc):
                raise AppError("TEAM_SLUG_TAKEN", 409, "team slug already taken") from exc
            raise
        return team


def _is_quest_saved_team_unique_violation(exc: IntegrityError) -> bool:
    """True when the integrity error is the ``teams_quest_saved_team_id_key``
    unique violation (the partial index on non-null quest keys)."""
    orig = exc.orig
    constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
    if not constraint:
        constraint = getattr(orig, "constraint_name", None)
    if not constraint:
        constraint = str(orig)
    return constraint == "teams_quest_saved_team_id_key" or "teams_quest_saved_team_id_key" in str(constraint)


def _is_slug_unique_violation(exc: IntegrityError) -> bool:
    """True when the integrity error is the ``teams_slug_key`` unique violation.

    Asyncpg surfaces the constraint name on ``orig.diag.constraint_name``;
    other drivers may expose ``orig.constraint_name`` or only the raw text.
    """
    orig = exc.orig
    constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
    if not constraint:
        constraint = getattr(orig, "constraint_name", None)
    if not constraint:
        constraint = str(orig)
    return constraint == "teams_slug_key" or "teams_slug_key" in str(constraint)
