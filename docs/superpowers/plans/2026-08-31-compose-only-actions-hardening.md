# Compose-Only GitHub Actions Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make immutable Docker Compose the sole production deployment authority and remove the audited GitHub Actions security, provenance, and reproducibility gaps without changing the approved PostgreSQL image pin.

**Architecture:** `deploy-compose.yml` becomes the only workflow allowed to promote production Compose releases, and frontend promotion follows its successful run. The legacy PM2 workflow remains available only as an explicitly disabled path, while all release workflows consume a full SHA proven by successful `main` CI and protected environment approvals. Secret-bearing VALORANT E2E moves out of pull-request CI into a manually authorized workflow.

**Tech Stack:** GitHub Actions YAML, Bash, Docker Compose, GitHub CLI, Node.js tests, PostgreSQL 16 CI service, PostgreSQL 17 immutable production image.

**Spec:** `docs/superpowers/specs/2026-08-29-vps-database-migration-design.md`

## Closeout status (2026-08-31)

- [x] Tasks 1–7 repository implementation is present, including Compose-only
  authority, secret isolation, exact digest/provenance controls, release-SHA
  lineage, PostgreSQL 17 contracts, recovery boundaries, and workflow/docs
  integration.
- [x] Local static contract coverage is present for the post-approval `main`
  revalidation, exact BuildKit/SSH argv shape, immutable lint-tool references,
  null-safe tracked-file discovery, and direct Task 6 execution.
- [x] Documentation records the completed cutover and separates current
  Compose authority from the superseded historical migration procedure.
- [ ] Linux execution of the immutable actionlint/ShellCheck containers is not
  evidenced in this Windows worktree; the CI job remains the executable gate.
- [ ] Docker-dependent PostgreSQL 17 readability/Compose gates are not claimed
  here unless their assigned Linux runner evidence exists.
- [ ] VPS, GitHub environment approvals/settings, backup remotes, rehearsal,
  and live production verification remain unavailable and were not attempted.

This ledger is a repository closeout record, not evidence that unavailable Linux
or live-system gates passed. The older 2026-08-29 migration SDD evidence is
preserved; only its superseded design/spec status is reconciled here.

## Machine-readable closeout status (2026-08-31)

```yaml
plan: 2026-08-31-compose-only-actions-hardening
implementation_status: complete
verification_status: limited_by_environment
task_1: complete
task_2: complete
task_3: complete
task_4: complete
task_5: complete
task_6: complete
task_7: complete
closeout_findings: none_known
live_systems_contacted: false
commit_created: false
unavailable_checks:
  - actionlint
  - shellcheck
  - WSL/POSIX shell execution
  - Docker-dependent PostgreSQL/Compose checks
  - live registry/VPS/owner settings
```

## Global Constraints

- Keep `postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0` as the approved production reference.
- Do not propagate the rejected `postgres:17@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675` reference.
- Compose production remains private-networked; PostgreSQL staging remains loopback-only on `127.0.0.1:55432`.
- Do not print, interpolate into shell source, or pass as process arguments any credential-bearing URL, token, password, certificate, or key.
- Do not contact or mutate the VPS, production database, Supabase, GitHub environment variables, or GitHub Actions settings from repository tests.
- Preserve `NOBYPASSRLS`, explicit RLS policies, two-schema isolation, encrypted/rclone backups, owner gates, and no-blind-rollback boundaries.
- Preserve the two existing intentional working-tree changes in `backend/tests/backup-scripts.test.js` and `ops/tests/postgres-container-readability.test.sh`.

---

### Task 1: Make Compose the sole production deployment authority

**Files:**
- Modify: `.github/workflows/cd.yml:41-66,53-55`
- Modify: `.github/workflows/deploy-compose.yml:3-25`
- Modify: `.github/workflows/deploy-frontend.yml:3-30`
- Modify: `docs/ci-cd.md` deployment-authority and release sections
- Modify: `docs/production-runbook.md` deployment workflow sections
- Test: `.github/workflows/ci.yml` static workflow-contract assertions
- Test: `backend/tests/production-container-config.test.js` if shared contract assertions are needed

