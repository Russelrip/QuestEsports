# Architecture Decision Records — VALORANT Platform Backend

Wave 0 record (Task 2). Each ADR is one decision; all are approved in the
implementation plan and recorded here for the record. Dates: 2026-08-13.

---

## ADR-001 — Direct Postgres, not PostgREST

**Status:** Accepted

**Context:** Phase 2 finalization requires multi-statement atomicity
(team-rating events + current ratings + audit events in one transaction).
Supabase's client/PostgREST model cannot combine arbitrary separate requests
into one caller-controlled transaction.

**Decision:** Connect to the Supabase Postgres with a normal PostgreSQL
connection (SQLAlchemy 2.x async or asyncpg) and run multi-table operations in
direct SQL transactions. A Postgres function/RPC is an acceptable alternative
for a given atomic operation, but a direct transaction is the default.

**Consequences:** Application tables live in the private `valorant` schema with
no anonymous grants; the migration runner enforces this posture on every run
(Task 17 fix round 1): it revokes `PUBLIC` access on the schema, its tables,
and future default privileges, and enables RLS (no policies) on every table.
The application connects as the schema/table owner, so its direct connection is
unaffected; every other role sees nothing. If a table is ever exposed to
untrusted roles, RLS is already on and explicit policies would be required for
any anonymous read. DB credentials live only in environment variables; never
committed.

## ADR-002 — Raw JSONB retention

**Status:** Accepted

**Context:** Henrik's schema can evolve; future stats and debugging need the
verbatim upstream payload.

**Decision:** Retain the upstream v4 match-detail **`data` object** verbatim in
a `jsonb` column on `matches` (the transport envelope's `status`/top-level
fields are not stored); the application normalizes only the fields it needs.

**Consequences:** Storage grows with raw payloads, buying rebuildability and a
compatibility bridge. Raw payloads are excluded from default read responses
(opt-in flag only).

## ADR-003 — Two-player discovery retained

**Status:** Accepted

**Context:** The requested Phase 1 workflow resolves two players and finds their
common matches.

**Decision:** Keep two-player match-history intersection for discovery; do not
assume automatic one-player roster discovery.

**Consequences:** One extra history fetch per search; drops away when future
roster-aware discovery exists. History is discovery-only (see ADR-004).

## ADR-004 — Match-list discovery-only; detail canonical

**Status:** Accepted

**Context:** Match-list responses contain substantial match info, but only the
dedicated match endpoint is stable enough to snapshot as canonical.

**Decision:** Match-list history produces discovery candidates; the dedicated
detail endpoint (`/valorant/v4/match/{affinity}/{match_id}`) is the canonical
snapshot persisted during import. No candidate payload is persisted as a
canonical match.

**Consequences:** One extra detail call per imported match; idempotent by
`henrik_match_id` unique constraint.

## ADR-005 — Wave 0 contract pins (U1–U7)

**Status:** Accepted

**Context:** Several Henrik contract details were unconfirmed (auth header form,
first pagination offset, side literals, custom-mode literal, optional-field
presence). Guessing would break mapper trust.

**Decision:** Pin them from evidence before the mapper is trusted
(`app/integrations/henrik/contract.py`, `docs/henrik-contract.md`): auth scheme
`bare` (fallback), `FIRST_PAGE_START=0` (live-verified 2026-08-13; zero-based,
`start=0` returns the newest match), `SIDE_LITERAL_MAP={"Red":"red",
"Blue":"blue"}`, `CUSTOM_MODE_LITERAL=None` (fallback: local filtering),
`HENRIK_QUEUE_PARAM=None` (never sent). Deterministic behavior comes from
sanitized fixtures; live facts are opt-in and explicitly labeled resolved or
"unresolved — fallback is X".

**Consequences:** Task 5 mapper/client consume only pinned literals; unknown
side literals raise `HenrikProtocolError` rather than silently misassigning.

## ADR-006 — Series statuses limited to draft/finalized

**Status:** Accepted

**Context:** Legacy-adjacent state machines tempted `ready`/`void` states that
duplicate derived state.

**Decision:** Only `draft` and `finalized` are persisted. Readiness is the
derived `preview.valid`; abandonment is `DELETE` on drafts; corrections go
through the rebuild path.

