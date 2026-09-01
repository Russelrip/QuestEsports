# Setup And Deployment Guide

This guide covers local setup, environment configuration, and a practical production deployment approach for the current codebase. Use the [Developer Guide](developer-guide.md) for contributor workflows, the [Environment Reference](environment-reference.md) for the variable inventory, and [VALORANT Local Development](valorant-local-development.md) for the dedicated-test integration workflow.

## Current production status

The database cutover completed on **2026-08-31**. Quest and VALORANT currently
use PostgreSQL **17.11** in VPS container `quest-postgres` at
`127.0.0.1:5433`. Supabase is intact but stale and is not a rollback target.
No rehearsal was performed, and that gate cannot be satisfied retroactively.

The current database container is an ad-hoc host deployment, not the target
Compose topology. Compose adoption remains blocked by missing PostgreSQL TLS
material, which also blocks the real backup pipeline. The scheduled backup has
failed since **2026-08-30 04:20**; the interim
`quest-pg17-interim-backup.{service,timer}` unit covers the gap. TLS and backup
provisioning, host bootstrap, and remediation of unrestricted deploy-root
access and two GitHub Actions keys remain operator gates. Nothing here claims
live verification or owner approval.

The production Compose target requires `sslmode=verify-full` with the mounted
private CA (and equivalent full certificate/hostname verification for the
VALORANT asyncpg client). External PostgreSQL/VALORANT Cosign signer settings
are not required; only Quest-owned images use the Quest Cosign identity.

## Requirements

- Node.js 24.x (backend and frontend declare `24.x`; mobile-admin follows project Node 24 guidance without a package `engines` field)
- npm 10+
- PostgreSQL 15+ recommended
- Resend API credentials (or SMTP credentials) for real email delivery

## Local Setup

### 1. Install dependencies

Backend:

```bash
cd backend
npm ci
```

Frontend:

```bash
cd frontend
npm ci
```

### 2. Configure environment variables

Backend `backend/.env`:

```env
PORT=5001
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
DIRECT_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
LOG_LEVEL=info
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
AUTH_ENCRYPTION_KEY=
TRUST_PROXY=false
REQUIRE_API_ORIGIN=false
JOB_WORKER_ENABLED=true
COMMERCE_MAINTENANCE_ENABLED=true
SITE_MAINTENANCE_MODE=false
SITE_MAINTENANCE_MESSAGE=We’re carrying out scheduled maintenance. Please try again shortly.
SITE_MAINTENANCE_RETRY_AFTER_SECONDS=900
JOB_WORKER_POLL_MS=5000
JOB_WORKER_MAX_ATTEMPTS=5
API_PROCESS_COUNT=1
CACHE_DRIVER=memory
# Required for shared/clustered Upstash realtime. Use one exact,
# deployment-unique channel on every worker in this environment, and a
# different channel for every other environment sharing the Upstash database.
# A single-process CACHE_DRIVER=memory deployment uses the local in-memory
# default (`quest-realtime-local`) and does not need this variable.
REALTIME_CHANNEL=
REALTIME_SSE_ENABLED=false
LOG_DRAIN_URL=
LOG_DRAIN_TOKEN=
MONITORING_WEBHOOK_URL=
MONITORING_WEBHOOK_TOKEN=
DISCORD_ALERT_WEBHOOK_URL=
MAIL_PROVIDER=resend
RESEND_API_KEY=
MAIL_FROM=
MAIL_DELIVERY_REQUIRED=
# Only needed when MAIL_PROVIDER=smtp:
# SMTP_HOST=email-smtp.ap-northeast-1.amazonaws.com
# SMTP_PORT=587
# SMTP_USER=your_ses_smtp_username
# SMTP_PASS=your_ses_smtp_password
APP_URL=http://localhost:3000
API_PUBLIC_URL=http://localhost:5001
MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://oauth
MOBILE_ADMIN_ANDROID_CERT_SHA256=
UPLOAD_ROOT=
PRIVATE_UPLOAD_ROOT=
BANK_TRANSFER_PROOF_RETENTION_DAYS=365
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:5001/api/auth/google/callback
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_CALLBACK_URL=http://localhost:5001/api/auth/discord/callback
PAYHERE_MODE=sandbox
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=
PAYHERE_NOTIFY_URL=
SHOP_DELIVERY_FEE_LKR=500
SHOP_ORDER_RESERVATION_MINUTES=30
```

For purely local development, provider credentials can be left blank and `MAIL_DELIVERY_REQUIRED` can remain blank. The backend will still run, but verification, password reset, invite, email-change, and security-alert emails will be skipped instead of sent. Production defaults this flag to true and rejects false or incomplete mail configuration. Production also rejects `JOB_WORKER_ENABLED=false` while queued password-authentication email is required.
If OAuth is not being used locally, leave the OAuth client ID and secret values blank.

