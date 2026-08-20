# Team Logo Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SavedTeam.logoName` authoritative for every linked local team appearance while preserving snapshots for unlinked registrations.

**Architecture:** Add a small backend resolver with explicit null semantics, then use it in all local registration projections. Both captain and admin mutations will update the saved team and every linked registration transactionally; route middleware will invalidate both `tournaments` and `foundation`. Existing bracket/match snapshots remain unchanged and old logo files are queued for delayed reference-aware cleanup.

**Tech Stack:** Node.js, Express, Prisma, PostgreSQL, Node test runner, ESLint, React/Next.js frontend clients.

**Spec:** `docs/superpowers/specs/2026-08-20-team-logo-propagation-design.md`

## Global Constraints

- `SavedTeam.logoName` is authoritative for linked registrations, including `null`.
- Unlinked registrations use `TeamRegistration.teamLogoName` as their historical fallback.
- Update linked registrations for both paid and unpaid registrations.
- Do not rewrite bracket, match, room, or Challonge snapshots for logo changes.
- Invalidate `tournaments` and `foundation` only after successful 2xx mutations.
- Do not synchronize external VALORANT/Riot-owned logo metadata.
- Do not add a schema migration, event bus, or logo-version subsystem.

---

## File Map

- Create `backend/src/modules/teams/team-logo.js`: shared effective-logo filename and URL projection helpers.
- Create `backend/tests/team-logo.test.js`: resolver contract tests.
- Modify `backend/src/modules/tournaments/tournament.service.js`, `bracket.service.js`, `matches/match.service.js`, `match-rooms/match-room.service.js`, `challonge/challonge.service.js`, and `admin/admin.service.js`: consume the shared resolver.
- Modify `backend/tests/tournament.service.test.js`, `bracket.service.test.js`, `admin.service.test.js`, and add focused match/match-room/Challonge assertions where those suites already fixture the projections.
- Modify `backend/src/modules/teams/team.service.js`: captain mutation transaction and logo cleanup scheduling.
- Modify `backend/src/modules/admin/admin.service.js`: admin mutation transaction and logo/name separation.
- Modify `backend/src/modules/teams/team.routes.js` and `backend/src/modules/admin/admin.routes.js`: cache tags.
- Modify `backend/src/lib/upload-cleanup.js`, `backend/src/lib/upload-cleanup-job.js`, and `backend/src/lib/jobs.js` only as needed for delayed logo cleanup.
- Modify `backend/tests/team.service.test.js`, `admin.service.test.js`, and `upload-lifecycle.test.js`: mutation, rollback, cache, and cleanup regressions.
- No frontend source change is expected; the existing clients already reload the returned team and use API-provided logo URLs. Verify `frontend/tests/unit/teams.test.ts` if the response mapping changes.

## Task 1: Add the canonical logo resolver

**Files:**
- Create: `backend/src/modules/teams/team-logo.js`
- Test: `backend/tests/team-logo.test.js`

**Interfaces:**
- Produces `resolveEffectiveTeamLogoName(registration) -> string | null`.
- Produces `getTeamLogoUrl(filename) -> string | null`.
- A linked registration is identified by a non-null `registration.savedTeam` object; its `savedTeam.logoName` is returned even when null.

- [ ] **Step 1: Write failing resolver tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveEffectiveTeamLogoName,
  getTeamLogoUrl,
} = require("../src/modules/teams/team-logo");

test("uses the linked saved team logo", () => {
  assert.equal(
    resolveEffectiveTeamLogoName({
      teamLogoName: "stale.png",
      savedTeam: { logoName: "current.png" },
    }),
    "current.png"
  );
});

test("does not resurrect a registration snapshot after linked logo removal", () => {
  assert.equal(
    resolveEffectiveTeamLogoName({
      teamLogoName: "stale.png",
      savedTeam: { logoName: null },
    }),
    null
  );
});

