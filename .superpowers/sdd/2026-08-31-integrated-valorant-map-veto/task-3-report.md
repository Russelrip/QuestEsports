# Task 3 report

Implemented the authenticated admin launch/navigation flow for linked Valorant
map veto rooms.

## Changes

- Added typed veto share URLs with encoded room codes and access tokens.
- Added caster access and issued-token typing, while retaining tokens only in
  authenticated component state.
- Added match/tournament and room query navigation to the admin veto manager.
- Linked unconfigured match cards to the prefilled wizard and linked configured
  cards to the existing room.
- Restricted linked matches to BO1, BO3, and BO5 and kept manual team fields
  out of the linked flow.
- Added caster private-link controls with copy and open actions.
- Added concurrent-create 409 recovery: reload rooms, select the existing
  match room, clear credentials, and expose “Open existing veto”.
- Added focused frontend coverage for the unlinked match launch URL.

## Validation

- `npx vitest run tests/unit/admin-veto-integration.test.tsx` — PASS (1 test)
- `npm run typecheck` — PASS
- `npm run lint` — PASS

## Round 2 fixes

- Resolved linked participant logo URLs through `resolveImageUrl` before passing
  them to `next/image`, including `/api/uploads/...` paths.
- Replaced the one-shot context flag with an applied query-key ref. Each
  distinct room/match/tournament query is applied once, while later room
  mutations and manual selection remain authoritative for that key.
- Expanded focused integration coverage for launch eligibility, encoded caster
  URLs, query-key tracking, linked match review data, logo resolution, and 409
  credential isolation.
- Preserved caster-token isolation from viewer state and linked format guards.

## Round 2 validation

Exact commands and results:

```text
npx vitest run tests/unit/admin-veto-integration.test.tsx
✓ 4 tests passed

npm run typecheck
PASS

npm run lint
PASS
```

## Scope

Only the requested Task 3 frontend files, focused test, and this report were
changed intentionally. Existing unrelated working-tree changes were not
staged.

## Round 1 fixes

- Made `IssuedTokens.caster` required and corrected caster cards to read the
  caster token for copy, open, and rotation, independently of viewer settings.
- Enforced BO1/BO3/BO5 for linked matches both in format selection and before
  POST creation.
- Applied URL context once after the initial room load, so later room updates or
  manual room selection cannot be overwritten by stale query parameters.
- Updated linked-match review to use selected participant names and logo
  snapshots.
- Replaced veto launch with an explanatory unavailable state for non-Valorant
  matches and matches without exactly two participants.
- Added focused coverage for eligible/unavailable launch navigation and encoded
  private-link URLs.

## Round 1 validation

- `npx vitest run tests/unit/admin-veto-integration.test.tsx` — PASS (3 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS

## Remaining review finding fix

- Replaced the remaining source-text assertions with real Testing Library
  interaction coverage for `AdminVetoRoomsManager`.
- Covered `matchId`/`tournamentId` prefill, selected match review names and
  logo URLs, hidden manual team inputs, `roomId` selection, caster-token
  isolation without a viewer token, linked BO1/BO3/BO5-only choices, and
  duplicate-create 409 recovery selecting the existing room without private
  credentials.
- Preserved the existing match-card navigation and ineligible-match tests.
- No production files were modified.

## Final validation output

Commands were run from `frontend`:

```text
npx vitest run tests/unit/admin-veto-integration.test.tsx
✓ tests/unit/admin-veto-integration.test.tsx (7 tests)
Test Files  1 passed (1)
Tests       7 passed (7)

npm run typecheck
> frontend@0.1.0 typecheck
> tsc --noEmit --noUnusedLocals --noUnusedParameters

npm run lint
> frontend@0.1.0 lint
> eslint
```
