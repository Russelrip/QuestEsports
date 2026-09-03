"""Henrik HTTP client tests (plan Task 5; design §6, §16.2).

``httpx.MockTransport`` only — no network, no live calls. Covers centralized
auth, per-request structured logging, bounded transient retries, 429 handling,
the HTTP-status -> exception mapping, strict envelope validation, and raw
payload retention for import.
"""

import json
import logging
from copy import deepcopy
from pathlib import Path
from time import perf_counter

import httpx
import pytest

from app.config import Settings
from app.integrations.henrik.client import HenrikClient
from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikNotFoundError,
    HenrikProtocolError,
    HenrikRateLimitError,
    HenrikUnavailableError,
    HenrikValidationError,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "henrik"
BASE_URL = "https://api.henrikdev.xyz"


def _load(relative: str) -> dict:
    with (FIXTURE_DIR / relative).open(encoding="utf-8") as fh:
        return json.load(fh)


def _client(handler, **settings_kwargs) -> HenrikClient:
    settings = Settings(henrik_api_key="secret-key", **settings_kwargs)
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return HenrikClient(settings, http=http)


# ---------------------------------------------------------------- parsing

async def test_get_match_detail_200_parses_match_detail():
    fixture = _load("match_detail_v4/completed_custom.json")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/valorant/v4/match/eu/00000000-0000-0000-0000-000000000001"
        return httpx.Response(200, json=fixture)

    client = _client(handler)
    try:
        result = await client.get_match_detail("00000000-0000-0000-0000-000000000001", affinity="eu")
    finally:
        await client.aclose()

    detail = result.data
    assert result.status == 200
    assert detail.metadata.match_id == "00000000-0000-0000-0000-000000000001"
    assert detail.metadata.map.name == "Ascent"
    assert len(detail.players) == 2
    assert detail.players[0].stats.kills == 21
    # the complete raw envelope is retained verbatim alongside the model
    assert result.raw == fixture
    assert result.raw["data"]["metadata"]["map"]["name"] == "Ascent"
    assert result.data.raw == fixture["data"]


async def test_get_account_200_parses_account():
    fixture = _load("account_v2/valid.json")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=fixture)

    client = _client(handler)
    try:
        account = await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert account.puuid == "puuid_p_a"
    assert account.region == "eu"
    assert account.name == "PlayerA"


# ---------------------------------------------------------- account by puuid (task 8 name-audit)

async def test_get_account_by_puuid_200_validates_and_maps_account():
    # The global account-by-puuid endpoint has NO affinity/platform in the path.
    fixture = _load("account_v2/valid.json")
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(200, json=fixture)

    client = _client(handler)
    try:
        account = await client.get_account_by_puuid("puuid_p_a")
    finally:
        await client.aclose()

    assert seen["path"] == "/valorant/v1/by-puuid/account/puuid_p_a"
    # Envelope is validated (200 success shape) and mapped to HenrikAccount.
    assert account.puuid == "puuid_p_a"
    assert account.region == "eu"
    assert account.name == "PlayerA"
    assert account.tag == "A"


async def test_get_account_by_puuid_404_raises_not_found():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json=_load("account_v2/error_404_code22.json"))

    client = _client(handler)
    try:
        with pytest.raises(HenrikNotFoundError) as excinfo:
            await client.get_account_by_puuid("puuid_p_a")
    finally:
        await client.aclose()

    assert excinfo.value.sub_code == 22


async def test_empty_history_returns_empty_list():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_load("history_v4/empty.json"))

    client = _client(handler)
    try:
        items = await client.get_matches_by_puuid("puuid_p_a", affinity="eu", platform="pc")
    finally:
        await client.aclose()

    assert items == []


async def test_200_without_data_envelope_raises_protocol_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": 200})

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


# ---------------------------------------------------------------- error mapping

async def test_429_with_retry_after_raises_rate_limit_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"Retry-After": "1", "X-RateLimit-Reset": "1700000000", "X-Request-ID": "req-429"},
            json=_load("errors/error_429.json"),
        )

    client = _client(handler, henrik_max_retries=0)
    try:
        with pytest.raises(HenrikRateLimitError) as excinfo:
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert excinfo.value.retry_after == 1.0
    assert excinfo.value.rate_limit_reset == 1700000000
    assert excinfo.value.request_id == "req-429"


