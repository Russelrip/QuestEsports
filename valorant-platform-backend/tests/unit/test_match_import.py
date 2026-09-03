"""MatchImportService unit tests (plan Task 8 + fix round 1; design §5.4,
§7.2–7.4, §11.1).

A fixture-driven fake ``HenrikClient`` serves the checked-in v4 match-detail
fixtures through the real ``HenrikMapper`` (envelope validation + side
normalization included — no network), and in-memory fakes back the player /
match repositories so nothing touches a database. Covers:

- new match → ``created=true``, raw detail payload persisted verbatim, player
  rows + match_players snapshots persisted;
- same match twice → second import ``created=false`` with the same row, no new
  rows (fix round 1: the fetch precedes the idempotency recheck, so the second
  import does re-fetch);
- a known player reuses its canonical row (upsert by PUUID) and its
  account-derived metadata (affinity/platforms/``henrik_updated_at``) is
  preserved; a brand-new player is created with NULL account metadata (never
  fabricated fallbacks);
- a player's Riot ID changed in the payload updates the player row's display
  identity while the snapshot keeps the payload names verbatim;
- missing optional stats import successfully with null columns;
- missing required fields fail loudly as ``HENRIK_UNAVAILABLE`` 503 with
  nothing persisted: missing puuid (mapper), missing team_id, missing
  ``is_completed`` (raw-key absence), null ``is_completed``, empty players,
  empty player identity strings, empty ``metadata.match_id``, and a
  ``metadata.match_id`` that does not match the requested id (identity
  binding — no write is ever attempted);
- ``is_completed=false`` → ``MATCH_NOT_COMPLETED`` 422 (only an explicit
  ``false``, never a missing/null completion);
- invalid ``match_id`` → ``INVALID_RIOT_ID`` 422 before any fetch;
- upstream failure → ``HENRIK_UNAVAILABLE`` with NO database access at all
  (fetch + validation precede the write transaction);
- ``refresh=true`` on a match attached to a finalized series →
  ``MATCH_REFRESH_REJECTED`` 409;
- ``refresh=true`` on an unattached match re-fetches and updates in place
  (``created=false``; the row's ``henrik_match_id`` is never renamed).
"""

from __future__ import annotations

import json
import uuid
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.api.errors import AppError
from app.db.models import Match, MatchPlayer, Player, Series
from app.integrations.henrik.exceptions import HenrikUnavailableError
from app.integrations.henrik.mapper import HenrikMapper
from app.integrations.henrik.models import HenrikMatchDetailEnvelope
from app.services.match_import_service import MatchImportService

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"

MATCH_ID_1 = "00000000-0000-0000-0000-000000000001"
STARTED_AT = datetime(2026, 8, 12, 18, 40, tzinfo=UTC)


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _craft(metadata_overrides: dict | None = None, **data_overrides) -> dict:
    """A completed-custom fixture with overridden ``data`` fields."""
    fixture = deepcopy(_load("completed_custom.json"))
    if metadata_overrides:
        fixture["data"]["metadata"].update(metadata_overrides)
    for key, value in data_overrides.items():
        fixture["data"][key] = value
    return fixture


# ---------------------------------------------------------------- fakes


class FakeSession:
    def __init__(self) -> None:
        self.committed = 0
        self.rollbacks = 0
        self.nested = 0

    async def commit(self) -> None:
        self.committed += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    def begin_nested(self):
        self.nested += 1
        return _Savepoint()


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeHenrik:
    """Serves pinned match-detail fixtures through the real mapper."""

    def __init__(self, fixtures: dict[str, dict]) -> None:
        self.fixtures = fixtures
        self.calls: list[tuple[str, str]] = []
        self._mapper = HenrikMapper()

    async def get_match_detail(self, match_id: str, *, affinity: str) -> HenrikMatchDetailEnvelope:
        self.calls.append((match_id, affinity))
        envelope = self.fixtures[match_id]
        return HenrikMatchDetailEnvelope(
            status=envelope["status"],
            data=self._mapper.to_match_detail(envelope["data"]),
            raw=envelope,
        )


class _FailingHenrik:
    """Raises before any payload work; proves fetch precedes DB access."""

    async def get_match_detail(self, match_id: str, *, affinity: str):
        raise HenrikUnavailableError("upstream down", request_id=None)


