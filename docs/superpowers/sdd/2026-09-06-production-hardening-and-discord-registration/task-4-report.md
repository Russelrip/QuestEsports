# Task 4 Report — VALORANT Production Hardening

## Status

Implemented in the working tree; no commit was created.

## Task 4 implementation files

- `valorant-platform-backend/app/config.py`
- `valorant-platform-backend/app/api/routes/health.py`
- `ops/docker/valorant.production.env.example`
- `ops/docker/valorant.production.compose.yml`
- `valorant-platform-backend/docker-compose.production.yml`
- `ops/deploy/host-hooks.sh`
- `ops/deploy/release.sh`
- `ops/deploy/cutover.sh`
- `ops/deploy/verify-release.sh`
- `ops/docker/nginx/quest.conf`

These files provide production-only fail-closed settings validation,
non-mutating integration readiness, TLS-pinned Compose health checks, and exact
release/cutover health admission contracts.

## Fix round 3 files and coverage

- `backend/package.json`
  - `test:valorant:e2e` now runs both the two-service journey and
    `tests/valorant-e2e/valorant-auth-boundary.test.js`.
- `backend/tests/valorant-e2e/valorant-auth-boundary.test.js`
  - Uses explicit `PYTHON_BIN` first, then the sibling repository's
    `.venv/bin/python`, with `python3`/`python` as a clear fallback.
  - No platform-specific Windows path or dependency installation was added.
- `.github/workflows/valorant-e2e.yml`
  - Passes the uv-provisioned
    `${{ github.workspace }}/valorant-platform-backend/.venv/bin/python` to
    the combined backend E2E command.
- `.github/workflows/ci.yml`
  - CI workflow-contract assertions cover the combined E2E command and the
    managed `PYTHON_BIN` environment contract.
- `backend/tests/production-container-config.test.js`
  - Covers the combined E2E command and managed Python path in the protected
    workflow.
- `valorant-platform-backend/tests/test_production_contract.py`
  - Adds one parameterized production-settings rejection test with 21 cases:
    malformed/missing Quest service-secret map, Quest issuer/audience, Henrik
    API key/base URL/auth scheme, Discord OAuth client ID/secret, both worker
    tokens, admin API key, guild ID, OAuth redirect, database/direct URLs
    (including empty passwords), and strict TLS verification/CA/hostname.
- `ops/tests/deploy-release.test.sh`
  - Changes the four release/cutover integration-readiness fixture assertions
    to exact rejection-line checks using portable `grep -Fxq`.

## Verification

- `node --check` on modified JavaScript and
  `node --test tests/production-container-config.test.js
  tests/workflow-and-docs.test.js` — **passed**; 47 passed and 2 Docker
  dependent checks skipped.
- `node --test tests/valorant-e2e/valorant-auth-boundary.test.js` — **skipped**
  because `VALORANT_PLATFORM_REPO` was not configured on this host.
- Workflow YAML/E2E script contract parse and Python syntax compilation —
  **passed**.
- `git diff --check` on the fix-round files — **passed**.
- Linux/Bash deployment fixture execution — **unverified** on this Windows
  host; no Bash suite is claimed as passed.
- `uv run pytest` / `uv run ruff` — **unverified** on this Windows host; no uv
  suite is claimed as passed.
- Docker validation — **unverified** because the Linux Docker daemon is not
  available on this host.

Existing unrelated working-tree changes were not modified, staged, or
committed.

## Fix round 4 note

- Corrected the production contract fixture to use a typed empty database URL
  for the missing-credential case and added the missing `ADMIN_API_KEY`
  fail-closed rejection case.
- `python -m compileall -q app tests/unit/test_health.py
  tests/test_production_contract.py` and `python -m ruff check
  app/config.py app/api/routes/health.py tests/test_production_contract.py` —
  passed. uv, Linux/Bash, and Docker suites remain unverified and are not
  claimed as passed.