**Interfaces:**
- Consumes: protected repository/environment variable `PRODUCTION_DEPLOYMENT_MODE`.
- Produces: exactly one production deployment authority, with concurrency group `production-release`.

- [x] **Step 1: Add the failing contract assertions.** Assert that `cd.yml` is gated unless `vars.PRODUCTION_DEPLOYMENT_MODE == 'legacy-pm2'`, `deploy-compose.yml` is gated unless it equals `compose`, `deploy-frontend.yml` follows the Compose release path, and all production deploy workflows use `production-release`.
- [x] **Step 2: Run the workflow-contract tests and confirm they fail against the current independent booleans/groups.**
- [x] **Step 3: Add the Compose-only gates and shared concurrency group.** Keep legacy PM2 code present for rollback history but make it unreachable when the protected mode is `compose`; change frontend automation to follow successful `Deploy immutable Compose release` runs, not legacy `CD` runs; do not add a second automatic trigger.
- [x] **Step 4: Update the runbook and CI documentation with the exact mode variable and the rule that PM2 CD stays disabled before and after Compose cutover.**
- [x] **Step 5: Run the static workflow assertions and YAML parse checks.**

---

### Task 2: Remove pull-request access to long-lived E2E secrets

**Files:**
- Modify: `.github/workflows/ci.yml:315-365`
- Create: `.github/workflows/valorant-e2e.yml`
- Modify: `docs/ci-cd.md` E2E security section
- Test: `.github/workflows/ci.yml` workflow-contract assertions
- Test: `.github/workflows/valorant-e2e.yml` static secret-boundary assertions

**Interfaces:**
- Consumes: protected `valorant-e2e` environment secrets and the approved `main` source revision.
- Produces: an owner-triggered VALORANT E2E run that never executes untrusted pull-request workflow code with production-like secrets.

- [x] **Step 1: Add failing assertions that PR CI contains no VALORANT access token or `E2E_*` secret references, and that the dedicated workflow uses `workflow_dispatch` with a protected environment.**
- [x] **Step 2: Run the assertions and confirm they fail against the current secret-bearing `valorant-e2e` job.**
- [x] **Step 3: Remove the secret-bearing job from `ci.yml` and create `valorant-e2e.yml` with `workflow_dispatch`, `environment: valorant-e2e`, repository-owner gating, exact `main` SHA validation, and every secret under `env:` rather than inline `run:` interpolation.**
- [x] **Step 4: Install both backend and sibling FastAPI dependencies before running `npm run test:valorant:e2e`; pass the repository path and all test values through environment variables.**
- [x] **Step 5: Run YAML parsing and secret-boundary contract tests; verify no private value appears in workflow source or generated command strings.**

---

### Task 3: Enforce the approved PostgreSQL 17 image and external-image trust model

**Files:**
- Modify: `.github/workflows/build-container-images.yml:82-89,223`
- Modify: `.github/workflows/deploy-compose.yml:122-147,162-223`
- Modify: `.github/workflows/ci.yml:137-145,188-197`
- Modify: `ops/deploy/validate-host.sh:374-393`
- Modify: `ops/deploy/release.env.example:47-56`
- Modify: `ops/tests/deploy-release.test.sh` image/signature fixtures
- Modify: `backend/tests/production-container-config.test.js` image assertions
- Modify: `docs/ci-cd.md` image trust section

**Interfaces:**
- Consumes: exact approved PostgreSQL reference `postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0` and protected Quest image references.
- Produces: fail-closed digest validation; Cosign verification only for Quest-owned signed images.

