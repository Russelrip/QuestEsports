# Task 5 independent review and fix report

## Round 1 verdict

PASS after review fixes. The Task 2 registration/profile state machine and visual
layout were preserved.

### Round 1 findings fixed

- `proxy.ts` used the server-oriented API URL builder. In production Compose it
  could put `INTERNAL_API_URL=http://backend:5001` into browser CSP while omitting
  the public API origin. CSP now validates only `NEXT_PUBLIC_API_URL`; a Node
  environment regression test pins this Docker case.
- A rejected match-room refresh released its coalescing guard while sibling
  requests were still pending. The refresh now waits for all three results,
  reports the first failure, and cannot allow stale sibling work to overlap a new
  batch. A regression test holds siblings pending after one request fails.
- Notification refreshes could outlive a user change. Refresh generations own and
  cancel their controllers, reset visible data at the account boundary, and guard
  all completion updates against stale generations.
- Coverage configuration named V8 without installing the provider and set
  unmeasured thresholds. The provider is locked, and the full Node 24 suite sets a
  measured floor: 60% lines, 55% statements, 45% functions and 45% branches.
  Measured result: 61.74%, 57.27%, 46.37% and 45.43%, respectively.
- Frontend dependency audit found `@humanfs/node <0.16.8`; the lockfile now resolves
  the patched release and audit reports zero findings.

### Round 1 verification

- Full bounded unit suite: 52 files, 323 tests passed.
- Focused final reliability/registration suite: 5 files, 59 tests passed.
- Typecheck: passed.
- ESLint: passed after generated coverage artifacts were removed/ignored.
- Node 24 V8 coverage gate: passed.
- HTTPS production build: passed.
- `npm audit`: zero vulnerabilities after the lockfile update.

## Round 2 verdict

A second independent review of the same lane found the round 1 fixes incomplete:
FAIL for spec compliance and task quality. Every finding below was then fixed and
re-verified in this checkout.

### Findings fixed

- `NotificationBell` guarded only its polling refresh. Mark-read, mark-all-read
  and push enrolment issued unsignalled requests and updated state without a
  generation check, so a deferred completion could mutate the next account's
  notification list, and a failed mark-all-read rejected with nothing shown to
  the user. All three now share one abortable, generation-guarded mutation path,
  report failures through the existing alert, and reset `pushBusy` at the account
  boundary.
- `MatchRoomView` recovered from a hidden tab only on the next 5-second poll
  because it gated refreshes on `document.visibilityState` without listening for
  `visibilitychange`. The polling effect now refreshes as soon as the document
  becomes visible and removes the listener on cleanup.
- `MatchRoomView` kept the previous room's header, room code, roster, chat,
  support list and error banner on screen after the `code` prop changed, because
  only `vetoAccessKind` was reset. A render-phase reset now discards every
  room-scoped value in the first render that sees a new code.
- Reliability coverage was incomplete. Seven behaviour tests were added across
  `match-room-view.test.tsx` and `support-inbox.test.tsx` for stale-room
  clearing, stale-error clearing, visibility recovery, listener teardown,
  read-mutation abort on account change, signed mark-all-read plus refresh, and
  mark-all-read failure reporting.
- Coverage thresholds enforced only a repository-wide average. Per-file floors
  now cover `proxy.ts`, `MatchRoomView.tsx` and `NotificationBell.tsx`; raising
  the match-room line floor to 99% was confirmed to fail the gate, so the scoped
  thresholds are enforced rather than ignored.
- Image assertions were source-text only. `tests/unit/admin-media-previews.test.tsx`
  now renders `AdminPosterStudio` with the real `next/image`, asserting real
  `<img>` elements, accessible names, the logo fallback and zero React/Next
  console warnings.
- The Task 5 report was stale about changed files, the coverage dependency and
  test counts; it has been corrected and now records the measured numbers.

### Round 2 verification

- `npx vitest run tests/unit --maxWorkers=1 --coverage`: 53 files, 334 tests
  passed; global and per-file thresholds met.
- Measured coverage: 62.39% lines, 57.98% statements, 47.12% functions, 45.64%
  branches (Node 22.15.0; the repository pins Node 24.x for CI).
- `npm run typecheck`: passed. `npm run lint`: passed with no warnings.
- HTTPS production build: passed.
- Negative controls: disabling the render-phase reset fails the two new
  code-change tests; raising the scoped match-room threshold fails the gate.

Task 2's registration and profile UI, layout and state machine were not modified.
