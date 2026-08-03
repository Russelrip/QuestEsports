# Setup And Deployment Guide

This guide covers local setup, environment configuration, and a practical production deployment approach for the current codebase.

## Requirements

- Node.js 24 LTS
- npm 10+
- PostgreSQL 15+ recommended
- Resend API credentials (or SMTP credentials) for real email delivery

## Local Setup

### 1. Install dependencies

Backend:

```bash
cd backend
npm install
```

Frontend:

```bash
cd frontend
npm install
```

### 2. Configure environment variables

Backend `backend/.env`:

```env
PORT=5001
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DIRECT_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
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
UPLOAD_ROOT=
PRIVATE_UPLOAD_ROOT=
PAYMENT_PROOF_PDF_ENABLED=false
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

For purely local development, provider credentials can be left blank and `MAIL_DELIVERY_REQUIRED` can remain blank. The backend will still run, but verification, password reset, invite, email-change, and security-alert emails will be skipped instead of sent. Production defaults this flag to true and rejects false or incomplete mail configuration.
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

### 3. Apply Prisma migrations

```bash
cd backend
npm run prisma:migrate
npm run prisma:generate
```

Use `npm run prisma:migrate` only for local development. For production deployments, use `npm run prisma:migrate:deploy`.

Use a direct PostgreSQL URL for `DIRECT_URL` when the deployment host supports Supabase's IPv6 direct endpoint. On IPv4-only hosts, use Supavisor session mode on port `5432` for `DIRECT_URL`. Transaction mode on port `6543` is not suitable for Prisma migrations.

### 4. Start both apps

Backend:

```bash
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
- Backend health is available at `http://localhost:5001/api/health`
- Backend OpenAPI JSON is available at `http://localhost:5001/api/openapi.json`
- Backend and frontend are started separately; there is no root workspace dev command.

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

## OAuth Provider Configuration

Local redirect URIs:

- Google: `http://localhost:5001/api/auth/google/callback`
- Discord: `http://localhost:5001/api/auth/discord/callback`

Production redirect URIs:

- Google: `https://api.questesports.lk/api/auth/google/callback`
- Discord: `https://api.questesports.lk/api/auth/discord/callback`

Notes:

- The provider dashboard redirect must match your backend callback URL exactly.
- `APP_URL` must point to the frontend origin, not the API origin, because the backend redirects the browser back to the frontend after OAuth completes.
- Do not use placeholder strings such as `your_google_client_id` or `your_discord_client_id`; leave values blank until real credentials are available.

## Upload Storage

Locally, the backend writes public files below `backend/uploads/`:

- `backend/uploads/team-logos`
- `backend/uploads/tournament-banners`
- `backend/uploads/poster-images`
- `backend/uploads/tournament-schedules`
- `backend/uploads/avatars`

Bank-transfer receipts are stored separately under the local private fallback and are never exposed through `/api/uploads`.

Production requirement:

- set `UPLOAD_ROOT=/srv/quest-esports/uploads`
- set `PRIVATE_UPLOAD_ROOT=/srv/quest-esports/private`
- make both paths writable by the `deploy` service user
- keep private storage mode `700` and exclude it from Nginx/static routes
- back up PostgreSQL and both storage roots as one consistency set

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
npm run build
npm run test:e2e
```

Playwright critical journeys run in CI. Manual production checks remain necessary for provider callbacks, email delivery, private uploads, DNS, cookies, and live payment behavior.

## Recommended Production Topology

### Option A: Two-process deployment behind a reverse proxy

- Next.js frontend on one process/container
- Express API on one process/container
- PostgreSQL as a managed database or dedicated host
- Nginx or a platform load balancer in front
- persistent volume mounted to backend uploads

### Option B: Frontend on Vercel, backend on a VM/container platform

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
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DIRECT_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
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
UPLOAD_ROOT=/srv/quest-esports/uploads
PRIVATE_UPLOAD_ROOT=/srv/quest-esports/private
PAYMENT_PROOF_PDF_ENABLED=false
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
- The current French VPS uses the Paris Supavisor session pooler on port `5432` for both database URLs because the direct Supabase endpoint is IPv6.
- `APP_URL` must point to the frontend origin because email links are generated from it.
- `AUTH_ENCRYPTION_KEY` must be exactly 64 hexadecimal characters; do not rotate an existing key without a data migration plan.
- Production requires `MAIL_DELIVERY_REQUIRED=true` and complete settings for the selected provider.
- PayHere merchant values must be all configured or all blank. When blank, free and bank-transfer tournament registration remain available, but PayHere registration and merchandise checkout are disabled.
- Keep `PAYMENT_PROOF_PDF_ENABLED=false` unless uploaded PDFs pass through a maintained malware-scanning/sanitization pipeline. Image receipts are decoded and re-encoded before storage.
- `CORS_ORIGIN` can be a comma-separated allowlist.
- `REQUIRE_API_ORIGIN=true` blocks API requests without an allowed `Origin` or `Referer`; use `CORS_ORIGIN=https://questesports.lk` for the public site domain.
- The Supabase Data API is unused and should be disabled for the Paris project. `npm run prisma:security:verify` confirms all public tables use RLS and Data API roles have no table privileges.
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
4. Install dependencies with `npm install`.
5. Run `npm run prisma:generate`.
6. Run `npm run prisma:migrate:deploy`.
7. Run the service with `npm start`.

### Frontend

1. Set `NEXT_PUBLIC_API_URL`.
2. Set `NEXT_PUBLIC_SITE_URL`.
3. Install dependencies with `npm install`.
4. Run `npm run lint`, `npm test`, and `npm run build`.
5. Start with `npm run start`.

## VPS Backend-Only Deploy Flow

This repository can be cloned in full on a VPS even when only the backend is served there.

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
curl --fail http://127.0.0.1:5001/api/health
```

If your frontend is hosted somewhere else, such as Vercel, you do not need to build or restart `frontend/` on this VPS.

For initial provisioning, Actions secrets, host-key pinning, PM2 systemd setup, rollback behavior, troubleshooting, updates, and reboot validation, use the [Production Operations Runbook](./production-runbook.md).

## Post-Deployment Validation

Check all of the following:

- `GET /api/health` returns `200`
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
`frontend/public/images`. It validates all sources before making changes, skips
posters already present, and rolls back database changes and newly written files
if the import fails. Git and repository history are not runtime dependencies.

Run these in a controlled environment and back up the database plus uploads first.

## Current Production Gaps

Before calling the system fully production-hardened, consider adding:

- broader Playwright coverage beyond the current critical journeys
- production-grade log retention, alerting, and monitoring dashboards
- object storage for uploads
- an admin bootstrap script
- blue-green or canary release automation for zero-downtime deploys
