# Quest VALORANT Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Quest Express backend integration layer for the standalone VALORANT admin series flow — public-schema Prisma models, HMAC service-auth token, internal FastAPI HTTP client, admin proxy routes, idempotent orchestration with an operation ledger, guarded SavedTeam deletion, and backend + DB integration tests — without touching the `valorant` schema.

**Architecture:** Quest Esports remains the authenticated product/admin/BFF layer; a new `backend/src/modules/valorant/` module signs HMAC bearer tokens, proxies admin requests over a private internal HTTP client to `valorant-platform-backend`, and mirrors remote state into `public`-schema projections (`valorant_team_bindings`, `quest_valorant_series`, `quest_valorant_series_games`, `quest_valorant_matches`, `quest_valorant_operations`). Quest never reads or writes the `valorant` schema directly; all VALORANT UUIDs are opaque text. Every remote mutation is tracked by a `QuestValorantOperation` row (`pending → in_flight → succeeded/failed/reconciliation_required`) plus an `AuditLog` row; finalize is never blind-retried.

**Tech Stack:** Node 24 (CommonJS), Express 5, Prisma 6 (`@prisma/client` generated to `backend/src/generated/prisma`), `node:test` + `node:assert/strict`, `node:crypto` (HMAC-SHA256, no new dependencies), global `fetch`/`AbortController` (Node 24 built-in). FastAPI `valorant-platform-backend` is an external service reached only via HTTP.

**Spec:** `QuestEsports/docs/superpowers/specs/2026-08-13-standalone-valorant-integration-design.md` (rev 2, approved). This plan implements the **Quest backend slice** of that spec (§3.3, §4.3, §6.2–§6.6, §7.4–§7.5, §8, §9.2, §10.1, §11.1–§11.3). The FastAPI-side deltas D1–D9 (§4.4, §6.7) are owned by the sibling `valorant-platform-backend` repo and are **prerequisites, not work in this plan**; this plan consumes their documented HTTP contract and records FastAPI responses as fixtures.

## Global Constraints

Copied verbatim from the approved spec; every task inherits these:

