# Quest Esports

Quest Esports is a full-stack esports platform for publishing tournaments, registering teams, managing community communications, and curating poster/media content. The repository contains a public-facing Next.js application and an Express + Prisma API that powers authentication, tournament operations, admin tooling, security workflows, and media management.

## Quick Start

This repository does not have a single root `npm run dev` command. Run the backend and frontend separately.

### Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 15+ recommended

### 1. Configure environment variables

Backend: create `backend/.env`

```env
PORT=5001
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DIRECT_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
MFA_ISSUER=Quest Esports
AUTH_ENCRYPTION_KEY=
TRUST_PROXY=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:5001/api/auth/google/callback
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_CALLBACK_URL=http://localhost:5001/api/auth/discord/callback
```

Frontend: create `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Notes:

- `DATABASE_URL`, `DIRECT_URL`, and `SESSION_COOKIE_NAME` are required for the backend to boot.
- In hosted Postgres setups, `DATABASE_URL` can use a pooled connection string while `DIRECT_URL` should use the direct connection string for Prisma migrations.
- `NEXT_PUBLIC_API_URL` must point at the backend origin.
- `NEXT_PUBLIC_SITE_URL` powers metadata, sitemap, canonical URLs, and structured data.
- SMTP is optional for local development. If mail is not configured, signup, verification, password reset, team invites, and email-change requests still execute, but email delivery is skipped.
- OAuth is optional. If you enable Google or Discord login, use real client credentials and register the callback URLs shown above. Do not leave placeholder values like `your_google_client_id`.

### 2. Install dependencies

```bash
cd backend
npm install
```

```bash
cd frontend
npm install
```

### 3. Apply database migrations

```bash
cd backend
npm run prisma:migrate
npm run prisma:generate
```

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

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5001`
- Health: `http://localhost:5001/api/health`
- OpenAPI JSON: `http://localhost:5001/api/openapi.json`

### 6. Bootstrap the first admin user

There is no seed script for the first admin account.

Recommended flow:

1. Sign up through the app or create a user in Prisma Studio.
2. Open Prisma Studio with `cd backend && npm run prisma:studio`.
3. Change that user's `role` to `admin`.

## Documentation

- [API Documentation](./docs/api-documentation.md)
- [Authentication Flow](./docs/authentication-flow.md)
- [Database and Storage](./docs/database-and-storage.md)
- [Setup and Deployment Guide](./docs/setup-and-deployment.md)

## Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS v4
- Backend: Express 5, Prisma ORM, PostgreSQL
- Auth: Cookie-based sessions with server-side session storage
- Uploads: Multer, filesystem-backed image storage
- Email: Nodemailer with SMTP

## What The Platform Includes

### Public product features

- Marketing homepage and brand sections
- Tournament listing and tournament detail pages
- Tournament schedule tables rendered from uploaded XLSX, XLS, or CSV files
- Completed-tournament showcase sections with official poster plus 1st, 2nd, and 3rd place visuals
- Public tournament team lists with approved registered teams and team logos
- Team tournament registration flow
- Email verification, login, logout, password reset, and email change flows
- MFA setup, MFA login challenge, backup codes, session management, and Google/Discord OAuth sign-in
- Posters gallery and match-video archive
- Rulebook and contact pages
- Player profile page

### Admin features

- Dashboard summary cards
- User management
- Tournament creation and editing
- Tournament asset management for banners, schedules, and completed-event showcase images
- Registration review and status management
- Contact inbox moderation
- Poster/image asset management
- Legacy poster import and image migration utilities

## Repository Structure

```text
QuestEsports/
|-- README.md
|-- docs/
|   |-- api-documentation.md
|   |-- authentication-flow.md
|   |-- database-and-storage.md
|   `-- setup-and-deployment.md
|-- backend/
|   |-- .env.example
|   |-- package.json
|   |-- prisma/
|   |   |-- schema.prisma
|   |   `-- migrations/
|   |-- scripts/
|   `-- src/
|       |-- app.js
|       |-- server.js
|       |-- config/
|       |-- lib/
|       |-- middleware/
|       |-- modules/
|       `-- routes/
`-- frontend/
    |-- package.json
    |-- next.config.ts
    |-- app/
    |-- components/
    |-- hooks/
    |-- lib/
    `-- public/
```

## Architecture Summary

- The frontend runs on Next.js App Router and calls the backend with `credentials: "include"` so browser cookies are sent on authenticated requests.
- The backend exposes JSON APIs under `/api`, stores business data in PostgreSQL through Prisma, and persists session state in the `sessions` table.
- Tournament banners, completed-showcase images, team logos, poster image files, and uploaded tournament schedules are written to `backend/uploads/`.
- Poster/image metadata is stored in PostgreSQL. Poster assets support filesystem-backed storage with a database binary fallback for older records.
- Email flows generate signed random tokens, store only token hashes in the database, and send action links that point to the frontend origin configured by `APP_URL`.

## Main Data Domains

- `User`, `Session`, `VerificationToken`, `PasswordResetToken`, `EmailChangeToken`
- `Tournament`, `TeamRegistration`, `RegistrationMember`
- `SavedTeam`, `SavedTeamMember`
- `ContactSubmission`
- `ImageAsset`, `Poster`
- `BackgroundJob`