class FakePlayerRepository:
    def __init__(self, players: list[Player] | None = None) -> None:
        self.players: dict[str, Player] = {p.puuid: p for p in players or []}

    async def get_by_puuid(self, puuid: str) -> Player | None:
        return self.players.get(puuid)

    async def upsert_by_puuid(
        self,
        *,
        puuid: str,
        current_name: str,
        current_tag: str,
        affinity: str | None,
        platforms: list,
        henrik_updated_at,
    ) -> Player:
        player = self.players.get(puuid)
        if player is None:
            player = Player(
                id=uuid.uuid4(),
                puuid=puuid,
                current_name=current_name,
                current_tag=current_tag,
                affinity=affinity,
                platforms=platforms,
            )
            self.players[puuid] = player
        else:
            player.current_name = current_name
            player.current_tag = current_tag
            player.affinity = affinity
            player.platforms = platforms
        return player

    async def upsert_imported(self, *, puuid: str, current_name: str, current_tag: str) -> Player:
        """Display-identity-only upsert; account metadata is preserved."""
        player = self.players.get(puuid)
        if player is None:
            player = Player(
                id=uuid.uuid4(),
                puuid=puuid,
                current_name=current_name,
                current_tag=current_tag,
            )
            self.players[puuid] = player
        else:
            player.current_name = current_name
            player.current_tag = current_tag
        return player


class FakeMatchRepository:
    def __init__(
        self,
        *,
        finalized_series: set[uuid.UUID] | None = None,
        draft_series: set[uuid.UUID] | None = None,
    ) -> None:
        self.matches: dict[str, Match] = {}
        self.match_players: dict[uuid.UUID, list[MatchPlayer]] = {}
        # Match ids of matches attached to a finalized / draft series (the
        # refresh/finalize race protocol the import service drives).
        self.finalized_series = finalized_series or set()
        self.draft_series = draft_series or set()
        self.prechecks = 0

    async def get_imported_henrik_match_ids(self, henrik_match_ids) -> dict[str, uuid.UUID]:
        return {
            mid: self.matches[mid].id for mid in set(henrik_match_ids) if mid in self.matches
        }

    async def get_by_henrik_match_id(self, henrik_match_id: str) -> Match | None:
        self.prechecks += 1
        return self.matches.get(henrik_match_id)

    async def get_by_id(self, match_id: uuid.UUID) -> Match | None:
        for match in self.matches.values():
            if match.id == match_id:
                return match
        return None

    async def get_players_for_match(self, match_id: uuid.UUID) -> list[MatchPlayer]:
        return list(self.match_players.get(match_id, []))

    async def insert_match(self, **values) -> Match:
        if values["henrik_match_id"] in self.matches:
            raise AssertionError("duplicate henrik_match_id")
        match = Match(id=uuid.uuid4(), **values)
        self.matches[match.henrik_match_id] = match
        self.match_players.setdefault(match.id, [])
        return match

    async def insert_match_players(self, *, match_id: uuid.UUID, snapshots: list[dict]) -> list[MatchPlayer]:
        rows = [MatchPlayer(id=uuid.uuid4(), match_id=match_id, **snapshot) for snapshot in snapshots]
        self.match_players[match_id].extend(rows)
        return rows

    async def update_match(self, *, match_id: uuid.UUID, **values) -> Match:
        match = await self.get_by_id(match_id)
        for key, value in values.items():
            setattr(match, key, value)
        return match

    async def replace_match_players(self, *, match_id: uuid.UUID, snapshots: list[dict]) -> list[MatchPlayer]:
        self.match_players[match_id] = []
        return await self.insert_match_players(match_id=match_id, snapshots=snapshots)

    async def get_owning_series_for_update(self, match_id: uuid.UUID) -> Series | None:
        """Mirror the refresh/finalize race protocol: a match attached to a
        finalized series returns a locked finalized Series; a draft-attached
        match returns a draft Series; an unattached match returns None."""
        if match_id in self.finalized_series:
            return Series(status="finalized")
        if match_id in self.draft_series:
            return Series(status="draft")
        return None


def _service(
    henrik,
    *,
    match_repo: FakeMatchRepository | None = None,
    player_repo: FakePlayerRepository | None = None,
    session: FakeSession | None = None,
) -> MatchImportService:
    return MatchImportService(
        session=session or FakeSession(),  # type: ignore[arg-type]
        henrik=henrik,  # type: ignore[arg-type]
        player_repo=player_repo or FakePlayerRepository(),  # type: ignore[arg-type]
        match_repo=match_repo or FakeMatchRepository(),  # type: ignore[arg-type]
        mapper=HenrikMapper(),
    )


