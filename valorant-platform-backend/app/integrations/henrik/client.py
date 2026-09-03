"""Henrik HTTP client (plan Task 5; design §6, §7.2, §16.2).

The only module that speaks HTTP to ``https://api.henrikdev.xyz``. One
``httpx.AsyncClient``; the auth header is injected centrally from the Wave 0
pin ``contract.AUTH_SCHEME_PINNED``; timeouts and the retry budget come from
``Settings``. Bounded exponential retries apply only to the pinned transient
set (``contract.RETRYABLE_STATUS_CODES`` = 500/501, network errors, and
429-with-``Retry-After``); other 5xx and all 4xx are never retried. The
server-controlled ``Retry-After`` wait is capped at
``settings.henrik_retry_after_cap_seconds`` while the original value is still
carried on the final ``HenrikRateLimitError``. Every request emits one
structured log line (endpoint, status, duration, upstream ``X-Request-ID`` and
rate/cache headers, retry count) — the API key is never logged. The ``queue``
param is never serialized (U3); ``mode`` is sent only when the pinned custom-
mode literal matches (U5 fallback: ``None`` -> local filter only).

Envelope validation is strict and precedes every retry decision: both success
and error bodies must be the pinned envelope shape with ``status`` agreeing
with the HTTP status; a malformed or mismatched error envelope raises
``HenrikProtocolError`` immediately (never a generic status exception, never
retried even if a later attempt would succeed). ``get_match_detail`` returns a
``HenrikMatchDetailEnvelope`` that carries the normalized detail plus the
complete raw upstream envelope verbatim for the Task 8 import layer.
"""

import asyncio
import json
import logging
from time import perf_counter

import httpx

from app.config import Settings
from app.integrations.henrik.contract import (
    AUTH_SCHEME_PINNED,
    CUSTOM_MODE_LITERAL,
    RETRYABLE_STATUS_CODES,
)
from app.integrations.henrik.exceptions import (
    HenrikAuthenticationError,
    HenrikNotFoundError,
    HenrikProtocolError,
    HenrikRateLimitError,
    HenrikUnavailableError,
    HenrikValidationError,
)
from app.integrations.henrik.mapper import HenrikMapper
from app.integrations.henrik.models import (
    HenrikAccount,
    HenrikMatchDetailEnvelope,
    HenrikMatchListItem,
)

logger = logging.getLogger("app.integrations.henrik.client")

# Bounded exponential backoff base (seconds) between transient retries.
_RETRY_BACKOFF_BASE = 0.1


