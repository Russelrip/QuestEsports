# Developer Guide

This guide describes the supported local developer workflow for Quest Esports. It is intentionally a contributor guide, not a provisioning or production-operations manual. Use [Setup and Deployment](./setup-and-deployment.md) for provisioning and deployment configuration, and [Production Operations Runbook](./production-runbook.md) for runtime changes.

## Prerequisites

Install the following before working in the relevant package:

- Node.js 24 LTS and npm 10 or newer.
- PostgreSQL 15 or newer for backend development. Use a dedicated local or test database; never use production data or credentials. A Supabase PostgreSQL project may be used for isolated staging or integration testing.
- Android Studio and the Android SDK when working on `mobile-admin/` or building an Android APK.
- Playwright browsers for frontend E2E work. CI installs Chromium, Firefox, and WebKit with `npx playwright install --with-deps chromium firefox webkit`.
- Bash and `curl` for the VALORANT smoke script (`npm run test:valorant:smoke`).
- k6 only for the backend load profiles (`npm run load:test` and `npm run load:stress:db`); run those profiles only against local or dedicated test infrastructure.
- For the opt-in VALORANT two-service workflow, a checkout of the sibling `valorant-platform-backend` repository, `uv`, and access to the isolated test services and credentials owned by that integration.

Keep dependencies, generated output, uploads, local environment files, credentials, and recovery artifacts untracked.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `.github/` | GitHub Actions workflows, ownership, and pull-request policy |
| `backend/` | Express API, Prisma schema and migrations, jobs, integrations, tests, and load profiles |
| `frontend/` | Next.js public site, account area, web admin, unit tests, and Playwright journeys |
| `mobile-admin/` | Private Expo/Android operations client |
| `docs/` | Architecture, development, security, product, and operations documentation |
| `ops/` | Production backup, recovery, and controlled operational utilities |

The browser talks to the Express API; it does not access PostgreSQL directly. Prisma owns the application schema and migration history.

## Branches and pull requests

1. Create a branch from `main`.
2. Work against a separate staging or isolated test database as appropriate; do not use production credentials or data.
3. Create a focused commit and push the branch.
4. Open a pull request to `main`, describe what changed and why, and record verification and deployment notes without secret values.
5. Wait for CI and the secret scan to pass, then wait for repository-owner review and merge.
6. Only the repository owner starts the manual production deployment workflow.

Before opening the pull request, check that `.env` files, credentials, production data, private uploads, and generated output are not tracked. Database changes must use a new forward-only Prisma migration; never edit a migration already applied to a shared environment. GitHub Free does not enforce branch protection for this private repository, so this workflow is a collaboration rule rather than a complete technical control.

## Initial local environment

Run from the repository root in PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item mobile-admin/.env.example mobile-admin/.env.local
```

The mobile example contains deployment-oriented defaults. Before launching `mobile-admin`, replace `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SITE_URL`, and `EXPO_PUBLIC_OAUTH_REDIRECT_URL` in `mobile-admin/.env.local` with the intended local or isolated-test API, site, and redirect values; do not silently launch with the copied values unchanged.

Install each package independently because there is no root workspace install or root development command:

```powershell
Set-Location backend
npm ci

Set-Location ../frontend
npm ci

Set-Location ../mobile-admin
npm ci
```

Set backend database URLs and required local values in `backend/.env`. Keep real environment files untracked. The complete variable inventory and safe value guidance are in [Environment Reference](./environment-reference.md).

## Backend development

The backend is an Express API backed by PostgreSQL through Prisma. Its normal development URL is `http://localhost:5001`.

```powershell
Set-Location backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run dev
```

The setup block applies committed migrations with `npm run prisma:migrate:deploy`.
For a shared or staging database, use that command and do not reset, drop, or
force-reset a shared or remote database. Check migration state with
`npm run prisma:migrate:status` and verify database RLS and Data API privilege
hardening with `npm run prisma:security:verify`.

### Intentional local schema/migration creation

Use this separate flow only when the local schema change is intended to create
a new migration:

```powershell
Set-Location backend
npm run prisma:generate
npm run prisma:migrate
```

When a schema change is ready for review:

1. Create a new migration during local development with `npm run prisma:migrate`.
2. Review the generated SQL and commit the new migration directory with the schema change.
3. Never modify an already-applied migration. Production rollback restores application code, not database migrations, so migrations must remain backward-compatible with the previous application release.
4. Use [Setup and Deployment](./setup-and-deployment.md) for provisioning and [Production Operations Runbook](./production-runbook.md) for runtime migration, backup, and deployment procedures.

Useful local API endpoints are `http://localhost:5001/api/health/live`, `http://localhost:5001/api/health/ready`, and `http://localhost:5001/api/openapi.json`.

### Backend verification

Run from `backend/`:

```powershell
npm run lint
npm test
npm run test:coverage
```

`npm run test:integration` is opt-in and uses the isolated test database configured in `backend/.env`. The package script enables the integration-test gate itself:

```powershell
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run prisma:security:verify
npm run lint
npm test
npm run test:integration
```

The backend owning-package E2E commands for the optional VALORANT integration are `npm run test:valorant:smoke` and `npm run test:valorant:e2e`. The smoke command checks already-running services; the two-service E2E command requires the sibling platform backend and its isolated test configuration. Do not point either workflow at production.