Frontend `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SITE_MAINTENANCE_MODE=false
SITE_MAINTENANCE_MESSAGE=We’re carrying out scheduled maintenance. Please try again shortly.
SITE_MAINTENANCE_RETRY_AFTER_SECONDS=900
```

The maintenance variables are server-only. Keep them identical in the frontend and backend environments, and leave the switch false during normal operation.

### 3. Apply committed Prisma migrations

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate:deploy
```

Use `npm run prisma:migrate:deploy` for committed migrations in shared
development, staging, CI, and production.

### Intentional local schema/migration creation

Use `npm run prisma:migrate` only when the local schema change is intentionally
creating a new development migration:

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
```

Use a direct PostgreSQL URL for `DIRECT_URL` when the deployment host supports Supabase's IPv6 direct endpoint. On IPv4-only hosts, use Supavisor session mode on port `5432` for `DIRECT_URL`. Transaction mode on port `6543` is not suitable for Prisma migrations.

### 4. Start both apps

Backend (`npm run dev` uses the loopback Postgres from
`docker-compose.local.yml`; `npm run dev:remote` is the opt-in that reaches the
hosted database, which is metered):

```bash
docker compose -f docker-compose.local.yml up -d postgres
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

### 5. Verify startup

- Frontend loads on `http://localhost:3000`
- Liveness is available at `http://localhost:5001/api/health/live`
- Readiness is available at `http://localhost:5001/api/health` and its alias `http://localhost:5001/api/health/ready`
- Backend OpenAPI JSON is available at `http://localhost:5001/api/openapi.json`
- Backend and frontend are started separately; there is no root workspace dev command.

The liveness endpoint checks that the process can answer. Both readiness
aliases check the database and storage and, when clustered realtime is enabled,
the acknowledged shared realtime transport. They may return `503` during
maintenance or dependency failure.

## First Admin User

There is no seed script for bootstrapping the first admin account.

Recommended options:

1. Sign up through the app or create a user in the database via Prisma Studio.
2. Update that user's `role` to `admin`.

Prisma Studio:

```bash
cd backend
npm run prisma:studio
```

After the first admin exists, additional users can be managed through the admin UI and admin API.

## Email Configuration

The codebase supports local development without mail delivery. Production requires a configured provider while password authentication is enabled; verification, reset, invite, and security workflows must not silently launch without delivery.

See [Email System](./email-system.md) for the complete email inventory, trigger rules, action links, token lifetimes, queue behavior, and operational checks.

For production:

- set `MAIL_PROVIDER=resend`
- set `RESEND_API_KEY`
- set `MAIL_FROM`
- set `MAIL_DELIVERY_REQUIRED=true`
- set `APP_URL` to the public frontend origin

Verify the sending domain in Resend before sending to application users. Resend's test domain is restricted to the account owner's address. Run `npm run mail:verify` after deploying the values, then trigger a real verification or password-reset email.

To switch back to Amazon SES later, set `MAIL_PROVIDER=smtp` and replace the Resend key with the SES `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` values below. No code change is required.

For Amazon SES in Tokyo (`ap-northeast-1`):

1. Create and verify a SES domain identity for `questesports.lk`.
2. Publish the SES Easy DKIM CNAME records in DNS and wait for SES to show the identity as verified.
3. Create SES SMTP credentials in `ap-northeast-1`; they are region-specific and separate from normal AWS access keys.
4. Request production access for `ap-northeast-1` before launch. While still in the SES sandbox, you can only send to verified recipients.
5. Optional: configure a custom SES MAIL FROM domain such as `bounce.questesports.lk` and publish the MX/SPF records SES provides. Keep this separate from the visible `MAIL_FROM` sender address domain.
6. Use this backend SMTP configuration:

```env
MAIL_PROVIDER=smtp
SMTP_HOST=email-smtp.ap-northeast-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your_ses_smtp_username
SMTP_PASS=your_ses_smtp_password
MAIL_FROM="Quest Esports <no-reply@mail.questesports.lk>"
MAIL_DELIVERY_REQUIRED=true
APP_URL=https://questesports.lk
JOB_WORKER_ENABLED=true
```

After deploying the values, verify provider connection/auth without sending a message:

```bash
cd backend
npm run mail:verify
```

Security-related variables:

