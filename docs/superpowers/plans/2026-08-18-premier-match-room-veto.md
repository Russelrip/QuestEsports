# Premier Match-Room Veto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed an automatic Valorant Premier-style map-ban experience in every eligible match room, using the existing veto engine, with configurable active maps and no side-selection step.

**Architecture:** Reuse `VetoRoom` as the match-scoped state machine instead of creating a parallel voting system. Add a Premier BO1 preset whose six alternating bans are followed by automatic decider selection; the veto completes immediately after the last ban and the remaining map is the result. Match-room access ensures a linked veto room exists, while staff controls the active map catalog/pool and can override or reset the room.

**Tech Stack:** Express, Prisma/PostgreSQL, Jest/Node tests, Next.js/React/TypeScript, Tailwind-style utility classes, existing realtime polling/subscription helpers.

**Spec:** Approved architectural design in the conversation: integrate the existing veto flow into match rooms, use a Premier-style alternating ban sequence, automatically create the linked Valorant veto room, allow map enable/disable, and omit side selection.

## Global Constraints

- Preserve existing BO1/BO3/BO5/custom veto behavior.
- The Premier flow is six alternating bans followed by automatic selection of the sole remaining map.
- There is no side-selection step in Premier mode.
- Use only active maps in the selected pool; never mutate an in-progress room's snapshot.
- Keep staff authorization and optimistic revision checks on every mutation.
- Preserve public/private boundaries for team links, viewer links, and admin map controls.
- Follow `backend/prisma/codemap.md`: additive migrations only; never edit an applied migration.

---

### Task 1: Add the Premier veto state machine

**Files:**
- Modify: `backend/src/modules/veto/veto.service.js:6-117,565-618`
- Modify: `backend/src/modules/veto/veto.controller.js` only if a new format enum is exposed
- Test: `backend/tests/veto.service.test.js`

**Interfaces:**
- Produces a built-in `premier` preset returned by `getBuiltInSteps("premier")` and usable by `createRoom`.
- Premier rooms expose `format: "premier"`, six ban steps, one automatic decider, and no side action.
- Existing formats continue to validate and execute unchanged.

- [ ] **Step 1: Write failing service tests**

Add tests that assert:

```js
const steps = service.getBuiltInSteps("premier");
assert.deepEqual(steps, [
  { kind: "ban", actor: "A", seriesIndex: null },
  { kind: "ban", actor: "B", seriesIndex: null },
  { kind: "ban", actor: "A", seriesIndex: null },
  { kind: "ban", actor: "B", seriesIndex: null },
  { kind: "ban", actor: "A", seriesIndex: null },
  { kind: "ban", actor: "B", seriesIndex: null },
  { kind: "decider", actor: null, seriesIndex: 1 },
]);
```

Also test that `validateSteps(steps, "premier", 7)` succeeds, that the sequence rejects a seventh manual map action, and that `advanceAutomatic` completes immediately after the sixth ban rather than creating a side-selection turn.

- [ ] **Step 2: Run the focused test and confirm failure**

Run from `backend`:

```powershell
npm test -- --runInBand tests/veto.service.test.js
```

Expected: failure because `premier` is not an accepted format/preset and the current validator expects BO1/BO3/BO5/custom.

- [ ] **Step 3: Implement the minimal Premier format support**

Add `premier` to `FORMATS`, define its six-ban-plus-decider sequence, and make `validateSteps` expect one played map for `premier`. Keep the `side` action optional for custom presets but do not include it in the built-in Premier sequence. Ensure the automatic decider advances `currentStep` to the end and marks the room completed after the final ban.

- [ ] **Step 4: Run the focused tests and confirm they pass**

```powershell
npm test -- --runInBand tests/veto.service.test.js
```

Expected: PASS, including all pre-existing veto tests.

- [ ] **Step 5: Commit the isolated state-machine change**

```powershell
git add backend/src/modules/veto/veto.service.js backend/tests/veto.service.test.js
git commit -m "feat: add premier map ban preset"
```

Do not commit if the repository workflow forbids local commits; retain the staged-file scope for review.

### Task 2: Automatically provision a Premier veto room for Valorant match rooms

**Files:**
- Modify: `backend/src/modules/match-rooms/match-room.service.js:40-180,231-258`
- Modify: `backend/src/modules/veto/veto.service.js:351-406` to support a safe match-room provisioning helper
- Modify: `backend/src/modules/match-rooms/match-room.controller.js` only if the response contract needs an explicit provisioning status
- Test: `backend/tests/match-room.service.test.js`

