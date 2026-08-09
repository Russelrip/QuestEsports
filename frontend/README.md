# Quest Esports Frontend

Next.js application for the public website, account area, tournament registration, commerce, tickets, and the web admin dashboard. It communicates with the Express API in `../backend`.

## Requirements

- Node.js 24 LTS
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

Complete backend contracts are in [API Documentation](../docs/api-documentation.md).

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
npm run build
npm run test:e2e
```

Playwright uses a deterministic local mock API and capped worker counts for stable critical journeys. Performance-budget overrides require an approved, recorded reason.
