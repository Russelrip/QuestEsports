# Quest Esports

Quest Esports is a full-stack esports platform for publishing tournaments, registering teams, managing community communications, and curating poster/media content. The repository contains a public-facing Next.js application and an Express + Prisma API that powers authentication, tournament operations, admin tooling, security workflows, and media management.

## Quick Start

This repository does not have a single root `npm run dev` command. Run the backend and frontend separately.

### Requirements

- Node.js 24 LTS
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
REQUIRE_API_ORIGIN=false
JOB_WORKER_ENABLED=true
COMMERCE_MAINTENANCE_ENABLED=true
JOB_WORKER_POLL_MS=5000
JOB_WORKER_MAX_ATTEMPTS=5
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

Frontend: create `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Notes:

- `DATABASE_URL`, `DIRECT_URL`, and `SESSION_COOKIE_NAME` are required for the backend to boot.
- `DIRECT_URL` may use a direct PostgreSQL endpoint when the host supports IPv6. On the current IPv4 VPS, both URLs use Supabase Supavisor session mode on port `5432`; do not use transaction mode for Prisma migrations.
- `NEXT_PUBLIC_API_URL` must point at the backend origin.
- `NEXT_PUBLIC_SITE_URL` powers metadata, sitemap, canonical URLs, and structured data.
- Mail delivery is optional for local development. Use `MAIL_PROVIDER=resend` with a Resend API key, or leave `MAIL_DELIVERY_REQUIRED` blank/false when delivery is absent. Production requires complete settings for the selected provider.
- OAuth is optional. If you enable Google or Discord login, use real client credentials and register the callback URLs shown above. Do not leave placeholder values like `your_google_client_id`.
- Paid tournament registration and shop checkout require PayHere credentials plus a publicly reachable HTTPS notification URL. Browser return pages never mark an order paid.
- When PayHere is not configured, free and bank-transfer tournament registrations remain available; PayHere registration and merchandise checkout are disabled.
- `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` are optional locally and required in production; point both at durable, backed-up storage outside disposable release directories. Private payment proofs must never be exposed by Nginx.

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

- [Full Site Audit Checklist](./docs/full-site-audit-checklist.md)
- [Current Audit and Remediation Status](./docs/project-audit-status.md)
- [API Documentation](./docs/api-documentation.md)
- [Admin Operations](./docs/admin-operations.md)
- [Authentication Flow](./docs/authentication-flow.md)
- [CI/CD Pipeline](./docs/ci-cd.md)
- [Database and Storage](./docs/database-and-storage.md)
- [Email System](./docs/email-system.md)
- [Google Search Console and Sitemap Operations](./docs/search-console-and-sitemap.md)
- [Setup and Deployment Guide](./docs/setup-and-deployment.md)
- [Production Operations Runbook](./docs/production-runbook.md)
- [Commerce and Tournament Rollout](./docs/commerce-and-tournament-rollout.md)
- [Backend README](./backend/README.md)
- [Frontend README](./frontend/README.md)

## Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS v4
- Backend: Express 5, Prisma ORM, PostgreSQL
- Auth: Cookie-based sessions with server-side session storage
- Brackets: `brackets-manager` with Prisma-persisted native bracket data
- Admin exports: ExcelJS-generated `.xlsx` downloads
- Uploads: Multer, durable public storage, and isolated private payment evidence
- Email: Nodemailer with selectable Resend or generic SMTP delivery

## What The Platform Includes

### Public product features

- Marketing homepage and brand sections
- Tournament listing and tournament detail pages
- Event-series pages, image-led game navigation, public schedules, participants, rules, and published brackets
- Tournament listing cards with prize pool, registration deadline, and tournament start summaries
- Tournament detail pages with native tournament metadata, rulebook link, registered-team cards, and published bracket boards
- Tournament schedule data parsed from uploaded XLSX or CSV files for admin/event workflows
- Completed-tournament showcase sections with official poster plus 1st, 2nd, and 3rd place visuals
- Public tournament team lists with approved registered teams, team logos, short codes, and member counts
- Native double-elimination bracket viewing when an admin publishes bracket data
- Slug-bound configurable solo/team registration with free, PayHere, or tiered bank-transfer fees
- Merchandise catalogue, product variants, cart, guest/member checkout, delivery fee, and order status
- Join Quest recruitment application flow for solo players, complete teams, and incomplete teams
- Email verification, login, logout, password reset, and email change flows
- MFA setup, MFA login challenge, backup codes, session management, and Google/Discord OAuth sign-in
- Posters gallery and match-video archive
- Rulebook and contact pages
- Player dashboard with avatars, current/past registrations, visual teams, and order history
- Privacy, terms, and refund/return policy pages

### Admin features

- Dashboard summary cards
- User management
- Tournament creation and editing
- Tournament asset management for banners, schedules, and completed-event showcase images
- Native bracket generation from approved teams, match-result updates, and publish/unpublish controls
- Registration review, status management, deletion, and filtered Excel export
- Recruitment application review, status management, deletion, and filtered Excel export
- Contact inbox moderation
- Poster/image asset management
- Event-series, products, orders, and payment reconciliation management
- Legacy poster import and image migration utilities

## Repository Structure

```text
QuestEsports/
|-- README.md
|-- docs/
|   |-- admin-operations.md
|   |-- api-documentation.md
|   |-- authentication-flow.md
|   |-- ci-cd.md
|   |-- commerce-and-tournament-rollout.md
|   |-- database-and-storage.md
|   |-- email-system.md
|   |-- project-audit-status.md
|   |-- production-runbook.md
|   `-- setup-and-deployment.md
|-- ops/
|   |-- backup-production.sh
|   |-- restore-production-backup.sh
|   `-- systemd/
|-- backend/
|   |-- README.md
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
- Public uploads are written below `UPLOAD_ROOT` (locally `backend/uploads/`); bank-transfer evidence is isolated below `PRIVATE_UPLOAD_ROOT` and never publicly served.
- Native bracket data is generated with `brackets-manager`, exported as JSON, and persisted in PostgreSQL through the `tournament_brackets` table.
- Poster/image metadata is stored in PostgreSQL. Poster assets support filesystem-backed storage with a database binary fallback for older records.
- Transactional emails and failed upload cleanup operations are persisted as background jobs. At least one worker-enabled backend instance must remain active so mail and privacy-sensitive file cleanup retries are processed.
- Email action flows generate cryptographically random tokens, store only token hashes in the database, and send links that point to the frontend origin configured by `APP_URL`.

