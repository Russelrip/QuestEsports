# Integrated Valorant Map Veto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** Launch a complete Valorant BO1/BO3/BO5 map-veto workflow from an
existing QuestEsports match, with role-specific Admin, team, spectator, and
caster access.

**Architecture:** Extend the existing `VetoRoom` persistence and SSE/polling
subsystem. Add an additive `caster` access role, validate linked matches at the
service boundary, expose a match-prefilled admin launch path, and refine the
existing role-aware veto UI instead of building a second room system.

**Tech Stack:** Node.js 24, Express 5, Prisma 6, PostgreSQL, Next.js 16,
React 19, TypeScript, Tailwind CSS 4, Vitest, Node test runner, and Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-integrated-valorant-map-veto-design.md`

## Global Constraints

- Support Valorant only in this release; integrated formats are BO1, BO3, and BO5.
- Reuse `VetoRoom`, `VetoRoomAction`, hashed access grants, exact-room SSE, and five-second visible-tab polling.
- Add only the `caster` value to `VetoAccessRole`; do not edit the applied original veto migration.
- Keep the backend authoritative for turns, deadlines, state transitions, and revision conflicts.
- Do not include access tokens in public match DTOs or public browser metadata.
- Use QuestEsports’ black/navy and purple/fuchsia brand system; do not copy external RNGX branding.
- Preserve keyboard access, mobile stacking, and reduced-motion behavior.
- Read and update the nearest codemap before changing a documented responsibility.
- Do not modify unrelated working-tree changes.

## File structure and ownership

### Backend

- Modify `backend/prisma/schema.prisma` — declare `caster` in `VetoAccessRole`.
- Create `backend/prisma/migrations/20260831120000_add_caster_veto_access_role/migration.sql` — add the enum value to existing databases.
- Modify `backend/prisma/codemap.md` — document the migration and deployment boundary.
- Modify `backend/src/modules/veto/veto.service.js` — linked-match validation, team snapshots, caster grants, and access mapping.
- Modify `backend/tests/veto.service.test.js` — service behavior and security coverage.
- Modify `backend/tests/veto-routes.test.js` — route contract coverage where the response shape changes.

### Frontend

- Modify `frontend/lib/veto.ts` — caster access type, issued-token type, and share-link helper.
- Modify `frontend/lib/match-rooms.ts` — tournament and veto identifiers needed by admin navigation.
- Modify `frontend/components/admin/AdminMatchRoomsManager.tsx` — match-context Start/Open Veto actions.
- Modify `frontend/components/admin/AdminVetoRoomsManager.tsx` — query prefill, linked-match restrictions, and caster links.
- Modify `frontend/components/veto/VetoRoomView.tsx` — distinct read-only caster presentation.
- Modify `frontend/components/match-rooms/MatchRoomView.tsx` — identify the read-only veto state without adding a second launch path.
- Create `frontend/tests/unit/admin-veto-integration.test.tsx` — admin navigation and prefill tests.
- Create `frontend/tests/unit/veto-room-view.test.tsx` — caster isolation tests.
- Create `frontend/tests/e2e/integrated-veto.spec.ts` — staff launch and multi-role workflow.

## Implementation tasks

### Task 1: Add the caster access role safely

**Files:**

- Modify: `backend/prisma/schema.prisma:344-348`
- Create: `backend/prisma/migrations/20260831120000_add_caster_veto_access_role/migration.sql`
- Modify: `backend/prisma/codemap.md`
- Modify: `backend/src/modules/veto/veto.service.js:201-220,395-466,792-803`
- Test: `backend/tests/veto.service.test.js`

**Interfaces:**

- Consumes: Existing `VetoAccessGrant.role`, `createRoom`, `getRoom`, and `rotateGrant` contracts.
- Produces: `issuedTokens.caster: string`; `VetoRoom.access.kind === "caster"`; `rotateGrant({ role: "caster" })` support.

- [ ] **Step 1: Write the failing access test**

Append a focused test to `backend/tests/veto.service.test.js` using the existing
`loadModuleWithMocks` helper. Use a `link_only` open room with empty maps and
steps, return a live `caster` grant only when the SHA-256 hash matches
`caster-grant`, and assert:

```js
const result = await service.getRoom({ code: room.code, user: null, token: "caster-grant" });
assert.deepEqual(result.access, { kind: "caster", slot: null });
```

Extend the existing room-creation fixture to assert a non-empty
`issuedTokens.caster` and a created grant with `role: "caster"`. Extend the
rotation path to assert that rotating `caster` returns a token.

- [ ] **Step 2: Run the focused test and verify failure**

Run from `backend`:

```bash
node --test tests/veto.service.test.js
```

Expected: the new test fails because `caster` is not accepted or resolved.

- [ ] **Step 3: Add the additive Prisma migration**

Add `caster` to the schema enum and create the migration with exactly:

```sql
ALTER TYPE "VetoAccessRole" ADD VALUE IF NOT EXISTS 'caster';
```

Do not edit `20260814120000_add_valorant_veto_rooms`. Add a migration-list entry
to `backend/prisma/codemap.md` stating that `prisma migrate deploy` must apply
this migration before code writes caster grants.

- [ ] **Step 4: Implement issuance, resolution, and rotation**

In `veto.service.js`, add `caster` to `issuedTokens`, always create one caster
grant, map a valid caster grant to `{ kind: "caster", slot: null }`, accept
`caster` in `rotateGrant`, and preserve the kind in `mapRoom`. Leave viewer
issuance controlled by `viewerEnabled`. Existing mutation methods must continue
to authorize only `access.kind === "team"` for team actions.

- [ ] **Step 5: Run validation**

```bash
node --test tests/veto.service.test.js
npx prisma validate
npx prisma generate
```

Expected: all service tests pass and the generated client contains the caster
enum value.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/codemap.md backend/prisma/migrations/20260831120000_add_caster_veto_access_role/migration.sql backend/src/modules/veto/veto.service.js backend/tests/veto.service.test.js
git commit -m "feat: add caster access to veto rooms"
```

