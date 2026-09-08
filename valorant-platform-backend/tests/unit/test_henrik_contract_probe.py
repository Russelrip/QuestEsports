"""Probe tests for scripts.henrik_contract_probe (Wave 0).

Covers fixture-only mode, API-key gating, request construction/auth
propagation, bounded call count, deny-by-default sanitization, pagination
selection, custom-mode classification, strict U6/U7 rules, CLI-path output, and
sanitized live fixture writes. No test hits the network: the live path is
driven by an injected ``httpx.MockTransport`` or a patched ``_probe_live``.
"""

import asyncio
import json
import sys
from dataclasses import asdict

import httpx
import pytest

from app.config import Settings
from scripts.henrik_contract_probe import (
    MAX_LIVE_REQUESTS,
    PINNED_STAT_KEYS,
    ContractEvidence,
    _project_sample,
    _Sanitizer,
    _stats_contract_resolved,
    _u7_contract_resolved,
    _u_items,
    run_probe,
    sanitize_payload,
)

API_KEY = "test-secret-key-1234"

# "Real-looking" identifiers that must never survive sanitization.
REAL_PUUID = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
REAL_NAME = "TenzRival"
REAL_TAG = "EUX"
REAL_MATCH = "a1b2c3d4-1111-2222-3333-444455556666"
REAL_MAP_ID = "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319"


def _settings() -> Settings:
    return Settings(
        henrik_base_url="https://api.henrikdev.xyz",
        henrik_timeout_seconds=5.0,
        default_affinity="eu",
        default_platform="pc",
    )


def _account_body(name: str = REAL_NAME, tag: str = REAL_TAG, puuid: str = REAL_PUUID) -> dict:
    return {
        "status": 200,
        "data": {
            "puuid": puuid,
            "region": "eu",
            # A long, unmistakable sentinel rather than a realistic level.
            # The leak assertion below is a substring search over the whole
            # sanitized blob, and a three-digit value collides with incidental
            # digits in it -- "128" matched the microseconds of a captured_at
            # timestamp and failed the run. _project_account drops the field
            # entirely, so the magnitude is irrelevant to what is under test.
            "account_level": 8675309421,
            "name": name,
            "tag": tag,
            "card": {"small": "https://example.com/card_small.png", "id": "card_9"},
            "title": "Pro Player",
            "platforms": ["PC"],
            "updated_at": "2026-08-12T18:40:00Z",
        },
    }


def _match_body(match_id: str = REAL_MATCH) -> dict:
    return {
        "metadata": {
            "match_id": match_id,
            "map": {"id": REAL_MAP_ID, "name": "Ascent"},
            "started_at": "2026-08-12T18:40:00Z",
            "is_completed": True,
            "mode": "Custom",
            "queue": None,
        },
        "players": [
            {
                "puuid": REAL_PUUID,
                "name": REAL_NAME,
                "tag": REAL_TAG,
                "team_id": "Red",
                "character": "Jett",
                "stats": {
                    "kills": 21,
                    "deaths": 11,
                    "assists": 5,
                    "score": 3400,
                    "damage_dealt": 4200,
                    "damage_received": 2100,
                    "headshots": 12,
                    "bodyshots": 34,
                    "legshots": 8,
                },
            }
        ],
        "teams": [
            {"team_id": "Red", "rounds": {"won": 13, "lost": 9}, "won": True},
            {"team_id": "Blue", "rounds": {"won": 9, "lost": 13}, "won": False},
        ],
    }


def _history_body() -> dict:
    return {"status": 200, "data": [_match_body()]}


def _detail_body() -> dict:
    return {"status": 200, "data": _match_body()}


