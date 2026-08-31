# Task 5 verification report: integrated Valorant map veto

## Scope

Task 5 added an integrated Playwright workflow and final backend caster-access
assertions. The implementation changes are limited to these task files:

- `frontend/tests/e2e/integrated-veto.spec.ts`
- `backend/tests/veto-routes.test.js`
- `frontend/tests/unit/admin-veto-integration.test.tsx`

The shared E2E fixture and codemaps were left unchanged.

## Implemented coverage

The Playwright scenario covers:

- Staff launch from match rooms into the linked BO3 veto wizard.
- BO3 setup, room creation, role-link issuance, and publication gating.
- Team-one and team-two private contexts becoming ready.
- Toss/order completion and a team map action.
- Staff and caster updates after the action.
- Caster read-only controls at desktop and mobile viewport projects.
- Completion through fixture-authorized actions.
- Hidden unpublished result, then public access after enabling publication.
- Caster mutation denial.
- Deterministic realtime fallback behavior using the existing polling path.

Backend route coverage now also confirms that a hashed caster grant resolves to
`{ kind: "caster", slot: null }` and cannot submit a veto action.

## Verification

### Backend

- `node --test tests/veto-routes.test.js` — PASS (3/3).
- `npm test` — FAIL: 1 unrelated existing workflow assertion in
  `backend/tests/production-container-config.test.js:617` expected 3 image
  references but found 0; 1142 passed and 13 skipped.
- `npm run lint` — PASS, one existing warning in
  `backend/tests/production-container-config.test.js:1390`.
- `npm run prisma:generate` — PASS.

### Frontend

- `npm run test` — FAIL: 1 existing unit assertion in
  `frontend/tests/unit/admin-veto-integration.test.tsx:135` could not find
  `Caster link`; 306 passed and 1 failed.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS, two existing warnings in
  `frontend/tests/unit/veto-room-view.test.tsx`.
- `npm run test:e2e -- tests/e2e/integrated-veto.spec.ts` — blocked by the
  repository production `next.config.ts` HTTPS requirement when run without
  local development environment overrides.
- With `NODE_ENV=development`, `NEXT_PUBLIC_API_URL=http://127.0.0.1:3000`,
  and `INTERNAL_API_URL=http://127.0.0.1:3000`, the same E2E command passed all
  3 projects: Chromium, Firefox, and mobile Safari.

### Migration

Migration rollout was not run. No isolated verification database was
available, so `npx prisma migrate deploy` and `npx prisma migrate status` were
intentionally skipped. No migration was reset or edited.

### Review

- `git diff --check` — PASS for the intended changes.
- Recent baseline commit: `235ce9c fix: stabilize caster access bridge`.
- The working tree contains unrelated pre-existing modifications and
  untracked files; they were not staged or reverted.

## Follow-up

Resolve the unrelated backend workflow assertion, then rerun the backend full
suite. Run migration deploy/status against an isolated verification database
before release.

## Fix-wave verification

The review fix wave made the following changes:

- The create request is now captured and asserted as a linked BO3 request with
  `matchId`, `mapPoolId`, `rulePresetId`, flattened room settings, and no
  manually supplied `participants` field.
- Team-one's first map action is driven through the real `VetoRoomView` map
  button and confirmation dialog. The intercepted production-shaped request
  verifies the team token, map slug, and current revision.
- Remaining completion steps use only the narrowly scoped action endpoint
  needed to finish the deterministic scenario; the caster and viewer pages
  receive updates through the five-second polling fallback.
- Caster map buttons are asserted disabled and all mutation controls are
  absent. The viewer link is opened and asserted to render the spectator view.
- Public match publication is checked through a production-shaped request to
  `/api/v1/matches?status=completed&pageSize=50`, asserting `veto: null` before
  publication and the completed veto projection after publication is enabled.
  This remains a contract test: the route is intercepted and publication is
  toggled in deterministic fixture state because the current public match page
  uses VALORANT series IDs and the repository has no live linked-match E2E
  database fixture. It does not claim live database persistence.
- The frontend caster-link unit failure was reproducible and fixed by waiting
  for the selected room's `Open live room` link before inspecting role links.

Exact fix-wave commands and results:

- `backend: node --test tests/veto-routes.test.js` — PASS; 3 tests passed.
- `frontend: npm run test` — PASS; 49 test files and 307 tests passed.
- `frontend: npm run typecheck` — PASS.
- `frontend: npm run lint` — PASS with the existing two warnings in
  `frontend/tests/unit/veto-room-view.test.tsx` (`no-img-element` and missing
  `alt`).
- `frontend: NODE_ENV=development NEXT_PUBLIC_API_URL=http://127.0.0.1:3000
  INTERNAL_API_URL=http://127.0.0.1:3000 npm run test:e2e --
  tests/e2e/integrated-veto.spec.ts` — PASS; 3 projects passed (Chromium,
  Firefox, mobile Safari) in 35.6 seconds.

Migration status is unchanged: `npx prisma migrate deploy` and `npx prisma
migrate status` remain skipped because no isolated verification database is
available. No migration was reset or edited.