### Task 2: Validate linked matches and snapshot team identity

**Files:**

- Modify: `backend/src/modules/veto/veto.service.js:223-285,395-466`
- Test: `backend/tests/veto.service.test.js`
- Test: `backend/tests/veto-routes.test.js` if the mocked create response needs caster coverage

**Interfaces:**

- Consumes: `POST /api/v1/admin/veto-rooms` fields `matchId`, `format`, `mapPoolId`, `rulePresetId`, and room settings.
- Produces: Exactly two Valorant match-derived participants and `configSnapshot.participants[].logoUrl` values, with no client-supplied replacement for linked teams.

- [ ] **Step 1: Write failing linked-match tests**

Add a `createRoom` fixture with a scheduled Valorant match, two participants,
registration logo sources, a seven-map Valorant pool, and a valid BO1 preset.
Assert:

```js
assert.equal(result.room.participants[0].displayName, "Alpha");
assert.equal(created[0].configSnapshot.participants[0].logoUrl, "/api/uploads/team-logos/alpha.svg");
assert.equal(created[0].configSnapshot.participants[1].logoUrl, "/api/uploads/team-logos/bravo.svg");
```

Add rejection cases that assert status 400 and zero transaction calls for a
non-Valorant linked tournament, a linked match with one participant, and a pool
with a non-Valorant map. Preserve the existing 409 assertion for an existing
linked veto room.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test tests/veto.service.test.js tests/veto-routes.test.js
```

Expected: the new assertions fail because current linked creation can fall back
to generic team names and does not validate game or pool identity.

- [ ] **Step 3: Implement validation and snapshots**

In `createRoom`, include tournament game and registration logo fields in the
match lookup. Reject linked matches unless the tournament game is Valorant and
there are exactly two ordered participants. Reject pools unless the pool and
all active maps are Valorant. Build `configSnapshot.participants` with slot,
display name, seed, registration ID, and a project-relative logo URL using
`resolveEffectiveTeamLogoName` and `getTeamLogoUrl` from
`backend/src/modules/teams/team-logo.js`. Extend `mapRoom` to return snapshot
`logoUrl` or `null` for old rooms.

- [ ] **Step 4: Run tests**

```bash
node --test tests/veto.service.test.js tests/veto-routes.test.js
```

Expected: PASS, including existing permission, duplicate-match, and route tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/veto/veto.service.js backend/tests/veto.service.test.js backend/tests/veto-routes.test.js
git commit -m "feat: validate linked Valorant veto matches"
```

### Task 3: Add typed admin launch navigation

**Files:**

- Modify: `frontend/lib/veto.ts:43-104`
- Modify: `frontend/lib/match-rooms.ts:17-27`
- Modify: `frontend/components/admin/AdminMatchRoomsManager.tsx:12-27,55`
- Modify: `frontend/components/admin/AdminVetoRoomsManager.tsx:16-127,211-227,229-260`
- Test: `frontend/tests/unit/admin-veto-integration.test.tsx`

**Interfaces:**