class _FakeTransport:
    """Records every request and serves configurable statuses per endpoint."""

    def __init__(
        self,
        *,
        correct_scheme: str = "bare",
        start_statuses: dict[str | None, int] | None = None,
        mode_status: int = 200,
        history_body: dict | None = None,
        detail_body: dict | None = None,
    ) -> None:
        self.requests: list[httpx.Request] = []
        self.correct_scheme = correct_scheme
        self.start_statuses = start_statuses or {"0": 200, "1": 400, None: 400}
        self.mode_status = mode_status
        self.history_body = history_body or _history_body()
        self.detail_body = detail_body or _detail_body()
        self.transport = httpx.MockTransport(self.handler)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.startswith("/valorant/v2/account/"):
            header = request.headers.get("Authorization", "")
            if self.correct_scheme == "bare" and header == API_KEY:
                return httpx.Response(200, json=_account_body())
            if self.correct_scheme == "Bearer" and header == f"Bearer {API_KEY}":
                return httpx.Response(200, json=_account_body())
            return httpx.Response(401, json={"status": 401, "errors": [{"message": "no", "code": None}]})
        if path.startswith("/valorant/v4/by-puuid/"):
            params = request.url.params
            if params.get("mode") == "Custom":
                if self.mode_status == 400:
                    return httpx.Response(
                        400, json={"status": 400, "errors": [{"code": 27, "message": "invalid mode"}]}
                    )
                if self.mode_status == 429:
                    return httpx.Response(
                        429,
                        json={"status": 429, "errors": [{"code": None, "message": "rl"}]},
                        headers={"X-Request-ID": "some-request-id", "Retry-After": "5"},
                    )
                return httpx.Response(self.mode_status, json=self.history_body)
            status = self.start_statuses.get(params.get("start"), 400)
            if status == 200:
                return httpx.Response(200, json=self.history_body)
            return httpx.Response(status, json={"status": status, "errors": [{"code": 45, "message": "bad start"}]})
        if path.startswith("/valorant/v4/match/"):
            return httpx.Response(200, json=self.detail_body)
        return httpx.Response(404, json={"status": 404, "errors": [{"code": 26, "message": "nf"}]})


def _transport(
    *,
    correct_scheme: str = "bare",
    start_statuses: dict[str | None, int] | None = None,
    mode_status: int = 200,
    history_body: dict | None = None,
    detail_body: dict | None = None,
) -> _FakeTransport:
    return _FakeTransport(
        correct_scheme=correct_scheme,
        start_statuses=start_statuses,
        mode_status=mode_status,
        history_body=history_body,
        detail_body=detail_body,
    )


# ---------------------------------------------------------------- fixture mode

async def test_fixture_only_mode_reports_pinned_values():
    evidence = await run_probe(_settings(), "", live=False)
    assert isinstance(evidence, ContractEvidence)
    assert evidence.auth_scheme == "unresolved"
    assert evidence.first_page_start == 0
    assert evidence.first_page_start_resolved is False
    assert set(evidence.side_literals) == {"Red", "Blue"}
    assert evidence.custom_mode_literal is None
    assert evidence.history_has_completion is True
    assert evidence.history_has_started_at is True
    assert evidence.detail_is_completed is True
    # Names-only rate-header evidence is retained from the 429 fixture.
    assert evidence.rate_headers_seen == ["Retry-After", "X-RateLimit-Reset", "X-Request-ID"]
    assert "Retry-After" in evidence.raw_samples["error_429"].get("_headers", [])


async def test_fixture_only_mode_never_hits_network():
    fake = _FakeTransport()
    await run_probe(_settings(), "", live=False, transport=fake.transport)
    assert fake.requests == []  # transport injected but never used


# -------------------------------------------------------------------- gating

async def test_live_without_key_raises_before_network():
    fake = _FakeTransport()
    with pytest.raises(ValueError, match="HENRIK_API_KEY"):
        await run_probe(_settings(), "", live=True, transport=fake.transport)
    assert fake.requests == []


# ----------------------------------------- request construction / propagation

async def test_bare_auth_detected_and_propagated():
    fake = _transport(correct_scheme="bare")
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.auth_scheme == "bare"
    assert fake.requests
    for req in fake.requests:
        assert req.headers.get("Authorization") == API_KEY
        assert "Bearer" not in req.headers.get("Authorization", "")


async def test_bearer_auth_detected_and_propagated():
    fake = _transport(correct_scheme="Bearer")
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.auth_scheme == "Bearer"
    assert fake.requests
    assert fake.requests[0].headers.get("Authorization") == API_KEY
    for req in fake.requests[1:]:
        assert req.headers.get("Authorization") == f"Bearer {API_KEY}"


async def test_queue_param_never_sent():
    fake = _transport()
    await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    for req in fake.requests:
        assert req.url.params.get("queue") is None


# --------------------------------------------------------------- bounded calls

