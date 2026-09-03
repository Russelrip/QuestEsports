# HenrikDev contract — Wave 0 pinned table

Status: **fixture-pinned** unless labeled **live-verified**. A live probe on
2026-08-13 resolved the supplied test account and reached both the history and
detail endpoints, confirming U1's bare authorization form, U4's true zero-based
pagination (`start=0`), U5's rejection of `mode=Custom` (HTTP 400 code 27, so
the local-filter fallback applies), and U7's history/detail field shape. All
deterministic behavior is covered by sanitized fixtures under
`tests/fixtures/henrik/` (see `tests/fixtures/henrik/README.md` for provenance
and sanitization rules). Live opt-in probe: `HENRIK_API_KEY=... python -m
scripts.henrik_contract_probe --live`, evidence written to
`docs/henrik-contract-evidence.json`.

The live probe is hard-bounded to at most **7 requests** (`MAX_LIVE_REQUESTS`):
2 auth-scheme probes + 3 pagination probes (start `0`, `1`, omission) + 1
custom-mode probe + 1 detail probe; the pagination omission page doubles as the
"retry without mode" fallback when `mode=Custom` is rejected, so no extra
request is made. When run with `--live`, it writes sanitized payloads into
`tests/fixtures/henrik/` under **generic `live_*` names**
(`account_v2/live.json`, `history_v4/live_page.json`,
`match_detail_v4/live.json`, `*_live_error_*.json`). Live captures are never
labelled with semantic names (`mixed_modes`, `completed_custom`) because their
content is not validated to match those meanings, and the committed
deterministic fixtures are never overwritten. In fixture-only mode (no `--live`)
the deterministic fixtures are never touched.

**Sanitization is deny-by-default** for live payloads: only documented contract
fields survive the output boundary; `account_level`, `card`, `title`, full
player stats values (scrubbed to `0` placeholders), player `character`,
arbitrary extra fields, and free-form strings are dropped or redacted. Error
`message` values are `[REDACTED]`; `_headers` samples store header **names**
only, never values; the API key is `[REDACTED]` everywhere. Missing/null
required identifiers stay missing/null in projections — never fabricated into
valid-looking fakes.

**Two kinds of artifacts.** The committed fixtures under `tests/fixtures/henrik/`
are **documentation-derived deterministic shape pins**: fake identifiers with
the full documented shape (account_level, card, title, real-looking stats
values) so mapper tests have complete inputs — they are NOT deny-by-default
projections. Live `--live` runs additionally write **generic `live_*.json`
projections** (`account_v2/live.json`, `history_v4/live_page.json`,
`match_detail_v4/live.json`, `*_live_error_*.json`) that do follow the
deny-by-default rules above. See `tests/fixtures/henrik/README.md`.

## Endpoints

| # | Operation | Method + URL | Auth | Params |
|---|---|---|---|---|
| 1 | Resolve account | `GET /valorant/v2/account/{name}/{tag}` | `Authorization: <key>` (U1) | optional `force` (cache-bypass, refresh path only) |
| 2 | Match history | `GET /valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}` | `Authorization: <key>` | `mode`, `map`, `size`, `start`; **never `queue`** (U3) |
| 3 | Match details | `GET /valorant/v4/match/{affinity}/{match_id}` | `Authorization: <key>` | none |

- `affinity` = historically "region"; default `eu`, per-request override.
- `platform` default `pc`; accepted literals `pc` / `console` (else code 42).
- Account resolution means *Henrik resolved this Riot ID to a PUUID* — not ownership verification.

## Auth form (U1)

| Form | Header |
|---|---|
| bare (live-verified) | `Authorization: <HENRIK_API_KEY>` |
| Bearer | `Authorization: Bearer <HENRIK_API_KEY>` |

Status: **live-verified: bare** (2026-08-13 account-resolution probe). The key
is never logged, never committed, never written to fixtures or evidence.

## Match-list pagination (U4)

Pagination is **true zero-based** (live-verified 2026-08-13):