async def test_404_code_26_raises_not_found_with_sub_code():
    # Fixture-driven: match_detail_v4/error_404_code26.json pins the 404/26 shape.
    fixture = _load("match_detail_v4/error_404_code26.json")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json=fixture)

    client = _client(handler)
    try:
        with pytest.raises(HenrikNotFoundError) as excinfo:
            await client.get_match_detail("00000000-0000-0000-0000-000000000001", affinity="eu")
    finally:
        await client.aclose()

    assert excinfo.value.sub_code == 26
    assert excinfo.value.message == "Match not found"


async def test_401_raises_authentication_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json=_load("errors/error_401.json"))

    client = _client(handler)
    try:
        with pytest.raises(HenrikAuthenticationError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


async def test_500_exhausted_raises_unavailable_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"status": 500, "errors": [{"message": "boom", "code": None}]})

    client = _client(handler)
    try:
        with pytest.raises(HenrikUnavailableError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


# ---------------------------------------------------------------- auth header

async def test_auth_header_bare_scheme_sends_key():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("Authorization")
        return httpx.Response(200, json=_load("account_v2/valid.json"))

    client = _client(handler)
    try:
        await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert seen["authorization"] == "secret-key"


async def test_auth_header_bearer_scheme_sends_bearer_key(monkeypatch):
    monkeypatch.setattr("app.integrations.henrik.client.AUTH_SCHEME_PINNED", "Bearer")
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("Authorization")
        return httpx.Response(200, json=_load("account_v2/valid.json"))

    client = _client(handler)
    try:
        await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert seen["authorization"] == "Bearer secret-key"


async def test_no_api_key_sends_no_auth_header():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("Authorization")
        return httpx.Response(200, json=_load("account_v2/valid.json"))

    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    client = HenrikClient(Settings(henrik_api_key=None), http=http)
    try:
        await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert seen["authorization"] is None


# ---------------------------------------------------------------- retries

async def test_retryable_5xx_500_is_retried():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if len(calls) < 3:
            return httpx.Response(500, json={"status": 500, "errors": [{"message": "boom", "code": None}]})
        return httpx.Response(200, json=_load("account_v2/valid.json"))

    client = _client(handler)  # henrik_max_retries default 2
    try:
        account = await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 3
    assert account.puuid == "puuid_p_a"


async def test_retryable_5xx_501_is_retried():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if len(calls) == 1:
            return httpx.Response(501, json={"status": 501, "errors": [{"message": "endpoint missing", "code": None}]})
        return httpx.Response(200, json=_load("account_v2/valid.json"))

    client = _client(handler)
    try:
        account = await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 2
    assert account.puuid == "puuid_p_a"


async def test_non_retryable_5xx_never_retried():
    # Only 500/501 are in the pinned retryable set; 502/503/504 (and any other
    # 5xx) are surfaced immediately as HenrikUnavailableError, never retried.
    for status_code in (502, 503, 504, 599):
        calls: list[str] = []

        def handler(request: httpx.Request, _status=status_code, _calls=calls) -> httpx.Response:
            _calls.append(request.url.path)
            return httpx.Response(
                _status, json={"status": _status, "errors": [{"message": "unavailable", "code": None}]}
            )

        client = _client(handler)
        try:
            with pytest.raises(HenrikUnavailableError):
                await client.get_account("PlayerA", "A")
        finally:
            await client.aclose()

        assert len(calls) == 1


# --- fix round 2: envelope validation precedes any retry decision. A malformed
# or status-mismatched first response raises immediately even if a later mocked
# attempt would succeed, so exactly one request is made.

async def test_malformed_500_first_never_retried():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if len(calls) == 1:
            # retryable status but malformed envelope (errors missing)
            return httpx.Response(500, json={"status": 500})
        return httpx.Response(200, json=_load("account_v2/valid.json"))  # would succeed

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 1


async def test_status_mismatched_500_first_never_retried():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if len(calls) == 1:
            # retryable status but envelope status disagrees with HTTP status
            return httpx.Response(500, json={"status": 404, "errors": [{"message": "x", "code": 22}]})
        return httpx.Response(200, json=_load("account_v2/valid.json"))  # would succeed

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 1


async def test_malformed_429_with_retry_after_first_never_retried():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if len(calls) == 1:
            # Retry-After present (retryable) but malformed envelope
            return httpx.Response(429, headers={"Retry-After": "1"}, json={"status": 429})
        return httpx.Response(200, json=_load("account_v2/valid.json"))  # would succeed

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 1


async def test_status_mismatched_429_with_retry_after_first_never_retried():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if len(calls) == 1:
            # Retry-After present (retryable) but envelope status disagrees
            return httpx.Response(429, headers={"Retry-After": "1"}, json={"status": 400, "errors": [{"message": "x", "code": 27}]})
        return httpx.Response(200, json=_load("account_v2/valid.json"))  # would succeed

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 1


async def test_429_with_retry_after_is_retried_then_succeeds():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "0.01"}, json=_load("errors/error_429.json"))
        return httpx.Response(200, json=_load("account_v2/valid.json"))

    client = _client(handler)
    try:
        account = await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 2
    assert account.puuid == "puuid_p_a"