async def test_bounded_call_count_never_exceeds_max():
    fake = _transport(correct_scheme="bare")
    await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert len(fake.requests) <= MAX_LIVE_REQUESTS
    assert len(fake.requests) == 6  # 1 account + 3 pagination + 1 custom-mode + 1 detail


# --------------------------------------- deny-by-default projection (finding 1)

def test_project_sample_account_denies_private_fields():
    sample = _account_body()
    out = _project_sample(sample, _Sanitizer(API_KEY))
    data = out["data"]
    assert "account_level" not in data
    assert "card" not in data
    assert "title" not in data
    assert "updated_at" not in data
    assert set(data) == {"puuid", "region", "name", "tag", "platforms"}
    assert data["puuid"] == "puuid_p_a"
    assert data["name"] == "PlayerA"
    assert data["tag"] == "A"


def test_project_sample_match_denies_extra_fields_and_stats_values():
    sample = _match_body()
    out = _project_sample({"status": 200, "data": sample}, _Sanitizer(API_KEY))
    item = out["data"]
    assert set(item) == {"metadata", "players", "teams"}
    player = item["players"][0]
    assert "character" not in player  # arbitrary extra field denied
    stats = player["stats"]
    assert set(stats) == set(PINNED_STAT_KEYS)
    assert all(v == 0 for v in stats.values())  # values scrubbed
    blob = json.dumps(out)
    for raw in (REAL_PUUID, REAL_NAME, REAL_TAG, REAL_MATCH, REAL_MAP_ID):
        assert raw not in blob


def test_project_sample_error_message_redacted_and_headers_names_only():
    sample = {
        "status": 429,
        "errors": [{"code": None, "message": "Rate limit reached. Please wait"}],
        "_headers": {"Retry-After": "5", "X-Request-ID": "secret-req-id", "X-Secret": "x"},
    }
    out = _project_sample(sample, _Sanitizer(API_KEY))
    assert out["errors"][0]["message"] == "[REDACTED]"
    assert out["_headers"] == ["Retry-After", "X-Request-ID"]  # unknown header dropped
    assert "secret-req-id" not in json.dumps(out)


def test_sanitize_payload_redacts_real_identifiers():
    payload = {
        "data": {
            "puuid": REAL_PUUID,
            "name": REAL_NAME,
            "tag": REAL_TAG,
            "metadata": {"match_id": REAL_MATCH, "map": {"id": REAL_MAP_ID, "name": "Ascent"}},
            "players": [{"puuid": REAL_PUUID, "name": REAL_NAME, "tag": REAL_TAG, "team_id": "Red"}],
            "_headers": {"X-Request-ID": "secret-req-id", "Retry-After": "5"},
        }
    }
    out = sanitize_payload(payload, API_KEY)
    blob = json.dumps(out)
    for raw in (REAL_PUUID, REAL_NAME, REAL_TAG, REAL_MATCH, "secret-req-id", API_KEY):
        assert raw not in blob
    for fake in ("puuid_p_a", "PlayerA", "00000000-0000-0000-0000-000000000001"):
        assert fake in blob


# ------------------------------------------------- CLI-path tests (finding 1)

def _run_cli(monkeypatch, tmp_path, args, *, fake: _FakeTransport | None = None) -> tuple[str, dict, list[str]]:
    import scripts.henrik_contract_probe as probe_mod

    for sub in ("account_v2", "history_v4", "match_detail_v4", "errors"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    evidence_file = tmp_path / "henrik-contract-evidence.json"
    monkeypatch.setattr(probe_mod, "EVIDENCE_PATH", evidence_file)
    monkeypatch.setattr(probe_mod, "FIXTURE_DIR", tmp_path)
    monkeypatch.setattr(probe_mod, "get_settings", lambda: _settings())
    monkeypatch.setenv("HENRIK_API_KEY", API_KEY)
    if fake is not None:
        orig = probe_mod._probe_live

        async def patched(settings, api_key, transport=None):
            return await orig(settings, api_key, transport=fake.transport)

        monkeypatch.setattr(probe_mod, "_probe_live", patched)

    monkeypatch.setattr(sys, "argv", ["probe", *args])
    captured = _capture_stdout(monkeypatch)
    asyncio.run(probe_mod.main())
    stdout = captured()
    evidence = json.loads(evidence_file.read_text()) if evidence_file.exists() else {}
    written = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*.json") if p != evidence_file)
    return stdout, evidence, written


def _capture_stdout(monkeypatch):
    import io

    buffer = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buffer)

    def read() -> str:
        return buffer.getvalue()

    return read


