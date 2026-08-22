# Task 5 Report — Clustered Realtime Verification

## Status

Implemented and committed as `20af5949c4845136eeaa5ed11a39c4eb61ebe795` with
the exact message `docs: verify clustered realtime deployment`.

## Files

- `backend/tests/realtime.cluster.integration.test.js`
  - Added deterministic two-worker service/transport isolation.
  - Verifies local-first delivery, one remote delivery, same-origin suppression,
    recovery reconciliation, malformed envelope rejection, and private-topic
    isolation through the controller boundary.
- `backend/scripts/realtime-cluster-smoke.js`
  - Added native `fetch` plus SSE-compatible stream verification.
  - Requires all seven documented `REALTIME_CLUSTER_*` variables, runs the JSON
    mutation with the supplied cookie, checks both workers, reconnect readiness,
    and broad private-topic rejection, and fails with diagnostics.
- `backend/README.md`
  - Documented clustered cache/worker/channel requirements, exact Upstash REST
    routes, and smoke-test configuration.
- `docs/environment-reference.md`
  - Documented required Upstash credentials, worker/process/channel settings,
    and exact subscribe/publish endpoints.
- `docs/production-runbook.md`
  - Added PM2 count checks, heartbeat/proxy timeout checks, clustered transport
    verification, and SSE-disable/single-worker rollback procedures.

## Verification

- `node --test tests/realtime.cluster.integration.test.js` — **passed**; 2
  tests, 2 passed, 0 failed.
- `npx eslint scripts/realtime-cluster-smoke.js tests/realtime.cluster.integration.test.js` — **passed**.
- `node --check scripts/realtime-cluster-smoke.js` — **passed**.
- `node --check tests/realtime.cluster.integration.test.js` — **passed**.
- `git diff --check` — **passed** before commit.
- `node scripts/realtime-cluster-smoke.js` — intentionally not run as a
  staging exercise because none of the seven required variables were set. Its
  fail-fast configuration check was invoked and returned non-zero with the
  complete missing-variable diagnostic, as required.

## Concerns

- No live two-worker staging environment and valid staging cookie/mutation were
  available, so Upstash, proxy, and real SSE behavior remain operational checks
  for deployment time.
- The three pre-existing untracked planning documents were not modified or
  staged.
