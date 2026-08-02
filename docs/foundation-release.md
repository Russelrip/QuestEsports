# Foundation Release Operations

This release adds normalized matches, contextual tournament staff, versioned public APIs, SSE invalidations, and an optional Challonge integration. Public visitors see Challonge's public module; authenticated admins can perform deliberate v2.1 writes from Quest. It is additive: legacy `/api` routes, native brackets, authentication, uploads, store orders, and PayHere continue unchanged.

## Configuration

Keep Challonge disabled for the migration and first application deployment:

```env
CHALLONGE_ENABLED=false
CHALLONGE_AUTOMATIC_SYNC_ENABLED=false
CHALLONGE_CLIENT_ID=
CHALLONGE_CLIENT_SECRET=
CHALLONGE_OAUTH_SCOPE=application:manage
CHALLONGE_TOKEN_URL=https://api.challonge.com/oauth/token
CHALLONGE_BASE_URL=https://api.challonge.com/v2.1
CHALLONGE_BRACKET_CACHE_SECONDS=30
CHALLONGE_REQUEST_TIMEOUT_MS=8000
CHALLONGE_DEFAULT_SYNC_MINUTES=5
CHALLONGE_SYNC_LEASE_SECONDS=90
REALTIME_SSE_ENABLED=true
```

The adapter uses Challonge v2.1's server-side client-credentials flow. It sends the client ID and secret only in the form-encoded body of a POST to `CHALLONGE_TOKEN_URL`, keeps the returned short-lived access token in backend process memory, and calls application-scoped resources with a Bearer token and `Authorization-Type: v2`. Credentials and tokens must not be placed in a tournament URL, logs, frontend environment, API response, or browser bundle.

Keep `CHALLONGE_AUTOMATIC_SYNC_ENABLED=false` for the 500-request plan. Public bracket views use the lazy Challonge module and consume no Quest REST synchronization requests. An admin editor load deliberately uses three resource requests (tournament, participants, and matches); the first load from a URL identifier uses one additional lookup, so prefer the numeric Challonge tournament ID. Participant, match-result, and tournament-state changes use one resource request each. The automatic scheduler remains available only behind the separate global switch for a future higher allowance.

Create an application in the Challonge Developer Portal and copy its client ID and client secret into the backend environment. A tournament must be associated with that application in Challonge's **Challonge Connect** tournament setting before a client-credentials token can synchronize it. Numeric tournament IDs work directly; Challonge URLs are resolved against the application's tournament list.

## Deployment order

1. Back up PostgreSQL and the public/private upload roots.
2. Run `npm run prisma:migrate:deploy`. This applies the additive foundation migration and `20260801120000_complete_challonge_integration`; existing valid Challonge links are retained, legacy interval settings are normalized, and no native bracket or tournament tables are removed.
3. Deploy the backend with Challonge disabled. Verify health/readiness, authentication, an existing upload, a legacy tournament, a native bracket, a store quote, and OpenAPI.
4. Verify `GET /api/v1/home`, `/api/v1/matches`, and an SSE connection to `/api/v1/events`. Polling remains authoritative if SSE is disabled or interrupted.
5. Deploy the frontend. Confirm homepage order, profile layout at supported narrow widths, tournament schedule, bracket retry state, and every icon URL.
6. Configure real application credentials, restart the API, associate one non-production tournament with the application in Challonge Connect, save its numeric ID or public URL in Quest, and load current editor data once.
7. Verify that the public Bracket tab creates no iframe before activation, then lazy-loads only the allowlisted public Challonge module. Verify participant, match-result, and state changes against the Challonge dashboard.
8. Leave automatic synchronization disabled on the 500-request plan. Enable it only after increasing the API allowance and reviewing the monthly request budget.

If automatic synchronization is explicitly enabled later, completed tournaments stop scheduling. Failed reads retain the last successful editor snapshot; `429` responses honor `Retry-After`, and other transient failures use configured backoff. A transactional lease prevents scheduled and manual synchronization from overlapping.

## Ownership and permissions

- Challonge owns linked participants, rounds, upstream match state, scores, and winners.
- Quest owns estimates, delay/pause state, station, check-in and veto times, staff assignment, and local notes.
- Enabling a link displays the public Challonge module but never deletes or overwrites the native bracket.
- Existing `admin` users are super admins. Tournament administrators and referees are explicit assignments. Captain identity comes from saved team/registration ownership. Privileged checks execute in the API.

## Monitoring and rollback

Monitor admin write failures, manual-load usage, rate limits, SSE connections, and match endpoint latency. Sync logs and audit logs expose identifiers and safe error codes but never credentials or upstream response bodies.

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
npm run prisma:generate
npm run prisma:migrations:check-pending

cd ../frontend
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```
