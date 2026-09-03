"""TeamService unit tests (plan Task 11; design §9.1, §14.1, App. B).

In-memory repository + fake session — no network, no DB. Covers:

- create: ``current_elo``/``peak_elo`` start at ``INITIAL_ELO`` (1000);
- create with ``seeding_elo``: stored verbatim without affecting ``current_elo``
  (legacy compatibility — never a rating input);
- create with slug/metadata: persisted;
- list: ``active_only`` filters retired teams;
- update: field changes applied, deactivation via ``is_active=false``;
- get/update on a missing team → ``TEAM_NOT_FOUND`` (404);
- duplicate slug on create and on update → ``TEAM_SLUG_TAKEN`` (409);
- create-or-get by ``quest_saved_team_id``: reused key converges to the existing
  team (no new identity), and the concurrent-race path (unique-violation
  re-read after rollback) reconciles on the key;
- blank ``name`` is rejected by schema validation;
- an empty PATCH is a no-op (no write, no commit).
"""

from __future__ import annotations

import types
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.api.errors import AppError
from app.config import Settings
from app.db.models import Team
from app.schemas.teams import TeamCreate, TeamUpdate
from app.services.team_service import TeamService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
INITIAL_ELO = Decimal(1000)


def _slug_taken_integrity_error() -> IntegrityError:
    """A faithful stand-in for asyncpg's ``teams_slug_key`` violation."""
    orig = types.SimpleNamespace(diag=types.SimpleNamespace(constraint_name="teams_slug_key"))
    return IntegrityError("INSERT INTO teams ...", {}, orig)


def _quest_saved_team_taken_integrity_error() -> IntegrityError:
    """A faithful stand-in for asyncpg's ``teams_quest_saved_team_id_key`` violation."""
    orig = types.SimpleNamespace(diag=types.SimpleNamespace(constraint_name="teams_quest_saved_team_id_key"))
    return IntegrityError("INSERT INTO teams ...", {}, orig)


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0
        self.rolled_back = 0

    async def commit(self) -> None:
        self.committed += 1

    async def rollback(self) -> None:
        self.rolled_back += 1


class InMemoryTeamRepository:
    """In-memory mirror of ``TeamRepository`` over plain ``Team`` objects."""

    def __init__(self) -> None:
        self.teams: dict[uuid.UUID, Team] = {}
        self.slugs: dict[str, uuid.UUID] = {}
        self.quest_saved_team_ids: dict[str, uuid.UUID] = {}
        # Simulates a concurrent create-or-get race: the losing request's
        # pre-lookup runs before the winner's insert commits, so it sees
        # nothing while the key already exists in the unique map. One-shot.
        self.miss_next_lookups = 0

    async def get_by_id(self, team_id: uuid.UUID) -> Team | None:
        return self.teams.get(team_id)

    async def get_by_quest_saved_team_id(self, quest_saved_team_id: str) -> Team | None:
        if self.miss_next_lookups > 0:
            self.miss_next_lookups -= 1
            return None
        team_id = self.quest_saved_team_ids.get(quest_saved_team_id)
        return self.teams.get(team_id) if team_id is not None else None

    async def list_teams(self, *, active_only: bool = True) -> list[Team]:
        rows = [team for team in self.teams.values() if not active_only or team.is_active]
        rows.sort(key=lambda team: (team.name, str(team.id)))
        return rows

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
        quest_saved_team_id: str | None = None,
    ) -> Team:
        if slug is not None and slug in self.slugs:
            raise _slug_taken_integrity_error()
        if quest_saved_team_id is not None and quest_saved_team_id in self.quest_saved_team_ids:
            raise _quest_saved_team_taken_integrity_error()
        team = Team(
            id=uuid.uuid4(),
            name=name,
            short_name=short_name,
            slug=slug,
            logo_url=logo_url,
            quest_saved_team_id=quest_saved_team_id,
            seeding_elo=seeding_elo,
            current_elo=current_elo,
            peak_elo=peak_elo,
            matches_played=0,
            series_wins=0,
            series_losses=0,
            is_active=True,
            created_at=START,
            updated_at=START,
        )
        self.teams[team.id] = team
        if slug is not None:
            self.slugs[slug] = team.id
        if quest_saved_team_id is not None:
            self.quest_saved_team_ids[quest_saved_team_id] = team.id
        return team

    async def update_team(self, team: Team, **values) -> Team:
        if (
            "slug" in values
            and values["slug"] is not None
            and self.slugs.get(values["slug"]) not in (None, team.id)
        ):
            raise _slug_taken_integrity_error()
        for key, value in values.items():
            setattr(team, key, value)
        # Resync the unique-slug map so clearing a slug frees the old label for
        # reuse by another team (mirrors the DB unique index semantics).
        self.slugs = {t.slug: t.id for t in self.teams.values() if t.slug is not None}
        return team