async def test_429_without_retry_after_never_retried():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429, json=_load("errors/error_429.json"))

    client = _client(handler)
    try:
        with pytest.raises(HenrikRateLimitError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()

    assert len(calls) == 1


async def test_huge_retry_after_sleep_is_capped_original_metadata_preserved():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(
            429,
            headers={"Retry-After": "3600", "X-RateLimit-Reset": "1700000000"},
            json=_load("errors/error_429.json"),
        )

    settings = Settings(
        henrik_api_key="secret-key",
        henrik_max_retries=2,
        henrik_retry_after_cap_seconds=0.01,
    )
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    client = HenrikClient(settings, http=http)
    start = perf_counter()
    try:
        with pytest.raises(HenrikRateLimitError) as excinfo:
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()
    elapsed = perf_counter() - start

    # Two bounded retries each sleep the CAPPED wait (0.01s), never the
    # server's 3600s, and the ORIGINAL Retry-After value survives on the
    # final exception alongside X-RateLimit-Reset.
    assert len(calls) == 3
    assert elapsed < 1.0
    assert excinfo.value.retry_after == 3600.0
    assert excinfo.value.rate_limit_reset == 1700000000


async def test_4xx_never_retried():
    cases = [
        (400, {"status": 400, "errors": [{"message": "bad request", "code": 27}]}, HenrikValidationError),
        (401, _load("errors/error_401.json"), HenrikAuthenticationError),
        (403, _load("errors/error_403.json"), HenrikAuthenticationError),
        (404, _load("account_v2/error_404_code22.json"), HenrikNotFoundError),
    ]
    for status_code, body, exc_type in cases:
        calls: list[str] = []

        def handler(
            request: httpx.Request, _status=status_code, _body=body, _calls=calls
        ) -> httpx.Response:
            _calls.append(request.url.path)
            return httpx.Response(_status, json=_body)

        client = _client(handler)
        try:
            with pytest.raises(exc_type):
                await client.get_account("PlayerA", "A")
        finally:
            await client.aclose()

        assert len(calls) == 1  # never a blind 4xx retry


async def test_network_error_raises_unavailable_error():
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = _client(handler, henrik_max_retries=0)
    try:
        with pytest.raises(HenrikUnavailableError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


# ---------------------------------------------------------------- query params

async def test_get_matches_by_puuid_builds_pinned_params():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json=_load("history_v4/page1_mixed_modes.json"))

    client = _client(handler)
    try:
        await client.get_matches_by_puuid(
            "puuid_p_a", affinity="eu", platform="pc", mode="Custom", map_name="Ascent", size=20, start=5
        )
    finally:
        await client.aclose()

    assert seen["path"] == "/valorant/v4/by-puuid/matches/eu/pc/puuid_p_a"
    assert seen["params"] == {"size": "20", "start": "5", "map": "Ascent"}
    # mode is only sent when CUSTOM_MODE_LITERAL is pinned; fallback is None
    assert "mode" not in seen["params"]
    assert "queue" not in seen["params"]


async def test_get_account_force_param_only_when_requested():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.url.params))
        return httpx.Response(200, json=_load("account_v2/valid.json"))

    client = _client(handler)
    try:
        await client.get_account("PlayerA", "A", force=True)
        await client.get_account("PlayerA", "A", force=False)
    finally:
        await client.aclose()

    assert seen == [{"force": "true"}, {}]


# ------------------------------------------------------- envelope validation

async def test_success_envelope_status_disagreement_raises_protocol_error():
    def handler(request: httpx.Request) -> httpx.Response:
        body = dict(_load("account_v2/valid.json"))
        body["status"] = 201  # disagrees with the HTTP 200
        return httpx.Response(200, json=body)

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


async def test_success_envelope_missing_status_raises_protocol_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"puuid": "puuid_p_a"}})

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


async def test_success_envelope_non_integer_status_raises_protocol_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "200", "data": {}})

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