- Consumes: `MatchRoom.match.veto`, `VetoRoom`, and `POST /api/v1/admin/veto-rooms`.
- Produces: Match-context links to `/admin/veto-rooms?matchId=<id>&tournamentId=<id>` and `/admin/veto-rooms?roomId=<id>`, plus `IssuedTokens.caster`.

- [ ] **Step 1: Write failing frontend tests**

Use Vitest/jsdom and Testing Library conventions from
`frontend/tests/unit/admin-support.test.tsx`. Mock room/catalog requests and
assert the unlinked card renders:

```tsx
expect(screen.getByRole("link", { name: /start map veto/i })).toHaveAttribute(
  "href",
  "/admin/veto-rooms?matchId=match-1&tournamentId=tournament-1",
);
```

Set the browser URL to
`/admin/veto-rooms?matchId=match-1&tournamentId=tournament-1`, render the veto
manager, and assert the wizard opens with the match selected, manual team
inputs absent, and a linked room can be selected from `roomId`. Assert that the
private-link list contains caster.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
npx vitest run tests/unit/admin-veto-integration.test.tsx
```

Expected: FAIL because the match-room card has no Start Veto action and the
manager ignores query context.

- [ ] **Step 3: Implement types and link construction**

In `frontend/lib/veto.ts`, add `logoUrl?: string | null`, add `caster` to the
access-kind union, export `IssuedTokens` with `team1`, `team2`, `viewer`, and
`caster`, and add:

```ts
export const buildVetoShareUrl = (origin: string, code: string, token: string) =>
  `${origin}/veto/${encodeURIComponent(code)}#access=${encodeURIComponent(token)}`;
```

In `frontend/lib/match-rooms.ts`, type the nested tournament with `id` and the
nested veto summary with `id`.

- [ ] **Step 4: Implement admin match context**

In `AdminMatchRoomsManager`, render **Start map veto** for an unlinked match and
**Open existing veto** for a linked match using the exact query URLs above. In
`AdminVetoRoomsManager`, read `matchId`, `tournamentId`, and `roomId` with
`useSearchParams`, open/select the requested context after loading, hide manual
team fields for linked matches, restrict linked format choices to BO1/BO3/BO5,
and extend private-link cards to `team_1`, `team_2`, `viewer`, and `caster`.
Use `buildVetoShareUrl` for copy/open actions and keep token values only in
authenticated component state.

When a concurrent create receives the service’s existing-match 409, reload
`/api/v1/admin/veto-rooms`, find the room whose `match.id` equals the selected
match, select it, and show **Open existing veto**. Do not attempt to issue or
display replacement credentials for that room.

- [ ] **Step 5: Run frontend checks**

```bash
npx vitest run tests/unit/admin-veto-integration.test.tsx
npm run typecheck
npm run lint
```

Expected: PASS with no unused query/state variables.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/veto.ts frontend/lib/match-rooms.ts frontend/components/admin/AdminMatchRoomsManager.tsx frontend/components/admin/AdminVetoRoomsManager.tsx frontend/tests/unit/admin-veto-integration.test.tsx
git commit -m "feat: launch linked veto rooms from match management"
```

### Task 4: Implement the distinct read-only caster view

**Files:**

- Modify: `frontend/components/veto/VetoRoomView.tsx:26-39,120-158,173-260`
- Modify: `frontend/components/match-rooms/MatchRoomView.tsx:113-119`
- Modify: `frontend/app/globals.css` only for named caster styling if required
- Test: `frontend/tests/unit/veto-room-view.test.tsx`

**Interfaces:**

- Consumes: `VetoRoom.access.kind === "caster"` and `VetoParticipant.logoUrl`.
- Produces: A broadcast-friendly view that cannot ready, toss, choose Team A, ban, pick, choose side, rewind, reset, cancel, or rotate links.

UI/UX ownership for this task belongs to `@designer` during execution. Preserve
the approved dark, condensed, high-contrast esports hierarchy and existing
reduced-motion behavior.

- [ ] **Step 1: Write failing role-isolation tests**

Mock a room with access `{ kind: "caster", slot: null }`, a Team A ban as the
current action, and an Ascent map. Assert **Live broadcast** renders, no
Ready/Heads/Tails/Attack/Defense control exists, and the Ascent map is disabled.
Add a team-access fixture asserting its active map remains enabled.

```tsx
expect(await screen.findByText(/live broadcast/i)).toBeInTheDocument();
expect(screen.queryByRole("button", { name: /ready up|heads|tails|attack|defense/i })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: /ascent/i })).toBeDisabled();
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
npx vitest run tests/unit/veto-room-view.test.tsx
```