class HenrikClient:
    """Concrete, single-http-client Henrik adapter. Not a provider abstraction."""

    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._mapper = HenrikMapper()
        self._http = http or httpx.AsyncClient(
            base_url=settings.henrik_base_url,
            timeout=settings.henrik_timeout_seconds,
        )
        # Centralized auth: applied to whichever client we hold, so an injected
        # test transport also sees the pinned header.
        self._http.headers.update(self._build_auth_headers(settings))
        self._retry_after_cap = max(0.0, settings.henrik_retry_after_cap_seconds)

    # ------------------------------------------------------------ endpoints

    async def get_account(self, name: str, tag: str, *, force: bool = False) -> HenrikAccount:
        params = {"force": "true"} if force else None
        body, http_status = await self._request(
            "account", "GET", f"/valorant/v2/account/{name}/{tag}", params=params
        )
        envelope = self._validate_success_envelope(body, http_status)
        return self._mapper.to_account(envelope["data"])

    async def get_account_by_puuid(self, puuid: str) -> HenrikAccount:
        """Global account-by-puuid (R32; task 8 name-audit).

        ``GET /valorant/v1/by-puuid/account/{puuid}`` — deliberately NO
        affinity/platform in the path: every Riot account has exactly one
        identity, even before ever playing competitive (the name audit must
        reach those players too).
        """
        body, http_status = await self._request(
            "account_by_puuid", "GET", f"/valorant/v1/by-puuid/account/{puuid}"
        )
        envelope = self._validate_success_envelope(body, http_status)
        return self._mapper.to_account(envelope["data"])

    async def get_matches_by_puuid(
        self,
        puuid: str,
        *,
        affinity: str,
        platform: str,
        mode: str | None = None,
        map_name: str | None = None,
        size: int = 10,
        start: int = 0,
    ) -> list[HenrikMatchListItem]:
        # U3: `queue` is undocumented upstream and is NEVER serialized.
        params: dict[str, str] = {"size": str(size), "start": str(start)}
        if map_name is not None:
            params["map"] = map_name
        # U5: `mode` is sent only when the contract pins a matching literal;
        # the fallback (None) means mode is filtered locally from metadata.
        if mode is not None and CUSTOM_MODE_LITERAL is not None and mode == CUSTOM_MODE_LITERAL:
            params["mode"] = mode
        body, http_status = await self._request(
            "matches_by_puuid",
            "GET",
            f"/valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}",
            params=params,
        )
        envelope = self._validate_success_envelope(body, http_status)
        data = envelope["data"]
        if not isinstance(data, list):
            raise HenrikProtocolError("history data must be a list")
        return [self._mapper.to_match_list_item(item) for item in data]

    async def get_player_mmr(
        self, puuid: str, *, affinity: str, platform: str
    ) -> dict:
        """Normalized MMR (rank_details + peak + seasonal + account identity).

        R5: ``affinity``/``platform`` are required keyword args (callers pass
        ``"ap"``/``"pc"``). No query params on the upstream call.
        """
        body, http_status = await self._request(
            "player_mmr",
            "GET",
            f"/valorant/v3/by-puuid/mmr/{affinity}/{platform}/{puuid}",
        )
        envelope = self._validate_success_envelope(body, http_status)
        return self._mapper.to_player_mmr(envelope["data"])

    async def get_last_competitive_match(
        self, puuid: str, *, affinity: str, platform: str
    ) -> str | None:
        """ISO timestamp of the newest competitive match, or ``None``.

        R5: ``affinity``/``platform`` are required keyword args. This dedicated
        endpoint sends ``mode=competitive`` unconditionally (unlike the U5-gated
        ``get_matches_by_puuid``) with ``size=1``.
        """
        body, http_status = await self._request(
            "last_competitive_match",
            "GET",
            f"/valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}",
            params={"mode": "competitive", "size": "1"},
        )
        envelope = self._validate_success_envelope(body, http_status)
        data = envelope["data"]
        if not isinstance(data, list):
            raise HenrikProtocolError("history data must be a list")
        return self._mapper.to_last_competitive_match(data)

    async def get_match_detail(
        self, match_id: str, *, affinity: str
    ) -> HenrikMatchDetailEnvelope:
        body, http_status = await self._request(
            "match_detail", "GET", f"/valorant/v4/match/{affinity}/{match_id}"
        )
        envelope = self._validate_success_envelope(body, http_status)
        return HenrikMatchDetailEnvelope(
            status=envelope["status"],
            data=self._mapper.to_match_detail(envelope["data"]),
            raw=envelope,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------ internals

    @staticmethod
    def _build_auth_headers(settings: Settings) -> dict[str, str]:
        key = settings.henrik_api_key
        if not key:
            return {}
        if AUTH_SCHEME_PINNED == "Bearer":
            return {"Authorization": f"Bearer {key}"}
        return {"Authorization": key}

    async def _request(
        self,
        category: str,
        method: str,
        url: str,
        *,
        params: dict[str, str] | None = None,
    ) -> tuple[dict, int]:
        retries = 0
        max_retries = max(0, self._settings.henrik_max_retries)
        while True:
            start = perf_counter()
            try:
                response = await self._http.request(method, url, params=params)
            except httpx.HTTPError as exc:
                self._log(category, status=None, retries=retries, elapsed=perf_counter() - start,
                          note=f"network_error={type(exc).__name__}")
                if retries < max_retries:
                    retries += 1
                    await asyncio.sleep(_retry_backoff(retries))
                    continue
                raise HenrikUnavailableError(
                    f"henrik network error: {type(exc).__name__}", request_id=None
                ) from exc

            status = response.status_code
            self._log(
                category,
                status=status,
                retries=retries,
                elapsed=perf_counter() - start,
                headers=response.headers,
            )

            if 200 <= status < 300:
                return self._parse_json_body(response), status

            # Fix round 2: the pinned error envelope must parse and its status
            # must agree with the HTTP status BEFORE any retry decision. A
            # malformed or status-mismatched first response raises
            # HenrikProtocolError immediately — it is never retried, even if a
            # later attempt would have succeeded.
            self._parse_error_response(response)

            # 429 is retried only when the upstream provided a Retry-After
            # header (never blindly); the server-controlled wait is capped at
            # the configured safe bound (the original value is preserved on the
            # final HenrikRateLimitError).
            retry_after = _parse_retry_after(response.headers.get("Retry-After"))
            if status == 429 and retry_after is not None and retries < max_retries:
                retries += 1
                await asyncio.sleep(min(retry_after, self._retry_after_cap))
                continue
            if status in RETRYABLE_STATUS_CODES and retries < max_retries:
                retries += 1
                await asyncio.sleep(_retry_backoff(retries))
                continue
            self._raise_for_status(response)

    @staticmethod
    def _validate_success_envelope(body: dict, http_status: int) -> dict:
        """Validate the pinned success envelope: ``{"status": <int==http>,
        "data": ...}``. Any deviation raises ``HenrikProtocolError``."""
        if not isinstance(body, dict):
            raise HenrikProtocolError("success response body must be a JSON object")
        status = body.get("status")
        if not isinstance(status, int) or isinstance(status, bool):
            raise HenrikProtocolError("success envelope requires an integer status")
        if status != http_status:
            raise HenrikProtocolError(
                f"envelope status {status} disagrees with http status {http_status}"
            )
        if "data" not in body:
            raise HenrikProtocolError("success envelope missing data")
        return body

    def _parse_error_response(self, response: httpx.Response) -> tuple[int, str, list[dict]]:
        """Parse and validate the pinned error envelope.

        Returns ``(envelope_status, message, errors[])``. A non-JSON or
        non-object body, a malformed envelope, or an envelope whose ``status``
        disagrees with the HTTP status raises ``HenrikProtocolError`` — never a
        generic status exception, and never retried (fix round 2).
        """
        status = response.status_code
        body = self._try_json(response)
        if body is None:
            raise HenrikProtocolError(f"henrik http {status}: response body is not JSON")
        if not isinstance(body, dict):
            raise HenrikProtocolError(f"henrik http {status}: response body must be a JSON object")
        envelope_status, message, errors = self._mapper.parse_error_body(body)
        if envelope_status != status:
            raise HenrikProtocolError(
                f"envelope status {envelope_status} disagrees with http status {status}"
            )
        return envelope_status, message, errors

    def _raise_for_status(self, response: httpx.Response) -> None:
        status = response.status_code
        request_id = response.headers.get("X-Request-ID")
        _, message, errors = self._parse_error_response(response)
        sub_code = _first_error_code(errors)

        if status in (401, 403):
            raise HenrikAuthenticationError(message, request_id=request_id)
        if status == 429:
            raise HenrikRateLimitError(
                message,
                retry_after=_parse_retry_after(response.headers.get("Retry-After")),
                rate_limit_reset=_parse_int(response.headers.get("X-RateLimit-Reset")),
                request_id=request_id,
            )
        if status == 404:
            raise HenrikNotFoundError(message, sub_code=sub_code, request_id=request_id)
        if status == 400:
            raise HenrikValidationError(message, sub_code=sub_code, request_id=request_id)
        if status >= 500:
            raise HenrikUnavailableError(message, request_id=request_id)
        raise HenrikProtocolError(f"unexpected henrik http status {status}")

    def _log(
        self,
        category: str,
        *,
        status: int | None,
        retries: int,
        elapsed: float,
        headers: httpx.Headers | None = None,
        note: str | None = None,
    ) -> None:
        extra: dict = {
            "endpoint": category,
            "status": status,
            "duration_ms": round(elapsed * 1000.0, 1),
            "retries": retries,
        }
        if note is not None:
            extra["note"] = note
        # Upstream observability headers: log when present, never require.
        if headers is not None:
            for key in (
                "X-Request-ID",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset",
                "X-Cache-Status",
            ):
                value = headers.get(key)
                if value is not None:
                    extra[key.lower().replace("-", "_")] = value
        logger.info("henrik request completed", extra=extra)

    @staticmethod
    def _parse_json_body(response: httpx.Response) -> dict:
        try:
            parsed = response.json()
        except json.JSONDecodeError:
            raise HenrikProtocolError("henrik response body is not valid JSON") from None
        if not isinstance(parsed, dict):
            raise HenrikProtocolError("henrik response body must be a JSON object")
        return parsed

    @staticmethod
    def _try_json(response: httpx.Response):
        try:
            return response.json()
        except json.JSONDecodeError:
            return None


def _parse_retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _first_error_code(errors: list[dict]) -> int | None:
    for item in errors:
        code = item.get("code")
        if code is not None:
            return code
    return None


def _retry_backoff(retry_number: int) -> float:
    """Exponential backoff for the nth retry: 0.1s, 0.2s, 0.4s, ..."""
    return _RETRY_BACKOFF_BASE * (2 ** (retry_number - 1))
