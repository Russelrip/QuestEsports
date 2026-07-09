# Quest Esports Backend

This is the Express 5 API for Quest Esports. It owns authentication, sessions, tournament registration, team invites, recruitment applications, admin workflows, media uploads, native bracket data, and transactional email jobs.

## Requirements

- Node.js 20.x
- npm 10+
- PostgreSQL 15+ recommended

## Environment

Create `backend/.env` from `.env.example`.

Required for boot:

- `DATABASE_URL`
- `DIRECT_URL`
- `SESSION_COOKIE_NAME`

Important optional groups:

- SMTP and `APP_URL` for real verification, password reset, invite, email-change, and security-alert email delivery
- Google and Discord OAuth credentials for social login
- `TRUST_PROXY` and `REQUIRE_API_ORIGIN` for production proxy and origin enforcement
- `LOG_DRAIN_URL` and `MONITORING_WEBHOOK_URL` for external observability hooks

See [Setup And Deployment Guide](../docs/setup-and-deployment.md) for complete local and production examples.

## Install And Run

```bash
npm install
npm run prisma:migrate
npm run prisma:generate
npm run dev
```

The API runs at `http://localhost:5001` by default.

Useful local URLs:

- Health: `http://localhost:5001/api/health`
- OpenAPI JSON: `http://localhost:5001/api/openapi.json`
- Prisma Studio: `npm run prisma:studio`

## Scripts

```bash
npm run dev
npm start
npm test
npm run prisma:generate
npm run prisma:migrate
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run prisma:studio
npm run mail:verify
npm run media:import-legacy-posters
npm run media:migrate-image-assets
```

## Main Route Groups

- Auth, sessions, MFA, OAuth, verification, password reset, and email change under `/api`
- Public tournaments under `/api/tournaments`
- Tournament registration under `/api/tournament-registration`
- Recruitment applications under `/api/recruitment-applications`
- Team profile and invite responses under `/api/teams/profile` and `/api/team-invite`
- Contact messages under `/api/contact`
- Media and uploads under `/api/posters`, `/api/images`, and `/api/uploads/...`
- Admin workflows under `/api/admin/...`

See [API Documentation](../docs/api-documentation.md) for endpoint details.

## Admin Operations

Admin APIs require a valid session with `role === "admin"`.

Current admin-only operational endpoints include:

- tournament registration listing, status updates, deletion, and filtered Excel export
- recruitment application listing, status updates, deletion, and filtered Excel export
- tournament management, schedule uploads, completed-event showcase uploads, and native bracket generation
- contact inbox moderation
- user management
- rulebook management
- poster/image maintenance jobs

Excel exports are generated on demand with `exceljs` and returned as `.xlsx` downloads. They are not stored on disk by the backend.

See [Admin Operations](../docs/admin-operations.md) for UI workflows, export contents, and deletion behavior.

## Storage

Application data lives in PostgreSQL through Prisma. Uploaded files are stored under `backend/uploads/`:

- `team-logos/`
- `tournament-banners/`
- `poster-images/`
- `tournament-schedules/`

Treat `backend/uploads/` as persistent production data and back it up with the database.

## Tests

Backend tests use Node's built-in test runner:

```bash
npm test
```

The current unit suite covers auth/session behavior, email jobs, observability helpers, rate limiting, team helpers, recruitment validation, tournament registration behavior, bracket behavior, and admin registration/recruitment export and delete workflows.