## Frontend development

The frontend is a Next.js application at `http://localhost:3000` and normally calls the backend at `http://localhost:5001`.

```powershell
Set-Location frontend
npm ci
npm run dev
```

Set `NEXT_PUBLIC_API_URL=http://localhost:5001` and `NEXT_PUBLIC_SITE_URL=http://localhost:3000` for normal local work. A reachable backend is required for ordinary development.

Frontend verification from `frontend/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e:local
```

`npm run test:e2e` is the frontend owning-package E2E command and runs Playwright against an existing build. The existing build must have been created with the mock API URL and port below, and the Playwright mock API must use port `5011`. Prefer `npm run test:e2e:local`, which sets `NEXT_PUBLIC_API_URL=http://127.0.0.1:5011` and `PLAYWRIGHT_MOCK_API_PORT=5011`, builds with those values, and then runs the journey suite:

```powershell
npm run test:e2e:local
```

If running the existing-build command directly, use the same mock values during the build and test:

```powershell
$env:NEXT_PUBLIC_API_URL='http://127.0.0.1:5011'
$env:PLAYWRIGHT_MOCK_API_PORT='5011'
npm run build
npm run test:e2e
```

### CI mock API

Frontend CI does not depend on a separately running backend. Its deterministic mock API listens on port `5011`, with `NEXT_PUBLIC_API_URL=http://127.0.0.1:5011` and `PLAYWRIGHT_MOCK_API_PORT=5011`. Port `5011` is CI/test-only mock traffic. It is not the normal backend development port, which is `5001`.

Use the CI mock only through the frontend E2E harness. Do not change the normal local backend URL to `5011`, and do not put production credentials or data into the mock fixtures.

## Mobile-admin development

`mobile-admin/` is a private Expo/Android operations client. It covers operational administration such as registrations, payments, tickets, fulfilment, recruitment, contact messages, teams, users, tournaments, products, event series, game categories, and rulebooks. It does not provide offline admission or offline operational storage, and no credential or signing key belongs in the APK.

For local work, use a reachable backend and, for a physical device using a local API, set `EXPO_PUBLIC_API_URL` to the computer's LAN HTTPS address. The mobile app's default production API is environment-specific and must be owner-maintained rather than copied into local files.

```powershell
Set-Location mobile-admin
npm ci
npm run typecheck
npm run android
```

Mobile-admin verification from `mobile-admin/`:

```powershell
npm run typecheck
npm test
npm run doctor
```

The mobile package has no E2E script in its manifest. Android release validation additionally uses the supported `npm run prebuild:android` command in CI or an owner-controlled release environment. Private APK tags use the `admin-vMAJOR.MINOR.PATCH` pattern; signing secrets and the release keystore stay owner-maintained and out of this repository.

## Opt-in integration and E2E workflows

- **Backend database integration:** configure a dedicated test database, apply migrations, check status and security, then run `npm run test:integration` from `backend/`; the package script enables the integration-test gate itself.
- **Frontend local E2E:** install Playwright browsers, then run `npm run test:e2e:local` from `frontend/`. For an existing build, use `npm run test:e2e`.
- **VALORANT smoke:** with Bash and `curl` available, start the sibling FastAPI service and Quest backend against one dedicated test project, then run `npm run test:valorant:smoke` from `backend/`.
- **VALORANT two-service E2E:** provide the sibling FastAPI repository and the dedicated test-project environment contract, then run `npm run test:valorant:e2e` from `backend/`. The harness starts the Henrik fixture mock, FastAPI, and Quest Express itself, drives Quest admin routes, and tears down all three child processes; it does not start or use the frontend. CI skips this job when its platform token is unset.
- **Mobile Android prebuild:** run `npm run prebuild:android` only when Android native output is needed. The generated `android/` directory is ignored and is regenerated from app configuration.

Integration, load, and E2E workflows are opt-in because they may need separate services, databases, browsers, devices, or owner-maintained credentials. Never substitute production infrastructure.

## Verification checklist

Select the checks for the packages changed, keeping the working directory explicit:

- Backend: `npm run lint`, `npm test`, `npm run test:coverage`; for an isolated database, also `npm run test:integration`, `npm run prisma:migrate:status`, and `npm run prisma:security:verify`.
- Frontend: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:e2e:local`; for an existing build, use bare `npm run test:e2e` only after building with `NEXT_PUBLIC_API_URL=http://127.0.0.1:5011` and `PLAYWRIGHT_MOCK_API_PORT=5011`.
- Mobile-admin: `npm run typecheck`, `npm test`, and `npm run doctor`; use `npm run prebuild:android` when Android generation is part of the change.
- Confirm every changed environment variable is documented without exposing its value.
- Confirm schema changes use a new forward-only migration and that no applied migration was edited.
- Confirm `git status --short` contains no local environment files, credentials, production data, private uploads, or generated release output.
- Confirm the pull request describes verification and deployment notes without secret values.

For provisioning, deployment, backup, restore, and runtime changes, follow [Setup and Deployment](./setup-and-deployment.md) and [Production Operations Runbook](./production-runbook.md) instead of duplicating those procedures here.