test("uses the snapshot only after the registration is unlinked", () => {
  assert.equal(
    resolveEffectiveTeamLogoName({ teamLogoName: "historical.png", savedTeam: null }),
    "historical.png"
  );
  assert.equal(getTeamLogoUrl(null), null);
  assert.equal(getTeamLogoUrl("current.png"), "/api/uploads/team-logos/current.png");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `backend`:

```bash
node --test tests/team-logo.test.js
```

Expected: FAIL because `backend/src/modules/teams/team-logo.js` does not exist.

- [ ] **Step 3: Implement the smallest resolver**

```js
const resolveEffectiveTeamLogoName = (registration) => {
  if (registration?.savedTeam) return registration.savedTeam.logoName ?? null;
  return registration?.teamLogoName ?? null;
};

const getTeamLogoUrl = (filename) =>
  filename ? `/api/uploads/team-logos/${filename}` : null;

module.exports = { resolveEffectiveTeamLogoName, getTeamLogoUrl };
```

- [ ] **Step 4: Run the focused test and verify it passes**

```bash
node --test tests/team-logo.test.js
```

Expected: PASS for all resolver cases.

## Task 2: Replace consumer-specific logo fallback logic

**Files:**
- Modify: `backend/src/modules/tournaments/tournament.service.js`
- Modify: `backend/src/modules/tournaments/bracket.service.js`
- Modify: `backend/src/modules/matches/match.service.js`
- Modify: `backend/src/modules/match-rooms/match-room.service.js`
- Modify: `backend/src/modules/challonge/challonge.service.js`
- Modify: `backend/src/modules/admin/admin.service.js`
- Test: `backend/tests/tournament.service.test.js`, `backend/tests/bracket.service.test.js`, `backend/tests/admin.service.test.js`, and the existing match/match-room/Challonge suites when present

**Interfaces:**
- Consumes `resolveEffectiveTeamLogoName` and `getTeamLogoUrl` from Task 1.
- Produces identical projection shapes with corrected replacement and removal semantics.

- [ ] **Step 1: Add regression assertions before changing consumers**

Use the existing fixtures and service invocation helpers. For each projection that joins `savedTeam`, include a linked registration shaped like:

```js
{
  teamLogoName: "stale.png",
  savedTeam: { logoName: null }
}
```

Assert the returned `logoUrl` is `null`, and retain an unlinked fixture with `teamLogoName: "historical.png"` that still returns `/api/uploads/team-logos/historical.png`. Extend the existing native bracket linked-null regression rather than duplicating its fixture setup.

- [ ] **Step 2: Run the affected projection tests and verify the removal regressions fail**

```bash
node --test tests/tournament.service.test.js tests/bracket.service.test.js tests/admin.service.test.js
```

Expected: at least match, match-room, Challonge, or admin projection assertions fail where the current code uses a truthiness fallback or only `teamLogoName`.

- [ ] **Step 3: Import and use the resolver in every local consumer**

Replace local implementations and fallbacks with the shared rule. The essential replacement is:

```js
const logoName = resolveEffectiveTeamLogoName(registration);
const logoUrl = getTeamLogoUrl(logoName);
```

Do not change public response field names. Keep each Prisma selection including `savedTeam.logoName` wherever the resolver needs it. In `admin.service.js`, load the saved team relation for registration projections instead of reading only `registration.teamLogoName`.

- [ ] **Step 4: Run the projection tests and verify they pass**

```bash
node --test tests/tournament.service.test.js tests/bracket.service.test.js tests/admin.service.test.js
```

Expected: PASS, including linked replacement, linked removal, and unlinked snapshot cases.

## Task 3: Propagate captain logo changes transactionally

**Files:**
- Modify: `backend/src/modules/teams/team.service.js`
- Test: `backend/tests/team.service.test.js`

**Interfaces:**
- Preserve `updateSavedTeam({ teamId, user, body, file })` and its response contract.
- Explicit logo mutation means `file` is present or `removeLogo` is true.
- Metadata-only edits must not include `logoName` in the `savedTeam.update` data object.

- [ ] **Step 1: Add failing captain mutation tests**

Cover replacement and removal for linked paid and unpaid registrations, plus metadata-only behavior:

```js
assert.deepEqual(savedTeamUpdate.data.logoName, "new.png");
assert.equal(teamRegistrationUpdateMany.data.teamLogoName, "new.png");
assert.equal(teamRegistrationUpdateMany.where.savedTeamId, teamId);
assert.equal(metadataOnlyUpdate.data.logoName, undefined);
```

Also add a transaction failure case asserting the newly persisted upload is removed while the old filename remains referenced.

- [ ] **Step 2: Run the captain service tests and verify the new cases fail**

```bash
node --test tests/team.service.test.js
```

Expected: current code updates only `SavedTeam`, skips paid-registration propagation, and always writes `logoName` for metadata-only edits.

- [ ] **Step 3: Implement explicit mutation detection and propagation**

Compute the mutation flag before calculating the next value:

```js
const logoMutationRequested = Boolean(file) || removeLogo;
const nextLogoName = file
  ? persistedLogo.filename
  : removeLogo
    ? null
    : existingTeam.logoName;
```

Inside `runTeamSyncTransaction`, update the saved team with `logoName` only when `logoMutationRequested`, then update all rows with `savedTeamId: teamId` using `teamLogoName: nextLogoName` only for that same explicit mutation. Keep member/invite behavior unchanged. Read the current saved-team logo inside the transaction before applying an explicit mutation, and use the committed transition to schedule old-file cleanup.

- [ ] **Step 4: Run the captain service tests and verify they pass**

```bash
node --test tests/team.service.test.js
```

Expected: replacement/removal updates both paid and unpaid linked registrations, metadata-only edits omit `logoName`, and rollback preserves the old reference.

## Task 4: Apply the same propagation boundary to admin edits

**Files:**
- Modify: `backend/src/modules/admin/admin.service.js`
- Test: `backend/tests/admin.service.test.js`

**Interfaces:**
- Preserve `updateAdminSavedTeam(teamId, body, file)` and its response contract.
- Preserve existing roster and team-name synchronization.
- Logo synchronization must be independent of bracket/schedule name synchronization.

- [ ] **Step 1: Add failing admin tests for replacement, removal, and logo-only edits**

Use the existing transaction mocks and linked-registration fixtures. Assert:

```js
assert.equal(savedTeamUpdate.data.logoName, "new.png");
assert.equal(registrationUpdateMany.data.teamLogoName, "new.png");
assert.equal(bracketUpdate.mock.calls.length, 0);
assert.equal(scheduleUpdate.mock.calls.length, 0);
```

For removal, assert both fields become `null`; for a metadata-only edit, assert neither field is written. Include paid and unpaid linked registrations in the fixture.

- [ ] **Step 2: Run the admin service tests and verify the new cases fail**

```bash
node --test tests/admin.service.test.js
```

Expected: current code performs some snapshot propagation but couples it to the existing name path and does not distinguish no-logo edits robustly.

- [ ] **Step 3: Refactor the admin transaction**

Use the same explicit mutation flag as Task 3. Build `savedTeam.update.data` and `teamRegistration.updateMany.data` separately:

```js
const savedTeamData = { name, teamTag, country, organizationName };
if (logoMutationRequested) savedTeamData.logoName = nextLogoName;

const registrationData = { teamName: name };
if (logoMutationRequested) registrationData.teamLogoName = nextLogoName;
```

Always synchronize `teamName` for linked registrations. Run bracket and schedule JSON synchronization only when the team name actually changes. Never rewrite those JSON fields for a logo-only mutation.

- [ ] **Step 4: Run the admin service tests and verify they pass**

```bash
node --test tests/admin.service.test.js
```

Expected: all existing admin behavior plus replacement/removal and logo-only isolation passes.

## Task 5: Invalidate all local response caches after successful mutations

**Files:**
- Modify: `backend/src/modules/teams/team.routes.js`
- Modify: `backend/src/modules/admin/admin.routes.js`
- Test: the existing route/middleware test location, or add `backend/tests/team-logo-cache.test.js` if no route test currently covers these declarations

**Interfaces:**
- Continue using `invalidateCache(...tags)` from `backend/src/middleware/response-cache.js`.
- Captain `PATCH /teams/:teamId` and admin `PATCH /admin/teams/:teamId` must use `invalidateCache("tournaments", "foundation")`.

- [ ] **Step 1: Add a route/cache regression test**

Assert the route middleware is configured with both tags, and exercise the middleware with a 2xx and a 4xx response to verify only successful responses call `cache.invalidateTags(["tournaments", "foundation"])`.

- [ ] **Step 2: Run the focused cache test and verify it fails**

```bash
node --test tests/team-logo-cache.test.js
```

Expected: the captain route currently has no invalidation middleware and the admin route currently invalidates only `tournaments`.

- [ ] **Step 3: Update both route declarations**

```js
router.patch(
  "/teams/:teamId",
  requireAuth,
  requireVerifiedEmail,
  manageTeamRateLimiter,
  imageUpload.single("teamLogo"),
  invalidateCache("tournaments", "foundation"),
  updateProfileTeam
);
```

Apply the same two-tag middleware to the admin team patch route. Do not invalidate on GET, failed mutations, or unrelated organization edits.

- [ ] **Step 4: Run the cache test and verify it passes**

```bash
node --test tests/team-logo-cache.test.js
```

Expected: both routes invalidate both tags only after successful responses.

## Task 6: Delay old-logo cleanup and preserve reference checks

**Files:**
- Modify: `backend/src/lib/upload-cleanup.js`
- Modify: `backend/src/lib/upload-cleanup-job.js`
- Modify: `backend/src/lib/jobs.js` only if the existing queue options need to be exposed
- Modify: `backend/src/modules/teams/team.service.js`
- Modify: `backend/src/modules/admin/admin.service.js`
- Test: `backend/tests/upload-lifecycle.test.js`

**Interfaces:**
- Preserve `removeTeamLogoIfUnreferenced({ prisma, filename, context })` for callers that need immediate reference checks.
- Add a delayed enqueue path that uses `enqueueJob(TEAM_LOGO_CLEANUP_JOB_NAME, { filename }, { availableAt })`.
- The worker must recheck both `teamRegistration.teamLogoName` and `savedTeam.logoName` immediately before deletion.

- [ ] **Step 1: Add failing delayed-cleanup tests**

Assert a replaced old filename is queued with an `availableAt` at least the configured grace window in the future, and that `processTeamLogoCleanupJob` leaves a file in place when either reference count is nonzero.

```js
const before = Date.now() + TEAM_LOGO_CLEANUP_GRACE_MS;
assert.ok(enqueued.availableAt.getTime() >= before);
```

Retain coverage that an unlinked registration snapshot prevents deletion.

- [ ] **Step 2: Run upload lifecycle tests and verify the delayed case fails**

```bash
node --test tests/upload-lifecycle.test.js
```

Expected: current mutation paths call immediate cleanup and the queue payload has no delayed availability.

- [ ] **Step 3: Add the delayed, reference-aware cleanup path**

Define one shared grace window in the cleanup module, using the greater of the configured API cache TTL and one hour. Enqueue cleanup after the successful database transaction:

```js
const TEAM_LOGO_CLEANUP_GRACE_MS = Math.max(
  Number(env.CACHE_TTL_SECONDS || 0) * 1000,
  60 * 60 * 1000
);

await enqueueJob(
  TEAM_LOGO_CLEANUP_JOB_NAME,
  { filename: previousLogoName },
  { availableAt: new Date(Date.now() + TEAM_LOGO_CLEANUP_GRACE_MS) }
);
```

Keep rollback cleanup immediate for a newly uploaded file that was never committed. Keep the worker's two-table reference check as the final deletion gate and route any database/read failure through the existing retry behavior.

- [ ] **Step 4: Run upload and mutation lifecycle tests and verify they pass**

```bash
node --test tests/upload-lifecycle.test.js tests/team.service.test.js tests/admin.service.test.js
```

Expected: old files are delayed and reference-checked; new failed uploads are removed; historical unlinked snapshots preserve their files.

## Task 7: Full focused verification and integration review

**Files:**
- No new source files.
- Review all modified files from Tasks 1–6 and `frontend/tests/unit/teams.test.ts` if API mapping coverage is affected.

- [ ] **Step 1: Run all backend logo-related suites**

```bash
cd backend
node --test tests/team-logo.test.js tests/team.service.test.js tests/admin.service.test.js tests/bracket.service.test.js tests/tournament.service.test.js tests/registration.service.test.js tests/upload-lifecycle.test.js
```

Expected: PASS with no skipped logo propagation regressions.

- [ ] **Step 2: Run backend lint**

```bash
cd backend
npm run lint
```

Expected: exit code 0.

- [ ] **Step 3: Run frontend team mapping tests**

```bash
cd frontend
npx vitest run tests/unit/teams.test.ts
```

Expected: PASS. If no frontend mapping files changed, this confirms the existing clients still accept refreshed API data.

- [ ] **Step 4: Search for stale truthiness fallbacks**

```bash
rg "savedTeam\?\.logoName \|\| .*teamLogoName|savedTeam\.logoName \|\| .*teamLogoName" backend/src
```

Expected: no local consumer fallback remains; any intentional unrelated match must be reviewed before completion.

- [ ] **Step 5: Review the final diff against the approved spec**

Confirm there is no schema migration, no external VALORANT logo synchronization, no persisted bracket/match snapshot rewrite for logo changes, and no cache invalidation on failed mutations.
