# Quest Esports Frontend

This is the public and admin-facing Next.js application for Quest Esports. It renders the marketing site, tournament pages, native bracket views, auth flows, profile UI, admin dashboard, and media views, and it talks to the Express API in `../backend`.

## Requirements

- Node.js 20+
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
- `NEXT_PUBLIC_SITE_URL` is used for metadata, sitemap generation, canonical URLs, and structured data.
- If the backend sends verification, reset, invite, or email-change emails, its `APP_URL` must point to this frontend origin.

## Install And Run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000` by default.

## Main Route Groups

- Public: `/`, `/tournaments`, `/posters`, `/match-videos`, `/rulebook`, `/contact`
- Auth: `/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, `/confirm-email-change`, `/team-invite`
- User: `/profile`
- Admin: `/admin`, `/admin/users`, `/admin/tournaments`, `/admin/registrations`, `/admin/contact-messages`

## Related Backend Endpoints

The frontend expects the backend to expose:

- auth routes under `/api`
- tournament routes under `/api/tournaments` and `/api/tournament-registration`
- native bracket admin routes under `/api/admin/tournaments/:tournamentId/bracket`
- team routes under `/api/teams/profile` and `/api/team-invite`
- media routes under `/api/posters`, `/api/images`, and `/api/uploads/...`

## Build For Production

```bash
npm run lint
npm run build
npm run start
```

## Notes

- This app uses the Next.js App Router.
- Auth is session-cookie based, so frontend requests include `credentials: "include"` when needed.
- Login supports password auth, MFA challenges, and Google/Discord OAuth hand-offs via the backend.
- Admin screens depend on a logged-in user whose backend role is `admin`.
- The public tournament board currently shows prize pool, registration deadline, and tournament start on active tournament cards.
- Tournament detail pages hide empty registered-team and bracket sections; published native brackets render in a compact Challonge-style board.
