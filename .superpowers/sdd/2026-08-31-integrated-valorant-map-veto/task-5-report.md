# Task 5 verification report: integrated Valorant map veto

## Scope

Task 5 added an integrated Playwright workflow and final backend caster-access
assertions. Only these task files were changed:

- `frontend/tests/e2e/integrated-veto.spec.ts`
- `backend/tests/veto-routes.test.js`

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

Resolve the unrelated backend workflow assertion and frontend unit assertion,
then rerun the full suites. Run migration deploy/status against an isolated
verification database before release.
