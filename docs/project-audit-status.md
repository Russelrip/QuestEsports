# Quest E-sports Project Audit and Remediation Status

Last reviewed: July 18, 2026

## Executive Summary

The project is currently in good overall health. Local linting, backend tests,
frontend unit tests, the production frontend build, Playwright journeys, and
dependency audits pass. No confirmed active bug affecting ordinary users on the
live site was identified during this code audit.

This distinction is important:

- **Confirmed live production issues:** none currently identified.
- **Conditional production risks:** operations that could cause a problem only
  when a particular admin tool or deployment path is used.
- **Future production risks:** weaknesses that should be addressed before they
  become incidents, but are not evidence that the live site is currently broken.
- **Quality and test gaps:** weaknesses in assurance rather than confirmed user
  failures.

The remediation work described below is present in the current working tree. It
must be committed, pushed, and pass GitHub CI before it can be considered part of
the deployed application.

## Current Verification Results

| Check | Result |
| --- | --- |
| Backend lint | Passed |
| Backend tests | 136 passed, 1 database integration test skipped locally |
| Backend coverage gate | Passed |
| Backend overall coverage | 63.31% lines, 58.13% branches, 64.01% functions |
| Security middleware coverage | 94.41% lines, 85.71% branches |
| Frontend lint | Passed |
| Frontend unit tests | 9 passed |
| Frontend production build and TypeScript | Passed |
| Frontend Playwright E2E | 12 passed repeatedly |
| Backend production dependency audit | No known vulnerabilities |
| Frontend production dependency audit | No known vulnerabilities |
| Git diff validation | Passed |

The real PostgreSQL integration test is configured to run in GitHub CI against
PostgreSQL 16. It was skipped locally because a disposable local PostgreSQL
service was not available. The local `.env` files were not modified or exposed.

## A. Confirmed Issues Affecting Live Users Right Now

No confirmed active production issue was found that is currently affecting
ordinary live users.

This conclusion is based on code inspection and local verification. It is not a
replacement for production telemetry, error-rate monitoring, real payment
provider checks, email-delivery verification, or user reports.

## B. Conditional Production Risks

These issues can affect production, but only when the relevant operation is
performed.

### B1. Legacy poster import is not fully atomic across storage and PostgreSQL

Severity: Medium

Relevant code:

- `backend/src/modules/media/legacy-import.service.js`, file writes around lines
  107-109
- Database transaction around lines 168-174
- Cleanup around lines 175-181

The importer now validates all packaged sources before writing, uses one Prisma
transaction, and cleans up files when a handled failure occurs. However, a
filesystem operation and a PostgreSQL transaction cannot be truly atomic.

Possible production impact:

- A process or host crash at an unlucky point could leave an orphaned file.
- A database record could theoretically reference a file that was not finalized.
- This only affects production if an administrator runs the legacy import.

Recommended improvement:

1. Copy files to a staging directory.
2. Create records with a stable import key and staged status.
3. Move files into their final locations.
4. Mark the import complete.
5. Add a reconciliation task for orphan files and missing-file records.

### B2. Simultaneous legacy imports can create duplicate posters

Severity: Medium

Relevant code:

- Existing-poster lookup around
  `backend/src/modules/media/legacy-import.service.js:151`
- Insert transaction around
  `backend/src/modules/media/legacy-import.service.js:168`

Two concurrent import requests can both observe that a poster is absent before
either inserts it. The database does not currently enforce a stable unique
legacy import identity.

Possible production impact:

- Duplicate poster records and duplicate stored files.
- This requires the admin import to be invoked concurrently.

Recommended improvement:

- Add a stable `importKey` or another appropriate unique constraint.
- Use an upsert or handle the unique conflict as an idempotent skip.
- Optionally protect the operation with a database-backed administrative lock.

## C. Deployment and Release Risks

These are not current live-site failures, but they can affect production during
a future release.

### C1. Code rollback does not roll back an applied database migration

Severity: Medium

Relevant code:

- Migration keyword check in `.github/workflows/cd.yml:140-145`
- Code rollback in `.github/workflows/cd.yml:147-178`
- Migration deployment in `.github/workflows/cd.yml:186`

The deployment applies Prisma migrations before restarting the backend. If the
new application fails, the workflow restores the previous code but does not and
generally should not attempt to reverse the database migration.

The current text check catches several destructive SQL keywords, but it can miss
incompatibilities such as:

- A required column added without a safe transition
- A restrictive constraint
- A unique index over existing duplicate data
- An incompatible enum change
- Differently formatted or indirect destructive SQL

Possible production impact during a failed deployment:

- Previous application code may be incompatible with the migrated schema.
- Less frequently used routes may fail even if the health endpoint succeeds.

Recommended improvement:

- Require expand-and-contract migrations.
- Treat production migrations as forward-only.
- Test both the previous and new application versions against the expanded
  schema when a migration changes shared fields.
- Run critical post-deployment smoke checks for authentication, registration,
  payment status, and shop reads in addition to the health check.

### C2. Current remediation changes have not yet passed remote CI

Severity: Medium until CI passes

The current fixes are modified or untracked working-tree files. Local validation
passed, but the clean Linux and PostgreSQL CI environment has not yet validated
this exact working tree.

Recommended release sequence:

1. Review the complete diff.
2. Commit it to a branch.
3. Push the branch.
4. Require the complete GitHub CI workflow to pass.
5. Review production configuration and backups.
6. Deploy through the existing CD workflow.

## D. Test and Assurance Gaps

These are not confirmed production bugs. They reduce confidence that future
regressions will be detected before release.

### D1. Real database integration coverage is shallow

Severity: Medium

`backend/tests/database-integration.test.js` currently verifies only public
tournament, event-series, and product reads.

Important database behavior not directly covered by a real PostgreSQL lifecycle:

- Account and normalized uniqueness creation
- Session creation and expiration
- Tournament capacity reservation
- Serializable transaction conflicts
- Merchandise stock reservation and release
- PayHere notification persistence
- Bank-transfer proof uniqueness
- Background-job claiming

Recommended improvement:

Add database integration tests for one complete authentication, registration,
merchandise order, payment notification, and job-claim lifecycle.

### D2. Important backend services still have low direct coverage

Severity: Medium

Notable approximate coverage from the latest run:

| Area | Coverage concern |
| --- | --- |
| `auth.service.js` | Approximately 28% lines |
| `auth.controller.js` | Approximately 47% lines |
| `totp.js` | Approximately 29% lines |
| `shop.service.js` | Approximately 36% lines |
| `error-handler.js` | Approximately 42% lines |
| `bank-transfer.service.js` | Approximately 39% branches |

Recommended improvement:

- Add behavior tests around password reset, email changes, MFA setup/disable,
  recovery codes, order creation, private proof handling, and safe production
  errors.
- Introduce per-directory or per-file expectations for critical modules instead
  of relying only on aggregate coverage.

### D3. Frontend coverage remains narrow

Severity: Medium

The frontend currently has nine unit tests and twelve Playwright journeys.
Important gaps include:

- MFA and recovery-code interfaces
- Signup and password reset
- Team creation and invitation acceptance
- Tournament registration validation
- Payment polling and terminal states
- Admin CRUD operations
- Upload failure states
- Cart persistence hydration
- Session and authorization transitions

Recommended improvement:

Add focused unit tests for API clients and stores, component tests for critical
forms, and authenticated E2E journeys against a disposable backend.

### D4. Legacy importer behavior is not fully tested

Severity: Low to Medium

`backend/tests/legacy-import-assets.test.js` confirms that every declared source
file exists, but it does not execute the importer.

Recommended improvement:

Add functional tests for idempotent skips, transaction failure cleanup, summary
counts, cleanup failure reporting, and concurrent imports.

## E. Development and CI-Only Issues

These do not affect the deployed live site.

### E1. Playwright mock API uses the normal backend port

Severity: Low

Relevant code:

- `frontend/scripts/mock-api.mjs:3`
- `frontend/playwright.config.ts:21-24`

The mock uses port 5001, which conflicts with a developer running the real local
backend while starting E2E tests.

Recommended improvement:

- Use a dedicated E2E port such as 5011.
- Build the frontend for E2E with the same shared mock API URL.

### E2. Unexpected mock API requests may not fail E2E automatically

Severity: Low

`frontend/scripts/mock-api.mjs:38-39` returns a 404 response for an unexpected
request. Application fallback handling might absorb that response and allow a
test to pass.

Recommended improvement:

- Record unexpected requests.
- Expose a verification endpoint or assert after each suite that the list is
  empty.

### E3. Mock API CORS is more permissive than production

Severity: Low

`frontend/scripts/mock-api.mjs:14-15` reflects the supplied origin and enables
credentials. The server is loopback-only and test-only, so this is not a live
security vulnerability, but it is not a production-faithful CORS simulation.