## Main Data Domains

- `User`, `Session`, `VerificationToken`, `PasswordResetToken`, `EmailChangeToken`
- `EventSeries`, `Tournament`, `TournamentBracket`, `TeamRegistration`, `RegistrationMember`, `PaymentTransaction`, `BankTransferProof`, `PaymentNotificationAudit`
- `Product`, `ProductVariant`, `ProductImage`, `MerchandiseOrder`, `MerchandiseOrderItem`
- `SavedTeam`, `SavedTeamMember`
- `ContactSubmission`
- `ImageAsset`, `Poster`
- `BackgroundJob`

## Frontend Routes

### Public indexable routes

- `/`
- `/tournaments`
- `/tournaments/[slug]`
- `/tournaments/series/[slug]`
- `/shop`, `/shop/[slug]`
- `/refund-policy`
- `/privacy-policy`, `/terms-of-service`
- `/join`
- `/gallery`, `/match-videos`
- `/members`
- `/rulebooks/[slug]`
- `/contact`

`/posters` redirects to `/gallery`, and `/rulebook` redirects to `/tournaments`; redirects are not included in the sitemap.

### Public functional routes (`noindex` where applicable)

- `/tournaments/[slug]/register`
- `/tournaments/[slug]/payment`
- `/shop/cart`, `/shop/order/[token]`
- `/registration`
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
- `/admin/event-series`
- `/admin/products`
- `/admin/orders`
- `/admin/payments`
- `/admin/registrations`
- `/admin/recruitment`
- `/admin/rulebooks`
- `/admin/contact-messages`