**Interfaces:**
- Produces an idempotent helper, `ensureMatchVetoRoom({ match, user })`, that returns the existing linked room or creates one exactly once.
- The helper uses the tournament-scoped default template/map pool when valid, otherwise the built-in active seven-map pool and Premier sequence.
- Non-Valorant matches and terminal/cancelled matches do not receive an automatic veto room.

- [ ] **Step 1: Write failing provisioning tests**

Cover these cases with Prisma mocks matching the existing test style:

```js
await service.ensureMatchVetoRoom({ match: valorantMatch, user: staffUser });
assert.equal(prisma.vetoRoom.create.mock.calls.length, 1);
assert.equal(prisma.vetoRoom.create.mock.calls[0][0].data.matchId, valorantMatch.id);
assert.equal(prisma.vetoRoom.create.mock.calls[0][0].data.format, "premier");

await service.ensureMatchVetoRoom({ match: nonValorantMatch, user: staffUser });
assert.equal(prisma.vetoRoom.create.mock.calls.length, 0);
```

Also cover idempotency when `match.vetoRoom` already exists and a unique-race retry that reloads the linked room instead of creating a duplicate.

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
npm test -- --runInBand tests/match-room.service.test.js
```

Expected: failure because no exported provisioning helper exists.

- [ ] **Step 3: Implement idempotent provisioning**

Use the existing `createRoom` transaction path or extract a small shared constructor so participants come from `MatchParticipant`, the map snapshot is frozen at creation, and `createdById` is nullable for system provisioning. Select the tournament default template only when its format/pool is compatible; otherwise use the built-in Premier setup. Invoke provisioning from the match-room access path after the match room is ensured, then reload the room before mapping the response.

Do not auto-open or auto-start the veto: it should be available in `open` state so both teams can ready up, preserving the existing state transitions and staff override controls.

- [ ] **Step 4: Run focused backend tests**

```powershell
npm test -- --runInBand tests/match-room.service.test.js tests/veto.service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the provisioning change**

```powershell
git add backend/src/modules/match-rooms/match-room.service.js backend/src/modules/veto/veto.service.js backend/tests/match-room.service.test.js
git commit -m "feat: provision premier veto rooms for matches"
```

### Task 3: Add staff map enable/disable controls without changing live snapshots

**Files:**
- Modify: `backend/src/modules/veto/veto.service.js:260-329`
- Modify: `backend/src/modules/veto/veto.controller.js` and `backend/src/routes/v1.js` to expose the staff mutation
- Modify: `frontend/components/admin/AdminVetoRoomsManager.tsx:148-162,234-237`
- Modify: `frontend/lib/veto.ts` if the catalog type needs an `isActive` mutation response
- Test: `backend/tests/veto.service.test.js`

**Interfaces:**
- Produces a staff-only endpoint, `PATCH /api/v1/admin/veto/maps/:id`, accepting `{ isActive: boolean }`.
- Catalog responses continue to list map metadata and active status; inactive maps cannot be selected into newly created pools.
- Existing rooms retain their `configSnapshot.maps` even if a catalog map is later disabled.

- [ ] **Step 1: Write failing authorization and behavior tests**