| `start` | Result |
|---|---|
| `0` | newest match (first page) — `FIRST_PAGE_START = 0` |
| `1` | next match (second page) |
| omission | equivalent to `start=0` |

Status: **live-verified**. `FIRST_PAGE_START = 0` is pinned in
`app/integrations/henrik/contract.py`; the discovery service advances `start`
by `size` per page starting from `FIRST_PAGE_START`.

## Side literals (U2)

| Upstream `team_id` literal | Normalized side |
|---|---|
| `Red` | `red` |
| `Blue` | `blue` |

Status: **resolved (fixture-pinned)** from `history_v4/page1_mixed_modes.json`
and `match_detail_v4/completed_custom.json` (distinct values `Blue`, `Red`).
Any literal outside `SIDE_LITERAL_MAP` raises `HenrikProtocolError` (never
guessed); see `match_detail_v4/unknown_side_literal.json` (`Green`).

## Custom-mode literal (U5)

| Literal | Behavior |
|---|---|
| `None` (live-verified) | `mode` filter omitted upstream; filtered locally from returned metadata |

Status: **live-verified: rejected**. The 2026-08-13 live probe sent
`mode=Custom` and received HTTP 400 with error code 27, so no custom-mode
literal is accepted upstream; `CUSTOM_MODE_LITERAL` stays `None` and the `mode`
filter is applied locally to returned metadata (design §7.2 "Important
mode-filter rule").

## Verified field paths

History (`data[]`) and detail (`data`) share the match object shape:

```text
metadata.match_id        -> canonical Henrik Match ID (identity key)
metadata.map.id          -> map UUID
metadata.map.name        -> map display name
metadata.started_at      -> match start timestamp (ISO-8601)
metadata.is_completed    -> completion flag
metadata.mode            -> game mode
metadata.queue           -> may be null; never sent as a query param
players[].puuid          -> required
players[].name           -> required
players[].tag            -> required
players[].team_id        -> required, side literal
players[].character      -> optional (fixture-pinned agent name path, U6/U7)
players[].stats          -> optional object; sub-fields pinned from fixtures:
                            kills, deaths, assists, score, damage_dealt,
                            damage_received, headshots, bodyshots, legshots
teams[].team_id          -> required, side literal
teams[].rounds.won       -> required for score derivation
teams[].rounds.lost      -> required for score derivation
teams[].won              -> boolean winner flag; may be null when incomplete
```

Required vs optional (U6/U7, fixture-pinned): required for import = match
identity, map name, `started_at`, `is_completed`, and per player
`puuid`/`name`/`tag`/`team_id`; everything under `players[].stats` and agent
fields is optional and never fails import. Missing **required** fields fail
loudly (`match_detail_v4/malformed_required.json`).

**U6 — pinned optional stats contract.** `players[].stats` is optional; when
present it must be a dict whose keys all belong to the exact pinned set:
`kills, deaths, assists, score, damage_dealt, damage_received, headshots,
bodyshots, legshots`. U6 is **resolved** only when at least one player across
the captured history items (`data[]`) and detail (`data` dict) has a non-empty
`stats` dict whose keys are ALL within the pinned set, and no unknown stat key
is observed anywhere (no any-one-key shortcut). Complete, partial (subset), and
absent stats are all valid optionality cases. A **present** `stats` that is not
a dict (string/list/etc.) is a contract violation and marks U6 **unresolved** —
it is never silently treated as absent. Absent-everywhere, any unknown key, or
any malformed stats value leaves U6 unresolved.

**U7 — required shape and optionality.** U7 is **resolved** only when **both**
the history-list envelope (`data` is a list) and the detail-dict envelope
(`data` is a dict) are present and shaped correctly, and every captured match
object in both has the required shape: `metadata` dict with `match_id`,
`map.name`, `started_at`, `is_completed`; `players[]` non-empty with per-player
`puuid`/`name`/`tag`/`team_id`; `teams[]` (when present) with `team_id`.
History-only, detail-only, malformed/partial samples, and missing required
identifiers all leave U7 unresolved. Missing/null required identifiers are
preserved as missing/null in projections and are never fabricated into
valid-looking fakes.

Status: **live-verified** (2026-08-13) — the live probe captured both the
history-list envelope (`data[]`) and the detail-dict envelope (`data`), both
shaped correctly.

- Completion/time presence: `metadata.is_completed` and `metadata.started_at`
  are present in history objects (**live-verified: true**) and in the detail
  payload; detail `is_completed` pins `true` for the completed fixture.
- Scores/winners are **derived**, never caller-supplied: `red_score`/`blue_score`
  from `teams[].rounds.won`; `winning_side` from `teams[].won` (tolerant
  `draw`/`unknown`).

## Error envelope

```text
{ "status": <http status>, "errors": [ { "code": <int|null>, "message": "<text>" } ] }
```

| HTTP | Code | Meaning | App error |
|---|---|---|---|
| 401 | — | missing API key | `HENRIK_AUTH_FAILED` |
| 403 | — | invalid API key | `HENRIK_AUTH_FAILED` |
| 429 | — | rate limited | `HENRIK_RATE_LIMITED` |
| 500/501 | — | upstream/internal | `HENRIK_UNAVAILABLE` |
| 404 | 22 | account not found | `PLAYER_NOT_FOUND` |
| 404 | 23 | region/affinity not found | `PLAYER_REGION_UNKNOWN` |
| 404 | 26 | match not found | `MATCH_NOT_FOUND` |
| 400 | 27 | invalid mode/queue | `HENRIK_VALIDATION_ERROR` |
| 400 | 28 | invalid map | `HENRIK_VALIDATION_ERROR` |
| 400 | 42 | invalid platform | `HENRIK_VALIDATION_ERROR` |
| 400 | 43 | invalid UUID/PUUID | `HENRIK_VALIDATION_ERROR` |
| 400 | 45 | invalid `start` value | `HENRIK_VALIDATION_ERROR` |

Error envelopes are fixture-pinned under `errors/` and per-endpoint `error_*`
files. `parse_error_body` returns `(status, message, errors[])` and raises
`HenrikProtocolError` on a malformed envelope.

## Rate-limit headers

Documented/pinned header names (presence varies; log when present, never
require):

```text
RateLimit-Policy, RateLimit, X-RateLimit-Limit, X-RateLimit-Remaining,
X-RateLimit-Reset, X-RateLimit-Bucket, X-Request-ID, X-Cache-Status, X-Cache-TTL
```

On `429`: inspect `Retry-After` / `X-RateLimit-Reset`; no tight-loop retry;
expose normalized `HENRIK_RATE_LIMITED`; log `X-Request-ID`. Bounded retry
(max `HENRIK_MAX_RETRIES`) only for selected 5xx/network and 429-with-headers
when the caller opts in; never for 400/401/403/404. `rate_headers_seen`
(fixture-pinned): `Retry-After`, `X-RateLimit-Reset`, `X-Request-ID` (header
**names** only, from `errors/error_429.json` — the committed fixture stores a
names-only list, never values).

## U1–U7 status summary

| U | Fact | Status |
|---|---|---|
| U1 | auth header form | **live-verified: bare** |
| U2 | side literals | resolved (fixture-pinned): `Red`, `Blue` |
| U3 | `queue` param | resolved — never sent |
| U4 | first page `start` | **live-verified: `0`** — zero-based (0 newest, 1 next, omission = 0) |
| U5 | custom-mode literal | **live-verified: rejected** (`mode=Custom` → HTTP 400 code 27) — fallback `None` (filter locally) |
| U6 | `players[].stats` sub-fields | resolved (fixture-pinned, optional) — exact pinned key set |
| U7 | metadata/teams optionality | **live-verified** — history + detail shape confirmed |

Evidence source: `docs/henrik-contract-evidence.json` (live probe run in this
session). Live verification is opt-in and rate-limited.