def test_cli_live_path_evidence_and_fixtures_are_sanitized(monkeypatch, tmp_path):
    fake = _transport()
    stdout, evidence, written = _run_cli(monkeypatch, tmp_path, ["--live"], fake=fake)

    blob = stdout + json.dumps(evidence)
    for raw in (REAL_PUUID, REAL_NAME, REAL_TAG, REAL_MATCH, API_KEY, "Pro Player", "card_9", 8675309421):
        assert str(raw) not in blob

    # Generic live_* fixture names only; deterministic names never written.
    assert any("account_v2/live.json" in w for w in written)
    assert any("history_v4/live_page.json" in w for w in written)
    assert any("match_detail_v4/live.json" in w for w in written)
    assert "account_v2/valid.json" not in written
    assert "match_detail_v4/completed_custom.json" not in written

    # Every written fixture is a deny-by-default projection.
    for w in written:
        content = json.loads((tmp_path / w).read_text())
        assert not _contains_raw(content)


def test_cli_live_output_reports_u5_rejected_and_u6_resolved(monkeypatch, tmp_path):
    """Live evidence output reports U5 as a resolved rejection and U6 as
    resolved against the RECORDED (sanitized) surface: an extra raw stat key
    outside the pinned set is dropped at the deny-by-default output boundary,
    and U-item statuses describe the evidence that is actually recorded."""
    match = _match_body()
    # Raw live stats carry a non-pinned key that sanitization must drop.
    match["players"][0]["stats"]["damage_made"] = 5000
    fake = _transport(
        mode_status=400,
        history_body={"status": 200, "data": [match]},
        detail_body={"status": 200, "data": match},
    )
    _stdout, evidence, _written = _run_cli(monkeypatch, tmp_path, ["--live"], fake=fake)

    assert evidence["u_items"]["U5"]["status"] == "resolved"
    assert evidence["u_items"]["U5"]["value"] == "not accepted (rejected)"
    assert evidence["u_items"]["U6"]["status"] == "resolved"
    assert evidence["u_items"]["U6"]["value"] == "present"
    # The dropped raw key is not part of the recorded evidence surface.
    assert "damage_made" not in json.dumps(evidence)


def _contains_raw(value) -> bool:
    blob = json.dumps(value)
    for raw in (REAL_PUUID, REAL_NAME, REAL_TAG, REAL_MATCH, REAL_MAP_ID, API_KEY):
        if raw in blob:
            return True
    return False


def test_cli_fixture_path_writes_expected_evidence(monkeypatch, tmp_path):
    _stdout, evidence, written = _run_cli(monkeypatch, tmp_path, [])
    assert evidence["probe"] == "fixture"
    assert evidence["u_items"]["U4"]["status"] == "unresolved"
    assert evidence["u_items"]["U5"]["status"] == "unresolved"
    assert written == []  # fixture mode never writes live fixtures
    assert evidence["evidence"]["rate_headers_seen"] == ["Retry-After", "X-RateLimit-Reset", "X-Request-ID"]


# ------------------------------------------------- pagination selection (U4)

async def test_pagination_first_page_start_0_from_success():
    fake = _transport(start_statuses={"0": 200, "1": 400, None: 400})
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.first_page_start == 0
    assert evidence.first_page_start_resolved is True
    assert _u_items(evidence)["U4"]["status"] == "resolved"


async def test_pagination_omission_represented_as_minus_1():
    fake = _transport(start_statuses={"0": 400, "1": 400, None: 200})
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.first_page_start == -1
    assert evidence.first_page_start_resolved is True


async def test_pagination_no_success_keeps_fallback_unresolved():
    fake = _transport(start_statuses={"0": 400, "1": 400, None: 400})
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.first_page_start == 0
    assert evidence.first_page_start_resolved is False
    assert _u_items(evidence)["U4"]["status"] == "unresolved"


# ------------------------------------------------- custom-mode classification

async def test_custom_mode_2xx_accepted():
    fake = _transport(mode_status=200)
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.custom_mode_literal == "Custom"
    assert evidence.custom_mode_status == "accepted"
    assert _u_items(evidence)["U5"]["status"] == "resolved"


