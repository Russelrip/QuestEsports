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
