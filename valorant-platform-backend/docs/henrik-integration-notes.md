# HenrikDev integration notes — runbook for operators and future maintainers

Practical companion to [`henrik-contract.md`](henrik-contract.md) (the pinned
contract table) and `app/integrations/henrik/` (the only module that speaks
HTTP to `https://api.henrikdev.xyz`). This file covers how the backend uses the
upstream API, the rate-limit etiquette the code already follows, the error
mapping, and how to run the opt-in live verification.

## What the backend calls

Three upstream operations, all pinned in `app/integrations/henrik/contract.py`
and `docs/henrik-contract.md`:

| Operation | Endpoint | Used by |
|---|---|---|
| Resolve account | `GET /valorant/v2/account/{name}/{tag}` (optional `force`) | `POST /api/v1/players/resolve` |
| Match history | `GET /valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}` (`mode`, `map`, `size`, `start`; **never `queue`**) | `POST /api/v1/match-search/two-player` |
| Match details | `GET /valorant/v4/match/{affinity}/{match_id}` | `POST /api/v1/matches/import` |

All three are GETs; the backend only ever **reads** from Henrik. Writes go to
our own Postgres.

### Pinned contract summary (Wave 0)

- **Auth form (U1):** `Authorization: <key>` ("bare") is live-verified by the
  2026-08-13 account-resolution probe. The key is injected centrally by
  `HenrikClient._build_auth_headers` from
  `AUTH_SCHEME_PINNED` and is **never logged, never echoed, never committed**.
- **Side literals (U2):** `Red` → `red`, `Blue` → `blue`
  (`SIDE_LITERAL_MAP`); any other literal raises `HenrikProtocolError` — the
  mapper never guesses.
- **`queue` (U3):** never sent upstream; the adapter has no queue parameter.
- **First page `start` (U4):** pagination is true zero-based (live-verified
  2026-08-13): `start=0` returns the newest match, `start=1` the next, and
  omitting `start` is equivalent to `start=0`. `FIRST_PAGE_START = 0` is pinned
  in `contract.py`; page advancement is `start += size`.
- **Custom-mode literal (U5):** live-verified as **rejected** — the probe sent
  `mode=Custom` and received HTTP 400 code 27, so `CUSTOM_MODE_LITERAL` stays
  `None` and the `mode` filter is applied **locally** to returned metadata,
  never sent upstream.
- **Required vs optional (U6/U7):** required for import = match identity,
  map name, `started_at`, `is_completed`, per-player `puuid`/`name`/`tag`/
  `team_id`. Everything under `players[].stats` and agent fields is optional;
  a missing required field fails import loudly.

`docs/henrik-contract.md` keeps the authoritative status table (U1–U7) and the
evidence trail.

## Rate-limit etiquette (design §5.5)

The code was written to be polite to the upstream API:

1. **Cache identities, don't re-resolve.** Player resolution upserts the PUUID
   and display identity into `players` and is idempotent; a second resolve for
   the same Riot ID does not re-fetch upstream (the cache lives in our DB).
2. **History fetches are small by default.** The client defaults to
   `size=10` (`get_matches_by_puuid(..., size=10)`); discovery tests and the
   documented workflow keep pages small. The two-player search bounds
   `page_size` (≤ `MATCH_SEARCH_MAX_PAGE_SIZE` = 50) and `max_pages` (≤
   `MATCH_SEARCH_MAX_PAGES` = 5) in `Settings` and in the schema.
3. **Two-player workflow = one extra history call per examined page.**
   Search resolves both players (cached), then fetches up to `max_pages`
   pages per player (default 1) and intersects `metadata.match_id`
   **in the application** (no-overlap → `200` with an empty `candidates`
   array). Each examined page costs **two** upstream history calls (one per
   player) — exactly one extra call per page vs. one-player discovery.
   Pagination stops as soon as the raw intersection is non-empty, and
   candidate pages are never persisted.
