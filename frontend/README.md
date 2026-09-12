# Quest Esports Frontend

Next.js application for the public website, account area, tournament registration, commerce, tickets, and the web admin dashboard. It communicates with the Express API in `../backend`.

## Requirements

- Node.js 24.x (declared in `package.json`)
- A reachable Quest Esports backend

## Setup

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

The app defaults to `http://localhost:3000`.

Local environment values:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SITE_MAINTENANCE_MODE=false
```

`NEXT_PUBLIC_API_URL` must identify the backend origin. `NEXT_PUBLIC_SITE_URL` controls canonical URLs, metadata, structured data, server-rendered API requests, and sitemap generation. Keep maintenance values aligned with the backend; changing server-only values on Vercel requires a new deployment.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm test` | Run Vitest unit tests |
| `npm run build` | Create the production build |
| `npm run start` | Serve the production build |
| `npm run test:e2e` | Run Playwright against an existing build |
| `npm run test:e2e:local` | Build and run the local Playwright journey suite |
| `npm run perf:check` | Measure the production site against performance budgets |

## Route Areas

- Public content: home, tournaments, event series, shop, tickets, posters, gallery, match videos, rulebooks, recruitment, contact, and policies
- Authentication: signup, login, verification, recovery, email change, and team invitations
- Account: profile, sessions, saved teams, registrations, orders, and applications
- Admin: users, tournaments, series, teams, registrations, recruitment, products, orders, payments, tickets, rulebooks, games, and contact messages

Complete backend contracts are in [API Documentation](../docs/api-documentation.md). Use the [Developer Guide](../docs/developer-guide.md) for the contributor workflow, [Environment Reference](../docs/environment-reference.md) for configuration, and [VALORANT Local Development](../docs/valorant-local-development.md) for the optional integration topology.

## Security and Rendering Notes

- Authenticated browser requests include session cookies through `credentials: "include"`.
- Private, checkout, payment, account, and admin pages are excluded from the sitemap and use appropriate `noindex` behavior.
- Order-status capabilities stay in URL fragments and request headers; do not copy those URLs into logs, tickets, or analytics.
- Maintenance mode returns a lightweight, non-cacheable `503` page without auth, analytics, or backend data requests.
- Challonge content is restricted to allowlisted HTTPS sources and falls back to published native bracket data.

See [Authentication Flow](../docs/authentication-flow.md), [Search Console and Sitemap Operations](../docs/search-console-and-sitemap.md), and the [Production Operations Runbook](../docs/production-runbook.md).

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e:local
```

`npm run test:e2e:local` builds with `NEXT_PUBLIC_API_URL=http://127.0.0.1:5011`
and `PLAYWRIGHT_MOCK_API_PORT=5011` before starting the deterministic local mock
API and Playwright. Use direct `npm run test:e2e` only against an existing build
created with those same mock values. Performance-budget overrides require an
approved, recorded reason.


## Production hardening verification

Frontend browser CSP admits only the configured public API origin; internal Docker API addresses are server-only. Unit workers are bounded to one. Run `npm test -- --coverage` using the installed V8 provider, plus lint, typecheck and an HTTPS-configured build. Discord IDs and registration data are private and read-only; the public leaderboard displays and searches the Discord username alongside Riot identity.

Production uses the immutable Compose release; standalone `npm start`, Vercel and PM2 instructions apply only to development or historical deployments.

The initial V8 gate is based on the measured full-suite baseline: lines 60%,
statements 55%, functions 45%, branches 45%. The earlier proposed 50% function/branch
and 60% statement targets were never verified and exceeded existing suite coverage.
Raise these floors as behavioral coverage grows; do not exclude application files
merely to meet a target.