**Consequences:** No redundant state to keep consistent; status transitions are
simple and auditable.

## ADR-007 — Versioned `rating_runs`

**Status:** Accepted

**Context:** Rating rebuilds must not destroy immutable audit history.

**Decision:** Rebuild creates a new `rating_runs` row; `rating_events` are
versioned per run, never deleted or updated. Rankings/history read the active
run.

**Consequences:** Deterministic replay across rebuilds; storage grows one row
per event per rebuild.

## ADR-008 — No provider abstraction

**Status:** Accepted

**Context:** Only Henrik is used; a hypothetical Riot migration has no concrete
requirement.

**Decision:** `HenrikClient` is concrete — no provider interface/abstraction
layer whose only purpose is a future Riot migration.

**Consequences:** Less indirection; a real migration can introduce an adapter
when it becomes a requirement.

## ADR-009 — `player_aliases` deferred

**Status:** Accepted

**Context:** Riot IDs are mutable but the platform's initial workflow re-resolves
names to PUUIDs directly.

**Decision:** Do not create `player_aliases` now; PUUID is canonical identity,
`name#tag` is display-only (indexed, never unique). Defer the alias table until
a real name-resolution need appears.

**Consequences:** No duplicate-identity bookkeeping in Phase 1; re-resolving a
known PUUID updates current display identity only, leaving historical snapshots
intact.

## ADR-010 — Admin token for mutations

**Status:** Accepted

**Context:** Public mutations would expose unauthenticated writes; full end-user
auth is deferred.

**Decision:** `ADMIN_API_KEY` is required (outside `local`/`test` env) for all
mutations and for Henrik-consuming discovery (`POST /api/v1/players/resolve`,
`POST /api/v1/match-search/two-player`, `POST /api/v1/matches/import`, all
team/series mutations). A central admin dependency enforces it.

**Consequences:** Simple, auditable gate now; replaced by real auth later.

## ADR-011 — Official winner determines ELO winner/counters

**Status:** Accepted (policy lock)

**Context:** Forfeits/rulings can differ from the imported match result.

**Decision:** The official winner determines the ELO winner and win/loss
counters.

**Consequences:** Explicit override policy is an input to finalization; never
inferred from scores alone.

## ADR-012 — Imported margin remains the performance input

**Status:** Accepted (policy lock)

**Context:** Scores/rounds are the only trusted performance measure.

**Decision:** Imported score/margin remain the performance inputs even when the
official winner differs from the calculated winner.

**Consequences:** `red_score`/`blue_score` derive from `teams[].rounds.won` only;
callers never re-enter map scores.

## ADR-013 — `calculation_details` records override and mode

**Status:** Accepted (policy lock)

**Context:** Rating events must explain themselves after the fact.

**Decision:** `rating_events.calculation_details` records the override and the
resolved rating policy mode: `normal | forfeit_no_rating | forfeit_result_only |
manual_override`.

**Consequences:** Auditability of every finalization decision.

## ADR-014 — Legacy `round(..., 0)` persistence preserved

**Status:** Accepted (policy lock)

**Context:** Legacy behavior rounds persisted ratings to integers; inputs may be
fractional.

**Decision:** Persist `round(..., 0)` values on `teams.current_elo`/event
columns **plus** unrounded inputs inside `calculation_details`.

**Consequences:** Numerical parity with legacy output while preserving exact
inputs for audit/rebuild.

## ADR-015 — Equal-ratings `+5` upset bonus preserved

**Status:** Accepted (policy lock)

**Context:** Legacy branch `elo_diff < 100` applies a fixed bonus at equal
ratings.

**Decision:** Equal ratings retain the legacy `+5` upset bonus.

**Consequences:** Characterization tests must reproduce it exactly.

## ADR-016 — `played_at` required and chronological

**Status:** Accepted (policy lock)

**Context:** Rebuilds need a deterministic ordering.

**Decision:** `series.played_at` is required for finalization and used for
chronological rebuild ordering.

**Consequences:** Finalization rejects series without a play time.

## ADR-017 — Refresh rejected for finalized-series matches

**Status:** Accepted (policy lock)

**Context:** Re-fetching a match already locked into a rated series would
corrupt results.

