# Quest ←→ VALORANT Integration (as-built)

> **Status:** shipped. QuestEsports branch `chore/local-development-environment` head `3d9e08d`; sibling repo `valorant-platform-backend` `main` head `6a1e0f3`. This document describes the **as-built** state across all four phases — FastAPI contract deltas, Quest backend integration, Quest admin UI, and deployment/verification — plus the post-ship fixes and local-testing state (§9). Design intent and the rev-2 deltas are recorded in `docs/superpowers/specs/2026-08-13-standalone-valorant-integration-design.md` (appended Revision 3); this doc is the self-contained reference. No secrets appear here — where a value is sensitive you get a placeholder.

---

## 1. Overview

The VALORANT integration lets Quest admins run standalone competitive VALORANT series (BO1/BO3/BO5) with Riot-sourced results and ELO ratings. Quest Esports is the authenticated admin/BFF layer: the browser talks **only** to Quest Express, which proxies to a sibling FastAPI service (`valorant-platform-backend`) over a private internal API using a signed HMAC service token. FastAPI owns the canonical match data, series correctness/finalization, rating events, and rankings (it is the only component that talks to HenrikDev); Quest owns admin identity, permissions, UX, durable `SavedTeam`→VAL team bindings, and read projections. Both services connect to the **same** Supabase PostgreSQL project but in **two owned schemas** (`public` for Quest Prisma, `valorant` for FastAPI) with separate runtime roles.

---

## 2. Architecture

### 2.1 Topology

```text
Browser (Next.js admin UI, localhost:3000)
        |  HttpOnly session cookie
        v
Quest Express backend (localhost:5001)  ---- public schema (Quest Prisma owns `public`)
        |  requireAdmin; server-side operation_id; signed HMAC bearer (actor + operation claims)
        |  private network only; never exposed to the browser
        v
valorant-platform-backend (FastAPI, localhost:8000)  ---- `valorant` schema
        |     (plain-SQL ledger, scripts/apply_migrations.py)
        v
HenrikDev API   (only FastAPI speaks Henrik)
```

- Quest Express is the **only** caller of FastAPI; FastAPI binds to a private interface / internal ingress, has no browser-facing CORS surface, and `GET /api/v1/health` is its only unauthenticated route (asserted by the route-inventory test, `2389a69`).
- Production topology: browser → CDN/Next.js (Vercel) → Quest Express (private VPC / internal LB) → FastAPI (private network, IP allowlist, mTLS deferred) → Supabase project (`0dc556a` Quest docs, `2389a69` FastAPI ADR).

### 2.2 Two schemas, four roles

| Role | Schema | Responsibility | DDL or DML |
|---|---|---|---|
| Quest migrator | `public` | Prisma migrations (`backend/prisma/migrations/`, `npm run prisma:migrate:deploy`) | DDL |
| Quest runtime | `public` | Quest app queries (Prisma client) | DML only |
| VAL migrator | `valorant` | `scripts/apply_migrations.py` (creates schema + `_migration_ledger`, applies `supabase/migrations/*.sql`) | DDL |
| VAL runtime | `valorant` | FastAPI app queries (SQLAlchemy async), e.g. `val_runtime` | DML only |

- Quest Prisma owns `public`; FastAPI owns `valorant` (`APP_DB_SCHEMA = "valorant"`). No Prisma models or migrations for `valorant` tables; no cross-schema foreign keys; Quest stores every VALORANT UUID (`valorant_team_uuid`, `valorant_series_uuid`, `match_id`) as opaque `text`.
- Schema scope is CI-enforced in both directions: `backend/scripts/verify-prisma-schema-scope.js` in Quest CI (`78b30ae`, matched on `valorant\.|"valorant"` to skip the `valorant` game/slug seed data) and a migration grep guard in FastAPI CI (`705bae3`) that forbids `public.` references and cross-schema FKs in `supabase/migrations/`.

### 2.3 Settled decisions (do not reopen)

| # | Decision |
|---|---|
| A1 | QuestEsports is the authenticated product/admin/BFF layer; the browser talks only to Quest. |
| A2 | `valorant-platform-backend` is a separate FastAPI repository/service, called only by the Quest backend. |
| A3 | One Supabase project, two schema owners (`public` Quest, `valorant` FastAPI); no cross-schema FKs. |
| A4 | Quest `SavedTeam` is the team-selection source; the binding is durable and one-way (deleting a Quest team never deletes VALORANT history). |
| A5 | Standalone admin series is the MVP (no tournament fixtures, Challonge, public stats, seasons, roster automation, mobile). |
| A6 | FastAPI is authoritative for matches, series correctness/finalization, rating events, and rankings. |
| A7 | RLS decision (§7.4 of the design): option (a) — explicit per-table `FOR ALL … USING (true) WITH CHECK (true)` policies for the VAL runtime role only, applied idempotently by the migration runner. |

