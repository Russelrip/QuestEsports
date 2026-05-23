# Quest Esports

Quest Esports is a full-stack esports platform for publishing tournaments, registering teams, managing community communications, and curating poster/media content. The repository contains a public-facing Next.js application and an Express + Prisma API that powers authentication, tournament operations, admin tooling, and media workflows.

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
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
TRUST_PROXY=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
APP_URL=http://localhost:3000
```

Frontend: create `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Notes:

- `DATABASE_URL` and `SESSION_COOKIE_NAME` are required for the backend to boot.
- `NEXT_PUBLIC_API_URL` must point at the backend origin.
- `NEXT_PUBLIC_SITE_URL` powers metadata, sitemap, canonical URLs, and structured data.
- SMTP is optional for local development. If mail is not configured, signup, verification, password reset, team invites, and email-change requests still execute, but email delivery is skipped.

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
- Team tournament registration flow
- Email verification, login, logout, password reset, and email change flows
- Posters gallery and match-video archive
- Rulebook and contact pages
- Player profile page

### Admin features

- Dashboard summary cards
- User management
- Tournament creation and editing
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
- Tournament banners, team logos, and poster image files are written to `backend/uploads/`.
- Poster/image metadata is stored in PostgreSQL. Poster assets support filesystem-backed storage with a database binary fallback for older records.
- Email flows generate signed random tokens, store only token hashes in the database, and send action links that point to the frontend origin configured by `APP_URL`.

## Main Data Domains

- `User`, `Session`, `VerificationToken`, `PasswordResetToken`, `EmailChangeToken`
- `Tournament`, `TeamRegistration`, `RegistrationMember`
- `SavedTeam`, `SavedTeamMember`
- `ContactSubmission`
- `ImageAsset`, `Poster`

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

- Auth: `/api/signup`, `/api/login`, `/api/logout`, `/api/me`, verification, email-change, and password-reset endpoints
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
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
TRUST_PROXY=false
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_your_resend_api_key
MAIL_FROM="Quest Esports <no-reply@example.com>"
APP_URL=http://localhost:3000
```

Notes:

- `DATABASE_URL` and `SESSION_COOKIE_NAME` are required.
- `CORS_ORIGIN` supports a comma-separated allowlist.
- `APP_URL` must point at the frontend origin used in verification, password reset, email-change, and invite emails when SMTP is enabled.
- SMTP values are optional for local development. When SMTP is not configured, mail-triggering actions log and skip delivery instead of crashing startup.

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
- Team logos are intentionally protected behind admin access.
- The built-in `/api/openapi.json` file is a partial contract, not a full generated spec.
- There is currently no automated test suite in the repository.
- There is currently no admin seed/bootstrap script beyond creating a user and promoting it through Prisma Studio.
- Background jobs and monitoring are placeholder integrations and should be wired to production services before scaling email/media workloads.

## Recommended Next Steps

- Read [Setup and Deployment Guide](./docs/setup-and-deployment.md) before standing up a production environment.
- Read [Authentication Flow](./docs/authentication-flow.md) before changing session or email logic.
- Read [Database and Storage](./docs/database-and-storage.md) before touching uploads, Prisma schema, or media migration scripts.