- [x] **Step 1: Add failing assertions requiring the exact PostgreSQL reference in build, deploy, host, and CI checks; assert external PostgreSQL/VALORANT images are not passed to the Quest Cosign identity verifier.**
- [x] **Step 2: Run the focused image-contract tests and confirm current regex/flexible-variable behavior fails the exact-value assertions.**
- [x] **Step 3: Require the exact Bookworm reference in all release/build/host gates and preserve the existing PostgreSQL 16 CI fixture separately.**
- [x] **Step 4: Remove external-image Cosign requirements and speculative signer regexes; retain exact approved-reference equality for PostgreSQL and VALORANT.**
- [x] **Step 5: Update negative fixtures for wrong PostgreSQL digest, wrong approved variable, and external-image signature attempts; run all focused contract tests.**

---

### Task 4: Bind every promotion to successful `main` CI and one release SHA

**Files:**
- Modify: `.github/workflows/cd.yml:72-84`
- Modify: `.github/workflows/deploy-compose.yml:33-86`
- Modify: `.github/workflows/deploy-frontend.yml:28-54,76-87`
- Modify: `.github/workflows/build-container-images.yml` release-manifest artifact steps
- Modify: `docs/ci-cd.md` release-SHA and manual-dispatch sections
- Test: `.github/workflows/ci.yml` static metadata assertions
- Test: `.github/workflows/deploy-compose.yml` and `deploy-frontend.yml` shell fixtures

**Interfaces:**
- Consumes: successful CI push run on `main`, exact commit SHA, exact successful image-build run, and protected environment approval.
- Produces: one validated `RELEASE_SHA` shared by backend, Compose, and frontend promotion.

- [x] **Step 1: Add failing metadata assertions requiring repository, workflow name, `push` event, `main` branch, exact SHA, and successful conclusion for every manual or workflow-run promotion.**
- [x] **Step 2: Add a frontend-release artifact containing only the validated `RELEASE_SHA`, uploaded by CD and downloaded using the exact CD run ID; add assertions that frontend does not derive its SHA from its own downstream run.**
- [x] **Step 3: Make Compose deployment verify the current `main` head equals `RELEASE_SHA` before environment approval/deployment, with a separate explicit rollback path for intentional older SHAs.**
- [x] **Step 4: Pass the artifact-derived SHA to frontend validation and require the live backend compatibility endpoint to match before Vercel promotion.**
- [x] **Step 5: Run shell fixtures and local `gh`-metadata mocks for push/main success, PR failure, stale-main failure, and mismatched artifact failure.**

---

### Task 5: Make CI reproducible and prove the PG17 readability gate

**Files:**
- Modify: `.github/workflows/ci.yml:27-40,342-365,104-220`
- Modify: `.github/workflows/deploy-compose.yml:149-160`
- Modify: `.github/workflows/deploy-frontend.yml:76-87`
- Modify: `ops/tests/postgres-container-readability.test.sh`
- Modify: `backend/tests/production-container-config.test.js`
- Modify: `ops/test-paris-database-backup-windows.ps1:74`
- Modify: `ops/backup-paris-database-windows.ps1:105-117`
- Test: `.github/workflows/ci.yml` image/action pin assertions

**Interfaces:**
- Consumes: exact image digests and lockfiles.
- Produces: CI that cannot silently substitute mutable infrastructure or skip the exact PG17 file-read test.

- [x] **Step 1: Add failing assertions for mutable PostgreSQL 16, Playwright, setup-uv, and Vercel references, plus the missing backend `npm ci` in the dedicated E2E flow.**
- [x] **Step 2: Pin PostgreSQL 16 to `postgres:16.15-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825`, pin Playwright to `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`, replace mutable `setup-uv` with a reviewed full commit SHA, install backend dependencies in the E2E workflow, and run the locked local Vercel CLI. Record each selected digest in the workflow comment beside the pin.**
- [x] **Step 3: Add a strict CI invocation that pulls the exact PostgreSQL 17 Bookworm reference and fails if `ops/tests/postgres-container-readability.test.sh` reports a skip.**
- [x] **Step 4: Replace the mutable Windows drill PostgreSQL image with the approved PostgreSQL 17 Bookworm reference; retain the amd64 child digest only as explanatory evidence.**
- [ ] **Step 5: Run the workflow contract tests and verify the exact image pull/readability command on Linux.** (Linux/Docker execution unavailable in this Windows worktree.)

