# Quest Esports Backend

Express 5 API for authentication, tournaments, teams, commerce, event tickets, admin workflows, uploads, integrations, and background jobs. PostgreSQL access is managed through Prisma.

## Requirements

- Node.js 24 LTS
- npm 10 or newer
- PostgreSQL 15 or newer

## Setup

```powershell
Copy-Item .env.example .env
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

The API defaults to `http://localhost:5001`.

Required environment values are `DATABASE_URL`, `DIRECT_URL`, and `SESSION_COOKIE_NAME`. Remote production database URLs must explicitly use `sslmode=require`, `verify-ca`, or `verify-full`. Normal development outside automated tests also needs a unique 64-character hexadecimal `AUTH_ENCRYPTION_KEY`. Use [.env.example](./.env.example) as the key reference and [Setup and Deployment](../docs/setup-and-deployment.md) for production requirements.

Do not point local development at production. Shared staging environments should use their own database, encryption key, OAuth applications, mail configuration, and upload roots.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start with Nodemon |
| `npm start` | Start without file watching |
| `npm run lint` | Lint source, scripts, and tests |
| `npm test` | Run the unit/service suite |
| `npm run test:coverage` | Run enforced coverage gates |
| `npm run test:integration` | Run real-database integration tests when enabled |
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:migrate` | Create/apply a local development migration |
| `npm run prisma:migrate:deploy` | Apply committed migrations to a shared environment |
| `npm run prisma:migrate:status` | Check migration state |
| `npm run prisma:security:verify` | Verify RLS and Data API privilege hardening |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run mail:verify` | Validate configured mail delivery |
| `npm run load:test` | Run the standard k6 API profile |
| `npm run load:stress:db` | Run the database-focused k6 profile |

Legacy media import/migration commands remain available for controlled recovery work. Back up PostgreSQL and uploads before using them.

## API and Health

- API root: `http://localhost:5001/api`
- Liveness: `http://localhost:5001/api/health/live`
- Readiness: `http://localhost:5001/api/health/ready`
- OpenAPI JSON: `http://localhost:5001/api/openapi.json`

Route families cover authentication, sessions, tournaments, registrations, teams, event series, recruitment, contact messages, media, products, payments, tickets, brackets, matches, and admin operations. See [API Documentation](../docs/api-documentation.md) for contracts.

## Data and Storage

- Prisma uses one process-wide client with bounded pool defaults.
- Public uploads live below `UPLOAD_ROOT`; private payment evidence lives below `PRIVATE_UPLOAD_ROOT`.
- The database and both durable roots form one backup set.
- Public response caching defaults to bounded in-memory storage; multi-process deployments require the shared Upstash cache.
- Readiness verifies PostgreSQL and write access to both configured upload roots.

See [Database and Storage](../docs/database-and-storage.md) before changing schema, uploads, retention, or media behavior.

## Security Boundaries

- Browser auth uses hashed server-side sessions and `HttpOnly` cookies.
- Native admin auth uses revocable bearer sessions; OAuth hand-off grants are short-lived and single-use.
- Production requires exact HTTPS origins, trusted-proxy configuration, durable storage, a unique encryption key, and complete mail settings.
- OAuth, payment, mail, monitoring, webhook, and Challonge credentials are backend-only.
- The Supabase Data API is unused; migrations enforce RLS and revoke its table privileges.
- Maintenance mode is not a write freeze: liveness, PayHere callbacks, and workers continue.

Operational details are in [Authentication Flow](../docs/authentication-flow.md), [Email System](../docs/email-system.md), [Admin Operations](../docs/admin-operations.md), and the [Production Operations Runbook](../docs/production-runbook.md).

## Testing and Performance

```powershell
npm run lint
npm test
npm run test:coverage
```

Set `RUN_DATABASE_INTEGRATION_TESTS=true` only with an isolated test database. Run k6 profiles only against local or dedicated test infrastructure, never production.