async def test_custom_mode_400_rejected_no_assumption():
    fake = _transport(mode_status=400)
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.custom_mode_literal is None
    assert evidence.custom_mode_status == "rejected"
    # A rejection is a resolved fact: no literal is accepted upstream, so the
    # None/local-filter fallback is confirmed.
    assert _u_items(evidence)["U5"]["status"] == "resolved"
    assert _u_items(evidence)["U5"]["value"] == "not accepted (rejected)"


async def test_custom_mode_429_unknown_no_assumption():
    fake = _transport(mode_status=429)
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    assert evidence.custom_mode_literal is None
    assert evidence.custom_mode_status == "unknown"
    assert _u_items(evidence)["U5"]["status"] == "unresolved"
    assert "Retry-After" in evidence.raw_samples.get("error_429", {}).get("_headers", [])


# ------------------------------------------------------- account-first identity

async def test_history_uses_real_account_puuid_not_fake():
    fake = _transport()
    await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    history_urls = [req.url for req in fake.requests if "/by-puuid/" in str(req.url)]
    assert history_urls
    for url in history_urls:
        assert REAL_PUUID in str(url)
        assert "puuid_p_a" not in str(url)
        assert "eu" in str(url)


# --------------------------------------------------------- U6 strict contract

def _ev_with_samples(history: dict | None = None, detail: dict | None = None) -> ContractEvidence:
    raw_samples: dict[str, dict] = {}
    if history is not None:
        raw_samples["history"] = history
    if detail is not None:
        raw_samples["detail"] = detail
    return ContractEvidence(
        auth_scheme="bare",
        first_page_start=0,
        side_literals=["Red", "Blue"],
        custom_mode_literal=None,
        history_has_completion=True,
        history_has_started_at=True,
        detail_is_completed=True,
        rate_headers_seen=[],
        raw_samples=raw_samples,
        first_page_start_resolved=True,
        custom_mode_status="accepted",
    )


def test_u6_complete_stats_resolved_in_history():
    match = _match_body()
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is True
    assert _u_items(evidence)["U6"]["status"] == "resolved"


def test_u6_complete_stats_resolved_in_detail_dict():
    match = _match_body()
    evidence = _ev_with_samples(detail={"status": 200, "data": match})
    assert _stats_contract_resolved(evidence) is True
    assert _u_items(evidence)["U6"]["status"] == "resolved"


def test_u6_partial_stats_resolved():
    match = _match_body()
    match["players"][0]["stats"] = {"kills": 21, "deaths": 11}
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is True


def test_u6_absent_stats_unresolved():
    match = _match_body()
    match["players"][0].pop("stats")
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is False
    assert _u_items(evidence)["U6"]["status"] == "unresolved"


def test_u6_unknown_stat_key_unresolved():
    match = _match_body()
    match["players"][0]["stats"]["assists_per_round"] = 1
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is False
    assert _u_items(evidence)["U6"]["status"] == "unresolved"


def test_u6_missing_stats_on_other_players_tolerated():
    match = _match_body()
    match["players"].append({"puuid": REAL_PUUID, "name": REAL_NAME, "tag": REAL_TAG, "team_id": "Blue"})
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is True


# ----------------------------------------- U6 malformed stats (fix round 3)

def test_u6_malformed_stats_string_in_history_unresolved():
    match = _match_body()
    match["players"][0]["stats"] = "not-a-dict"
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is False
    assert _u_items(evidence)["U6"]["status"] == "unresolved"


def test_u6_malformed_stats_list_in_history_unresolved():
    match = _match_body()
    match["players"][0]["stats"] = [1, 2, 3]
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is False


def test_u6_malformed_stats_string_in_detail_unresolved():
    match = _match_body()
    match["players"][0]["stats"] = "not-a-dict"
    evidence = _ev_with_samples(detail={"status": 200, "data": match})
    assert _stats_contract_resolved(evidence) is False
    assert _u_items(evidence)["U6"]["status"] == "unresolved"


def test_u6_malformed_stats_list_in_detail_unresolved():
    match = _match_body()
    match["players"][0]["stats"] = [1, 2, 3]
    evidence = _ev_with_samples(detail={"status": 200, "data": match})
    assert _stats_contract_resolved(evidence) is False


