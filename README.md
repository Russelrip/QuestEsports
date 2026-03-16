# Quest Esports

Quest Esports is a full-stack esports website for showcasing tournaments, publishing event content, and collecting player, team, and contact submissions.

The repository is split into:

- `frontend/`: Next.js 16 + React 19 marketing site and registration UI
- `backend/`: Express API backed by a local SQLite database

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

The rebuilt backend stores these core records:

- `User`
- `ContactSubmission`
- `Tournament`
- `TeamRegistration`
- `RegistrationMember`

## Tech Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS v4
- Backend: Express 5, SQLite, Multer, bcryptjs
- Tooling: ESLint, Nodemon

## Project Structure

```text
QuestEsports/
|-- backend/
|   |-- data/
|   `-- src/
|       |-- config/
|       |-- constants/
|       |-- lib/
|       |-- middleware/
|       |-- modules/
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
CORS_ORIGIN=http://localhost:3000
DATABASE_PATH=./data/quest-esports.db
```

Create a `.env.local` file inside `frontend/`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
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
```

## Implementation Notes

- CORS is configurable through `CORS_ORIGIN` and defaults to `http://localhost:3000`.
- Login stores returned user data in `localStorage` or `sessionStorage`; there is no token-based auth yet.
- The generic `/registration` page is currently a frontend-only form scaffold and is separate from the API-backed `/tournament-registration` flow.
- Tournament registration stores a normalized roster and prevents duplicates for the same tournament by `teamName` or `captainEmail`.

## Gaps To Be Aware Of

- No automated test suite is present yet.
- No production deployment configuration is documented in the repo yet.
- Auth is sessionless and does not currently issue JWTs or cookies.
- The backend creates its upload directories on boot if they do not already exist.

## Suggested Next Steps

- Create authenticated player dashboards or admin tooling
- Add tests for controllers and form submission flows
- Document deployment for frontend hosting and the API/database runtime of your choice