---

### Task 6: Strengthen attestations and remote-shell boundaries

**Files:**
- Modify: `.github/workflows/deploy-compose.yml:171-223`
- Modify: `.github/workflows/cd.yml:170-205`
- Modify: `.github/workflows/secret-scan.yml`
- Modify: `ops/deploy/validate-host.sh`
- Modify: `docs/ci-cd.md` provenance and shell-safety sections
- Test: `ops/tests/deploy-release.test.sh`

**Interfaces:**
- Consumes: OCI in-toto attestations, signed release manifests, validated environment strings.
- Produces: provenance checks bound to image digest/source revision and shell commands that cannot be altered by quote-breaking configuration values.

- [x] **Step 1: Add failing fixtures for mismatched attestation subject digest, repository, ref, revision, builder, and unsafe remote configuration values.**
- [x] **Step 2: Decode and validate the in-toto subject and predicate fields rather than checking only predicate-type labels.**
- [x] **Step 3: Validate `APP_DIR`, `PM2_PROCESS`, and `HEALTHCHECK_URL` with strict grammars and pass them as positional arguments or protected files instead of generated shell source.**
- [x] **Step 4: Add bounded timeout and cleanup behavior to secret scanning and release-signing workflows without exposing signing material.**
- [ ] **Step 5: Run all deployment fixtures, Bash syntax checks, and workflow YAML parsing.** (Linux/POSIX execution is unavailable in this Windows worktree; no fixture or syntax evidence is recorded.)

---

### Task 7: Add workflow linting and reconcile documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/ci-cd.md`
- Modify: `docs/setup-and-deployment.md`
- Modify: `docs/superpowers/specs/2026-08-29-vps-database-migration-design.md`
- Test: all `.github/workflows/*.yml`

**Interfaces:**
- Consumes: final workflow contracts from Tasks 1–6.
- Produces: machine-checked workflow syntax and documentation that matches Compose-only operation and `sslmode=verify-full` production requirements.

- [x] **Step 1: Add a failing CI assertion that every workflow is checked by actionlint and every tracked shell script passes ShellCheck.**
- [x] **Step 2: Pin actionlint/ShellCheck execution to reviewed immutable containers and run them over every workflow/script path.**
- [x] **Step 3: Replace production documentation examples that still use `sslmode=require`; retain `require` only in explicitly non-production examples.**
- [x] **Step 4: Reconcile the superseded migration design with the live-state addendum, dedicated backup TLS paths, and Compose-only owner-gate instructions.**
- [ ] **Step 5: Run the complete local verification budget: backend tests, frontend tests, focused workflow contracts, all shell contracts, YAML parsing, actionlint/ShellCheck, Compose config, and `git diff --check`.** (Unavailable Linux/Docker/live checks are not claimed.)

## Verification Budget

- Repository owner: implementation worker validates workflow source and local contract fixtures.
- Security reviewer: independent reviewer checks secret boundaries, digest/signature scope, release-SHA binding, and shell safety.
- Linux runner: executes actual pinned-image readability and rehearsal gates; Windows-only runs cannot substitute for this evidence.
- VPS operator: supplies protected `PRODUCTION_DEPLOYMENT_MODE=compose`, owner approvals, maintenance window, backup evidence, and live cutover records. No repository test can satisfy these gates.

## Explicit Non-Goals

- Do not run the VPS cutover in this implementation plan.
- Do not delete ignored `.env` variants or `.superpowers` audit artifacts automatically.
- Do not rotate the approved PostgreSQL image digest.
- Do not retain an automatically runnable legacy PM2 production deployment beside Compose.
- Do not pin Node or unrelated Alpine base images in this plan; record those as a separate dependency-image pinning change requiring fresh registry resolution and review.