1. **No Prisma models or migrations for `valorant` tables; no cross-schema FKs; Quest never accesses the `valorant` schema directly** (§1.1 A3, §7.1–§7.2). All VALORANT UUIDs (`valorant_team_uuid`, `valorant_series_uuid`, `match_id`) are opaque `text`.
2. **Quest `SavedTeam` is the team selection source** (§1.1 A4). Binding is durable and one-way: deleting/detaching a Quest team never deletes VALORANT teams, series, or rating history (§4.2, §7.5).
3. **Quest Prisma migrations touch only `public`; expand-first ordering; rollback = revert the app deployment** (new columns/tables inert to the previous version) (§7.3). Destructive `prisma migrate reset` / `db drop` are forbidden against shared/remote databases (§7.3 rule 4).
4. **New public tables must be RLS-enabled with no grants to `PUBLIC`/`anon`/`authenticated`/`service_role`** — `npm run prisma:security:verify` (`backend/scripts/verify-database-security.js`) fails otherwise; follow the pattern in `backend/prisma/migrations/20260812120000_add_event_photo_albums/migration.sql`.
5. **Every `/api/v1/admin/valorant/*` route is `requireAdmin`-guarded** and every admin VALORANT action writes both an `AuditLog` row and a `QuestValorantOperation` row (§5, §9.2).
6. **Every remote mutation writes its operation row BEFORE the HTTP call**; `operation_id` is server-generated and propagated in the signed token and `X-Quest-Operation-Id` header (§8.1). Create idempotency via `external_quest_series_id` + `Idempotency-Key` (series create) and `quest_saved_team_id` (team bind) only.
7. **Finalize is never blind-retried.** Timeout/unknown outcome ⇒ operation `reconciliation_required`; reconcile by reading FastAPI (§8.2). No `finalizing` series status exists (§4.3).
8. **Series status values are `draft | finalized | orphaned | reconciliation_required` only** (§4.3); FastAPI only reports `draft|finalized`.
9. **Env secrets never committed.** `.env.example` carries shape only; `.env` stays untracked (§10.1). Fail fast on missing `VALORANT_SERVICE_SECRET` outside tests; HTTPS-assert `VALORANT_INTERNAL_BASE_URL` in production (§10.1).
10. **Never log tokens, secrets, or raw candidate payloads** (§6.6, §9.2). Quest reuses `HttpError` (`backend/src/lib/http-error.js`) on the backend; `ApiRequestError` (`frontend/lib/api.ts`) is the browser-side contract.
11. **Error mapping is fixture-tested against recorded FastAPI responses; assumed/undocumented codes are never invented** (§6.5, §11.2).
12. **`openapi.test.js` requires every mounted route to be documented** in `backend/src/lib/openapi.js` (it scans all `*.routes.js` under `src/modules/` as `/api`-mounted legacy and `backend/src/routes/v1.js` as `/api/v1`). Versioned admin routes therefore follow the Challonge precedent: declared inline in `v1.js`, not in a module `.routes.js` file (deviation from spec §3.3's file list, see Decision D1).
13. **Test DB integration only against a dedicated test project** via `npm run test:integration` (`backend/scripts/run-database-integration-tests.js`); tests self-skip unless `RUN_DATABASE_INTEGRATION_TESTS=true` (§11.3, `docs/setup-and-deployment.md` integration workflow).
14. **Ops: `ops/backup-production.sh` must capture both `public` and `valorant` schemas before any authoritative VALORANT data is colocated** (§7.6). This is a release blocker tracked separately from this plan (opened as its own ops task, not implemented here).

### Decisions (deviations justified by current code)

- **D1 — Route declarations live in `backend/src/routes/v1.js`, not `valorant.routes.js`.** The `openapi.test.js` scanner treats every `*.routes.js` file under `src/modules/` as mounted under `/api`; a module `valorant.routes.js` would be normalized to `/api/admin/valorant/...` and fail the suite. The existing versioned admin pattern for external-service integrations is inline in `v1.js` (Challonge block, `backend/src/routes/v1.js:57-98`). The `valorant` module still ships controller/service/client/auth/mapper/validation files.
- **D2 — Bypassed-deletion detach is enforced by a SQL trigger, not app code.** The FK `onDelete: SetNull` only nulls `saved_team_id`; Slice-0 acceptance (§12) requires a bypassed delete to leave the binding `status = detached`. A `BEFORE DELETE ON saved_teams` trigger (appended to the migration) guarantees it at the DB level.

---

## File Structure

```
backend/
  prisma/schema.prisma                       MODIFY: add enums + 5 models + User/SavedTeam relations
  prisma/migrations/<ts>_add_valorant_bindings_series_operations/
    migration.sql                            GENERATED then APPEND: partial unique index, detach trigger, RLS/revoke
  src/config/env.js                          MODIFY: VALORANT_* vars + validation
  .env.example                               MODIFY: VALORANT_* shape (blank)
  src/modules/valorant/
    valorant.auth.js                         CREATE: HMAC-SHA256 JWT sign + header assembly
    valorant.client.js                       CREATE: fetch wrapper, timeouts, bounded retries, error mapping
    valorant.mapper.js                       CREATE: FastAPI payload <-> Quest projection mappers
    valorant.validation.js                   CREATE: Riot ID parsing, externalKey, format rules
    valorant.service.js                      CREATE: orchestration + operation ledger + reconciliation
    valorant.controller.js                   CREATE: thin asyncHandler route handlers + AuditLog wiring
  src/routes/v1.js                           MODIFY: requireAdmin + /admin/valorant route block (Decision D1)
  src/lib/openapi.js                         MODIFY: document every new route (openapi.test.js gate)
  src/modules/teams/team.service.js          MODIFY: deleteSavedTeam active-binding guard (L643)
  src/modules/admin/admin.service.js         MODIFY: deleteAdminSavedTeam active-binding guard (L2193)
  tests/
    env.test.js                              MODIFY: productionEnv fixture + new VALORANT cases
    valorant.auth.test.js                    CREATE
    valorant.client.test.js                  CREATE (fixture-driven contract tests)
    valorant.mapper.test.js                  CREATE (fixture-driven)
    valorant.validation.test.js              CREATE
    valorant.service.test.js                 CREATE
    valorant.controller.test.js              CREATE (AuditLog wiring)
    valorant-routes.test.js                  CREATE (guard + route inventory on v1 router)
    team.service.test.js                     MODIFY: guarded-deletion cases
    admin.service.test.js                    MODIFY: guarded-deletion cases
    database-integration.test.js             MODIFY: DB invariants + ledger transitions
  tests/fixtures/valorant/                   CREATE: recorded FastAPI responses (search, detail, series,
                                             games, order, finalize, error codes)
docs/api-documentation.md                    MODIFY: "VALORANT Admin Endpoints" section
```

**Module boundaries** (each file one responsibility):
- `valorant.auth.js` — pure crypto: token signing and header construction. No I/O.
- `valorant.client.js` — the only HTTP path to FastAPI. Owns timeouts, retries, FastAPI error mapping (§6.5), `FastApiError`/`InternalServiceError`. No Prisma.
- `valorant.mapper.js` — pure field mapping FastAPI snake_case → Quest camelCase. No I/O.
- `valorant.validation.js` — pure input rules. No I/O.
- `valorant.service.js` — orchestration, Prisma reads/writes, operation-ledger state machine, reconciliation queries. Never builds auth headers itself (uses `valorant.auth` via the client).
- `valorant.controller.js` — thin request/response translation + `recordAudit`. No Prisma, no HTTP.

---

### Task 1: VALORANT environment configuration and validation

**Files:**
- Modify: `backend/src/config/env.js` (env object ~L153-340, post-checks ~L342-560)
- Modify: `backend/.env.example`
- Modify: `backend/tests/env.test.js` (productionEnv fixture ~L8-41 + new tests)
- Note: add the same variables with real values to the untracked local `backend/.env` so `npm test` (which loads `env.js` under `NODE_ENV=development` via `openapi.test.js`) keeps passing — the existing `AUTH_ENCRYPTION_KEY` check works the same way.

**Interfaces:**
- Consumes: `backend/src/config/env.js` existing helpers (`optional`, `normalizeIntegerInRange`, `assertHttpsUrl`, `normalizeNodeEnv`).
- Produces: `env.VALORANT_INTERNAL_BASE_URL`, `env.VALORANT_SERVICE_SECRET`, `env.VALORANT_SERVICE_KEY_ID`, `env.VALORANT_SERVICE_ISSUER` (default `"quest-esports"`), `env.VALORANT_SERVICE_AUDIENCE` (default `"valorant-platform"`), `env.VALORANT_TIMEOUT_MS` (default 15000), `env.VALORANT_READ_RETRIES` (default 2). Consumed by Task 3/4.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/env.test.js`:

```js
test("production requires the VALORANT service secret and key id", () => {
  const missingSecret = loadEnvironment({ VALORANT_SERVICE_SECRET: "" });
  assert.notEqual(missingSecret.status, 0);
  assert.match(missingSecret.stderr, /VALORANT_SERVICE_SECRET is required outside tests/);

  const missingKid = loadEnvironment({
    VALORANT_SERVICE_SECRET: "x".repeat(64),
    VALORANT_SERVICE_KEY_ID: "",
  });
  assert.notEqual(missingKid.status, 0);
  assert.match(missingKid.stderr, /VALORANT_SERVICE_KEY_ID is required outside tests/);
});

test("production rejects an insecure VALORANT internal base URL", () => {
  const insecure = loadEnvironment({
    VALORANT_SERVICE_SECRET: "x".repeat(64),
    VALORANT_SERVICE_KEY_ID: "kid-1",
    VALORANT_INTERNAL_BASE_URL: "http://valorant.internal:8000",
  });
  assert.notEqual(insecure.status, 0);
  assert.match(insecure.stderr, /VALORANT_INTERNAL_BASE_URL must use HTTPS/);
});

test("production accepts a valid HTTPS VALORANT internal base URL", () => {
  const valid = loadEnvironment({
    VALORANT_SERVICE_SECRET: "x".repeat(64),
    VALORANT_SERVICE_KEY_ID: "kid-1",
    VALORANT_INTERNAL_BASE_URL: "https://valorant.internal:8443",
  });
  assert.equal(valid.status, 0, valid.stderr);
});
```

Also update the shared `productionEnv` fixture at the top of `backend/tests/env.test.js` so the existing production tests keep booting `env.js`:

```js
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_INTERNAL_BASE_URL: "https://valorant.internal:8443",
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/env.test.js -v`
Expected: FAIL — the three new tests fail (missing secret produces no error today) and every existing production test fails too because the fixture lacks `VALORANT_SERVICE_SECRET`.

- [ ] **Step 3: Add the env vars and validation**

In `backend/src/config/env.js`, add to the `env` object (alphabetical placement after `UPSTASH_REDIS_REST_TOKEN`, ~L176):

```js
  VALORANT_INTERNAL_BASE_URL: optional("VALORANT_INTERNAL_BASE_URL").replace(/\/+$/, ""),
  VALORANT_SERVICE_SECRET: optional("VALORANT_SERVICE_SECRET"),
  VALORANT_SERVICE_KEY_ID: optional("VALORANT_SERVICE_KEY_ID"),
  VALORANT_SERVICE_ISSUER: optional("VALORANT_SERVICE_ISSUER", "quest-esports"),
  VALORANT_SERVICE_AUDIENCE: optional("VALORANT_SERVICE_AUDIENCE", "valorant-platform"),
  VALORANT_TIMEOUT_MS: normalizeIntegerInRange(
    "VALORANT_TIMEOUT_MS",
    process.env.VALORANT_TIMEOUT_MS,
    15000,
    1000,
    60000,
  ),
  VALORANT_READ_RETRIES: normalizeIntegerInRange(
    "VALORANT_READ_RETRIES",
    process.env.VALORANT_READ_RETRIES,
    2,
    0,
    5,
  ),
```

In the post-check block (near the `AUTH_ENCRYPTION_KEY` check, ~L398):

```js
if (env.NODE_ENV !== "test" && !env.VALORANT_SERVICE_SECRET) {
  throw new Error(
    "VALORANT_SERVICE_SECRET is required outside tests for VALORANT service-auth signing.",
  );
}

if (env.NODE_ENV !== "test" && !env.VALORANT_SERVICE_KEY_ID) {
  throw new Error(
    "VALORANT_SERVICE_KEY_ID is required outside tests for HMAC key rotation.",
  );
}

if (env.VALORANT_INTERNAL_BASE_URL) {
  let parsed;
  try {
    parsed = new URL(env.VALORANT_INTERNAL_BASE_URL);
  } catch {
    throw new Error("VALORANT_INTERNAL_BASE_URL must be a valid absolute URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("VALORANT_INTERNAL_BASE_URL must not contain URL credentials.");
  }
  if (env.NODE_ENV === "production") {
    assertHttpsUrl("VALORANT_INTERNAL_BASE_URL", env.VALORANT_INTERNAL_BASE_URL);
  }
}
```

- [ ] **Step 4: Update `.env.example`**

Append to `backend/.env.example` (blank shape only):

```
# Internal VALORANT platform service (FastAPI). HTTPS required in production.
VALORANT_INTERNAL_BASE_URL=http://localhost:8000
# HMAC-SHA256 service-auth secret shared with valorant-platform-backend. Generate with: openssl rand -hex 32
VALORANT_SERVICE_SECRET=
# Key ID selects the current key (dual-key rotation window). Must match FastAPI QUEST_SERVICE_SHARED_SECRETS.
VALORANT_SERVICE_KEY_ID=
VALORANT_SERVICE_ISSUER=quest-esports
VALORANT_SERVICE_AUDIENCE=valorant-platform
VALORANT_TIMEOUT_MS=15000
VALORANT_READ_RETRIES=2
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/env.test.js`
Expected: PASS (all existing + 3 new tests).

- [ ] **Step 6: Add real values to the local untracked `.env`**

Add `VALORANT_INTERNAL_BASE_URL=http://localhost:8000`, `VALORANT_SERVICE_SECRET=<dev secret>`, `VALORANT_SERVICE_KEY_ID=kid-local` to `backend/.env`. Then run the full suite once to confirm the repo still boots:

Run: `npm test`
Expected: PASS (includes `openapi.test.js`, which loads `env.js`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/config/env.js backend/.env.example backend/tests/env.test.js
git commit -m "feat(valorant): add VALORANT service environment configuration and validation"
```

---

### Task 2: Prisma public-schema models and migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (enums near top ~L12; models near `SavedTeam` ~L1133; relations on `User` ~L212 and `SavedTeam` ~L1133)
- Create: `backend/prisma/migrations/<ts>_add_valorant_bindings_series_operations/migration.sql` (generated with `--create-only`, then appended SQL)
- Modify: `backend/src/generated/prisma` (regenerated by `npx prisma generate`)

**Interfaces:**
- Consumes: existing `User`, `SavedTeam`, `AuditLog` models.
- Produces (Task 6–12 consume these exact names): `ValorantTeamBinding` (`valorant_team_bindings`), `QuestValorantSeries` (`quest_valorant_series`), `QuestValorantSeriesGame` (`quest_valorant_series_games`), `QuestValorantMatch` (`quest_valorant_matches`), `QuestValorantOperation` (`quest_valorant_operations`), enums `ValorantBindingStatus`, `ValorantSeriesStatus`, `ValorantOperationType`, `ValorantOperationStatus`, `ValorantFormat`, `ValorantGameSide`.

- [ ] **Step 1: Write the failing test (schema/security gate)**

Append to `backend/tests/database-integration.test.js` (DB integration tests self-skip unless `RUN_DATABASE_INTEGRATION_TESTS=true`; this is the executable gate that fails while the models are missing):

```js
test("VALORANT public-schema tables exist and are RLS-protected", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  try {
    const rows = await prisma.$queryRaw`
      SELECT c.relname AS "tableName", c.relrowsecurity AS "rls"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'valorant_team_bindings',
          'quest_valorant_series',
          'quest_valorant_series_games',
          'quest_valorant_matches',
          'quest_valorant_operations'
        )
      ORDER BY c.relname
    `;
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.rls === true));
  } finally {
    await prisma.$disconnect();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `rows.length` is 0 (tables do not exist); the rest of the file's tests pass.

- [ ] **Step 3: Add the models to `schema.prisma`**

Add enums after `UserRole` (L12):

```prisma
enum ValorantBindingStatus {
  active
  detached
}

enum ValorantSeriesStatus {
  draft
  finalized
  orphaned
  reconciliation_required
}

enum ValorantOperationType {
  team_bind
  series_create
  attach_game
  set_game_order
  remove_game
  finalize
  reconcile
}

enum ValorantOperationStatus {
  pending
  in_flight
  succeeded
  failed
  reconciliation_required
}

enum ValorantFormat {
  bo1
  bo3
  bo5
}

enum ValorantGameSide {
  red
  blue
}
```

Add these models just before `model SavedTeam` (L1133):

```prisma
model ValorantTeamBinding {
  id               String                @id @default(uuid()) @db.Uuid
  savedTeamId      String?               @map("saved_team_id") @db.Uuid
  valorantTeamUuid String                @map("valorant_team_uuid")
  status           ValorantBindingStatus @default(active)
  boundByUserId    String?               @map("bound_by_user_id") @db.Uuid
  boundAt          DateTime              @default(now()) @map("bound_at")
  detachedAt       DateTime?             @map("detached_at")
  createdAt        DateTime              @default(now()) @map("created_at")
  updatedAt        DateTime              @updatedAt @map("updated_at")
  savedTeam        SavedTeam?            @relation(fields: [savedTeamId], references: [id], onDelete: SetNull)
  boundByUser      User?                 @relation("ValorantBindingBoundBy", fields: [boundByUserId], references: [id], onDelete: SetNull)
  seriesAsA        QuestValorantSeries[] @relation("ValorantBindingA")
  seriesAsB        QuestValorantSeries[] @relation("ValorantBindingB")

  @@index([savedTeamId])
  @@index([valorantTeamUuid])
  @@index([status])
  @@map("valorant_team_bindings")
}

model QuestValorantSeries {
  id                   String                  @id @default(uuid()) @db.Uuid
  externalKey          String                  @unique @map("external_key")
  bindingAId           String                  @map("binding_a_id") @db.Uuid
  bindingBId           String                  @map("binding_b_id") @db.Uuid
  format               ValorantFormat
  playedAt             DateTime                @map("played_at")
  ratingModePreference String?                 @map("rating_mode_preference")
  status               ValorantSeriesStatus    @default(draft)
  valorantSeriesUuid   String?                 @map("valorant_series_uuid")
  finalizedById        String?                 @map("finalized_by_id") @db.Uuid
  lastOperationId      String?                 @unique @map("last_operation_id") @db.Uuid
  createdAt            DateTime                @default(now()) @map("created_at")
  updatedAt            DateTime                @updatedAt @map("updated_at")
  bindingA             ValorantTeamBinding     @relation("ValorantBindingA", fields: [bindingAId], references: [id], onDelete: Restrict)
  bindingB             ValorantTeamBinding     @relation("ValorantBindingB", fields: [bindingBId], references: [id], onDelete: Restrict)
  finalizedBy          User?                   @relation("ValorantSeriesFinalizer", fields: [finalizedById], references: [id], onDelete: SetNull)
  lastOperation        QuestValorantOperation? @relation("ValorantSeriesLastOperation", fields: [lastOperationId], references: [id], onDelete: SetNull)
  games                QuestValorantSeriesGame[]
  operations           QuestValorantOperation[]

  @@index([bindingAId])
  @@index([bindingBId])
  @@index([status])
  @@index([valorantSeriesUuid])
  @@map("quest_valorant_series")
}

model QuestValorantSeriesGame {
  id            String              @id @default(uuid()) @db.Uuid
  questSeriesId String              @map("quest_series_id") @db.Uuid
  gameNumber    Int                 @map("game_number")
  matchId       String              @map("match_id")
  teamASide     ValorantGameSide    @map("team_a_side")
  teamBSide     ValorantGameSide    @map("team_b_side")
  mapName       String?             @map("map_name")
  createdAt     DateTime            @default(now()) @map("created_at")
  updatedAt     DateTime            @updatedAt @map("updated_at")
  questSeries   QuestValorantSeries @relation(fields: [questSeriesId], references: [id], onDelete: Cascade)

  @@unique([questSeriesId, gameNumber])
  @@unique([matchId])
  @@map("quest_valorant_series_games")
}

model QuestValorantMatch {
  id            String   @id @default(uuid()) @db.Uuid
  matchId       String   @unique @map("match_id")
  henrikMatchId String   @unique @map("henrik_match_id")
  mapName       String   @map("map_name")
  startedAt     DateTime @map("started_at")
  mode          String?
  queue         String?
  redScore      Int?     @map("red_score")
  blueScore     Int?     @map("blue_score")
  winningSide   String?  @map("winning_side")
  rosterSummary Json?    @map("roster_summary")
  lastSyncedAt  DateTime @default(now()) @map("last_synced_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([startedAt])
  @@map("quest_valorant_matches")
}

model QuestValorantOperation {
  id               String                  @id @default(uuid()) @db.Uuid
  operationId      String                  @unique @map("operation_id")
  type             ValorantOperationType
  externalKey      String?                 @map("external_key")
  questSeriesId    String?                 @map("quest_series_id") @db.Uuid
  status           ValorantOperationStatus @default(pending)
  fastapiRequestId String?                 @map("fastapi_request_id")
  requestBodyHash  String?                 @map("request_body_hash")
  responseCode     Int?                    @map("response_code")
  errorCode        String?                 @map("error_code")
  responseSummary  Json?                   @map("response_summary")
  createdAt        DateTime                @default(now()) @map("created_at")
  updatedAt        DateTime                @updatedAt @map("updated_at")
  questSeries      QuestValorantSeries?    @relation(fields: [questSeriesId], references: [id], onDelete: SetNull)
  seriesLastOp     QuestValorantSeries?    @relation("ValorantSeriesLastOperation")

  @@index([status])
  @@index([questSeriesId])
  @@index([type, status])
  @@map("quest_valorant_operations")
}
```

Add the back-relations to `User` (after `auditLogs AuditLog[]` L255):

```prisma
  valorantBindings       ValorantTeamBinding[]   @relation("ValorantBindingBoundBy")
  valorantSeriesFinalized QuestValorantSeries[]  @relation("ValorantSeriesFinalizer")
```

Add the back-relation to `SavedTeam` (after `registrations` L1146):

```prisma
  valorantBindings      ValorantTeamBinding[]
```

- [ ] **Step 4: Validate and generate the migration**

```bash
cd backend
npx prisma validate
npx prisma migrate dev --create-only --name add_valorant_bindings_series_operations
```

Expected: `npx prisma validate` passes; `migrate dev --create-only` prints `Migration ... created` with `CREATE TYPE "ValorantBindingStatus" ...` etc. and `CREATE TABLE "valorant_team_bindings" ...`.

- [ ] **Step 5: Append the raw SQL (partial index, trigger, RLS)**

Append to `backend/prisma/migrations/<ts>_add_valorant_bindings_series_operations/migration.sql` (Prisma cannot express partial indexes or triggers; RLS follows the `20260812120000_add_event_photo_albums` pattern):

```sql
-- One ACTIVE binding per SavedTeam (partial unique index; Prisma cannot express it).
CREATE UNIQUE INDEX "valorant_team_bindings_active_saved_team_idx"
ON "valorant_team_bindings"("saved_team_id")
WHERE status = 'active';

-- Bypassed-deletion safety net: a raw DELETE on saved_teams must detach any
-- active binding (the FK SetNull only nulls saved_team_id).
CREATE FUNCTION public.detach_valorant_bindings_on_saved_team_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "valorant_team_bindings"
     SET status = 'detached', detached_at = now()
   WHERE saved_team_id = OLD.id AND status = 'active';
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_detach_valorant_bindings_on_saved_team_delete
BEFORE DELETE ON "saved_teams"
FOR EACH ROW
EXECUTE FUNCTION public.detach_valorant_bindings_on_saved_team_delete();

ALTER TABLE public."valorant_team_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_series_games" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quest_valorant_operations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public."valorant_team_bindings",
  public."quest_valorant_series",
  public."quest_valorant_series_games",
  public."quest_valorant_matches",
  public."quest_valorant_operations"
FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public."valorant_team_bindings", public."quest_valorant_series", public."quest_valorant_series_games", public."quest_valorant_matches", public."quest_valorant_operations" FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;
```

- [ ] **Step 6: Apply the migration and regenerate the client**

```bash
npx prisma migrate dev
npm run prisma:security:verify
npm run prisma:migrate:status
```

Expected: `migrate dev` applies and prints "Now using database"; `prisma:security:verify` exits 0 (no "Public tables without RLS", no protected-role grants); `prisma:migrate:status` reports "Database schema is up to date".

**Migration/rollback constraints (record in commit):** this migration is purely additive (new enum types, tables, index, trigger, RLS). Rollback = revert the app deployment; the new tables are inert to the previous version. Dropping these tables would be a separate, deliberate destructive migration (§7.3). Do not run `prisma migrate reset` / `db drop` (Global Constraint 3).

- [ ] **Step 7: Run to verify the gate passes**

Run: `npm run test:integration`
Expected: PASS — the RLS/tables test now finds 5 tables with `rls=true`.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/generated/prisma backend/tests/database-integration.test.js
git commit -m "feat(valorant): add public-schema binding, series, match projection, and operation ledger models"
```

---

### Task 3: HMAC service-auth token module

**Files:**
- Create: `backend/src/modules/valorant/valorant.auth.js`
- Create: `backend/tests/valorant.auth.test.js`

**Interfaces:**
- Consumes: `env` from `../../config/env` (Task 1), `node:crypto`.
- Produces (Task 4 consumes): `signServiceToken({ actorUserId, operationId, now = Date.now(), ttlSeconds = 300, kid = env.VALORANT_SERVICE_KEY_ID, secret = env.VALORANT_SERVICE_SECRET, issuer = env.VALORANT_SERVICE_ISSUER, audience = env.VALORANT_SERVICE_AUDIENCE })` → JWT string; `buildServiceAuthHeaders({ actorUserId, operationId, externalKey = null })` → `{ Authorization, "X-Quest-Operation-Id", "Idempotency-Key"? }`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/valorant.auth.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const authPath = path.join(__dirname, "../src/modules/valorant/valorant.auth.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const envMock = { env: {
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_SERVICE_ISSUER: "quest-esports",
  VALORANT_SERVICE_AUDIENCE: "valorant-platform",
} };

const decodePart = (token, index) =>
  JSON.parse(Buffer.from(token.split(".")[index], "base64url").toString("utf8"));

test("signServiceToken produces a signed JWT with the expected claims", () => {
  const { module: auth, restore } = loadModuleWithMocks(authPath, { [envPath]: envMock });
  try {
    const now = 1_700_000_000_000;
    const token = auth.signServiceToken({
      actorUserId: "user-1",
      operationId: "op-1",
      now,
      ttlSeconds: 300,
    });

    const [header, payload, signature] = token.split(".");
    assert.deepEqual(decodePart(token, 0), { alg: "HS256", typ: "JWT", kid: "kid-1" });
    assert.deepEqual(decodePart(token, 1), {
      iss: "quest-esports",
      aud: "valorant-platform",
      sub: "user-1",
      operation_id: "op-1",
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000) - 30,
      exp: Math.floor(now / 1000) + 300,
    });

    const expectedSignature = crypto
      .createHmac("sha256", "x".repeat(64))
      .update(`${header}.${payload}`)
      .digest("base64url");
    assert.equal(signature, expectedSignature);
  } finally {
    restore();
  }
});

test("buildServiceAuthHeaders attaches the bearer, operation id, and idempotency key", () => {
  const { module: auth, restore } = loadModuleWithMocks(authPath, { [envPath]: envMock });
  try {
    const headers = auth.buildServiceAuthHeaders({
      actorUserId: "user-1",
      operationId: "op-1",
      externalKey: "external-key-1",
    });
    assert.match(headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(headers["X-Quest-Operation-Id"], "op-1");
    assert.equal(headers["Idempotency-Key"], "external-key-1");

    const withoutKey = auth.buildServiceAuthHeaders({ actorUserId: "user-1", operationId: "op-2" });
    assert.equal("Idempotency-Key" in withoutKey, false);
    assert.equal(withoutKey["X-Quest-Operation-Id"], "op-2");
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/valorant.auth.test.js`
Expected: FAIL — `Cannot find module '../src/modules/valorant/valorant.auth.js'`.

- [ ] **Step 3: Implement**

Create `backend/src/modules/valorant/valorant.auth.js`:

```js
const crypto = require("crypto");
const { env } = require("../../config/env");

const TOKEN_TTL_SECONDS = 300;
const ALLOWED_CLOCK_SKEW_SECONDS = 30;
const b64url = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const signServiceToken = ({
  actorUserId,
  operationId,
  now = Date.now(),
  ttlSeconds = TOKEN_TTL_SECONDS,
  kid = env.VALORANT_SERVICE_KEY_ID,
  secret = env.VALORANT_SERVICE_SECRET,
  issuer = env.VALORANT_SERVICE_ISSUER,
  audience = env.VALORANT_SERVICE_AUDIENCE,
}) => {
  const iat = Math.floor(now / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT", kid });
  const payload = b64url({
    iss: issuer,
    aud: audience,
    sub: actorUserId,
    operation_id: operationId,
    iat,
    nbf: iat - ALLOWED_CLOCK_SKEW_SECONDS,
    exp: iat + ttlSeconds,
  });
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
};

const buildServiceAuthHeaders = ({ actorUserId, operationId, externalKey = null }) => {
  const headers = {
    Authorization: `Bearer ${signServiceToken({ actorUserId, operationId })}`,
    "X-Quest-Operation-Id": operationId,
  };
  if (externalKey) {
    headers["Idempotency-Key"] = externalKey;
  }
  return headers;
};

module.exports = {
  signServiceToken,
  buildServiceAuthHeaders,
  TOKEN_TTL_SECONDS,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/valorant.auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/valorant/valorant.auth.js backend/tests/valorant.auth.test.js
git commit -m "feat(valorant): sign HMAC service-auth bearer tokens and build propagation headers"
```

---

### Task 4: Internal FastAPI HTTP client and error mapping

**Files:**
- Create: `backend/src/modules/valorant/valorant.client.js`
- Create: `backend/src/modules/valorant/valorant.mapper.js`
- Create: `backend/tests/valorant.client.test.js`
- Create: `backend/tests/valorant.mapper.test.js`
- Create: `backend/tests/fixtures/valorant/` fixture files (recorded FastAPI responses)

**Interfaces:**
- Consumes: `valorant.auth` (Task 3), `env` (Task 1).
- Produces (Tasks 6–9 consume):
  - `valorantRequest({ method, path, body = null, actorUserId, operationId, externalKey = null, idempotent = false })` → `Promise<{ status, data, requestId }>`; throws `FastApiError` (definitive FastAPI code) or `InternalServiceError` (transport/unknown).
  - `FastApiError` (`.code`, `.status`, `.requestId`, `.responseSummary`), `InternalServiceError` (`.code`, `.status`, `.requestId`).
  - Mappers: `mapMatchCandidate`, `mapMatchDetail`, `mapSeriesView`, `mapGameView`, `mapPreview`, `mapFinalizeResult`, `mapTeamResponse`, `mapRatingEvent`, `mapRankingEntry` — all FastAPI snake_case → Quest camelCase (see shapes below).

**FastAPI contract this task pins (recorded from `valorant-platform-backend`, verified 2026-08-13):**
- Error body shape: `{ "error": { "code", "message", "request_id"? } }`, echoed header `X-Request-ID` (`app/api/errors.py`).
- Observed codes: `ADMIN_AUTH_REQUIRED`, `INVALID_REQUEST`, `INVALID_RIOT_ID`, `PLAYER_NOT_FOUND`, `HENRIK_AUTH_FAILED`, `HENRIK_RATE_LIMITED`, `HENRIK_UNAVAILABLE`, `HENRIK_VALIDATION_ERROR`, `MATCH_NOT_FOUND`, `MATCH_NOT_COMPLETED`, `MATCH_ALREADY_ASSIGNED_TO_SERIES`, `MATCH_REFRESH_REJECTED`, `TEAM_NOT_FOUND`, `TEAM_SLUG_TAKEN`, `SERIES_NOT_FOUND`, `SERIES_INVALID`, `SERIES_ALREADY_FINALIZED`, `RATING_POLICY_REQUIRED`, `INVALID_SIDE_MAPPING`, `INTERNAL_ERROR`. Delta codes `ANCHOR_MISMATCH` (D6) and `BACKDATED_SERIES_REJECTED` (D8) are part of the same contract once shipped.
- `MatchCandidate`: `match_id` (Henrik **text**), `affinity`, `map?`, `started_at?`, `mode?`, `queue?`, `is_completed`, `red_score?`, `blue_score?`, `already_imported` — **no** `winning_side`/roster (`app/schemas/match_search.py`).
- `MatchDetailResponse`: `id` (VAL **UUID**), `henrik_match_id`, `affinity`, `platform`, `map_name`, `mode?`, `queue?`, `started_at`, `is_completed`, `red_score?`, `blue_score?`, `winning_side?`, `players[]` (`puuid, name, tag, side, agent_name?, kills?, deaths?, ...`), `raw_payload_available` (`app/schemas/matches.py`).
- `SeriesView`: `id`, `team_a_id`, `team_b_id`, `format`, `importance`, `status` (`draft|finalized`), `calculated_winner_id?`, `official_winner_id?`, `winner_override_reason?`, `team_a_maps_won`, `team_b_maps_won`, `played_at?`, `finalized_at?`, `rating_mode?`, `games[]` (`app/schemas/series.py`).
- `GameView`: `id`, `game_number`, `match_id`, `map_name?`, `team_a_side`, `team_b_side`, `team_a_rounds`, `team_b_rounds`, `winner_team_id?`.
- `SeriesPreview`: `valid`, `team_a_maps_won`, `team_b_maps_won`, `calculated_winner_id?`, `games[]`, `errors[]`.
- `FinalizeResult`: `series_id`, `status`, `calculated_winner_id?`, `official_winner_id?`, `winner_override_reason?`, `rating_mode?`, `events[]` (`id, run_id, series_id, team_id, elo_before, elo_after, result, sequence, k_factor?, calculation_details{}`), `team_a_current_elo`, `team_b_current_elo`.
- `TeamResponse`: `id`, `name`, `short_name?`, `slug?`, `logo_url?`, `seeding_elo?`, `matches_played`, `series_wins`, `series_losses`, `is_active`.
- Import endpoints: `POST /api/v1/matches/import` (`{ match_id: <henrik text>, affinity }`) returns 201 `created=true` / 200 `created=false` with `MatchDetailResponse`; `GET /api/v1/matches/by-henrik-id/{henrik_match_id}` returns `MatchDetailResponse`.
- ID-naming contract (D10): import/search take the **Henrik text** ID; attach takes the **VAL UUID** (`match_id`).

- [ ] **Step 1: Write the failing client tests**

Create `backend/tests/fixtures/valorant/match-candidate.json`:

```json
{
  "match_id": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  "affinity": "eu",
  "map": "Ascent",
  "started_at": "2026-08-01T14:30:00Z",
  "mode": "Standard",
  "queue": "unrated",
  "is_completed": true,
  "red_score": 13,
  "blue_score": 8,
  "already_imported": false
}
```

Create `backend/tests/fixtures/valorant/series-finalize.json` (recorded `FinalizeResult`):

```json
{
  "series_id": "00000000-0000-4000-8000-00000000000a",
  "status": "finalized",
  "calculated_winner_id": "00000000-0000-4000-8000-00000000000b",
  "official_winner_id": "00000000-0000-4000-8000-00000000000b",
  "winner_override_reason": null,
  "rating_mode": "normal",
  "events": [
    {
      "id": "00000000-0000-4000-8000-00000000000c",
      "run_id": "00000000-0000-4000-8000-00000000000d",
      "series_id": "00000000-0000-4000-8000-00000000000a",
      "team_id": "00000000-0000-4000-8000-00000000000b",
      "elo_before": "1200.00",
      "elo_after": "1218.00",
      "result": "win",
      "sequence": 1,
      "k_factor": "32.00",
      "expected_score": "0.5",
      "performance_multiplier": null,
      "importance_multiplier": "1.00",
      "upset_bonus": null,
      "calculation_details": { "mode": "normal" },
      "created_at": "2026-08-02T19:00:00Z"
    }
  ],
  "team_a_current_elo": 1218,
  "team_b_current_elo": 1180
}
```

Create `backend/tests/valorant.client.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const clientPath = path.join(__dirname, "../src/modules/valorant/valorant.client.js");
const authPath = path.join(__dirname, "../src/modules/valorant/valorant.auth.js");
const envPath = path.join(__dirname, "../src/config/env.js");

const envMock = { env: {
  VALORANT_INTERNAL_BASE_URL: "http://localhost:8000",
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_SERVICE_ISSUER: "quest-esports",
  VALORANT_SERVICE_AUDIENCE: "valorant-platform",
  VALORANT_TIMEOUT_MS: 15000,
  VALORANT_READ_RETRIES: 2,
} };

const authMock = {
  signServiceToken: () => "signed-token",
  buildServiceAuthHeaders: ({ operationId, externalKey }) => ({
    Authorization: "Bearer signed-token",
    "X-Quest-Operation-Id": operationId,
    ...(externalKey ? { "Idempotency-Key": externalKey } : {}),
  }),
};

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  json: async () => body,
});

const loadClient = () => loadModuleWithMocks(clientPath, {
  [envPath]: envMock,
  [authPath]: authMock,
});

test("valorantRequest signs headers and parses a 2xx response", async () => {
  let capturedHeaders;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return jsonResponse(200, { id: "team-1" }, { "X-Request-ID": "fastapi-req-1" });
  };
  try {
    const { module: client } = loadClient();
    const result = await client.valorantRequest({
      method: "POST",
      path: "/api/v1/teams",
      body: { name: "Quest Five" },
      actorUserId: "user-1",
      operationId: "op-1",
      externalKey: "saved-team-1",
      idempotent: true,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { id: "team-1" });
    assert.equal(result.requestId, "fastapi-req-1");
    assert.equal(capturedHeaders["X-Quest-Operation-Id"], "op-1");
    assert.equal(capturedHeaders["Idempotency-Key"], "saved-team-1");
    assert.match(capturedHeaders.Authorization, /^Bearer signed-token$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest maps a documented FastAPI error code to FastApiError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(409, {
    error: { code: "SERIES_ALREADY_FINALIZED", message: "series already finalized" },
  }, { "X-Request-ID": "fastapi-req-2" });
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "POST", path: "/api/v1/series/x/finalize", actorUserId: "user-1", operationId: "op-2" }),
      (error) => error instanceof client.FastApiError
        && error.code === "SERIES_ALREADY_FINALIZED"
        && error.status === 409
        && error.requestId === "fastapi-req-2",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest classifies a transport failure as InternalServiceError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "POST", path: "/api/v1/series/x/finalize", actorUserId: "user-1", operationId: "op-3" }),
      (error) => error instanceof client.InternalServiceError && error.code === "valorant_unreachable",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest never retries mutations but retries idempotent reads on 5xx", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.push(1);
    return jsonResponse(503, { error: { code: "INTERNAL_ERROR", message: "boom" } });
  };
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "DELETE", path: "/api/v1/series/x", actorUserId: "user-1", operationId: "op-4" }),
    );
    assert.equal(calls.length, 1, "mutations must not be retried");

    calls.length = 0;
    await assert.rejects(
      client.valorantRequest({ method: "GET", path: "/api/v1/teams", actorUserId: "user-1", operationId: "op-5", idempotent: true }),
    );
    assert.equal(calls.length, 3, "idempotent reads retry up to VALORANT_READ_RETRIES+1 attempts");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valorantRequest surfaces a documented 401 as FastApiError, not an internal error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(401, {
    error: { code: "ADMIN_AUTH_REQUIRED", message: "admin key required" },
  });
  try {
    const { module: client } = loadClient();
    await assert.rejects(
      client.valorantRequest({ method: "GET", path: "/api/v1/teams", actorUserId: "user-1", operationId: "op-6" }),
      (error) => error instanceof client.FastApiError && error.code === "ADMIN_AUTH_REQUIRED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the client tests to verify they fail**

Run: `node --test tests/valorant.client.test.js`
Expected: FAIL — `Cannot find module '../src/modules/valorant/valorant.client.js'`.

- [ ] **Step 3: Implement the client**

Create `backend/src/modules/valorant/valorant.client.js`:

```js
const { env } = require("../../config/env");
const { buildServiceAuthHeaders } = require("./valorant.auth");

const CONNECT_TIMEOUT_MS = 10000;
const RETRY_BASE_DELAY_MS = 500;

class FastApiError extends Error {
  constructor(message, { code, status, requestId = null, responseSummary = null } = {}) {
    super(message);
    this.name = "FastApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.responseSummary = responseSummary;
  }
}

class InternalServiceError extends Error {
  constructor(message, { code = "valorant_unreachable", status = 502, requestId = null } = {}) {
    super(message);
    this.name = "InternalServiceError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

// Quest surface for every observed FastAPI error code (spec §6.5). Add a row
// only when a new code is observed and fixture-recorded — never by assumption.
const VALORANT_ERROR_MESSAGES = {
  ADMIN_AUTH_REQUIRED: "VALORANT platform rejected the request (service auth)",
  INVALID_REQUEST: "Invalid request — check the form values",
  INVALID_RIOT_ID: "Invalid Riot ID or player identifier",
  PLAYER_NOT_FOUND: "Riot ID could not be resolved",
  PLAYER_REGION_UNKNOWN: "Riot ID could not be resolved",
  HENRIK_AUTH_FAILED: "VALORANT provider auth failed — contact admin",
  HENRIK_RATE_LIMITED: "VALORANT provider is rate limited — retry shortly",
  HENRIK_UNAVAILABLE: "VALORANT platform unavailable — contact admin",
  HENRIK_VALIDATION_ERROR: "VALORANT provider rejected the search filters",
  MATCH_NOT_FOUND: "Match not found",
  MATCH_NOT_COMPLETED: "Match is not completed",
  MATCH_ALREADY_ASSIGNED_TO_SERIES: "This match is already used in another series",
  MATCH_REFRESH_REJECTED: "This match cannot be refreshed (finalized series)",
  TEAM_NOT_FOUND: "VALORANT team not found",
  TEAM_SLUG_TAKEN: "Team slug already taken",
  SERIES_NOT_FOUND: "Series not found",
  SERIES_INVALID: "Series shape is invalid",
  SERIES_ALREADY_FINALIZED: "Series already finalized",
  RATING_POLICY_REQUIRED: "Choose an explicit rating policy and reason",
  INVALID_SIDE_MAPPING: "Invalid side mapping",
  ANCHOR_MISMATCH: "Anchor player not verified on one side of a map — override required",
  BACKDATED_SERIES_REJECTED: "Cannot rate a series older than the latest rated series",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const valorantRequest = async ({
  method,
  path,
  body = null,
  actorUserId,
  operationId,
  externalKey = null,
  idempotent = false,
}) => {
  const baseUrl = env.VALORANT_INTERNAL_BASE_URL;
  if (!baseUrl) {
    throw new InternalServiceError("VALORANT internal service is not configured.", {
      code: "valorant_not_configured",
      status: 503,
    });
  }

  const headers = {
    ...buildServiceAuthHeaders({ actorUserId, operationId, externalKey }),
    "Content-Type": "application/json",
  };
  const readTimeoutMs = env.VALORANT_TIMEOUT_MS || 15000;
  const maxAttempts = idempotent ? 1 + env.VALORANT_READ_RETRIES : 1;
  const url = `${baseUrl}${path}`;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt < maxAttempts && error?.name !== "AbortError") {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw new InternalServiceError("VALORANT platform could not be reached.", {
        code: "valorant_unreachable",
        status: 502,
      });
    } finally {
      clearTimeout(connectTimer);
    }

    const readTimer = setTimeout(() => controller.abort(), readTimeoutMs);
    let payload = null;
    try {
      const text = await response.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
    } finally {
      clearTimeout(readTimer);
    }

    const requestId = response.headers.get("x-request-id") || null;

    if (response.ok) {
      return { status: response.status, data: payload, requestId };
    }

    const errorCode = payload?.error?.code;
    if (typeof errorCode === "string") {
      throw new FastApiError(
        VALORANT_ERROR_MESSAGES[errorCode] || payload?.error?.message || "VALORANT platform rejected the request.",
        {
          code: errorCode,
          status: response.status,
          requestId,
          responseSummary: { code: errorCode, message: payload?.error?.message },
        },
      );
    }

    const hasRetryAfter = Boolean(response.headers.get("retry-after"));
    const retryable = (response.status === 429 && hasRetryAfter) || response.status >= 500;
    if (attempt < maxAttempts && retryable) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    throw new InternalServiceError("VALORANT platform returned an error.", {
      code: "valorant_upstream_error",
      status: 502,
      requestId,
    });
  }
};

module.exports = {
  valorantRequest,
  FastApiError,
  InternalServiceError,
  VALORANT_ERROR_MESSAGES,
};
```

- [ ] **Step 4: Run the client tests to verify they pass**

Run: `node --test tests/valorant.client.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing mapper tests**

Create `backend/tests/valorant.mapper.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const mapperPath = path.join(__dirname, "../src/modules/valorant/valorant.mapper.js");

const loadMapper = () => loadModuleWithMocks(mapperPath, {});

test("mapMatchCandidate keeps only the fields the current MatchCandidate returns", () => {
  const candidate = require("./fixtures/valorant/match-candidate.json");
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapMatchCandidate(candidate);
  assert.deepEqual(mapped, {
    henrikMatchId: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
    affinity: "eu",
    map: "Ascent",
    startedAt: "2026-08-01T14:30:00Z",
    mode: "Standard",
    queue: "unrated",
    isCompleted: true,
    redScore: 13,
    blueScore: 8,
    alreadyImported: false,
  });
  assert.equal("winningSide" in mapped, false);
  assert.equal("players" in mapped, false);
});

test("mapSeriesView maps a FastAPI draft series with games", () => {
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapSeriesView({
    id: "00000000-0000-4000-8000-00000000000a",
    team_a_id: "00000000-0000-4000-8000-00000000000b",
    team_b_id: "00000000-0000-4000-8000-00000000000c",
    format: "bo3",
    importance: "regular",
    status: "draft",
    team_a_maps_won: 0,
    team_b_maps_won: 0,
    played_at: "2026-08-02T18:00:00Z",
    games: [{
      id: "00000000-0000-4000-8000-00000000000d",
      game_number: 1,
      match_id: "00000000-0000-4000-8000-00000000000e",
      map_name: "Ascent",
      team_a_side: "red",
      team_b_side: "blue",
      team_a_rounds: 13,
      team_b_rounds: 8,
      winner_team_id: "00000000-0000-4000-8000-00000000000b",
    }],
  });
  assert.equal(mapped.id, "00000000-0000-4000-8000-00000000000a");
  assert.equal(mapped.teamAId, "00000000-0000-4000-8000-00000000000b");
  assert.equal(mapped.teamBId, "00000000-0000-4000-8000-00000000000c");
  assert.equal(mapped.status, "draft");
  assert.equal(mapped.games[0].gameNumber, 1);
  assert.equal(mapped.games[0].matchId, "00000000-0000-4000-8000-00000000000e");
  assert.equal(mapped.games[0].teamASide, "red");
  assert.equal(mapped.games[0].winnerTeamId, "00000000-0000-4000-8000-00000000000b");
});

test("mapFinalizeResult maps the recorded FinalizeResult fixture", () => {
  const fixture = require("./fixtures/valorant/series-finalize.json");
  const { module: mapper } = loadMapper();
  const mapped = mapper.mapFinalizeResult(fixture);
  assert.equal(mapped.seriesId, fixture.series_id);
  assert.equal(mapped.status, "finalized");
  assert.equal(mapped.ratingMode, "normal");
  assert.equal(mapped.events.length, 1);
  assert.equal(mapped.events[0].eloBefore, "1200.00");
  assert.equal(mapped.events[0].eloAfter, "1218.00");
  assert.equal(mapped.events[0].calculationDetails.mode, "normal");
  assert.equal(mapped.teamACurrentElo, 1218);
  assert.equal(mapped.teamBCurrentElo, 1180);
});
```

- [ ] **Step 6: Run mapper tests to verify they fail**

Run: `node --test tests/valorant.mapper.test.js`
Expected: FAIL — `Cannot find module '../src/modules/valorant/valorant.mapper.js'`.

- [ ] **Step 7: Implement the mapper**

Create `backend/src/modules/valorant/valorant.mapper.js`:

```js
// FastAPI snake_case payloads -> Quest camelCase projections (spec §6.4).
// Field names come from the recorded contract (app/schemas/*.py); never invent fields.

const mapMatchCandidate = (candidate) => ({
  henrikMatchId: candidate.match_id,
  affinity: candidate.affinity,
  map: candidate.map ?? null,
  startedAt: candidate.started_at ?? null,
  mode: candidate.mode ?? null,
  queue: candidate.queue ?? null,
  isCompleted: candidate.is_completed,
  redScore: candidate.red_score ?? null,
  blueScore: candidate.blue_score ?? null,
  alreadyImported: candidate.already_imported,
});

const mapMatchPlayer = (player) => ({
  puuid: player.puuid,
  name: player.name,
  tag: player.tag,
  side: player.side,
  agentName: player.agent_name ?? null,
  kills: player.kills ?? null,
  deaths: player.deaths ?? null,
  assists: player.assists ?? null,
});

const mapMatchDetail = (detail) => ({
  matchId: detail.id,
  henrikMatchId: detail.henrik_match_id,
  affinity: detail.affinity,
  platform: detail.platform,
  mapName: detail.map_name,
  mode: detail.mode ?? null,
  queue: detail.queue ?? null,
  startedAt: detail.started_at,
  isCompleted: detail.is_completed,
  redScore: detail.red_score ?? null,
  blueScore: detail.blue_score ?? null,
  winningSide: detail.winning_side ?? null,
  players: (detail.players || []).map(mapMatchPlayer),
  rawPayloadAvailable: detail.raw_payload_available,
});

const mapGameView = (game) => ({
  id: game.id,
  gameNumber: game.game_number,
  matchId: game.match_id,
  mapName: game.map_name ?? null,
  teamASide: game.team_a_side,
  teamBSide: game.team_b_side,
  teamARounds: game.team_a_rounds,
  teamBRounds: game.team_b_rounds,
  winnerTeamId: game.winner_team_id ?? null,
});

const mapSeriesView = (series) => ({
  id: series.id,
  teamAId: series.team_a_id,
  teamBId: series.team_b_id,
  format: series.format,
  importance: series.importance,
  status: series.status,
  calculatedWinnerId: series.calculated_winner_id ?? null,
  officialWinnerId: series.official_winner_id ?? null,
  winnerOverrideReason: series.winner_override_reason ?? null,
  teamAMapsWon: series.team_a_maps_won,
  teamBMapsWon: series.team_b_maps_won,
  playedAt: series.played_at ?? null,
  finalizedAt: series.finalized_at ?? null,
  ratingMode: series.rating_mode ?? null,
  notes: series.notes ?? null,
  games: (series.games || []).map(mapGameView),
});

const mapPreview = (preview) => ({
  valid: preview.valid,
  teamAMapsWon: preview.team_a_maps_won,
  teamBMapsWon: preview.team_b_maps_won,
  calculatedWinnerId: preview.calculated_winner_id ?? null,
  games: (preview.games || []).map(mapGameView),
  errors: preview.errors || [],
});

const mapRatingEvent = (event) => ({
  id: event.id,
  runId: event.run_id,
  seriesId: event.series_id,
  teamId: event.team_id,
  eloBefore: event.elo_before,
  eloAfter: event.elo_after,
  result: event.result,
  sequence: event.sequence,
  kFactor: event.k_factor ?? null,
  calculationDetails: event.calculation_details || {},
});

const mapFinalizeResult = (result) => ({
  seriesId: result.series_id,
  status: result.status,
  calculatedWinnerId: result.calculated_winner_id ?? null,
  officialWinnerId: result.official_winner_id ?? null,
  winnerOverrideReason: result.winner_override_reason ?? null,
  ratingMode: result.rating_mode ?? null,
  events: (result.events || []).map(mapRatingEvent),
  teamACurrentElo: result.team_a_current_elo,
  teamBCurrentElo: result.team_b_current_elo,
});

const mapTeamResponse = (team) => ({
  id: team.id,
  name: team.name,
  shortName: team.short_name ?? null,
  slug: team.slug ?? null,
  logoUrl: team.logo_url ?? null,
  matchesPlayed: team.matches_played,
  seriesWins: team.series_wins,
  seriesLosses: team.series_losses,
  isActive: team.is_active,
});

const mapRankingEntry = (entry) => ({
  teamId: entry.team_id,
  rank: entry.rank,
  elo: entry.elo,
  seriesWins: entry.series_wins,
  seriesLosses: entry.series_losses,
});

module.exports = {
  mapMatchCandidate,
  mapMatchDetail,
  mapGameView,
  mapSeriesView,
  mapPreview,
  mapRatingEvent,
  mapFinalizeResult,
  mapTeamResponse,
  mapRankingEntry,
};
```

- [ ] **Step 8: Run mapper tests to verify they pass**

Run: `node --test tests/valorant.mapper.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/valorant/valorant.client.js backend/src/modules/valorant/valorant.mapper.js backend/tests/valorant.client.test.js backend/tests/valorant.mapper.test.js backend/tests/fixtures/valorant
git commit -m "feat(valorant): add internal FastAPI HTTP client with bounded retries and error mapping"
```

---

### Task 5: Riot ID and external-key validation

**Files:**
- Create: `backend/src/modules/valorant/valorant.validation.js`
- Create: `backend/tests/valorant.validation.test.js`

**Interfaces:**
- Consumes: `HttpError` (`../../lib/http-error`).
- Produces (Task 8 consumes): `parseRiotId(value)` → `{ name, tag }` (throws `HttpError(400, "Invalid Riot ID — expected Name#Tag.")`); `normalizeRiotId({ name, tag })` → trimmed `{ name, tag }`; `generateExternalKey()` → `crypto.randomUUID()`; `assertSupportedFormat(value)` → throws `HttpError(400, "Unsupported VALORANT series format.")` unless `bo1|bo3|bo5`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/valorant.validation.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const validationPath = path.join(__dirname, "../src/modules/valorant/valorant.validation.js");
const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
const { HttpError } = require(httpErrorPath);

const loadValidation = () => loadModuleWithMocks(validationPath, {
  [httpErrorPath]: { HttpError },
});

test("parseRiotId accepts a Name#Tag and rejects malformed values", () => {
  const { module: validation } = loadValidation();
  assert.deepEqual(validation.parseRiotId("TenZ#SEN"), { name: "TenZ", tag: "SEN" });
  assert.deepEqual(validation.parseRiotId("  Demon1#NA "), { name: "Demon1", tag: "NA" });
  for (const bad of ["", "NoTag", "a#b#c", "x#y#", "#tag", "name#", "#".repeat(40)]) {
    assert.throws(() => validation.parseRiotId(bad), (error) =>
      error instanceof HttpError && error.statusCode === 400);
  }
});

test("normalizeRiotId trims name and tag and rejects oversized values", () => {
  const { module: validation } = loadValidation();
  assert.deepEqual(validation.normalizeRiotId({ name: " TenZ ", tag: " SEN " }), { name: "TenZ", tag: "SEN" });
  assert.throws(() => validation.normalizeRiotId({ name: "x".repeat(33), tag: "SEN" }), HttpError);
  assert.throws(() => validation.normalizeRiotId({ name: "TenZ", tag: "y".repeat(17) }), HttpError);
});

test("generateExternalKey returns a uuid-shaped string", () => {
  const { module: validation } = loadValidation();
  assert.match(validation.generateExternalKey(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test("assertSupportedFormat accepts bo1/bo3/bo5 and rejects everything else", () => {
  const { module: validation } = loadValidation();
  for (const format of ["bo1", "bo3", "bo5"]) validation.assertSupportedFormat(format);
  assert.throws(() => validation.assertSupportedFormat("bo7"), HttpError);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/valorant.validation.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `backend/src/modules/valorant/valorant.validation.js`:

```js
const crypto = require("crypto");
const { HttpError } = require("../../lib/http-error");

const RIOT_ID_PATTERN = /^([^#\s]{1,32})#([^#\s]{1,16})$/;
const SUPPORTED_FORMATS = new Set(["bo1", "bo3", "bo5"]);

const normalizeRiotId = ({ name, tag }) => {
  const cleanedName = String(name || "").trim();
  const cleanedTag = String(tag || "").trim();
  if (!RIOT_ID_PATTERN.test(`${cleanedName}#${cleanedTag}`)) {
    throw new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
  }
  return { name: cleanedName, tag: cleanedTag };
};

const parseRiotId = (value) => {
  const normalized = String(value || "").trim();
  const match = RIOT_ID_PATTERN.exec(normalized);
  if (!match) {
    throw new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
  }
  return { name: match[1], tag: match[2] };
};

const generateExternalKey = () => crypto.randomUUID();

const assertSupportedFormat = (format) => {
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new HttpError(400, "Unsupported VALORANT series format.");
  }
};

module.exports = {
  parseRiotId,
  normalizeRiotId,
  generateExternalKey,
  assertSupportedFormat,
  SUPPORTED_FORMATS,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/valorant.validation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/valorant/valorant.validation.js backend/tests/valorant.validation.test.js
git commit -m "feat(valorant): add Riot ID, external key, and format validation rules"
```


---

### Task 6: Operation ledger and binding orchestration

**Files:**
- Create: `backend/src/modules/valorant/valorant.service.js` (ledger helpers + binding functions in this file; the rest of the service is added in Tasks 7–9)
- Create: `backend/tests/valorant.service.test.js` (ledger + binding cases in this task; extended in Tasks 7–9)

**Interfaces:**
- Consumes: `prisma` (`../../lib/prisma`), `valorantRequest`/`FastApiError`/`InternalServiceError` (`./valorant.client`), `mapTeamResponse` (`./valorant.mapper`), `HttpError`, `env`.
- Produces (Tasks 7–9 consume): `createOperation({ type, externalKey = null, questSeriesId = null, actorUserId, requestBody = null })` → `QuestValorantOperation` (status `pending`, `operationId` = `crypto.randomUUID()`, `requestBodyHash` = sha256 hex); `markOperationSucceeded(operationId, { status, requestId, data })`; `markOperationFailed(operationId, error)` (FastApiError → `failed` + `errorCode`; else → `reconciliation_required`); `markOperationReconciliationRequired(operationId, error)`; `bindTeam({ savedTeamId, actorUserId, requestId, ipAddress })` → binding row; `detachBinding({ bindingId, actorUserId, requestId, ipAddress })` → updated binding row; `listBindings()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/valorant.service.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/valorant/valorant.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const clientPath = path.join(__dirname, "../src/modules/valorant/valorant.client.js");
const mapperPath = path.join(__dirname, "../src/modules/valorant/valorant.mapper.js");
const validationPath = path.join(__dirname, "../src/modules/valorant/valorant.validation.js");
const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
const { HttpError } = require(httpErrorPath);
const envPath = path.join(__dirname, "../src/config/env.js");

const envMock = { env: {
  VALORANT_INTERNAL_BASE_URL: "http://localhost:8000",
  VALORANT_SERVICE_SECRET: "x".repeat(64),
  VALORANT_SERVICE_KEY_ID: "kid-1",
  VALORANT_SERVICE_ISSUER: "quest-esports",
  VALORANT_SERVICE_AUDIENCE: "valorant-platform",
  VALORANT_TIMEOUT_MS: 15000,
  VALORANT_READ_RETRIES: 2,
} };

class FastApiError extends Error {
  constructor(message, options) {
    super(message);
    this.name = "FastApiError";
    Object.assign(this, options);
  }
}

class InternalServiceError extends Error {
  constructor(message, options) {
    super(message);
    this.name = "InternalServiceError";
    Object.assign(this, options);
  }
}

const { mapTeamResponse } = require("../src/modules/valorant/valorant.mapper");

test("bindTeam writes an operation and stores the returned VALORANT team UUID on the binding", async () => {
  const savedTeam = { id: "saved-team-1", name: "Quest Five", teamTag: "QF" };
  const existingTeam = {
    id: "val-team-1",
    name: "Quest Five",
    short_name: "QF",
    matches_played: 0,
    series_wins: 0,
    series_losses: 0,
    is_active: true,
  };
  const statuses = [];
  let operationId;
  const prismaMock = {
    prisma: {
      savedTeam: {
        findUnique: async ({ where }) => (where.id === savedTeam.id ? savedTeam : null),
      },
      valorantTeamBinding: {
        findFirst: async () => null,
        create: async ({ data }) => ({ id: "binding-1", ...data }),
      },
      questValorantOperation: {
        create: async ({ data }) => {
          operationId = data.operationId;
          return { id: "op-row-1", ...data };
        },
        update: async ({ where, data }) => {
          statuses.push(data.status);
          return { id: where.id, ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body, externalKey, idempotent }) => {
      assert.equal(path, "/api/v1/teams");
      assert.equal(body.quest_saved_team_id, "saved-team-1");
      assert.equal(externalKey, "saved-team-1");
      assert.equal(idempotent, true);
      return { status: 200, data: existingTeam, requestId: "fastapi-req-1" };
    },
  };

  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const binding = await service.bindTeam({ savedTeamId: savedTeam.id, actorUserId: "user-1", requestId: "req-1", ipAddress: "127.0.0.1" });
    assert.equal(binding.valorantTeamUuid, "val-team-1");
    assert.equal(binding.status, "active");
    assert.equal(binding.boundByUserId, "user-1");
    assert.ok(operationId);
    assert.deepEqual(statuses, ["in_flight", "succeeded"]);
  } finally {
    restore();
  }
});

test("bindTeam refuses a second active binding for the same SavedTeam", async () => {
  const prismaMock = {
    prisma: {
      savedTeam: { findUnique: async () => ({ id: "saved-team-1", name: "Q", teamTag: null }) },
      valorantTeamBinding: { findFirst: async () => ({ id: "binding-1" }) },
      questValorantOperation: {},
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: { valorantRequest: async () => { throw new Error("must not call"); } },
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.bindTeam({ savedTeamId: "saved-team-1", actorUserId: "user-1", requestId: "req-2", ipAddress: "127.0.0.1" }),
      (error) => error instanceof HttpError && error.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test("bindTeam classifies a transport failure as reconciliation_required", async () => {
  const statuses = [];
  const prismaMock = {
    prisma: {
      savedTeam: { findUnique: async () => ({ id: "saved-team-1", name: "Q", teamTag: null }) },
      valorantTeamBinding: { findFirst: async () => null, create: async ({ data }) => ({ id: "b", ...data }) },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-2", ...data }),
        update: async ({ data }) => {
          statuses.push(data.status);
          return { id: "op-row-2", ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async () => { throw new InternalServiceError("down", { code: "valorant_unreachable", status: 502 }); },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.bindTeam({ savedTeamId: "saved-team-1", actorUserId: "user-1", requestId: "req-3", ipAddress: "127.0.0.1" }),
      (error) => error instanceof InternalServiceError,
    );
    assert.deepEqual(statuses, ["in_flight", "reconciliation_required"]);
  } finally {
    restore();
  }
});

test("detachBinding is a Quest-local status change that never calls FastAPI", async () => {
  let clientCalls = 0;
  const prismaMock = {
    prisma: {
      valorantTeamBinding: {
        findUnique: async () => ({ id: "binding-1", savedTeamId: "saved-team-1", valorantTeamUuid: "val-team-1", status: "active" }),
        update: async ({ where, data }) => ({ id: where.id, ...data }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-3", ...data }),
        update: async () => ({}),
      },
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: { valorantRequest: async () => { clientCalls += 1; } },
    [mapperPath]: { mapTeamResponse },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const binding = await service.detachBinding({ bindingId: "binding-1", actorUserId: "user-1", requestId: "req-4", ipAddress: "127.0.0.1" });
    assert.equal(binding.status, "detached");
    assert.ok(binding.detachedAt instanceof Date);
    assert.equal(clientCalls, 0);
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/valorant.service.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ledger and binding functions**

Create `backend/src/modules/valorant/valorant.service.js`:

```js
const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { valorantRequest, FastApiError } = require("./valorant.client");
const { mapTeamResponse } = require("./valorant.mapper");

const hashRequestBody = (body) =>
  crypto.createHash("sha256").update(JSON.stringify(body || {})).digest("hex");

const createOperation = async ({ type, externalKey = null, questSeriesId = null, actorUserId, requestBody = null }) =>
  prisma.questValorantOperation.create({
    data: {
      operationId: crypto.randomUUID(),
      type,
      externalKey,
      questSeriesId,
      status: "pending",
      requestBodyHash: hashRequestBody(requestBody),
    },
  });

const markOperationSucceeded = async (operationId, { status, requestId, data }) =>
  prisma.questValorantOperation.update({
    where: { id: operationId },
    data: { status: "succeeded", responseCode: status, fastapiRequestId: requestId, responseSummary: data || undefined },
  });

const markOperationFailed = async (operationId, error) => {
  if (error instanceof FastApiError) {
    return prisma.questValorantOperation.update({
      where: { id: operationId },
      data: {
        status: "failed",
        responseCode: error.status,
        errorCode: error.code,
        fastapiRequestId: error.requestId,
        responseSummary: error.responseSummary || undefined,
      },
    });
  }
  return prisma.questValorantOperation.update({
    where: { id: operationId },
    data: { status: "reconciliation_required" },
  });
};

const markOperationReconciliationRequired = async (operationId, error) =>
  prisma.questValorantOperation.update({
    where: { id: operationId },
    data: {
      status: "reconciliation_required",
      errorCode: error?.code || "valorant_unreachable",
      fastapiRequestId: error?.requestId || null,
    },
  });

const listBindings = async () =>
  prisma.valorantTeamBinding.findMany({
    include: {
      savedTeam: { select: { id: true, name: true, teamTag: true } },
      boundByUser: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

const bindTeam = async ({ savedTeamId, actorUserId, requestId, ipAddress }) => {
  const savedTeam = await prisma.savedTeam.findUnique({
    where: { id: savedTeamId },
    select: { id: true, name: true, teamTag: true },
  });
  if (!savedTeam) throw new HttpError(404, "Saved team not found.");

  const existingBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId, status: "active" },
    select: { id: true },
  });
  if (existingBinding) {
    throw new HttpError(409, "This team already has an active VALORANT binding.");
  }

  const operation = await createOperation({
    type: "team_bind",
    externalKey: savedTeamId,
    actorUserId,
    requestBody: { saved_team_id: savedTeamId },
  });
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: "/api/v1/teams",
      body: { name: savedTeam.name, short_name: savedTeam.teamTag, quest_saved_team_id: savedTeamId },
      actorUserId,
      operationId: operation.operationId,
      externalKey: savedTeamId,
      idempotent: true,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }

  const team = mapTeamResponse(response.data);
  const binding = await prisma.valorantTeamBinding.create({
    data: {
      savedTeamId,
      valorantTeamUuid: team.id,
      status: "active",
      boundByUserId: actorUserId,
    },
  });
  await markOperationSucceeded(operation.id, response);
  return binding;
};

const detachBinding = async ({ bindingId, actorUserId, requestId, ipAddress }) => {
  const binding = await prisma.valorantTeamBinding.findUnique({
    where: { id: bindingId },
    select: { id: true, savedTeamId: true, valorantTeamUuid: true, status: true },
  });
  if (!binding) throw new HttpError(404, "VALORANT binding not found.");
  if (binding.status === "detached") throw new HttpError(409, "This binding is already detached.");

  const operation = await createOperation({
    type: "team_bind",
    externalKey: binding.savedTeamId || undefined,
    actorUserId,
    requestBody: { action: "detach", binding_id: bindingId },
  });

  const updated = await prisma.valorantTeamBinding.update({
    where: { id: bindingId },
    data: { status: "detached", detachedAt: new Date() },
  });
  await markOperationSucceeded(operation.id, { status: 200, requestId: null, data: { bindingId } });
  return updated;
};

module.exports = {
  createOperation,
  markOperationSucceeded,
  markOperationFailed,
  markOperationReconciliationRequired,
  listBindings,
  bindTeam,
  detachBinding,
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/valorant.service.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/valorant/valorant.service.js backend/tests/valorant.service.test.js
git commit -m "feat(valorant): add operation ledger state machine and team binding orchestration"
```

---

### Task 7: Discovery, match import, and match projection

**Files:**
- Modify: `backend/src/modules/valorant/valorant.service.js` (add `discover`, `importMatch`, `getMatchByHenrikId`, `listMatches`, `upsertMatchProjection`)
- Modify: `backend/tests/valorant.service.test.js` (append cases)

**Interfaces:**
- Consumes: `mapMatchCandidate`, `mapMatchDetail` (Task 4), `parseRiotId` (Task 5), client (Task 4).
- Produces (Task 8 consumes): `discover({ playerA, playerB, pageSize = 10, maxPages = 1, map = null, from = null, actorUserId, requestId })` → `{ players, candidates, search }` (mapped, no `winning_side`/roster); `importMatch({ henrikMatchId, affinity = "eu", actorUserId, requestId, ipAddress })` → `{ match: <mapped detail>, created }` with projection row upserted; `getMatchByHenrikId({ henrikMatchId })`; `listMatches({ cursor = null, limit = 25 })`; internal `upsertMatchProjection(detail)`.

**Contract notes (from §5.2/D11):** candidate detail reuses existing endpoints — `POST /api/v1/matches/import` when not imported (`{ match_id: <henrik text>, affinity }`, 201 `created=true` or 200 `created=false`), `GET /api/v1/matches/by-henrik-id/{henrik_match_id}` when already imported. No candidate is ever auto-imported or auto-attached. Discovery "no overlap" returns `candidates: []` with 200 — not an error. Import is not an operation-ledger mutation in MVP (the operation `type` enum has no import value, spec §4.3); it is a projection sync.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/valorant.service.test.js`:

```js
test("discover proxies the two-player search and maps candidates without winningSide", async () => {
  const candidate = require("./fixtures/valorant/match-candidate.json");
  let capturedBody;
  const prismaMock = { prisma: {} };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      capturedBody = body;
      assert.equal(path, "/api/v1/match-search/two-player");
      return {
        status: 200,
        data: {
          players: { a: { id: "p-a", puuid: "puuid-a", name: "TenZ", tag: "SEN", affinity: "eu" } },
          candidates: [candidate],
        },
        requestId: "fastapi-req-7",
      };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchCandidate: (c) => ({ henrikMatchId: c.match_id, map: c.map, isCompleted: c.is_completed, alreadyImported: c.already_imported }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const result = await service.discover({
      playerA: { name: "TenZ", tag: "SEN" },
      playerB: { name: "Demon1", tag: "NA" },
      pageSize: 10,
      maxPages: 1,
      actorUserId: "user-1",
      requestId: "req-7",
    });
    assert.equal(capturedBody.page_size, 10);
    assert.equal(capturedBody.max_pages, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].henrikMatchId, candidate.match_id);
    assert.equal("winningSide" in result.candidates[0], false);
  } finally {
    restore();
  }
});

test("discover returns an empty list, not an error, when there is no overlap", async () => {
  const prismaMock = { prisma: {} };
  const clientMock = {
    valorantRequest: async () => ({ status: 200, data: { players: {}, candidates: [] }, requestId: "r" }),
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchCandidate: (c) => c },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });
  try {
    const result = await service.discover({
      playerA: { name: "TenZ", tag: "SEN" },
      playerB: { name: "Demon1", tag: "NA" },
      actorUserId: "user-1",
      requestId: "req-8",
    });
    assert.deepEqual(result.candidates, []);
  } finally {
    restore();
  }
});

test("importMatch imports once, upserts the projection, and reports created from the status", async () => {
  const detail = {
    id: "00000000-0000-4000-8000-00000000000e",
    henrik_match_id: "abcdef0123",
    affinity: "eu",
    platform: "pc",
    map_name: "Ascent",
    started_at: "2026-08-01T14:30:00Z",
    is_completed: true,
    red_score: 13,
    blue_score: 8,
    winning_side: "red",
    players: [],
    raw_payload_available: true,
  };
  const upserts = [];
  const prismaMock = {
    prisma: {
      questValorantMatch: {
        upsert: async ({ where, create }) => {
          upserts.push({ where, create });
          return { ...create, id: "projection-1" };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/matches/import");
      assert.equal(body.match_id, detail.henrik_match_id);
      return { status: 201, data: detail, requestId: "fastapi-req-9" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchDetail: (d) => ({ matchId: d.id, henrikMatchId: d.henrik_match_id, mapName: d.map_name, startedAt: d.started_at, winningSide: d.winning_side }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const result = await service.importMatch({ henrikMatchId: detail.henrik_match_id, affinity: "eu", actorUserId: "user-1", requestId: "req-9", ipAddress: "127.0.0.1" });
    assert.equal(result.created, true);
    assert.equal(result.match.henrikMatchId, detail.henrik_match_id);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].create.henrikMatchId, detail.henrik_match_id);
  } finally {
    restore();
  }
});

test("getMatchByHenrikId uses the by-henrik-id endpoint for already-imported matches", async () => {
  const prismaMock = { prisma: {} };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      assert.equal(path, "/api/v1/matches/by-henrik-id/abcdef0123");
      return { status: 200, data: { id: "m-1", henrik_match_id: "abcdef0123", map_name: "Ascent", started_at: "2026-08-01T14:30:00Z", is_completed: true, players: [], raw_payload_available: true }, requestId: "r" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapMatchDetail: (d) => ({ matchId: d.id, mapName: d.map_name }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });
  try {
    const result = await service.getMatchByHenrikId({ henrikMatchId: "abcdef0123" });
    assert.equal(result.matchId, "m-1");
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/valorant.service.test.js`
Expected: FAIL — `service.discover is not a function`.

- [ ] **Step 3: Implement the discovery/import functions**

Append to `backend/src/modules/valorant/valorant.service.js`:

```js
const { mapMatchCandidate, mapMatchDetail } = require("./valorant.mapper");
const { normalizeRiotId } = require("./valorant.validation");

const discover = async ({
  playerA,
  playerB,
  pageSize = 10,
  maxPages = 1,
  map = null,
  from = null,
  actorUserId,
  requestId,
}) => {
  const anchorA = normalizeRiotId(playerA);
  const anchorB = normalizeRiotId(playerB);
  const response = await valorantRequest({
    method: "POST",
    path: "/api/v1/match-search/two-player",
    body: {
      player_a: anchorA,
      player_b: anchorB,
      page_size: pageSize,
      max_pages: maxPages,
      ...(map ? { map } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
    },
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return {
    players: response.data.players || {},
    candidates: (response.data.candidates || []).map(mapMatchCandidate),
    search: response.data.search || { pagesExamined: 0, pageSize },
  };
};

const upsertMatchProjection = (detail) => {
  const mapped = mapMatchDetail(detail);
  return prisma.questValorantMatch.upsert({
    where: { henrikMatchId: mapped.henrikMatchId },
    create: {
      matchId: mapped.matchId,
      henrikMatchId: mapped.henrikMatchId,
      mapName: mapped.mapName,
      startedAt: new Date(mapped.startedAt),
      mode: mapped.mode || undefined,
      queue: mapped.queue || undefined,
      redScore: mapped.redScore ?? undefined,
      blueScore: mapped.blueScore ?? undefined,
      winningSide: mapped.winningSide || undefined,
      rosterSummary: { players: mapped.players },
      lastSyncedAt: new Date(),
    },
    update: {
      matchId: mapped.matchId,
      mapName: mapped.mapName,
      startedAt: new Date(mapped.startedAt),
      mode: mapped.mode || undefined,
      queue: mapped.queue || undefined,
      redScore: mapped.redScore ?? undefined,
      blueScore: mapped.blueScore ?? undefined,
      winningSide: mapped.winningSide || undefined,
      rosterSummary: { players: mapped.players },
      lastSyncedAt: new Date(),
    },
  });
};

const importMatch = async ({ henrikMatchId, affinity = "eu", actorUserId, requestId, ipAddress }) => {
  const response = await valorantRequest({
    method: "POST",
    path: "/api/v1/matches/import",
    body: { match_id: henrikMatchId, affinity },
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  const detail = response.data;
  const created = response.status === 201;
  const projection = await upsertMatchProjection(detail);
  return { match: mapMatchDetail(detail), created, projection };
};

const getMatchByHenrikId = async ({ henrikMatchId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/matches/by-henrik-id/${encodeURIComponent(henrikMatchId)}`,
    actorUserId: null,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return mapMatchDetail(response.data);
};

const listMatches = async ({ cursor = null, limit = 25 } = {}) => {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (limit) query.set("limit", String(limit));
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/matches${query.size ? `?${query}` : ""}`,
    actorUserId: null,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return response.data;
};
```

Add `discover`, `importMatch`, `getMatchByHenrikId`, `listMatches`, `upsertMatchProjection` to the `module.exports` object of `valorant.service.js`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/valorant.service.test.js`
Expected: PASS (Tasks 6 + 7 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/valorant/valorant.service.js backend/tests/valorant.service.test.js
git commit -m "feat(valorant): add two-player discovery proxy, explicit match import, and match projection"
```

---

### Task 8: Series orchestration (create, attach, reorder, remove, delete, preview)

**Files:**
- Modify: `backend/src/modules/valorant/valorant.service.js` (add series functions)
- Modify: `backend/tests/valorant.service.test.js` (append cases)

**Interfaces:**
- Consumes: `assertSupportedFormat`, `generateExternalKey`, `normalizeRiotId` (Task 5), `mapSeriesView`, `mapGameView`, `mapPreview` (Task 4), client (Task 4), ledger helpers (Task 6).
- Produces (Task 9 consumes): `createSeries({ bindingTeamAId, bindingTeamBId, format, playedAt, ratingModePreference = null, anchorPlayerA, anchorPlayerB, actorUserId, requestId, ipAddress })` → `QuestValorantSeries`; `getSeries({ seriesId })`; `listSeries()`; `deleteSeries({ seriesId, actorUserId, requestId, ipAddress })`; `attachGame({ seriesId, gameNumber, matchId, teamASide, actorUserId, requestId, ipAddress })` → `QuestValorantSeriesGame`; `setGameOrder({ seriesId, games, actorUserId, requestId, ipAddress })`; `removeGame({ seriesId, gameId, actorUserId, requestId, ipAddress })`; `previewSeries({ seriesId })`.

**Request/response mapping (spec §5.3–§5.4, §6.4):**
- Create body to FastAPI: `{ team_a_id, team_b_id, format, importance: "regular", played_at: <ISO>, external_quest_series_id: externalKey, anchor_player_a: {name, tag}, anchor_player_b: {name, tag} }`. Idempotency-Key = `externalKey`. Retry with the same key returns the existing series (create-or-get).
- Attach body: `{ match_id: <VAL UUID>, game_number, team_a_side: "red"|"blue" }`; FastAPI derives `team_b_side` and scores (never re-entered). Errors mapped per §6.5 (`MATCH_NOT_FOUND` 404, `MATCH_NOT_COMPLETED` 422, `MATCH_ALREADY_ASSIGNED_TO_SERIES` 409, `SERIES_INVALID` 409, `INVALID_SIDE_MAPPING` 400).
- Reorder: `PUT /api/v1/series/{uuid}/games/order` body `{ games: [{ game_id, game_number }] }` — absolute desired order, converges on retry (delta D9, draft-only).
- Remove: `DELETE /api/v1/series/{uuid}/games/{game_id}` → 204, draft-only.
- Delete draft: `DELETE /api/v1/series/{uuid}` → 204, draft-only. No separate "void".

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/valorant.service.test.js`:

```js
test("createSeries writes an operation, sends external_quest_series_id and anchors, and stores the projection", async () => {
  const seriesView = {
    id: "00000000-0000-4000-8000-00000000000a",
    team_a_id: "val-team-1",
    team_b_id: "val-team-2",
    format: "bo3",
    importance: "regular",
    status: "draft",
    team_a_maps_won: 0,
    team_b_maps_won: 0,
    games: [],
  };
  let sentBody;
  let sentKey;
  const prismaMock = {
    prisma: {
      valorantTeamBinding: {
        findUnique: async ({ where }) => {
          const map = {
            "binding-a": { id: "binding-a", status: "active", valorantTeamUuid: "val-team-1" },
            "binding-b": { id: "binding-b", status: "active", valorantTeamUuid: "val-team-2" },
          };
          return map[where.id] || null;
        },
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-10", ...data }),
        update: async () => ({}),
      },
      questValorantSeries: {
        create: async ({ data }) => ({ id: "quest-series-1", ...data }),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body, externalKey, idempotent }) => {
      assert.equal(path, "/api/v1/series");
      assert.equal(idempotent, true);
      sentBody = body;
      sentKey = externalKey;
      return { status: 201, data: seriesView, requestId: "fastapi-req-10" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapSeriesView: (s) => ({ id: s.id, teamAId: s.team_a_id, teamBId: s.team_b_id, status: s.status, games: [] }) },
    [validationPath]: { assertSupportedFormat: () => {}, generateExternalKey: () => "quest-ext-key-1", normalizeRiotId: (r) => r },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const series = await service.createSeries({
      bindingTeamAId: "binding-a",
      bindingTeamBId: "binding-b",
      format: "bo3",
      playedAt: new Date("2026-08-02T18:00:00Z"),
      anchorPlayerA: { name: "TenZ", tag: "SEN" },
      anchorPlayerB: { name: "Demon1", tag: "NA" },
      actorUserId: "user-1",
      requestId: "req-10",
      ipAddress: "127.0.0.1",
    });
    assert.equal(series.valorantSeriesUuid, seriesView.id);
    assert.equal(series.externalKey, "quest-ext-key-1");
    assert.equal(series.status, "draft");
    assert.equal(sentKey, "quest-ext-key-1");
    assert.equal(sentBody.external_quest_series_id, "quest-ext-key-1");
    assert.deepEqual(sentBody.anchor_player_a, { name: "TenZ", tag: "SEN" });
    assert.equal(sentBody.played_at, "2026-08-02T18:00:00.000Z");
  } finally {
    restore();
  }
});

test("attachGame sends the VAL match UUID as match_id and mirrors the returned game", async () => {
  const gameView = {
    id: "game-1",
    game_number: 1,
    match_id: "00000000-0000-4000-8000-00000000000e",
    map_name: "Ascent",
    team_a_side: "red",
    team_b_side: "blue",
    team_a_rounds: 13,
    team_b_rounds: 8,
    winner_team_id: "val-team-1",
  };
  let sentBody;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "00000000-0000-4000-8000-00000000000a", status: "draft" }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-11", ...data }),
        update: async () => ({}),
      },
      questValorantSeriesGame: {
        create: async ({ data }) => ({ id: "mirror-game-1", ...data }),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/series/00000000-0000-4000-8000-00000000000a/games");
      sentBody = body;
      return { status: 201, data: gameView, requestId: "fastapi-req-11" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {
      mapGameView: (g) => ({ id: g.id, gameNumber: g.game_number, matchId: g.match_id, mapName: g.map_name, teamASide: g.team_a_side, teamBSide: g.team_b_side }),
      mapSeriesView: () => ({}),
    },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const mirrored = await service.attachGame({
      seriesId: "quest-series-1",
      gameNumber: 1,
      matchId: "00000000-0000-4000-8000-00000000000e",
      teamASide: "red",
      actorUserId: "user-1",
      requestId: "req-11",
      ipAddress: "127.0.0.1",
    });
    assert.deepEqual(sentBody, { match_id: "00000000-0000-4000-8000-00000000000e", game_number: 1, team_a_side: "red" });
    assert.equal(mirrored.teamASide, "red");
    assert.equal(mirrored.teamBSide, "blue");
  } finally {
    restore();
  }
});

test("setGameOrder sends the full absolute desired order and converges on retry", async () => {
  let orderBodies = 0;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1", status: "draft" }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-12", ...data }),
        update: async () => ({}),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/games/order");
      orderBodies += 1;
      assert.deepEqual(body.games, [
        { game_id: "g2-uuid", game_number: 1 },
        { game_id: "g1-uuid", game_number: 2 },
      ]);
      return { status: 200, data: [], requestId: "fastapi-req-12" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {},
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const order = [{ gameId: "g2-uuid", gameNumber: 1 }, { gameId: "g1-uuid", gameNumber: 2 }];
    await service.setGameOrder({ seriesId: "quest-series-1", games: order, actorUserId: "user-1", requestId: "req-12", ipAddress: "127.0.0.1" });
    await service.setGameOrder({ seriesId: "quest-series-1", games: order, actorUserId: "user-1", requestId: "req-12b", ipAddress: "127.0.0.1" });
    assert.equal(orderBodies, 2, "the same absolute body converges on retry");
  } finally {
    restore();
  }
});

test("removeGame deletes the mirrored projection after a 204", async () => {
  let deletedGame;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1", status: "draft" }),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-13", ...data }),
        update: async () => ({}),
      },
      questValorantSeriesGame: {
        delete: async ({ where }) => { deletedGame = where.id; return { id: where.id }; },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/games/game-1");
      return { status: 204, data: null, requestId: "fastapi-req-13" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: {},
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await service.removeGame({ seriesId: "quest-series-1", gameId: "game-1", actorUserId: "user-1", requestId: "req-13", ipAddress: "127.0.0.1" });
    assert.equal(deletedGame, "game-1");
  } finally {
    restore();
  }
});

test("previewSeries returns the mapped FastAPI preview", async () => {
  const preview = { valid: true, team_a_maps_won: 2, team_b_maps_won: 0, calculated_winner_id: "val-team-1", games: [], errors: [] };
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", valorantSeriesUuid: "series-uuid-1" }),
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/preview");
      return { status: 200, data: preview, requestId: "r" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapPreview: (p) => ({ valid: p.valid, teamAMapsWon: p.team_a_maps_won, errors: p.errors }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });
  try {
    const result = await service.previewSeries({ seriesId: "quest-series-1" });
    assert.equal(result.valid, true);
    assert.equal(result.teamAMapsWon, 2);
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/valorant.service.test.js`
Expected: FAIL — `service.createSeries is not a function`.

- [ ] **Step 3: Implement the series functions**

Append to `backend/src/modules/valorant/valorant.service.js`:

```js
const { mapSeriesView, mapGameView, mapPreview } = require("./valorant.mapper");
const { normalizeRiotId, generateExternalKey, assertSupportedFormat } = require("./valorant.validation");

const requireSeriesWithUuid = async ({ seriesId, status }) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, status: true, valorantSeriesUuid: true },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  if (status && series.status !== status) {
    throw new HttpError(409, `Series is not in the ${status} state.`);
  }
  if (!series.valorantSeriesUuid) {
    throw new HttpError(409, "This series has no VALORANT series yet.");
  }
  return series;
};

const createSeries = async ({
  bindingTeamAId,
  bindingTeamBId,
  format,
  playedAt,
  ratingModePreference = null,
  anchorPlayerA,
  anchorPlayerB,
  actorUserId,
  requestId,
  ipAddress,
}) => {
  assertSupportedFormat(format);
  const anchorA = normalizeRiotId(anchorPlayerA);
  const anchorB = normalizeRiotId(anchorPlayerB);

  const [bindingA, bindingB] = await Promise.all([
    prisma.valorantTeamBinding.findUnique({ where: { id: bindingTeamAId }, select: { id: true, status: true, valorantTeamUuid: true } }),
    prisma.valorantTeamBinding.findUnique({ where: { id: bindingTeamBId }, select: { id: true, status: true, valorantTeamUuid: true } }),
  ]);
  if (!bindingA || !bindingB) throw new HttpError(404, "VALORANT binding not found.");
  if (bindingA.status !== "active" || bindingB.status !== "active") {
    throw new HttpError(409, "Both teams must have active VALORANT bindings.");
  }
  if (bindingA.id === bindingB.id) {
    throw new HttpError(400, "The two series teams must be different bindings.");
  }

  const externalKey = generateExternalKey();
  const operation = await createOperation({
    type: "series_create",
    externalKey,
    actorUserId,
    requestBody: {
      team_a_id: bindingA.valorantTeamUuid,
      team_b_id: bindingB.valorantTeamUuid,
      format,
      played_at: playedAt.toISOString(),
    },
  });
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: "/api/v1/series",
      body: {
        team_a_id: bindingA.valorantTeamUuid,
        team_b_id: bindingB.valorantTeamUuid,
        format,
        importance: "regular",
        played_at: playedAt.toISOString(),
        external_quest_series_id: externalKey,
        anchor_player_a: anchorA,
        anchor_player_b: anchorB,
      },
      actorUserId,
      operationId: operation.operationId,
      externalKey,
      idempotent: true,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }

  const seriesView = mapSeriesView(response.data);
  const series = await prisma.questValorantSeries.create({
    data: {
      externalKey,
      bindingAId: bindingA.id,
      bindingBId: bindingB.id,
      format,
      playedAt,
      ratingModePreference,
      status: "draft",
      valorantSeriesUuid: seriesView.id,
      lastOperationId: operation.id,
    },
  });
  await markOperationSucceeded(operation.id, response);
  return series;
};

const getSeries = async ({ seriesId }) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    include: {
      bindingA: { include: { savedTeam: { select: { id: true, name: true, teamTag: true } } } },
      bindingB: { include: { savedTeam: { select: { id: true, name: true, teamTag: true } } } },
      games: { orderBy: { gameNumber: "asc" } },
      lastOperation: true,
    },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  return series;
};

const listSeries = async () =>
  prisma.questValorantSeries.findMany({
    include: {
      bindingA: { include: { savedTeam: { select: { id: true, name: true } } } },
      bindingB: { include: { savedTeam: { select: { id: true, name: true } } } },
      games: { select: { id: true, gameNumber: true, matchId: true, mapName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

const deleteSeries = async ({ seriesId, actorUserId, requestId, ipAddress }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const operation = await createOperation({
    type: "reconcile",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { action: "delete_series" },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  try {
    await valorantRequest({
      method: "DELETE",
      path: `/api/v1/series/${series.valorantSeriesUuid}`,
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await prisma.questValorantSeries.delete({ where: { id: series.id } });
  await markOperationSucceeded(operation.id, { status: 204, requestId: null, data: { seriesId: series.id } });
};

const attachGame = async ({ seriesId, gameNumber, matchId, teamASide, actorUserId, requestId, ipAddress }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const operation = await createOperation({
    type: "attach_game",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { match_id: matchId, game_number: gameNumber, team_a_side: teamASide },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: `/api/v1/series/${series.valorantSeriesUuid}/games`,
      body: { match_id: matchId, game_number: gameNumber, team_a_side: teamASide },
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  const game = mapGameView(response.data);
  const mirrored = await prisma.questValorantSeriesGame.create({
    data: {
      questSeriesId: series.id,
      gameNumber: game.gameNumber,
      matchId: game.matchId,
      teamASide: game.teamASide,
      teamBSide: game.teamBSide,
      mapName: game.mapName || undefined,
    },
  });
  await markOperationSucceeded(operation.id, response);
  return mirrored;
};

const setGameOrder = async ({ seriesId, games, actorUserId, requestId, ipAddress }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const operation = await createOperation({
    type: "set_game_order",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { games },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  try {
    await valorantRequest({
      method: "PUT",
      path: `/api/v1/series/${series.valorantSeriesUuid}/games/order`,
      body: { games: games.map(({ gameId, gameNumber }) => ({ game_id: gameId, game_number: gameNumber })) },
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await markOperationSucceeded(operation.id, { status: 200, requestId: null, data: { games } });
};

const removeGame = async ({ seriesId, gameId, actorUserId, requestId, ipAddress }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const operation = await createOperation({
    type: "remove_game",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { game_id: gameId },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  try {
    await valorantRequest({
      method: "DELETE",
      path: `/api/v1/series/${series.valorantSeriesUuid}/games/${gameId}`,
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await prisma.questValorantSeriesGame.delete({ where: { id: gameId } });
  await markOperationSucceeded(operation.id, { status: 204, requestId: null, data: { gameId } });
};

const previewSeries = async ({ seriesId }) => {
  const series = await requireSeriesWithUuid({ seriesId });
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/series/${series.valorantSeriesUuid}/preview`,
    actorUserId: null,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return mapPreview(response.data);
};
```

Add all eight to `module.exports`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/valorant.service.test.js`
Expected: PASS (Tasks 6–8 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/valorant/valorant.service.js backend/tests/valorant.service.test.js
git commit -m "feat(valorant): add series create, attach, absolute-order, remove, delete, and preview orchestration"
```


---

### Task 9: Finalize orchestration and reconciliation

**Files:**
- Modify: `backend/src/modules/valorant/valorant.service.js` (add `finalizeSeries`, `reconcileSeries`, `getReconciliationReport`, `getRankings`, `getRatingHistory`, `getTeamSeries`)
- Modify: `backend/tests/valorant.service.test.js` (append cases)

**Interfaces:**
- Consumes: `mapFinalizeResult`, `mapRatingEvent`, `mapRankingEntry` (Task 4), ledger helpers (Task 6), client (Task 4).
- Produces (Task 10 consumes): `finalizeSeries({ seriesId, ratingMode = null, officialWinnerTeamId = null, overrideReason = null, actorUserId, requestId, ipAddress })` → mapped `FinalizeResult`; `getReconciliationReport()` → report object; `reconcileSeries({ seriesId, actorUserId, requestId, ipAddress })` (adopt committed state by reading FastAPI); `getRankings()`; `getRatingHistory({ teamId })`; `getTeamSeries({ teamId })`.

**Finalize semantics (spec §5.5, §8.2, §9.2):**
- Operation row is created and set `in_flight` BEFORE the call; `playedAt`/`ratingMode` are fixed at that point.
- Body to FastAPI: `{ official_winner_id, override_reason, rating_mode }`.
- Definitive success → mark `succeeded`, set series `status = finalized`, `finalizedById`, `lastOperationId`.
- Definitive 409/422 → mark `failed`; if `SERIES_ALREADY_FINALIZED`, reconcile by reading FastAPI and adopting the committed state (never re-apply).
- Timeout/unknown → mark `reconciliation_required`, **never blind-retry**; a later admin-triggered reconcile reads `GET /api/v1/series/{uuid}`: `finalized` → adopt; `draft` → "finalization did not complete; retry safely".
- Reconciliation report (§8.3) classifies: Quest series with no FastAPI counterpart (by `external_quest_series_id`/`valorantSeriesUuid`) → `orphaned`; FastAPI series with no Quest projection (created out-of-band) → `unprojected`; bindings whose VAL team 404s → `team_missing`; match projections whose VAL match 404s → `match_missing`; operations stuck `in_flight`/`reconciliation_required`. All reads go through FastAPI.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/valorant.service.test.js`:

```js
test("finalizeSeries marks the operation in_flight before the call and adopts the committed result", async () => {
  const fixture = require("./fixtures/valorant/series-finalize.json");
  const statuses = [];
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", status: "draft", valorantSeriesUuid: "series-uuid-1" }),
        update: async ({ where, data }) => {
          assert.equal(where.id, "quest-series-1");
          assert.equal(data.status, "finalized");
          assert.equal(data.finalizedById, "user-1");
          return { id: where.id, ...data };
        },
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-14", ...data }),
        update: async ({ data }) => {
          statuses.push(data.status);
          return { id: "op-row-14", ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path, body }) => {
      assert.equal(path, "/api/v1/series/series-uuid-1/finalize");
      assert.deepEqual(body, {
        official_winner_id: null,
        override_reason: null,
        rating_mode: "normal",
      });
      return { status: 200, data: fixture, requestId: "fastapi-req-14" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapFinalizeResult: (r) => ({ seriesId: r.series_id, status: r.status, ratingMode: r.rating_mode }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const result = await service.finalizeSeries({
      seriesId: "quest-series-1",
      ratingMode: "normal",
      actorUserId: "user-1",
      requestId: "req-14",
      ipAddress: "127.0.0.1",
    });
    assert.equal(result.status, "finalized");
    assert.equal(result.ratingMode, "normal");
    assert.deepEqual(statuses, ["in_flight", "succeeded"]);
  } finally {
    restore();
  }
});

test("finalizeSeries marks the operation failed and reconciles on SERIES_ALREADY_FINALIZED", async () => {
  const fixture = require("./fixtures/valorant/series-finalize.json");
  const statuses = [];
  let adoptionCalls = 0;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", status: "draft", valorantSeriesUuid: "series-uuid-1" }),
        update: async ({ data }) => {
          if (data.status === "finalized") adoptionCalls += 1;
          return { id: "quest-series-1", ...data };
        },
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-15", ...data }),
        update: async ({ data }) => {
          statuses.push(data.status);
          return { id: "op-row-15", ...data };
        },
      },
    },
  };
  let callCount = 0;
  const clientMock = {
    valorantRequest: async ({ path }) => {
      callCount += 1;
      if (path.endsWith("/finalize")) {
        throw new FastApiError("already finalized", { code: "SERIES_ALREADY_FINALIZED", status: 409, requestId: "fastapi-req-15" });
      }
      assert.equal(path, "/api/v1/series/series-uuid-1");
      return { status: 200, data: { ...fixture, status: "finalized" }, requestId: "fastapi-req-15" };
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapFinalizeResult: (r) => ({ seriesId: r.series_id, status: r.status, ratingMode: r.rating_mode }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.finalizeSeries({ seriesId: "quest-series-1", ratingMode: "normal", actorUserId: "user-1", requestId: "req-15", ipAddress: "127.0.0.1" }),
      (error) => error instanceof FastApiError && error.code === "SERIES_ALREADY_FINALIZED",
    );
    assert.ok(statuses.includes("failed"));
    assert.equal(callCount, 2, "finalize attempt + one reconcile read, no blind retry");
    assert.equal(adoptionCalls, 1, "the committed finalized state is adopted");
  } finally {
    restore();
  }
});

test("finalizeSeries marks reconciliation_required on timeout and never blind-retries", async () => {
  let calls = 0;
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findUnique: async () => ({ id: "quest-series-1", status: "draft", valorantSeriesUuid: "series-uuid-1" }),
        update: async () => ({}),
      },
      questValorantOperation: {
        create: async ({ data }) => ({ id: "op-row-16", ...data }),
        update: async ({ data }) => {
          assert.equal(data.status, "reconciliation_required");
          return { id: "op-row-16", ...data };
        },
      },
    },
  };
  const clientMock = {
    valorantRequest: async () => {
      calls += 1;
      throw new InternalServiceError("timed out", { code: "valorant_unreachable", status: 502 });
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapFinalizeResult: () => ({}) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    await assert.rejects(
      service.finalizeSeries({ seriesId: "quest-series-1", ratingMode: "normal", actorUserId: "user-1", requestId: "req-16", ipAddress: "127.0.0.1" }),
      (error) => error instanceof InternalServiceError,
    );
    assert.equal(calls, 1, "finalize is never blind-retried");
  } finally {
    restore();
  }
});

test("getReconciliationReport classifies missing FastAPI series as orphaned via reads only", async () => {
  const prismaMock = {
    prisma: {
      questValorantSeries: {
        findMany: async () => [
          { id: "qs-1", externalKey: "ext-1", valorantSeriesUuid: "series-uuid-1", status: "draft" },
          { id: "qs-2", externalKey: "ext-2", valorantSeriesUuid: null, status: "reconciliation_required" },
        ],
      },
      valorantTeamBinding: { findMany: async () => [] },
      questValorantMatch: { findMany: async () => [] },
      questValorantOperation: {
        findMany: async () => [{ id: "op-1", operationId: "op-1", type: "finalize", status: "reconciliation_required", questSeriesId: "qs-1" }],
      },
    },
  };
  const clientMock = {
    valorantRequest: async ({ path }) => {
      if (path === "/api/v1/series/series-uuid-1") {
        return { status: 200, data: { id: "series-uuid-1", status: "draft" }, requestId: "r" };
      }
      throw new FastApiError("not found", { code: "SERIES_NOT_FOUND", status: 404 });
    },
  };
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: prismaMock,
    [clientPath]: clientMock,
    [mapperPath]: { mapSeriesView: (s) => ({ id: s.id, status: s.status }) },
    [envPath]: envMock,
    [httpErrorPath]: { HttpError },
  });

  try {
    const report = await service.getReconciliationReport();
    assert.ok(report.orphaned.some((row) => row.id === "qs-2"));
    assert.ok(report.stuckOperations.length === 1);
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/valorant.service.test.js`
Expected: FAIL — `service.finalizeSeries is not a function`.

- [ ] **Step 3: Implement finalize, reconciliation, and rankings reads**

Append to `backend/src/modules/valorant/valorant.service.js`:

```js
const { mapFinalizeResult, mapRankingEntry, mapRatingEvent, mapSeriesView } = require("./valorant.mapper");

const finalizeSeries = async ({
  seriesId,
  ratingMode = null,
  officialWinnerTeamId = null,
  overrideReason = null,
  actorUserId,
  requestId,
  ipAddress,
}) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, status: true, valorantSeriesUuid: true },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  if (!series.valorantSeriesUuid) throw new HttpError(409, "This series has no VALORANT series yet.");
  if (series.status === "finalized") throw new HttpError(409, "Series already finalized.");

  const operation = await createOperation({
    type: "finalize",
    questSeriesId: series.id,
    actorUserId,
    requestBody: {
      official_winner_id: officialWinnerTeamId,
      override_reason: overrideReason,
      rating_mode: ratingMode,
    },
  });
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: `/api/v1/series/${series.valorantSeriesUuid}/finalize`,
      body: {
        official_winner_id: officialWinnerTeamId,
        override_reason: overrideReason,
        rating_mode: ratingMode,
      },
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    if (error instanceof FastApiError && error.code === "SERIES_ALREADY_FINALIZED") {
      // Surface the committed state, never re-apply (spec §5.5, §8.2).
      await reconcileSeries({ seriesId, actorUserId, requestId, ipAddress });
    }
    throw error;
  }

  const result = mapFinalizeResult(response.data);
  await prisma.questValorantSeries.update({
    where: { id: series.id },
    data: { status: "finalized", finalizedById: actorUserId, lastOperationId: operation.id },
  });
  await markOperationSucceeded(operation.id, response);
  return result;
};

const reconcileSeries = async ({ seriesId, actorUserId, requestId, ipAddress }) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, status: true, valorantSeriesUuid: true },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  if (!series.valorantSeriesUuid) throw new HttpError(409, "This series has no VALORANT series yet.");

  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/series/${series.valorantSeriesUuid}`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  const view = mapSeriesView(response.data);

  if (view.status === "finalized") {
    return prisma.questValorantSeries.update({
      where: { id: series.id },
      data: { status: "finalized", finalizedById: actorUserId, lastOperationId: undefined },
    });
  }
  // FastAPI still reports draft: the finalize transaction rolled back; a fresh
  // finalize with the same inputs is safe (double-finalize is rejected server-side).
  return prisma.questValorantSeries.update({
    where: { id: series.id },
    data: { status: series.status === "reconciliation_required" ? "draft" : series.status },
  });
};

const getRankings = async () => {
  const response = await valorantRequest({
    method: "GET",
    path: "/api/v1/rankings/teams",
    actorUserId: null,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapRankingEntry);
};

const getRatingHistory = async ({ teamId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/teams/${encodeURIComponent(teamId)}/rating-history`,
    actorUserId: null,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapRatingEvent);
};

const getTeamSeries = async ({ teamId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/teams/${encodeURIComponent(teamId)}/series`,
    actorUserId: null,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapSeriesView);
};

const getReconciliationReport = async () => {
  const [questSeries, bindings, matchProjections, stuckOperations] = await Promise.all([
    prisma.questValorantSeries.findMany({ select: { id: true, externalKey: true, valorantSeriesUuid: true, status: true } }),
    prisma.valorantTeamBinding.findMany({ select: { id: true, savedTeamId: true, valorantTeamUuid: true, status: true } }),
    prisma.questValorantMatch.findMany({ select: { id: true, matchId: true, henrikMatchId: true } }),
    prisma.questValorantOperation.findMany({
      where: { status: { in: ["in_flight", "reconciliation_required"] } },
      select: { id: true, operationId: true, type: true, status: true, questSeriesId: true },
    }),
  ]);

  const seriesByUuid = new Map(questSeries.filter((s) => s.valorantSeriesUuid).map((s) => [s.valorantSeriesUuid, s]));
  const seriesUuids = [...seriesByUuid.keys()];

  // Single read of the FastAPI series list covers both directions (§8.3).
  const fastapiSeries = seriesUuids.length
    ? await valorantRequest({
        method: "GET",
        path: "/api/v1/series",
        actorUserId: null,
        operationId: crypto.randomUUID(),
        idempotent: true,
      })
    : { data: [] };

  const fastapiByUuid = new Map((fastapiSeries.data || []).map((s) => [s.id, s]));
  const questKeys = new Set(questSeries.map((s) => s.externalKey));

  const orphaned = questSeries.filter(
    (s) => s.valorantSeriesUuid && !fastapiByUuid.has(s.valorantSeriesUuid),
  );
  const unprojected = (fastapiSeries.data || [])
    .filter((s) => !questKeys.has(s.external_quest_series_id))
    .map((s) => ({ id: s.id, externalQuestSeriesId: s.external_quest_series_id || null }));

  const teamMissing = [];
  for (const binding of bindings) {
    try {
      await valorantRequest({
        method: "GET",
        path: `/api/v1/teams/${encodeURIComponent(binding.valorantTeamUuid)}`,
        actorUserId: null,
        operationId: crypto.randomUUID(),
        idempotent: true,
      });
    } catch (error) {
      if (error instanceof FastApiError && error.code === "TEAM_NOT_FOUND") teamMissing.push(binding);
    }
  }

  const matchMissing = [];
  for (const projection of matchProjections) {
    try {
      await valorantRequest({
        method: "GET",
        path: `/api/v1/matches/${encodeURIComponent(projection.matchId)}`,
        actorUserId: null,
        operationId: crypto.randomUUID(),
        idempotent: true,
      });
    } catch (error) {
      if (error instanceof FastApiError && error.code === "MATCH_NOT_FOUND") matchMissing.push(projection);
    }
  }

  return { orphaned, unprojected, teamMissing, matchMissing, stuckOperations };
};
```

Add `finalizeSeries`, `reconcileSeries`, `getRankings`, `getRatingHistory`, `getTeamSeries`, `getReconciliationReport` to `module.exports`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/valorant.service.test.js`
Expected: PASS (Tasks 6–9 cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/valorant/valorant.service.js backend/tests/valorant.service.test.js
git commit -m "feat(valorant): add finalize orchestration with no-blind-retry and reconciliation reads"
```

---

### Task 10: Controller, admin proxy routes, OpenAPI, audit wiring, API docs

**Files:**
- Create: `backend/src/modules/valorant/valorant.controller.js`
- Modify: `backend/src/routes/v1.js` (import `requireAdmin`; add `router.use("/admin/valorant", requireAdmin)` + the route block)
- Modify: `backend/src/lib/openapi.js` (document every new path — `openapi.test.js` gate)
- Modify: `docs/api-documentation.md` (add "VALORANT Admin Endpoints" section)
- Create: `backend/tests/valorant.controller.test.js`
- Create: `backend/tests/valorant-routes.test.js`

**Interfaces:**
- Consumes: every service function from Tasks 6–9, `recordAudit`/`requestAuditContext` (`../../lib/audit`), `asyncHandler` (`../../lib/async-handler`), `HttpError`.
- Produces (UI consumes): the admin-facing HTTP surface below. Response shape follows the existing envelope: `{ success: true, data: <payload>, meta: { serverNow } }`; errors go through `errorHandler` with `body.error.code`.

**Route table (spec §6.2; every route behind `router.use("/admin/valorant", requireAdmin)`):**

| Method | Route | Controller handler | Backing FastAPI call |
|---|---|---|---|
| GET | `/admin/valorant/teams` | `listTeams` | `GET /api/v1/teams` + bindings joined |
| POST | `/admin/valorant/teams/bind` | `bindTeam` | `POST /api/v1/teams` (create-or-get) |
| DELETE | `/admin/valorant/teams/:bindingId/detach` | `detachBinding` | none (Quest-local) |
| POST | `/admin/valorant/discover` | `discover` | `POST /api/v1/match-search/two-player` |
| POST | `/admin/valorant/matches/import` | `importMatch` | `POST /api/v1/matches/import` |
| GET | `/admin/valorant/matches/by-henrik-id/:henrikMatchId` | `getMatchByHenrikId` | `GET /api/v1/matches/by-henrik-id/{henrik_match_id}` |
| GET | `/admin/valorant/matches` | `listMatches` | `GET /api/v1/matches` |
| POST | `/admin/valorant/series` | `createSeries` | `POST /api/v1/series` (external key + anchors) |
| GET | `/admin/valorant/series` | `listSeries` | Quest projection list |
| GET | `/admin/valorant/series/:id` | `getSeries` | Quest projection + FastAPI when needed |
| DELETE | `/admin/valorant/series/:id` | `deleteSeries` | `DELETE /api/v1/series/{uuid}` (draft only) |
| POST | `/admin/valorant/series/:id/games` | `attachGame` | `POST /api/v1/series/{uuid}/games` |
| PUT | `/admin/valorant/series/:id/games/order` | `setGameOrder` | `PUT /api/v1/series/{uuid}/games/order` (delta D9) |
| DELETE | `/admin/valorant/series/:id/games/:gameId` | `removeGame` | `DELETE /api/v1/series/{uuid}/games/{game_id}` |
| GET | `/admin/valorant/series/:id/preview` | `previewSeries` | `GET /api/v1/series/{uuid}/preview` |
| POST | `/admin/valorant/series/:id/finalize` | `finalizeSeries` | `POST /api/v1/series/{uuid}/finalize` |
| GET | `/admin/valorant/rankings` | `getRankings` | `GET /api/v1/rankings/teams` |
| GET | `/admin/valorant/teams/:teamId/rating-history` | `getRatingHistory` | `GET /api/v1/teams/{team_id}/rating-history` |
| GET | `/admin/valorant/teams/:teamId/series` | `getTeamSeries` | `GET /api/v1/teams/{team_id}/series` |
| GET | `/admin/valorant/reconciliation` | `getReconciliation` | FastAPI reads only (§8.3) |

**Audit wiring (§9.2):** every admin VALORANT handler calls `recordAudit` with `requestAuditContext(req)`, `targetType: "valorant_<resource>"`, `targetId`, and `afterData: { operationId }` when a mutation created an operation. The Quest `operationId` is the durable cross-service correlation key; FastAPI's `X-Request-ID` is stored on the operation row (`fastapiRequestId`), never confused with it.

- [ ] **Step 1: Write the failing controller test**

Create `backend/tests/valorant.controller.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/valorant/valorant.controller.js");
const servicePath = path.join(__dirname, "../src/modules/valorant/valorant.service.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");
const asyncHandlerPath = path.join(__dirname, "../src/lib/async-handler.js");
const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
const { HttpError } = require(httpErrorPath);

const callHandler = async (handler, req) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const nextErrors = [];
  await handler(req, res, (error) => nextErrors.push(error));
  return { res, nextErrors };
};

test("bindTeam controller records an AuditLog and returns the binding envelope", async () => {
  const audits = [];
  const serviceMock = {
    bindTeam: async ({ savedTeamId, actorUserId }) => {
      assert.equal(savedTeamId, "saved-team-1");
      assert.equal(actorUserId, "admin-1");
      return { id: "binding-1", valorantTeamUuid: "val-team-1", status: "active" };
    },
  };
  const auditMock = {
    requestAuditContext: (req) => ({ actorUserId: req.user?.id, requestId: req.requestId, ipAddress: req.ip }),
    recordAudit: async (entry) => audits.push(entry),
  };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { res, nextErrors } = await callHandler(controller.bindTeam, {
      user: { id: "admin-1" },
      requestId: "req-1",
      ip: "127.0.0.1",
      body: { savedTeamId: "saved-team-1" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.binding.id, "binding-1");
    assert.deepEqual(nextErrors, []);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorUserId, "admin-1");
    assert.equal(audits[0].targetType, "valorant_binding");
    assert.equal(audits[0].targetId, "binding-1");
  } finally {
    restore();
  }
});

test("finalizeSeries controller records the operation id in the audit afterData", async () => {
  const audits = [];
  const serviceMock = {
    finalizeSeries: async ({ seriesId, ratingMode, actorUserId }) => ({
      seriesId,
      ratingMode,
      status: "finalized",
      operationId: "op-abc",
    }),
  };
  const auditMock = {
    requestAuditContext: (req) => ({ actorUserId: req.user?.id, requestId: req.requestId, ipAddress: req.ip }),
    recordAudit: async (entry) => audits.push(entry),
  };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { res, nextErrors } = await callHandler(controller.finalizeSeries, {
      user: { id: "admin-1" },
      requestId: "req-2",
      ip: "127.0.0.1",
      params: { id: "quest-series-1" },
      body: { ratingMode: "normal" },
    });
    assert.equal(res.payload.data.status, "finalized");
    assert.deepEqual(nextErrors, []);
    assert.equal(audits[0].targetType, "valorant_series");
    assert.equal(audits[0].afterData.operationId, "op-abc");
  } finally {
    restore();
  }
});

test("controller propagates HttpError through next()", async () => {
  const serviceMock = {
    bindTeam: async () => { throw new HttpError(409, "already bound"); },
  };
  const auditMock = { requestAuditContext: () => ({}), recordAudit: async () => {} };
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: serviceMock,
    [auditPath]: auditMock,
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [httpErrorPath]: { HttpError },
  });

  try {
    const { nextErrors } = await callHandler(controller.bindTeam, {
      user: { id: "admin-1" },
      requestId: "req-3",
      ip: "127.0.0.1",
      body: { savedTeamId: "saved-team-1" },
    });
    assert.ok(nextErrors[0] instanceof HttpError);
    assert.equal(nextErrors[0].statusCode, 409);
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/valorant.controller.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller**

Create `backend/src/modules/valorant/valorant.controller.js`:

```js
const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  listBindings,
  bindTeam,
  detachBinding,
  discover,
  importMatch,
  getMatchByHenrikId,
  listMatches,
  createSeries,
  getSeries,
  listSeries,
  deleteSeries,
  attachGame,
  setGameOrder,
  removeGame,
  previewSeries,
  finalizeSeries,
  getRankings,
  getRatingHistory,
  getTeamSeries,
  getReconciliationReport,
} = require("./valorant.service");

const requireBody = (body, names) => {
  for (const name of names) {
    if (body?.[name] === undefined || body?.[name] === null || body?.[name] === "") {
      throw new HttpError(400, `Missing required field: ${name}.`);
    }
  }
};

const writeAudit = async (req, { targetType, targetId, afterData }) =>
  recordAudit({
    ...requestAuditContext(req),
    action: `valorant.${targetType}`,
    targetType,
    targetId,
    afterData,
  });

const listTeams = asyncHandler(async (req, res) => {
  const data = await listBindings();
  res.status(200).json({ success: true, data: { bindings: data }, meta: { serverNow: new Date().toISOString() } });
});

const bindTeam = asyncHandler(async (req, res) => {
  requireBody(req.body, ["savedTeamId"]);
  const binding = await bindTeam({
    savedTeamId: req.body.savedTeamId,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_binding", targetId: binding.id, afterData: { savedTeamId: req.body.savedTeamId } });
  res.status(200).json({ success: true, data: { binding }, meta: { serverNow: new Date().toISOString() } });
});

const detachBinding = asyncHandler(async (req, res) => {
  const binding = await detachBinding({
    bindingId: req.params.bindingId,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_binding", targetId: binding.id, afterData: { status: "detached" } });
  res.status(200).json({ success: true, data: { binding }, meta: { serverNow: new Date().toISOString() } });
});

const discover = asyncHandler(async (req, res) => {
  requireBody(req.body, ["playerA", "playerB"]);
  const data = await discover({
    playerA: req.body.playerA,
    playerB: req.body.playerB,
    pageSize: req.body.pageSize,
    maxPages: req.body.maxPages,
    map: req.body.map,
    from: req.body.from,
    actorUserId: req.user.id,
    requestId: req.requestId,
  });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const importMatch = asyncHandler(async (req, res) => {
  requireBody(req.body, ["henrikMatchId"]);
  const data = await importMatch({
    henrikMatchId: req.body.henrikMatchId,
    affinity: req.body.affinity || "eu",
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_match", targetId: data.match.matchId, afterData: { henrikMatchId: req.body.henrikMatchId, created: data.created } });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const getMatchByHenrikId = asyncHandler(async (req, res) => {
  const match = await getMatchByHenrikId({ henrikMatchId: req.params.henrikMatchId });
  res.status(200).json({ success: true, data: { match }, meta: { serverNow: new Date().toISOString() } });
});

const listMatches = asyncHandler(async (req, res) => {
  const data = await listMatches({ cursor: req.query.cursor, limit: req.query.limit });
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const createSeries = asyncHandler(async (req, res) => {
  requireBody(req.body, ["bindingTeamAId", "bindingTeamBId", "format", "playedAt", "anchorPlayerA", "anchorPlayerB"]);
  const series = await createSeries({
    bindingTeamAId: req.body.bindingTeamAId,
    bindingTeamBId: req.body.bindingTeamBId,
    format: req.body.format,
    playedAt: new Date(req.body.playedAt),
    ratingModePreference: req.body.ratingModePreference || null,
    anchorPlayerA: req.body.anchorPlayerA,
    anchorPlayerB: req.body.anchorPlayerB,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_series", targetId: series.id, afterData: { externalKey: series.externalKey, format: series.format } });
  res.status(201).json({ success: true, data: { series }, meta: { serverNow: new Date().toISOString() } });
});

const listSeries = asyncHandler(async (req, res) => {
  const data = await listSeries();
  res.status(200).json({ success: true, data: { series: data }, meta: { serverNow: new Date().toISOString() } });
});

const getSeries = asyncHandler(async (req, res) => {
  const series = await getSeries({ seriesId: req.params.id });
  res.status(200).json({ success: true, data: { series }, meta: { serverNow: new Date().toISOString() } });
});

const deleteSeries = asyncHandler(async (req, res) => {
  await deleteSeries({ seriesId: req.params.id, actorUserId: req.user.id, requestId: req.requestId, ipAddress: req.ip });
  await writeAudit(req, { targetType: "valorant_series", targetId: req.params.id, afterData: { action: "delete" } });
  res.status(200).json({ success: true, message: "Draft series deleted." });
});

const attachGame = asyncHandler(async (req, res) => {
  requireBody(req.body, ["gameNumber", "matchId", "teamASide"]);
  const game = await attachGame({
    seriesId: req.params.id,
    gameNumber: req.body.gameNumber,
    matchId: req.body.matchId,
    teamASide: req.body.teamASide,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_game", targetId: game.id, afterData: { matchId: req.body.matchId, gameNumber: game.gameNumber } });
  res.status(201).json({ success: true, data: { game }, meta: { serverNow: new Date().toISOString() } });
});

const setGameOrder = asyncHandler(async (req, res) => {
  requireBody(req.body, ["games"]);
  await setGameOrder({ seriesId: req.params.id, games: req.body.games, actorUserId: req.user.id, requestId: req.requestId, ipAddress: req.ip });
  await writeAudit(req, { targetType: "valorant_series", targetId: req.params.id, afterData: { action: "set_game_order", games: req.body.games } });
  res.status(200).json({ success: true, message: "Game order updated." });
});

const removeGame = asyncHandler(async (req, res) => {
  await removeGame({ seriesId: req.params.id, gameId: req.params.gameId, actorUserId: req.user.id, requestId: req.requestId, ipAddress: req.ip });
  await writeAudit(req, { targetType: "valorant_game", targetId: req.params.gameId, afterData: { action: "remove" } });
  res.status(200).json({ success: true, message: "Game removed." });
});

const previewSeries = asyncHandler(async (req, res) => {
  const preview = await previewSeries({ seriesId: req.params.id });
  res.status(200).json({ success: true, data: { preview }, meta: { serverNow: new Date().toISOString() } });
});

const finalizeSeries = asyncHandler(async (req, res) => {
  const result = await finalizeSeries({
    seriesId: req.params.id,
    ratingMode: req.body.ratingMode || null,
    officialWinnerTeamId: req.body.officialWinnerTeamId || null,
    overrideReason: req.body.overrideReason || null,
    actorUserId: req.user.id,
    requestId: req.requestId,
    ipAddress: req.ip,
  });
  await writeAudit(req, { targetType: "valorant_series", targetId: req.params.id, afterData: { action: "finalize", operationId: result.operationId || null, ratingMode: result.ratingMode || null } });
  res.status(200).json({ success: true, data: { result }, meta: { serverNow: new Date().toISOString() } });
});

const getRankings = asyncHandler(async (req, res) => {
  const rankings = await getRankings();
  res.status(200).json({ success: true, data: { rankings }, meta: { serverNow: new Date().toISOString() } });
});

const getRatingHistory = asyncHandler(async (req, res) => {
  const events = await getRatingHistory({ teamId: req.params.teamId });
  res.status(200).json({ success: true, data: { events }, meta: { serverNow: new Date().toISOString() } });
});

const getTeamSeries = asyncHandler(async (req, res) => {
  const series = await getTeamSeries({ teamId: req.params.teamId });
  res.status(200).json({ success: true, data: { series }, meta: { serverNow: new Date().toISOString() } });
});

const getReconciliation = asyncHandler(async (req, res) => {
  const report = await getReconciliationReport();
  await writeAudit(req, { targetType: "valorant_reconciliation", targetId: null, afterData: { counts: { orphaned: report.orphaned.length, unprojected: report.unprojected.length, teamMissing: report.teamMissing.length, matchMissing: report.matchMissing.length, stuckOperations: report.stuckOperations.length } } });
  res.status(200).json({ success: true, data: { report }, meta: { serverNow: new Date().toISOString() } });
});

module.exports = {
  listTeams,
  bindTeam,
  detachBinding,
  discover,
  importMatch,
  getMatchByHenrikId,
  listMatches,
  createSeries,
  listSeries,
  getSeries,
  deleteSeries,
  attachGame,
  setGameOrder,
  removeGame,
  previewSeries,
  finalizeSeries,
  getRankings,
  getRatingHistory,
  getTeamSeries,
  getReconciliation,
};
```

Note: the controller test for finalize expects the service's returned result to carry `operationId`. Return it from `finalizeSeries` in Task 9 by appending `operationId: operation.operationId` to the mapped result before the series update — update `finalizeSeries` accordingly (one line: `const result = { ...mapFinalizeResult(response.data), operationId: operation.operationId };`).

- [ ] **Step 4: Run the controller tests to verify they pass**

Run: `node --test tests/valorant.controller.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route/guard test**

Create `backend/tests/valorant-routes.test.js` (loads the real `v1.js` router with the same style as `event-album.routes.test.js`):

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const v1Path = path.join(__dirname, "../src/routes/v1.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const authPath = path.join(__dirname, "../src/modules/auth/auth.middleware.js");
const asyncHandlerPath = path.join(__dirname, "../src/lib/async-handler.js");
const cacheControlPath = path.join(__dirname, "../src/middleware/cache-control.js");
const responseCachePath = path.join(__dirname, "../src/middleware/response-cache.js");
const tournamentServicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const matchControllerPath = path.join(__dirname, "../src/modules/matches/match.controller.js");
const challongeControllerPath = path.join(__dirname, "../src/modules/challonge/challonge.controller.js");
const staffControllerPath = path.join(__dirname, "../src/modules/permissions/staff.controller.js");
const realtimeControllerPath = path.join(__dirname, "../src/modules/realtime/realtime.controller.js");
const permissionMiddlewarePath = path.join(__dirname, "../src/modules/permissions/permission.middleware.js");
const valorantControllerPath = path.join(__dirname, "../src/modules/valorant/valorant.controller.js");

const controllerHandler = (_req, _res, next) => next?.();
const controllerMock = new Proxy({}, { get: () => controllerHandler });
const passMiddleware = (_req, _res, next) => next();

test("v1 router guards /admin/valorant with requireAdmin and declares every proxy route", () => {
  const { module: router, restore } = loadModuleWithMocks(v1Path, {
    [envPath]: { env: { CACHE_TTL_SECONDS: 300, CHALLONGE_BRACKET_CACHE_SECONDS: 30 } },
    [authPath]: { attachSession: passMiddleware, requireAuth: passMiddleware, requireAdmin: passMiddleware },
    [asyncHandlerPath]: { asyncHandler: (handler) => handler },
    [cacheControlPath]: { cachePublicData: () => passMiddleware },
    [responseCachePath]: { cacheJson: () => passMiddleware, invalidateCache: () => passMiddleware },
    [tournamentServicePath]: { getPublicTournamentBySlug: async () => ({}) },
    [matchControllerPath]: controllerMock,
    [challongeControllerPath]: controllerMock,
    [staffControllerPath]: controllerMock,
    [realtimeControllerPath]: { getRealtimeEvents: controllerHandler },
    [permissionMiddlewarePath]: {
      requireSuperAdmin: () => passMiddleware,
      requireTournamentStaff: () => passMiddleware,
      requireMatchStaff: () => passMiddleware,
    },
    [valorantControllerPath]: controllerMock,
  });

  try {
    const useLayers = router.stack.filter((layer) => layer.route === undefined);
    assert.ok(
      useLayers.some((layer) => layer.path === "/admin/valorant"),
      "a router.use('/admin/valorant', requireAdmin) guard must exist",
    );

    const routes = new Set(
      router.stack
        .filter((layer) => layer.route)
        .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`),
    );
    for (const expected of [
      "GET /admin/valorant/teams",
      "POST /admin/valorant/teams/bind",
      "DELETE /admin/valorant/teams/:bindingId/detach",
      "POST /admin/valorant/discover",
      "POST /admin/valorant/matches/import",
      "GET /admin/valorant/matches/by-henrik-id/:henrikMatchId",
      "GET /admin/valorant/matches",
      "POST /admin/valorant/series",
      "GET /admin/valorant/series",
      "GET /admin/valorant/series/:id",
      "DELETE /admin/valorant/series/:id",
      "POST /admin/valorant/series/:id/games",
      "PUT /admin/valorant/series/:id/games/order",
      "DELETE /admin/valorant/series/:id/games/:gameId",
      "GET /admin/valorant/series/:id/preview",
      "POST /admin/valorant/series/:id/finalize",
      "GET /admin/valorant/rankings",
      "GET /admin/valorant/teams/:teamId/rating-history",
      "GET /admin/valorant/teams/:teamId/series",
      "GET /admin/valorant/reconciliation",
    ]) {
      assert.ok(routes.has(expected), `missing route ${expected}`);
    }
  } finally {
    restore();
  }
});
```

- [ ] **Step 6: Run the route test to verify it fails**

Run: `node --test tests/valorant-routes.test.js`
Expected: FAIL — `missing route GET /admin/valorant/teams`.

- [ ] **Step 7: Mount the routes in `v1.js`**

Modify `backend/src/routes/v1.js`:

```js
const { attachSession, requireAuth, requireAdmin } = require("../modules/auth/auth.middleware");
const valorantController = require("../modules/valorant/valorant.controller");
```

After the existing admin routes, add:

```js
router.use("/admin/valorant", requireAdmin);
router.get("/admin/valorant/teams", valorantController.listTeams);
router.post("/admin/valorant/teams/bind", valorantController.bindTeam);
router.delete("/admin/valorant/teams/:bindingId/detach", valorantController.detachBinding);
router.post("/admin/valorant/discover", valorantController.discover);
router.post("/admin/valorant/matches/import", valorantController.importMatch);
router.get("/admin/valorant/matches/by-henrik-id/:henrikMatchId", valorantController.getMatchByHenrikId);
router.get("/admin/valorant/matches", valorantController.listMatches);
router.post("/admin/valorant/series", valorantController.createSeries);
router.get("/admin/valorant/series", valorantController.listSeries);
router.get("/admin/valorant/series/:id", valorantController.getSeries);
router.delete("/admin/valorant/series/:id", valorantController.deleteSeries);
router.post("/admin/valorant/series/:id/games", valorantController.attachGame);
router.put("/admin/valorant/series/:id/games/order", valorantController.setGameOrder);
router.delete("/admin/valorant/series/:id/games/:gameId", valorantController.removeGame);
router.get("/admin/valorant/series/:id/preview", valorantController.previewSeries);
router.post("/admin/valorant/series/:id/finalize", valorantController.finalizeSeries);
router.get("/admin/valorant/rankings", valorantController.getRankings);
router.get("/admin/valorant/teams/:teamId/rating-history", valorantController.getRatingHistory);
router.get("/admin/valorant/teams/:teamId/series", valorantController.getTeamSeries);
router.get("/admin/valorant/reconciliation", valorantController.getReconciliation);
```

- [ ] **Step 8: Document the routes in `openapi.js`**

Modify `backend/src/lib/openapi.js`: add a `paths` entry for every route above, using the existing `createOperation`/`createResponse` helpers. Add this block (place near the other `/api/v1/admin/...` paths, e.g. after the staff block ~L821):

```js
  "/api/v1/admin/valorant/teams": {
    get: createOperation("valorant", "List VALORANT team bindings with their FastAPI teams", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/bind": {
    post: createOperation("valorant", "Bind a SavedTeam to a VALORANT team (create-or-get by quest_saved_team_id)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{bindingId}/detach": {
    delete: createOperation("valorant", "Detach a VALORANT team binding (Quest-local, never touches VALORANT data)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/discover": {
    post: createOperation("valorant", "Run a two-player VALORANT match search", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches/import": {
    post: createOperation("valorant", "Import a selected Henrik match (idempotent, created=true/false)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches/by-henrik-id/{henrikMatchId}": {
    get: createOperation("valorant", "Get a match detail by Henrik match id", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches": {
    get: createOperation("valorant", "List VALORANT matches", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series": {
    post: createOperation("valorant", "Create a draft VALORANT series with anchors and external key", { authenticated: true }),
    get: createOperation("valorant", "List Quest VALORANT series projections", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}": {
    get: createOperation("valorant", "Get a Quest VALORANT series projection", { authenticated: true }),
    delete: createOperation("valorant", "Delete a draft VALORANT series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games": {
    post: createOperation("valorant", "Attach an imported match as a game with side mapping", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games/order": {
    put: createOperation("valorant", "Set the absolute desired game order (draft only, idempotent)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games/{gameId}": {
    delete: createOperation("valorant", "Remove a game from a draft series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/preview": {
    get: createOperation("valorant", "Preview a series validity and calculated winner", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/finalize": {
    post: createOperation("valorant", "Finalize a series with a rating mode and optional override", { authenticated: true }),
  },
  "/api/v1/admin/valorant/rankings": {
    get: createOperation("valorant", "List VALORANT team rankings", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{teamId}/rating-history": {
    get: createOperation("valorant", "Get a VALORANT team rating history", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{teamId}/series": {
    get: createOperation("valorant", "List a VALORANT team's series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/reconciliation": {
    get: createOperation("valorant", "Get the VALORANT reconciliation report", { authenticated: true }),
  },
```

- [ ] **Step 9: Update `docs/api-documentation.md`**

Add a `## VALORANT Admin Endpoints` section after the existing `## Admin Endpoints` (L655) containing: the §6.2 route table, the request/response shapes from §6.4 (discover, candidate detail, create series, attach game, set order, finalize), the §6.5 error-mapping table, and the reconciliation endpoint semantics. Reference the spec sections; do not invent fields.

- [ ] **Step 10: Run the route + openapi + controller tests**

```bash
node --test tests/valorant-routes.test.js
node --test tests/valorant.controller.test.js
node --test tests/openapi.test.js
```

Expected: PASS — route inventory matches, and `openapi.test.js` finds every new `/api/v1/admin/valorant/*` path documented.

- [ ] **Step 11: Run the full unit suite**

Run: `npm test`
Expected: PASS (all existing + new tests; `openapi.test.js` green).

- [ ] **Step 12: Commit**

```bash
git add backend/src/modules/valorant/valorant.controller.js backend/src/routes/v1.js backend/src/lib/openapi.js docs/api-documentation.md backend/tests/valorant.controller.test.js backend/tests/valorant-routes.test.js
git commit -m "feat(valorant): add admin controller, guarded proxy routes, OpenAPI docs, and audit wiring"
```


---

### Task 11: Guarded SavedTeam deletion (active-binding 409 + DB safety net)

**Files:**
- Modify: `backend/src/modules/teams/team.service.js` (`deleteSavedTeam` L643)
- Modify: `backend/src/modules/admin/admin.service.js` (`deleteAdminSavedTeam` L2193)
- Modify: `backend/tests/team.service.test.js` (append cases)
- Modify: `backend/tests/admin.service.test.js` (append case)

**Interfaces:**
- Consumes: `prisma.valorantTeamBinding` (Task 2).
- Produces (Task 12 verifies at DB level): both deletion paths reject `HttpError(409, "This team cannot be deleted because it has an active VALORANT binding. Detach the VALORANT binding first.")` when an active binding exists; the FK `onDelete: SetNull` + the Task 2 trigger are the safety net for bypassed deletes (§7.5).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/team.service.test.js`:

```js
test("deleteSavedTeam rejects 409 when the team has an active VALORANT binding", async () => {
  const team = { id: "saved-team-1", logoName: null, _count: { registrations: 0 } };
  const prismaMock = {
    prisma: {
      savedTeam: {
        findFirst: async () => team,
        delete: async () => { throw new Error("must not reach delete"); },
      },
      valorantTeamBinding: {
        findFirst: async ({ where }) => (where.savedTeamId === team.id && where.status === "active" ? { id: "binding-1" } : null),
      },
    },
  };
  const { module: teamService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: { persistTeamLogoUpload: async () => null, teamLogoDirectory: "uploads/team-logos", removeTeamLogoIfUnreferenced: async () => {} },
    [mailModulePath]: { sendTeamInviteEmail: async () => {} },
  });

  try {
    await assert.rejects(
      teamService.deleteSavedTeam({ teamId: "saved-team-1", user: { id: "user-1" } }),
      (error) => error instanceof HttpError && error.statusCode === 409 && /VALORANT binding/.test(error.message),
    );
  } finally {
    restore();
  }
});
```

Note: `team.service.test.js` must import `HttpError` — add `const { HttpError } = require("../src/lib/http-error");` at the top of the file, and confirm the existing mock for `uploadModulePath` includes the exact exports `deleteSavedTeam` already relies on (the current suite's mock map at `backend/tests/team.service.test.js:71-80` already provides `persistTeamLogoUpload`/`teamLogoDirectory`; extend with `removeTeamLogoIfUnreferenced` if the existing suite's mock already covers it — do not duplicate mocks).

Append to `backend/tests/admin.service.test.js`:

```js
test("deleteAdminSavedTeam rejects 409 when the team has an active VALORANT binding", async () => {
  const { module: adminService, restore } = loadModuleWithMocks(
    path.join(__dirname, "../src/modules/admin/admin.service.js"),
    {
      [prismaPath]: {
        prisma: {
          savedTeam: { findUnique: async () => ({ id: "saved-team-1", logoName: null }) },
          savedTeamMember: {},
          valorantTeamBinding: {
            findFirst: async ({ where }) => (where.savedTeamId === "saved-team-1" && where.status === "active" ? { id: "binding-1" } : null),
          },
          $transaction: async (callback) => callback({}),
        },
      },
      [httpErrorPath]: { HttpError },
      ...existingAdminServiceMocks,
    },
  );

  try {
    await assert.rejects(
      adminService.deleteAdminSavedTeam("saved-team-1"),
      (error) => error instanceof HttpError && error.statusCode === 409 && /VALORANT binding/.test(error.message),
    );
  } finally {
    restore();
  }
});
```

`existingAdminServiceMocks` = the module mocks the current `admin.service.test.js` already builds for `loadModuleWithMocks` (keep them; add only the `valorantTeamBinding` stub and `httpErrorPath` if not already mocked). Reuse the exact `prismaPath`/`httpErrorPath` constants the file already defines.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test tests/team.service.test.js
node --test tests/admin.service.test.js
```

Expected: FAIL — no 409; `deleteSavedTeam` proceeds to `prisma.savedTeam.delete` today.

- [ ] **Step 3: Implement the guards**

In `backend/src/modules/teams/team.service.js`, inside `deleteSavedTeam` (after the registrations check, before `prisma.savedTeam.delete`):

```js
  const activeBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId: team.id, status: "active" },
    select: { id: true },
  });
  if (activeBinding) {
    throw new HttpError(
      409,
      "This team cannot be deleted because it has an active VALORANT binding. Detach the VALORANT binding first."
    );
  }
```

In `backend/src/modules/admin/admin.service.js`, inside `deleteAdminSavedTeam` (after the `findUnique` 404 check, before `deleteMany`):

```js
  const activeBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId: team.id, status: "active" },
    select: { id: true },
  });
  if (activeBinding) {
    throw new HttpError(
      409,
      "This team cannot be deleted because it has an active VALORANT binding. Detach the VALORANT binding first."
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/team.service.test.js
node --test tests/admin.service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/teams/team.service.js backend/src/modules/admin/admin.service.js backend/tests/team.service.test.js backend/tests/admin.service.test.js
git commit -m "feat(valorant): guard SavedTeam deletion against active VALORANT bindings"
```

---

### Task 12: Database integration tests (bindings, ledger, guarded deletion, projection)

**Files:**
- Modify: `backend/tests/database-integration.test.js` (append tests)

**Interfaces:**
- Consumes: the real `prisma` client against the dedicated test project (`npm run test:integration`), the Task 2 tables/enums/trigger/partial index, `valorant.service` ledger helpers, `team.service.deleteSavedTeam`.
- Verifies (spec §11.3, Slice-0 acceptance): binding create/reuse, **one active binding per SavedTeam (DB-enforced)**, detached soft-state, guarded deletion (409) and bypassed deletion (trigger → `status=detached`, `saved_team_id` null), operation ledger transitions, match projection upsert/rebuild.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/database-integration.test.js`:

```js
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");
const { HttpError } = require("../src/lib/http-error");

test("VALORANT binding uniqueness and bypassed-deletion detach are DB-enforced", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const savedTeamId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();

  try {
    await prisma.user.create({
      data: {
        id: userId,
        firstName: "Valorant",
        lastName: "Integration",
        email: `val-${suffix}@example.com`,
        emailNormalized: `val-${suffix}@example.com`,
        username: `val-${suffix}`,
        usernameNormalized: `val-${suffix}`,
        passwordHash: "integration-test-hash",
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.savedTeam.create({
      data: { id: savedTeamId, captainUserId: userId, name: `VAL Team ${suffix}` },
    });

    await prisma.valorantTeamBinding.create({
      data: {
        id: bindingId,
        savedTeamId,
        valorantTeamUuid: "00000000-0000-4000-8000-000000000001",
        status: "active",
        boundByUserId: userId,
      },
    });

    // One active binding per SavedTeam: the partial unique index rejects a second.
    await assert.rejects(
      prisma.valorantTeamBinding.create({
        data: {
          savedTeamId,
          valorantTeamUuid: "00000000-0000-4000-8000-000000000002",
          status: "active",
          boundByUserId: userId,
        },
      }),
      (error) => error?.code === "P2002",
    );

    // Bypassed delete: FK SetNull nulls saved_team_id; the trigger detaches the binding.
    await prisma.savedTeam.delete({ where: { id: savedTeamId } });
    const after = await prisma.valorantTeamBinding.findUnique({ where: { id: bindingId } });
    assert.equal(after.savedTeamId, null);
    assert.equal(after.status, "detached");
    assert.ok(after.detachedAt instanceof Date);
  } finally {
    await prisma.valorantTeamBinding.deleteMany({ where: { boundByUserId: userId } });
    await prisma.savedTeam.deleteMany({ where: { id: savedTeamId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});

test("guarded deleteSavedTeam rejects 409 while an active binding exists", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const savedTeamId = crypto.randomUUID();

  try {
    await prisma.user.create({
      data: {
        id: userId,
        firstName: "Valorant",
        lastName: "Guard",
        email: `val-guard-${suffix}@example.com`,
        emailNormalized: `val-guard-${suffix}@example.com`,
        username: `val-guard-${suffix}`,
        usernameNormalized: `val-guard-${suffix}`,
        passwordHash: "integration-test-hash",
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.savedTeam.create({
      data: { id: savedTeamId, captainUserId: userId, name: `VAL Guard ${suffix}` },
    });
    await prisma.valorantTeamBinding.create({
      data: {
        savedTeamId,
        valorantTeamUuid: "00000000-0000-4000-8000-000000000003",
        status: "active",
        boundByUserId: userId,
      },
    });

    const teamService = require("../src/modules/teams/team.service");
    await assert.rejects(
      teamService.deleteSavedTeam({ teamId: savedTeamId, user: { id: userId } }),
      (error) => error instanceof HttpError && error.statusCode === 409,
    );

    const stillThere = await prisma.savedTeam.findUnique({ where: { id: savedTeamId } });
    assert.ok(stillThere, "the guarded delete must not remove the team");
  } finally {
    await prisma.valorantTeamBinding.deleteMany({ where: { boundByUserId: userId } });
    await prisma.savedTeam.deleteMany({ where: { id: savedTeamId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});

test("operation ledger transitions and match projection upsert work against PostgreSQL", {
  skip: !runDatabaseTests,
}, async () => {
  const { prisma } = require("../src/lib/prisma");
  const suffix = crypto.randomUUID();
  const servicePath = path.join(__dirname, "../src/modules/valorant/valorant.service.js");
  const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
  const clientPath = path.join(__dirname, "../src/modules/valorant/valorant.client.js");
  const mapperPath = path.join(__dirname, "../src/modules/valorant/valorant.mapper.js");
  const envPath = path.join(__dirname, "../src/config/env.js");
  const httpErrorPath = path.join(__dirname, "../src/lib/http-error.js");
  const operationId = crypto.randomUUID();
  let opRowId;

  try {
    const { module: service } = loadModuleWithMocks(servicePath, {
      [prismaPath]: { prisma },
      [clientPath]: {
        valorantRequest: async () => { throw new Error("must not call FastAPI"); },
      },
      [mapperPath]: {},
      [envPath]: { env: { VALORANT_INTERNAL_BASE_URL: "http://localhost:8000" } },
      [httpErrorPath]: { HttpError },
    });

    const op = await service.createOperation({
      type: "team_bind",
      externalKey: `ext-${suffix}`,
      actorUserId: null,
      requestBody: { marker: suffix },
    });
    opRowId = op.id;
    assert.equal(op.status, "pending");
    assert.equal(op.operationId.length, 36);

    const succeeded = await service.markOperationSucceeded(op.id, {
      status: 200,
      requestId: "fastapi-req-x",
      data: { ok: true },
    });
    assert.equal(succeeded.status, "succeeded");
    assert.equal(succeeded.fastapiRequestId, "fastapi-req-x");
    assert.equal(succeeded.responseCode, 200);

    // Projection upsert is idempotent by henrik_match_id.
    await prisma.questValorantMatch.upsert({
      where: { henrikMatchId: `henrik-${suffix}` },
      create: {
        matchId: crypto.randomUUID(),
        henrikMatchId: `henrik-${suffix}`,
        mapName: "Ascent",
        startedAt: new Date(),
        redScore: 13,
        blueScore: 8,
        winningSide: "red",
        rosterSummary: { players: [] },
      },
      update: { redScore: 13, blueScore: 8 },
    });
    const projection = await prisma.questValorantMatch.findUnique({
      where: { henrikMatchId: `henrik-${suffix}` },
    });
    assert.equal(projection.redScore, 13);
  } finally {
    if (opRowId) await prisma.questValorantOperation.deleteMany({ where: { id: opRowId } });
    await prisma.questValorantMatch.deleteMany({ where: { henrikMatchId: `henrik-${suffix}` } });
    await prisma.$disconnect();
  }
});
```

- [ ] **Step 2: Run to verify they fail (guarded delete only)**

Run: `npm run test:integration`
Expected: FAIL — the "guarded deleteSavedTeam rejects 409" test fails (delete proceeds today); the other two pass once Task 2 and Task 11 exist.

- [ ] **Step 3: Run to verify they pass**

Run: `npm run test:integration`
Expected: PASS — all three new DB tests plus the Task 2 RLS gate and the pre-existing suite.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/database-integration.test.js
git commit -m "test(valorant): add DB integration coverage for bindings, guarded deletion, ledger, and projections"
```

---

### Task 13: Final verification and migration-status guard

**Files:**
- Modify: none (verification only; if `npm run lint` flags the new module, fix inline and re-run)

**Interfaces:**
- Consumes: the complete Task 1–12 output.
- Produces: a verified, shippable commit point for the Quest backend slice.

- [ ] **Step 1: Run the full verification battery**

```bash
cd backend
npm run lint
npm test
npm run test:integration
npm run prisma:migrate:status
npm run prisma:security:verify
```

Expected: lint clean (0 errors); `npm test` PASS (all unit tests incl. `openapi.test.js`, `env.test.js`, `valorant-*.test.js`, `team.service.test.js`, `admin.service.test.js`); `npm run test:integration` PASS; `prisma:migrate:status` reports "Database schema is up to date"; `prisma:security:verify` exits 0.

- [ ] **Step 2: Verify the no-`valorant`-schema guard**

Confirm `git diff --stat` for the migration contains no reference to the `valorant` schema and that `backend/prisma/schema.prisma` contains no `@@map("valorant...")` or cross-schema `relation` to VAL tables. CI has no dedicated guard for this yet — record the check in the commit message.

```bash
grep -rn "valorant\." backend/prisma/ || echo "no valorant-schema references in prisma"
```

Expected: either no matches or only `valorant_team_bindings`-style public table names without a schema qualifier (no `"valorant".`).

- [ ] **Step 3: Final commit checkpoint**

```bash
git add backend/src/modules/valorant backend/tests/fixtures/valorant
git commit -m "chore(valorant): final verification pass for the Quest backend integration slice" || echo "nothing new to commit"
```

If Task 12's ledger test needed a different env shape for `valorant.service` (e.g. the full `VALORANT_*` map), adjust the mock inline and re-run Task 13 Step 1 before committing.

- [ ] **Step 4: Report remaining FastAPI prerequisites**

Record in the commit/PR description that the following sibling-repo deltas are required before end-to-end use: D1 service auth (HMAC bearer), D2 `teams.quest_saved_team_id`, D3 `series.external_quest_series_id`, D4 `unrated` mode, D5 reason-required forfeit/override, D6 anchor columns + rated verification, D7 audit fields in finalize, D8 chronological guard, D9 absolute desired-order endpoint (§4.4). Quest unit/contract tests in this plan are fixture-driven and pass without them; the two-service E2E suite (§11.4) and the backup change (§7.6) are out of this plan's scope.

---

## Plan Self-Review

**1. Spec coverage (approved spec §3.3, §4.3, §6.2–§6.6, §7.4–§7.5, §8, §9.2, §10.1, §11.1–§11.3):**
- §4.3 models + partial unique index → Task 2 (models, `--create-only` migration, appended partial index, trigger, RLS).
- §10.1 env vars + `.env.example` → Task 1.
- §6.3 HMAC bearer / token claims / kid / headers → Task 3.
- §6.6 client timeouts, retries, error mapping → Task 4 (with the recorded §6.5 table and fixture-driven tests).
- §6.4 request/response shapes → Task 4 (mapper) and Task 8 (request bodies).
- §5.1 bind/detach + one-active-binding + detach semantics → Task 6.
- §5.2 discovery + explicit selection + two-stage detail + projection → Task 7.
- §5.3/§5.4 series create with anchors + attach/reorder/remove/delete/preview → Task 8.
- §5.5/§8.2 finalize never blind-retried + operation `in_flight` before call → Task 9.
- §8.3 reconciliation report (orphaned/unprojected/team_missing/match_missing/stuck operations) → Task 9.
- §9.2 AuditLog + operation ledger + fastapiRequestId distinction → Tasks 6, 10.
- §6.2 route table + §9.1 requireAdmin guard → Task 10 (with `openapi.test.js` gate).
- §7.5 guarded `deleteSavedTeam` (+ `deleteAdminSavedTeam`) + SetNull + trigger → Tasks 2, 11, 12.
- §11.1 unit tests, §11.3 DB integration tests → Tasks 3–12.
- §7.6 backup change and §11.4 two-service E2E → explicitly out of scope, flagged in Task 13 Step 4.

**2. Placeholder scan:** no "TBD/TODO/implement later"; every code step contains concrete code; the two "existing mocks" references in Task 11 instruct reuse of the named existing fixtures with exact extension points rather than vague delegation.

**3. Type consistency:**
- `valorantRequest({ method, path, body, actorUserId, operationId, externalKey, idempotent }) → { status, data, requestId }` is defined in Task 4 and consumed identically in Tasks 6–9.
- Ledger helpers `createOperation`/`markOperationSucceeded`/`markOperationFailed`/`markOperationReconciliationRequired` (Task 6) match their Task 6–9 usage; `markOperationFailed` internally maps `FastApiError` → `failed` + `errorCode`, else `reconciliation_required`.
- Mapper names (`mapMatchCandidate`, `mapMatchDetail`, `mapSeriesView`, `mapGameView`, `mapPreview`, `mapFinalizeResult`, `mapTeamResponse`, `mapRatingEvent`, `mapRankingEntry`) are identical across Task 4 definitions and Task 6–9 usages.
- Service function signatures produced in Tasks 6–9 are consumed by Task 10's controller with the same argument names (`savedTeamId`, `bindingTeamAId`, `seriesId`, `ratingMode`, ...).
- Route paths in Task 10's table, `v1.js` block, `valorant-routes.test.js` inventory, and `openapi.js` paths are identical (`/api/v1/admin/valorant/...`).
- Prisma model/field names in Task 2 match Task 6–9 `prisma.<model>.<method>` calls (`valorantTeamBinding`, `questValorantSeries`, `questValorantSeriesGame`, `questValorantMatch`, `questValorantOperation`).

**Deviations re-confirmed:** D1 (routes inline in `v1.js` — `openapi.test.js` scanner constraint), D2 (trigger for bypassed-delete detach — Slice-0 acceptance requirement).
