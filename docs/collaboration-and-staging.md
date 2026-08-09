# Collaboration And Staging

This repository contains production deployment automation, but collaborators must work without production credentials or production data.

## Contributor Workflow

1. Create a branch from `main`.
2. Develop against the separate QuestEsports staging Supabase project.
3. Push the branch and open a pull request.
4. Wait for CI and the secret scan to pass.
5. The repository owner reviews and merges the pull request.
6. Only the repository owner starts the manual production deployment workflow.

GitHub Free does not enforce branch protection for this private personal repository. The process above is therefore a collaboration rule as well as a technical control. Production deployment is manual and restricted by the workflow to the `Russelrip` account so a normal collaborator push cannot trigger it accidentally.

## Staging Data

- Use a separate Supabase project and database password.
- Disable the Supabase Data API because the application connects through Prisma.
- Do not copy production users, sessions, payment evidence, recruitment IDs, email addresses, phone numbers, OAuth grants, tokens, or uploaded private files.
- Prefer schema-only migrations plus synthetic test records.
- If production-like data is essential for a test, anonymize it before it enters staging and document the approved fields and retention period.

## Local Configuration

Copy the tracked example files to ignored local files:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item mobile-admin/.env.example mobile-admin/.env.local
```

Set `DATABASE_URL` and `DIRECT_URL` in `backend/.env` to the staging database endpoints. Never send the production backend `.env`, Supabase database password, service-role key, VPS SSH credentials, OAuth client secrets, PayHere merchant secret, or GitHub Actions secrets to a collaborator.

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
