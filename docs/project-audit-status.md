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

### High: Production backup and restore are not configured or proven

An offline `age` identity now exists under restricted local ACLs, and a database-only Paris snapshot restored successfully on isolated PostgreSQL. However, no off-site destination, VPS upload archive, or systemd timer is configured yet. The local database snapshot alone is not a complete production backup.

Required action:

1. Configure `/etc/quest-esports-backup.env` and the restricted `rclone` configuration on the VPS.
2. Run a manual backup as `deploy` and confirm both encrypted archive and checksum remotely.
3. Restore that archive to disposable PostgreSQL and temporary upload roots using the offline private identity.
4. Record table counts, asset checks, timing, and the recovery date.

Do not deploy the new production migration or delete the Tokyo rollback project until this gate passes.

### High: Current working tree is not deployed or externally verified

Local success does not establish that the VPS server or public site is running this commit. Commit/push the changes, require clean CI, then deploy through the protected production environment. Verify PM2, readiness, public API reads, frontend behavior, mail, alerts, and any enabled payment flows after deployment.

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

## Safest Release Order

1. Review and commit the complete diff without committing `.env`, database dumps, `age` private identities, or `rclone` secrets.
2. Push a branch and require the complete Linux/PostgreSQL GitHub CI workflow to pass.
3. Configure and manually verify the encrypted off-site backup on the French VPS.
4. Complete and record an isolated database/upload restore drill.
5. Disable the unused Paris Supabase Data API.
6. Set `BACKEND_MIGRATION_APPROVAL_SHA` to the exact reviewed commit and deploy through CD.
7. Verify production migrations/security, PM2, readiness, public API smoke reads, and the Vercel frontend.
8. Verify Tokyo SES delivery, alert delivery, persistent storage mounts, and enabled payment paths.
9. Clear the one-release approval secret.
10. After backup/restore and production verification succeed, delete the old Tokyo Supabase project and rotate its database credentials.

Operational commands and exact safeguards are in [Production Operations Runbook](./production-runbook.md), [Deployment and Migration Safety](./DEPLOYMENT_SAFETY.md), and [Pre-deployment Checklist](./pre-deployment-checklist.md).