---

## 3. What shipped, by phase

### Phase 1 — FastAPI contract deltas (D1–D10), `valorant-platform-backend` `882e30a`

One migration wave `supabase/migrations/0014_quest_integration.sql` plus app-code/test changes (49 files, ~2746 insertions). All owned and tested in the FastAPI repo:

| Delta | What shipped |
|---|---|
| D1 | Service auth: `app/api/service_token.py` (HMAC-SHA256 sign/verify, `kid`-selected secrets, `ServicePrincipal`), `require_service_token` dependency replacing `require_admin` on all domain routes (reads **and** mutations) in production; `local`/`test` bypass retained; `GET /api/v1/health` stays unauthenticated; `POST /api/v1/rankings/rebuild` keeps the `X-Admin-Key` gate for ops tooling. `tests/unit/test_service_token.py`, `tests/token_helpers.py`. |
| D2 | `teams.quest_saved_team_id` (partial-unique) + `POST /teams` create-or-get by that key (200 existing / 201 created). |
| D3 | `series.external_quest_series_id` (nullable unique) + `POST /series` create-or-get on retry with the same key. |
| D4 | `unrated` rating mode added to `RATING_MODES`, DB CHECK, and schema literal — no ELO **and** no counters. |
| D5 | Non-empty `override_reason` required for `manual_override`/`forfeit_no_rating`/`forfeit_result_only` even when official winner equals calculated; else 409 `RATING_POLICY_REQUIRED`. |
| D6 | `series.anchor_a_puuid`/`anchor_b_puuid`; `POST /series` accepts `anchor_player_a/b` (`name`,`tag`) and resolves+persists PUUIDs; rated finalize verifies both anchors on opposing sides of every map, else 409 `ANCHOR_MISMATCH` unless explicit override (audited). |
| D7 | `series.finalized_by_actor_id`/`finalized_by_operation_id` persisted in the finalize transaction from the validated token claims. |
| D8 | Chronological guard: rated finalize rejects 409 `BACKDATED_SERIES_REJECTED` when `played_at < MAX(played_at)` over already-finalized rated series. |
| D9 | Absolute desired-order endpoint `PUT /api/v1/series/{series_id}/games/order` (atomic, draft-only, idempotent by absolute values). |
| D10 | ID-naming contract pinned in schemas/docs/tests (`henrik_match_id` text for import/display; VAL `match_id` UUID for attach). |

Test surface includes `tests/integration/test_anchor_verification.py`, `test_backdated_finalization.py`, `test_migration_0014.py`, `test_quest_contract.py`, `test_quest_contract_shapes.py` (the last added in Phase 4, `0abbe05`).

### Phase 2 — Quest backend integration layer, `QuestEsports` `66c426a`

- **Prisma models in `public`:** `ValorantTeamBinding`, `QuestValorantSeries`, `QuestValorantSeriesGame`, `QuestValorantMatch`, `QuestValorantOperation` (+ enums) in `backend/prisma/schema.prisma`, with migrations `20260813202126_add_valorant_bindings_series_operations`, `20260813210411_add_valorant_game_uuid`, `20260813220931_add_valorant_detach_trigger_security_definer`. The migration appends the partial unique index (one **active** binding per SavedTeam), a `BEFORE DELETE ON saved_teams` trigger that detaches active bindings (decision D2 — DB-level guarantee, not app code), RLS enablement, and `REVOKE` from `PUBLIC`/`anon`/`authenticated`/`service_role` (the `prisma:security:verify` pattern).
- **Module `backend/src/modules/valorant/`:** `valorant.auth.js` (HMAC signing + header assembly), `valorant.client.js` (timeouts, bounded read-only retries, `FastApiError`/`InternalServiceError`, §6.5 error mapping), `valorant.mapper.js` (snake_case→camelCase), `valorant.validation.js` (Riot-ID parsing, externalKey, normalize), `valorant.service.js` (orchestration + operation-ledger state machine + reconciliation), `valorant.controller.js` (thin handlers + `AuditLog` wiring).
- **Routes** are declared inline in `backend/src/routes/v1.js` under `/api/v1/admin/valorant/*` behind `requireAdmin` (decision D1 — the `openapi.test.js` scanner would mis-normalize a module `*.routes.js` file), documented in `backend/src/lib/openapi.js`.
- **Guarded deletion:** `deleteSavedTeam` (`backend/src/modules/teams/team.service.js`) and `deleteAdminSavedTeam` (`admin.service.js`) reject 409 while an active binding exists; the FK is `onDelete: SetNull` plus the detach trigger as the bypassed-delete safety net.
- **Env:** `VALORANT_*` vars with fail-fast validation in `backend/src/config/env.js` and `.env.example` shape (Phase-4 Task 4 later deduped the `.env.example` block, `34c4d0d`).

