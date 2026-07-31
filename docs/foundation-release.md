# Foundation Release Operations

This release adds normalized matches, contextual tournament staff, versioned public APIs, SSE invalidations, and optional server-only Challonge synchronization. It is additive: legacy `/api` routes, native brackets, authentication, uploads, store orders, and PayHere continue unchanged.

## Configuration

Keep Challonge disabled for the migration and first application deployment:

```env
CHALLONGE_ENABLED=false
CHALLONGE_USERNAME=
CHALLONGE_API_KEY=
CHALLONGE_REQUEST_TIMEOUT_MS=8000
CHALLONGE_DEFAULT_SYNC_MINUTES=5
CHALLONGE_SYNC_LEASE_SECONDS=90
REALTIME_SSE_ENABLED=true
```

The adapter always calls the hard-coded `https://api.challonge.com/v1` host and sends credentials in an HTTP Basic `Authorization` header. Credentials must not be placed in a tournament URL, logs, frontend environment, or browser bundle. Username and API key must be configured together before enabling the integration.

## Deployment order

1. Back up PostgreSQL and the public/private upload roots.
2. Deploy `20260731100000_add_foundation_live_matches_and_challonge` with `npm run prisma:migrate:deploy`. It creates only new tables, enums, indexes, and foreign keys. Existing valid Challonge links are backfilled as disabled integrations.
3. Deploy the backend with Challonge disabled. Verify health/readiness, authentication, an existing upload, a legacy tournament, a native bracket, a store quote, and OpenAPI.
4. Verify `GET /api/v1/home`, `/api/v1/matches`, and an SSE connection to `/api/v1/events`. Polling remains authoritative if SSE is disabled or interrupted.
5. Deploy the frontend. Confirm homepage order, profile layout at supported narrow widths, tournament schedule, bracket retry state, and every icon URL.
6. Configure real credentials, restart the API, and manually synchronize one non-production tournament. Compare participants, rounds, scores, winners, and completion state against Challonge.
7. Confirm each proposed participant mapping manually. Name equality alone never grants access. Enable five-minute synchronization only after review.
8. Restrict one-minute mode to an active tournament after confirming the available API allowance.

Completed tournaments stop scheduling. Failed requests retain the last successful snapshot; `429` responses honor `Retry-After`, and other transient failures use configured backoff. A transactional lease prevents scheduled and manual synchronization from overlapping.

## Ownership and permissions

- Challonge owns linked participants, rounds, upstream match state, scores, and winners.
- Quest owns estimates, delay/pause state, station, check-in and veto times, staff assignment, and local notes.
- Enabling a link hides the native public bracket but never deletes or overwrites it.
- Existing `admin` users are super admins. Tournament administrators and referees are explicit assignments. Captain identity comes from saved team/registration ownership. Privileged checks execute in the API.

## Monitoring and rollback

Monitor sync success/error rate, duration, last-success age, queued retries, SSE connections, and match endpoint latency. Logs expose identifiers and safe error codes but never credentials or upstream response bodies.

Rollback does not require reversing the migration. Disable Challonge and SSE, stop the new scheduler/job type, and route the frontend back to legacy pages if necessary. Keep the new tables for diagnosis/export. Remove them only in a separately reviewed migration after export and approval.

## Icon and search verification

After deployment, request `/favicon.ico`, `/favicon-16.png`, `/favicon-32.png`, `/favicon-48.png`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, and `/manifest.webmanifest` directly and confirm HTTP 200 responses. Check browser tabs and installed-site metadata on desktop and mobile.

In Google Search Console, inspect the canonical homepage and request indexing after the icon URLs are live. Resubmit the existing sitemap if needed and monitor crawl status. Search-result changes depend on Google recrawling and are not immediate.

## Verification commands

```bash
cd backend
npm run lint
npm test
npm run test:coverage
npx prisma validate
npm run prisma:migrations:check-pending

cd ../frontend
npm run lint
npm test
npm run build
npm run test:e2e
```