def _service(
    repo: InMemoryTeamRepository | None = None,
    session: FakeSession | None = None,
) -> TeamService:
    return TeamService(session=session or FakeSession(), repo=repo or InMemoryTeamRepository())  # type: ignore[arg-type]


def _team(**overrides: object) -> Team:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "name": "Team A",
        "current_elo": INITIAL_ELO,
        "peak_elo": INITIAL_ELO,
        "matches_played": 0,
        "series_wins": 0,
        "series_losses": 0,
        "is_active": True,
        "created_at": START,
        "updated_at": START,
    }
    defaults.update(overrides)
    return Team(**defaults)


def _seed(repo: InMemoryTeamRepository, **overrides: object) -> Team:
    team = _team(**overrides)
    repo.teams[team.id] = team
    if team.slug is not None:
        repo.slugs[team.slug] = team.id
    if team.quest_saved_team_id is not None:
        repo.quest_saved_team_ids[team.quest_saved_team_id] = team.id
    return team


# ---------------------------------------------------------------- create


async def test_create_starts_at_initial_elo() -> None:
    repo = InMemoryTeamRepository()
    svc = _service(repo)

    team = await svc.create(TeamCreate(name="Sentinels"))

    assert team.name == "Sentinels"
    assert team.current_elo == INITIAL_ELO
    assert team.peak_elo == INITIAL_ELO
    assert team.seeding_elo is None
    assert team.matches_played == 0
    assert team.series_wins == 0
    assert team.series_losses == 0
    assert team.is_active is True
    assert team.id in repo.teams


async def test_create_with_seeding_elo_stores_it_without_affecting_current_elo() -> None:
    svc = _service(InMemoryTeamRepository())

    team = await svc.create(TeamCreate(name="Legacy", seeding_elo=Decimal("1200.5")))

    assert team.seeding_elo == Decimal("1200.5")  # preserved verbatim
    assert team.current_elo == INITIAL_ELO  # never a rating input
    assert team.peak_elo == INITIAL_ELO


async def test_create_persists_metadata_and_slug() -> None:
    svc = _service(InMemoryTeamRepository())

    team = await svc.create(
        TeamCreate(name="  Fnatic  ", short_name="FNC", slug="fnatic", logo_url="https://x/f.png")
    )

    assert team.name == "Fnatic"  # stripped
    assert team.short_name == "FNC"
    assert team.slug == "fnatic"
    assert team.logo_url == "https://x/f.png"


async def test_create_blank_name_rejected_by_schema() -> None:
    with pytest.raises(ValidationError):
        TeamCreate(name="   ")


async def test_create_whitespace_slug_normalized_to_null() -> None:
    team = await _service(InMemoryTeamRepository()).create(TeamCreate(name="X", slug="   "))
    assert team.slug is None


# ----------------------------------------------------------------- list


async def test_list_filters_inactive_teams() -> None:
    repo = InMemoryTeamRepository()
    active = await _service(repo).create(TeamCreate(name="Active"))
    retired = await _service(repo).create(TeamCreate(name="Retired"))
    retired.is_active = False
    svc = _service(repo)

    active_only = await svc.list()
    assert [t.id for t in active_only] == [active.id]

    all_teams = await svc.list(active_only=False)
    assert {t.id for t in all_teams} == {active.id, retired.id}


async def test_list_is_deterministic_by_name() -> None:
    repo = InMemoryTeamRepository()
    svc = _service(repo)
    for name in ("Zulu", "Alpha", "Mike"):
        await svc.create(TeamCreate(name=name))

    names = [team.name for team in await svc.list(active_only=False)]
    assert names == ["Alpha", "Mike", "Zulu"]