## Frontend Routes

### Public routes

- `/`
- `/tournaments`
- `/tournaments/[slug]`
- `/tournament-registration`
- `/registration`
- `/match-videos`
- `/posters`
- `/rulebook`
- `/contact`
- `/signup`
- `/login`
- `/verify-email`
- `/confirm-email-change`
- `/forgot-password`
- `/reset-password`
- `/team-invite`

### Authenticated routes

- `/profile`

### Admin routes

- `/admin`
- `/admin/users`
- `/admin/tournaments`
- `/admin/tournaments/new`
- `/admin/tournaments/[id]/edit`
- `/admin/registrations`
- `/admin/contact-messages`

## API Surface

The backend exposes these main route groups:

- Auth: `/api/signup`, `/api/login`, `/api/login/mfa`, OAuth start/callback routes, `/api/logout`, `/api/me`, verification, email-change, password-reset, MFA, and session endpoints
- Public tournaments: `/api/tournaments`, `/api/tournaments/:slug`
- Tournament registration: `/api/tournament-registration`, `/api/tournament-registration/status/:slug`
- Teams: `/api/teams/profile`, `/api/team-invite`, `/api/team-invite/respond`
- Contact: `/api/contact`
- Media: `/api/posters`, `/api/images`, `/api/uploads/...`
- Admin: `/api/admin/...`

See [API Documentation](./docs/api-documentation.md) for the complete reference.

## Environment Variables

### Backend

Create `backend/.env` from `backend/.env.example`.

```env
PORT=5001
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
DIRECT_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
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

Notes:

- `DATABASE_URL`, `DIRECT_URL`, and `SESSION_COOKIE_NAME` are required.
- `CORS_ORIGIN` supports a comma-separated allowlist.
- `APP_URL` must point at the frontend origin used in verification, password reset, email-change, and invite emails when SMTP is enabled.
- SMTP values are optional for local development. When SMTP is not configured, mail-triggering actions log and skip delivery instead of crashing startup.
- If OAuth is enabled locally, register these redirect URIs with the providers:
  - Google: `http://localhost:5001/api/auth/google/callback`
  - Discord: `http://localhost:5001/api/auth/discord/callback`
- If OAuth is disabled, leave the OAuth client ID and secret values blank rather than using placeholder text.

## OAuth Setup

Use these values for local development:

- `APP_URL=http://localhost:3000`
- `GOOGLE_CALLBACK_URL=http://localhost:5001/api/auth/google/callback`
- `DISCORD_CALLBACK_URL=http://localhost:5001/api/auth/discord/callback`

Use these values for production:

- `APP_URL=https://questesports.lk`
- `GOOGLE_CALLBACK_URL=https://api.questesports.lk/api/auth/google/callback`
- `DISCORD_CALLBACK_URL=https://api.questesports.lk/api/auth/discord/callback`

Provider dashboard redirects should match the callback URL values exactly.

### Frontend

Create `frontend/.env.local`.

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Notes:

- `NEXT_PUBLIC_API_URL` must point at the backend origin.
- `NEXT_PUBLIC_SITE_URL` is used for metadata, canonical URLs, sitemap generation, and structured data.

## Local Development

### 1. Install dependencies

```bash
cd backend
npm install
```

```bash
cd frontend
npm install
```

### 2. Apply database migrations

```bash
cd backend
npm run prisma:migrate
npm run prisma:generate
```

### 3. Start the apps

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

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5001`
- Health: `http://localhost:5001/api/health`
- OpenAPI JSON: `http://localhost:5001/api/openapi.json`

## Operational Notes

- The backend creates upload directories automatically at startup.
- There is no root workspace runner; start `backend` and `frontend` in separate terminals.
- Team registration requires a logged-in user with a verified email address.
- Admin tournament management supports spreadsheet uploads for schedules and showcase-image uploads for completed events.
- Public tournament responses now include `displayPriority`, `scheduleData`, `isCompleted`, `showcase`, and per-tournament `registeredTeams` on detail pages.
- Direct imports that touch backend config now load `.env` automatically, so scripts and one-off Node entrypoints behave the same as `node src/server.js`.
- Team logos are intentionally protected behind admin access.
- The built-in `/api/openapi.json` file is a partial contract, not a full generated spec.
- The backend includes a Node test suite under `backend/tests`.
- There is currently no admin seed/bootstrap script beyond creating a user and promoting it through Prisma Studio.
- Background jobs and monitoring are placeholder integrations and should be wired to production services before scaling email/media workloads.

## Verification Commands

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

Backend:

```bash
cd backend
npm run prisma:generate
npm test
node src/server.js
```

## Recommended Next Steps

- Read [Setup and Deployment Guide](./docs/setup-and-deployment.md) before standing up a production environment.
- Read [Authentication Flow](./docs/authentication-flow.md) before changing session or email logic.
- Read [Database and Storage](./docs/database-and-storage.md) before touching uploads, Prisma schema, or media migration scripts.