Expected: FAIL because caster is not represented in the frontend union or role label.

- [ ] **Step 3: Implement caster presentation**

Add a role label with **Live broadcast** for caster and **Spectator** for
viewer/public. Add a named caster root/layout class, keep team header/current
turn/timer/maps/history/completion visible, hide revision and management-only
details, render snapshot logos with initials/accent fallback, and add
`aria-live` to status/turn updates. Ensure caster never satisfies existing
`canAct`, `canCall`, `canChooseOrder`, or `actionAllowed` conditions. Keep
`prefers-reduced-motion` behavior unchanged.

In `MatchRoomView`, label the existing veto tab as read-only when applicable;
do not add a second launch or mutation path.

- [ ] **Step 4: Run UI checks**

```bash
npx vitest run tests/unit/veto-room-view.test.tsx tests/unit/admin-veto-integration.test.tsx
npm run typecheck
npm run lint
```

Expected: PASS; caster controls are absent and team controls still work.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/veto/VetoRoomView.tsx frontend/components/match-rooms/MatchRoomView.tsx frontend/app/globals.css frontend/tests/unit/veto-room-view.test.tsx
git commit -m "feat: add read-only caster veto view"
```

### Task 5: Verify the integrated workflow

**Files:**

- Create: `frontend/tests/e2e/integrated-veto.spec.ts`
- Modify: `frontend/tests/e2e/test-fixture.ts` only for deterministic seeded match/users
- Modify: `backend/tests/veto-routes.test.js` for final caster response assertions
- Modify: relevant codemaps when implementation changes their documented flow

**Interfaces:**

- Consumes: Completed admin launch, role links, `/veto/[code]`, `veto:{code}` SSE, and polling fallback.
- Produces: Automated evidence for launch, permissions, concurrency, responsive UI, publication gating, caster isolation, and realtime fallback.

- [ ] **Step 1: Add the Playwright scenario**

Using `frontend/tests/e2e/test-fixture.ts`, sign in as tournament staff, open
`/admin/match-rooms`, follow **Start map veto**, select a valid BO3 setup, and
create the room. Assert team/viewer/caster links. Open a team link in a second
context, ready both teams, complete toss/order, submit a map action, and assert
staff and caster views update. Assert caster controls are absent at desktop and
mobile widths. Complete the flow through fixture-authorized actions and verify
the match result remains hidden until `publishResult` is enabled.

- [ ] **Step 2: Run backend verification**

```bash
npm test
npm run lint
npm run prisma:generate
```

Run from `backend`. Expected: PASS, including existing veto access and route-guard tests.

- [ ] **Step 3: Run frontend verification**

```bash
npm run test
npm run typecheck
npm run lint
```

Run from `frontend`. Expected: PASS for unit coverage and static checks.

- [ ] **Step 4: Run end-to-end verification**

```bash
npm run test:e2e -- tests/e2e/integrated-veto.spec.ts
```

Run from `frontend`. Expected: PASS at desktop and mobile projects, with
updates arriving through SSE or five-second fallback polling.

- [ ] **Step 5: Validate migration rollout**

Against an isolated verification database, run from `backend`:

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Expected: the additive enum migration applies without reset and no migrations
remain pending. Never reset or edit an applied migration.

- [ ] **Step 6: Review and commit only intended files**

```bash
git status --short
git diff --check
git diff --stat
git log --oneline -10
```

Stage only integrated-veto files, excluding unrelated working-tree changes:

```bash
git add backend frontend docs/superpowers/specs/2026-08-31-integrated-valorant-map-veto-design.md docs/superpowers/plans/2026-08-31-integrated-valorant-map-veto.md
git commit -m "test: verify integrated Valorant veto workflow"
```

## Plan self-review

- **Spec coverage:** Match launch, BO1/BO3/BO5, map validation, role links,
  caster isolation, responsive presentation, SSE/polling, revision conflicts,
  publication gating, and end-to-end verification are covered by Tasks 1–5.
- **Placeholder scan:** No `TBD`, `TODO`, `FIXME`, or unspecified “appropriate”
  implementation steps are used; every task names files, interfaces, commands,
  and expected outcomes.
- **Type consistency:** `IssuedTokens.caster`, `VetoRoom.access.kind`,
  `VetoParticipant.logoUrl`, and `buildVetoShareUrl` are introduced in Task 3
  after the backend contract in Tasks 1–2 and consumed by Tasks 3–5.
- **Scope check:** The plan remains one integrated subsystem using existing
  room/realtime architecture; the only schema change is the additive caster
  enum value.
