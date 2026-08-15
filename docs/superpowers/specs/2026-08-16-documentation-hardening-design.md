# Documentation Hardening Design

## Status

Approved and implemented on 2026-08-16. This design is retained as the
archival approved specification; written-spec review is no longer pending.

## Problem

QuestEsports already has broad documentation for setup, deployment, CI/CD,
production operations, recovery, and the three application areas. The main
problem is discoverability and consistency: commands and endpoint names differ
between guides, environment-specific OAuth behavior is easy to misread, and
several recurring developer and operator workflows are not documented in one
place.

Some production facts in the runbooks cannot be verified from this repository
alone. Documentation must not silently invent or refresh those facts; items
requiring VPS, DNS, cloud, or backup-owner confirmation will be called out as
verification points.

## Goals

- Make the documented local, CI, deployment, and operational commands agree
  with package scripts and checked-in workflows.
- Give developers one concise workflow guide for contribution, local data,
  migrations, opt-in integration tests, frontend mocks, and mobile work.
- Give maintainers one environment-variable reference organized by app,
  environment, requiredness, secret classification, and restart implications.
- Make the external VALORANT backend dependency locally reproducible and
  clearly separated from this repository.
- Make operational script usage safer by documenting dry-run/manual examples
  and disposable-target requirements.
- Improve navigation from the root README, docs index, and subsystem READMEs.

## Non-goals

- No application behavior, API contract, schema, infrastructure, or workflow
  changes unless a documentation inconsistency proves that a checked-in
  metadata change is necessary and independently safe.
- No production execution, database mutation, restore drill, DNS change, or
  secret inspection.
- No broad documentation-system migration or replacement of the current
  Markdown hierarchy.

## Documentation changes

### 1. Canonical command and endpoint guidance

Review and update the root README, setup/deployment guide, CI/CD guide,
production runbook, and subsystem READMEs so that they consistently identify:

- `npm ci` as the reproducible clean-install default, with any intentional
  `npm install` exception explained.
- The verified Prisma generation/migration order.
- The canonical `/api/health`, `/api/health/live`, and
  `/api/health/ready` roles, after checking the implementation and workflows.
- Node/npm support as declared by the applications and their package metadata.
- Local, development-build, and production mobile OAuth redirect behavior.

### 2. New developer guide

Create `docs/developer-guide.md` covering branch and PR expectations, local
database/test setup, migration creation and review rules, opt-in integration
and E2E tests, frontend mock API behavior, mobile-admin development scope,
and the normal verification commands. It should link to, rather than duplicate,
detailed deployment and architecture material.

### 3. New environment reference

Create `docs/environment-reference.md` with a table for backend, frontend,
mobile-admin, CI/CD, and VALORANT E2E variables. Each entry should identify
scope, whether it is required locally/CI/production, whether it is secret,
safe example/default behavior, and whether changing it requires a restart or
redeploy. Values remain placeholders; secrets are never copied into docs.

### 4. New VALORANT local-development guide

Create `docs/valorant-local-development.md` documenting the external backend
checkout/version expectation, runtime and ports, required `E2E_*` variables,
disposable database setup, smoke-test commands, and the boundary between the
external service and this repository. Cross-link the existing integration and
E2E README documents.

### 5. Operations examples

Expand `ops/README.md` with concise examples for backup, freshness checks,
restore drills, pruning, failure notification, and systemd installation. Each
example must state whether it is read-only, dry-run capable, or destructive,
and must require an explicitly disposable restore target where applicable.

### 6. Navigation and safety notes

Update `README.md`, `docs/README.md`, and relevant subsystem documents with
links to the new guides. Add explicit verification-pending notes for external
production facts and recovery claims that cannot be proven from checked-in
files.

## Source-of-truth rules

- Package scripts and checked-in workflow files are authoritative for command
  names and CI behavior.
- Application route implementation is authoritative for health endpoint names
  and semantics.
- `.env.example` files define safe variable names and placeholder patterns;
  deployment/runbook docs define environment-specific operational behavior.
- Existing integration documentation defines the intended VALORANT boundary,
  but external-repository details must be labeled as owner-maintained unless
  present in checked-in scripts or tests.

## Error handling and safety

- If a documented command or endpoint cannot be confirmed in code or a
  workflow, label it as unverified and do not present it as canonical.
- Keep production hostnames, credentials, tokens, and real infrastructure
  identifiers out of new reference tables.
- Mark destructive operational commands with warnings and avoid examples that
  default to production targets.
- Preserve existing operational procedures unless the checked-in scripts show
  a concrete correction is needed.

## Verification

The implementation will perform the following checks after all writer lanes
are reconciled:

1. Compare referenced commands with `backend/package.json`,
   `frontend/package.json`, `mobile-admin/package.json`, and workflow files.
2. Compare health endpoint claims with the backend route implementation.
3. Check all new and modified relative Markdown links and referenced files.
4. Scan new docs for secrets, real credential-like values, and unresolved
   placeholders such as `TBD`.
5. Run available Markdown/lint checks and safe project-level documentation
   checks; do not run production-only operations.
