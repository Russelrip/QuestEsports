# V2-P0-002 Implementation Report

## Scope

Implemented the Phase 0 backend public projection/cache changes from the task
brief. No schema, migration, payment semantics, ticket/shop behavior, or
frontend files were changed.

## Implementation

### Bounded public projections

- Public tournament participant relation loads now always use a bounded first
  page of 50 approved registrations.
- Explicit `participantPage`/`participantPageSize` requests retain pagination
  metadata and full registration totals; omitted pagination keeps the existing
  response shape while returning the bounded first page.
- Public event-album detail relation loads now always use a bounded first page
  of 30 photos.
- Explicit `photoPage`/`photoPageSize` requests retain pagination metadata;
  omitted pagination keeps the existing response shape.
- Existing public-safe selects and mapped fields remain unchanged, so captain
  contact data, roster member data, payment evidence, provider data, admin
  notes, and private holds are not exposed.

### Foundation cache invalidation audit

Added `tournaments` + `foundation` invalidation coverage to public-projection
mutations that were missing it:

- Team creation, deletion, and invite response.
- Admin registration Game ID changes.
- Admin saved-team organization changes, captain transfer, and deletion.
- Public tournament poster creation, update, and deletion.

Existing tournament, registration, series, match, bracket, event-album, and
payment projection invalidation middleware was preserved. The shared
`invalidateCache` behavior continues to invalidate only after 2xx responses;
failed mutations do not invalidate.

## Test-first evidence

Added/updated focused regressions for:

- Default bounded tournament participant projections.
- Default bounded event-album photo projections.
- Team/admin team route invalidation coverage.
- Poster and event-album mutation invalidation coverage.
- Existing successful-only invalidation behavior.

The focused suite was intentionally run red before implementation, then green
after implementation.

## Validation

- `node --test tests/tournament.service.test.js tests/event-album.service.test.js tests/team-logo-cache.test.js tests/event-album.routes.test.js` — passed (34/34).
- `npm run lint` — passed with 28 pre-existing warnings and no errors.
- `npm test` — passed (684 passed, 9 skipped).
- `npm run test:coverage` — passed on rerun (682 passed, 9 skipped; 77.91% lines, 68.49% branches, 75.88% functions).
- `npm run test:integration` — passed (7/7).

The first coverage run encountered one unrelated flaky realtime reconnect test;
the immediate rerun passed. Integration output included expected exercised
constraint/job error logs while all integration subtests passed.

## Files changed

- `backend/src/modules/tournaments/tournament.service.js`
- `backend/src/modules/media/event-album.service.js`
- `backend/src/modules/teams/team.routes.js`
- `backend/src/modules/admin/admin.routes.js`
- `backend/src/modules/media/media.routes.js`
- `backend/tests/tournament.service.test.js`
- `backend/tests/event-album.service.test.js`
- `backend/tests/team-logo-cache.test.js`
- `backend/tests/event-album.routes.test.js`

## Fix round — public participant totals and pagination compatibility

### Findings addressed

- Default bounded participant loading no longer derives the public
  `registrationCount` from the truncated relation. The service now runs an
  approved-registration count query for both default and explicit participant
  requests, while separately preserving the active capacity calculation.
- A page-only `participantPage` request now uses the shared pagination default
  of 10. The bounded default of 50 applies only when neither participant
  pagination parameter is supplied; explicit page-size requests still use the
  shared clamping behavior.
- Team and admin-team invalidation regressions now enumerate each mutation
  route and assert that its route stack contains the expected invalidation
  middleware, in addition to checking configured tags.

### Additional regressions

- Default public tournament detail with 75 approved registrations and only 50
  loaded cards preserves `registrationCount: 75`.
- Page-only participant pagination preserves `pageSize: 10` and calculates
  pagination metadata from the full approved count.
- Every public/admin team projection mutation route is checked for foundation
  invalidation middleware.

### Fix-round validation

- Focused projection/cache suite (`tournament.service`, `event-album.service`,
  `team-logo-cache`, and `event-album.routes`) — passed (35/35).
- `npm run lint` — passed with 28 existing warnings and no errors.
- `npm test` — passed (685 passed, 9 skipped).
- `npm run test:coverage` — passed (685 passed, 9 skipped; 77.92% lines,
  68.53% branches, 75.88% functions).
- `npm run test:integration` — passed (7/7); expected constraint and worker
  diagnostic logs were emitted by exercised integration cases.
