# Quest Esports Frontend

This is the public and admin-facing Next.js application for Quest Esports. It renders the marketing site, tournament pages, native bracket views, auth flows, profile UI, admin dashboard, and media views, and it talks to the Express API in `../backend`.

## Requirements

- Node.js 24 LTS
- A running backend API

## Environment Variables

Create `frontend/.env.local`.

Local development example:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Production example:

```env
NEXT_PUBLIC_API_URL=https://api.questesports.lk
NEXT_PUBLIC_SITE_URL=https://questesports.lk
```

Notes:

- `NEXT_PUBLIC_API_URL` must match the backend origin.
- `NEXT_PUBLIC_SITE_URL` is used for metadata, sitemap generation, canonical URLs, structured data, and server-rendered API requests when backend origin enforcement is enabled.
- If the backend sends verification, reset, invite, or email-change emails, its `APP_URL` must point to this frontend origin.

## Install And Run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000` by default.

## Main Route Groups

- Public: `/`, `/tournaments`, `/tournaments/series/[slug]`, `/tournaments/[slug]`, `/tournaments/[slug]/register`, `/shop`, `/shop/[slug]`, `/registration`, `/join`, `/posters`, `/gallery`, `/match-videos`, `/rulebook`, `/rulebooks/[slug]`, `/contact`, and the policy pages
- Auth: `/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, `/confirm-email-change`, `/team-invite`
- User: `/profile`
- Admin: `/admin`, `/admin/users`, `/admin/tournaments`, `/admin/event-series`, `/admin/registrations`, `/admin/recruitment`, `/admin/rulebooks`, `/admin/products`, `/admin/orders`, `/admin/payments`, and `/admin/contact-messages`

## Related Backend Endpoints

The frontend expects the backend to expose:

- auth routes under `/api`
- account dashboard/avatar routes under `/api/me`
- event-series routes under `/api/event-series`
- tournament routes under `/api/tournaments`, including slug-bound registration
- product/order/payment routes under `/api/products`, `/api/orders`, `/api/payments`, and `/api/commerce/capabilities`
- recruitment submission routes under `/api/recruitment-applications`
- native bracket admin routes under `/api/admin/tournaments/:tournamentId/bracket`
- admin registration/recruitment list, delete, status, and export routes under `/api/admin`
- team routes under `/api/teams/profile` and `/api/team-invite`
- media routes under `/api/posters`, `/api/images`, and `/api/uploads/...`

## Build For Production

```bash
npm run lint
npm run build
npm run test:e2e
npm run start
```

## Notes

- This app uses the Next.js App Router.
- Auth is session-cookie based, so frontend requests include `credentials: "include"` when needed.
- Login supports password auth, MFA challenges, and Google/Discord OAuth hand-offs via the backend.
- Admin screens depend on a logged-in user whose backend role is `admin`.
- Admin registration and recruitment pages can delete rows and download the currently filtered results as Excel files.
- Registration status in the tournament registration UI is rechecked against the backend; stale local browser markers are cleared when the backend says the user is not registered.
- The public tournament board currently shows prize pool, registration deadline, and tournament start on active tournament cards.
- Tournament detail pages hide empty registered-team and bracket sections; published native brackets render in a compact Challonge-style board.
- Playwright critical journeys live under `frontend/tests/e2e` and run in CI after the production build.

The public tournament board now hides completed events, filters tournaments and event series through admin-managed game categories, and uses 4:3 whole-card navigation with red closed/full styling. Detail pages include the full hero, sponsors, corrected participants, and Challonge-first/native-fallback brackets. `/admin/games` manages category art, `/admin/teams` verifies organization labels, and the tournament editor manages metadata, hero artwork, a PUBG Mobile preset, and sponsors.
