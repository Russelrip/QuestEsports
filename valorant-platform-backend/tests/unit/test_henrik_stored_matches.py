"""Henrik v1 stored-matches client tests for the leaderboard server check (0018).

``httpx.MockTransport`` only. Pins the request (URL, ``mode``, ``size``) and the
mapping of ``meta.id``/``cluster``/``region``/``started_at``, including the
items that cannot be stored.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.exceptions import HenrikNotFoundError, HenrikProtocolError

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "henrik" / "stored_matches_v1" / "valid.json"
BASE_URL = "https://api.henrikdev.xyz"


def _client(handler) -> HenrikClient:
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return HenrikClient(Settings(henrik_api_key="secret-key"), http=http)


async def test_builds_the_stored_matches_request_and_maps_servers() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=json.loads(FIXTURE.read_text(encoding="utf-8")))

    client = _client(handler)
    try:
        matches = await client.get_stored_competitive_servers("puuid_p_a", affinity="ap", size=25)
    finally:
        await client.aclose()

    assert len(seen) == 1
    assert seen[0].url.path == "/valorant/v1/by-puuid/stored-matches/ap/puuid_p_a"
    assert dict(seen[0].url.params) == {"mode": "competitive", "size": "25"}
    assert seen[0].headers["Authorization"] == "secret-key"

    # The fourth item has no started_at and cannot be stored, so it is skipped.
    assert [(m.match_id, m.cluster, m.shard) for m in matches] == [
        ("00000000-0000-0000-0000-0000000000a1", "Singapore", "ap"),
        ("00000000-0000-0000-0000-0000000000a2", "Mumbai", "ap"),
        ("00000000-0000-0000-0000-0000000000a3", None, None),
    ]
    assert matches[0].started_at == datetime(2026, 9, 13, 20, 11, 0, 444000, tzinfo=UTC)


async def test_unusable_items_are_skipped_not_fatal() -> None:
    body = {
        "status": 200,
        "data": [
            "not an object",
            {"stats": {}},
            {"meta": {"id": "", "started_at": "2026-09-13T20:11:00Z"}},
            {"meta": {"id": "m1", "started_at": "not a date", "cluster": "Mumbai"}},
            {"meta": {"id": "m2", "started_at": "2026-09-13T20:11:00Z", "cluster": "  Mumbai "}},
        ],
    }
    client = _client(lambda request: httpx.Response(200, json=body))
    try:
        matches = await client.get_stored_competitive_servers("p", affinity="ap", size=5)
    finally:
        await client.aclose()
    assert [(m.match_id, m.cluster) for m in matches] == [("m2", "Mumbai")]


async def test_non_list_data_is_a_protocol_error() -> None:
    client = _client(lambda request: httpx.Response(200, json={"status": 200, "data": {}}))
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_stored_competitive_servers("p", affinity="ap", size=5)
    finally:
        await client.aclose()


async def test_404_raises_not_found() -> None:
    body = {"status": 404, "errors": [{"code": 22, "message": "Not found"}]}
    client = _client(lambda request: httpx.Response(404, json=body))
    try:
        with pytest.raises(HenrikNotFoundError):
            await client.get_stored_competitive_servers("p", affinity="ap", size=5)
    finally:
        await client.aclose()