Test that an admin can disable/enable a map, tournament staff cannot modify global maps unless the endpoint is explicitly scoped, invalid IDs return 404, and a disabled map is excluded from the default active catalog/pool creation list while existing room snapshots remain unchanged.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm test -- --runInBand tests/veto.service.test.js
```

Expected: failure because the mutation service/controller route does not exist.

- [ ] **Step 3: Implement the mutation and catalog filtering**

Add a minimal service method with admin authorization, wire it through the controller/router using the repository's established admin middleware, and filter active catalog/pool creation queries consistently. Do not physically delete maps or rewrite room snapshots.

- [ ] **Step 4: Add the admin control**

Render each catalog map with its artwork/accent treatment, status badge, and an enable/disable button. Refresh catalog data after the mutation and show a clear success/error message. Keep the existing pool-version workflow so enabling/disabling a map affects future room setup, not active matches.

- [ ] **Step 5: Run backend and frontend checks**

```powershell
cd backend; npm test -- --runInBand tests/veto.service.test.js
cd ..\frontend; npm test -- --runInBand
```

Expected: PASS for focused backend tests and the existing frontend test suite.

- [ ] **Step 6: Commit the map-management change**

```powershell
git add backend/src/modules/veto/veto.service.js backend/src/modules/veto/veto.controller.js backend/src/routes/v1.js backend/tests/veto.service.test.js frontend/components/admin/AdminVetoRoomsManager.tsx frontend/lib/veto.ts
git commit -m "feat: add veto map availability controls"
```

### Task 4: Redesign the embedded veto screen for Premier bans

**Files:**
- Modify: `frontend/components/veto/VetoRoomView.tsx:120-246`
- Modify: `frontend/lib/veto.ts` to include Premier format/status labels if needed
- Modify: the nearest existing frontend global stylesheet only if the component's existing `veto-*` classes are not sufficient
- Test: `frontend/tests/unit/veto-room-view.test.tsx` (create if absent)

**Interfaces:**
- The existing `VetoRoomView` remains the single live component used by `/veto/[code]`, admin control, and embedded match rooms.
- Premier mode renders a map-ban board, current-team turn indicator, alternating action history, six ban slots, and the surviving-map result.
- It never renders a side-selection prompt for `format === "premier"`.

- [ ] **Step 1: Write failing component tests**

Render a completed Premier room fixture and assert that:

```tsx
expect(screen.getByText(/Premier map veto/i)).toBeInTheDocument();
expect(screen.getByText(/Map locked/i)).toBeInTheDocument();
expect(screen.queryByText(/Choose Attack or Defense/i)).not.toBeInTheDocument();
```

Render an in-progress fixture with active and banned maps and assert that only the active team can select a map, banned cards are disabled, and the turn banner names the correct team.

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
npm test -- --runInBand tests/unit/veto-room-view.test.tsx
```

Expected: failure because Premier-specific labels/layout are not present.

- [ ] **Step 3: Implement the Premier presentation**

Preserve the current access, mutation, revision, realtime, countdown, and confirmation-modal logic. Add a format-specific board using the existing `artworkUrl`, `accentColor`, `resolveImageUrl`, and fallback handling. Use grounded copy such as “Ban phase”, “Your team’s turn”, “Banned”, and “Map locked”. Keep non-Premier rendering behavior unchanged.

- [ ] **Step 4: Run focused frontend tests and lint/type checks**

```powershell
npm test -- --runInBand tests/unit/veto-room-view.test.tsx
npm run lint
npm run typecheck
```

Expected: PASS with no new lint or type errors.

- [ ] **Step 5: Commit the UI change**

```powershell
git add frontend/components/veto/VetoRoomView.tsx frontend/lib/veto.ts frontend/tests/unit/veto-room-view.test.tsx
git commit -m "feat: add premier veto match room interface"
```

### Task 5: Seed official map artwork and verify the end-to-end flow

**Files:**
- Modify: `backend/prisma/migrations/<new-timestamp>_add_veto_map_artwork/migration.sql`
- Modify: `backend/prisma/schema.prisma` only if the chosen asset representation requires a new field (prefer existing `artworkUrl`)
- Modify: `frontend/components/admin/AdminVetoRoomsManager.tsx` only if artwork preview needs a small follow-up
- Test: `backend/tests/match-room.service.test.js`, `backend/tests/veto.service.test.js`, and frontend component tests
- Update: relevant docs under `docs/` if the API/admin contract changes

**Interfaces:**
- Existing `VetoMap.artworkUrl` is populated for the canonical Valorant maps using stable, licensed/project-owned assets or approved remote URLs.
- No UI depends on an unverified third-party hotlink; failed images continue to use the existing fallback.

- [ ] **Step 1: Identify and validate image sources**

Use official or project-licensed map artwork, record the source/license decision in the migration or documentation, and verify every URL with an HTTP request before committing it. If no stable licensed source is available, keep the accent-gradient fallback rather than importing copyrighted assets blindly.

- [ ] **Step 2: Add an additive data migration**

Update only `artwork_url` for known slugs with guarded `UPDATE ... WHERE slug = ...` statements. Do not edit `20260814120000_add_valorant_veto_rooms` because it is an existing migration.

- [ ] **Step 3: Run the complete verification set**

```powershell
cd backend; npm test -- --runInBand
cd ..\frontend; npm test -- --runInBand; npm run lint; npm run typecheck; npm run build
```

Also verify manually: create/access a Valorant match room, confirm the linked Premier veto appears, ready/start both teams, alternate six bans, confirm the seventh map locks automatically, confirm no side-selection UI appears, and disable a map for future rooms without changing the active room snapshot.

- [ ] **Step 4: Review the final diff and update docs/codemaps**

Review `git diff`, confirm only intended files changed, document the match-room/veto flow in the relevant API/admin documentation, and update a codemap only if directory responsibility or data flow changed.
