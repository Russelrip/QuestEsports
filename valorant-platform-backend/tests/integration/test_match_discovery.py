"""Real-Postgres two-player discovery integration tests (plan Task 7, App. D).

The full API flow runs against the app with ``get_discovery_service`` overridden
to bind a real migrated-schema session, a real ``PlayerService``, a real
``MatchRepository``, and a fixture-driven fake ``HenrikClient`` transport:
``httpx.MockTransport`` serves pinned account/history payloads (the same
documented shape as the checked-in ``tests/fixtures/henrik`` files) through the
real ``HenrikClient`` (envelope validation + mapper included). No live Henrik
calls. Covers:

- search flags ``already_imported=true`` for pre-imported matches via the batch
  ``matches`` lookup and returns the internal ``match_id`` UUID for them (null
  for not-imported candidates);
- candidates whose match is already attached to a series (``series_games``) are
  excluded entirely;
- search itself writes no rows to ``matches`` (player resolve/upsert is the only
  allowed write);
- the full endpoint flow returns players + candidates;
- the whole router is service-token-gated in the ``production`` environment.

Skipped when ``TEST_DATABASE_URL`` is unset (see ``tests/integration/conftest.py``).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from urllib.parse import unquote

import httpx
import pytest
from sqlalchemy import func, select

from app.api.dependencies import get_discovery_service
from app.config import Settings
from app.db.models import Match, Player, Series, SeriesGame, Team
from app.db.repositories.match_repository import MatchRepository
from app.db.repositories.player_repository import PlayerRepository
from app.integrations.henrik.client import HenrikClient
from app.main import create_app
from app.services.match_discovery_service import MatchDiscoveryService
from app.services.player_service import PlayerService
from tests.token_helpers import production_settings

BASE_URL = "https://api.henrikdev.xyz"
MATCH_URL = "/api/v1/match-search/two-player"


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _account(name: str, tag: str, puuid: str, *, region: str = "eu") -> dict:
    """Account payload in the pinned v2 account shape."""
    return {
        "status": 200,
        "data": {
            "puuid": puuid,
            "region": region,
            "account_level": 128,
            "name": name,
            "tag": tag,
            "card": {"small": "x", "large": "x", "wide": "x", "id": "card_1"},
            "title": "title_1",
            "platforms": ["PC"],
            "updated_at": "2026-08-12T18:40:00Z",
        },
    }


def _history_item(
    match_id: str,
    *,
    map_name: str = "Ascent",
    started_at: datetime,
    is_completed: bool = True,
    mode: str = "Custom",
    queue: str | None = None,
    red_score: int = 13,
    blue_score: int = 9,
) -> dict:
    """A single history object in the pinned v4 history shape."""
    return {
        "metadata": {
            "match_id": match_id,
            "map": {"id": f"map-{match_id}", "name": map_name},
            "started_at": _ts(started_at),
            "is_completed": is_completed,
            "mode": mode,
            "queue": queue,
        },
        "players": [],
        "teams": [
            {"team_id": "Red", "rounds": {"won": red_score, "lost": blue_score}, "won": True},
            {"team_id": "Blue", "rounds": {"won": blue_score, "lost": red_score}, "won": False},
        ],
    }


def _fake_henrik(*, accounts: dict, histories: dict[str, list[dict]]) -> HenrikClient:
    """Real ``HenrikClient`` over ``MockTransport`` serving pinned payloads.

    ``accounts`` maps ``(name, tag)`` to an account envelope; ``histories`` maps
    a puuid to a list of page envelopes (selected by ``start``/``size`` exactly
    like accumulated pagination advances).
    """

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if "/valorant/v2/account/" in path:
            parts = path.split("/valorant/v2/account/")[1].split("/")
            name = unquote(parts[0])
            tag = unquote(parts[1])
            return httpx.Response(200, json=accounts[(name, tag)])
        if path.startswith("/valorant/v4/by-puuid/"):
            puuid = path.split("/")[-1]
            params = dict(request.url.params)
            size = int(params.get("size", "10"))
            start = int(params.get("start", "0"))
            page_index = start // size
            pages = histories.get(puuid, [])
            if page_index >= len(pages):
                return httpx.Response(200, json={"status": 200, "data": []})
            return httpx.Response(200, json=pages[page_index])
        raise AssertionError(f"unexpected upstream path: {path}")

    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return HenrikClient(Settings(henrik_api_key="test-key"), http=http)


def _app_with_discovery(
    monkeypatch: pytest.MonkeyPatch,
    session_factory,
    henrik: HenrikClient,
    *,
    app_env: str = "test",
):
    """Build the app with service-token bypass/protection and the service override.

    ``get_settings`` is patched inside ``app.api.dependencies`` (the same seam
    ``require_service_token`` reads), so ``app_env="test"`` bypasses the gate
    and ``app_env="production"`` enforces it.
    """
    monkeypatch.setattr(
        "app.api.dependencies.get_settings",
        lambda: production_settings(app_env=app_env),
    )
    app = create_app()

    async def _override():
        async with session_factory() as session:
            yield MatchDiscoveryService(
                session=session,
                player_svc=PlayerService(
                    session=session, henrik=henrik, repo=PlayerRepository(session)
                ),
                henrik=henrik,
                match_repo=MatchRepository(session),
            )

    app.dependency_overrides[get_discovery_service] = _override
    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _search_body() -> dict:
    return {
        "player_a": {"name": "PlayerA", "tag": "A"},
        "player_b": {"name": "PlayerB", "tag": "B"},
    }


def _default_henrik() -> HenrikClient:
    started = datetime(2026, 8, 12, 18, 40, tzinfo=UTC)
    page = {
        "status": 200,
        "data": [
            _history_item("m-imported", started_at=started),
            _history_item(
                "m-new", map_name="Bind", started_at=datetime(2026, 8, 12, 17, 10, tzinfo=UTC)
            ),
        ],
    }
    return _fake_henrik(
        accounts={
            ("PlayerA", "A"): _account("PlayerA", "A", "puuid_p_a"),
            ("PlayerB", "B"): _account("PlayerB", "B", "puuid_p_b"),
        },
        histories={
            "puuid_p_a": [page],
            "puuid_p_b": [page],
        },
    )


async def _match_count(session_factory) -> int:
    async with session_factory() as session:
        return await session.scalar(select(func.count()).select_from(Match))


async def _seed_match(session_factory, *, match_id: str = "m-imported") -> uuid.UUID:
    async with session_factory() as session:
        match = Match(
            henrik_match_id=match_id,
            affinity="eu",
            platform="pc",
            map_name="Ascent",
            started_at=datetime(2026, 8, 12, 18, 40, tzinfo=UTC),
            is_completed=True,
            raw_payload={},
        )
        session.add(match)
        await session.commit()
        return match.id


# ------------------------------------------------ already_imported flag

async def test_search_flags_already_imported_matches(session_factory, monkeypatch) -> None:
    imported_id = await _seed_match(session_factory, match_id="m-imported")
    henrik = _default_henrik()
    app = _app_with_discovery(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post(MATCH_URL, json=_search_body())
            assert resp.status_code == 200
            body = resp.json()
            by_id = {c["henrik_match_id"]: c for c in body["candidates"]}
            assert by_id["m-imported"]["already_imported"] is True
            assert by_id["m-imported"]["match_id"] == str(imported_id)  # internal matches.id UUID
            assert by_id["m-new"]["already_imported"] is False
            assert by_id["m-new"]["match_id"] is None
            assert by_id["m-imported"]["red_score"] == 13
            assert by_id["m-imported"]["blue_score"] == 9
            assert by_id["m-imported"]["map"] == "Ascent"
            assert by_id["m-imported"]["affinity"] == "eu"
            assert by_id["m-new"]["affinity"] == "eu"
            assert body["players"]["a"]["puuid"] == "puuid_p_a"
            assert body["players"]["b"]["puuid"] == "puuid_p_b"
            assert body["search"] == {"page_size": 10, "pages_examined": 1}
    finally:
        await henrik.aclose()


# ------------------------------------------- search writes no matches rows

async def test_search_writes_no_rows_to_matches(session_factory, monkeypatch) -> None:
    await _seed_match(session_factory, match_id="m-imported")
    before = await _match_count(session_factory)
    henrik = _default_henrik()
    app = _app_with_discovery(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post(MATCH_URL, json=_search_body())
            assert resp.status_code == 200
        # search itself never writes canonical matches
        assert await _match_count(session_factory) == before
        # players were resolved/upserted (the one allowed write)
        async with session_factory() as session:
            players = (await session.execute(select(Player))).scalars().all()
            assert {p.puuid for p in players} == {"puuid_p_a", "puuid_p_b"}
    finally:
        await henrik.aclose()


# -------------------------------------------------------------- full flow

async def test_two_player_search_full_flow_returns_candidates(session_factory, monkeypatch) -> None:
    henrik = _default_henrik()
    app = _app_with_discovery(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post(MATCH_URL, json=_search_body())
            assert resp.status_code == 200
            body = resp.json()
            assert len(body["candidates"]) == 2
            assert [c["henrik_match_id"] for c in body["candidates"]] == ["m-imported", "m-new"]
            assert body["candidates"][0]["is_completed"] is True
            assert body["candidates"][0]["already_imported"] is False
            assert body["candidates"][0]["match_id"] is None
            assert body["candidates"][0]["queue"] is None
            assert body["candidates"][0]["affinity"] == "eu"
            assert body["players"]["a"]["name"] == "PlayerA"
            assert body["players"]["b"]["name"] == "PlayerB"
            assert body["search"]["pages_examined"] == 1
    finally:
        await henrik.aclose()


# ---------------------------------------------- attached matches excluded

async def test_search_excludes_matches_attached_to_series(session_factory, monkeypatch) -> None:
    # m-attached is imported AND referenced by a series_games row -> excluded
    # from discovery; m-unattached is imported but not attached -> still
    # returned with its internal match_id.
    attached_id = await _seed_match(session_factory, match_id="m-attached")
    unattached_id = await _seed_match(session_factory, match_id="m-unattached")
    async with session_factory() as session:
        team_a = Team(name="Alpha")
        team_b = Team(name="Beta")
        session.add_all([team_a, team_b])
        await session.flush()
        series = Series(
            team_a_id=team_a.id, team_b_id=team_b.id, format="bo1", importance="regular"
        )
        session.add(series)
        await session.flush()
        session.add(
            SeriesGame(
                series_id=series.id,
                game_number=1,
                match_id=attached_id,
                team_a_side="red",
                team_b_side="blue",
                team_a_rounds=13,
                team_b_rounds=9,
            )
        )
        await session.commit()

    started = datetime(2026, 8, 12, 18, 40, tzinfo=UTC)
    page = {
        "status": 200,
        "data": [
            _history_item("m-attached", started_at=started),
            _history_item(
                "m-unattached", map_name="Bind", started_at=datetime(2026, 8, 12, 17, 10, tzinfo=UTC)
            ),
        ],
    }
    henrik = _fake_henrik(
        accounts={
            ("PlayerA", "A"): _account("PlayerA", "A", "puuid_p_a"),
            ("PlayerB", "B"): _account("PlayerB", "B", "puuid_p_b"),
        },
        histories={
            "puuid_p_a": [page],
            "puuid_p_b": [page],
        },
    )
    app = _app_with_discovery(monkeypatch, session_factory, henrik)
    try:
        async with _client(app) as client:
            resp = await client.post(MATCH_URL, json=_search_body())
            assert resp.status_code == 200
            body = resp.json()
            by_id = {c["henrik_match_id"]: c for c in body["candidates"]}
            assert "m-attached" not in by_id  # attached once -> never reappears
            assert by_id["m-unattached"]["match_id"] == str(unattached_id)
            assert by_id["m-unattached"]["already_imported"] is True
    finally:
        await henrik.aclose()


# ------------------------------------------------------ service-token gate

async def test_two_player_search_requires_service_token_in_production(session_factory, monkeypatch) -> None:
    henrik = _default_henrik()
    app = _app_with_discovery(monkeypatch, session_factory, henrik, app_env="production")
    try:
        async with _client(app) as client:
            resp = await client.post(MATCH_URL, json=_search_body())
            assert resp.status_code == 401
            assert resp.json()["error"]["code"] == "ADMIN_AUTH_REQUIRED"
    finally:
        await henrik.aclose()
