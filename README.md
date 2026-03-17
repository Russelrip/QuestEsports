# Quest Esports

Quest Esports is a full-stack esports platform for publishing tournaments, collecting team registrations, managing community contact messages, and curating media like posters and match videos.

This repository is split into two apps:

- `frontend/`: Next.js 16 App Router site for public pages, player auth, tournament browsing, registration, and admin screens
- `backend/`: Express 5 API with Prisma/PostgreSQL for auth, tournament management, registrations, contact inboxes, and poster media

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS v4
- Backend: Express 5, Prisma ORM, PostgreSQL, Multer, bcryptjs
- Tooling: ESLint, Nodemon

## What The App Does

### Public Experience

- Homepage with hero, brand, team, and featured tournament sections
- Tournament listing page with game filtering
- Tournament detail pages with schedule, format, prize pool, banner image, and registration state
- Team registration flow for authenticated users
- Match videos page backed by curated YouTube content
- Posters gallery backed by API data
- Rulebook and contact pages
- Signup, login, logout, and profile management

### Admin Experience

- Dashboard with tournament, registration, and unread-contact summary cards
- User management pages for creating, editing, and removing users
- Tournament management pages for creating, editing, publishing, and deleting tournaments
- Registration review pages with status, payment, and verification controls
- Contact inbox pages for reading and deleting submissions
- Poster studio for uploading image assets and creating poster entries
- Legacy poster import endpoint and script for migrating older assets

### Backend Capabilities

- Session-cookie authentication with `HttpOnly` cookies
- Role-based access control for admin-only routes
- Rate limiting for signup, login, contact, and tournament registration
- Origin-based CSRF protection for unsafe requests
- Security headers on both backend and frontend
- Prisma-backed pagination helpers for admin lists
- File-system uploads for team logos and tournament banners
- Database-backed image storage for poster/media assets

## Repository Structure

```text
QuestEsports/
|-- README.md
|-- backend/
|   |-- package.json
|   |-- .env.example
|   |-- prisma/
|   |   |-- schema.prisma
|   |   `-- migrations/
|   |-- scripts/
|   |   `-- import-legacy-posters.js
|   `-- src/
|       |-- app.js
|       |-- server.js
|       |-- config/
|       |-- constants/
|       |-- lib/
|       |-- middleware/
|       |-- modules/
|       |   |-- admin/
|       |   |-- auth/
|       |   |-- contact/
|       |   |-- media/
|       |   `-- tournaments/
|       `-- routes/
`-- frontend/
    |-- package.json
    |-- next.config.ts
    |-- tsconfig.json
    |-- app/
    |-- components/
    |-- hooks/
    |-- lib/
    `-- public/
```

## Data Model

The Prisma schema currently centers on these main records:

- `User`
- `Session`
- `ContactSubmission`
- `Tournament`
- `TeamRegistration`
- `RegistrationMember`
- `ImageAsset`
- `Poster`

Important enums currently in use:

- `UserRole`: `user`, `admin`
- `TournamentStatus`: `draft`, `upcoming`, `registration_open`, `ongoing`, `completed`, `cancelled`
- `TeamRegistrationStatus`: `pending`, `approved`, `rejected`
- `RegistrationPaymentStatus`: `unpaid`, `pending`, `paid`
- `RegistrationVerificationStatus`: `pending`, `verified`, `flagged`

## Environment Variables

### Backend

Create `backend/.env` from `backend/.env.example` and set:

```env
PORT=5001
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
TRUST_PROXY=false
```

Notes:

- `DATABASE_URL` is required
- `CORS_ORIGIN` supports a comma-separated allowlist
- `NODE_ENV` is validated as `development`, `test`, or `production`
- `MONITORING_PROVIDER` is optional and only affects health/monitoring metadata

### Frontend

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Notes:

- `NEXT_PUBLIC_API_URL` is used for API requests and media URL resolution
- `NEXT_PUBLIC_SITE_URL` is used for metadata, canonical URLs, sitemap/manifest output, and structured data

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

### 2. Prepare the database

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

Local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5001`
- OpenAPI JSON: `http://localhost:5001/api/openapi.json`
- Health check: `http://localhost:5001/api/health`

## Available Scripts

### Backend

```bash
npm run dev
npm start
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
npm run media:import-legacy-posters
```

### Frontend

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## API Overview

### Auth

- `POST /api/signup`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/users/:userId`
- `PATCH /api/users/:userId`

### Contact

- `POST /api/contact`

### Tournaments And Registration

- `GET /api/tournaments`
- `GET /api/tournaments/:slug`
- `GET /api/tournament-registration/status/:slug`
- `POST /api/tournament-registration`

### Admin

- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/users/:userId`
- `PATCH /api/admin/users/:userId`
- `DELETE /api/admin/users/:userId`
- `GET /api/admin/contact-messages`
- `PATCH /api/admin/contact-messages/:messageId`
- `DELETE /api/admin/contact-messages/:messageId`
- `GET /api/admin/team-registrations`
- `GET /api/admin/tournaments/:tournamentId/registrations`
- `PATCH /api/admin/team-registrations/:registrationId/status`
- `GET /api/admin/tournaments`
- `GET /api/admin/tournaments/:tournamentId`
- `POST /api/admin/tournaments`
- `PATCH /api/admin/tournaments/:tournamentId`
- `DELETE /api/admin/tournaments/:tournamentId`
- `POST /api/admin/media/import-legacy-posters`

### Media

- `GET /api/posters`
- `GET /api/posters/:posterId`
- `GET /api/posters/:posterId/image`
- `GET /api/images` admin only
- `GET /api/images/:imageId` admin only
- `GET /api/images/:imageId/binary` admin only
- `POST /api/images` admin only
- `POST /api/posters` admin only
- `DELETE /api/posters/:posterId` admin only

## Frontend Routes

### Public Routes

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
- `/profile`

### Admin Routes

- `/admin`
- `/admin/users`
- `/admin/tournaments`
- `/admin/tournaments/new`
- `/admin/tournaments/[id]/edit`
- `/admin/registrations`
- `/admin/contact-messages`

## Implementation Notes

- The frontend expects cookies to be included on authenticated API calls.
- Public tournament pages fetch live API data with `cache: "no-store"`.
- Poster images are stored in PostgreSQL as `ImageAsset.data` and streamed through the backend.
- Team logos and tournament banners are stored on disk under `backend/uploads/`.
- The frontend `next.config.ts` adds CSP and remote image rules based on `NEXT_PUBLIC_API_URL`.
- The backend creates upload directories on boot via `ensureUploadDirectories()`.
- The monitoring layer is currently a logger-backed adapter and is ready to be swapped for Sentry, Datadog, or OpenTelemetry.

## Current Caveats

- There is no automated test suite yet.
- There is no documented production deployment workflow yet.
- The route index references `backend/src/modules/uploads/upload.routes.js`; if that module is missing in your branch, upload-serving routes for generated `/api/uploads/...` URLs need to be restored before file uploads can be accessed publicly.

## Onboarding Tips

- Start by applying Prisma migrations before opening the frontend.
- Create at least one admin user through the API or Prisma Studio if you need admin pages immediately.
- If poster pages or uploaded images do not render, verify `NEXT_PUBLIC_API_URL`, the backend upload routes, and the CSP/image settings in `frontend/next.config.ts`.
