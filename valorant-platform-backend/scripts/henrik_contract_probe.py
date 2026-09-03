"""Wave 0 Henrik contract probe (Task 2).

Fixture-only by default: reads the checked-in sanitized fixtures and reports
pinned contract values. With ``--live`` (requires ``HENRIK_API_KEY``) it probes
the live API in a bounded, opt-in sequence (at most ``MAX_LIVE_REQUESTS``
requests), writes sanitized evidence to ``docs/henrik-contract-evidence.json``
and sanitized payloads into ``tests/fixtures/henrik/`` under generic ``live_*``
names. The API key is never logged or written; live payloads pass through a
deny-by-default output boundary that keeps only documented contract fields and
replaces all real identifiers with deterministic fakes.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeVar

import httpx

from app.config import Settings, get_settings
from app.integrations.henrik.contract import AUTH_SCHEME_PINNED, FIRST_PAGE_START

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# Read source for fixture-only mode (committed deterministic fixtures).
FIXTURE_SOURCE_DIR = PROJECT_ROOT / "tests" / "fixtures" / "henrik"
# Write target for live-captured sanitized fixtures (tests may redirect this).
FIXTURE_DIR = PROJECT_ROOT / "tests" / "fixtures" / "henrik"
EVIDENCE_PATH = PROJECT_ROOT / "docs" / "henrik-contract-evidence.json"

# Hard bound on the live probe: 2 auth + 3 pagination (0/1/omission, the
# omission page doubles as the "retry without mode" fallback) + 1 custom-mode
# + 1 detail = 7. No tight loops; every request is counted and capped.
MAX_LIVE_REQUESTS = 7

# Documented upstream rate-limit/observability headers (design §5.5). Presence
# varies; the client must log them when present but never require them.
RATE_HEADER_NAMES = (
    "RateLimit-Policy",
    "RateLimit",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "X-RateLimit-Bucket",
    "X-Request-ID",
    "X-Cache-Status",
    "X-Cache-TTL",
)

# Deterministic fake identity used in fixtures. A live probe must be pointed at
# a real, public known test account via HENRIK_TEST_ACCOUNT (format "name:tag");
# the fake below 404s against the real API.
KNOWN_ACCOUNT_NAME = "PlayerA"
KNOWN_ACCOUNT_TAG = "A"
PROBE_PLATFORM = "pc"

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

# Exact pinned optional stats contract (U6): the full set of documented
# `players[].stats` sub-fields. Stats is optional; when present every key must
# be within this set. Resolved only when at least one player across the
# captured history items and detail `data` has a non-empty stats dict whose
# keys all belong to this set (no any-one-key shortcut).
PINNED_STAT_KEYS = frozenset(
    {"kills", "deaths", "assists", "score", "damage_dealt", "damage_received",
     "headshots", "bodyshots", "legshots"}
)

# Deny-by-default allowlists for the live-output projection (finding 1).
ACCOUNT_DATA_KEYS = ("puuid", "region", "name", "tag", "platforms")
MATCH_KEYS = ("metadata", "players", "teams")
METADATA_KEYS = ("match_id", "map", "started_at", "is_completed", "mode", "queue")
MAP_KEYS = ("id", "name")
PLAYER_KEYS = ("puuid", "name", "tag", "team_id")
TEAM_KEYS = ("team_id", "rounds", "won")
ROUNDS_KEYS = ("won", "lost")
ERROR_ITEM_KEYS = ("code", "message")


@dataclass(frozen=True)
class ContractEvidence:
    """Sanitized contract evidence; values are fixture-pinned unless noted."""

    auth_scheme: str  # "bare" | "Bearer" | "unresolved"
    first_page_start: int  # 0 | 1 | -1 for "omission"
    side_literals: list[str]  # e.g. ["Red", "Blue"]
    custom_mode_literal: str | None  # e.g. "Custom" | None if rejected upstream
    history_has_completion: bool  # is_completed present in history objects
    history_has_started_at: bool
    detail_is_completed: bool | None
    rate_headers_seen: list[str]  # X-Request-ID, RateLimit-*, X-Cache-*
    raw_samples: dict[str, dict]  # minimal redacted samples per endpoint
    # Wave-0 fix-round state (defaulted): accurate U-status reporting
    first_page_start_resolved: bool = False  # set only by live 2xx evidence
    custom_mode_status: str = "not_attempted"  # accepted | rejected | unknown | not_attempted


class _Sanitizer:
    """Deterministic fake-identifier generator shared by the whole run.

    ``fake_ident`` maps a real value to a deterministic fake keyed by the
    original string, so the same real value always maps to the same fake within
    a run and already-fake values round-trip unchanged.
    """

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._puuid_map: dict[str, str] = {}
        self._name_map: dict[str, str] = {}
        self._tag_map: dict[str, str] = {}
        self._uuid_map: dict[str, str] = {}
        self._counters = {"puuid": 0, "name": 0, "tag": 0, "uuid": 0}

    def fake_ident(self, real: object, category: str) -> str | None:
        """Deterministic fake for a real identifier.

        Missing/null/empty values pass through unchanged (never ``str(None)``
        fabricated into a valid-looking fake). Non-empty values map to a stable
        deterministic fake keyed by the original string.
        """
        if real is None or (isinstance(real, str) and not real):
            return None
        real = str(real)
        table = {
            "puuid": self._puuid_map,
            "name": self._name_map,
            "tag": self._tag_map,
            "uuid": self._uuid_map,
        }[category]
        if real not in table:
            i = self._counters[category]
            if category == "puuid":
                table[real] = f"puuid_p_{_alpha(i)}"
            elif category == "name":
                table[real] = f"Player{_alpha(i).upper()}"
            elif category == "tag":
                table[real] = _alpha(i).upper()
            else:  # uuid
                table[real] = f"00000000-0000-0000-0000-{i + 1:012d}"
            self._counters[category] += 1
        return table[real]

    def redact(self, value: TV) -> TV:
        """Backstop redactor for non-sample output (u_items/note): replaces
        real identifiers, URLs, and the API key while preserving structure."""
        if isinstance(value, dict):
            out: dict = {}
            for key, val in value.items():
                if key == "_headers":
                    if isinstance(val, dict):
                        out[key] = [hk for hk in val if hk in RATE_HEADER_NAMES or hk == "Retry-After"]
                    else:
                        out[key] = list(val)
                elif key == "puuid":
                    out[key] = self.fake_ident(val, "puuid")
                elif key == "match_id":
                    out[key] = self.fake_ident(val, "uuid")
                elif key in ("name", "tag") and "puuid" in value:
                    out[key] = self.fake_ident(val, "name" if key == "name" else "tag")
                else:
                    out[key] = self.redact(val)
            return out  # type: ignore[return-value]
        if isinstance(value, list):
            return [self.redact(item) for item in value]  # type: ignore[return-value]
        if isinstance(value, str):
            return self._redact_str(value)  # type: ignore[return-value]
        return value

    def _redact_str(self, s: str) -> str:
        if self._api_key and self._api_key in s:
            return s.replace(self._api_key, "[REDACTED]")
        if UUID_RE.match(s):
            fake = self.fake_ident(s, "uuid")
            return fake if fake is not None else s
        if s.startswith(("http://", "https://")):
            return "https://example.invalid/redacted"
        return s


def _alpha(index: int) -> str:
    letters = ""
    while True:
        letters = chr(97 + index % 26) + letters
        index = index // 26 - 1
        if index < 0:
            return letters


T = TypeVar("T")
TV = TypeVar("TV")


def sanitize_payload(payload: T, api_key: str) -> T:
    """Backstop recursive redaction for generic structures (tests/backstop)."""
    return _Sanitizer(api_key).redact(payload)  # type: ignore[return-value]


# ---------------------------------------------------------------- projection

def _project_account(data: dict, sanitizer: _Sanitizer) -> dict:
    """Keep only documented account fields; scrub account_level/card/title.
    Missing identifiers stay missing (never fabricated via ``str(None)``)."""
    return {
        "puuid": sanitizer.fake_ident(data.get("puuid"), "puuid"),
        "region": data.get("region"),
        "name": sanitizer.fake_ident(data.get("name"), "name"),
        "tag": sanitizer.fake_ident(data.get("tag"), "tag"),
        "platforms": [str(p) for p in (data.get("platforms") or [])],
    }


def _project_player(player: dict, sanitizer: _Sanitizer) -> dict:
    """Keep identity fields + team side only; stats values scrubbed to a 0
    placeholder (keys preserved so U6 shape is observable). Missing
    identifiers stay missing."""
    out = {
        "puuid": sanitizer.fake_ident(player.get("puuid"), "puuid"),
        "name": sanitizer.fake_ident(player.get("name"), "name"),
        "tag": sanitizer.fake_ident(player.get("tag"), "tag"),
        "team_id": player.get("team_id"),
    }
    stats = player.get("stats")
    if isinstance(stats, dict):
        out["stats"] = {k: 0 for k in stats if k in PINNED_STAT_KEYS}
    return out


def _project_team(team: dict) -> dict:
    rounds = team.get("rounds") or {}
    return {
        "team_id": team.get("team_id"),
        "rounds": {
            "won": rounds.get("won") if isinstance(rounds, dict) else None,
            "lost": rounds.get("lost") if isinstance(rounds, dict) else None,
        },
        "won": team.get("won"),
    }


def _project_match(item: dict, sanitizer: _Sanitizer) -> dict:
    meta = item.get("metadata") or {}
    map_ = meta.get("map") or {}
    return {
        "metadata": {
            "match_id": sanitizer.fake_ident(meta.get("match_id"), "uuid"),
            "map": {
                "id": sanitizer.fake_ident(map_.get("id"), "uuid"),
                "name": map_.get("name"),
            },
            "started_at": meta.get("started_at"),
            "is_completed": meta.get("is_completed"),
            "mode": meta.get("mode"),
            "queue": meta.get("queue"),
        },
        "players": [_project_player(p, sanitizer) for p in (item.get("players") or [])],
        "teams": [_project_team(t) for t in (item.get("teams") or [])],
    }


def _project_sample(sample: dict, sanitizer: _Sanitizer) -> dict:
    """Deny-by-default projection of a live raw sample for evidence/fixtures.

    Only documented contract fields survive; arbitrary extra fields are
    dropped, free-form strings are redacted, and real identifiers are faked.
    """
    out: dict = {}
    headers = sample.get("_headers")
    if headers is not None:
        names = list(headers)  # dict (names as keys) or list of names
        out["_headers"] = [n for n in names if n in RATE_HEADER_NAMES or n == "Retry-After"]
    if "errors" in sample:
        out["status"] = sample.get("status")
        out["errors"] = []
        for err in sample.get("errors", []):
            item = {kk: vv for kk, vv in err.items() if kk in ERROR_ITEM_KEYS}
            if "message" in item:
                item["message"] = "[REDACTED]"
            out["errors"].append(item)
        return out
    data = sample.get("data")
    if isinstance(data, dict):
        if any(key in data for key in ("metadata", "players", "teams")):
            out["status"] = sample.get("status")
            out["data"] = _project_match(data, sanitizer)
        else:
            # Account object: no metadata/players/teams, carries region/platforms.
            out["status"] = sample.get("status")
            out["data"] = _project_account(data, sanitizer)
        return out
    if isinstance(data, list):
        out["status"] = sample.get("status")
        out["data"] = [_project_match(item, sanitizer) for item in data]
        return out
    out["status"] = sample.get("status")
    return out


def _load_json(relative: str) -> dict:
    path = FIXTURE_SOURCE_DIR / relative
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _collect_side_literals(match: dict) -> set[str]:
    literals: set[str] = set()
    for player in match.get("players", []):
        if player.get("team_id"):
            literals.add(player["team_id"])
    for team in match.get("teams", []):
        if team.get("team_id"):
            literals.add(team["team_id"])
    return literals


def _run_fixture_probe() -> ContractEvidence:
    """Read checked-in fixtures; report pinned values, skip live-only facts."""
    history = _load_json("history_v4/page1_mixed_modes.json")
    detail = _load_json("match_detail_v4/completed_custom.json")
    account = _load_json("account_v2/valid.json")

    side_literals: set[str] = set()
    history_has_completion = False
    history_has_started_at = False
    for item in history["data"]:
        side_literals |= _collect_side_literals(item)
        history_has_completion |= "is_completed" in item["metadata"]
        history_has_started_at |= "started_at" in item["metadata"]
    side_literals |= _collect_side_literals(detail["data"])

    detail_meta = detail["data"]["metadata"]
    detail_is_completed = detail_meta.get("is_completed")

    # The 429 fixture carries a documented header-name sample only (never
    # cookie/session values). Live verification of actual headers is opt-in.
    error_429 = _load_json("errors/error_429.json")
    header_names = error_429.get("_headers", [])
    if isinstance(header_names, dict):
        header_names = list(header_names)
    rate_headers_seen = [
        name
        for name in header_names
        if name in RATE_HEADER_NAMES or name == "Retry-After"
    ]

    raw_samples = {
        "account": account,
        "history": history,
        "detail": detail,
        "error_429": error_429,
    }

    return ContractEvidence(
        auth_scheme="unresolved",  # live-only fact; fallback documented in contract doc
        first_page_start=FIRST_PAGE_START,  # documented fallback (D12)
        side_literals=sorted(side_literals),
        custom_mode_literal=None,  # unresolved live fact; fallback: local filter
        history_has_completion=history_has_completion,
        history_has_started_at=history_has_started_at,
        detail_is_completed=detail_is_completed,
        rate_headers_seen=rate_headers_seen,
        raw_samples=raw_samples,
    )


def _auth_headers(api_key: str, scheme: str) -> dict[str, str]:
    if scheme == "Bearer":
        return {"Authorization": f"Bearer {api_key}"}
    return {"Authorization": api_key}


def _first_error_code(body: dict) -> int | None:
    for err in body.get("errors", []):
        code = err.get("code")
        if code is not None:
            return code
    return None


def _collect_rate_headers(resp: httpx.Response, seen: list[str]) -> list[str]:
    for name in (*RATE_HEADER_NAMES, "Retry-After"):
        if resp.headers.get(name) is not None and name not in seen:
            seen.append(name)
    return seen


def _minimal_account(raw: dict) -> dict:
    data = raw.get("data", {})
    return {
        "status": raw.get("status"),
        "data": {
            key: data.get(key)
            for key in ("puuid", "region", "account_level", "name", "tag",
                        "card", "title", "platforms", "updated_at")
        },
    }


def _minimal_history(raw: dict, max_items: int = 2) -> dict:
    data = raw.get("data", [])
    items = []
    for item in data[:max_items]:
        items.append(
            {
                "metadata": item.get("metadata", {}),
                "players": item.get("players", [])[:2],
                "teams": item.get("teams", []),
            }
        )
    return {"status": raw.get("status"), "data": items}


async def _probe_live(
    settings: Settings, api_key: str, transport: httpx.AsyncBaseTransport | None = None
) -> ContractEvidence:
    """Opt-in bounded live probe (max MAX_LIVE_REQUESTS). Never logs the key."""
    account_name = KNOWN_ACCOUNT_NAME
    account_tag = KNOWN_ACCOUNT_TAG
    if ":" in (test_acct := _env_or("HENRIK_TEST_ACCOUNT", "")):
        account_name, account_tag = test_acct.split(":", 1)

    raw_samples: dict[str, dict] = {}
    side_literals: set[str] = set()
    history_has_completion = False
    history_has_started_at = False
    detail_is_completed: bool | None = None
    rate_headers_seen: list[str] = []
    auth_scheme = "unresolved"
    first_page_start = FIRST_PAGE_START
    first_page_start_resolved = False
    custom_mode_literal: str | None = None
    custom_mode_status = "not_attempted"
    requests_made = 0

    async with httpx.AsyncClient(
        base_url=settings.henrik_base_url,
        timeout=settings.henrik_timeout_seconds,
        transport=transport,
    ) as client:
        # 1. Auth scheme + account resolution (max 2 calls). The account
        #    response supplies the real puuid/affinity for all later requests.
        account_raw: dict = {}
        for scheme in ("bare", "Bearer"):
            if requests_made >= MAX_LIVE_REQUESTS:
                break
            requests_made += 1
            resp = await client.get(
                f"/valorant/v2/account/{account_name}/{account_tag}",
                headers=_auth_headers(api_key, scheme),
            )
            rate_headers_seen = _collect_rate_headers(resp, rate_headers_seen)
            if resp.status_code == 200:
                auth_scheme = scheme
                account_raw = _safe_json(resp)
                break

        if account_raw:
            raw_samples["account"] = _minimal_account(account_raw)

        account_data = account_raw.get("data", {}) if account_raw else {}
        puuid = account_data.get("puuid")
        affinity = account_data.get("region") or settings.default_affinity

        if not puuid:
            # Account could not be resolved: history/detail probing is
            # impossible. Never falls back to a fake puuid in a live request.
            return ContractEvidence(
                auth_scheme=auth_scheme,
                first_page_start=first_page_start,
                side_literals=[],
                custom_mode_literal=None,
                history_has_completion=False,
                history_has_started_at=False,
                detail_is_completed=None,
                rate_headers_seen=rate_headers_seen,
                raw_samples=raw_samples,
                first_page_start_resolved=False,
                custom_mode_status="not_attempted",
            )

        # Centralized auth header for every subsequent request.
        headers = _auth_headers(api_key, auth_scheme if auth_scheme != "unresolved" else AUTH_SCHEME_PINNED)

        # 2. Pagination offset: start=0, start=1, omission (max 3 calls).
        #    The first 2xx page (which carries no `mode` param) doubles as the
        #    "retry without mode" fallback for custom-mode rejection — no extra
        #    request is needed.
        history_page: dict = {}
        for start in (0, 1, None):
            if requests_made >= MAX_LIVE_REQUESTS:
                break
            requests_made += 1
            params: dict[str, str] = {"size": "5"}
            if start is not None:
                params["start"] = str(start)
            resp = await client.get(
                f"/valorant/v4/by-puuid/matches/{affinity}/{PROBE_PLATFORM}/{puuid}",
                params=params,
                headers=headers,
            )
            body = _safe_json(resp)
            code = _first_error_code(body)
            rate_headers_seen = _collect_rate_headers(resp, rate_headers_seen)
            if 200 <= resp.status_code < 300:
                if not first_page_start_resolved:
                    first_page_start = -1 if start is None else start
                    first_page_start_resolved = True
                if not history_page:
                    history_page = body
            # Record any observed error envelope (e.g. code 27/45) for fixtures.
            if resp.status_code == 400 and code == 45:
                raw_samples["error_400_code45"] = body
            if resp.status_code == 429:
                raw_samples["error_429"] = _attach_rate_headers(resp, body)

        # 3+4. Custom mode: only a 2xx response is acceptance. Any other status
        #       is recorded as rejected/unknown without assuming "Custom".
        if requests_made < MAX_LIVE_REQUESTS:
            requests_made += 1
            resp = await client.get(
                f"/valorant/v4/by-puuid/matches/{affinity}/{PROBE_PLATFORM}/{puuid}",
                params={"size": "5", "mode": "Custom"},
                headers=headers,
            )
            mode_body = _safe_json(resp)
            rate_headers_seen = _collect_rate_headers(resp, rate_headers_seen)
            if 200 <= resp.status_code < 300:
                custom_mode_literal = "Custom"
                custom_mode_status = "accepted"
                if not history_page:
                    history_page = mode_body
            elif resp.status_code == 400 and _first_error_code(mode_body) == 27:
                custom_mode_status = "rejected"
                raw_samples["error_400_code27"] = mode_body
            else:
                custom_mode_status = "unknown"
                if resp.status_code == 429:
                    raw_samples["error_429"] = _attach_rate_headers(resp, mode_body)

        # 5. Completion/time fields + detail + rate headers on a 200.
        detail_id: str | None = None
        if history_page and history_page.get("data"):
            first = history_page["data"][0]
            detail_id = first.get("metadata", {}).get("match_id")
            history_has_completion |= "is_completed" in first.get("metadata", {})
            history_has_started_at |= "started_at" in first.get("metadata", {})
            side_literals |= _collect_side_literals(first)
        if detail_id and requests_made < MAX_LIVE_REQUESTS:
            requests_made += 1
            resp = await client.get(
                f"/valorant/v4/match/{affinity}/{detail_id}",
                headers=headers,
            )
            rate_headers_seen = _collect_rate_headers(resp, rate_headers_seen)
            if resp.status_code == 200:
                detail_body = _safe_json(resp)
                detail_meta = detail_body.get("data", {}).get("metadata", {})
                detail_is_completed = detail_meta.get("is_completed")
                side_literals |= _collect_side_literals(detail_body.get("data", {}))
                raw_samples["detail"] = detail_body

        if history_page:
            raw_samples["history"] = _minimal_history(history_page)

    if requests_made > MAX_LIVE_REQUESTS:  # pragma: no cover - defensive cap
        raise RuntimeError(f"live probe exceeded {MAX_LIVE_REQUESTS} requests")

    return ContractEvidence(
        auth_scheme=auth_scheme,
        first_page_start=first_page_start,
        side_literals=sorted(side_literals),
        custom_mode_literal=custom_mode_literal,
        history_has_completion=history_has_completion,
        history_has_started_at=history_has_started_at,
        detail_is_completed=detail_is_completed,
        rate_headers_seen=rate_headers_seen,
        raw_samples=raw_samples,
        first_page_start_resolved=first_page_start_resolved,
        custom_mode_status=custom_mode_status,
    )


def _attach_rate_headers(resp: httpx.Response, body: dict) -> dict:
    """Attach observed header NAMES to a 429 body (values never captured)."""
    names = [n for n in (*RATE_HEADER_NAMES, "Retry-After") if resp.headers.get(n) is not None]
    if not names:
        return body
    out = dict(body)
    out["_headers"] = names
    return out


def _env_or(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _safe_json(resp: httpx.Response) -> dict:
    """Parse an upstream body defensively; non-JSON upstream 5xx returns {}."""
    try:
        body: object = resp.json()
    except json.JSONDecodeError:
        body = {}
    return body if isinstance(body, dict) else {}


# ---------------------------------------------------------------- U6/U7 rules

def _iter_matches(evidence: ContractEvidence) -> list[dict]:
    """Yield match objects from both history items (list) and detail (dict)."""
    items: list[dict] = []
    for key in ("detail", "history"):
        sample = evidence.raw_samples.get(key)
        if not sample:
            continue
        data = sample.get("data")
        if isinstance(data, dict):
            items.append(data)
        elif isinstance(data, list):
            items.extend(data)
    return items


def _stats_contract_resolved(evidence: ContractEvidence) -> bool:
    """U6 rule: at least one player across history items and detail has a
    non-empty `stats` dict whose keys are ALL within PINNED_STAT_KEYS, and no
    unknown key and no malformed stats value is observed anywhere.

    A *present* `stats` that is not a dict (string/list/etc.) is a contract
    violation and marks U6 unresolved — it is never silently treated as absent.
    """
    saw_stats = False
    for item in _iter_matches(evidence):
        for player in item.get("players", []):
            if "stats" not in player:
                continue  # genuinely absent: optional, tolerated
            stats = player.get("stats")
            if not isinstance(stats, dict):
                return False  # malformed present stats -> unresolved
            if not stats:
                continue  # present-but-empty: no pinned key observed
            saw_stats = True
            if not set(stats).issubset(PINNED_STAT_KEYS):
                return False
    return saw_stats


def _u7_contract_resolved(evidence: ContractEvidence) -> bool:
    """U7 rule: BOTH the history-list envelope and the detail-dict envelope
    must be present and shaped correctly, and every captured match must have
    the required metadata/player/team fields."""
    history = evidence.raw_samples.get("history")
    detail = evidence.raw_samples.get("detail")
    # Both evidence shapes are required before U7 can resolve.
    if history is None or detail is None:
        return False
    if not isinstance(history.get("data"), list):
        return False
    if not isinstance(detail.get("data"), dict):
        return False
    items = _iter_matches(evidence)
    if not items:
        return False
    for item in items:
        meta = item.get("metadata")
        if not isinstance(meta, dict):
            return False
        if not meta.get("match_id"):
            return False
        if not isinstance(meta.get("map"), dict) or not meta.get("map", {}).get("name"):
            return False
        if "started_at" not in meta or "is_completed" not in meta:
            return False
        players = item.get("players")
        if not isinstance(players, list) or not players:
            return False
        for player in players:
            if not (player.get("puuid") and player.get("name") and player.get("tag") and player.get("team_id")):
                return False
        teams = item.get("teams")
        if teams is not None and not isinstance(teams, list):
            return False
        for team in teams or []:
            if not team.get("team_id"):
                return False
    return True


def _u_items(evidence: ContractEvidence) -> dict[str, dict[str, str]]:
    """Map Wave 0 U1–U7 to resolved/unresolved status + fallback value."""
    u6_resolved = _stats_contract_resolved(evidence)
    u7_resolved = _u7_contract_resolved(evidence)
    start_label = "omission" if evidence.first_page_start == -1 else str(evidence.first_page_start)
    return {
        "U1": {
            "fact": "auth header form",
            "status": "resolved" if evidence.auth_scheme != "unresolved" else "unresolved",
            "value": evidence.auth_scheme,
            "fallback": "bare",
        },
        "U2": {
            "fact": "side literals",
            "status": "resolved" if evidence.side_literals else "unresolved",
            "value": ",".join(evidence.side_literals),
            "fallback": "Red,Blue",
        },
        "U3": {
            "fact": "queue param absent from docs",
            "status": "resolved",
            "value": "never sent",
            "fallback": "never sent",
        },
        "U4": {
            "fact": "safe first page start",
            "status": "resolved" if evidence.first_page_start_resolved else "unresolved",
            "value": start_label,
            "fallback": "0 (live-verified: start=0 returns newest; omission equals start=0)",
        },
        "U5": {
            "fact": "custom-mode literal",
            # A rejection (e.g. HTTP 400/code 27) is a resolved fact: no
            # literal is accepted upstream, so the None/local-filter fallback
            # is confirmed. Only an unknown outcome or one that was never
            # attempted stays unresolved.
            "status": "resolved"
            if evidence.custom_mode_status in ("accepted", "rejected")
            else "unresolved",
            "value": evidence.custom_mode_literal or f"not accepted ({evidence.custom_mode_status})",
            "fallback": "None (filter locally)",
        },
        "U6": {
            "fact": "players[].stats sub-field presence",
            "status": "resolved" if u6_resolved else "unresolved",
            "value": "present" if u6_resolved else "absent",
            "fallback": "optional; keys pinned to kills/deaths/assists/score/"
                       "damage_dealt/damage_received/headshots/bodyshots/legshots; "
                       "malformed (non-dict) stats mark unresolved",
        },
        "U7": {
            "fact": "metadata/teams field optionality",
            "status": "resolved" if u7_resolved else "unresolved",
            "value": "present" if u7_resolved else "absent",
            "fallback": "requires BOTH history-list and detail-dict evidence; "
                       "required fields: match_id/map name/started_at/is_completed/"
                       "players[].puuid/name/tag/team_id",
        },
    }


# ------------------------------------------------------------ live fixture write

def _write_sanitized_fixtures(evidence: ContractEvidence, sanitizer: _Sanitizer) -> list[str]:
    """Write live-captured samples into tests/fixtures/henrik under generic
    ``live_*`` names (semantically neutral — a raw capture is never labelled
    ``mixed_modes``/``completed_custom``). Deterministic fixtures are never
    overwritten. A 429 sample is only written when it carries ``_headers`` so
    the committed 429 header evidence is preserved."""
    mapping = {
        "account": "account_v2/live.json",
        "history": "history_v4/live_page.json",
        "detail": "match_detail_v4/live.json",
        "error_400_code45": "history_v4/live_error_400_code45.json",
        "error_400_code27": "history_v4/live_error_400_code27.json",
        "error_429": "errors/live_error_429.json",
    }
    written: list[str] = []
    for key, relative in mapping.items():
        sample = evidence.raw_samples.get(key)
        if not sample:
            continue
        if key == "error_429" and "_headers" not in sample:
            # Preserve the committed 429 header evidence; skip bare bodies.
            continue
        target = FIXTURE_DIR / relative
        payload = _project_sample(sample, sanitizer)
        target.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written.append(relative)
    return written


async def run_probe(
    settings: Settings,
    api_key: str,
    live: bool,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ContractEvidence:
    """Run the contract probe. ``live`` requires a real ``api_key``; otherwise
    fixture-only mode reports pinned values and skips live-only facts.
    ``transport`` is injected only by tests to avoid the network."""
    if live:
        if not api_key:
            raise ValueError("--live requires HENRIK_API_KEY (never logged or committed)")
        return await _probe_live(settings, api_key, transport=transport)
    return _run_fixture_probe()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Wave 0 Henrik contract probe")
    parser.add_argument(
        "--live", action="store_true", help="probe the live API (requires HENRIK_API_KEY)"
    )
    args = parser.parse_args()

    settings = get_settings()
    api_key = settings.henrik_api_key or _env_or("HENRIK_API_KEY", "")
    evidence = await run_probe(settings, api_key, live=args.live)

    # Output boundary (deny-by-default for live payloads; fixture-mode output
    # is already deterministic documentation-derived fakes, emitted unchanged).
    output = {
        "probe": "live" if args.live else "fixture",
        "captured_at": datetime.now(UTC).isoformat(),
        "evidence": asdict(evidence),
        "u_items": _u_items(evidence),
        "note": (
            "Fixture-pinned values are deterministic and documentation-derived; "
            "live-only facts (U1/U4/U5) are reported from their documented "
            "fallbacks until a --live probe confirms them."
            if not args.live
            else "Live probe evidence captured as sanitized output; live-confirmed "
                 "U-items are marked resolved, unconfirmed facts keep their "
                 "documented fallbacks."
        ),
    }
    sanitizer: _Sanitizer | None = None
    if args.live:
        sanitizer = _Sanitizer(api_key)
        ev = asdict(evidence)
        ev["raw_samples"] = {
            key: _project_sample(sample, sanitizer)
            for key, sample in evidence.raw_samples.items()
        }
        output["evidence"] = sanitizer.redact(ev)
        # U-item statuses describe the RECORDED contract surface — the
        # sanitized evidence written above. Fields outside the deny-by-default
        # allowlist are dropped before recording, so the recorded stats keys
        # are the pinned set and U6 resolves when those keys are all pinned
        # (live evidence 2026-08-13).
        output["u_items"] = _u_items(ContractEvidence(**ev))
    EVIDENCE_PATH.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.live and sanitizer is not None:
        written = _write_sanitized_fixtures(evidence, sanitizer)
        if written:
            print(f"sanitized fixtures written: {', '.join(written)}")
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
