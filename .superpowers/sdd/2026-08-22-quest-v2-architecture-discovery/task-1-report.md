# V2-P0-001 Implementation Report

## Status

Implemented from base commit `3719d22808dc77f357af6bda87dae7c3b53c2882`.

## Scope

Frontend-only changes were limited to the tournament/event status contract, public tournament/event presentation, focused regression fixtures, and this report. No backend, API, schema, migration, plan, or public URL changes were made.

## Implementation

- Removed legacy child registration booleans and the unused child action union from `Tournament`; `registrationState` is now the single child registration-state source.
- Kept event aggregate/event status types separate from `TournamentRegistrationState`.
- Added `getEventCardPresentation`, which explicitly returns aggregate event status separately from the selected child registration presentation.
- Updated tournament listings and featured tournament cards to consume `getTournamentRegistrationPresentation` rather than legacy booleans.
- Updated event-card labels/border state to use aggregate event status, so a closed event can intentionally contain an open child without relabeling the event as open.
- Preserved tournament detail/register routes, payment-related registration actions, waitlist routing, and the personal `Checking...` state.
- Updated focused fixtures and added a regression proving closed-event/open-child scoping; existing regression coverage proves a child with `registration_closed` does not become waitlist-actionable and that personal checking remains separate.

## Test-first evidence

1. Added the event-card scoping regression before implementation.
2. Focused test was red because `getEventCardPresentation` was not yet implemented.
3. Implemented the shared presentation helper and canonical-state consumers.
4. Focused regression and related registration tests passed.

## Validation

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed: 39 files, 220 tests.
- `npm run test:e2e:local` — build passed, but the local E2E run exceeded the 120-second command limit after an unrelated existing failure in `tests/e2e/home.spec.ts` (`Challonge public bracket...` could not find `The tournament is over`).

## Concerns

The local E2E fixture/backend state did not satisfy the existing Challonge showcase expectation; this failure is outside the changed status-contract files. No backend files were changed.
