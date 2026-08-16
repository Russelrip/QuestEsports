# Documentation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the repository’s developer, deployment, operations, and admin documentation consistent, navigable, and safe to follow.

**Architecture:** Preserve the existing Markdown hierarchy. Add focused reference guides for developer workflow, environment variables, and VALORANT local development; expand the operations index with safe command examples; then update existing entry points and runbooks to use one consistent vocabulary and link to the new guides.

**Tech Stack:** Markdown, npm package scripts, GitHub Actions YAML, Bash/PowerShell operational scripts, Node/Prisma/Next.js/Expo documentation sources.

**Spec:** `docs/superpowers/specs/2026-08-16-documentation-hardening-design.md`

**Status:** Completed and archival. The implementation tasks in this plan have
been applied in the current checkout; retain this document as the historical
execution record rather than an open work queue.

## Global Constraints

- Make the documented local, CI, deployment, and operational commands agree with package scripts and checked-in workflows.
- No application behavior, API contract, schema, infrastructure, or workflow changes.
- No production execution, database mutation, restore drill, DNS change, or secret inspection.
- Package scripts and checked-in workflow files are authoritative for command names and CI behavior.
- Application route implementation is authoritative for health endpoint names and semantics.
- Keep production hostnames, credentials, tokens, and real infrastructure identifiers out of new reference tables.
- Mark destructive operational commands with warnings and avoid examples that default to production targets.
- Do not present unconfirmed external infrastructure facts as current truth.

---

### Task 1: Add developer workflow and environment references

**Files:**
- Create: `docs/developer-guide.md`
- Create: `docs/environment-reference.md`
- Read: `README.md`, `backend/README.md`, `frontend/README.md`, `mobile-admin/README.md`
- Read: `backend/package.json`, `frontend/package.json`, `mobile-admin/package.json`
- Read: `backend/.env.example`, `frontend/.env.example`, `mobile-admin/.env.example`
- Read: `.github/workflows/ci.yml`, `.github/workflows/cd.yml`, `.github/workflows/deploy-frontend.yml`, `.github/workflows/release-admin-apk.yml`

**Interfaces:**
- Produces two stable guides linked by later navigation updates.
- Uses package scripts and checked-in workflow commands as the source of truth.

- [x] **Step 1: Inventory the developer workflow facts**

  Record the existing branch/PR rules from `.github/pull_request_template.md` and
  `docs/collaboration-and-staging.md`, then map the supported commands from the
  three package manifests. Do not copy deployment-only commands into the local
  quick-start section.

- [x] **Step 2: Write the developer guide**

  Create `docs/developer-guide.md` with these sections: prerequisites (Node 24,
  npm, PostgreSQL and project-specific tools), repository layout, branch and PR
  workflow, backend local setup and Prisma migration rules, frontend local setup
  and mock API behavior, mobile-admin local setup and scope, opt-in integration/
  E2E workflows, and a verification checklist. Use the exact scripts:
  `npm run lint`, `npm test`, `npm run test:coverage`,
  `npm run test:integration`, `npm run prisma:migrate:status`,
  `npm run prisma:security:verify`, `npm run typecheck`, `npm run test`,
  `npm run build`, and the documented E2E commands in their owning package.
  Explain that CI’s frontend mock API uses port 5011 while the normal backend
  development server uses the port documented by the frontend/backend guides.

- [x] **Step 3: Write the environment reference**

  Create `docs/environment-reference.md`. Organize variables into backend,
  frontend, mobile-admin, CI/release, and VALORANT integration/E2E groups.
  Include every variable from the three `.env.example` files, grouped into
  functional subgroups where the backend list is large. For each variable,
  include name, owner, local/development/CI/production applicability, secret or
  public classification, safe placeholder/default, and restart/redeploy impact.
  Do not reproduce real values from runbooks. Link to the setup/deployment guide
  for provisioning and to the operational runbook for runtime changes.

