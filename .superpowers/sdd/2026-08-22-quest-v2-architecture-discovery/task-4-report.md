# V2-P0-004 Implementation Report

## Status

Implemented on top of commit `dbf2387`. Backend route/middleware, backend
tests, and `docs/api-documentation.md` only. No schema, migration, Prisma
client, frontend, mobile-admin, plan, or production-data changes were made.

## Objective

Add route-level defence in depth to the public veto code routes while keeping
`veto.service.resolveAccess` the authority on who may read or mutate a room.

## Implementation

### New guards — `backend/src/modules/permissions/permission.middleware.js`

- `requireVetoRoomCode` rejects any `:code` outside `^[A-Za-z0-9_-]{1,64}$`
  with `404 "Veto room not found."` — the same status and message
  `getRoomRecord` already returns for an unknown code — before any database
  read. Generated codes are `crypto.randomBytes(7).toString("base64url")`
  lowercased, so every real code satisfies the pattern.
- `requireVetoRoomCredential` rejects a mutation carrying neither a session
  (`req.user`) nor a non-empty `x-veto-token` header with
  `401 "This veto room requires an authorized account or access link."` — the
  wording and status `resolveAccess` already returns for anonymous callers.

Both guards are exported alongside the existing permission middleware.

### Wiring — `backend/src/routes/v1.js`

| Route | Guards | Authority |
|---|---|---|
| `GET /veto-rooms/:code` | `requireVetoRoomCode` | `resolveAccess` |
| `POST /veto-rooms/:code/ready` | `requireVetoRoomCode`, `requireVetoRoomCredential` | `resolveAccess` |
| `POST /veto-rooms/:code/toss` | same | `resolveAccess` |
| `POST /veto-rooms/:code/team-a` | same | `resolveAccess` |
| `POST /veto-rooms/:code/actions` | same | `resolveAccess` |

`requireVetoRoomCode` runs first so a malformed code still resolves to `404`
rather than `401`, matching the current service ordering (`getRoomRecord`
throws before `resolveAccess` runs). The credential guard is deliberately not
applied to the `GET`, which must stay readable without any credential for a
completed room with `publishResult`.

No admin veto route changed; those already carry `requireAuth` plus
`requirePermission`/`requireAdmin` from V2-P1-001.

### Service authorization unchanged

`veto.service.js` was not modified. Every credential-bearing caller still
reaches `resolveAccess`, which remains the only place that decides staff,
captain, participant-viewer, grant-token, and published-public access.

## Behaviour delta

One status code changes, and it removes an information leak rather than
weakening authorization:

- Before: an anonymous, token-less `POST` to a **completed room with
  `publishResult: true`** received `409` (the service resolved `kind: "public"`
  and then failed the state precondition), while the same request against any
  other room received `401`. The difference let an unauthenticated caller
  distinguish published rooms from every other room.
- After: all four anonymous, token-less mutations return `401` uniformly.

Every other path keeps its existing status code:

- Malformed code → `404` (was `404` via the room lookup).
- Unknown well-formed code → `404` (unchanged).
- Anonymous mutation on any non-published room → `401` (unchanged).
- Expired grant → `401` from the service (unchanged).
- Cross-tournament staff / non-participant account → `403` from the service
  (unchanged).
- Wrong-team captain → `403`/`409` from the service (unchanged).

No legitimate client is affected: captains and staff carry a session cookie,
and link holders send `X-Veto-Token` (`frontend/lib/veto.ts:104`,
`frontend/components/veto/VetoRoomView.tsx:84,112`).

## Test-first regressions

`backend/tests/veto-routes.test.js` gained
`public veto code routes are route-guarded before the service resolves access`,
written and confirmed failing before the middleware existed. It loads the real
`veto.service`, the real `permission.middleware`, and the real `v1` router, and
asserts:

| Case | Assertion |
|---|---|
| Route registration | all five code routes still exist and now carry more than one handler |
| Malformed code (`../admin`, spaces, empty, 65 chars) | `404` on all five routes, and the `vetoRoom.findUnique` spy is never called |
| Anonymous mutation, ordinary room | `401` on all four mutations with no room lookup |
| Anonymous mutation, published room | `401` on all four mutations with no room lookup |
| Public token-less `GET` on a published room | succeeds with `access.kind === "public"` |
| Captain `GET` | succeeds with `{ kind: "team", slot: 1 }` |
| Grant-token `GET` on a `link_only` room | succeeds with `{ kind: "team", slot: 1 }` |
| Assigned staff `GET` | succeeds with `access.kind === "staff"` |
| Super-admin `GET` | succeeds with `access.kind === "staff"` |
| Cross-tournament staff `GET` | `403` from the service |
| Expired grant `POST /actions` | `401` **and** the room lookup did run, proving the route guard does not short-circuit service authorization |
| Wrong-team captain `POST /toss` | `409` from the service |
| Unknown well-formed code | `404` |

Two existing tests were updated for truthfulness rather than to accommodate the
change:

- The title `admin veto mutations enforce scoped staff access without guarding
  public code routes` became `... while public code routes keep their own
  guards`; its assertions are unchanged and still pass.
- `backend/tests/valorant-routes.test.js` mocks `permission.middleware` with a
  partial object; it now also supplies `requireVetoRoomCode` and
  `requireVetoRoomCredential` so the router can be constructed.

## Validation

Run in `backend/` at the committed tree:

