# QuestEsports/

## Responsibility

Quest Esports is a tournament, team, commerce, ticketing, media, and event
operations platform. The browser and private admin client call the Express API;
the API owns Prisma/PostgreSQL access and public/private upload boundaries.

## Event integration

Quest Ascension models an event identity with `EventSeries`. A tournament may
refer to it through nullable `Tournament.seriesId`; child tournaments keep
their own registration, capacity, payment, schedule, and bracket lifecycle.
The public event route is
[`frontend/app/tournaments/events/[slug]/page.tsx`](frontend/app/tournaments/events/[slug]/page.tsx),
reached from the merged `/tournaments` listing that carries both event and
tournament cards; the admin workspace is under
[`frontend/app/admin/events`](frontend/app/admin/events).
The API routes and aggregate definitions are mapped in
[`backend/src/modules/series/codemap.md`](backend/src/modules/series/codemap.md).

## Main boundaries

- `backend/` — Express API, domain modules, jobs, uploads, Prisma schema, and
  migrations.
- [`backend/src/modules/support/`](backend/src/modules/support/codemap.md) —
  authenticated support conversations, persisted messages, staff
  assignment/status state, and per-user read cursors.
- `frontend/` — Next.js public pages, account/registration flows, and web admin.
- `mobile-admin/` — private Android operations client.
- `docs/` — API, operational, deployment, recovery, and security contracts.
- `ops/` — production backup, restore, retention, and freshness tooling. The
  canonical backup runs an ephemeral, read-only PostgreSQL 17 client on
  `quest-shared` and verifies the exact Compose database identity before using
  mTLS; production PostgreSQL remains unpublished on the host.
  - `ops/docker/` — immutable production Compose topology and host Nginx
    ingress; PostgreSQL stays private and application publications are
    loopback-only. The frontend joins the internal application network and a
    frontend-only ingress bridge so Docker can implement its loopback port;
    database and shared-service networks remain unavailable to it.
- `ops/deploy/` — root-owned artifact verification, the one-time Supabase
  to PostgreSQL 17 cutover boundary, and digest-only steady-state releases.
  The existing-VPS first Compose adoption is specified in
  `docs/superpowers/specs/2026-09-02-first-compose-adoption-design.md` and
  executed through the gated implementation plan in
  `docs/superpowers/plans/2026-09-02-first-compose-adoption.md`; it must not be
  bootstrapped through the steady-state release command.
  Its pre-cutover candidates use `ops/docker/compose.adoption-candidate.yml`
  and `ops/docker/valorant.adoption-candidate.yml`; those overlays must never
  become the steady-state production topology.
- `ops/rehearsal/` — isolated PostgreSQL 17 restore rehearsal boundary. It may
  invoke the existing destructive restore primitive only through explicit
  disposable-target checks and emits private, machine-readable evidence; it
  never owns production restore or live service cutover.
- `ops/deploy/` — root-owned immutable Compose release, verification, and
  pre/post-commit rollback contracts. It consumes exact image-digest manifests,
  the canonical host lock, and explicit coordinated freeze/read-only and
  release-bound backup-evidence contracts; it does not build images or own the
  sibling repository's release. `ops/deploy/host-hooks.sh` is the single host
  adapter behind every `*_COMMAND`/`*_CHECK` setting: it dispatches on its own
  basename, so `ops/deploy/host-hooks.aliases` is the installation contract and
  `ops/tests/host-hooks.test.sh` pins it against `ops/deploy/release.env.example`.
  Settings the alias list marks unimplemented must stay unset on the host; the
  controller treats them as an incomplete rollback rather than as success.
- `ops/docker/` — immutable production Compose topology, PostgreSQL 17 role/TLS
  bootstrap, VALORANT asyncpg/TLS runtime contract, and durable upload/database
  mount contracts. The production project is fixed as `quest-prod`; its
  pre-created external network is `quest-shared`.

PostgreSQL and uploads are backend/operations concerns. Public event responses
contain only published event and child projections; captain/contact data,
payment evidence, admin holds, and admin notes remain private admin concerns.

The production Compose boundary keeps Quest `public` schema access separate from
the sibling VALORANT `valorant` schema: Quest runtime/migrator and VALORANT
runtime/migrator roles are bootstrapped independently, while PostgreSQL TLS is
validated against the stable `quest-postgres` alias.

## Documentation links

Account support is a persistent desktop/mobile account utility. The root
frontend layout hosts account-scoped unread/draft state through
[`SupportProvider`](frontend/components/support/codemap.md). Contact retains
general enquiries alongside private support, and registration/payment/account
errors provide contextual support entry points. Support and Contact remain
reachable while Discord linking is incomplete.

- [API contracts](docs/api-documentation.md)
- [Admin workflows](docs/admin-operations.md)
- [Commerce and tournament operations](docs/commerce-and-tournament-operations.md)
- [Deployment and rollback](docs/production-runbook.md)


## Account and VALORANT privacy boundary

Quest `OAuthAccount(provider=discord)` owns registration identity. Private session
and profile projections expose read-only ID/display data. Authenticated registration
accepts only PUUID, resolving Discord server-side on every request. The public
leaderboard mapper and Riot-only search remove Discord fields, including legacy
exact-search fallback. Browser CSP uses only the public API origin; server fetches
may use the internal Docker origin. Mobile URI decoding uses a local CommonJS
adapter to the pinned fixed upstream decoder, verified by dependency/native CI.