def test_u6_mixed_valid_and_malformed_players_unresolved():
    match = _match_body()
    match["players"].append(
        {"puuid": "puuid_p_x", "name": "X", "tag": "X", "team_id": "Blue", "stats": "broken"}
    )
    evidence = _ev_with_samples(history={"status": 200, "data": [match]})
    assert _stats_contract_resolved(evidence) is False
    assert _u_items(evidence)["U6"]["status"] == "unresolved"


# --------------------------------------------------------- U7 shape contract

def test_u7_valid_history_and_detail_resolved():
    evidence = _ev_with_samples(
        history={"status": 200, "data": [_match_body()]},
        detail={"status": 200, "data": _match_body()},
    )
    assert _u7_contract_resolved(evidence) is True
    assert _u_items(evidence)["U7"]["status"] == "resolved"


def test_u7_history_only_unresolved():
    evidence = _ev_with_samples(history={"status": 200, "data": [_match_body()]})
    assert _u7_contract_resolved(evidence) is False
    assert _u_items(evidence)["U7"]["status"] == "unresolved"


def test_u7_detail_only_unresolved():
    evidence = _ev_with_samples(detail={"status": 200, "data": _match_body()})
    assert _u7_contract_resolved(evidence) is False
    assert _u_items(evidence)["U7"]["status"] == "unresolved"


def test_u7_history_must_be_list_shape():
    evidence = _ev_with_samples(
        history={"status": 200, "data": _match_body()},  # dict where list expected
        detail={"status": 200, "data": _match_body()},
    )
    assert _u7_contract_resolved(evidence) is False


def test_u7_detail_must_be_dict_shape():
    evidence = _ev_with_samples(
        history={"status": 200, "data": [_match_body()]},
        detail={"status": 200, "data": [_match_body()]},  # list where dict expected
    )
    assert _u7_contract_resolved(evidence) is False


def test_u7_malformed_player_missing_puuid_unresolved():
    # Both shapes present; only the history player is malformed.
    match = _match_body()
    del match["players"][0]["puuid"]
    evidence = _ev_with_samples(
        history={"status": 200, "data": [match]},
        detail={"status": 200, "data": _match_body()},
    )
    assert _u7_contract_resolved(evidence) is False
    assert _u_items(evidence)["U7"]["status"] == "unresolved"


def test_u7_malformed_metadata_missing_started_at_unresolved():
    # Both shapes present; only the detail metadata is malformed.
    match = _match_body()
    del match["metadata"]["started_at"]
    evidence = _ev_with_samples(
        history={"status": 200, "data": [_match_body()]},
        detail={"status": 200, "data": match},
    )
    assert _u7_contract_resolved(evidence) is False


def test_u7_team_without_team_id_unresolved():
    # Both shapes present; only the detail team is malformed.
    match = _match_body()
    match["teams"][0].pop("team_id")
    evidence = _ev_with_samples(
        history={"status": 200, "data": [_match_body()]},
        detail={"status": 200, "data": match},
    )
    assert _u7_contract_resolved(evidence) is False


def test_u7_missing_match_id_unresolved():
    match = _match_body()
    del match["metadata"]["match_id"]
    evidence = _ev_with_samples(
        history={"status": 200, "data": [match]},
        detail={"status": 200, "data": _match_body()},
    )
    assert _u7_contract_resolved(evidence) is False


def test_u7_missing_player_name_unresolved():
    match = _match_body()
    del match["players"][0]["name"]
    evidence = _ev_with_samples(
        history={"status": 200, "data": [match]},
        detail={"status": 200, "data": _match_body()},
    )
    assert _u7_contract_resolved(evidence) is False


# ----------------------------------- missing identifiers (fix round 3)

