# Quest Esports Backend

This is the Express 5 API for Quest Esports. It owns authentication, sessions, tournament registration, team invites, recruitment applications, admin workflows, media uploads, native bracket data, and transactional email jobs.

## Requirements

- Node.js 24 LTS
- npm 10+
- PostgreSQL 15+ recommended

## Environment

Create `backend/.env` from `.env.example`.

Required in every environment:

- `DATABASE_URL`
- `DIRECT_URL`
- `SESSION_COOKIE_NAME`

Important optional groups:

- `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`, and `APP_URL` for real verification, password reset, invite, email-change, and security-alert delivery
- Generic `SMTP_*` credentials only when `MAIL_PROVIDER=smtp`, including a future Amazon SES switch
- Google and Discord OAuth credentials for social login
- `TRUST_PROXY` and `REQUIRE_API_ORIGIN` for production proxy and origin enforcement
- `LOG_DRAIN_URL` and `MONITORING_WEBHOOK_URL` for external observability hooks

Production additionally requires HTTPS `APP_URL`/`API_PUBLIC_URL`, a 64-character hexadecimal `AUTH_ENCRYPTION_KEY`, durable `UPLOAD_ROOT`/`PRIVATE_UPLOAD_ROOT`, trusted-proxy/origin enforcement, `MAIL_DELIVERY_REQUIRED=true`, and complete values for the selected mail provider. PayHere remains optional, but its merchant ID, secret, and notify URL must be configured together.

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
- Slug-bound tournament registration under `/api/tournaments/:slug/registrations`
- Event series under `/api/event-series`
- Account dashboard and avatar management under `/api/me/dashboard` and `/api/me/avatar`
- Products, quotes, orders, and commerce capabilities under `/api/products`, `/api/orders`, and `/api/commerce/capabilities`
- PayHere status/notifications and bank-transfer proofs under `/api/payments`
- Recruitment applications under `/api/recruitment-applications`
- Team creation, captain-managed roster updates/deletion, profiles, and invite responses under `/api/teams`, `/api/teams/:teamId`, `/api/teams/profile`, and `/api/team-invite`
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

Application data lives in PostgreSQL through Prisma. Locally, public uploads default to `backend/uploads/`; production uses `UPLOAD_ROOT` outside the Git checkout:

- `team-logos/`
- `tournament-banners/`
- `poster-images/`
- `tournament-schedules/`
- `avatars/`

Bank-transfer evidence is written below `PRIVATE_UPLOAD_ROOT/bank-transfer-proofs/` with private permissions and is never served by `/api/uploads`. Treat the database plus both configured upload roots as one backup set.

## Tests

Backend tests use Node's built-in test runner:

```bash
npm test
npm run test:coverage
npm run lint
```

The current suite covers auth/session behavior, email jobs, observability helpers, rate limiting, teams, configurable registration, slot pricing, bank-transfer and PayHere payment handling, shop behavior, bracket behavior, and admin workflows. CI enforces coverage thresholds and runs lint against `src`, `tests`, and `scripts`.

## Tournament Content Upgrade

`GET /api/game-categories` supplies the public artwork strip. Admins manage categories through `/api/admin/game-categories`, sponsors through `/api/admin/tournaments/:tournamentId/sponsors`, and verified organization labels through `/api/admin/teams`. Tournament responses retain legacy fields while adding category, organizer, country, location, hero, sponsors, captain/avatar participant data, and a server-derived `challongeEmbedUrl`. Public uploads also use `game-assets/` and `sponsor-logos/` below `UPLOAD_ROOT`.