### Phase 3 — Quest admin UI, `QuestEsports` `296e66f` (44 files, ~3765 insertions)

- Seven admin screens under `frontend/app/admin/valorant/*` (Overview hub, Team Bindings, Discovery, Series list + new + detail, Rankings, Reconciliation) behind the existing `AdminShell`/`AdminGuard`, plus the `VALORANT` navigation group in `frontend/lib/admin.ts`.
- `frontend/lib/valorant.ts` (pure types/helpers, zero runtime imports), `frontend/lib/valorant-api.ts` (`adminRequest` wrappers unwrapping `{ data }`), `frontend/hooks/api/useValorant.ts` (`useApiQuery`-based read hooks), and ~20 `components/admin/valorant/*` presentational/mutation components.
- **Model gap closed in this phase** (from admin-UI ledger follow-ups (a)/(b)): `QuestValorantSeries` gained `ratingMode` + `anchorPlayerAName/ATag/BName/BTag` (migration `20260814050249_add_valorant_series_rating_and_anchors`) so the committed-series card shows the actual finalized mode and the preview anchor strip renders.
- Frontend boundaries enforced by source-assertion unit tests (no FastAPI URL/Henrik/`X-Admin-Key`/secret references; explicit selection only — nothing auto-imports/auto-attaches; no re-activate UI).

### Phase 4 — Deployment & verification (both repos)

| Task | Shipment |
|---|---|
| 1 — RLS (a) + runner grants | `7b56ac4` (FastAPI): `_apply_security_posture` grants + per-table `FOR ALL … USING (true) WITH CHECK (true)` policies; `POLICY_EXCLUDED_TABLES = {"_migration_ledger"}`; `--runtime-role`/`DATABASE_RUNTIME_ROLE`; `docs/runtime-access-posture.md`. |
| 2 — Verify script + CI | `98742a1` (FastAPI): `scripts/verify_runtime_access.py` (+ `--expect-denied`) and the `roles-rls` CI job creating `val_runtime`/`quest_runtime` (with `PGPASSWORD`, per the fix round). |
| 3 — Local topology | `8e511ef` (Quest): same-Supabase two-service topology in `docs/setup-and-deployment.md` + `backend/.env.example` VALORANT block. |
| 4 — Env plumbing | `34c4d0d` (Quest): `VALORANT_*` vars + fail-fast (secret/key required when base URL set; HTTPS origin in production; `READ_RETRIES` 0..5), `backend/tests/valorant-env.test.js`. |
| 5 — Backup | `1ba6a86` (Quest): `ops/backup-production.sh` two-schema custom dump + manifest `database_scope`/`valorant_schema_included`; restore prints both-schema table counts (non-fatal per Ruling R3); backup scripts test + docs. |
| 6 — Schema-scope CI guards | `78b30ae` (Quest) + `705bae3` (FastAPI): `verify-prisma-schema-scope.js` (narrowed regex per Ruling R5) and the migrations `public.` grep guard; `docs/DEPLOYMENT_SAFETY.md` two-schema expand-first rules. |
| 7 — Private service boundary | `2389a69` (FastAPI ADR + route-inventory "health is the only unauthenticated route" test) + `0dc556a` (Quest production-topology docs). |
| 8 — E2E + contract shapes | `02dc19e` (Quest): `backend/tests/valorant-e2e/` (Henrik fixture mock on `:18000`, driver booting FastAPI `:8000` + Quest `:5001`, full journey through Quest routes with a real admin session), `npm run test:valorant:e2e`, opt-in CI job (PAT-gated). `0abbe05` (FastAPI): `tests/integration/test_quest_contract_shapes.py`. E2E secret-separator fix `e2e=` applied before merge (Task-8 Critical). |
| 9 — Secret scanning | `18ad6e4` (Quest: `.gitleaks.toml` placeholder allowlists + `backend/tests/secret-scan-placeholders.test.js`) + `5fe4ecc` (FastAPI: `secret-scan.yml` + `.gitleaks.toml`). |
| 10 — Smoke script | `7b363b1` (Quest): `backend/scripts/valorant-local-smoke.sh` + `npm run test:valorant:smoke` + local command reference. |
| 11 — UI checklist | `1d882e1` (Quest): `docs/valorant-ui-verification.md` (Playwright MCP / manual flows) + `docs/admin-operations.md` pointer. |

