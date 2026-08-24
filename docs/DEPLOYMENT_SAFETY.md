# Deployment and migration safety

Production deployments are promoted only from a successful `CI` run on the exact dispatched commit (normally `main`). The deploy workflow uses that exact tested commit and rejects newly introduced destructive migration statements. It does not enforce that the dispatched ref is `main`; the owner must dispatch from `main` to preserve the documented main-only promotion intent. A commit that changes migration SQL is approved through the `Production` environment's required reviewer, which pauses the deployment until the owner approves it in the Actions UI, and must complete an encrypted off-site backup before migration.

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

The deployment first requires `/api/health/live` to return `200`, proving that the restarted Node process can answer. Liveness alone is never sufficient. During normal operation, the database-and-storage-backed `/api/health/ready` endpoint must also return `200`, followed by public API smoke reads. During an approved full-site maintenance window, readiness may instead return `503` only when `X-Maintenance-Mode: active` is present; CD then skips public reads that are intentionally protected. Any other `503` remains a deployment failure.

Maintenance mode is not a migration write freeze because background jobs and the PayHere notification callback continue. Stop the backend PM2 process before any restore or operation that requires zero writes, following the [Production Operations Runbook](./production-runbook.md#full-stop-and-write-freeze-warning).

Before enabling commerce after a release, smoke-test product quoting, order creation in the payment sandbox, payment notification reconciliation, reservation expiration, and bank-transfer proof access.

The [Backup and Disaster Recovery](./backup-and-disaster-recovery.md) guide contains timer verification, encryption/key custody, isolated drills, and production recovery. Never test restoration against the live Paris database or live upload roots.

## VALORANT two-schema expand-first rules (Quest + valorant-platform-backend)

The VALORANT integration runs both services against one Supabase project but
keeps two owned schemas: Quest Prisma owns `public`; FastAPI's plain-SQL ledger
owns `valorant`. Deployment follows the same expand-and-contract discipline:

1. Quest Prisma migrations touch only `public`; FastAPI `supabase/migrations/*.sql`
   touch only `valorant`. CI enforces both directions: `verify-prisma-schema-scope.js`
   in Quest CI and the migration-scope grep guard in FastAPI CI.
2. No cross-schema foreign keys. Quest stores every VALORANT UUID as opaque
   `text`; referential integrity is application-level plus FastAPI-read
   reconciliation.
3. Each deploy wave adds columns/tables first, backfills data in a later
   statement of the same wave, and enforces new constraints only in a
   subsequent deploy. Never drop a column/table in the same deploy that
   populates it.
4. Rollback = revert the app deployment. Newly added columns must stay nullable
   or defaulted so the previous app version remains compatible; the CD gate
   (the `Production` environment's required reviewer, plus
   `BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA` for destructive SQL)
   applies to Quest, and FastAPI production migrations follow the same manual
   approval + backup discipline.
5. `prisma migrate reset` / `db drop` and the FastAPI reset harness remain
   forbidden against shared/remote databases.
6. Take and verify a restorable two-schema backup before any production
   migration that touches either schema (`ops/backup-production.sh` now dumps
   both `public` and `valorant`).
