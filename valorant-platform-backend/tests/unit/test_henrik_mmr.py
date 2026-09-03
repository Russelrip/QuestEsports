"""Henrik MMR + last-competitive-match client tests (plan task 3; R5/R6).

``httpx.MockTransport`` only — no network, no live calls. Mirrors the
fake-transport pattern of ``test_henrik_client.py``. Covers both MMR response
shapes (nested ``data.current.*`` and flat ``data.*``), the request
URLs/params, ``started_at``-then-``game_start`` fallback for the last match
date, and the empty-list ``None`` case.
"""

from datetime import UTC, datetime

import httpx

from app.config import Settings
from app.integrations.henrik.client import HenrikClient

BASE_URL = "https://api.henrikdev.xyz"

# ------------------------------------------------------------------ payloads

NESTED_MMR = {
    "status": 200,
    "data": {
        "account": {"name": "PlayerA", "tag": "A", "puuid": "puuid_p_a"},
        "current": {
            "tier": {"id": 21, "name": "Gold 1"},
            "elo": 1200,
            "rr": 55,
            "games_needed_for_rating": 1,
        },
        "peak": {
            "tier": {"id": 24, "name": "Platinum 1"},
            "season": {"short": "e9a3", "id": "season-e9a3"},
        },
        "seasonal": [
            {
                "season": {"short": "e9a3", "id": "season-e9a3"},
                "end_tier": {"id": 21, "name": "Gold 1"},
                "wins": 5,
                "games": 10,
                "end_rr": 40,
                "ranking_schema": "base",
                "leaderboard_placement": 100,
            }
        ],
    },
}

FLAT_MMR = {
    "status": 200,
    "data": {
        "account": {"name": "PlayerB", "tag": "B", "puuid": "puuid_p_b"},
        "currenttierpatched": "Silver 2",
        "currenttier": 12,
        "elo": 950,
        "ranking_in_tier": 80,
        "games_needed_for_rating": 2,
    },
}

NESTED_EXPECTED = {
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
    "seasonal_ranks": [
        {
            "season_short": "e9a3",
            "season_id": "season-e9a3",
            "wins": 5,
            "games": 10,
            "end_tier": {"id": 21, "name": "Gold 1"},
            "end_rr": 40,
            "ranking_schema": "base",
            "leaderboard_placement": 100,
        }
    ],
}

FLAT_EXPECTED = {
    "name": "PlayerB",
    "tag": "B",
    "rank_details": {
        "currenttierpatched": "Silver 2",
        "current_tier": 12,
        "elo": 950,
        "ranking_in_tier": 80,
        "games_needed_for_rating": 2,
    },
    "peak_rank": {"tier_name": "Unknown", "season_short": "Unknown", "tier": 0},
    "seasonal_ranks": [],
}


def _client(handler) -> HenrikClient:
    settings = Settings(henrik_api_key="secret-key")
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return HenrikClient(settings, http=http)


# ------------------------------------------------------------------- get_player_mmr

async def test_get_player_mmr_nested_shape_normalizes():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json=NESTED_MMR)

    client = _client(handler)
    try:
        result = await client.get_player_mmr("puuid_p_a", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    assert seen["path"] == "/valorant/v3/by-puuid/mmr/ap/pc/puuid_p_a"
    assert seen["params"] == {}
    assert result == NESTED_EXPECTED


async def test_get_player_mmr_flat_shape_normalizes():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json=FLAT_MMR)

    client = _client(handler)
    try:
        result = await client.get_player_mmr("puuid_p_b", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    assert seen["path"] == "/valorant/v3/by-puuid/mmr/ap/pc/puuid_p_b"
    assert seen["params"] == {}
    assert result == FLAT_EXPECTED


async def test_get_player_mmr_missing_optional_fields_use_defaults():
    bare = {"status": 200, "data": {"account": {}}}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=bare)

    client = _client(handler)
    try:
        result = await client.get_player_mmr("puuid_x", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    assert result["name"] == "Unknown"
    assert result["tag"] == "0000"
    assert result["rank_details"] == {
        "currenttierpatched": "Unrated",
        "current_tier": 0,
        "elo": 0,
        "ranking_in_tier": 0,
        "games_needed_for_rating": 0,
    }
    assert result["peak_rank"] == {"tier_name": "Unknown", "season_short": "Unknown", "tier": 0}
    assert result["seasonal_ranks"] == []


# ------------------------------------------------------- get_last_competitive_match

async def test_get_last_competitive_match_returns_started_at():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "status": 200,
                "data": [
                    {
                        "metadata": {
                            "started_at": "2026-01-02T03:04:05Z",
                            "game_start": 1700000000000,
                        }
                    }
                ],
            },
        )

    client = _client(handler)
    try:
        result = await client.get_last_competitive_match("puuid_p_a", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    assert result == "2026-01-02T03:04:05Z"


async def test_get_last_competitive_match_builds_matches_request():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json={"status": 200, "data": []})

    client = _client(handler)
    try:
        result = await client.get_last_competitive_match("puuid_p_a", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    assert seen["path"] == "/valorant/v4/by-puuid/matches/ap/pc/puuid_p_a"
    # `mode` is sent UNCONDITIONALLY on this dedicated endpoint (R5-style, no U5 gate).
    assert seen["params"] == {"mode": "competitive", "size": "1"}
    assert result is None


async def test_get_last_competitive_match_falls_back_to_game_start():
    ms_epoch = 1_700_000_000_000

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"status": 200, "data": [{"metadata": {"game_start": ms_epoch}}]},
        )

    client = _client(handler)
    try:
        result = await client.get_last_competitive_match("puuid_p_a", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    # UTC-aware conversion, matching the mapper's fallback under test (a naive
    # local conversion would skew the timestamp on a non-UTC host).
    assert result == datetime.fromtimestamp(ms_epoch / 1000, tz=UTC).isoformat()


async def test_get_last_competitive_match_empty_list_returns_none():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": 200, "data": []})

    client = _client(handler)
    try:
        result = await client.get_last_competitive_match("puuid_p_a", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    assert result is None


async def test_get_last_competitive_match_missing_timestamp_fields_returns_none():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"status": 200, "data": [{"metadata": {"map": {"name": "Ascent"}}}]},
        )

    client = _client(handler)
    try:
        result = await client.get_last_competitive_match("puuid_p_a", affinity="ap", platform="pc")
    finally:
        await client.aclose()

    assert result is None