- `AUTH_ENCRYPTION_KEY` for encrypting sensitive NIC/token data and signing OAuth state; production requires exactly 64 hexadecimal characters. If an older deployment used an arbitrary string, follow the compatibility conversion in the [Production Operations Runbook](./production-runbook.md#preserving-existing-encrypted-data-when-normalizing-the-auth-key) instead of rotating it blindly.
- `JOB_WORKER_ENABLED`, `JOB_WORKER_POLL_MS`, and `JOB_WORKER_MAX_ATTEMPTS` for persistent background job processing
- `SITE_MAINTENANCE_MODE`, `SITE_MAINTENANCE_MESSAGE`, and `SITE_MAINTENANCE_RETRY_AFTER_SECONDS` for coordinated visitor maintenance; these are separate from commerce cleanup
- `LOG_LEVEL` to control backend log verbosity
- `LOG_DRAIN_URL` and `LOG_DRAIN_TOKEN` for centralized structured log shipping
- `MONITORING_WEBHOOK_URL` and `MONITORING_WEBHOOK_TOKEN` for remote exception capture
- `DISCORD_ALERT_WEBHOOK_URL` for direct redacted exception alerts to a private Discord channel
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` for Google login
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL` for Discord login
- Account linking has no separate variable. Its redirect URI is derived from the
  provider callback URL, so both must be registered with the provider. See
  [OAuth Provider Configuration](#oauth-provider-configuration).

## OAuth Provider Configuration

Each provider needs two redirect URIs registered, not one. Signing in uses the
callback URL from the environment variable. Linking or reconnecting a provider
from the profile page uses a separate link callback, derived from the same
origin with the path replaced by `/api/v1/auth/oauth/<provider>/link/callback`.
Registering only the login callback lets sign-in work while linking fails with
an invalid redirect URI error from the provider.

Local redirect URIs:

- Google login: `http://localhost:5001/api/auth/google/callback`
- Google link: `http://localhost:5001/api/v1/auth/oauth/google/link/callback`
- Discord login: `http://localhost:5001/api/auth/discord/callback`
- Discord link: `http://localhost:5001/api/v1/auth/oauth/discord/link/callback`
- Mobile admin: `questadmin://oauth` (custom scheme)

Production redirect URIs:

- Google login: `https://api.questesports.lk/api/auth/google/callback`
- Google link: `https://api.questesports.lk/api/v1/auth/oauth/google/link/callback`
- Discord login: `https://api.questesports.lk/api/auth/discord/callback`
- Discord link: `https://api.questesports.lk/api/v1/auth/oauth/discord/link/callback`
- Mobile admin: `https://api.questesports.lk/mobile-admin-oauth` (verified HTTPS Android App Link)

Notes:

- The provider dashboard redirects must match both the login and link callback URLs exactly.
- Register every environment you sign in from. A dashboard holding only the
  production callbacks makes local OAuth fail even though the code is correct.
- `APP_URL` must point to the frontend origin, not the API origin, because the backend redirects the browser back to the frontend after OAuth completes.
- The mobile custom scheme is for local development only. Production mobile OAuth must use the verified HTTPS App Link and matching release certificate fingerprint.
- Do not use placeholder strings such as `your_google_client_id` or `your_discord_client_id`; leave values blank until real credentials are available.

### Android local OAuth transport

Android `localhost` is the emulator or physical device itself, not the
development computer. For an Android emulator using a backend on the host,
forward the local ports where supported:

```bash
adb reverse tcp:5001 tcp:5001
adb reverse tcp:3000 tcp:3000
```

Use `EXPO_PUBLIC_API_URL=http://localhost:5001` with that forwarding and keep
the local final redirect `EXPO_PUBLIC_OAUTH_REDIRECT_URL=questadmin://oauth`.
Set the backend `API_PUBLIC_URL` to the same local API origin,
`MOBILE_ADMIN_OAUTH_REDIRECT_URL=questadmin://oauth`, and register the exact
Google/Discord callback URLs from the local list above with each provider.
For a physical device, use a reachable HTTPS development API and site origin
instead of `localhost`, set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SITE_URL` to
those origins, set the backend `API_PUBLIC_URL`, `APP_URL`, and `CORS_ORIGIN`
to the matching origins, and register the resulting HTTPS backend callback
URLs with the providers. The app's final redirect remains `questadmin://oauth`;
do not substitute the production App Link in local configuration.

## Upload Storage

Locally, the backend writes public files below `backend/uploads/`:

- `backend/uploads/team-logos`
- `backend/uploads/tournament-banners`
- `backend/uploads/poster-images`
- `backend/uploads/tournament-schedules`
- `backend/uploads/avatars`

Bank-transfer receipts are stored separately under the local private fallback and are never exposed through `/api/uploads`. Payment-proof image handling supports PNG, JPEG, and WebP screenshots; there is no PDF payment-proof configuration.

Production requirement:

- set `UPLOAD_ROOT=/srv/quest-esports/uploads`
- set `PRIVATE_UPLOAD_ROOT=/srv/quest-esports/private`
- make both paths writable by the `deploy` service user
- keep private storage mode `700` and exclude it from Nginx/static routes
- back up PostgreSQL and both storage roots as one consistency set

The production PostgreSQL URLs must use `sslmode=verify-full` and the
provisioned private CA. The current loopback `127.0.0.1:5433` ad-hoc runtime
does not yet have that TLS material, so it is not the Compose-adoption state.

Do not deploy this backend on fully ephemeral disk unless you replace the upload strategy with object storage.

## Build Commands

Backend:

```bash
cd backend
npm test
npm start
```

Frontend build and start:

```bash
cd frontend
npm run build
npm run start
```

## Test And Verification Workflow

Before shipping backend changes, run:

```bash
cd backend
npm test
npm run prisma:generate
```

The backend suite uses Node's built-in test runner and covers rate limiting, background jobs, observability, teams, configurable registration, payments, shop behavior, recruitment, admin workflows, and session/auth lifecycle logic. CI uses `npm run test:coverage` and `npm run lint` in addition to migration verification.

For frontend changes, run:

```bash
cd frontend
npm run lint
npm test
npm run test:e2e:local
```

Playwright critical journeys run in CI. Manual production checks remain necessary for provider callbacks, email delivery, private uploads, DNS, cookies, and live payment behavior.

## Local Backend Testing Workflow

This workflow verifies backend changes against a dedicated test database without touching shared environments.

Requirements:

- Node.js 24 LTS and npm 10+
- a dedicated Supabase PostgreSQL project used only for local testing — never a production or shared staging database
- credentials for that test project only; never production credentials

### 1. Create the local environment file

```bash
cp backend/.env.example backend/.env
```

`backend/.env` is git-ignored and stays on your machine. Set `DATABASE_URL` and `DIRECT_URL` to the dedicated test project. Supabase requires TLS, so keep `sslmode=require` (or `verify-ca`/`verify-full`) on both URLs.

### 2. Prepare the test database

```bash
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run prisma:security:verify
```

### 3. Run the backend checks

```bash
npm run lint
npm test
npm run test:integration
```

`npm run test:integration` runs the real-database integration suite against the test project configured in `backend/.env`.

Do not point this workflow at production and do not run destructive reset commands (`prisma migrate reset`, `prisma db drop`, force-reset variants) against any shared or remote database. The frontend can run separately against `http://localhost:5001`; the mobile admin is out of scope for this workflow.

## VALORANT Local Development Topology

### Optional: run the local stack in containers

`docker-compose.local.yml` runs Quest Express, the sibling VALORANT service, and
a throwaway PostgreSQL together, so local work needs no shared remote Supabase
test project at all:

```bash
cp ops/docker/quest.local.env.example ops/docker/quest.local.env
docker compose -f docker-compose.local.yml up                      # Quest + Postgres
docker compose -f docker-compose.local.yml --profile valorant up    # + the sibling service
```

The frontend deliberately stays outside the stack — `cd frontend && npm run dev`
gives better fast refresh than a bind-mounted container.

**This is a development convenience, not a production deployment path.** The
production target is the owner-gated PostgreSQL 17 Compose topology under
`ops/docker/`, with the frontend/backend release path described in the
[Production Operations Runbook](./production-runbook.md). The existing PM2 path
is retained only for explicitly gated historical recovery; native PostgreSQL 16
and Vercel remain staging material until their retirement gates pass. Supabase is
stale non-rollback context, not current rollback material. Nothing in this local
stack authorizes a VPS mutation.

Three properties are asserted by `backend/tests/local-docker-compose.test.js`
rather than left to convention: every published port binds to `127.0.0.1`; the
containers never load `backend/.env` (which points at a remote Supabase project)
and set `DATABASE_URL` in `environment:` so the local database wins regardless;
and no credential is baked into an image layer. `ops/docker/quest.local.env` is
git-ignored explicitly, because the repository's `.env*` rule does not match
that name.

The VALORANT integration runs two services against **one dedicated Supabase test
project** — never production or shared staging:

```text
Next.js frontend ......... http://localhost:3000
Quest Express backend .... http://localhost:5001   (NEXT_PUBLIC_API_URL=http://localhost:5001)
valorant-platform-backend. http://localhost:8000   (VALORANT_INTERNAL_BASE_URL=http://localhost:8000)
Shared Supabase test project  (schema-specific credentials)
```

- Quest `DATABASE_URL`/`DIRECT_URL` connect to the `public` schema (Prisma-owned).
- FastAPI `DATABASE_URL` connects to the `valorant` schema (plain-SQL ledger).
- `valorant-platform-backend` is a sibling repo, never deployed from this repo.

Prepare the shared test project once:

1. In the Supabase SQL editor, create the VAL runtime role:
   ```sql
   CREATE ROLE val_runtime LOGIN PASSWORD '<generate a random password>';
   ```
   (The runner creates the `valorant` schema and grants/RLS policies to this role
   automatically — see the FastAPI repo's `docs/runtime-access-posture.md`.)
2. Quest runs as the project owner (or its own runtime role) on `public` with
   RLS verified by `npm run prisma:security:verify`.
3. Apply FastAPI migrations as the migrator:
   ```bash
   cd ../valorant-platform-backend
   uv sync
   uv run python -m scripts.apply_migrations --runtime-role val_runtime
   ```
4. Apply Quest Prisma migrations as usual (`npm run prisma:migrate:deploy`).

Production topology: only Quest Express is reachable by the frontend. FastAPI
lives on a private network with an IP allowlist and binds to a private
interface; the browser never talks to FastAPI. `VALORANT_INTERNAL_BASE_URL` is
asserted to be an HTTPS origin by `backend/src/config/env.js` in production.

The external FastAPI checkout, credentials, runtime role, and production
network placement are owner-maintained facts; verify them before operating a
production integration. See [VALORANT Local Development](valorant-local-development.md)
for the reproducible local topology.

### VALORANT local commands

Run the two services in separate terminals against the shared test project:

```bash
# Terminal 1 — FastAPI (repo: ../valorant-platform-backend)
cd ../valorant-platform-backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — Quest backend
cd backend
npm run dev

# Terminal 3 — Quest frontend
cd frontend
npm run dev
```

Smoke and tests:

```bash
cd backend
npm run test:valorant:smoke          # health + auth checks against running services
npm run test:valorant:e2e            # two-service E2E journey (see tests/valorant-e2e/README.md)
```

Expected smoke output: `VALORANT local smoke: PASS`.

## Recommended Production Topology

For this repository, the target production topology uses Vercel for the frontend
and the Ubuntu VPS for the immutable `quest-prod` and sibling `valorant-prod`
Compose projects. The current PostgreSQL service remains an ad-hoc host
container until the documented owner gates are complete.
PostgreSQL 17 is private to the Compose networks and uses the stable
`quest-postgres` alias. Nginx exposes application traffic only. The temporary
staging overlay may publish PostgreSQL only at `127.0.0.1:55432`; the final base
Compose file has no PostgreSQL host publication and no public database port is
allowed. See the runbook for the owner gates and exact cutover order.

### Generic alternatives for non-production environments

#### Option A: Two-process deployment behind a reverse proxy

- Next.js frontend on one process/container
- Express API on one process/container
- PostgreSQL as a managed database or dedicated host
- Nginx or a platform load balancer in front
- persistent volume mounted to backend uploads

#### Option B: Frontend on Vercel, backend on a VM/container platform

- deploy `frontend/` to Vercel
- deploy `backend/` to Render, Railway, Fly.io, a VPS, or Kubernetes
- configure CORS and cookie origins carefully
- keep uploads on a persistent disk or move to object storage

## Production Environment Checklist

### Backend

```env
NODE_ENV=production
API_PROCESS_COUNT=1
PORT=5001
CORS_ORIGIN=https://questesports.lk
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=verify-full&sslrootcert=/run/secrets/quest-private-ca.crt
DIRECT_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=verify-full&sslrootcert=/run/secrets/quest-private-ca.crt
LOG_LEVEL=info
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
AUTH_ENCRYPTION_KEY=replace_with_exactly_64_hexadecimal_characters
TRUST_PROXY=1
REQUIRE_API_ORIGIN=true
JOB_WORKER_ENABLED=true
COMMERCE_MAINTENANCE_ENABLED=true
SITE_MAINTENANCE_MODE=false
SITE_MAINTENANCE_MESSAGE=We’re carrying out scheduled maintenance. Please try again shortly.
SITE_MAINTENANCE_RETRY_AFTER_SECONDS=900
JOB_WORKER_POLL_MS=5000
JOB_WORKER_MAX_ATTEMPTS=5
LOG_DRAIN_URL=https://logs.example.com/ingest
LOG_DRAIN_TOKEN=replace_with_log_ingest_token
MONITORING_WEBHOOK_URL=https://monitoring.example.com/events
MONITORING_WEBHOOK_TOKEN=replace_with_monitoring_token
MAIL_PROVIDER=resend
RESEND_API_KEY=re_your_resend_api_key
MAIL_FROM="Quest Esports <no-reply@mail.questesports.lk>"
MAIL_DELIVERY_REQUIRED=true
APP_URL=https://questesports.lk
API_PUBLIC_URL=https://api.questesports.lk
MOBILE_ADMIN_OAUTH_REDIRECT_URL=https://api.questesports.lk/mobile-admin-oauth
MOBILE_ADMIN_ANDROID_CERT_SHA256=COLON_SEPARATED_RELEASE_CERTIFICATE_SHA256
UPLOAD_ROOT=/srv/quest-esports/uploads
PRIVATE_UPLOAD_ROOT=/srv/quest-esports/private
BANK_TRANSFER_PROOF_RETENTION_DAYS=365
PAYHERE_MODE=sandbox
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=
PAYHERE_NOTIFY_URL=
SHOP_DELIVERY_FEE_LKR=500
SHOP_ORDER_RESERVATION_MINUTES=30
GOOGLE_CLIENT_ID=your_real_google_client_id
GOOGLE_CLIENT_SECRET=your_real_google_client_secret
GOOGLE_CALLBACK_URL=https://api.questesports.lk/api/auth/google/callback
DISCORD_CLIENT_ID=your_real_discord_client_id
DISCORD_CLIENT_SECRET=your_real_discord_client_secret
DISCORD_CALLBACK_URL=https://api.questesports.lk/api/auth/discord/callback
```

Notes:

- `DATABASE_URL`, `DIRECT_URL`, and `SESSION_COOKIE_NAME` are required.
- The cutover completed on 2026-08-31; Supabase is stale recovery material and is not a rollback target. The current PostgreSQL 17 service uses `quest-postgres` at `127.0.0.1:5433`; the target Compose alias and host-run staging tools use only loopback `127.0.0.1:55432`. Verify the live host, target, and URL authority with the owner; checked-in documentation cannot prove current infrastructure state.
- `APP_URL` must point to the frontend origin because email links are generated from it.
- Mobile administrator OAuth requires the verified API-origin App Link and the colon-separated SHA-256 fingerprint of the release signing certificate.
- `AUTH_ENCRYPTION_KEY` must be exactly 64 hexadecimal characters; do not rotate an existing key without a data migration plan.
- Production requires `MAIL_DELIVERY_REQUIRED=true` and complete settings for the selected provider.
- PayHere merchant values must be all configured or all blank. When blank, free and bank-transfer tournament registration remain available, but PayHere registration and merchandise checkout are disabled.
- Payment evidence accepts PNG, JPEG, and WebP screenshots; image receipts are decoded and re-encoded before storage.
- `CORS_ORIGIN` can be a comma-separated allowlist.
- `REQUIRE_API_ORIGIN=true` blocks API requests without an allowed `Origin` or `Referer`; use `CORS_ORIGIN=https://questesports.lk` for the public site domain.
- The live production database is VPS PostgreSQL 17.11 in `quest-postgres`; `npm run prisma:security:verify` confirms all public tables use RLS and unneeded external Data API roles have no table privileges. Any Supabase Data API setting belongs to isolated test or historical context, not production rollback.
- Install and verify the encrypted off-site backup timer before approving any production migration. Follow [Backup and Disaster Recovery](./backup-and-disaster-recovery.md) and the [Production Operations Runbook](./production-runbook.md#automated-encrypted-off-site-backups).
- The full archive excludes the backend `.env`, OAuth/rclone material, Supabase-managed settings, and infrastructure credentials. Maintain and test a separate encrypted, access-controlled recovery process for those values.

### Frontend

```env
NEXT_PUBLIC_API_URL=https://api.questesports.lk
NEXT_PUBLIC_SITE_URL=https://questesports.lk
SITE_MAINTENANCE_MODE=false
SITE_MAINTENANCE_MESSAGE=We’re carrying out scheduled maintenance. Please try again shortly.
SITE_MAINTENANCE_RETRY_AFTER_SECONDS=900
```

The two public URL values must be exact HTTPS origins without credentials, paths, queries, fragments, or trailing slashes. The frontend intentionally renders pages per request because Next.js script tags must receive the per-request CSP nonce generated by `proxy.ts`. Treat this as a security/performance tradeoff: keep immutable asset caching enabled and monitor server-render latency before changing the nonce architecture.

Vercel captures server environment values at deployment time. After changing `SITE_MAINTENANCE_MODE`, redeploy the approved commit and follow the frontend-first enable/backend-first disable order in the [Production Operations Runbook](./production-runbook.md#site-maintenance-mode).

## Reverse Proxy Notes

If the backend is behind Nginx or another proxy:

- forward the original host and protocol headers
- set `TRUST_PROXY` so Express respects the proxy
- terminate HTTPS before traffic reaches the browser

This matters because:

- session cookies are marked `Secure` in production
- CSRF origin checking depends on correct origins
- generated URLs and canonical URLs must match the public origin

## Observability

The backend now emits:

- structured JSON logs to stdout
- `X-Request-Id` response headers for request tracing
- best-effort remote log shipping when `LOG_DRAIN_URL` is configured
- best-effort remote exception shipping when `MONITORING_WEBHOOK_URL` is configured

Recommended production setup:

- send stdout to your platform log collector even if you also configure `LOG_DRAIN_URL`
- wire `MONITORING_WEBHOOK_URL` to your incident or error-ingestion pipeline
- include `requestId` when debugging user-reported failures

## Background Jobs

The backend now uses a persistent `background_jobs` table for email delivery.

Current behavior:

- auth, invite, and security emails are enqueued instead of sent inline during the request
- the API process starts a polling worker automatically when `JOB_WORKER_ENABLED=true`; the worker handles both transactional email and retryable upload cleanup jobs
- failed jobs are retried with backoff until `JOB_WORKER_MAX_ATTEMPTS` is reached
- production startup requires complete mail-provider configuration by default; a delivery failure keeps the job retryable and is never marked succeeded

Production notes:

- keep `JOB_WORKER_ENABLED=true` on at least one backend instance
- if you scale horizontally, more than one instance can safely poll the queue
- monitor the `background_jobs` table for jobs stuck in `failed` status

## Deployment Steps

### Backend

1. Provision PostgreSQL.
2. Provision persistent public and private storage outside the Git checkout (`UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT`).
3. Set environment variables.
4. Install dependencies with `npm ci`.
5. Run `npm run prisma:generate`.
6. Run `npm run prisma:migrate:deploy`.
7. Run the service with `npm start`.

### Frontend

1. Set `NEXT_PUBLIC_API_URL`.
2. Set `NEXT_PUBLIC_SITE_URL`.
3. Install dependencies with `npm ci`.
4. Run `npm run lint`, `npm test`, and `npm run build`.
5. Start with `npm run start`.

These generic steps are not the PostgreSQL 17 production cutover. For
production, use the immutable Compose release and the owner-gated migration
procedure below instead of pointing the application at an unmanaged database.

## VPS PostgreSQL 17 migration and deployment (historical procedure; cutover completed)

The database cutover described by this procedure completed on 2026-08-31.
This section is retained as the historical operator procedure for the remaining
Compose adoption work; it is not evidence that these steps were performed.
Supabase is intact but stale and is not a rollback target. Existing native
PostgreSQL 16.15 remains on `127.0.0.1:5432` during staging and initial
validation. The Compose target is PostgreSQL 17 Bookworm with durable data at
`/srv/quest-esports/postgres/17/data`.

1. Record owner-supplied RPO/RTO, maintenance window, bootstrap/release actors,
   narrow sudo rule, backup destination, host capacity, TLS evidence, and the
   current PG16 observation. Blank or inferred values are a stop condition.
2. As root, create the documented paths, install the root-owned wrappers and
   TLS material, and create `quest-shared` without stopping PM2, VALORANT, or
   PostgreSQL 16. The PostgreSQL certificate must contain
   `DNS:quest-postgres` and `IP:127.0.0.1` and clients must use
   `sslmode=verify-full`.
3. Render and start only the staged PostgreSQL service:

   ```bash
   COMPOSE_ENV=/etc/quest-esports/quest.production.env
   docker compose --env-file "$COMPOSE_ENV" \
     -f ops/docker/compose.production.yml \
     -f ops/docker/compose.postgres-staging.yml config
   docker compose --env-file "$COMPOSE_ENV" \
     -f ops/docker/compose.production.yml \
     -f ops/docker/compose.postgres-staging.yml up -d postgres
   ```

   Verify the owner-approved exact PostgreSQL 17 digest, target sentinel,
   healthcheck, durable mount, TLS, and loopback-only `127.0.0.1:55432:5432`.
   Do not start application writers. Remove the staging overlay from
   application and release invocations; keep or reapply it for the host backup
   and restore path under the documented loopback lifecycle in the [Production Operations
   Runbook](./production-runbook.md#stage-postgresql-17-beside-postgresql-16).
   No private-network backup utility is implemented, and Supabase is never a
   replacement target for host backup or restore connectivity.
4. The signed disposable two-schema restore rehearsal was **not performed**.
   It remains a required gate for future recovery/Compose adoption work, but
   cannot be satisfied retroactively. Use the exact evidence and owner/live
   gate described in [Backup and Disaster Recovery](./backup-and-disaster-recovery.md#phase-8-rehearsal-boundary).
5. The following cutover sequence is retained for historical reference only;
   the database cutover already completed. For remaining Compose adoption, use
   the root-owned release path after all current host gates pass.
   Freeze both writers, stop old writers, create and remotely verify the final
   archive, restore with `--no-owner --no-acl --single-transaction
   --exit-on-error`, apply security checks and both migrations, then start both
   candidates frozen. Admit Quest and VALORANT only after independent readiness
   and health checks. The operator records the commit point before masking old
   units.
6. Observe health/error rates, database connections/locks/latency/disk,
   backups/freshness, uploads/permissions, and Supabase connection absence.
   Retire PostgreSQL 16 or delete/rotate Supabase only after the owner-approved
   observation period and final verified backup. Use the exact PostgreSQL 16
   cluster unit; never use broad `postgresql.service` controls while majors
   coexist.

## Legacy PM2 VPS recovery flow (pre-cutover only)

This repository can be cloned in full on a VPS even when only the backend is
served there. This is the pre-cutover/legacy recovery path, not the PostgreSQL
17 Compose cutover or a post-first-write rollback. After writer admission,
follow the [post-first-write rollback boundary](./backup-and-disaster-recovery.md#post-first-write-rollback-boundary).

For a private repository, configure a read-only GitHub deploy key on the VPS and use an SSH origin such as `git@github.com:Russelrip/QuestEsports.git`. The SSH key used by GitHub Actions to log into the VPS is separate from the key the VPS uses to pull from GitHub. See [CI/CD Pipeline](./ci-cd.md#private-repository-access-from-the-vps).

GitHub Actions is the preferred deployment path. A manual recovery deploy must run as `deploy`, preserve `.env`, use the exact intended commit, and follow the same checks:

```bash
sudo -u deploy -H bash -lc '
cd /var/www/QuestEsports
git fetch origin
git checkout --detach <approved-commit-sha>
cd backend
npm ci
npm run prisma:generate
npm run lint
npm run prisma:migrate:deploy
pm2 restart quest-backend --update-env
pm2 save
'
curl --fail http://127.0.0.1:5001/api/health/live
```

If your frontend is hosted somewhere else, such as Vercel, you do not need to build or restart `frontend/` on this VPS.

For initial provisioning, Actions secrets, host-key pinning, PM2 systemd setup, rollback behavior, troubleshooting, updates, and reboot validation, use the [Production Operations Runbook](./production-runbook.md).

## Post-Deployment Validation

Check all of the following:

- `GET /api/health/live` returns `200` for liveness
- `GET /api/health` or `GET /api/health/ready` returns `200` for readiness when database and storage are available; `503` is expected during maintenance or dependency failure
- signup works
- login sets a session cookie
- active sessions appear under `/api/sessions`
- `/api/me` returns the authenticated user
- verification emails contain the correct frontend URL
- email-change confirmation emails contain the correct frontend URL
- password reset emails contain the correct frontend URL
- team invite emails contain the correct frontend URL
- Google and Discord login redirect back to the expected frontend route when enabled
- tournament banners render
- tournament listing cards show prize pool, registration deadline, and tournament start
- tournament detail pages render registered teams only when approved teams exist
- tournament detail pages render native brackets only after an admin publishes bracket data
- `https://questesports.lk/sitemap.xml` returns `200`, `application/xml`, and valid XML containing only canonical public/indexable URLs
- `https://questesports.lk/robots.txt` returns `200` and advertises `https://questesports.lk/sitemap.xml`
- deleting a tournament registration in admin lets the same captain register for that tournament again
- admin registration Excel downloads include registration and roster-member sheets for the active filters

After the crawler checks pass, review the existing sitemap submission and indexing reports using [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md).
- recruitment submission works for verified users
- admin recruitment Excel downloads include application and team-member sheets for the active filters
- completed showcase sections render correctly
- poster images render
- approved public team logos render on tournament detail pages
- public upload routes for tournament banners, poster images, and team logos render expected files
- public cannot access admin-only media management endpoints
- non-admin users cannot access admin registration, recruitment, export, or delete endpoints

## Media Migration Utility

If you have legacy image assets stored in the database:

```bash
cd backend
npm run media:migrate-image-assets
```

If you need the legacy poster import script:

```bash
cd backend
npm run media:import-legacy-posters
```

The command imports only the legacy images packaged under
`frontend/public/images`. It validates all sources before making changes, repairs
missing filesystem copies for matching image records, reuses the oldest matching
asset instead of creating a duplicate, reconciles an imported poster that points
at a duplicate asset, skips healthy posters, and rolls back database changes and
newly written files if the import fails. Git and repository history are not
runtime dependencies.

Run these in a controlled environment and back up the database plus uploads first.

## Follow-up Work

Use [Pre-deployment Checklist](./pre-deployment-checklist.md) for required release evidence and [Future Technical Improvements](./future-technical-improvements.md) for unscheduled architecture candidates. Keep dated audit results outside this setup guide so its instructions remain current.