## API Surface

The backend exposes these main route groups:

- Auth: `/api/signup`, `/api/login`, `/api/login/mfa`, OAuth start/callback routes, `/api/logout`, `/api/me`, verification, email-change, password-reset, MFA, and session endpoints
- Public tournaments: `/api/tournaments`, `/api/tournaments/:slug`
- Event series: `/api/event-series`, `/api/event-series/:slug`
- Tournament registration: `/api/tournaments/:slug/registration-status`, `/api/tournaments/:slug/registrations`
- Shop: `/api/products`, `/api/products/:slug`, `/api/orders`, `/api/orders/:publicToken`
- Payments: `/api/payments/payhere/notify`, `/api/payments/:orderId`, `/api/payments/:orderId/bank-transfer-proof`
- Account: `/api/me/dashboard`, `/api/me/avatar`
- Recruitment applications: `/api/recruitment-applications`
- Teams: `/api/teams`, `/api/teams/:teamId`, `/api/teams/profile`, `/api/team-invite`, `/api/team-invite/respond`
- Contact: `/api/contact`
- Media: `/api/posters`, `/api/images`, `/api/uploads/...`
- Admin: `/api/admin/...`
- Admin registration/recruitment exports: `/api/admin/team-registrations/export`, `/api/admin/recruitment-applications/export`
- Admin native brackets: `/api/admin/tournaments/:tournamentId/bracket`, `/generate`, `/matches/:matchId`, and `/publish`

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
REQUIRE_API_ORIGIN=false
JOB_WORKER_ENABLED=true
JOB_WORKER_POLL_MS=5000
JOB_WORKER_MAX_ATTEMPTS=5
MAIL_PROVIDER=resend
RESEND_API_KEY=
MAIL_DELIVERY_REQUIRED=
MAIL_FROM=
# Used only when MAIL_PROVIDER=smtp (for example, Amazon SES):
# SMTP_HOST=email-smtp.ap-northeast-1.amazonaws.com
# SMTP_PORT=587
# SMTP_USER=your_ses_smtp_username
# SMTP_PASS=your_ses_smtp_password
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
- Set `REQUIRE_API_ORIGIN=true` in production to reject API requests unless the request `Origin` or `Referer` matches `CORS_ORIGIN`.
- `APP_URL` must point at the frontend origin used in verification, password reset, email-change, invite, and security-alert emails when mail delivery is enabled.
- Use `MAIL_PROVIDER=resend` with `RESEND_API_KEY` now. Production refuses to start unless `MAIL_DELIVERY_REQUIRED=true` and the selected provider configuration is complete.
- `JOB_WORKER_ENABLED` must be enabled on at least one backend instance for queued email delivery.
- To return to Amazon SES later, set `MAIL_PROVIDER=smtp` and provide the SES `SMTP_*` values; no code change is needed. `npm run mail:verify` checks connection/auth from `backend/.env` without sending an email.
- See [Email System](./docs/email-system.md) for every recipient, trigger, subject, link, token lifetime, and retry rule.
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
- Recruitment applications require a logged-in user with a verified email address.
- Team invite responses require a logged-in, verified account whose email matches the invitation. Accepted teams appear on both the captain's and accepted members' profiles.
- Admin tournament management supports spreadsheet uploads for schedules, showcase-image uploads for completed events, and native bracket generation from approved teams.
- Admin registration deletion removes the tournament registration source-of-truth row; saved reusable team rosters can remain for profile reuse. Captains cannot delete a saved team while it has a tournament registration.
- Admin registration and recruitment pages can download filtered `.xlsx` exports generated on demand by the backend.
- Public tournament responses now include `displayPriority`, `registrationOpenAt`, `scheduleData`, `isCompleted`, `showcase`, published bracket data, bracket summaries, and per-tournament `registeredTeams` on detail pages.
- Direct imports that touch backend config now load `.env` automatically, so scripts and one-off Node entrypoints behave the same as `node src/server.js`.
- Public tournament detail responses include approved team names, public team-logo URLs, short codes, member counts, and statuses.
- Native brackets remain hidden from public responses until an admin publishes the bracket.
- The built-in `/api/openapi.json` file is a partial contract, not a full generated spec.
- The backend includes a Node test suite under `backend/tests`.
- The frontend generates `/sitemap.xml` from canonical public routes, published tournaments/event series/rulebooks, and active products. `/robots.txt` advertises it; operational steps are in [Google Search Console and Sitemap Operations](./docs/search-console-and-sitemap.md).
- Session/auth lifecycle behavior has dedicated unit coverage for session rehydration, throttled `lastSeenAt` writes, expired-session handling, and active-session listing.
- Native bracket generation and score advancement have backend unit coverage.
- There is currently no admin seed/bootstrap script beyond creating a user and promoting it through Prisma Studio.
- The built-in database-backed email worker is suitable for low-volume transactional mail; use a dedicated worker or external queue before scaling email workloads substantially.

