# Quest Esports

Quest Esports is a tournament, team, commerce, and event-operations platform. The repository contains the public website and admin dashboard, an Express API, a private Android admin client, PostgreSQL migrations, and production backup/deployment tooling.

## Applications

| Workspace | Purpose | Local URL |
| --- | --- | --- |
| `frontend/` | Next.js public site, account area, and web admin | `http://localhost:3000` |
| `backend/` | Express API, Prisma, jobs, uploads, and integrations | `http://localhost:5001` |
| `mobile-admin/` | Private Expo/Android operations client | Expo development server |
| `ops/` | Production backup, restore, retention, and recovery scripts | Not applicable |

## Requirements

- Node.js 24 LTS
- npm 10 or newer
- PostgreSQL 15 or newer, or a Supabase PostgreSQL project
- Android Studio/SDK only when working on `mobile-admin/`

## Quick Start

### 1. Create local environment files

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item mobile-admin/.env.example mobile-admin/.env.local
```

Set the backend database URLs and required local values in `backend/.env`. Keep all real `.env` files and credentials untracked. The example files document the supported keys; production requirements live in [Setup and Deployment](./docs/setup-and-deployment.md).

### 2. Install dependencies

```powershell
Set-Location backend
npm ci

Set-Location ../frontend
npm ci

Set-Location ../mobile-admin
npm ci
```

### 3. Prepare the database

For a new shared environment such as staging:

```powershell
Set-Location backend
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:security:verify
```

Use `npm run prisma:migrate` only when creating a new local development migration. Never edit a migration already applied to a shared environment.

### 4. Start the web applications

Run these in separate terminals:

```powershell
Set-Location backend
npm run dev
```

```powershell
Set-Location frontend
npm run dev
```

Useful endpoints:

- Frontend: `http://localhost:3000`
- API: `http://localhost:5001`
- Liveness: `http://localhost:5001/api/health/live`
- Readiness: `http://localhost:5001/api/health/ready`
- OpenAPI: `http://localhost:5001/api/openapi.json`

## Verification

Backend:

```powershell
Set-Location backend
npm run lint
npm test
npm run test:coverage
```

Frontend:

```powershell
Set-Location frontend
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Mobile admin:

```powershell
Set-Location mobile-admin
npm run typecheck
npm test
npm run doctor
```

CI runs the supported release checks with Node 24. Real-database integration tests require an isolated test database and `RUN_DATABASE_INTEGRATION_TESTS=true`.

## Platform Scope

The platform currently supports:

- tournament discovery, registration, schedules, participants, and completed-event results
- native brackets and optional Challonge-backed bracket operations
- reusable teams, invitations, player profiles, and verified organizations
- event series, game categories, sponsors, posters, rulebooks, and media
- free, PayHere, and reviewed bank-transfer tournament payments
- merchandise products, variants, orders, fulfilment, and reconciliation
- entrance-ticket sales, signed QR tickets, and live check-in
- recruitment, contact messages, exports, and administrative review workflows
- password and OAuth authentication, sessions, email verification, and recovery
- private Android operations for registrations, payments, tickets, content, and users

Detailed endpoint contracts are in [API Documentation](./docs/api-documentation.md); operating procedures are in [Admin Operations](./docs/admin-operations.md).

## Architecture and Data

- The browser talks to the Express API; it does not access PostgreSQL directly.
- Prisma owns the application schema and migration history.
- PostgreSQL stores relational data; public and private uploads live on durable filesystem roots.
- Browser authentication uses `HttpOnly` sessions. The Android client uses a Keystore-backed bearer session.
- Payment evidence is private and never served through public upload routes.
- Production backups cover PostgreSQL and both upload roots as one recovery set.
- The Supabase Data API is unused; public tables retain RLS and Data API roles have no table privileges.

Read [Database and Storage](./docs/database-and-storage.md), [Authentication Flow](./docs/authentication-flow.md), and [Backup and Disaster Recovery](./docs/backup-and-disaster-recovery.md) before changing those boundaries.

## Repository Layout

```text
QuestEsports/
|-- .github/        GitHub Actions, ownership, and PR policy
|-- backend/        Express API, Prisma schema/migrations, tests, and load profiles
|-- frontend/       Next.js application, unit tests, and Playwright journeys
|-- mobile-admin/   Private Expo/Android admin application
|-- docs/           Architecture, product, security, and operations documentation
|-- ops/            Production backup and recovery tooling
`-- README.md       Repository entry point
```

Generated output, dependencies, uploads, local environment files, credentials, and recovery artifacts must remain untracked.

## Documentation

Start at the [documentation index](./docs/README.md). Frequently used guides:

| Task | Guide |
| --- | --- |
| Local setup or deployment | [Setup and Deployment](./docs/setup-and-deployment.md) |
| Collaborator or staging setup | [Collaboration and Staging](./docs/collaboration-and-staging.md) |
| Production operation or incident | [Production Operations Runbook](./docs/production-runbook.md) |
| Release approval | [Pre-deployment Checklist](./docs/pre-deployment-checklist.md) |
| CI/CD behavior | [CI/CD Pipeline](./docs/ci-cd.md) |
| Database and files | [Database and Storage](./docs/database-and-storage.md) |
| Admin workflows | [Admin Operations](./docs/admin-operations.md) |
| Commerce and tournaments | [Commerce and Tournament Operations](./docs/commerce-and-tournament-operations.md) |
| Backup or restore | [Backup and Disaster Recovery](./docs/backup-and-disaster-recovery.md) |
| Secret recovery | [Secret and Infrastructure Recovery](./docs/secret-and-infrastructure-recovery.md) |

## Collaboration and Deployment

Contributors work on branches and submit pull requests. CODEOWNERS requests review from `@Russelrip`, CI validates every PR, and Gitleaks scans commits for credentials.

Because this private personal repository is on GitHub Free, branch protection is not enforceable. Production backend deployment is therefore manual and restricted in the workflow to the repository owner. A collaborator must never receive production database, VPS, payment, OAuth, mail, or signing credentials.

See [Collaboration and Staging](./docs/collaboration-and-staging.md) before granting access.