# ---------------------------------------------------------------- get


async def test_get_returns_stored_team() -> None:
    repo = InMemoryTeamRepository()
    existing = _seed(repo, name="G2")
    svc = _service(repo)

    assert await svc.get(existing.id) is existing


async def test_get_missing_raises_team_not_found() -> None:
    svc = _service(InMemoryTeamRepository())

    with pytest.raises(AppError) as excinfo:
        await svc.get(uuid.uuid4())

    assert excinfo.value.code == "TEAM_NOT_FOUND"
    assert excinfo.value.status == 404


# --------------------------------------------------------------- update


async def test_update_deactivates_team() -> None:
    repo = InMemoryTeamRepository()
    existing = _seed(repo, name="G2")
    svc = _service(repo)

    updated = await svc.update(existing.id, TeamUpdate(is_active=False))

    assert updated.is_active is False
    assert repo.teams[existing.id].is_active is False  # persisted on the object
    assert updated.name == "G2"  # untouched fields unchanged


async def test_update_changes_fields() -> None:
    repo = InMemoryTeamRepository()
    existing = _seed(repo, name="G2", short_name="G2", logo_url="https://x/g.png")
    svc = _service(repo)

    updated = await svc.update(
        existing.id,
        TeamUpdate(name="G2 Esports", short_name="G2", logo_url="https://y/g.png", slug="g2"),
    )

    assert updated.name == "G2 Esports"
    assert updated.short_name == "G2"
    assert updated.logo_url == "https://y/g.png"
    assert updated.slug == "g2"


async def test_update_missing_raises_team_not_found() -> None:
    svc = _service(InMemoryTeamRepository())

    with pytest.raises(AppError) as excinfo:
        await svc.update(uuid.uuid4(), TeamUpdate(name="Nope"))

    assert excinfo.value.code == "TEAM_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_empty_update_is_noop_without_commit() -> None:
    repo = InMemoryTeamRepository()
    existing = _seed(repo, name="G2")
    session = FakeSession()
    svc = _service(repo, session)

    updated = await svc.update(existing.id, TeamUpdate())

    assert updated is existing
    assert session.committed == 0


# ---------------------------------------------------- duplicate slug (409)


async def test_duplicate_slug_on_create_raises_slug_taken() -> None:
    repo = InMemoryTeamRepository()
    await _service(repo).create(TeamCreate(name="First", slug="shared"))
    svc = _service(repo)

    with pytest.raises(AppError) as excinfo:
        await svc.create(TeamCreate(name="Second", slug="shared"))

    assert excinfo.value.code == "TEAM_SLUG_TAKEN"
    assert excinfo.value.status == 409


async def test_duplicate_slug_on_update_raises_slug_taken() -> None:
    repo = InMemoryTeamRepository()
    first = await _service(repo).create(TeamCreate(name="First", slug="taken"))
    second = await _service(repo).create(TeamCreate(name="Second"))
    svc = _service(repo)

    with pytest.raises(AppError) as excinfo:
        await svc.update(second.id, TeamUpdate(slug="taken"))

    assert excinfo.value.code == "TEAM_SLUG_TAKEN"
    assert excinfo.value.status == 409
    assert repo.teams[first.id].slug == "taken"


async def test_own_slug_update_is_allowed() -> None:
    repo = InMemoryTeamRepository()
    existing = await _service(repo).create(TeamCreate(name="First", slug="mine"))
    svc = _service(repo)

    updated = await svc.update(existing.id, TeamUpdate(slug="mine"))

    assert updated.slug == "mine"


# ------------------------------------------- omitted vs explicit null (PATCH)


async def test_update_explicit_slug_null_clears_slug() -> None:
    repo = InMemoryTeamRepository()
    existing = await _service(repo).create(TeamCreate(name="First", slug="old-slug"))
    svc = _service(repo)

    updated = await svc.update(existing.id, TeamUpdate(slug=None))

    assert updated.slug is None  # explicit null clears the column
    assert repo.teams[existing.id].slug is None


