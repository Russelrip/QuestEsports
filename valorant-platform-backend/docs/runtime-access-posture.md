# Runtime access posture (four-role model, ADR-0XX)

## Roles

| Role | Schema | Responsibility | DDL or DML |
|---|---|---|---|
| Quest migrator | `public` | Prisma migrations (`npm run prisma:migrate:deploy`) | DDL |
| Quest runtime | `public` | Quest app queries (Prisma client) | DML only |
| VAL migrator | `valorant` | `scripts/apply_migrations.py` (schema + `_migration_ledger`) | DDL |
| VAL runtime | `valorant` | FastAPI app queries (SQLAlchemy async) | DML only |

## RLS decision (spec §7.4, option (a))

Every `valorant` table has RLS enabled and one explicit policy
`<table>_runtime_all` granting `FOR ALL ... USING (true) WITH CHECK (true)` to
the VAL runtime role. The migrator is the schema/table owner and bypasses RLS.
No anonymous grants; no `PUBLIC` grants; `quest_*` roles have no privileges on
`valorant`; the VAL runtime role has no privileges on `public`. The running app
must connect as the runtime role; migration runs use the migrator role.

## Enforcement

- Runner: `scripts/apply_migrations.py --runtime-role <role>` grants schema,
  tables, sequences, and default privileges, and creates the policies.
- Verification: `python -m scripts.verify_runtime_access` (positive and
  `--expect-denied` modes) plus the `roles-rls` CI job.
- Quest side: `npm run prisma:security:verify`; the Quest runtime role is never
  granted anything on `valorant` (see Quest docs/setup-and-deployment.md).
