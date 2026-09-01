# Task 4 report: read-only caster veto view

## Status

Implemented the caster-facing Valorant veto presentation.

## Changes

- Added the `Live broadcast` role treatment and named `veto-stage--caster` root class.
- Kept caster access strictly read-only: toss, ready, team-order, side, ban, and pick actions remain unavailable because caster access never satisfies action permissions.
- Added participant logo rendering with accent-colored initials fallback.
- Added live status and turn messaging for broadcast viewers, while hiding revision details from casters.
- Added a `Live view` cue and accessible read-only broadcast description to the match-room veto tab.
- Added real component rendering coverage for caster isolation and team active-map access.

## Validation

- `npx vitest run tests/unit/veto-room-view.test.tsx tests/unit/admin-veto-integration.test.tsx`: caster tests passed; the existing admin integration suite has 2 failures in the combined run and 1 pre-existing failure when run alone around caster-link wizard state.
- `npm run typecheck`: passed.
- `npm run lint`: passed with two existing-style test warnings for the mocked decorative `<img>`.

## Concerns

The focused admin integration test still fails independently in `keeps a caster token isolated when the viewer token is absent`; that flow is outside the Task 4 files and was not changed.

## Round 1 fixes

- Moved the room status announcement to a real `div[aria-live="polite"]` wrapper and added a visually hidden real live-region wrapper for current-turn changes. Neither announcement moves focus.
- Removed the unconditional match-room `Live view` / read-only cue. The ordinary player, captain, and staff match-room context now keeps the normal `Map veto` tab; caster labeling remains owned by the actual veto access context.
- Replaced the generic logo fallback with an accent-colored initials fallback that appears both when no snapshot logo exists and when an image errors.
- Strengthened component rendering tests for live regions, caster control isolation, team map access, and invalid snapshot logo fallback.

## Round 1 validation output

- `npx vitest run tests/unit/veto-room-view.test.tsx tests/unit/admin-veto-integration.test.tsx`: passed — 2 files, 10 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed with two warnings from the mocked test `<img>` (`@next/next/no-img-element` and `jsx-a11y/alt-text`).

## Round 1 concerns

No functional concerns remain. The two lint warnings are confined to the test-only Next Image mock.

## Round 2 fixes

- Added an access-state bridge from `VetoRoomView` through `onRoomChange` into `MatchRoomView`.
- The match-room veto tab now shows `Live view` and the read-only broadcast label only after the nested veto room reports `access.kind === "caster"`.
- Ordinary player, captain, and staff match-room users retain the plain `Map veto` tab with no read-only claim.
- Reset the bridged access state when switching match-room codes to prevent stale caster labeling.

## Round 2 validation output

- `npx vitest run tests/unit/veto-room-view.test.tsx tests/unit/admin-veto-integration.test.tsx`: veto suite passed (3 tests); admin suite passed 6 tests and retains the existing caster-link wizard failure (1 failed test: `keeps a caster token isolated when the viewer token is absent`).
- `npm run typecheck`: passed.
- `npm run lint`: passed with two warnings from the mocked test `<img>` (`@next/next/no-img-element` and `jsx-a11y/alt-text`).

## Round 2 concerns

The remaining admin integration failure is pre-existing and concerns the Task 3 caster-link wizard, outside the Task 4 files.

## Round 3 fixes

- Wrapped the match-room `onRoomChange` bridge in a stable `useCallback` with no changing dependencies.
- Continued passing the callback to `VetoRoomView`, so its realtime/polling effect no longer restarts on ordinary parent renders.

## Round 3 validation output

- `npx vitest run tests/unit/veto-room-view.test.tsx tests/unit/admin-veto-integration.test.tsx`: passed — 2 files, 10 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed with two warnings from the mocked test `<img>` (`@next/next/no-img-element` and `jsx-a11y/alt-text`).

## Round 3 concerns

No functional concerns. The two lint warnings remain confined to the test-only Next Image mock.
