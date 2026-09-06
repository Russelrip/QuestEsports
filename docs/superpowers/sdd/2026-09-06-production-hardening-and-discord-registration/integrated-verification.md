# Integrated production-hardening verification

Status: PASS. All source, contract, unit, coverage, lint, type, bundle and
available native checks below passed unless explicitly described as
environment-gated.

## Backend

- Node 24 coverage suite: 1,170 tests; 1,156 passed, 14 skipped, 0 failed.
- Coverage: 82.06% lines, 71.80% branches, 80.38% functions; gates passed.
- ESLint: passed.
- Final registration/privacy and documentation contracts: 30 passed.
- Quest JavaScript signer through FastAPI health verifier: passed.
- Docker-backed tests were skipped/unavailable because Docker Desktop's Linux
  engine was not running.

## Frontend

- Bounded full unit suite after the Task 5 round 2 fixes: 53 files, 334 tests
  passed.
- Typecheck and ESLint: passed with no warnings.
- Production HTTPS build: passed.
- V8 coverage: 62.39% lines, 57.98% statements, 47.12% functions, 45.64%
  branches; global thresholds and the new per-file floors for `proxy.ts`,
  `MatchRoomView.tsx` and `NotificationBell.tsx` passed. Scoped enforcement was
  confirmed by a deliberately raised threshold failing the gate.
- npm audit: zero vulnerabilities.
- These frontend numbers were measured on Node 22.15.0; the repository pins Node
  24.x for CI, and the earlier 323-test/61.74% figures were the Node 24 baseline
  before the round 2 reliability tests were added.
- Playwright end-to-end tests were not run.

## VALORANT Python and deployment

- Managed environment installed from `uv.lock`.
- Pytest with host-only `tzdata`: 832 passed, 197 skipped, 2 failed.
- Both failures are pre-existing and host-gated, not regressions. Their code is
  byte-identical to `HEAD`:
  `tests/integration/test_quest_contract_shapes.py::test_series_create_contract_shape`
  raises `InvalidCatalogNameError` because no PostgreSQL test database exists on
  this host, and
  `tests/test_production_contract.py::test_first_deployment_failure_fixture_executes_partial_project_cleanup`
  cannot run its fake-executable CD fixture under Windows Git Bash. An earlier
  run recorded them as "deselected"; they are reported here as failures instead.
- Ruff: passed.
- Host-hook contracts: passed.
- VALORANT Compose contract: 12/12 passed.
- Shell syntax checks: passed.
- Full release shell contract was exercised but is time-consuming under Git Bash;
  final completion status is appended below.
- Protected production Compose rendering remained unavailable without the Docker
  engine and protected production secrets.

## Mobile

- Node 24 locked install, 6 tests, TypeScript, 20/20 Expo Doctor checks and audit:
  passed; audit reported zero vulnerabilities.
- Clean Expo prebuild and Android Metro/Hermes export: passed.
- The initial long-path Windows Gradle check was host-limited as described in the
  Task 6 report. A short-path `--max-workers=1` retry passed `assembleDebug` with
  249 tasks in 4m 9s; CI pins the same worker bound in a shorter Linux workspace.

`git diff --check` passed. Generated coverage and isolated native-check directories
were removed. No commits, pushes or Git configuration changes were made.