**Decision:** `refresh=true` is rejected for a match attached to a finalized
series.

**Consequences:** Import refreshes are safe only for unrated matches.

## ADR-018 — Incomplete imports rejected

**Status:** Accepted (policy lock)

**Context:** `is_completed=false` matches have no stable result.

**Decision:** Incomplete match imports are rejected (`is_completed=false` →
`MATCH_NOT_COMPLETED`).

**Consequences:** Only completed matches enter the library.

## ADR-019 — Idempotent import 201/200

**Status:** Accepted (policy lock)

**Context:** Concurrent/repeated imports must converge on one row.

**Decision:** Import returns `201` with `created=true` or `200` with
`created=false`; uniqueness enforced by the `henrik_match_id` unique constraint.

**Consequences:** Idempotent, concurrency-safe imports.

## ADR-020 — No-overlap search returns 200 empty

**Status:** Accepted (policy lock)

**Context:** Two players with no common matches is a valid search outcome.

**Decision:** No-overlap two-player search returns `200` with an empty
`candidates` array.

**Consequences:** Clients treat empty results as a normal outcome, not an error.

## ADR-021 — Statuses: draft/finalized only (locked)

**Status:** Accepted (policy lock)

**Context:** See ADR-006; enumerated here as a policy lock.

**Decision:** Series statuses are limited to `draft` and `finalized` (no
persisted `ready`/`void`).

**Consequences:** Enforced by schema check constraints and service validation.

## ADR-022 — `queue` never sent to Henrik

**Status:** Accepted (policy lock)

**Context:** `queue` is undocumented upstream and could change behavior.

**Decision:** The adapter never serializes a `queue` query parameter
(`HENRIK_QUEUE_PARAM = None`); if queue filtering is ever needed it is applied
locally to returned metadata.

**Consequences:** Fixture-based adapter tests assert the param is absent.

---

## ADR-023 — Legacy `estimate_elo_changes` is dead code (proof recorded)

**Status:** Accepted (evidence gate)

**Context:** The verbatim copy `app/legacy/elo_calculator.py` includes
`estimate_elo_changes`, which the plan flags as dead code removable only with
proof of non-reference.

**Evidence (2026-08-13, Task 10):**

```
$ rg -n "estimate_elo_changes" ../valorant-lk-elo app tests
app/legacy/elo_calculator.py:220:    def estimate_elo_changes(team1_elo: float, team2_elo: float,
../valorant-lk-elo/elo_calculator.py:220:    def estimate_elo_changes(team1_elo: float, team2_elo: float,
```

The symbol appears only at its two definition sites (the verbatim copy and the
original sibling source). Nothing in `app/` or `tests/` imports, calls, or
references it, and it is not part of any public API surface.

**Decision:** Removal is permitted in a later naming-normalization pass, after
characterization parity is proven. Task 10 does **not** remove it — the copied
module stays byte-for-byte identical to the legacy source.

**Consequences:** Dead code remains temporarily for verbatim-copy fidelity;
a later pass may drop `estimate_elo_changes` and normalize names with parity
tests as the safety net.

---

## ADR-024 — Plain-SQL migration runner with a durable ledger; no Alembic

**Status:** Accepted (ops)

**Context:** Schema evolution must be reviewable, deterministic, and runnable
by the same harness that tests it (design §15, plan App. A), and re-runs must
be safe and truthful.

**Decision:** Migrations are plain SQL files under `supabase/migrations/`,
applied in filename order by `scripts/apply_migrations.py` — one transaction
per file, a small statement splitter for multi-statement files (needed for the
PL/pgSQL trigger bodies). No Alembic, no ORM-generated migrations. The runner
maintains a `_migration_ledger` (name + sha256 + applied_at) in the target
schema: each migration applies exactly once (recorded transactionally in the
same transaction), already-applied migrations are skipped, a changed
already-applied file aborts with a drift error, and a ledger entry with no file
on disk is a visible warning.

**Consequences:** Each migration is a first-class reviewable artifact (0001
…0013); re-running the runner is a no-op; drift is detected; the integration
harness applies the real files into a fresh schema every session; and
`tests/integration/test_migrations.py` proves the 0001–0010 → 0011–0013
upgrade path while `tests/integration/test_migration_runner.py` proves clean
apply, rerun no-op, drift detection, and failure rollback on real Postgres.