4. **Post-import reads come from Supabase, not Henrik.** Once a match is
   imported, every read (`GET /api/v1/matches`, `/{id}`,
   `/by-henrik-id/{match_id}`) is a pure database read. The Match Library
   service deliberately takes no `HenrikClient` — library reads can never
   trigger an upstream call.
5. **`refresh=true` only on explicit request** (`POST /api/v1/matches/import`
   with `refresh: true`), and it is **rejected** (409 `MATCH_REFRESH_REJECTED`)
   for a match attached to a finalized series — a re-fetch could corrupt a
   rated series.
6. **Bounded retries only for the transient set.** `RETRYABLE_STATUS_CODES` =
   {500, 501}, plus network errors and 429-with-`Retry-After`; exponential
   backoff (0.1s, 0.2s, …) capped at `HENRIK_MAX_RETRIES` (default 2). The
   server-controlled `Retry-After` wait is capped at
   `HENRIK_RETRY_AFTER_CAP_SECONDS` (default 30). **Never** retried:
   400/401/403/404, malformed envelopes.
7. **Timeouts set.** Every request uses `HENRIK_TIMEOUT_SECONDS` (default 15)
   on the shared `httpx.AsyncClient`.

### Live opt-in verification

Deterministic behavior is fully covered by sanitized fixtures
(`tests/fixtures/henrik/`), so the suite never needs the network. The 2026-08-13
live probe already verified U1 (bare auth), U4 (zero-based `start=0`), and U5
(`mode=Custom` rejected, code 27); a re-run can be used to re-confirm those
facts against the real API:

```bash
# Wave-0 contract probe (hard-bounded to at most 7 requests)
HENRIK_API_KEY=... HENRIK_TEST_ACCOUNT="YourName:YourTag" \
  uv run python -m scripts.henrik_contract_probe --live

# Opt-in live pytest suite (marker `live`; skipped unless BOTH are set)
HENRIK_API_KEY=... RUN_LIVE_HENRIK=1 uv run pytest -m live tests/integration/live -q
```

The probe writes sanitized evidence to `docs/henrik-contract-evidence.json` and
generic `live_*` fixtures under `tests/fixtures/henrik/`; it never writes the
key and never overwrites the committed deterministic fixtures. Live facts are
recorded (not asserted as stable truth) in `docs/henrik-contract.md`.

> **Live opt-in is double-protected.** Every test in
> `tests/integration/live/` carries the `live` marker (so every documented
> `-m "not live"` command deselects the package and never collects it), and the
> package's `conftest.py` installs an autouse guard that skips each module
> unless **both** `RUN_LIVE_HENRIK=1` **and** `HENRIK_API_KEY` are set. A
> stale `HENRIK_API_KEY` alone can never enable live tests. The package's
> `test_opt_in_guard.py` proves the guard works without touching the network;
> real live tests can be added there following `tests/integration/live/README.md`.

## Error mapping (upstream → application, per endpoint)

`HenrikClient._raise_for_status` normalizes every upstream failure into the
`HenrikError` hierarchy (`app/integrations/henrik/exceptions.py`); each service
translates that into stable application codes — and the translation is
**endpoint-specific** (the three service modules each own their mapping):

- `player_service._translate_henrik_error` (account endpoint),
- `match_discovery_service._translate_henrik_error` (history endpoint),
- `match_import_service._translate_henrik_error` (match-detail endpoint).

The upstream `X-Request-ID` is surfaced only inside the error detail for
support — the API key is never echoed.

### Account — `POST /api/v1/players/resolve`