def test_projection_preserves_missing_identifiers():
    """Missing/null required identifiers must stay missing in projections —
    never fabricated into valid-looking fakes via ``str(None)``."""
    account = {"status": 200, "data": {"region": "eu", "platforms": ["PC"]}}  # no puuid/name/tag
    out = _project_sample(account, _Sanitizer(API_KEY))
    assert out["data"]["puuid"] is None
    assert out["data"]["name"] is None
    assert out["data"]["tag"] is None
    assert "puuid_p_a" not in json.dumps(out)

    match = _match_body()
    match["metadata"]["match_id"] = None
    match["players"][0]["puuid"] = None
    match["players"][0]["name"] = None
    match["players"][0]["tag"] = None
    out = _project_sample({"status": 200, "data": match}, _Sanitizer(API_KEY))
    assert out["data"]["metadata"]["match_id"] is None
    assert out["data"]["players"][0]["puuid"] is None
    assert out["data"]["players"][0]["name"] is None
    assert out["data"]["players"][0]["tag"] is None
    # The faked UUID present here is the *map.id* (a real non-null UUID that is
    # legitimately faked) — the missing required identifiers stay null, and no
    # fake identity string is produced for them.
    assert "puuid_p_" not in json.dumps(out)
    assert '"match_id": null' in json.dumps(out)


def test_missing_identifiers_reported_unresolved_not_populated():
    """Evidence with missing required identifiers is invalid/unresolved and is
    never silently populated with fakes in the reported status."""
    match = _match_body()
    match["metadata"]["match_id"] = None
    evidence = _ev_with_samples(
        history={"status": 200, "data": [match]},
        detail={"status": 200, "data": _match_body()},
    )
    assert _u7_contract_resolved(evidence) is False
    assert _u_items(evidence)["U7"]["status"] == "unresolved"


# ------------------------------------------------------------- U1–U7 reporting

async def test_u_items_fixture_mode():
    evidence = await run_probe(_settings(), "", live=False)
    items = _u_items(evidence)
    assert items["U1"]["status"] == "unresolved"
    assert items["U2"]["status"] == "resolved"
    assert items["U3"]["status"] == "resolved"
    assert items["U4"]["status"] == "unresolved"
    assert items["U5"]["status"] == "unresolved"
    assert items["U6"]["status"] == "resolved"
    assert items["U7"]["status"] == "resolved"


async def test_u_items_live_success():
    fake = _transport(correct_scheme="bare", start_statuses={"0": 200, "1": 400, None: 400}, mode_status=200)
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    items = _u_items(evidence)
    assert items["U1"]["status"] == "resolved"
    assert items["U2"]["status"] == "resolved"
    assert items["U4"]["status"] == "resolved"
    assert items["U5"]["status"] == "resolved"
    assert items["U6"]["status"] == "resolved"
    assert items["U7"]["status"] == "resolved"


# ------------------------------------------------- 429 header evidence (finding 4)

async def test_live_429_preserves_header_names_in_sample():
    fake = _transport(mode_status=429)
    evidence = await run_probe(_settings(), API_KEY, live=True, transport=fake.transport)
    sample = evidence.raw_samples.get("error_429", {})
    assert "_headers" in sample
    assert "X-Request-ID" in sample["_headers"]
    assert "Retry-After" in sample["_headers"]


def test_write_sanitized_fixtures_skips_429_without_headers(tmp_path):
    from pathlib import Path

    import scripts.henrik_contract_probe as probe_mod
    from scripts.henrik_contract_probe import _write_sanitized_fixtures

    for sub in ("account_v2", "history_v4", "match_detail_v4", "errors"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)

    evidence = _ev_with_samples(
        history={"status": 200, "data": [_match_body()]},
        detail={"status": 200, "data": _match_body()},
    )
    evidence = ContractEvidence(
        **{**asdict(evidence),
           "raw_samples": {
               **evidence.raw_samples,
               "account": _account_body(),
               # 429 body WITHOUT _headers must not be written.
               "error_429": {"status": 429, "errors": [{"code": None, "message": "rl"}]},
           }}
    )

    orig = probe_mod.FIXTURE_DIR
    probe_mod.FIXTURE_DIR = Path(tmp_path)
    try:
        written = _write_sanitized_fixtures(evidence, _Sanitizer(API_KEY))
    finally:
        probe_mod.FIXTURE_DIR = orig

    assert "errors/live_error_429.json" not in written
    assert any("account_v2/live.json" in w for w in written)
    assert any("history_v4/live_page.json" in w for w in written)
    assert any("match_detail_v4/live.json" in w for w in written)
    blob = "".join((tmp_path / w).read_text() for w in written)
    for raw in (REAL_PUUID, REAL_NAME, REAL_TAG, REAL_MATCH, API_KEY):
        assert raw not in blob
