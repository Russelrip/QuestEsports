"""Real-Postgres Match Library API integration tests (plan Task 9, App. D).

Three fixture matches are imported via the real import service against the
migrated schema, then every read route is exercised end-to-end through the
FastAPI test client:

- list returns all matches newest-first with ``total``; ``map``/``from``/``to``/
  ``player_puuid`` filters; keyset cursor pagination with ``next_cursor`` and no
  overlap;
- detail by internal UUID and by canonical Henrik Match ID, served entirely
  from Supabase — a raise-if-called fake ``HenrikClient`` is injected to prove
  no upstream invocation happens during reads;
- stable errors: missing rows → ``MATCH_NOT_FOUND`` 404; malformed internal-UUID
  path → ``INVALID_RIOT_ID`` 422; bad list query values → ``INVALID_REQUEST`` 422;
  malformed, nonexistent, and cross-filter cursors behave per contract (fix
  round 1);
- raw payload: the ``raw_payload`` key is *omitted* from detail by default;
  echoed verbatim only when ``Settings.raw_payload_in_responses`` opts in
  (fix round 1);
- determinism: participant snapshots are returned in a stable order across
  repeated detail reads; concurrent missing lookups both return ``MATCH_NOT_FOUND``
  (fix round 1).

The app is built with ``app_env="test"`` (patched ``get_settings``) so the
service-token gate bypasses exactly like the other API test suites (delta D1;
spec §6.3) — the library reads need no token in the test env.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from pathlib import Path

import httpx

from app.api.dependencies import get_henrik_client, get_library_service
from app.config import Settings
from app.db.repositories.match_repository import MatchRepository
from app.integrations.henrik.mapper import HenrikMapper
from app.integrations.henrik.models import HenrikMatchDetailEnvelope
from app.main import create_app
from app.services.match_import_service import MatchImportService
from app.services.match_library_service import MatchLibraryService

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "match_detail_v4"

HENRIK_1 = "00000000-0000-0000-0000-000000000001"
HENRIK_2 = "00000000-0000-0000-0000-000000000002"
HENRIK_3 = "00000000-0000-0000-0000-000000000003"


def _load(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def _craft(*, match_id: str, map_name: str, started_at: str, puuids: tuple[str, str]) -> dict:
    """A completed-custom variant: distinct identity, map, time, participants."""
    fixture = deepcopy(_load("completed_custom.json"))
    fixture["data"]["metadata"]["match_id"] = match_id
    fixture["data"]["metadata"]["map"] = {"id": f"map-{map_name.lower()}", "name": map_name}
    fixture["data"]["metadata"]["started_at"] = started_at
    for player, puuid in zip(fixture["data"]["players"], puuids, strict=True):
        player["puuid"] = puuid
        player["name"] = f"Player{puuid[-1].upper()}"
    return fixture


FIXTURE_1 = _craft(
    match_id=HENRIK_1, map_name="Ascent", started_at="2026-08-12T18:40:00Z",
    puuids=("puuid_p_a", "puuid_p_b"),
)
FIXTURE_2 = _craft(
    match_id=HENRIK_2, map_name="Bind", started_at="2026-08-11T10:00:00Z",
    puuids=("puuid_p_c", "puuid_p_d"),
)
FIXTURE_3 = _craft(
    match_id=HENRIK_3, map_name="Ascent", started_at="2026-08-10T12:00:00Z",
    puuids=("puuid_p_e", "puuid_p_f"),
)


class FakeHenrik:
    """Serves pinned match-detail fixtures through the real mapper."""

    def __init__(self, fixtures: dict[str, dict]) -> None:
        self.fixtures = fixtures
        self._mapper = HenrikMapper()

    async def get_match_detail(self, match_id: str, *, affinity: str) -> HenrikMatchDetailEnvelope:
        envelope = self.fixtures[match_id]
        return HenrikMatchDetailEnvelope(
            status=envelope["status"],
            data=self._mapper.to_match_detail(envelope["data"]),
            raw=envelope,
        )


class RaiseIfCalledHenrik:
    """Proves reads never invoke upstream: any attribute access raises."""

    def __getattr__(self, name: str):
        def _raise(*_args, **_kwargs):
            raise AssertionError(f"Henrik invoked during a library read: {name}")

        return _raise


async def _seed_matches(session_factory) -> dict[str, str]:
    """Import the three fixture matches via the real service; return
    ``{henrik_match_id: internal_uuid}``."""
    ids: dict[str, str] = {}
    for fixture in (FIXTURE_1, FIXTURE_2, FIXTURE_3):
        match_id = fixture["data"]["metadata"]["match_id"]
        async with session_factory() as session:
            svc = MatchImportService(
                session=session,
                henrik=FakeHenrik({match_id: fixture}),  # type: ignore[arg-type]
                player_repo=_import_player_repo(session),
                match_repo=MatchRepository(session),
                mapper=HenrikMapper(),
            )
            result = await svc.import_match(match_id, "eu")
            assert result.created is True
            ids[match_id] = str(result.match.id)
    return ids


def _import_player_repo(session):
    from app.db.repositories.player_repository import PlayerRepository

    return PlayerRepository(session)


def _app(session_factory, monkeypatch, *, raw_payload_in_responses: bool = False):
    """App with a raise-if-called Henrik client and the library service bound
    to the migrated schema. ``get_settings`` is patched to ``app_env="test"``
    so the service-token gate bypasses (delta D1; spec §6.3)."""
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: Settings(app_env="test"),
    )
    app = create_app()

    async def _override_library():
        async with session_factory() as session:
            yield MatchLibraryService(
                session=session,
                match_repo=MatchRepository(session),
                settings=Settings(raw_payload_in_responses=raw_payload_in_responses),
            )

    app.dependency_overrides[get_library_service] = _override_library
    # Reads must never touch Henrik: any call raises instead of hitting the API.
    app.dependency_overrides[get_henrik_client] = lambda: RaiseIfCalledHenrik()
    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# ------------------------------------------------------------------ seeding


async def test_seed_imports_three_matches(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    assert len(ids) == 3
    assert set(ids) == {HENRIK_1, HENRIK_2, HENRIK_3}


# --------------------------------------------------------------------- list


async def test_list_returns_all_matches_newest_first(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert body["next_cursor"] is None
    items = body["items"]
    assert [item["id"] for item in items] == [ids[HENRIK_1], ids[HENRIK_2], ids[HENRIK_3]]
    assert [item["henrik_match_id"] for item in items] == [HENRIK_1, HENRIK_2, HENRIK_3]
    assert items[0]["map_name"] == "Ascent"
    assert items[0]["started_at"] == "2026-08-12T18:40:00Z"
    assert items[0]["red_score"] == 13
    assert items[0]["winning_side"] == "red"
    assert items[0]["raw_payload_available"] is True
    assert "players" not in items[0]
    assert "raw_payload" not in items[0]


async def test_list_filters_by_map(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches", params={"map": "Ascent"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert [item["id"] for item in body["items"]] == [ids[HENRIK_1], ids[HENRIK_3]]


async def test_list_filters_by_from_to(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get(
            "/api/v1/matches",
            params={"from": "2026-08-11T00:00:00Z", "to": "2026-08-11T23:59:59Z"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [ids[HENRIK_2]]


async def test_list_filters_by_player_puuid(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches", params={"player_puuid": "puuid_p_a"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [ids[HENRIK_1]]


async def test_list_cursor_pagination_no_overlap(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    expected_order = [ids[HENRIK_1], ids[HENRIK_2], ids[HENRIK_3]]

    async with _client(_app(session_factory, monkeypatch)) as client:
        collected: list[str] = []
        cursor = None
        for _ in range(3):
            params = {"limit": 1}
            if cursor is not None:
                params["cursor"] = cursor
            resp = await client.get("/api/v1/matches", params=params)
            assert resp.status_code == 200
            body = resp.json()
            assert body["total"] == 3  # total ignores limit/cursor
            collected.extend(item["id"] for item in body["items"])
            cursor = body["next_cursor"]

        # deterministic order, no overlap, and the last page has no cursor
        assert collected == expected_order
        assert len(set(collected)) == 3
        assert cursor is None


async def test_list_cursor_and_filter_combined(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        page1 = await client.get("/api/v1/matches", params={"map": "Ascent", "limit": 1})
        assert page1.status_code == 200
        assert [item["id"] for item in page1.json()["items"]] == [ids[HENRIK_1]]
        cursor = page1.json()["next_cursor"]

        page2 = await client.get(
            "/api/v1/matches", params={"map": "Ascent", "limit": 1, "cursor": cursor}
        )
        assert page2.status_code == 200
        body = page2.json()
        assert [item["id"] for item in body["items"]] == [ids[HENRIK_3]]
        assert body["next_cursor"] is None
        assert body["total"] == 2


# ------------------------------------------------------------------ detail


async def test_detail_by_id_served_entirely_from_supabase(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get(f"/api/v1/matches/{ids[HENRIK_1]}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == ids[HENRIK_1]
    assert body["henrik_match_id"] == HENRIK_1
    assert body["map_name"] == "Ascent"
    assert body["started_at"] == "2026-08-12T18:40:00Z"
    assert body["red_score"] == 13
    assert body["blue_score"] == 9
    assert body["winning_side"] == "red"
    assert body["is_completed"] is True
    assert body["raw_payload_available"] is True
    assert "raw_payload" not in body  # key omitted by default (opt-in only)
    assert len(body["players"]) == 2
    by_puuid = {player["puuid"]: player for player in body["players"]}
    assert by_puuid["puuid_p_a"]["name"] == "PlayerA"
    assert by_puuid["puuid_p_a"]["tag"] == "A"
    assert by_puuid["puuid_p_a"]["side"] == "red"
    assert by_puuid["puuid_p_a"]["kills"] == 21
    assert by_puuid["puuid_p_b"]["side"] == "blue"


async def test_detail_by_henrik_id_matches_by_id(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        by_id = await client.get(f"/api/v1/matches/{ids[HENRIK_2]}")
        by_henrik = await client.get(f"/api/v1/matches/by-henrik-id/{HENRIK_2}")

    assert by_id.status_code == 200
    assert by_henrik.status_code == 200
    assert by_henrik.json() == by_id.json()


# ------------------------------------------------------------- errors / 422


async def test_missing_match_id_returns_match_not_found(session_factory, monkeypatch) -> None:
    await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches/00000000-0000-0000-0000-000000000099")

    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "MATCH_NOT_FOUND"
    assert body["error"]["request_id"]
    assert resp.headers["x-request-id"] == body["error"]["request_id"]


async def test_missing_henrik_id_returns_match_not_found(session_factory, monkeypatch) -> None:
    await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches/by-henrik-id/00000000-0000-0000-0000-000000000099")

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "MATCH_NOT_FOUND"


async def test_malformed_uuid_path_returns_invalid_riot_id(session_factory, monkeypatch) -> None:
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches/not-a-uuid")

    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "INVALID_RIOT_ID"
    assert body["error"]["request_id"]
    # sanitization preserved
    for err in body["error"]["detail"]["errors"]:
        assert "input" not in err and "ctx" not in err and "msg" not in err


async def test_bad_limit_keeps_invalid_request(session_factory, monkeypatch) -> None:
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches", params={"limit": 0})

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


async def test_bad_from_value_keeps_invalid_request(session_factory, monkeypatch) -> None:
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches", params={"from": "not-a-date"})

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


# ------------------------------------- fix round 1: cursor validation scope


async def test_malformed_cursor_returns_invalid_request(session_factory, monkeypatch) -> None:
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get("/api/v1/matches", params={"cursor": "not-a-uuid"})

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_REQUEST"


async def test_nonexistent_cursor_returns_match_not_found(session_factory, monkeypatch) -> None:
    await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get(
            "/api/v1/matches", params={"cursor": "00000000-0000-0000-0000-000000000099"}
        )

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "MATCH_NOT_FOUND"


async def test_cross_filter_cursor_returns_match_not_found(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    # The Bind match's internal id is a valid table row but fails the active
    # map=Ascent filter — it must not be accepted as a cross-filter anchor that
    # would silently skip Ascent rows.
    async with _client(_app(session_factory, monkeypatch)) as client:
        resp = await client.get(
            "/api/v1/matches", params={"map": "Ascent", "limit": 1, "cursor": ids[HENRIK_2]}
        )

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "MATCH_NOT_FOUND"


# ---------------------- fix round 1: deterministic participants + concurrency


async def test_detail_players_order_is_deterministic(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)
    async with _client(_app(session_factory, monkeypatch)) as client:
        first = await client.get(f"/api/v1/matches/{ids[HENRIK_1]}")
        second = await client.get(f"/api/v1/matches/{ids[HENRIK_1]}")

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    first_players = [player["id"] for player in first.json()["players"]]
    second_players = [player["id"] for player in second.json()["players"]]
    # ORDER BY id: the participant sequence is stable across repeated reads
    assert first_players == second_players
    assert len(first_players) == len(set(first_players)) == 2


async def test_concurrent_missing_lookups_both_return_match_not_found(session_factory, monkeypatch) -> None:
    await _seed_matches(session_factory)

    async def fetch(match_id: str):
        async with _client(_app(session_factory, monkeypatch)) as client:
            return await client.get(f"/api/v1/matches/{match_id}")

    resp_a, resp_b = await asyncio.gather(
        fetch("00000000-0000-0000-0000-000000000091"),
        fetch("00000000-0000-0000-0000-000000000092"),
    )

    assert resp_a.status_code == resp_b.status_code == 404
    assert resp_a.json()["error"]["code"] == resp_b.json()["error"]["code"] == "MATCH_NOT_FOUND"
    # each request carries its own correlation ID (fresh error handling)
    assert resp_a.json()["error"]["request_id"] != resp_b.json()["error"]["request_id"]


# ------------------------------------------------------ raw payload opt-in


async def test_raw_payload_echoed_only_when_opted_in(session_factory, monkeypatch) -> None:
    ids = await _seed_matches(session_factory)

    async with _client(_app(session_factory, monkeypatch, raw_payload_in_responses=True)) as client:
        resp = await client.get(f"/api/v1/matches/{ids[HENRIK_1]}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["raw_payload_available"] is True
    # the complete v4 detail data object, verbatim
    assert body["raw_payload"] == FIXTURE_1["data"]
    # list summaries still never carry raw content
    async with _client(_app(session_factory, monkeypatch, raw_payload_in_responses=True)) as client:
        listing = await client.get("/api/v1/matches")
    assert listing.status_code == 200
    assert "raw_payload" not in listing.json()["items"][0]