# ------------------------------------------------------------ new match


async def test_new_match_import_created_true_and_raw_payload_verbatim() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    player_repo = FakePlayerRepository()
    svc = _service(henrik, match_repo=match_repo, player_repo=player_repo)

    result = await svc.import_match(MATCH_ID_1, "eu")

    assert result.created is True
    match = result.match
    assert match.henrik_match_id == MATCH_ID_1
    assert match.affinity == "eu"
    assert match.platform == "pc"
    assert match.map_id == "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319"
    assert match.map_name == "Ascent"
    assert match.mode == "Custom"
    assert match.started_at == STARTED_AT
    assert match.is_completed is True
    assert match.red_score == 13
    assert match.blue_score == 9
    assert match.winning_side == "red"
    assert match.raw_payload_available is True
    assert len(match.players) == 2

    stored = match_repo.matches[MATCH_ID_1]
    # raw detail data object persisted verbatim, never normalized
    assert stored.raw_payload == fixture["data"]

    snapshots = match_repo.match_players[stored.id]
    assert len(snapshots) == 2
    by_puuid = {p.puuid_snapshot: p for p in snapshots}
    assert by_puuid["puuid_p_a"].name_snapshot == "PlayerA"
    assert by_puuid["puuid_p_a"].tag_snapshot == "A"
    assert by_puuid["puuid_p_a"].side == "red"
    assert by_puuid["puuid_p_a"].kills == 21
    assert by_puuid["puuid_p_a"].deaths == 11
    assert by_puuid["puuid_p_b"].side == "blue"
    assert by_puuid["puuid_p_b"].name_snapshot == "PlayerB"
    # per-player raw payloads are the players[] objects verbatim
    assert snapshots[0].raw_player_payload == fixture["data"]["players"][0]
    assert snapshots[1].raw_player_payload == fixture["data"]["players"][1]
    # player rows upserted by puuid
    assert set(player_repo.players) == {"puuid_p_a", "puuid_p_b"}
    assert player_repo.players["puuid_p_a"].current_name == "PlayerA"


# ------------------------------------------------------------ idempotency


async def test_same_match_twice_second_created_false_no_new_rows() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    first = await svc.import_match(MATCH_ID_1, "eu")
    second = await svc.import_match(MATCH_ID_1, "eu")

    assert first.created is True
    assert second.created is False
    assert second.match.id == first.match.id
    assert second.match.players == first.match.players
    assert len(match_repo.matches) == 1
    assert len(match_repo.match_players[first.match.id]) == 2
    # fix round 1: fetch precedes the idempotency recheck, so the second
    # import does re-fetch (the DB transaction opens only after validation)
    assert henrik.calls == [(MATCH_ID_1, "eu"), (MATCH_ID_1, "eu")]


async def test_import_with_known_player_reuses_player_row() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    seeded = Player(
        id=uuid.uuid4(),
        puuid="puuid_p_a",
        current_name="PlayerA",
        current_tag="A",
        affinity="eu",
        platforms=["PC"],
    )
    player_repo = FakePlayerRepository(players=[seeded])
    svc = _service(henrik, player_repo=player_repo)

    result = await svc.import_match(MATCH_ID_1, "eu")

    assert len(player_repo.players) == 2  # puuid_p_a reused, puuid_p_b created
    assert player_repo.players["puuid_p_a"].id == seeded.id
    player_ids = {player.player_id for player in result.match.players}
    assert seeded.id in player_ids


async def test_changed_riot_id_updates_player_row_keeps_snapshot_verbatim() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    seeded = Player(
        id=uuid.uuid4(),
        puuid="puuid_p_a",
        current_name="OldName",
        current_tag="OldTag",
        affinity="na",
        platforms=["PC"],
    )
    player_repo = FakePlayerRepository(players=[seeded])
    svc = _service(henrik, player_repo=player_repo)

    result = await svc.import_match(MATCH_ID_1, "eu")

    # player row display identity follows the payload
    assert player_repo.players["puuid_p_a"].current_name == "PlayerA"
    assert player_repo.players["puuid_p_a"].current_tag == "A"
    # snapshot preserves the payload names, never the pre-import display values
    snapshot = {player.puuid: player for player in result.match.players}["puuid_p_a"]
    assert snapshot.name == "PlayerA"
    assert snapshot.tag == "A"
    assert snapshot.name != "OldName"
    assert snapshot.tag != "OldTag"


