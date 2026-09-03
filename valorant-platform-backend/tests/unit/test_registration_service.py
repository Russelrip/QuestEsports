"""``RegistrationService`` tests (SDD 2026-08-14 leaderboard standardization, task 5).

Fake ``HenrikClient`` (stub ``get_player_mmr`` / ``get_last_competitive_match``)
+ fake ``LeaderboardPlayerRepository`` (``get_by_puuid`` / ``get_by_discord_id`` /
``upsert``) + fake session — no network, no DB. Covers the 409 duplicate gates,
the ``PlayerPreview`` build (including the unranked ``Unrated``/``elo=0`` case),
the upsert field contract + ``{success, message, player}`` envelope, and the
Henrik error translation (R14). The settings reader is monkeypatched to a fixed
``Settings`` so ``leaderboard_affinity``/``leaderboard_platform`` are pinned.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.api.errors import AppError
from app.config import Settings
from app.integrations.henrik.exceptions import HenrikNotFoundError, HenrikRateLimitError
from app.schemas.registration import PlayerPreview
from app.services import registration_service
from app.services.registration_service import RegistrationService

SETTINGS = Settings(app_env="test", leaderboard_affinity="ap", leaderboard_platform="pc")

MMR = {
    "name": "PlayerA",
    "tag": "A",
    "rank_details": {
        "currenttierpatched": "Gold 1",
        "current_tier": 21,
        "elo": 1200,
        "ranking_in_tier": 55,
        "games_needed_for_rating": 1,
    },
    "peak_rank": {"tier_name": "Platinum 1", "season_short": "e9a3", "tier": 24},
    "seasonal_ranks": [],
}

UNRANKED_MMR = {
    "name": "Fresh",
    "tag": "NEW",
    "rank_details": {
        "currenttierpatched": "Unrated",
        "current_tier": 0,
        "elo": 0,
        "ranking_in_tier": 0,
        "games_needed_for_rating": 0,
    },
    "peak_rank": {"tier_name": "Unknown", "season_short": "Unknown", "tier": 0},
    "seasonal_ranks": [],
}


class FakeHenrik:
    """Duck-typed stand-in for the ``HenrikClient`` methods the service uses."""

    def __init__(
        self,
        *,
        mmr: dict | None = None,
        last_played: str | None = None,
        errors: dict[str, Exception] | None = None,
    ) -> None:
        self.mmr = mmr
        self.last_played = last_played
        self.errors = errors or {}
        self.calls: list[str] = []

    async def get_player_mmr(self, puuid: str, *, affinity: str, platform: str) -> dict:
        self.calls.append("mmr")
        if "mmr" in self.errors:
            raise self.errors["mmr"]
        if self.mmr is None:
            raise HenrikNotFoundError("player not found", sub_code=22)
        return self.mmr

    async def get_last_competitive_match(
        self, puuid: str, *, affinity: str, platform: str
    ) -> str | None:
        self.calls.append("last_match")
        if "last_match" in self.errors:
            raise self.errors["last_match"]
        return self.last_played


class _Player:
    """Minimal stand-in for the ``LeaderboardPlayer`` row the fake upsert returns."""

    def __init__(self, **fields: object) -> None:
        self.__dict__.update(fields)


class FakeRepo:
    """In-memory mirror of the ``LeaderboardPlayerRepository`` read/write surface."""

    def __init__(
        self,
        *,
        by_puuid: dict[str, object] | None = None,
        by_discord_id: dict[str, object] | None = None,
    ) -> None:
        self.by_puuid = by_puuid or {}
        self.by_discord_id = by_discord_id or {}
        self.upserted: dict | None = None

    async def get_by_puuid(self, puuid: str) -> object | None:
        return self.by_puuid.get(puuid)

    async def get_by_discord_id(self, discord_id: str) -> object | None:
        return self.by_discord_id.get(str(discord_id))

    async def upsert(self, **fields) -> _Player:
        self.upserted = fields
        return _Player(
            puuid=fields["puuid"],
            name=fields["name"],
            tag=fields["tag"],
            currenttierpatched=fields["currenttierpatched"],
            elo=fields["elo"],
        )


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0

    async def commit(self) -> None:
        self.committed += 1


def _service(
    repo: FakeRepo,
    henrik: FakeHenrik,
    monkeypatch: pytest.MonkeyPatch,
    session: FakeSession | None = None,
) -> RegistrationService:
    monkeypatch.setattr(registration_service, "get_settings", lambda: SETTINGS)
    return RegistrationService(session=session or FakeSession(), henrik=henrik, repo=repo)  # type: ignore[arg-type]


# --------------------------------------------------------------- preview 409

async def test_preview_409_when_puuid_already_registered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = FakeRepo(by_puuid={"puuid-1": object()})
    svc = _service(repo, FakeHenrik(mmr=MMR), monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.preview("puuid-1")

    assert excinfo.value.code == "PUUID_ALREADY_REGISTERED"
    assert excinfo.value.status == 409


# ------------------------------------------------------- preview from MMR

async def test_preview_builds_player_preview_from_mapped_mmr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    henrik = FakeHenrik(mmr=MMR, last_played="2026-01-02T03:04:05+00:00")
    svc = _service(FakeRepo(), henrik, monkeypatch)

    preview = await svc.preview("puuid-1")

    assert isinstance(preview, PlayerPreview)
    assert preview.puuid == "puuid-1"
    assert preview.name == "PlayerA"
    assert preview.tag == "A"
    assert preview.current_rank == "Gold 1"
    assert preview.elo == 1200
    assert preview.peak_rank == "Platinum 1"
    assert preview.peak_season == "e9a3"
    assert preview.last_played == "2026-01-02T03:04:05+00:00"
    assert henrik.calls == ["mmr", "last_match"]


async def test_preview_unranked_returns_unrated_preview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    henrik = FakeHenrik(mmr=UNRANKED_MMR, last_played=None)
    svc = _service(FakeRepo(), henrik, monkeypatch)

    preview = await svc.preview("puuid-fresh")

    assert preview.current_rank == "Unrated"
    assert preview.elo == 0
    assert preview.peak_rank == "Unknown"
    assert preview.peak_season == "Unknown"
    assert preview.last_played is None


# ---------------------------------------------------- preview error mapping

async def test_preview_maps_henrik_not_found_to_player_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    henrik = FakeHenrik(errors={"mmr": HenrikNotFoundError("no such player", sub_code=22)})
    svc = _service(FakeRepo(), henrik, monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.preview("puuid-x")

    assert excinfo.value.code == "PLAYER_NOT_FOUND"
    assert excinfo.value.status == 404


# ---------------------------------------------------------------- submit 409

async def test_submit_409_when_discord_already_registered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = FakeRepo(by_discord_id={"123456789": object()})
    svc = _service(repo, FakeHenrik(mmr=MMR), monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.submit(discord_id="123456789", discord_username="playerone", puuid="puuid-1")

    assert excinfo.value.code == "DISCORD_ALREADY_REGISTERED"
    assert excinfo.value.status == 409


async def test_submit_409_when_puuid_already_registered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = FakeRepo(by_puuid={"puuid-1": object()})
    svc = _service(repo, FakeHenrik(mmr=MMR), monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.submit(discord_id="123", discord_username="u", puuid="puuid-1")

    assert excinfo.value.code == "PUUID_ALREADY_REGISTERED"
    assert excinfo.value.status == 409


# ---------------------------------------------------------- submit + upsert

async def test_submit_upserts_and_returns_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    henrik = FakeHenrik(mmr=MMR, last_played="2026-01-02T03:04:05+00:00")
    repo = FakeRepo()
    session = FakeSession()
    svc = _service(repo, henrik, monkeypatch, session)

    resp = await svc.submit(
        discord_id="12345678901234567", discord_username="playerone", puuid="puuid-1"
    )

    assert repo.upserted is not None
    assert repo.upserted["puuid"] == "puuid-1"
    assert repo.upserted["name"] == "PlayerA"
    assert repo.upserted["tag"] == "A"
    assert repo.upserted["region"] == "ap"
    assert repo.upserted["discord_id"] == "12345678901234567"
    assert repo.upserted["discord_username"] == "playerone"
    assert repo.upserted["elo"] == 1200
    assert repo.upserted["currenttierpatched"] == "Gold 1"
    assert repo.upserted["rank_details"] == MMR["rank_details"]
    assert repo.upserted["peak_rank"] == MMR["peak_rank"]
    assert repo.upserted["seasonal_ranks"] == []
    assert repo.upserted["last_played_match"] == datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    assert repo.upserted["update_source"] == "registration_service"
    assert session.committed == 1

    assert resp.success is True
    assert resp.message == "Registration successful"
    assert resp.player.puuid == "puuid-1"
    assert resp.player.name == "PlayerA"
    assert resp.player.tag == "A"
    assert resp.player.current_rank == "Gold 1"
    assert resp.player.elo == 1200


async def test_submit_none_last_played_stays_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    henrik = FakeHenrik(mmr=MMR, last_played=None)
    repo = FakeRepo()
    svc = _service(repo, henrik, monkeypatch)

    await svc.submit(discord_id="123", discord_username="u", puuid="puuid-1")

    assert repo.upserted is not None
    assert repo.upserted["last_played_match"] is None


# ----------------------------------------------------- submit error mapping

async def test_submit_maps_henrik_rate_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    henrik = FakeHenrik(
        errors={"mmr": HenrikRateLimitError("slow down", retry_after=2.0, rate_limit_reset=1700000000)}
    )
    svc = _service(FakeRepo(), henrik, monkeypatch)

    with pytest.raises(AppError) as excinfo:
        await svc.submit(discord_id="123", discord_username="u", puuid="puuid-1")

    assert excinfo.value.code == "HENRIK_RATE_LIMITED"
    assert excinfo.value.status == 429
