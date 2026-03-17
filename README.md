# Quest Esports

Quest Esports is a full-stack esports website for showcasing tournaments, publishing event content, and collecting player, team, and contact submissions.

The repository is split into:

- `frontend/`: Next.js 16 + React 19 marketing site and registration UI
- `backend/`: Express API backed by PostgreSQL via Prisma

## Current Features

### Frontend

- Homepage with hero, about, team, and featured tournament sections
- Tournament listing page with game filters
- Tournament details page for individual events
- Tournament registration page with full 5-player team intake
- Rulebook page for VALORANT tournament policies
- Match videos page
- Posters gallery page
- Contact page with backend form submission
- Player signup page with backend account creation
- Player login page with browser storage of returned user data
- User profile page
- Admin dashboard page

### Backend

- `POST /api/signup` for player account creation
- `POST /api/login` for email-or-username login
- `POST /api/contact` for contact form submissions
- `GET /api/tournament-registration/status/:slug` for checking registration status
- `POST /api/tournament-registration` for team registration with optional logo upload
- `GET /api/health` for basic health checking

### Database

The rebuilt backend stores these core records:

- `User`
- `Session`
- `ContactSubmission`
- `Tournament`
- `TeamRegistration`
- `RegistrationMember`

## Tech Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS v4
- Backend: Express 5, Prisma ORM, PostgreSQL, Multer, bcryptjs
- Tooling: ESLint, Nodemon

## Project Structure

```text
QuestEsports/
|-- README.md
|-- backend/
|   |-- package.json
|   |-- prisma/
|   |   |-- schema.prisma
|   |   `-- migrations/
|   `-- src/
|       |-- app.js
|       |-- server.js
|       |-- config/
|       |   `-- env.js
|       |-- constants/
|       |   `-- tournaments.js
|       |-- lib/
|       |   |-- async-handler.js
|       |   |-- database.js
|       |   |-- http-error.js
|       |   |-- logger.js
|       |   |-- prisma-errors.js
|       |   |-- prisma.js
|       |   |-- validation.js
|       |-- middleware/
|       |   |-- error-handler.js
|       |   `-- upload.js
|       |-- modules/
|       |   |-- auth/
|       |   |   |-- auth.controller.js
|       |   |   |-- auth.middleware.js
|       |   |   |-- auth.routes.js
|       |   |   |-- auth.service.js
|       |   |   `-- session.service.js
|       |   |-- contact/
|       |   |   |-- contact.controller.js
|       |   |   |-- contact.routes.js
|       |   |   `-- contact.service.js
|       |   `-- tournaments/
|       |       |-- tournament.controller.js
|       |       |-- tournament.routes.js
|       |       `-- tournament.service.js
|       `-- routes/
|           `-- index.js
`-- frontend/
    |-- eslint.config.mjs
    |-- next-env.d.ts
    |-- next.config.ts
    |-- package.json
    |-- postcss.config.mjs
    |-- tsconfig.json
    |-- app/
    |   |-- globals.css
    |   |-- layout.tsx
    |   |-- page.tsx
    |   |-- admin/
    |   |   `-- page.tsx
    |   |-- contact/
    |   |   `-- page.tsx
    |   |-- login/
    |   |   `-- page.tsx
    |   |-- match-videos/
    |   |   `-- page.tsx
    |   |-- posters/
    |   |   `-- page.tsx
    |   |-- profile/
    |   |   `-- page.tsx
    |   |-- registration/
    |   |   `-- page.tsx
    |   |-- rulebook/
    |   |   `-- page.tsx
    |   |-- signup/
    |   |   `-- page.tsx
    |   |-- tournament-registration/
    |   |   `-- page.tsx
    |   `-- tournaments/
    |       |-- page.tsx
    |       `-- [slug]/
    |           `-- page.tsx
    |-- components/
    |   |-- Footer.tsx
    |   |-- Navbar.tsx
    |   |-- PageHeader.tsx
    |   |-- PageLayout.tsx
    |   |-- UserMenu.tsx
    |   |-- admin/
    |   |   `-- AdminDashboard.tsx
    |   |-- auth/
    |   |   |-- AuthProvider.tsx
    |   |   |-- LoginForm.tsx
    |   |   |-- ProfileView.tsx
    |   |   `-- SignupForm.tsx
    |   |-- contact/
    |   |   |-- ContactForm.tsx
    |   |   `-- ContactInfo.tsx
    |   |-- home/
    |   |   |-- AboutSection.tsx
    |   |   |-- FeaturedTournaments.tsx
    |   |   |-- HomeHero.tsx
    |   |   `-- TeamSection.tsx
    |   |-- match-videos/
    |   |   `-- MatchVideosContent.tsx
    |   |-- Posters/
    |   |   `-- PostersContent.tsx
    |   |-- registration/
    |   |   `-- RegistrationForm.tsx
    |   |-- rulebook/
    |   |   `-- RulebookContent.tsx
    |   |-- tournament-registration/
    |   |   |-- RosterMemberFields.tsx
    |   |   `-- TournamentRegistrationForm.tsx
    |   |-- tournaments/
    |   |   |-- RegisterTournamentButton.tsx
    |   |   |-- TournamentDetailsContent.tsx
    |   |   |-- TournamentInfoList.tsx
    |   |   `-- TournamentsContent.tsx
    |   `-- ui/
    |       `-- EmptyState.tsx
    |-- hooks/
    |   `-- useFormFields.ts
    |-- lib/
    |   |-- auth.ts
    |   |-- media.ts
    |   |-- registered-tournaments.ts
    |   |-- site.ts
    |   `-- tournaments.ts
    `-- public/
        |-- fonts/
        `-- images/