**Post-phase fixes:** `c0fe1f3` — finalize envelope first-class (see §4.2); `037142a` — `sub` = admin actor id on all read endpoints (see §4.1).

---

## 4. Key contracts

### 4.1 HMAC service token (`kid=secret`)

Every Quest→FastAPI request carries:

```http
Authorization: Bearer <quest-service-token>
X-Quest-Operation-Id: <operation_id>
Idempotency-Key: <external_key>          # team-bind and series-create only
```

- **Signing (Quest `valorant.auth.js`):** HMAC-SHA256, header `{alg: "HS256", typ: "JWT", kid}`, claims `{iss: "quest-esports", aud: "valorant-platform", sub: <admin users.id>, operation_id: <uuid>, iat, nbf = iat − 30s, exp = iat + 300s}`. `TOKEN_TTL_SECONDS = 300`; `kid` selects the shared secret.
- **`sub` is the admin actor id on EVERY request** — reads and writes. (The initial Phase-2 read path sent `sub: null`; fixed in `037142a`.)
- **Verification (FastAPI `app/api/service_token.py`):** `parse_secrets_map` reads `QUEST_SERVICE_SHARED_SECRETS="kid1=secret1,kid2=secret2"` (equals-separated — the E2E driver's original `e2e:…` colon was a shipped-but-corrected bug). `require_service_token` validates signature, `iss`/`aud`, `exp`/`nbf` with 30 s skew; rejects with 401 `ADMIN_AUTH_REQUIRED`. Dual-key overlap window enables rotation. `local`/`test` envs bypass and build a synthetic principal from `X-Quest-Actor-Id`/`X-Quest-Operation-Id`.
- **Secrets:** `VALORANT_SERVICE_SECRET` (Quest) / `QUEST_SERVICE_SHARED_SECRETS` (FastAPI). Generate with `openssl rand -hex 32`; commit shape only in `.env.example`. Never log tokens/secrets/raw candidate payloads.

### 4.2 Envelope and the finalize nuance

- Every Quest admin route returns `{ success: true, data, meta: { serverNow } }`; the frontend `valorantAdminRequest` unwraps `data`. Errors are `ApiRequestError` (browser) / `HttpError` (backend).
- **Finalize is special:** `data` is the `FinalizeResult` **first-class** — `data: { ...result }` (`valorant.controller.js:176`), **not** `data: { result }`. The service augments it with `operationId`. The Phase-3 wrapper/type/mocks shipped the wrong `{ result }` shape and were corrected in `c0fe1f3`; the E2E driver asserts `body.data.events` directly.
- Finalize response fields (camelCase after mapping): `seriesId, status, calculatedWinnerId, officialWinnerId, winnerOverrideReason, ratingMode, events[], teamACurrentElo, teamBCurrentElo, operationId`.

### 4.3 RLS posture

- Every `valorant` table has RLS enabled and one policy `<table>_runtime_all` granting `FOR ALL … USING (true) WITH CHECK (true)` to the VAL runtime role (`val_runtime` in prod/CI). The `_migration_ledger` table is **excluded** (migrator-only). The migrator (owner) bypasses RLS; every other role sees nothing.
- Applied idempotently by `scripts/apply_migrations.py --runtime-role <role>` (or `DATABASE_RUNTIME_ROLE`) on every migration run (`DROP POLICY IF EXISTS` then `CREATE POLICY`).
- Enforced/verified by `python -m scripts.verify_runtime_access` (positive) and `--expect-denied` (Quest runtime), the `roles-rls` CI job, and Quest-side `npm run prisma:security:verify` for the `public` schema. No grants leak across schemas (isolation queries documented in `docs/setup-and-deployment.md`).

### 4.4 Idempotency and the operation ledger

- **Create idempotency:** `Idempotency-Key` (== `external_quest_series_id` for series create; the `quest_saved_team_id` convergence key for team bind) makes a retried create return the existing row (200) instead of duplicating. Attach/remove/reorder/finalize are **not** idempotency-keyed; they are protected by the operation ledger and reconcile-by-read.
- **`QuestValorantOperation`** is written **before** the HTTP call: `pending → in_flight → succeeded | failed | reconciliation_required`, recording `operation_id`, `external_key`, `fastapi_request_id` (echoed `X-Request-ID`), `request_body_hash`, `response_code`, `error_code`, `response_summary`. Reads write no operation row (§9.2 "every admin action" = mutations).
- **Finalize is never blind-retried.** Definitive outcomes (2xx, 409/422) are recorded and surfaced; timeout/unknown → `reconciliation_required` + read FastAPI and adopt the committed state (`reconcileSeries`). Double-finalize returns 409 `SERIES_ALREADY_FINALIZED` and Quest surfaces the committed state, never re-applies.

### 4.5 Reconciliation semantics

`GET /api/v1/admin/valorant/reconciliation` (admin-only, read-only in the UI) surfaces, all through FastAPI reads:
- **orphaned** — Quest series with no matching FastAPI series;
- **unprojected** — FastAPI series with no Quest projection;
- **teamMissing** — bindings whose VAL team no longer resolves (404);
- **matchMissing** — match projections whose VAL match no longer exists;
- **stuckOperations** — operations in `in_flight`/`reconciliation_required`.

Admin-triggered actions are re-sync a projection or adopt a FastAPI series; no destructive cleanup in MVP.

### 4.6 Error mapping (Quest surface → FastAPI codes)

`backend/src/modules/valorant/valorant.client.js` `VALORANT_ERROR_MESSAGES` maps every observed FastAPI code (fixture-tested; assumed codes are never invented): `ADMIN_AUTH_REQUIRED`→"VALORANT platform rejected the request (service auth)", `INVALID_REQUEST`, `INVALID_RIOT_ID`, `PLAYER_NOT_FOUND`/`PLAYER_REGION_UNKNOWN`, `HENRIK_AUTH_FAILED`, `HENRIK_RATE_LIMITED`, `HENRIK_UNAVAILABLE`, `HENRIK_VALIDATION_ERROR`, `MATCH_NOT_FOUND`, `MATCH_NOT_COMPLETED`, `MATCH_ALREADY_ASSIGNED_TO_SERIES`, `MATCH_REFRESH_REJECTED`, `TEAM_NOT_FOUND`, `TEAM_SLUG_TAKEN`, `SERIES_NOT_FOUND`, `SERIES_INVALID`, `SERIES_ALREADY_FINALIZED`, `RATING_POLICY_REQUIRED`, `INVALID_SIDE_MAPPING`, `ANCHOR_MISMATCH`, `ANCHOR_NOT_IN_MATCH`, `BACKDATED_SERIES_REJECTED`, plus observed `INTERNAL_ERROR`.

- Definitive FastAPI code → `FastApiError` (with `.code/.status/.requestId/.responseSummary`).
- Transport/unknown → `InternalServiceError` (`valorant_unreachable`, `valorant_upstream_error`, `valorant_not_configured`) — these enter the reconciliation path, never the error-code table.
- No-overlap discovery is **not** an error: `candidates: []` with 200. Re-import is 200 `created=false` (informational).

---

## 5. Admin user flow (7 steps)

All flows live on the single **Valorant Management** page (`/admin/valorant`) — one nav entry with tabs (Team Bindings · Discovery · Series · Rankings · Reconciliation) behind `AdminGuard`/`requireAdmin`; every mutation writes an `AuditLog` row and a `QuestValorantOperation` row.

1. **Bind** — *Team Bindings* tab: pick an existing `SavedTeam`, bind → `POST /api/v1/admin/valorant/teams/bind` → FastAPI `POST /teams` create-or-get by `quest_saved_team_id`; the VAL team UUID is stored as an opaque reference. One **active** binding per SavedTeam (partial unique index + service guard); no re-bind to a second VAL team in MVP. Detach is Quest-local (`DELETE …/teams/{bindingId}/detach`, never touches VALORANT data); no re-activate UI.
2. **Discover** — *Discovery* tab: enter two Riot IDs (`Name#Tag`) → `POST …/discover` → FastAPI two-player search (intersects both histories on Henrik `match_id`, bounded `page_size`/`max_pages`). The lightweight list shows only `MatchCandidate` fields (no winning side/roster). The review modal labels each side with its search player (`Red — Name#Tag` / `Blue — Name#Tag`). No-overlap returns an empty list. **Nothing auto-imports.**
3. **Series** — *Series* tab (list ⇄ new ⇄ detail, in-tab sub-views): create a BO1/BO3/BO5 draft with two bound teams, `playedAt`, a Rated/Unrated draft preference, and the two anchor Riot IDs. Anchors are persisted on the Quest row (`anchorPlayerAName/ATag/BName/BTag`) and resolved to PUUIDs on the FastAPI side (`anchor_a_puuid`/`anchor_b_puuid`).
4. **Build** — open the series-scoped match library (`GET …/series/{id}/matches` — only matches where the two anchor players face off on opposing sides, labeled `Player A (side) vs Player B (side)`), pick a match, and attach with `gameNumber` **only**: FastAPI derives Team A's side from the anchor PUUIDs (409 `ANCHOR_NOT_IN_MATCH` if the match lacks both anchors on opposing sides), plus the other side, scores, and winner — nothing is re-entered. Set the absolute desired order (`PUT …/games/order` — the body states the full final order; retries converge), remove games, and review the preview (`valid`, maps won, calculated winner, anchors).
5. **Finalize** — pick a rating mode (`normal` rated / `unrated` / `forfeit_no_rating` / `forfeit_result_only` / `manual_override`; the latter three require an override reason) and optional official-winner override → `POST …/finalize`. Rated modes verify both anchors on opposing sides of every map (409 `ANCHOR_MISMATCH` without an explicit audited override) and honor chronological order (409 `BACKDATED_SERIES_REJECTED`). Outcome is **first-class** under `data` and includes `operationId`. Double-finalize surfaces the committed state; timeout marks the operation `reconciliation_required` and offers "Re-check status" (reads only).
6. **Rankings** — *Rankings* tab: reads FastAPI `GET /rankings/teams` + per-team rating history and team series, joined with binding display names. Quest never computes ELO.
7. **Reconciliation** — *Reconciliation* tab: read-only report of orphans, unprojected series, missing teams/matches, and stuck operations, with refresh; controlled re-sync/adoption of committed state is backend-owned.

---

## 6. Local development

Two services + one frontend against the **same dedicated Supabase test project** (never production/staging):

```text
Next.js frontend ......... http://localhost:3000   (NEXT_PUBLIC_API_URL=http://localhost:5001)
Quest Express backend .... http://localhost:5001
valorant-platform-backend. http://localhost:8000   (VALORANT_INTERNAL_BASE_URL=http://localhost:8000)
Shared Supabase test project  (schema-specific credentials)
```

```bash
# Terminal 1 — FastAPI (repo: ../valorant-platform-backend)
cd ../valorant-platform-backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — Quest backend
cd backend
npm run dev

# Terminal 3 — Quest frontend
cd frontend
npm run dev
```

**Prepare the shared test project once** (per `docs/setup-and-deployment.md`):

1. Create the VAL runtime role in the Supabase SQL editor:
   ```sql
   CREATE ROLE val_runtime LOGIN PASSWORD '<generate-random>';
   ```
2. Apply FastAPI migrations as the migrator with the runtime-role grants (creates the `valorant` schema, `_migration_ledger`, grants, and RLS policies):
   ```bash
   cd ../valorant-platform-backend
   uv run python -m scripts.apply_migrations --runtime-role val_runtime
   ```
3. Apply Quest Prisma migrations as usual: `npm run prisma:migrate:deploy` (or `npx prisma migrate dev` in dev).

**Local env shape** (values are placeholders — generate real ones locally; `.env` stays untracked, `.env.example` carries shape only):

- Quest `backend/.env`: `VALORANT_INTERNAL_BASE_URL=http://localhost:8000`, `VALORANT_SERVICE_SECRET=<generate-random>`, `VALORANT_SERVICE_KEY_ID=kid-local`, `VALORANT_SERVICE_ISSUER=quest-esports`, `VALORANT_SERVICE_AUDIENCE=valorant-platform`, `VALORANT_TIMEOUT_MS=10000`, `VALORANT_READ_RETRIES=2`.
- FastAPI `.env`: `QUEST_SERVICE_SHARED_SECRETS=kid-local=<generate-random>` (must match the Quest secret), `QUEST_SERVICE_ISSUER=quest-esports`, `QUEST_SERVICE_AUDIENCE=valorant-platform`, `DATABASE_URL=<valorant-schema URL>`, `HENRIK_API_KEY=<generate-random>`, `DATABASE_RUNTIME_ROLE=val_runtime`.

**Smoke and tests:**

```bash
cd backend
npm run test:valorant:smoke   # health + auth checks against running services → "VALORANT local smoke: PASS"
npm run test:valorant:e2e     # two-service E2E journey (see backend/tests/valorant-e2e/README.md; needs E2E_* env)
```

The E2E harness (`backend/tests/valorant-e2e/valorant-e2e.test.js`) boots the Henrik fixture mock (`:18000`), FastAPI (`:8000`), and Quest Express (`:5001`) and drives the §5 journey through Quest routes with a real admin session — requires a provisioned test project, the `E2E_*` env block, and `VALORANT_PLATFORM_REPO` pointing at the FastAPI checkout.

---

## 7. Verification — what is verified vs prospective

**Verified (shipped, in-session or CI-backed):**

- FastAPI unit + integration suite for D1–D10 (`tests/unit/*`, `tests/integration/*` — service-token, rating policy, anchor verification, backdated finalization, migration 0014, route inventory, ID-naming contract).
- Quest backend suite: env validation (`env.test.js`, `valorant-env.test.js`), auth/client/mapper/service/controller tests, route guards, backup-scripts tests, secret-scan-placeholder test, schema-scope guard (run locally + CI step).
- Frontend: `npm test` (81 unit tests incl. `valorant.test.ts`, `valorant-api.test.ts`, `valorant-components.test.ts` source guards), typecheck, lint, build (admin-UI ledger Task 9, full battery green).
- Roles/RLS: `roles-rls` CI job asserts `val_runtime` can read/write `valorant` and the Quest runtime is denied (`--expect-denied`).
- Route-inventory: health is the only unauthenticated `/api/v1` route (`2389a69`).
- Envelope fix (`c0fe1f3`) and `sub` fix (`037142a`) landed and their unit tests assert the corrected shapes.

**Prospective (code-satisfied, evidence pending — the release blockers):**

- **Live two-service E2E run** against a provisioned test project (`npm run test:valorant:e2e`) — needs `E2E_*` env + FastAPI checkout (deployment plan Task 8, release blocker 4). The timeout/unknown-outcome scenario (`E2E_DROP_FINALIZE_RESPONSE`) is a tracked follow-up, not implemented.
- **Production backup restore drill** — two-schema dump code shipped (`1ba6a86`) but the isolated restore drill with manifest `database_scope=application_public_and_valorant_schemas` + non-zero table counts for both schemas has not been run against production (release blocker 1).
- **Prod RLS verify** — `scripts.verify_runtime_access` (positive + `--expect-denied`) and `npm run prisma:security:verify` must pass against the production Supabase project before FastAPI runs with `APP_ENV=production` (release blocker 2).
- **Live gitleaks** — local Docker run skipped (macOS keychain credential error); the CI `secret-scan` run on the next push is the recorded evidence (deployment ledger Task 9, release blocker 5).
- **CI green on pushed branches** — per-task commits exist locally; QuestEsports head `037142a` and FastAPI head `5fe4ecc` were not pushed as part of this work.
- UI flows verified via Playwright MCP / manual browser per `docs/valorant-ui-verification.md` (browser install deferred by design).

---

## 8. Known follow-ups

**Deferred minors (shippable; tracked in the ledgers):**

- E2E timeout/unknown-outcome test (`E2E_DROP_FINALIZE_RESPONSE`) not implemented (deployment ledger Task-8 M2).
- Quest ledger admin-UI minors: preview staleness fixed; remaining cosmetic/a11y items (`role="alert"` on banners, dialog focus management, hub all-or-nothing error state, table `<th scope>`).
- Deployment ledger minors: `_quote_ident` hardening for policy names (M1), stale `apply_migrations.py` module docstring (Task-1 M4), smoke check-4 treats a legit maintenance 503 as failure (Task-10 M1), gitleaks FastAPI allowlist `user:password` literal vs `postgres:postgres` (Task-9 M2), `require_admin` remaining on `/rankings/rebuild` weakens literal §10.2 (Task-7 M2).
- Spec/code split: `VALORANT_TIMEOUT_MS` example 10000 vs older code default 15000 (deployment ledger Task-3 M1).

**Release blockers — evidence to produce before promoting to production:**

1. Two-schema production backup deployed and a restore drill passed (manifest `application_public_and_valorant_schemas`, both-schema table counts).
2. Four-role/RLS verified against the production Supabase project (`verify_runtime_access` PASS, `--expect-denied` PASS, `prisma:security:verify` PASS).
3. Service token (D1) merged and the route-inventory test green — **done** (`2389a69`).
4. Two-service E2E journey green on a provisioned project.
5. Secret scanning green on both repos (live gitleaks run / CI evidence).
6. Schema-scope CI guards green — **done in code** (`78b30ae`, `705bae3`); CI-green evidence pending push.

---

## 9. Post-ship fixes and local-testing state (Aug 14)

Discovered during the first end-to-end local run against a dedicated Supabase test project — live-API/behavior fixes, not design drift:

1. **Read-path `sub` was `null`** (`037142a`) — the Quest read handlers never threaded `req.user.id` into the service-token `sub` claim, so FastAPI rejected every admin read with 401 "service auth". Fixed: all 8 read paths now sign `sub` = the admin UUID.
2. **Finalize envelope** (`c0fe1f3`) — the Quest finalize response is `data: { ...result }` (first-class), not `data.result`; the frontend wrapper/type/mocks were corrected.
3. **Henrik contract drift** (`6a1e0f3`, FastAPI) — the live HenrikDev API now returns `metadata.queue` as an object `{id, name, mode_type}` (was a string), and Deathmatch `teams[].team_id` as a per-player UUID (was "Red"/"Blue"). Fixed: a `field_validator` coerces `queue` to its `name`; `_normalize_sides` maps only known side literals and leaves UUIDs untouched (so `derive_scores` reports those sides absent). Both affect the shared `HenrikMetadata` (list item + detail).
4. **Discovery depth + timeout** (`3d9e08d`) — the UI's two-player search defaulted to `max_pages=1` (10 matches/player), which couldn't reach older matches (e.g. a BO3 six days back), and the Quest backend's 10s connect timeout aborted the slower multi-page search. Fixed: `DEFAULT_MAX_PAGES = 5` (spec max) in the discovery form and `CONNECT_TIMEOUT_MS = 60000` in the client.

Local-testing state (as of this session):
- Dedicated Supabase test project provisioned; both schemas migrated (`valorant` 14 migrations, `public` 50); `val_runtime` + `quest_runtime` roles created; RLS verified both ways (`verify_runtime_access` PASS / `--expect-denied` PASS).
- FastAPI `.env` and Quest `backend/.env` point at the test project; the Henrik API key is wired into FastAPI.
- Seeded: admin `admin@valorant.test` + two SavedTeams ("Test Team Alpha"/ALPHA, "Test Team Bravo"/BRAVO).
- Smoke test (`npm run test:valorant:smoke`) PASS; both services + frontend boot and connect.
- Discovery + explicit import verified live through the UI for `dimeth#short` ↔ `Logger#lh44` (a BO3 of three "Custom Game" matches on 2026-08-08).
- Both branches now pushed: Quest `chore/local-development-environment` @ `3d9e08d`, FastAPI `main` @ `6a1e0f3`.

---

## References (exact paths)

- Design: `docs/superpowers/specs/2026-08-13-standalone-valorant-integration-design.md` (rev 2 + appended Revision 3 as-built).
- Plans: `docs/superpowers/plans/2026-08-13-valorant-fastapi-contract-plan.md`, `2026-08-13-quest-valorant-backend-integration-plan.md`, `2026-08-13-quest-valorant-admin-ui-plan.md`, `2026-08-13-valorant-deployment-verification-plan.md`.
- Ledgers: `.superpowers/sdd/2026-08-13-quest-valorant-admin-ui-plan/progress.md`, `.superpowers/sdd/2026-08-13-valorant-deployment-verification-plan/progress.md`.
- Quest code: `backend/prisma/schema.prisma` (models ~L1176), `backend/prisma/migrations/20260813*/20260814*_add_valorant*`, `backend/src/modules/valorant/*`, `backend/src/routes/v1.js`, `backend/src/config/env.js`, `frontend/lib/valorant.ts`, `frontend/lib/valorant-api.ts`, `frontend/app/admin/valorant/*`, `frontend/components/admin/valorant/*`, `ops/backup-production.sh`, `ops/restore-production-backup.sh`, `backend/scripts/verify-prisma-schema-scope.js`, `backend/scripts/valorant-local-smoke.sh`, `backend/tests/valorant-e2e/`.
- FastAPI code: `app/api/service_token.py`, `app/api/dependencies.py`, `app/config.py`, `supabase/migrations/0014_quest_integration.sql`, `scripts/apply_migrations.py`, `scripts/verify_runtime_access.py`, `docs/runtime-access-posture.md`, `docs/architecture-decisions.md`, `tests/token_helpers.py`, `tests/integration/test_quest_contract_shapes.py`.
