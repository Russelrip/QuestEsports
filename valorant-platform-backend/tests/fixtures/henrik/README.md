# Henrik fixtures — provenance and sanitization

## Provenance

The committed `live_*.json` captures were written by the 2026-08-13 live probe
(`HENRIK_API_KEY=... python -m scripts.henrik_contract_probe --live`). All
other payloads in this directory are **documentation-derived deterministic
fakes**, synthesized from the pinned contract in `docs/henrik-contract.md`
(design §5.4 field paths, §5.6 error codes, impl spec §6–9) and from the plan's
fixture inventory (Appendix C).

Implications:

- The deterministic fixtures pin the **shape** of the HenrikDev API contract
  (envelope, field paths, error envelope `{status, errors:[{code, message}]}`).
  They use fake identifiers (`puuid_p_a`, `PlayerA`, `A`,
  `00000000-…-000000000001`) so they contain no real personal data, but they
  are **NOT** deny-by-default projections: they intentionally carry the full
  documented shape (account_level, card, title, full stats values) so the
  mapper tests have complete inputs.
- The 2026-08-13 live probe resolved the live-only U-items: U1 auth scheme =
  `bare`; U4 first page offset = `0` (zero-based pagination — `start=0` returns
  the newest match, `start=1` the next, omission equals `start=0`);
  U5 custom-mode literal = `mode=Custom` rejected (HTTP 400 code 27), so
  `CUSTOM_MODE_LITERAL` stays `None` and the `mode` filter is applied locally.
- Live probe output is written automatically under **generic `live_*` names**
  (`account_v2/live.json`, `history_v4/live_page.json`,
  `match_detail_v4/live.json`, `history_v4/live_error_400_code45.json`,
  `history_v4/live_error_400_code27.json`, `errors/live_error_429.json`). Live
  captures are never labelled with semantic names such as `mixed_modes` or
  `completed_custom` because their content is not validated to match those
  meanings. The committed deterministic fixtures below are never overwritten by
  live runs.
- Fixture-only mode (no `--live`) never touches these files.

## Two kinds of artifacts

| Artifact | Contents |
|---|---|
| **Deterministic fixtures** (`valid.json`, `page1_mixed_modes.json`, `completed_custom.json`, …) | Documentation-derived **shape pins** with fake identifiers, full documented fields, real-looking stats values, `account_level`, `card`, `title`. Used by mapper tests as complete inputs. |
| **Live captures** (`live_*.json`) | Deny-by-default **projections** written only by a `--live` run. Only documented contract fields survive; private/free-form data is dropped or redacted. |

## Sanitization rules (deny-by-default — live captures only)

Live payloads are projected at the output boundary to documented contract
fields only. Everything else is dropped or redacted:

| Field / value | Handling |
|---|---|
| Player `puuid` | Deterministic fakes: `puuid_p_a`, `puuid_p_b`, ... (missing/null stays missing) |
| Player `name` | Deterministic fakes: `PlayerA`, `PlayerB`, ... (missing/null stays missing) |
| Player `tag` | Deterministic fakes: `A`, `B`, ... (missing/null stays missing) |
| `metadata.match_id`, `map.id` | Deterministic fakes: `00000000-0000-0000-0000-000000000001`, ... (missing/null stays missing) |
| `account_level`, `card`, `title` | Dropped (never persisted) |
| `players[].stats` values | Scrub to `0` placeholders (key presence preserved) |
| `players[].character` and arbitrary extra fields | Dropped |
| Free-form error `message` | `[REDACTED]` |
| `_headers` samples (429) | Header **names only** (a list), never values |
| `_probe` trace keys | `{"force": true}` booleans only |
| API key | `[REDACTED]` anywhere it appears |

Missing/null required identifiers are preserved as missing/null — never
fabricated into valid-looking fakes. Live captures with missing required
identifiers are reported as invalid/unresolved by the U-item statuses.

## Layout

```text
account_v2/       v2 account responses (valid/force/missing-platform/404-22/404-23)
history_v4/       v4 by-puuid match-list responses (pages/empty/error codes 27/28/42/43/45)
match_detail_v4/  v4 match detail responses (completed/incomplete/optional-stats/malformed/unknown-side/404-26)
errors/           HTTP-level error envelopes (401/403/429) — `_headers` is names-only
```
