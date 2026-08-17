# QuestEsports/

## Responsibility

Quest Esports is a tournament, team, commerce, ticketing, media, and event
operations platform. The browser and private admin client call the Express API;
the API owns Prisma/PostgreSQL access and public/private upload boundaries.

## Event integration

Quest Ascension models an event identity with `EventSeries`. A tournament may
refer to it through nullable `Tournament.seriesId`; child tournaments keep
their own registration, capacity, payment, schedule, and bracket lifecycle.
The public event route is [`frontend/app/events/[slug]/page.tsx`](frontend/app/events/[slug]/page.tsx),
and the admin workspace is under [`frontend/app/admin/events`](frontend/app/admin/events).
The API routes and aggregate definitions are mapped in
[`backend/src/modules/series/codemap.md`](backend/src/modules/series/codemap.md).

## Main boundaries

- `backend/` — Express API, domain modules, jobs, uploads, Prisma schema, and
  migrations.
- `frontend/` — Next.js public pages, account/registration flows, and web admin.
- `mobile-admin/` — private Android operations client.
- `docs/` — API, operational, deployment, recovery, and security contracts.
- `ops/` — production backup, restore, retention, and freshness tooling.

PostgreSQL and uploads are backend/operations concerns. Public event responses
contain only published event and child projections; captain/contact data,
payment evidence, admin holds, and admin notes remain private admin concerns.

## Documentation links

- [API contracts](docs/api-documentation.md)
- [Admin workflows](docs/admin-operations.md)
- [Commerce and tournament operations](docs/commerce-and-tournament-operations.md)
- [Deployment and rollback](docs/production-runbook.md)