# ------------------------------------------------ account metadata preserved


async def test_known_player_account_metadata_preserved_by_import() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    seeded = Player(
        id=uuid.uuid4(),
        puuid="puuid_p_a",
        current_name="PlayerA",
        current_tag="A",
        affinity="na",
        platforms=["PC", "Console"],
        henrik_updated_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
    )
    player_repo = FakePlayerRepository(players=[seeded])
    svc = _service(henrik, player_repo=player_repo)

    await svc.import_match(MATCH_ID_1, "eu")

    # import writes display identity only — account-derived metadata survives
    row = player_repo.players["puuid_p_a"]
    assert row.current_name == "PlayerA"
    assert row.affinity == "na"
    assert row.platforms == ["PC", "Console"]
    assert row.henrik_updated_at == datetime(2026, 8, 12, 12, 0, tzinfo=UTC)


async def test_new_player_import_creates_without_fabricated_metadata() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    player_repo = FakePlayerRepository()
    svc = _service(henrik, player_repo=player_repo)

    await svc.import_match(MATCH_ID_1, "eu")

    row = player_repo.players["puuid_p_a"]
    assert row.current_name == "PlayerA"
    assert row.affinity is None  # never fabricated from match data
    assert row.platforms is None
    assert row.henrik_updated_at is None


# -------------------------------------------------------- optional stats