## ADR-025 — Secrets: environment-only, redacted, never echoed

**Status:** Accepted (security)

**Context:** The security baseline (design §14.3) requires Henrik key, DB
credentials, and the admin token to never appear in logs, responses, or the
repository.

**Decision:** All secrets live only in environment variables / the git-ignored
`.env` (`.env.example` is committed with empty values). The structured log
formatter recursively redacts values under `REDACT_KEYS`
(`api_key`, `authorization`, `henrik_api_key`, `password`) at any nesting depth
(`app/logging_setup.py`, tested by `tests/unit/test_logging_format.py`). The
Henrik client never logs the key, and the admin dependency compares
`X-Admin-Key` with `secrets.compare_digest` in constant time, tolerating
non-ASCII input without crashing.

**Consequences:** A committed-secret scan is part of Task 17 validation; the
only credentials in the tree are the localhost dev defaults in `.env.example`
(which match `Settings` defaults and are not real secrets).

## ADR-026 — Upstream HTTP timeouts and bounded retry

**Status:** Accepted (security/ops)

**Context:** Design §14.3 requires client timeouts configured and match-search
bounds enforced; §5.5 requires polite, bounded retry behavior against Henrik.

**Decision:** Every Henrik request runs on a shared `httpx.AsyncClient` with
`HENRIK_TIMEOUT_SECONDS` (default 15). Retries are bounded by
`HENRIK_MAX_RETRIES` (default 2) with exponential backoff and apply **only** to
the pinned transient set — 500/501, network errors, and 429-with-`Retry-After`
(whose server-controlled wait is capped at
`HENRIK_RETRY_AFTER_CAP_SECONDS`, default 30). 400/401/403/404 and malformed
envelopes are never retried. `MATCH_SEARCH_MAX_PAGE_SIZE` (50) and
`MATCH_SEARCH_MAX_PAGES` (5) bound discovery fan-out.

**Consequences:** The client cannot hang or spin against the upstream; every
retry decision is deterministic and covered by
`tests/unit/test_henrik_client.py` (MockTransport, no network).

## ADR-027 — Sanitized error responses and per-request correlation IDs

**Status:** Accepted (security/observability)

**Context:** Unhandled exceptions must never leak tracebacks or secret-bearing
messages through the response or the ASGI/test-server channel, and support
needs a way to correlate failures.

**Decision:** Every request receives a UUID `X-Request-ID` echoed on the
response (`RequestIdMiddleware`). A `SanitizeExceptionMiddleware` installed
outside FastAPI's `ServerErrorMiddleware` swallows the post-response re-raise
so unhandled exceptions surface only as the sanitized `INTERNAL_ERROR`
envelope; if the handler itself fails before sending, a minimal sanitized 500
is emitted. Error responses carry `{error: {code, message, request_id?}}`; raw
upstream payloads are excluded from default read responses
(`RAW_PAYLOAD_IN_RESPONSES=false`, ADR-002) so response size/exposure stays
bounded.

**Consequences:** Exactly one structured "request completed" log line per
request, correlation IDs end-to-end, and a deterministic sanitized error
surface (tested by `tests/unit/test_errors.py` and the health/errors suites).

---

*Recorded in the Wave 0 gate. Policy locks (Global Constraints item 11) are
ADR-011…ADR-022 and must be encoded in tests (see plan Appendix E).
Security/ops records ADR-024…ADR-027 were added in Task 17 (final validation).*

---

# ADR-0XX — Private service boundary and health contract

FastAPI is reached only by the Quest backend over a private network. The local
dev server binds to 127.0.0.1; production deployments bind to a private
interface behind an internal load balancer with an IP allowlist (mTLS deferred —
see design §9.1/§10.2). There is no CORS middleware and no browser-facing route.
`GET /api/v1/health` is the only unauthenticated route and returns
`{status, app, env, db}`; every other `/api/v1/*` route requires a valid service
token in non-`local`/`test` environments (delta D1). Quest asserts
`VALORANT_INTERNAL_BASE_URL` is an HTTPS origin in production and never exposes
FastAPI to browsers (enforced by topology, not convention).
