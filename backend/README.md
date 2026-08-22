# Quest Esports Backend

Express 5 API for authentication, tournaments, teams, commerce, event tickets, admin workflows, uploads, integrations, and background jobs. PostgreSQL access is managed through Prisma.

## Requirements

- Node.js 24.x (declared in `package.json`)
- npm 10 or newer
- PostgreSQL 15 or newer

## Setup

```powershell
Copy-Item .env.example .env
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run dev
```

The setup block applies committed migrations with
`npm run prisma:migrate:deploy`. For intentional local schema and migration
creation, use this separate flow instead:

```powershell
npm run prisma:generate
npm run prisma:migrate
```

The API defaults to `http://localhost:5001`.

Required environment values are `DATABASE_URL`, `DIRECT_URL`, and `SESSION_COOKIE_NAME`. Remote production database URLs must explicitly use `sslmode=require`, `verify-ca`, or `verify-full`. Normal development outside automated tests also needs a unique 64-character hexadecimal `AUTH_ENCRYPTION_KEY`. Use [.env.example](./.env.example) as the key reference, [Environment Reference](../docs/environment-reference.md) for the variable inventory, and [Setup and Deployment](../docs/setup-and-deployment.md) for production requirements.

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

## Clustered realtime

Use `CACHE_DRIVER=upstash` whenever `API_PROCESS_COUNT` is greater than one.
`API_PROCESS_COUNT` must equal the PM2 API worker count; all workers must share
the same `REALTIME_PUBSUB_CHANNEL` and configured `REALTIME_WORKER_ID` base.
The effective worker identity is `${REALTIME_WORKER_ID}:${process.pid}:${randomUUID()}`,
so PM2 workers sharing the base still have distinct runtime identities. Set
both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on every worker.
The memory cache is valid only for a single API process.

`GET /api/health/live` exposes the non-secret effective
`realtime.workerId` value. Use that live payload, rather than `pm2 env`, to
verify the process PID/UUID suffix and confirm that two workers report distinct
effective identities.

The transport subscribes with the exact Upstash REST request
`POST {UPSTASH_REDIS_REST_URL}/subscribe/{channel}` and publishes with
`POST {UPSTASH_REDIS_REST_URL}/publish/{channel}/{message}`. The subscribe
response is SSE and both requests use `Authorization: Bearer
{UPSTASH_REDIS_REST_TOKEN}`.

Run the optional staging exercise only when all seven variables below are set;
the command never silently skips configuration:

```powershell
$env:REALTIME_CLUSTER_WORKER_A_URL="https://api-a.example.com"
$env:REALTIME_CLUSTER_WORKER_B_URL="https://api-b.example.com"
$env:REALTIME_CLUSTER_COOKIE="quest_session=<staging-cookie>"
$env:REALTIME_CLUSTER_TOPIC="matches"
$env:REALTIME_CLUSTER_MUTATION_URL="https://api-a.example.com/api/v1/matches/<id>"
$env:REALTIME_CLUSTER_MUTATION_METHOD="PATCH"
$env:REALTIME_CLUSTER_MUTATION_BODY='{"status":"verified"}'
node scripts/realtime-cluster-smoke.js
```

The smoke test uses native `fetch` and SSE-compatible streaming, checks both
workers, reconnect readiness, and denial of the concrete foreign topic
`user:__realtime_other_user__` (plus the broad `user` topic). It deliberately
omits synthetic `Origin` and `Referer` headers: this is a server-to-server
staging check, not a browser-origin simulation, and it does not treat an API
worker origin as an allowed frontend CORS origin. Run it only against a
staging security posture or approved mutation endpoint that accepts the
cookie-bearing server-to-server request without those browser headers. It
exits non-zero with diagnostics on any failure. Do not place a real cookie in
shell history or documentation.

Legacy media import/migration commands remain available for controlled recovery work. Back up PostgreSQL and uploads before using them.

## API and Health

- API root: `http://localhost:5001/api`
- Liveness: `http://localhost:5001/api/health/live`
- Readiness: `http://localhost:5001/api/health` or `http://localhost:5001/api/health/ready`
- OpenAPI JSON: `http://localhost:5001/api/openapi.json`

`/api/health/live` is liveness only. `/api/health` and `/api/health/ready`
are readiness aliases that check database and storage dependencies and may
return `503` during maintenance or dependency failure.

Route families cover authentication, sessions, tournaments, registrations, teams, event series, recruitment, contact messages, media, products, payments, tickets, brackets, matches, and admin operations. See [API Documentation](../docs/api-documentation.md) for contracts.

## Data and Storage

- Prisma uses one process-wide client with bounded pool defaults.
- Public uploads live below `UPLOAD_ROOT`; private payment evidence lives below `PRIVATE_UPLOAD_ROOT`.
- The database and both durable roots form one backup set.
- Public response caching defaults to bounded in-memory storage; multi-process deployments require the shared Upstash cache.
- Readiness verifies PostgreSQL and write access to both configured upload roots.

See [Database and Storage](../docs/database-and-storage.md) before changing schema, uploads, retention, or media behavior. Start with the [Developer Guide](../docs/developer-guide.md), [Environment Reference](../docs/environment-reference.md), or [VALORANT Local Development](../docs/valorant-local-development.md) for contributor-specific workflows.

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

Run `npm run test:integration` only with an isolated test database; its owning
script sets the internal `RUN_DATABASE_INTEGRATION_TESTS` flag automatically.
Run k6 profiles only against local or dedicated test infrastructure, never
production.