async def test_missing_optional_stats_import_succeeds_with_nulls() -> None:
    fixture = _load("missing_optional_stats.json")
    match_id = fixture["data"]["metadata"]["match_id"]
    henrik = FakeHenrik({match_id: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    result = await svc.import_match(match_id, "eu")

    assert result.created is True
    assert result.match.map_name == "Haven"
    assert result.match.red_score == 13
    assert result.match.blue_score == 4
    assert result.match.winning_side == "red"
    assert len(result.match.players) == 2
    for player in result.match.players:
        assert player.kills is None
        assert player.deaths is None
        assert player.assists is None
        assert player.score_total is None
        assert player.damage_dealt is None
        assert player.damage_received is None
        assert player.headshots is None
        assert player.bodyshots is None
        assert player.legshots is None
        assert player.agent_name is None
    stored = match_repo.matches[match_id]
    for snapshot in match_repo.match_players[stored.id]:
        assert snapshot.kills is None
        # raw player payload is the players[] object verbatim — identity present, stats absent
        assert "stats" not in snapshot.raw_player_payload


# ------------------------------------------------------ missing required


async def test_missing_required_puuid_fails_loudly() -> None:
    fixture = _load("malformed_required.json")
    match_id = fixture["data"]["metadata"]["match_id"]
    henrik = FakeHenrik({match_id: fixture})
    match_repo = FakeMatchRepository()
    player_repo = FakePlayerRepository()
    svc = _service(henrik, match_repo=match_repo, player_repo=player_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(match_id, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}
    assert player_repo.players == {}


async def test_missing_required_team_id_fails_loudly() -> None:
    # Parses cleanly (team_id is tolerant at the model layer) but the service
    # gate rejects it: a participant without a side is not importable.
    fixture = deepcopy(_load("completed_custom.json"))
    match_id = fixture["data"]["metadata"]["match_id"]
    del fixture["data"]["players"][0]["team_id"]
    henrik = FakeHenrik({match_id: fixture})
    match_repo = FakeMatchRepository()
    player_repo = FakePlayerRepository()
    svc = _service(henrik, match_repo=match_repo, player_repo=player_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(match_id, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}
    assert player_repo.players == {}


# ------------------------------- completion: missing/null vs explicit false


async def test_missing_is_completed_rejected_as_protocol_error() -> None:
    # Missing is_completed is a malformed payload (protocol), NOT an
    # incomplete match: the model default must not hide the missing key.
    fixture = _craft(metadata_overrides={})
    del fixture["data"]["metadata"]["is_completed"]
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}


async def test_null_is_completed_rejected_as_protocol_error() -> None:
    fixture = _craft(metadata_overrides={"is_completed": None})
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}


async def test_incomplete_match_rejected() -> None:
    fixture = _load("incomplete.json")
    match_id = fixture["data"]["metadata"]["match_id"]
    henrik = FakeHenrik({match_id: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(match_id, "eu")

    assert excinfo.value.code == "MATCH_NOT_COMPLETED"
    assert excinfo.value.status == 422
    assert match_repo.matches == {}


# ---------------------------------------- empty participants / identities


async def test_empty_players_rejected() -> None:
    fixture = _craft(players=[])
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}


async def test_empty_player_identity_rejected() -> None:
    fixture = _craft()
    fixture["data"]["players"][0]["puuid"] = ""
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}


async def test_empty_match_id_rejected() -> None:
    fixture = _craft(metadata_overrides={"match_id": ""})
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}


# ------------------------------------------------------- identity binding


async def test_match_id_mismatch_rejected_without_writes() -> None:
    # The upstream detail carries a different match_id than the request: it
    # must never be imported under the request's id.
    fixture = _craft(metadata_overrides={"match_id": "00000000-0000-0000-0000-000000000099"})
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    player_repo = FakePlayerRepository()
    session = FakeSession()
    svc = _service(henrik, match_repo=match_repo, player_repo=player_repo, session=session)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    assert match_repo.matches == {}
    assert match_repo.prechecks == 0  # no DB access at all
    assert player_repo.players == {}
    assert session.nested == 0
    assert session.committed == 0


# -------------------------------------------------------- invalid match id


async def test_invalid_match_id_rejected_before_fetch() -> None:
    henrik = FakeHenrik({})
    svc = _service(henrik)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match("ZZZ", "eu")

    assert excinfo.value.code == "INVALID_RIOT_ID"
    assert excinfo.value.status == 422
    assert henrik.calls == []


# ------------------------------------------- upstream failure → no DB access


async def test_upstream_failure_leaves_no_db_access() -> None:
    session = FakeSession()
    match_repo = FakeMatchRepository()
    player_repo = FakePlayerRepository()
    svc = _service(_FailingHenrik(), match_repo=match_repo, player_repo=player_repo, session=session)

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu")

    assert excinfo.value.code == "HENRIK_UNAVAILABLE"
    assert excinfo.value.status == 503
    # the fetch failed before the DB transaction was ever opened
    assert match_repo.prechecks == 0
    assert match_repo.matches == {}
    assert player_repo.players == {}
    assert session.nested == 0
    assert session.committed == 0
    assert session.rollbacks == 0


# ----------------------------------------------------------------- refresh


async def test_refresh_rejected_for_finalized_series_match() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)
    first = await svc.import_match(MATCH_ID_1, "eu")
    match_repo.finalized_series = {first.match.id}

    with pytest.raises(AppError) as excinfo:
        await svc.import_match(MATCH_ID_1, "eu", refresh=True)

    assert excinfo.value.code == "MATCH_REFRESH_REJECTED"
    assert excinfo.value.status == 409
    # fix round 1: the fetch precedes the DB recheck/refresh gate
    assert henrik.calls == [(MATCH_ID_1, "eu"), (MATCH_ID_1, "eu")]


async def test_refresh_allowed_for_draft_series_match() -> None:
    """fix round 1: a match attached to a DRAFT series may be refreshed — the
    finalize that later consumes it reads the refreshed canonical state."""
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)
    first = await svc.import_match(MATCH_ID_1, "eu")
    match_repo.draft_series = {first.match.id}

    result = await svc.import_match(MATCH_ID_1, "eu", refresh=True)

    assert result.created is False
    assert result.match.id == first.match.id  # refreshed in place, not rejected
    assert result.match.henrik_match_id == MATCH_ID_1  # never renamed


async def test_refresh_updates_existing_match_in_place() -> None:
    fixture = _load("completed_custom.json")
    henrik = FakeHenrik({MATCH_ID_1: fixture})
    match_repo = FakeMatchRepository()
    svc = _service(henrik, match_repo=match_repo)
    first = await svc.import_match(MATCH_ID_1, "eu")

    result = await svc.import_match(MATCH_ID_1, "eu", refresh=True)

    assert result.created is False
    assert result.match.id == first.match.id
    assert result.match.henrik_match_id == MATCH_ID_1  # never renamed
    assert len(henrik.calls) == 2  # re-fetched on refresh
    assert len(match_repo.matches) == 1
    assert len(match_repo.match_players[first.match.id]) == 2
