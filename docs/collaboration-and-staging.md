# Collaboration And Staging

This repository contains production deployment automation, but collaborators must work without production credentials or production data.

## Contributor Workflow

1. Create a branch from `main`.
2. Develop against the separate QuestEsports staging Supabase project.
3. Push the branch and open a pull request.
4. Wait for CI and the secret scan to pass.
5. The repository owner reviews and merges the pull request.
6. Only the repository owner starts the manual production deployment workflow.

GitHub Free does not enforce branch protection or protected-environment approval for this private personal repository. The process above is therefore a collaboration rule, not a complete technical control. A write collaborator can edit workflow files and remove actor checks. Before granting write access, either upgrade/move the repository to a plan and ownership model that supports enforced review for private deployments, move deployment workflows and secrets to a separate owner-only repository, or remove production/release secrets and deploy locally. Do not rely on actor checks alone as a secret boundary.

Confirm current plan support against GitHub's [deployment environments documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) before storing any production secret in an Environment.

## Staging Data

- Use a separate Supabase project and database password.
- Disable the Supabase Data API because the application connects through Prisma.
- Do not copy production users, sessions, payment evidence, recruitment IDs, email addresses, phone numbers, OAuth grants, tokens, or uploaded private files.
- Prefer schema-only migrations plus synthetic test records.
- If production-like data is essential for a test, anonymize it before it enters staging and document the approved fields and retention period.

The repository includes a guarded copier for the limited public-data subset. It copies published game categories, event series, tournaments and sponsors, referenced rulebooks, active products and variants, and non-draft ticket events. It removes media file references and bank details, changes copied tournament payment methods to free, clears product stock, and never reads identity or transaction tables.

After applying migrations, mark each database once using its real Supabase project reference. Run the production statement only in the production SQL editor and the staging statement only in staging:

```sql
INSERT INTO deployment_environment (id, environment, project_ref, updated_at)
VALUES (1, 'production', 'PRODUCTION_PROJECT_REF', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET environment = EXCLUDED.environment, project_ref = EXCLUDED.project_ref, updated_at = CURRENT_TIMESTAMP;
```

Use `staging` and the staging project reference for the staging database. The copier refuses missing, swapped, inconsistent, or matching markers.

Preview the source and target row counts before writing:

```powershell
Set-Location backend
npm run data:copy-public-to-staging
```

Apply sanitized upserts only after confirming both database labels and using the target project reference shown by the dry run:

```powershell
$env:STAGING_COPY_CONFIRMATION="COPY_PRODUCTION_TO_STAGING:STAGING_PROJECT_REF"
npm run data:copy-public-to-staging:apply
```

The command reads production from the ignored `backend/.env` and staging from the ignored `backend/.env.staging.local`. It validates database-resident environment markers and Supabase project references, enforces TLS, and remains read-only on production. Normal apply does not delete staging rows. To remove stale public rows, first back up staging, review the dry run, then use `STAGING_COPY_CONFIRMATION=PRUNE_AND_COPY_PRODUCTION_TO_STAGING:STAGING_PROJECT_REF` with `npm run data:copy-public-to-staging:prune`. Pruning is intentionally a separate destructive operation.

## Local Configuration

Copy the tracked example files to ignored local files:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item mobile-admin/.env.example mobile-admin/.env.local
```

Set `DATABASE_URL` and `DIRECT_URL` in `backend/.env` to the staging database endpoints with `sslmode=require` or a stronger verification mode. Never send the production backend `.env`, Supabase database password, service-role key, VPS SSH credentials, OAuth client secrets, PayHere merchant secret, or GitHub Actions secrets to a collaborator.

Before committing, verify ignored files remain untracked:

```powershell
git status --short
git check-ignore -v backend/.env frontend/.env.local mobile-admin/.env.local
```

## Database Setup

Apply the existing schema to staging from the repository:

```powershell
Set-Location backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:security:verify
```

Use a new Prisma migration for every schema change. Never edit a migration already applied to a shared environment.
