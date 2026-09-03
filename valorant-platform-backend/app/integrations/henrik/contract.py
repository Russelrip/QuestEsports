"""Wave 0 contract pins for the HenrikDev API.

Created by Task 2 (Wave 0 contract gate) and owned/extended by Task 5 with the
HTTP client and mapper implementation. Values are pinned from the Wave 0
evidence (``docs/henrik-contract.md``, ``docs/henrik-contract-evidence.json``).
Live-only facts that could not be verified without a ``HENRIK_API_KEY`` are
represented by their documented fallbacks and marked in the contract doc.
"""

# U1 — auth header form: "bare" (``Authorization: <key>``) vs "Bearer"
# (``Authorization: Bearer <key>``). Live-verified by account resolution on
# 2026-08-13; retain the same safe fallback if live evidence is unavailable.
AUTH_SCHEME_PINNED: str = "bare"

# U4 — verified safe first pagination offset (live-verified 2026-08-13, design
# D12 default: 0). Pagination is true zero-based: ``start=0`` returns the newest
# match, ``start=1`` returns the next, and omitting ``start`` is equivalent to
# ``start=0``.
FIRST_PAGE_START: int = 0

# U2 — side literal table: upstream ``team_id`` literal -> normalized side.
# Fallback per design §5.7; unknown literals raise HenrikProtocolError.
SIDE_LITERAL_MAP: dict[str, str] = {
    "Red": "red",
    "Blue": "blue",
}

# U5 — accepted upstream ``mode`` literal for custom games. Fallback: None,
# meaning the ``mode`` filter is omitted upstream and applied locally to
# returned metadata (design §7.2 "Important mode-filter rule").
CUSTOM_MODE_LITERAL: str | None = None

# U3 — ``queue`` is undocumented upstream; never send it.
HENRIK_QUEUE_PARAM: None = None

# §5.6 / henrik-contract.md — retryable transient upstream statuses. Only these
# selected 5xx statuses (plus network errors and 429-with-``Retry-After``) are
# retried, and always bounded/exponential; other 5xx are never blindly retried.
RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({500, 501})