```

## Local Development

### 1. Install dependencies

Install each app separately:

```bash
cd frontend
npm install
```

```bash
cd backend
npm install
```

### 2. Configure environment variables

Create a `.env` file inside `backend/`:

```env
PORT=5001
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
ADMIN_EMAILS=admin@questesports.com
SESSION_COOKIE_NAME=quest_session
SESSION_TTL_DAYS=1
REMEMBER_ME_SESSION_TTL_DAYS=30
```

Create a `.env.local` file inside `frontend/`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
```

### 3. Start the apps

Backend:

```bash
cd backend
npm run prisma:migrate
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

App URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5001`

## API Overview

### `GET /api/health`

Returns a basic status payload to confirm the API is running.

### `GET /api/openapi.json`

Returns the current OpenAPI-style contract document for the API. This is the repo's starting point for Swagger UI or any future generated API documentation flow.

### `POST /api/signup`

Creates a user account using:

- `firstName`
- `lastName`
- `email`
- `username`
- `password`
- `phone` (optional)
- `discordTag` (optional)

### `POST /api/login`

Authenticates using:

- `emailOrUsername`
- `password`

### `POST /api/contact`

Stores a contact message using:

- `name`
- `email`
- `subject`
- `message`

### `GET /api/tournament-registration/status/:slug`

Checks if the authenticated user has registered for the specified tournament.

### `POST /api/tournament-registration`

Accepts `multipart/form-data` with:

- tournament selection
- team name
- optional team logo image
- captain details
- players 2-5
- optional substitutes
- optional coach details
- contact email
- agreement checkboxes

Uploaded logos are stored under `backend/uploads/team-logos`.

## Frontend Routes

The current app includes these pages:

- `/` - Homepage
- `/tournaments` - Tournament listings with game filters
- `/tournaments/[slug]` - Individual tournament details
- `/tournament-registration` - Team registration form
- `/rulebook` - Tournament policies
- `/match-videos` - Event videos gallery
- `/posters` - Posters gallery
- `/contact` - Contact form
- `/signup` - Player signup
- `/login` - Player login
- `/profile` - User profile
- `/admin` - Admin dashboard
- `/registration` - Legacy registration page (frontend-only)

## Useful Commands

Frontend:

```bash
npm run dev
npm run build
npm run lint
```

Backend:

```bash
npm run dev
npm start
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

## Implementation Notes

- CORS is configurable through `CORS_ORIGIN` and supports comma-separated origins.
- Auth uses `HttpOnly` session cookies backed by the `sessions` table; sensitive fields such as password hashes are never returned by the API.
- The backend applies origin-based CSRF protection for unsafe requests, security response headers, and rate limiting on login, signup, contact, and tournament-registration submissions.
- Admin list endpoints now share page/pageSize pagination semantics, including `/api/admin/users`, `/api/admin/contact-messages`, `/api/admin/team-registrations`, and `/api/admin/tournaments`.
- The generic `/registration` page is currently a frontend-only form scaffold and is separate from the API-backed `/tournament-registration` flow.
- Tournament registration stores a normalized roster and prevents duplicates for the same tournament by `teamName` or `captainEmail`.
- Tournament catalogue rows are upserted on backend boot so configured events stay in sync with the API.

## Scaling Recommendations

- Frontend data fetching: the current fetch helpers are intentionally small, but the next step should be introducing React Query or SWR for request caching, background refetching, and optimistic admin mutations.
- Monitoring: `backend/src/lib/monitoring.js` is a logger-backed adapter so Sentry, Datadog, or OpenTelemetry can be wired in without changing the error middleware contract.
- Background jobs: `backend/src/lib/jobs.js` is a placeholder seam for queue-backed email, webhook, poster-processing, or audit jobs; BullMQ is the most natural fit if you already have Redis.
- API contracts: `/api/openapi.json` can be fed into Swagger UI or Redoc once you choose a docs surface for the backend.

## Gaps To Be Aware Of

- No automated test suite is present yet.
- No production deployment configuration is documented in the repo yet.
- The backend creates its upload directories on boot if they do not already exist.

## Suggested Next Steps

- Create authenticated player dashboards or admin tooling
- Add tests for controllers and form submission flows
- Document deployment for frontend hosting and the API/database runtime of your choice