| Upstream | Sub-code | Application error | HTTP |
|---|---|---|---|
| 404 | 22 account not found | `PLAYER_NOT_FOUND` | 404 |
| 404 | 23 region/affinity not found | `PLAYER_REGION_UNKNOWN` | 404 |
| 400 | 27/28/42/43/45 | `INVALID_RIOT_ID` | 422 |
| 401 / 403 | — | `HENRIK_AUTH_FAILED` | 502 |
| 429 | — (retry honored if `Retry-After`) | `HENRIK_RATE_LIMITED` | 429 |
| 500/501/network | — (retried, bounded) | `HENRIK_UNAVAILABLE` | 503 |
| malformed envelope / account without PUUID | — | `HENRIK_UNAVAILABLE` | 503 |

### History — `POST /api/v1/match-search/two-player`

| Upstream | Sub-code | Application error | HTTP |
|---|---|---|---|
| 404 | 23 region/affinity not found | `PLAYER_REGION_UNKNOWN` | 404 |
| 404 | other | `PLAYER_NOT_FOUND` | 404 |
| 400 | 27/28/42/43/45 | `HENRIK_VALIDATION_ERROR` | 422 |
| 401 / 403 | — | `HENRIK_AUTH_FAILED` | 502 |
| 429 | — (retry honored if `Retry-After`) | `HENRIK_RATE_LIMITED` | 429 |
| 500/501/network | — (retried, bounded) | `HENRIK_UNAVAILABLE` | 503 |
| malformed envelope | — | `HENRIK_UNAVAILABLE` | 503 |

### Match detail — `POST /api/v1/matches/import`

| Upstream | Sub-code | Application error | HTTP |
|---|---|---|---|
| 404 | any (incl. 26 match not found) | `MATCH_NOT_FOUND` | 404 |
| 400 | 27/28/42/43/45 | `HENRIK_VALIDATION_ERROR` | 422 |
| 401 / 403 | — | `HENRIK_AUTH_FAILED` | 502 |
| 429 | — (retry honored if `Retry-After`) | `HENRIK_RATE_LIMITED` | 429 |
| 500/501/network | — (retried, bounded) | `HENRIK_UNAVAILABLE` | 503 |
| malformed envelope / missing required fields / identity mismatch | — | `HENRIK_UNAVAILABLE` | 503 |

> **Protocol errors are 503 `HENRIK_UNAVAILABLE`, never 500.** Every service
> maps `HenrikProtocolError` (and any other unexpected `HenrikError`) to the
> stable `HENRIK_UNAVAILABLE` (503) with a fixed message — no upstream text is
> ever echoed. The `INTERNAL_ERROR`/500 path is reserved for genuinely
> unhandled exceptions (sanitized by `SanitizeExceptionMiddleware`, ADR-027).

Malformed envelopes and status/body mismatches raise `HenrikProtocolError` in
the client **before** any retry decision (never blindly retried). The 429
handling inspects `Retry-After`/`X-RateLimit-Reset` and carries them on the
raised error; the client logs the upstream rate/cache headers
(`X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Cache-Status`, `X-Request-ID`)
when present but never requires them.

## Operational notes / unresolved live contract caveats

- **U1 (auth form) and U4 (first `start`) are live-verified** (bare
  authorization; zero-based `start=0`) and **U5 is live-verified as rejected**
  (`mode=Custom` → HTTP 400 code 27, so the `None`/local-filter fallback is what
  production uses). If a later probe contradicts a pin, update `contract.py`
  **and** the tests that pin it (`tests/unit/test_contract_pins.py`) together.
- `HENRIK_AUTH_SCHEME` still exists in `Settings`/`.env.example` for operational
  visibility, but the **runtime** pin is `AUTH_SCHEME_PINNED` in `contract.py`;
  do not change one without the other.
- Real production requests must set `HENRIK_API_KEY`; without it the client
  sends no `Authorization` header and every upstream call would 401 (surfacing
  as `HENRIK_AUTH_FAILED`).
- The `force=true` account parameter exists for the refresh path only; the
  default cache-fresh resolve never sends it.
- Playful-but-important: never add `queue` to the client params (U3), and
  remember that history pagination starts at `start=0` (U4, live-verified) —
  `start=1` is the second page, not the first.
