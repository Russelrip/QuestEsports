# Quest Esports

Quest Esports is a full-stack esports website for showcasing tournaments, publishing event content, and collecting player, team, and contact submissions.

The repository is split into:

- `frontend/`: Next.js 16 + React 19 marketing site and registration UI
- `backend/`: Express + Prisma API backed by PostgreSQL

## Current Features

### Frontend

- Homepage with hero, about, team, and featured tournament sections
- Tournament listing page
- Tournament registration page with full 5-player team intake
- Rulebook page for VALORANT tournament policies
- Match videos page
- Gallery page
- Contact page with backend form submission
- Player signup page with backend account creation
- Player login page with browser storage of returned user data

### Backend

- `POST /api/signup` for player account creation
- `POST /api/login` for email-or-username login
- `POST /api/contact` for contact form submissions
- `POST /api/tournament-registration` for team registration with optional logo upload
- `GET /api/health` for basic health checking

### Database

Prisma currently manages three core models:

- `User`
- `ContactMessage`
- `TournamentRegistration`

## Tech Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS v4
- Backend: Express 5, Prisma, PostgreSQL, Multer, bcryptjs
- Tooling: ESLint, Nodemon

## Project Structure

```text
QuestEsports/
|-- backend/
|   |-- prisma/
|   |   |-- migrations/
|   |   `-- schema.prisma
|   `-- src/
|       |-- config/
|       |-- controllers/
|       |-- routes/
|       |-- app.js
|       `-- server.js
`-- frontend/
    |-- app/
    |-- components/
    |-- public/
    |   |-- fonts/
    |   `-- images/
    `-- package.json
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
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/quest_esports
DIRECT_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/quest_esports
```

Create a `.env.local` file inside `frontend/`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
```

Notes:

- `DATABASE_URL` is used by Prisma CLI configuration.
- `DIRECT_DATABASE_URL` is what the running backend currently uses to connect through `pg` and the Prisma Postgres adapter.

### 3. Run database migrations

From `backend/`:

```bash
npx prisma migrate dev
```

If needed, generate the client explicitly:

```bash
npx prisma generate
```

### 4. Start the apps

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

App URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5001`

## API Overview

### `GET /api/health`

Returns a basic status payload to confirm the API is running.

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

- `/`
- `/tournaments`
- `/tournament-registration`
- `/rulebook`
- `/match-videos`
- `/gallery`
- `/contact`
- `/signup`
- `/login`
- `/registration`

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
npx prisma migrate dev
```

## Implementation Notes

- CORS is currently configured in the backend for `http://localhost:3000`.
- Login stores returned user data in `localStorage` or `sessionStorage`; there is no token-based auth yet.
- The generic `/registration` page is currently a frontend-only form scaffold and is separate from the API-backed `/tournament-registration` flow.
- Tournament registration prevents duplicate submissions for the same tournament by `teamName` or `captainEmail`.

## Gaps To Be Aware Of

- No automated test suite is present yet.
- No production deployment configuration is documented in the repo yet.
- Auth is sessionless and does not currently issue JWTs or cookies.
- The backend expects the upload directory to exist and be writable in local/runtime environments.

## Suggested Next Steps

- Add root and per-app `.env.example` files
- Add API validation and centralized error handling
- Create authenticated player dashboards or admin tooling
- Add tests for controllers and form submission flows
- Document deployment for frontend hosting and PostgreSQL-backed API hosting