## Verification Commands

Frontend:

```bash
cd frontend
npm run lint
npm test
npm run build
npm run test:e2e
```

Backend:

```bash
cd backend
npm run prisma:generate
npm test
node src/server.js
```

## Testing

Backend tests use Node's built-in test runner and live in `backend/tests`.

- Run all backend unit tests: `cd backend && npm test`
- Run one file: `cd backend && node --test tests/session.service.test.js`
- Existing coverage focuses on backend behavior that benefits from deterministic unit testing, including jobs, observability, rate limiting, team helpers, tournament registration, recruitment validation, admin Excel exports, admin deletion workflows, and session/auth lifecycle logic.

Frontend verification includes unit tests, lint, a production build, and Playwright critical journeys:

- `cd frontend && npm run lint`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run test:e2e`

## Recommended Next Steps

- Read [Setup and Deployment Guide](./docs/setup-and-deployment.md) before standing up a production environment.
- Use the [Production Operations Runbook](./docs/production-runbook.md) for the current Quest VPS, GitHub Actions, PM2, backup, reboot, and incident procedures.
- Production backups use `ops/backup-production.sh` plus the systemd timer templates in `ops/systemd/`; restores use the explicitly guarded `ops/restore-production-backup.sh` on an isolated recovery host.
- Read [Authentication Flow](./docs/authentication-flow.md) before changing session or authentication logic.
- Read [Admin Operations](./docs/admin-operations.md) before changing registration, recruitment, export, or admin deletion behavior.
- Read [Email System](./docs/email-system.md) before changing email templates, triggers, tokens, provider settings, or queue behavior.
- Read [Database and Storage](./docs/database-and-storage.md) before touching uploads, Prisma schema, or media migration scripts.
- Run `cd backend && npm run prisma:security:verify` after migrations to confirm RLS is enabled and unused Supabase Data API roles have no public-table privileges.
- Use [Google Search Console and Sitemap Operations](./docs/search-console-and-sitemap.md) when changing public routes, canonical metadata, crawler rules, or sitemap submission state.

## Website Change Upgrade

The tournament experience now uses admin-managed game categories, 4:3 whole-card listings, event metadata, hero artwork, ordered sponsors, verified team organizations, and privacy-safe team/solo participants. Tournament brackets prefer a validated HTTPS Challonge module and fall back to the published native bracket. Admin content is managed from `/admin/games`, `/admin/teams`, and the tournament editor. Persistent upload backups must include `game-assets/` and `sponsor-logos/`.
