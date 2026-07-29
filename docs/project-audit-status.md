# Quest E-sports Project Audit and Remediation Status

Last reviewed: July 29, 2026

## Executive Summary

The reviewed working tree is healthy and passes its local release checks. No unresolved Critical code defect or known production-package vulnerability remains in the repository changes from this audit.

This is not yet proof that production is updated or healthy. The changes are local until they are committed, pass GitHub CI, and are deployed. The Paris production migration is intentionally gated on a successful encrypted off-site backup and isolated restore drill. The VPS process, Vercel deployment, Supabase dashboard settings, SES delivery, alert delivery, and payment provider were not externally verified during this local review.

## Current Verification Results

| Check | Result |
| --- | --- |
| Backend lint | Passed |
| Backend unit/service tests | 167 passed; 2 real-database tests skip unless `RUN_DATABASE_INTEGRATION_TESTS=true` |
| Backend coverage gate | Passed: 66.09% lines, 59.45% branches, 68.16% functions |
| PostgreSQL integration | Both database integration tests passed separately on disposable PostgreSQL 16 |
| Full migration history | Applied successfully to disposable PostgreSQL 16 |
| Database security verifier | Passed on the disposable migrated database |
| Backend production dependency audit | 0 known vulnerabilities |
| Frontend lint | Passed |
| Frontend unit tests | 12 passed |
| Frontend production build and TypeScript | Passed |
| Frontend Playwright E2E | 12 passed with zero unexpected mock API requests |
| Frontend production dependency audit | 0 known vulnerabilities |
| GitHub Actions syntax | `actionlint` passed for CI and CD |
| Backup/restore shell validation | `bash -n` and ShellCheck passed in Linux |
| Local Paris database recovery | Encrypted database-only snapshot restored successfully to disposable PostgreSQL 17: 35 public tables and 35 migration records |
| Git whitespace validation | Passed |

## Remediated Issues

### Database configuration and exposure

- `DIRECT_URL` is now required at backend startup and covered by tests.
- The new database migration enables RLS on every public table and revokes table/default privileges from unused Supabase Data API roles.
- `npm run prisma:security:verify` checks those properties in CI and deployment.
- Documentation consistently identifies Paris `eu-west-3` through Supavisor session mode on port `5432` for the IPv4-only French VPS.

### Legacy poster import

- Every legacy poster has a stable unique import key.
- The importer takes a PostgreSQL advisory transaction lock, rechecks within the transaction, backfills legacy records, and handles repeated requests idempotently.
- Functional tests cover stable keys, duplicate skips, and the lock.

Filesystem and PostgreSQL cannot form one atomic transaction. The importer retains cleanup handling, but an abrupt host/process failure can still require asset reconciliation. Run this administrative operation only with a current backup.

### Recruitment privacy

- Applicants must confirm permission separately for every team member whose contact or NIC data is submitted.
- The backend enforces the declaration and records `privacyAcceptedAt` per member.
- Admin review and Excel exports expose the timestamp; pre-policy records are labeled as legacy.
- The API, admin, privacy policy, QA checklist, and operational documentation are aligned.

### CI, browser tests, and deployment safety

- Playwright now builds against a dedicated mock API port and fails teardown on any unrecognized request.
- Migration-changing production deploys require `BACKEND_MIGRATION_APPROVAL_SHA` to equal the exact tested 40-character commit.
- CD rejects additional destructive patterns, creates an encrypted off-site backup before migration, verifies database security afterward, and performs public API smoke reads after restart.
- The backup captures PostgreSQL, public uploads, and private uploads, encrypts with an offline `age` recipient, uploads through `rclone`, and verifies the remote objects.
- A guarded restore script and systemd service/timer templates are included.

### Local sensitive artifacts

Windows ACLs on `backend/.env` and `D:\Work\QuestEsports-db-migration` were restricted to the current user, `SYSTEM`, and Administrators. The migration dumps were preserved; none were deleted.

## Remaining Findings and Release Gates

### Closed: Full off-site restore drill completed