async def test_update_cleared_slug_frees_label_for_reuse() -> None:
    repo = InMemoryTeamRepository()
    first = await _service(repo).create(TeamCreate(name="First", slug="shared"))
    second = await _service(repo).create(TeamCreate(name="Second"))
    svc = _service(repo)

    await svc.update(first.id, TeamUpdate(slug=None))
    updated = await svc.update(second.id, TeamUpdate(slug="shared"))

    assert updated.slug == "shared"  # old owner released the label


async def test_update_omitted_slug_preserved() -> None:
    repo = InMemoryTeamRepository()
    existing = await _service(repo).create(TeamCreate(name="Keep", slug="kept"))
    svc = _service(repo)

    updated = await svc.update(existing.id, TeamUpdate(name="Keep Renamed"))

    assert updated.slug == "kept"  # omitted slug is untouched


async def test_update_short_name_null_clears_short_name() -> None:
    repo = InMemoryTeamRepository()
    existing = await _service(repo).create(TeamCreate(name="G2", short_name="G2X"))
    svc = _service(repo)

    updated = await svc.update(existing.id, TeamUpdate(short_name=None))

    assert updated.short_name is None


# ----------------------------------------- max-length validation on PATCH


def test_update_oversized_name_rejected() -> None:
    with pytest.raises(ValidationError):
        TeamUpdate(name="x" * 65)


def test_update_oversized_short_name_rejected() -> None:
    with pytest.raises(ValidationError):
        TeamUpdate(short_name="x" * 17)


def test_update_oversized_slug_rejected() -> None:
    with pytest.raises(ValidationError):
        TeamUpdate(slug="x" * 65)


def test_update_boundary_lengths_accepted() -> None:
    TeamUpdate(name="x" * 64, short_name="x" * 16, slug="x" * 64)  # no error


# ------------------- ratings invariant independent of configuration


async def test_create_succeeds_with_non_1000_initial_elo_config() -> None:
    """Team creation must succeed with any ``Settings.default_initial_elo`` value
    and always persist the 1000 Phase 2 starting-rating invariant."""
    config = Settings(app_env="test", default_initial_elo=Decimal(1500))
    assert config.default_initial_elo == Decimal(1500)  # config may differ from the invariant
    repo = InMemoryTeamRepository()
    svc = _service(repo)

    team = await svc.create(TeamCreate(name="X"))

    assert team.current_elo == Decimal(1000)
    assert team.peak_elo == Decimal(1000)
    assert repo.teams[team.id].current_elo == Decimal(1000)  # persisted invariant, not config-derived


async def test_create_starts_at_1000_with_default_config() -> None:
    svc = _service(InMemoryTeamRepository())

    team = await svc.create(TeamCreate(name="X"))

    assert team.current_elo == Decimal(1000)
    assert team.peak_elo == Decimal(1000)


# ------------------------------------- create-or-get by quest_saved_team_id


async def test_create_or_get_returns_existing_team_for_reused_key() -> None:
    svc = _service()
    first, created = await svc.create_or_get(
        TeamCreate(name="Sentinels", quest_saved_team_id="quest-team-1")
    )
    assert created is True
    assert first.quest_saved_team_id == "quest-team-1"

    second, created = await svc.create_or_get(
        TeamCreate(name="Sentinels", quest_saved_team_id="quest-team-1")
    )
    assert created is False
    assert second.id == first.id  # convergence by key, no new identity


async def test_create_or_get_race_reconciles_on_unique_violation() -> None:
    """The losing side of a concurrent create-or-get: pre-lookup misses (the
    winner hasn't committed yet), the insert trips the quest-saved-team unique
    index, and the service re-reads the existing row after rollback."""
    repo = InMemoryTeamRepository()
    existing = _seed(repo, name="Sentinels", quest_saved_team_id="quest-team-1")
    repo.miss_next_lookups = 1  # first lookup sees nothing; the re-read sees it
    session = FakeSession()
    svc = _service(repo, session)

    team, created = await svc.create_or_get(
        TeamCreate(name="Sentinels", quest_saved_team_id="quest-team-1")
    )

    assert created is False
    assert session.rolled_back == 1  # the failed insert was rolled back
    assert team.id == existing.id  # reconciled on the key, no new identity
    assert set(repo.teams) == {existing.id}  # nothing extra persisted
