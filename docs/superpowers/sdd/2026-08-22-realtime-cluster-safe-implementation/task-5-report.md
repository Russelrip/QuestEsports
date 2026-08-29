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

## Fix round 1 — Task 1 review findings

### Changed files

- `ops/docker/postgres/healthcheck.sh` — require and inspect both
  `DNS:quest-postgres` and `IP:127.0.0.1` SAN identities.
- `ops/docker/postgres/README.md` — document both TLS identities and pass the
  completed production env file explicitly with `docker compose --env-file`.
- `backend/tests/production-container-config.test.js` — test the dual-SAN
  certificate, and reject DNS-only and CN-only certificates.
- This report — record the fix-round verification and self-review.

### Verification

- `node --test tests/production-container-config.test.js` (from `backend/`)
  — **passed**; TAP `1..32`, `# tests 32`, `# pass 32`, `# fail 0`,
  `# skipped 0`.
- `docker compose --env-file C:\Users\russel\AppData\Local\Temp\opencode\quest-postgres-compose.env -f ops/docker/compose.production.yml config --quiet`
  — **passed**; no output, exit code 0.
- `docker compose --env-file C:\Users\russel\AppData\Local\Temp\opencode\quest-postgres-compose.env -f ops/docker/compose.production.yml -f ops/docker/compose.postgres-staging.yml config --quiet`
  — **passed**; no output, exit code 0.

The Compose checks used disposable fake immutable image references and a
temporary placeholder for the required service env-file path; both were
removed after validation.

### Self-review

- The base topology remains private and the staging publication remains bound
  only to `127.0.0.1`; no Task 2 files, secrets, or VPS state were touched.
- The healthcheck now fails for a DNS-only certificate as well as a CN-only
  certificate, while the fixture with both endpoint identities passes.
- The documented `--env-file` source supplies Compose interpolation, including
  image variables and `POSTGRES_STAGING_HOST_PORT`; service-only `env_file`
  behavior is explicitly called out.

### Concerns

- No live staging client or provisioned production certificate was available;
  the operator must still provision a certificate containing both SANs and
  verify the host-loopback TLS connection during staging.
