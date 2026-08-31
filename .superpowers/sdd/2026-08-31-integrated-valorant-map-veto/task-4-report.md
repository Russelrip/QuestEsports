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
