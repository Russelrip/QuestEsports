"""PlayerService unit tests (plan Task 6; design §4.2, §7.1, §14.1).

Fake ``HenrikClient`` + in-memory repository + fake session — no network, no DB.
Covers the local-cache semantics and display-identity refresh contract:

- resolve-new: misses the cache, calls Henrik, upserts by PUUID;
- resolve-cached: a matching ``(name, tag)`` index hit returns the stored row
  without calling Henrik;
- resolve-force: ``force=True`` always re-resolves through Henrik;
- re-resolve: a changed Riot ID mapping to a known PUUID updates the current
  display identity on the same row and never touches ``first_seen_at``;
- Henrik exception translation to the stable ``AppError`` codes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.api.errors import AppError
from app.db.models import Player
from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikNotFoundError,
    HenrikProtocolError,
    HenrikRateLimitError,
    HenrikUnavailableError,
)
from app.integrations.henrik.models import HenrikAccount
from app.schemas.players import PlayerResponse
from app.services.player_service import PlayerService

START = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


class FakeHenrik:
    """Duck-typed stand-in for ``HenrikClient.get_account``."""

    def __init__(
        self,
        *,
        accounts: dict | None = None,
        force_accounts: dict | None = None,
        errors: dict | None = None,
    ) -> None:
        self.accounts = accounts or {}
        self.force_accounts = force_accounts or {}
        self.errors = errors or {}
        self.calls: list[tuple[str, str, bool]] = []

    async def get_account(self, name: str, tag: str, *, force: bool = False) -> HenrikAccount:
        self.calls.append((name, tag, force))
        key = (name.lower(), tag.lower())
        if key in self.errors:
            raise self.errors[key]
        account = (self.force_accounts if force else self.accounts).get(key)
        if account is None:
            raise HenrikNotFoundError("account not found", sub_code=22)
        return account


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0

    async def commit(self) -> None:
        self.committed += 1


class InMemoryPlayerRepository:
    """In-memory mirror of ``PlayerRepository`` over plain ``Player`` objects."""

    def __init__(self) -> None:
        self.by_puuid: dict[str, Player] = {}
        self.by_id: dict[uuid.UUID, Player] = {}

    async def get_by_puuid(self, puuid: str) -> Player | None:
        return self.by_puuid.get(puuid)

    async def get_by_id(self, player_id: uuid.UUID) -> Player | None:
        return self.by_id.get(player_id)

    async def get_by_name_tag(self, name: str, tag: str) -> Player | None:
        for player in self.by_puuid.values():
            if (
                player.current_name.lower() == name.lower()
                and player.current_tag.lower() == tag.lower()
            ):
                return player
        return None

    async def upsert_by_puuid(
        self,
        *,
        puuid: str,
        current_name: str,
        current_tag: str,
        affinity: str | None,
        platforms: list[str],
        henrik_updated_at: datetime | None,
    ) -> Player:
        player = self.by_puuid.get(puuid)
        if player is None:
            player = Player(
                id=uuid.uuid4(),
                puuid=puuid,
                current_name=current_name,
                current_tag=current_tag,
                affinity=affinity,
                platforms=platforms,
                henrik_updated_at=henrik_updated_at,
                first_seen_at=START,
                last_seen_at=START,
                created_at=START,
                updated_at=START,
            )
            self.by_puuid[puuid] = player
            self.by_id[player.id] = player
        else:
            player.current_name = current_name
            player.current_tag = current_tag
            player.affinity = affinity
            player.platforms = platforms
            player.henrik_updated_at = henrik_updated_at
        return player


def _account(
    puuid: str,
    name: str,
    tag: str,
    *,
    region: str = "eu",
    platforms: tuple[str, ...] = ("PC",),
) -> HenrikAccount:
    return HenrikAccount(
        puuid=puuid,
        region=region,
        name=name,
        tag=tag,
        platforms=list(platforms),
        updated_at=datetime(2026, 8, 12, 18, 40, tzinfo=UTC),
    )


def _service(repo: InMemoryPlayerRepository, henrik: FakeHenrik, session: FakeSession | None = None) -> PlayerService:
    return PlayerService(session=session or FakeSession(), henrik=henrik, repo=repo)  # type: ignore[arg-type]


def _seed(repo: InMemoryPlayerRepository, puuid: str = "puuid-1", name: str = "PlayerA", tag: str = "A") -> Player:
    player = Player(
        id=uuid.uuid4(),
        puuid=puuid,
        current_name=name,
        current_tag=tag,
        affinity="eu",
        platforms=["PC"],
        henrik_updated_at=START,
        first_seen_at=START,
        last_seen_at=START,
        created_at=START,
        updated_at=START,
    )
    repo.by_puuid[puuid] = player
    repo.by_id[player.id] = player
    return player


# ------------------------------------------------------------ resolve new

async def test_resolve_new_calls_henrik_and_upserts() -> None:
    henrik = FakeHenrik(accounts={("playera", "a"): _account("puuid-1", "PlayerA", "A")})
    repo = InMemoryPlayerRepository()
    session = FakeSession()
    svc = _service(repo, henrik, session)

    player = await svc.resolve("PlayerA", "A")

    assert henrik.calls == [("PlayerA", "A", False)]
    assert player.puuid == "puuid-1"
    assert player.current_name == "PlayerA"
    assert player.current_tag == "A"
    assert player.affinity == "eu"
    assert player.platforms == ["PC"]
    assert session.committed == 1


# ---------------------------------------------------------- resolve cached

async def test_resolve_cached_skips_henrik_when_index_hits() -> None:
    existing = _seed(InMemoryPlayerRepository())
    repo = InMemoryPlayerRepository()
    repo.by_puuid[existing.puuid] = existing
    repo.by_id[existing.id] = existing
    henrik = FakeHenrik()
    svc = _service(repo, henrik)

    player = await svc.resolve("playera", "a")  # case-insensitive index hit

    assert henrik.calls == []
    assert player is existing


# ---------------------------------------------------------- resolve force

async def test_resolve_force_always_calls_henrik_and_refreshes() -> None:
    repo = InMemoryPlayerRepository()
    _seed(repo)  # cached display identity: PlayerA#A
    henrik = FakeHenrik(
        force_accounts={("playera", "a"): _account("puuid-1", "PlayerForce", "A")}
    )
    svc = _service(repo, henrik)

    player = await svc.resolve("PlayerA", "A", force=True)

    assert henrik.calls == [("PlayerA", "A", True)]
    assert player.id == repo.by_puuid["puuid-1"].id
    assert player.current_name == "PlayerForce"  # display identity refreshed


# ------------------------------------------------------------ re-resolve

async def test_re_resolve_same_puuid_new_name_updates_display_and_keeps_first_seen() -> None:
    henrik = FakeHenrik(
        accounts={
            ("playera", "a"): _account("puuid-1", "PlayerA", "A"),
            ("newname", "nt"): _account("puuid-1", "NewName", "NT"),
        }
    )
    repo = InMemoryPlayerRepository()
    svc = _service(repo, henrik)

    first = await svc.resolve("PlayerA", "A")
    second = await svc.resolve("NewName", "NT")

    assert second.id == first.id  # same row, no new row
    assert second.puuid == "puuid-1"
    assert second.current_name == "NewName"
    assert second.current_tag == "NT"
    assert second.first_seen_at == first.first_seen_at


# ------------------------------------------------------- error translation

@pytest.mark.parametrize(
    ("error", "expected_code", "expected_status"),
    [
        (HenrikNotFoundError("missing", sub_code=22), "PLAYER_NOT_FOUND", 404),
        (HenrikNotFoundError("missing", sub_code=23), "PLAYER_REGION_UNKNOWN", 404),
        (HenrikNotFoundError("missing", sub_code=None), "PLAYER_NOT_FOUND", 404),
        (HenrikAuthenticationError("bad key"), "HENRIK_AUTH_FAILED", 502),
        (
            HenrikRateLimitError("slow down", retry_after=2.0, rate_limit_reset=1700000000),
            "HENRIK_RATE_LIMITED",
            429,
        ),
        (HenrikUnavailableError("down"), "HENRIK_UNAVAILABLE", 503),
        (HenrikProtocolError("unexpected envelope shape"), "HENRIK_UNAVAILABLE", 503),
    ],
)
async def test_henrik_errors_translate_to_app_errors(
    error: Exception, expected_code: str, expected_status: int
) -> None:
    henrik = FakeHenrik(errors={("playera", "a"): error})
    svc = _service(InMemoryPlayerRepository(), henrik)

    with pytest.raises(AppError) as excinfo:
        await svc.resolve("PlayerA", "A")

    assert excinfo.value.code == expected_code
    assert excinfo.value.status == expected_status


async def test_resolve_empty_upstream_puuid_returns_henrik_unavailable() -> None:
    henrik = FakeHenrik(accounts={("playera", "a"): _account("", "PlayerA", "A")})
    svc = _service(InMemoryPlayerRepository(), henrik)

    with pytest.raises(AppError) as excinfo:
        await svc.resolve("PlayerA", "A")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503


async def test_blank_identity_raises_invalid_riot_id() -> None:
    svc = _service(InMemoryPlayerRepository(), FakeHenrik())

    with pytest.raises(AppError) as excinfo:
        await svc.resolve("   ", "A")

    assert excinfo.value.code == "INVALID_RIOT_ID"
    assert excinfo.value.status == 422


# ------------------------------------------------- platforms list/dict contract

def test_player_response_accepts_list_platforms() -> None:
    resp = PlayerResponse(id=uuid.uuid4(), puuid="p", name="A", tag="B", platforms=["PC"])
    assert resp.platforms == ["PC"]


def test_player_response_rejects_dict_platforms() -> None:
    # ``platforms`` is ``list[str]`` end-to-end; a dict must fail validation
    # rather than being silently coerced into an incorrect shape.
    with pytest.raises(ValidationError):
        PlayerResponse(id=uuid.uuid4(), puuid="p", name="A", tag="B", platforms={"PC": 1})


# ------------------------------------------------------------ lookups

async def test_get_by_id_missing_raises_player_not_found() -> None:
    svc = _service(InMemoryPlayerRepository(), FakeHenrik())

    with pytest.raises(AppError) as excinfo:
        await svc.get_by_id(uuid.uuid4())

    assert excinfo.value.code == "PLAYER_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_get_by_puuid_missing_raises_player_not_found() -> None:
    svc = _service(InMemoryPlayerRepository(), FakeHenrik())

    with pytest.raises(AppError) as excinfo:
        await svc.get_by_puuid("puuid-unknown")

    assert excinfo.value.code == "PLAYER_NOT_FOUND"
    assert excinfo.value.status == 404


async def test_get_by_id_returns_stored_player() -> None:
    repo = InMemoryPlayerRepository()
    existing = _seed(repo)
    svc = _service(repo, FakeHenrik())

    player = await svc.get_by_id(existing.id)

    assert player is existing