- [x] **Step 4: Check the two new documents in isolation**

  Verify every command appears in the owning package manifest or workflow, every
  referenced existing file exists, and the environment table contains no secret-
  looking concrete values or unresolved `TBD`/`TODO` markers.

---

### Task 2: Add VALORANT local-development documentation

**Files:**
- Create: `docs/valorant-local-development.md`
- Read/modify links only if needed: `docs/valorant-integration.md`, `docs/valorant-ui-verification.md`, `backend/tests/valorant-e2e/README.md`
- Read: `backend/scripts/valorant-local-smoke.sh`, `backend/tests/valorant-e2e/valorant-e2e.test.js`, `backend/package.json`

**Interfaces:**
- Produces the local setup guide consumed by developers running the external
  VALORANT service and this repository’s smoke/E2E clients.
- Must preserve the existing service boundary: the external FastAPI backend is
  not silently treated as part of this repository.

- [x] **Step 1: Extract checked-in integration facts**

  Read the smoke script, E2E README/test, integration guide, and package scripts.
  List only the repository-verifiable endpoint, port, variable, authentication,
  database, and command facts. Mark external repository checkout/version and
  provisioning details as owner-maintained when not present in checked-in files.

- [x] **Step 2: Write the local-development guide**

  Create `docs/valorant-local-development.md` with prerequisites, two-process
  topology, external backend checkout boundary, environment variables,
  disposable database requirements, startup order, smoke-test command
  (`npm run test:valorant:smoke`), E2E command (`npm run test:valorant:e2e`),
  failure diagnosis, and cleanup. Include an explicit warning not to point E2E
  writes at production data.

- [x] **Step 3: Add cross-links without duplicating contracts**

  Add short links from the existing VALORANT integration and E2E documents to
  the new guide. Keep API schemas, role behavior, and verification details in
  their current owning documents.

- [x] **Step 4: Verify the integration guide**

  Check that each command and variable is present in the smoke script, E2E test,
  package manifest, or existing checked-in example, and that all new links point
  to files that exist.

---

### Task 3: Expand operational script documentation

**Files:**
- Modify: `ops/README.md`
- Read: `ops/backup-production.sh`, `ops/restore-production-backup.sh`, `ops/prune-production-backups.sh`, `ops/check-backup-freshness.sh`, `ops/notify-backup-failure.sh`, `ops/create-secret-recovery-package.sh`, `ops/backup-paris-database-windows.ps1`, `ops/test-paris-database-backup-windows.ps1`, `ops/systemd/*`
- Read: `docs/backup-and-disaster-recovery.md`, `docs/production-runbook.md`

**Interfaces:**
- Extends the operational script inventory without changing scripts.
- Examples must make confirmation tokens, environment-file overrides, and
  destructive/disposable target requirements visible.

- [x] **Step 1: Map each script’s actual arguments and safety gates**

  Confirm the exact usage, environment-file variable, dry-run default, and
  confirmation token from each script. Treat script headers and argument parsing
  as authoritative; do not infer flags from filenames.

- [x] **Step 2: Add safe command examples**

  Expand `ops/README.md` with separate examples for backup, freshness check,
  pruning (dry-run first, confirmation required for deletion), restore to a
  disposable target, failure notification, secret recovery package creation,
  Windows backup/restore verification, and systemd installation/status. Label
  each as read-only, dry-run, destructive, or disposable-target-only. Use
  placeholders such as `/absolute/path/...` and never production credentials.

- [x] **Step 3: Add recovery-status boundaries**

  Link to the recovery runbook and state that newer backup/restore safety changes
  still require a fresh isolated drill unless a checked-in record proves one.
  Do not claim that a production restore drill was performed.

- [x] **Step 4: Verify operational examples**

  Compare every example with the script’s parser and confirmation checks. Run
  only non-mutating help/dry-run or static checks where supported; do not invoke
  production backup, restore, prune, or secret-package operations.

---