- `npm run lint`: passed — 0 errors, 25 warnings, all pre-existing
  unused-argument/fixture warnings unrelated to this task.
- `npm test`: passed — 718 tests, 709 passed, 9 skipped (the configured
  VALORANT end-to-end cases, skipped for absent external service/database
  environment variables).
- `npm run test:coverage`: passed — 78.02% lines, 68.27% branches, 76.58%
  functions, above the configured 68/60/64 thresholds.
- `npm run test:integration`: passed, 7/7.

## Whole-branch review round

After V2-P0-004 landed, the whole branch (`origin/main..HEAD`) was reviewed
against the plan. Three issues were found and fixed; each fix was written
test-first and re-reviewed.

### Important — public bracket names came from a bounded page

`getPublicTournamentBySlug` bounds the participant projection on every path
(V2-P0-002), but `bracketRegistrations` — the unbounded read that refreshes
published-bracket team names and logos — was only performed on the paginated
path. A caller that supplies no participant pagination therefore resolved
bracket participants from at most the first 50 approved registrations, so any
tournament with more approved teams served stale bracket names and logos.
`GET /api/tournaments/:slug` returns `bracketData` in full, so the stale values
were publicly observable there; `GET /api/v1/tournaments/:slug` strips
`bracketData` and was unaffected. The Quest frontend always sends participant
pagination and was also unaffected.

Fixed by performing the bracket read before the default-path return and passing
it to `mapTournamentWithPublicTeams` on both paths.
`backend/tests/tournament.service.test.js` gained two regressions: the default
path resolves a bracket team that is outside the participant page, and an
unpublished bracket still performs no extra registration read.

### Important — ticket reissue audit evidence was redacted

Recorded in the V2-P0-003 report under "Whole-branch review round"; the
`ticket.reissued` audit persisted `"[REDACTED]"` in place of its only
before/after evidence.

### Minor — dead post-commit veto audit path

Every `runRoomCommand` caller passed `transactionAudited: true`, leaving the
controller-level `audit()` helper unreachable. It was removed along with the
flag, so a future command cannot silently reintroduce an out-of-transaction
audit write. No behaviour change; covered by the existing veto route and
service suites.

### Not fixed — out of scope

- `backend/src/lib/jobs.js:183-262` has a pre-existing claim race. When two
  concurrent `runJobWorkerTick()` calls both lose their serializable
  `backgroundJob.updateMany` to a write conflict, each retry re-reads a row
  that is now `processing` with a fresh lock, matches no candidate, and returns
  `null`; the job is left claimed by nobody until the five-minute stale-lock
  cutoff. This makes `real PostgreSQL protects sessions and claims a queued job
  only once` flaky. It is present on `origin/main`, no job, session, or worker
  code changed on this branch, and it belongs to no Phase 0 task, so it was
  reported rather than fixed.

## Final verification

Backend (`backend/`):

- `npm run lint`: passed — 0 errors, 25 pre-existing warnings.
- `npm test`: passed — 721 tests, 712 passed, 9 skipped (configured VALORANT
  end-to-end cases, skipped for absent external environment variables).
- `npm run test:coverage`: passed — 78.13% lines, 68.29% branches, 76.75%
  functions.
- `npm run test:integration`: 7/7 on five consecutive runs. The suite is
  flaky in this environment because of the pre-existing job-claim race above:
  with every change stashed at the same commit it failed 2 of 4 runs with the
  identical assertion, so the flake is not attributable to this branch.

Frontend (`frontend/`):

- `npm run lint`: passed, clean.
- `npm run typecheck`: passed, clean.
- `npm test`: passed — 39 files, 220 tests.
- `npm run test:e2e:local`: passed — 57 passed, 15 skipped, 0 failed.

### The Challonge E2E failure, classified

Before this round the E2E suite failed `Challonge public bracket is preloaded
and reused without consuming REST requests` on all three browser projects. The
cause is a test-fixture bug, not a product bug:
`frontend/scripts/mock-api.mjs` matched the fixture with
`request.url === "/api/tournaments/challonge-test"`, while
`fetchPublicTournamentBySlug` has always appended
`?participantPage=1&participantPageSize=10`. The strict comparison never
matched, the mock fell through to its 404 handler, and the page rendered
without the tournament.

Both sides of that mismatch are identical on `origin/main`: the mock's strict
comparison and the frontend's query string both predate this branch, and
neither file's behaviour was changed by it. The failure was therefore
pre-existing and unrelated to V2-P0-001 through V2-P0-004 — the earlier reports
were right to call it unrelated, but never named the mechanism.

It is now fixed in the mock by comparing the parsed pathname, matching the
idiom the mock's other handlers already use. The change is confined to the E2E
fixture; no product code was altered for it.

## Acceptance criteria

- Invalid callers are rejected at the route boundary **and** at the service
  boundary — the expired-grant regression proves the service check still runs.
- All valid existing veto flows pass: captain, grant link, participant viewer,
  published public read, assigned staff, and super-admin.
- `/veto/[code]`, the public code format, and the veto schema are untouched.

## Concerns and follow-up

- The guards are intentionally coarse. They cannot and must not attempt room
  membership resolution at the route layer, because code-based access depends
  on the room record itself; `resolveAccess` stays authoritative.
- `requireVetoRoomCode`'s 64-character bound is generous relative to the
  10-character generated format. If a future task ever introduces a different
  public code format, this pattern must be widened with it.
