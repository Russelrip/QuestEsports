# Deployment and migration safety

Production deployments are promoted only from a successful `CI` run on `main`. The deploy workflow uses that exact tested commit and rejects newly introduced destructive migration statements. A commit that changes migration SQL also requires the protected `BACKEND_MIGRATION_APPROVAL_SHA` secret to equal that exact 40-character commit SHA and must complete an encrypted off-site backup before migration.

The gate checks both Git migration changes and migrations actually pending in production. This prevents a previously interrupted checkout from making a pending migration appear already deployed. A successful-deploy SHA marker is written only after migration, security verification, restart, health checks, and smoke checks succeed.

## Migration rules

1. Use expand-and-contract changes. Add nullable columns or new tables first, deploy code that can read both shapes, backfill separately, and remove the old shape only in a later release.
2. Never edit a migration that has been applied to any shared environment. Create a new forward migration instead.
3. Wrap new PostgreSQL migrations in `BEGIN;` and `COMMIT;` when every statement is transaction-safe. Operations such as `CREATE INDEX CONCURRENTLY` require a deliberately non-transactional migration and an explicit recovery procedure.
4. Take and verify a restorable encrypted off-site database and upload backup before every production migration. Use `ops/backup-production.sh`; a schema-changing CD run enforces this gate.
5. Run migrations against a production-like staging snapshot before production and record the expected duration and lock behavior.
6. Application rollback is allowed only while the new schema remains compatible with the previous release. Recover migration failures by fixing forward unless a tested database restore is being performed.
7. Run `npm run prisma:security:verify` after migration so every public table retains RLS and unused Supabase Data API roles retain no table privileges.

Do not set the approval secret broadly or permanently. Set it only after reviewing one exact commit, deploy it once, then clear it. Backup success means the encrypted archive and matching checksum are visible on the configured off-site remote; a local file alone is insufficient.

## Release verification

The deployment must pass the database-backed `/api/health/ready` endpoint. `/api/health/live` only proves that the Node process can answer requests and must not be used as the deployment gate.

Before enabling commerce after a release, smoke-test product quoting, order creation in the payment sandbox, payment notification reconciliation, reservation expiration, and bank-transfer proof access.

The production runbook contains the backup timer installation and isolated restore-drill procedure. Never test restoration against the live Paris database or live upload roots.