async def test_error_envelope_status_disagreement_raises_protocol_error():
    # HTTP 404 but the envelope claims status 400 -> contract violation.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404, json={"status": 400, "errors": [{"message": "match not found", "code": 26}]}
        )

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


async def test_malformed_error_envelope_raises_protocol_error_not_status_exception():
    # HTTP 500 with an envelope missing `errors` is a malformed envelope ->
    # HenrikProtocolError, never a generic HenrikUnavailableError.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"status": 500})

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


async def test_error_response_non_json_body_raises_protocol_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Internal Server Error")

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


async def test_error_item_string_code_raises_protocol_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"status": 400, "errors": [{"message": "invalid mode", "code": "27"}]}
        )

    client = _client(handler)
    try:
        with pytest.raises(HenrikProtocolError):
            await client.get_account("PlayerA", "A")
    finally:
        await client.aclose()


# --------------------------------------------------- raw payload retention

async def test_detail_raw_envelope_preserves_extra_fields_verbatim():
    fixture = deepcopy(_load("match_detail_v4/completed_custom.json"))
    fixture["data"]["metadata"]["future_flag"] = "preserved"
    fixture["data"]["players"][0]["future_player_field"] = {"nested": True}
    fixture["extra_top_level"] = "survives"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=fixture)

    client = _client(handler)
    try:
        result = await client.get_match_detail("00000000-0000-0000-0000-000000000001", affinity="eu")
    finally:
        await client.aclose()

    assert result.raw == fixture  # complete envelope verbatim
    assert result.raw["data"]["metadata"]["future_flag"] == "preserved"
    assert result.raw["data"]["players"][0]["future_player_field"] == {"nested": True}
    assert result.raw["extra_top_level"] == "survives"
    # the tolerant models ignore the unknown fields but raw keeps them
    assert result.data.raw["metadata"]["future_flag"] == "preserved"
    assert result.data.players[0].raw["future_player_field"] == {"nested": True}
    assert result.data.metadata.raw["future_flag"] == "preserved"


async def test_absent_required_field_distinguishable_from_model_default():
    fixture = deepcopy(_load("match_detail_v4/incomplete.json"))
    del fixture["data"]["metadata"]["is_completed"]  # absent upstream
    del fixture["data"]["metadata"]["started_at"]  # absent upstream

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=fixture)

    client = _client(handler)
    try:
        result = await client.get_match_detail("00000000-0000-0000-0000-000000000003", affinity="eu")
    finally:
        await client.aclose()

    # The parsed model defaults is_completed to False (tolerant layer)...
    assert result.data.metadata.is_completed is False
    # ...but the retained raw metadata distinguishes absence from an explicit
    # `false`, which is what the import layer needs for the U7 required set.
    assert "is_completed" not in result.data.metadata.raw
    assert "is_completed" not in result.raw["data"]["metadata"]
    assert result.data.metadata.started_at is None
    assert "started_at" not in result.data.metadata.raw


async def test_history_item_raw_preserves_extra_fields():
    fixture = deepcopy(_load("history_v4/page1_mixed_modes.json"))
    fixture["data"][0]["metadata"]["future_flag"] = "kept"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=fixture)

    client = _client(handler)
    try:
        items = await client.get_matches_by_puuid("puuid_p_a", affinity="eu", platform="pc")
    finally:
        await client.aclose()

    assert items[0].raw == fixture["data"][0]
    assert items[0].raw["metadata"]["future_flag"] == "kept"
    assert items[0].metadata.raw["future_flag"] == "kept"


# ---------------------------------------------------------------- structured log

async def test_per_request_log_carries_headers_and_retry_count(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "X-Request-ID": "abc-123",
                "X-RateLimit-Remaining": "95",
                "X-RateLimit-Reset": "1700000000",
                "X-Cache-Status": "HIT",
            },
            json=_load("account_v2/valid.json"),
        )

    client = _client(handler)
    with caplog.at_level(logging.INFO, logger="app.integrations.henrik.client"):
        try:
            await client.get_account("PlayerA", "A")
        finally:
            await client.aclose()

    records = [r for r in caplog.records if r.name == "app.integrations.henrik.client"]
    assert records
    last = records[-1]
    assert last.endpoint == "account"
    assert last.status == 200
    assert last.x_request_id == "abc-123"
    assert last.x_ratelimit_remaining == "95"
    assert last.x_ratelimit_reset == "1700000000"
    assert last.x_cache_status == "HIT"
    assert last.retries == 0
    assert isinstance(last.duration_ms, float)