The French VPS now creates encrypted PostgreSQL/public-upload/private-upload archives, uploads them to `quest-backups:quest-esports/production`, and runs a daily restricted systemd timer. Both a manual full backup and the sandboxed systemd service completed successfully on 2026-07-29. The database-only Paris Windows snapshot also restored successfully on disposable PostgreSQL 17.

The full archive `quest-production-20260729T133809Z.tar.gz.enc` was downloaded with its checksum, decrypted only on the isolated recovery PC, and restored to disposable PostgreSQL 17 plus empty temporary upload roots. The result contained 35 public tables and 33 completed migrations. SHA-256 manifests matched all 41 public and 10 private files. The drill found and corrected the restore script's missing `pg_restore --dbname` option, then passed end to end. Production was never a restore target.

### High: Replace rclone's retiring shared Google Drive client ID

rclone 1.74.4 reported that its shared Google Drive OAuth client ID is being retired during 2026. The current VPS remote still works, but scheduled backups will eventually fail if it is not replaced. Create a dedicated Google OAuth desktop client, update the `quest-backups` remote without exposing its token, rerun `quest-esports-backup.service`, and record the successful result.

### Closed: Production deployment externally verified

Commit `239ecf745e78a85ca954e73b748d8df600831713` passed CI and protected CD on 2026-07-29. CD completed the encrypted pre-migration backup, applied the Paris hardening migration, verified database security, restarted `quest-backend`, and passed health and public API smoke checks. A separate post-deploy check found no pending Prisma migrations and received HTTP 200 from the frontend, health, tournaments, products, and commerce-capabilities endpoints. The one-release migration approval value was cleared afterward.

### Medium: Supabase Data API dashboard switch remains manual

The application uses Prisma and does not need the Supabase Data API. The migration removes table privileges even if the API remains enabled, but the Paris dashboard switch itself could not be changed from the available local/browser session.

Required action: in the Paris Supabase project, open API/Data API settings, disable Data API, then run `npm run prisma:security:verify` against production after deployment.

### Medium: Frontend development audit reports lint-tool advisories

`npm audit` including development packages reports nine High findings through ESLint/Next lint dependencies and `minimatch`. The production audit is clean. The vulnerable `brace-expansion` versions are overridden to patched releases, but npm still attributes the advisory to the parent `minimatch` package metadata. Forcing the proposed ESLint 10/older Next configuration caused incompatibility and lint failures, so it was not retained.

Required action: keep the production audit as the release security gate, do not process untrusted glob patterns in lint tooling, and retest removal of overrides when the supported Next/ESLint dependency chain updates.

### Medium: External service readiness is unverified

SES Tokyo credentials and sandbox/production status, monitoring/Discord alert delivery, Vercel deployment state, Supabase health/capacity, and PayHere behavior require authorized live checks. Region labels in documentation do not prove delivery or uptime.

### Low: Critical-flow coverage can still improve

The aggregate coverage gate passes, but authentication, TOTP, mail templates, shop service, production error mapping, and upload edge cases remain below the project average. Add targeted behavior tests as those areas change; do not lower the existing gate.

## Safest Remaining Order

1. Commit documentation/config-example changes without committing `.env`, database dumps, `age` identities, or `rclone` tokens.
2. Require normal CI/CD and verify the public health endpoint after deployment.
3. Replace rclone's retiring shared Google Drive client ID and rerun the restricted systemd backup.
4. Repeat the isolated full database/upload restore drill at least quarterly.
5. Disable the unused Paris Supabase Data API in the dashboard and rerun `npm run prisma:security:verify`.
6. Verify Tokyo mail delivery, alert delivery, persistent storage mounts, and any enabled payment paths.
7. After the rollback-retention decision, delete the old Tokyo Supabase project and rotate credentials that no longer need to remain valid.

Operational commands and exact safeguards are in [Production Operations Runbook](./production-runbook.md), [Deployment and Migration Safety](./DEPLOYMENT_SAFETY.md), and [Pre-deployment Checklist](./pre-deployment-checklist.md).