Recommended improvement:

- Permit only the configured Playwright site origin.

### E4. Frontend CI job name is outdated

Severity: Low

`.github/workflows/ci.yml:89-90` calls the job “Frontend lint and build,” although
it now runs audit, lint, unit tests, build, and E2E.

Recommended improvement:

- Rename the job to `Frontend checks`.

### E5. Coverage threshold has little headroom

Severity: Low

The backend branch threshold is 58%, while the latest result is approximately
58.13%.

Recommended improvement:

- Add targeted tests first.
- Then raise or ratchet the threshold with enough headroom for ordinary changes.

## F. Remediation Already Added in the Current Working Tree

The following improvements have been implemented locally:

### Private slot reservation improvements

- Private admin holds now lock the lowest available numbered slot.
- The matching fee and currency are snapshotted when the hold is created.
- Held slot numbers are protected by a per-tournament database uniqueness
  constraint.
- Active registrations and admin holds share the same slot-allocation view.
- Starting payment consumes the hold atomically and copies its locked slot and
  fee into the registration and payment transaction.
- Capacity counting defensively avoids counting an active registration and a
  stale hold twice.
- Existing production holds are backfilled with a numbered slot and matching fee
  during migration.
- The admin UI displays the held slot and locked price.

### Legacy import improvements

- Removed six declarations for source images that do not exist.
- Added preflight loading of every packaged source before writes begin.
- Removed the runtime dependency on Git and repository history.
- Consolidated database changes into one Prisma transaction.
- Added cleanup of newly written files when a handled import failure occurs.
- Added a regression test ensuring every declared source exists.
- Updated media import documentation.

### Frontend and E2E improvements

- Limited Playwright to four local workers and two CI workers.
- Added a deterministic loopback mock API for server-rendered frontend requests.
- Removed connection-refused noise from frontend-only E2E runs.
- Added `npm run test:e2e:local` to build before local E2E execution.
- Added cart-store tests for currency consistency, quantity limits, removal, and
  clearing.
- Added API helper tests for safe text errors and explicit origin preservation.

### Security and backend test improvements

- Added direct tests for allowed and foreign origins.
- Added CSRF coverage for cookie-authenticated writes without an origin.
- Added production security-header coverage.
- Increased security middleware coverage to approximately 94% lines and 86%
  branches.
- Raised the global backend branch coverage gate to a clear 58% after increasing
  measured coverage.
- Reduced dotenv noise in Node test execution.

### CI and documentation improvements

- Added frontend unit tests to GitHub CI.
- Updated frontend, CI/CD, production runbook, setup, and backend documentation.

## G. Positive Production Safeguards Already Present

- Local environment files are ignored by Git.
- Production configuration validates HTTPS origins and required settings.
- Authentication secrets and token material are hashed or encrypted.
- Session cookies are HttpOnly, SameSite, and Secure in production.
- CSRF and browser-origin enforcement are implemented.
- Admin API routes require authorization.
- Payment callbacks validate signatures, amount, currency, and idempotency.
- Private bank-transfer evidence is separate from public uploads.
- Uploaded images are decoded and normalized.
- The frontend uses a nonce-based Content Security Policy.
- CI performs dependency audits, Prisma migration checks, schema drift checks,
  linting, coverage, frontend unit tests, production builds, and Playwright E2E.
- The CD workflow pins deployments to a commit that passed CI.
- Deployment refuses dirty tracked production checkouts and root deployment.

## H. Safest Remediation and Release Order

1. Review and commit the current remediation changes.
2. Push them and require the complete GitHub CI workflow to pass.
3. Add a stable unique import key and concurrency protection to the legacy
   importer.
4. Introduce staged storage and reconciliation for the importer.
5. Expand real PostgreSQL integration coverage for critical write lifecycles.
6. Add direct backend tests for authentication, TOTP, commerce, bank transfers,
   and production error handling.
7. Expand frontend authentication, registration, team, payment, and admin tests.
8. Improve migration compatibility validation and post-deployment smoke checks.
9. Move the Playwright mock API to a dedicated shared-config port and reject
   unexpected requests.
10. Increase coverage thresholds gradually as critical coverage improves.

## Final Status

There is no confirmed active issue currently affecting ordinary live users. The
most relevant production concerns are conditional admin-import consistency and
future deployment/migration compatibility. The remaining findings primarily
concern release assurance, integration coverage, and development tooling.
