"""Fixture-driven Henrik mapper tests (plan Task 5; design §6, §15.1).

Every mapper behavior is proven against the Wave 0 fixtures under
``tests/fixtures/henrik/``. Error-code fixtures are mapped to the concrete
exception types through the real ``HenrikClient`` (via ``httpx.MockTransport``),
and the "never send ``queue``" contract is asserted on the fake transport's
query params.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.domain.matches.derivation import derive_scores, derive_winning_side
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikNotFoundError,
    HenrikProtocolError,
    HenrikRateLimitError,
    HenrikValidationError,
)
from app.integrations.henrik.mapper import HenrikMapper

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik"

_UTC_TIME = datetime(2026, 8, 12, 18, 40, tzinfo=UTC)


def _load(relative: str) -> dict:
    with (FIXTURE_DIR / relative).open(encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------- account

def test_account_valid_force_present_and_absent():
    mapper = HenrikMapper()
    for relative in ("account_v2/valid.json", "account_v2/valid_force.json"):
        account = mapper.to_account(_load(relative)["data"])
        assert account.puuid == "puuid_p_a"
        assert account.region == "eu"
        assert account.name == "PlayerA"
        assert account.tag == "A"
        assert account.platforms == ["PC"]
        assert account.updated_at == _UTC_TIME


def test_account_missing_platform_tolerated():
    mapper = HenrikMapper()
    account = mapper.to_account(_load("account_v2/missing_platform.json")["data"])
    assert account.puuid == "puuid_p_b"
    assert account.region == "na"
    assert account.name == "PlayerB"
    assert account.tag == "B"
    assert account.platforms == []
    assert account.updated_at == datetime(2026, 8, 11, 9, 15, tzinfo=UTC)


# ---------------------------------------------------------------- history list

def test_history_item_field_paths_and_side_normalization():
    mapper = HenrikMapper()
    fixture = _load("history_v4/page1_mixed_modes.json")
    items = [mapper.to_match_list_item(item) for item in fixture["data"]]
    assert len(items) == 3

    first = items[0]
    assert first.metadata.match_id == "00000000-0000-0000-0000-000000000001"
    assert first.metadata.map is not None
    assert first.metadata.map.id == "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319"
    assert first.metadata.map.name == "Ascent"
    assert first.metadata.started_at == _UTC_TIME
    assert first.metadata.is_completed is True
    assert first.metadata.mode == "Custom"
    assert first.metadata.queue is None

    assert len(first.players) == 2
    p_a = first.players[0]
    assert p_a.puuid == "puuid_p_a"
    assert p_a.name == "PlayerA"
    assert p_a.tag == "A"
    assert p_a.team_id == "red"  # normalized from the "Red" side literal
    assert p_a.character == "Jett"
    assert p_a.stats is not None
    assert p_a.stats.kills == 21
    assert p_a.stats.deaths == 11
    assert p_a.stats.assists == 5
    assert p_a.stats.score == 3400
    assert p_a.stats.damage_dealt == 4200
    assert p_a.stats.damage_received == 2100
    assert p_a.stats.headshots == 12
    assert p_a.stats.bodyshots == 34
    assert p_a.stats.legshots == 8
    assert p_a.raw["puuid"] == "puuid_p_a"  # raw player dict preserved verbatim

    assert len(first.teams) == 2
    red = first.teams[0]
    blue = first.teams[1]
    assert red.team_id == "red"
    assert red.rounds.won == 13
    assert red.rounds.lost == 9
    assert red.won is True
    assert blue.team_id == "blue"
    assert blue.rounds.won == 9
    assert blue.rounds.lost == 13
    assert blue.won is False

    # raw retention: the item and its metadata keep the original dicts verbatim
    assert first.raw == fixture["data"][0]
    assert first.metadata.raw["match_id"] == "00000000-0000-0000-0000-000000000001"
    assert first.metadata.raw["is_completed"] is True

    third = items[2]
    assert third.metadata.is_completed is False
    assert third.metadata.mode == "Custom"
    assert all(team.won is None for team in third.teams)


def test_history_item_metadata_mode_and_queue_paths():
    mapper = HenrikMapper()
    fixture = _load("history_v4/page1_mixed_modes.json")
    second = mapper.to_match_list_item(fixture["data"][1])
    assert second.metadata.match_id == "00000000-0000-0000-0000-000000000002"
    assert second.metadata.map.name == "Bind"
    assert second.metadata.mode == "Competitive"
    assert second.metadata.queue == "competitive"


# ---------------------------------------------------------------- detail

def test_detail_normalization_and_derived_scores():
    mapper = HenrikMapper()
    detail = mapper.to_match_detail(_load("match_detail_v4/completed_custom.json")["data"])
    assert detail.metadata.match_id == "00000000-0000-0000-0000-000000000001"
    assert detail.metadata.map.name == "Ascent"
    assert detail.metadata.is_completed is True
    assert {p.team_id for p in detail.players} == {"red", "blue"}
    assert [p.character for p in detail.players] == ["Jett", "Sage"]

    teams_by_side = {t.team_id: t for t in detail.teams}
    assert teams_by_side["red"].rounds.won == 13
    assert teams_by_side["blue"].rounds.won == 9
    assert teams_by_side["red"].won is True

    assert derive_scores(detail.teams) == (13, 9)
    assert derive_winning_side(detail.teams) == "red"


def test_detail_incomplete_derivation_is_unknown():
    mapper = HenrikMapper()
    detail = mapper.to_match_detail(_load("match_detail_v4/incomplete.json")["data"])
    assert detail.metadata.is_completed is False
    assert derive_scores(detail.teams) == (5, 3)
    assert derive_winning_side(detail.teams) == "unknown"


def test_missing_optional_stats_tolerated():
    mapper = HenrikMapper()
    detail = mapper.to_match_detail(_load("match_detail_v4/missing_optional_stats.json")["data"])
    assert len(detail.players) == 2
    assert detail.players[0].stats is None
    assert detail.players[0].character is None
    assert detail.players[0].team_id == "red"
    assert derive_scores(detail.teams) == (13, 4)
    assert derive_winning_side(detail.teams) == "red"


def test_malformed_required_field_raises_protocol_error():
    mapper = HenrikMapper()
    with pytest.raises(HenrikProtocolError):
        mapper.to_match_detail(_load("match_detail_v4/malformed_required.json")["data"])


def test_unknown_side_literal_raises_protocol_error():
    mapper = HenrikMapper()
    with pytest.raises(HenrikProtocolError):
        mapper.to_match_detail(_load("match_detail_v4/unknown_side_literal.json")["data"])


# ---------------------------------------------------------------- error envelope

def test_parse_error_body_returns_pinned_envelope_fields():
    mapper = HenrikMapper()
    status, message, errors = mapper.parse_error_body(_load("errors/error_401.json"))
    assert status == 401
    assert "API key" in message
    assert errors == [{"message": "API key is missing or invalid", "code": None}]


def test_parse_error_body_multiple_errors_join_messages():
    mapper = HenrikMapper()
    status, message, errors = mapper.parse_error_body(
        {"status": 400, "errors": [{"message": "first", "code": 1}, {"message": "second", "code": 2}]}
    )
    assert status == 400
    assert message == "first; second"
    assert len(errors) == 2


def test_parse_error_body_accepts_the_per_item_status_envelope():
    """Henrik's account-not-found envelope carries the status inside each error
    item and omits the top-level one. Recorded verbatim from production on
    2026-08-24 for GET /valorant/v2/account/<name>/<tag> on an unknown account.

    Rejecting this shape made every mistyped Riot ID surface as
    HENRIK_UNAVAILABLE, so a player with a typo was told the provider was down
    rather than to check their spelling.
    """
    mapper = HenrikMapper()
    status, message, errors = mapper.parse_error_body(
        {
            "errors": [
                {"code": 22, "message": "Account not found", "status": 404, "details": None}
            ]
        }
    )
    assert status == 404
    assert message == "Account not found"
    assert len(errors) == 1


def test_parse_error_body_prefers_the_top_level_status():
    mapper = HenrikMapper()
    status, _, _ = mapper.parse_error_body(
        {"status": 400, "errors": [{"message": "m", "code": 1, "status": 404}]}
    )
    assert status == 400


def test_parse_error_body_rejects_a_non_integer_item_status():
    mapper = HenrikMapper()
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"errors": [{"message": "m", "code": 1, "status": "404"}]})
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"errors": [{"message": "m", "code": 1, "status": True}]})


def test_parse_error_body_still_requires_a_status_somewhere():
    mapper = HenrikMapper()
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"errors": [{"message": "m", "code": 1}]})


def test_parse_error_body_malformed_raises_protocol_error():
    mapper = HenrikMapper()
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": "not-an-int", "errors": []})
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": 400, "errors": [{"code": 27}]})  # message missing
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": 400})  # errors missing
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": 400, "errors": []})  # empty errors list
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body("not a dict")
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": 400, "errors": [{"message": "m", "code": "27"}]})  # string code
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": True, "errors": [{"message": "m", "code": None}]})  # bool status
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": 400, "errors": [{"message": "m", "code": True}]})  # bool code
    with pytest.raises(HenrikProtocolError):
        mapper.parse_error_body({"status": 400, "errors": ["not an object"]})  # error item not a dict


# ------------------------------------------------- error fixtures -> concrete exceptions

def _make_client(fixture: dict) -> HenrikClient:
    settings = Settings(henrik_api_key="test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=fixture["status"], json=fixture)

    http = httpx.AsyncClient(base_url="https://api.henrikdev.xyz", transport=httpx.MockTransport(handler))
    return HenrikClient(settings, http=http)


async def test_every_error_code_fixture_maps_to_right_exception_and_sub_code():
    cases = [
        ("errors/error_401.json", "account", HenrikAuthenticationError, None),
        ("errors/error_403.json", "account", HenrikAuthenticationError, None),
        ("errors/error_429.json", "account", HenrikRateLimitError, None),
        ("account_v2/error_404_code22.json", "account", HenrikNotFoundError, 22),
        ("account_v2/error_404_code23.json", "account", HenrikNotFoundError, 23),
        ("match_detail_v4/error_404_code26.json", "detail", HenrikNotFoundError, 26),
        ("history_v4/error_400_code27.json", "history", HenrikValidationError, 27),
        ("history_v4/error_400_code28.json", "history", HenrikValidationError, 28),
        ("history_v4/error_400_code42.json", "history", HenrikValidationError, 42),
        ("history_v4/error_400_code43.json", "history", HenrikValidationError, 43),
        ("history_v4/error_400_code45.json", "history", HenrikValidationError, 45),
    ]
    endpoints = {
        "account": lambda c: c.get_account("PlayerA", "A"),
        "detail": lambda c: c.get_match_detail("00000000-0000-0000-0000-000000000001", affinity="eu"),
        "history": lambda c: c.get_matches_by_puuid("puuid_p_a", affinity="eu", platform="pc"),
    }
    for relative, call_type, exc_type, sub_code in cases:
        fixture = _load(relative)
        client = _make_client(fixture)
        try:
            with pytest.raises(exc_type) as excinfo:
                await endpoints[call_type](client)
            if sub_code is not None:
                assert excinfo.value.sub_code == sub_code
            if exc_type is HenrikRateLimitError:
                # fixture 429 carries no Retry-After header value -> not parsed
                assert excinfo.value.retry_after is None
        finally:
            await client.aclose()


# ------------------------------------------------------- never serialize queue

async def test_adapter_never_serializes_queue_param():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(status_code=200, json=_load("history_v4/page1_mixed_modes.json"))

    http = httpx.AsyncClient(base_url="https://api.henrikdev.xyz", transport=httpx.MockTransport(handler))
    client = HenrikClient(Settings(henrik_api_key="test-key"), http=http)
    try:
        items = await client.get_matches_by_puuid("puuid_p_a", affinity="eu", platform="pc")
    finally:
        await client.aclose()

    assert "queue" not in captured["params"]
    # CUSTOM_MODE_LITERAL fallback is None -> mode is filtered locally, never sent
    assert "mode" not in captured["params"]
    assert captured["params"]["size"] == "10"
    assert captured["params"]["start"] == "0"
    assert len(items) == 3