### Task 4: Normalize existing documentation and navigation

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/setup-and-deployment.md`
- Modify: `docs/ci-cd.md`
- Modify: `docs/production-runbook.md`
- Modify: `backend/README.md`
- Modify: `frontend/README.md`
- Modify: `mobile-admin/README.md`
- Modify: `ops/README.md` only for navigation if Task 3 does not already cover it

**Interfaces:**
- Consumes the guides from Tasks 1–3.
- Produces the repository’s canonical entry-point navigation and terminology.

- [x] **Step 1: Normalize installation and migration instructions**

  Use `npm ci` for clean/reproducible installs. Explain any intentional use of
  `npm install`. Use the verified local Prisma sequence (`npm run
  prisma:generate`, then `npm run prisma:migrate` where development migration
  creation is intended) and distinguish it from CI/production
  `npm run prisma:migrate:deploy`.

- [x] **Step 2: Normalize health-check guidance**

  Document `/api/health/live` as the liveness check and `/api/health` plus
  `/api/health/ready` as readiness aliases, including that readiness checks
  database/storage and may return 503 during maintenance or dependency failure.
  Keep `/api/openapi.json` as the API schema endpoint where relevant.

- [x] **Step 3: Normalize mobile OAuth and runtime guidance**

  Clearly distinguish local custom-scheme redirect behavior from production
  HTTPS App Link behavior. State that backend and frontend declare Node 24 while
  mobile-admin currently has no package `engines` field and follows the project’s
  Node 24 guidance rather than claiming package-enforced support.

- [x] **Step 4: Update navigation and CI/CD accuracy**

  Add the new guides to the root/docs indexes and relevant subsystem READMEs.
  Correct CI/CD summaries to reflect the checked-in workflow gates, including
  backend tests in CD, frontend mock port 5011, SHA/owner/enablement gates, and
  APK release requirements. Avoid duplicating full workflow files.

- [x] **Step 5: Add verification-pending notes**

  In deployment/recovery material, label current host/region/backup-destination
  facts and restore-drill status as owner-verification items where repository
  evidence is insufficient. Preserve useful procedures and link to the new
  references.

- [x] **Step 6: Check all modified links and terminology**

  Confirm new guide links resolve from root, docs index, and subsystem docs;
  remove stale references only when the replacement is present; and scan for
  contradictory `npm install`, migration-order, health-endpoint, OAuth, and mock
  port wording.

---

### Task 5: Run final documentation verification

**Files:**
- Read: all modified Markdown files and their referenced source files
- Test: repository-provided lint/check commands that are safe and relevant

- [x] **Step 1: Validate Markdown links and file references**

  Run a repository-appropriate link checker if one exists. Otherwise use a
  small read-only script or PowerShell check to resolve relative Markdown links
  from each modified document and report missing targets.

- [x] **Step 2: Validate command and endpoint claims**

  Compare docs against package scripts, workflow commands, and
  `backend/src/app.js`. Confirm there are no unsupported script names, health
  semantics, or environment-variable names in the new guides.

- [x] **Step 3: Scan safety and completeness**

  Search modified docs for credential-like values, private keys, accidental real
  tokens, `TBD`, `TODO`, and broken placeholder syntax. Confirm destructive ops
  examples include warnings and confirmation/disposable-target requirements.

- [x] **Step 4: Run safe project checks**

  Run available Markdown formatting/lint checks and the relevant package lint or
  type checks only if they do not mutate production systems. Record any checks
  that cannot run because they require external services or secrets.

- [x] **Step 5: Review the final diff**

  Inspect `git diff --check` and the complete diff for scope creep, duplicated
  conflicting instructions, and accidental edits outside documentation. Leave
  production-only verification explicitly documented rather than simulated.

---

## Execution order and ownership

Tasks 1, 2, and 3 have disjoint write scopes and may run in parallel. Task 4
depends on their new paths and should run after all three finish. Task 5 is the
final validation gate after every writer result has been reconciled.
