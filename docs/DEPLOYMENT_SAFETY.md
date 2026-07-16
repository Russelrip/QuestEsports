# Deployment and migration safety

Production deployments are promoted only from a successful `CI` run on `main`. The deploy workflow uses that exact tested commit and rejects newly introduced destructive migration statements.

## Migration rules

1. Use expand-and-contract changes. Add nullable columns or new tables first, deploy code that can read both shapes, backfill separately, and remove the old shape only in a later release.
2. Never edit a migration that has been applied to any shared environment. Create a new forward migration instead.
3. Wrap new PostgreSQL migrations in `BEGIN;` and `COMMIT;` when every statement is transaction-safe. Operations such as `CREATE INDEX CONCURRENTLY` require a deliberately non-transactional migration and an explicit recovery procedure.
4. Take and verify a restorable database backup before schema removals, type changes, large backfills, or constraint tightening.
5. Run migrations against a production-like staging snapshot before production and record the expected duration and lock behavior.
6. Application rollback is allowed only while the new schema remains compatible with the previous release. Recover migration failures by fixing forward unless a tested database restore is being performed.

## Release verification

The deployment must pass the database-backed `/api/health/ready` endpoint. `/api/health/live` only proves that the Node process can answer requests and must not be used as the deployment gate.

Before enabling commerce after a release, smoke-test product quoting, order creation in the payment sandbox, payment notification reconciliation, reservation expiration, and bank-transfer proof access.
