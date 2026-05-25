# Setup And Deployment Guide

This guide covers local setup, environment configuration, and a practical production deployment approach for the current codebase.

## Requirements

- Node.js 20+ recommended
- npm 10+
- PostgreSQL 15+ recommended
- SMTP credentials for real email delivery

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
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
MFA_ISSUER=Quest Esports
AUTH_ENCRYPTION_KEY=
TRUST_PROXY=false
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_your_resend_api_key
MAIL_FROM="Quest Esports <no-reply@example.com>"
APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:5001/api/auth/google/callback
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_CALLBACK_URL=http://localhost:5001/api/auth/discord/callback
```

For purely local development, SMTP values can be left blank. The backend will still run, but verification, password reset, invite, and email-change emails will be skipped instead of sent.
If OAuth is not being used locally, leave the OAuth client ID and secret values blank.

Frontend `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 3. Apply Prisma migrations

```bash
cd backend
npm run prisma:migrate
npm run prisma:generate
```

Use `npm run prisma:migrate` only for local development. For production deployments, use `npm run prisma:migrate:deploy`.

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

The codebase supports running without SMTP, but verification, password reset, invite, and email-change emails will be skipped.

For production:

- set `SMTP_HOST`
- set `SMTP_PORT`
- set `SMTP_USER`
- set `SMTP_PASS`
- set `MAIL_FROM`
- set `APP_URL` to the public frontend origin

Security-related optional variables:

- `MFA_ISSUER` to customize authenticator app labeling
- `AUTH_ENCRYPTION_KEY` for encrypting MFA secrets and signing OAuth state
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

If you use Resend SMTP:

- host: `smtp.resend.com`
- port: `465`
- username: `resend`
- password: your Resend API key

## Upload Storage

The backend writes persistent files to:

- `backend/uploads/team-logos`
- `backend/uploads/tournament-banners`
- `backend/uploads/poster-images`

Production requirement:

- mount this path on persistent storage

Do not deploy this backend on fully ephemeral disk unless you replace the upload strategy with object storage.

## Build Commands

Backend:

```bash
cd backend
npm start
```

Frontend build and start:

```bash
cd frontend
npm run build
npm run start
```

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
PORT=5001
CORS_ORIGIN=https://questesports.lk
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
MFA_ISSUER=Quest Esports
AUTH_ENCRYPTION_KEY=replace_with_a_long_random_secret
TRUST_PROXY=1
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_your_resend_api_key
MAIL_FROM="Quest Esports <no-reply@mail.questesports.lk>"
APP_URL=https://questesports.lk
GOOGLE_CLIENT_ID=your_real_google_client_id
GOOGLE_CLIENT_SECRET=your_real_google_client_secret
GOOGLE_CALLBACK_URL=https://api.questesports.lk/api/auth/google/callback
DISCORD_CLIENT_ID=your_real_discord_client_id
DISCORD_CLIENT_SECRET=your_real_discord_client_secret
DISCORD_CALLBACK_URL=https://api.questesports.lk/api/auth/discord/callback
```

Notes:

- `DATABASE_URL` and `SESSION_COOKIE_NAME` are required.
- `APP_URL` must point to the frontend origin because email links are generated from it.
- `CORS_ORIGIN` can be a comma-separated allowlist.

### Frontend

```env
NEXT_PUBLIC_API_URL=https://api.questesports.lk
NEXT_PUBLIC_SITE_URL=https://questesports.lk
```

## Reverse Proxy Notes

If the backend is behind Nginx or another proxy:

- forward the original host and protocol headers
- set `TRUST_PROXY` so Express respects the proxy
- terminate HTTPS before traffic reaches the browser

This matters because:

- session cookies are marked `Secure` in production
- CSRF origin checking depends on correct origins
- generated URLs and canonical URLs must match the public origin

## Deployment Steps

### Backend

1. Provision PostgreSQL.
2. Provision persistent storage for `backend/uploads/`.
3. Set environment variables.
4. Install dependencies with `npm install`.
5. Run `npm run prisma:migrate:deploy`.
6. Run the service with `npm start`.

### Frontend

1. Set `NEXT_PUBLIC_API_URL`.
2. Set `NEXT_PUBLIC_SITE_URL`.
3. Install dependencies with `npm install`.
4. Run `npm run build`.
5. Start with `npm run start`.

## Post-Deployment Validation

Check all of the following:

- `GET /api/health` returns `200`
- signup works
- login sets a session cookie
- MFA setup can be started and confirmed
- MFA login challenge works with both authenticator and backup code paths
- active sessions appear under `/api/sessions`
- `/api/me` returns the authenticated user
- verification emails contain the correct frontend URL
- email-change confirmation emails contain the correct frontend URL
- password reset emails contain the correct frontend URL
- team invite emails contain the correct frontend URL
- Google and Discord login redirect back to the expected frontend route when enabled
- tournament banners render
- poster images render
- admin can access team logos
- public cannot access admin-only media endpoints

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

Run these in a controlled environment and back up the database plus uploads first.

## Current Production Gaps

Before calling the system fully production-hardened, consider adding:

- automated tests
- centralized logging/monitoring
- real queue-backed background jobs
- object storage for uploads
- an admin bootstrap script
- CI/CD and migration rollout automation
