# Quest Ascension Event Extension Design

**Date:** 2026-08-17
**Status:** Approved for specification review
**Scope:** Add Quest Ascension as a multi-game event without replacing the existing tournament platform.

## Context and constraints

Quest Esports already has the required parent-child relationship:

```text
EventSeries → Tournament → TeamRegistration → RegistrationMember
```

`Tournament.seriesId` is nullable and uses `onDelete: SetNull`, so standalone tournaments already work independently of a series. The platform also has a separate `TicketEvent` model connected to `EventSeries`; that ticketing domain must not be conflated with tournament registration.

The implementation must be additive and backwards compatible:

- Existing tournament URLs, APIs, authentication, registrations, payments, brackets, matches, uploads, and admin workflows remain valid.
- Existing standalone tournaments keep `seriesId = NULL`.
- No production data reset, table replacement, destructive migration, or cascade deletion of child tournaments is allowed.
- Existing payment, capacity, invitation, roster, and bracket services remain authoritative.

## Chosen architecture

### Event parent

Use `EventSeries` as the Event parent. Do not introduce a second generic `Event` table.

The existing series identity and child relationship remain canonical:

```text
EventSeries (Quest Ascension 2026)
  ├── Tournament (VALORANT)
  ├── Tournament (COD Mobile)
  ├── Tournament (Mobile Legends: Bang Bang)
  └── Tournament (PUBG Mobile)
```

The existing `/tournaments/series/[slug]` route and `/event-series` API remain supported. A new `/events/[slug]` presentation route and event-named API aliases provide the requested product language without breaking existing links.

### Event-owned responsibilities

The extended `EventSeries` owns shared branding, event metadata, publication, ordering, and aggregation:

- title, short name, subtitle, short/full description;
- hero and optional banner media;
- event dates and event-level registration window;
- venue, location, country, organizer, website, and Discord links;
- featured/publication state;
- derived event status and registration availability;
- child tournament display order and event-level aggregate read models.

The Event does **not** own brackets, matches, rosters, fees, slot limits, payment transactions, game rules, or registration records. Those remain on `Tournament` and its existing related services.

### Tournament-owned responsibilities

Each child tournament continues to independently define:

- game/category, format, platform, rules, dates, and status;
- team/solo entry type and roster limits;
- substitutes, coaches, configured registration fields;
- maximum teams, fees, payment method, and reservation behavior;
- registration availability overrides;
- brackets, matches, schedules, results, sponsors, and media.

The normal Tournament editor and service remain the source of truth. Event admin supplies only the parent relation and display order, then delegates the remaining fields to existing tournament CRUD.

## Additive persistence changes

Extend `EventSeries` with nullable/defaulted fields following the existing Prisma naming conventions. Existing columns remain unchanged.

Planned fields:

- `shortName`, `subtitle`, `shortDescription`;
- `bannerImageName` (the existing `heroImageName` remains valid as the hero fallback);
- `startDate`, `endDate`, `registrationOpenAt`, `registrationCloseAt`;
- `venue`, `location`, `country`, `organizer`, `websiteUrl`, `discordUrl`;
- `featured` with a safe default of `false`;
- an explicit registration availability override, nullable by default;
- event lifecycle status is derived from publication, configured dates, and visible child tournament states; no second mutable event-status enum is added in the first implementation.

Existing `isPublished` remains the visibility control for compatibility. Draft child tournaments remain hidden by the existing child publication predicate.

Add indexes needed by public/admin list queries, such as publication/status/date/order combinations, without changing existing indexes unnecessarily.

Add the minimum additive waitlist fields required by Quest Ascension:

- `Tournament.waitlistEnabled` defaulting to `false`;
- a `waitlisted` `TeamRegistrationStatus` value;
- nullable `TeamRegistration.waitlistPosition` with a tournament/position index.

Existing `pending`, `approved`, and `rejected` values remain valid. `pending` continues to mean pending review in the UI; payment remains separately represented by `unpaid`, `pending`, and `paid`.

Use the existing `AuditLog` for administrative status transitions, recording the actor, target registration, prior status, next status, and reason in the existing before/after fields. Do not add a duplicate history table.

Add a nullable unique `publicReference` field to `TeamRegistration`. New registrations receive a readable reference code; historical rows use a stable fallback derived from their existing identifier until edited. This must not make existing rows invalid.

The migration is one additive Prisma migration. It must be tested against a database containing existing standalone tournaments and registrations. Event deletion must archive/unpublish or reject deletion when child tournaments exist; it must never cascade-delete them.

## Backend API and service design

### Reused routes

Keep all existing routes unchanged, including:

- `GET /api/event-series`;
- `GET /api/event-series/:slug`;
- `GET /api/admin/event-series` and its existing CRUD;
- all `/api/tournaments/*` and `/api/admin/tournaments/*` routes;
- all tournament registration, payment, bracket, and match routes.

The existing series controller/service remains the implementation boundary and gains event-oriented methods or aliases rather than a parallel subsystem.

### Event read APIs

Add these event-named aliases following the current Express route, response-envelope, cache, and authorization conventions:

- `GET /api/events` — published event list;
- `GET /api/events/:slug` — published event detail and child summaries;
- `GET /api/admin/events` — admin event list;
- `POST /api/admin/events` and `PATCH /api/admin/events/:eventId` — event create/update;
- `POST /api/admin/events/:eventId/archive` — guarded archive/unpublish;
- `POST /api/admin/events/:eventId/tournaments` — create/attach through the existing tournament service with the parent preselected;
- `GET /api/admin/events/:eventId/registrations` — server-side game, status, search, sorting, and pagination filters.

These aliases are registered through the current `/api` composition; both old series and new event routes map to the same service/read model.

### Public read model

The public event response includes only published event fields, published child tournament summaries, safe aggregate counts, derived registration state, and public media. It must not include captain contact data, player emails/phones, payment evidence, admin notes, private IDs, or unpublished registrations.

For each visible child tournament, expose the existing mapped tournament data plus the fields needed by the event card/row: game/category, format, registration state, active capacity, maximum teams, fee presentation, closing date, artwork, and normal tournament URL.

### Aggregation

Create one event aggregation path used by hero counters, statistics, event cards, and admin overview:

- **Games:** count visible child tournaments;
- **Teams registered:** count using the same active-registration predicate used by tournament capacity/public counts;
- **Players registered:** count active registration members with player/captain/substitute roles, excluding coaches;
- **Available slots:** sum child `maxTeams - capacityUsed` for visible child tournaments, never below zero;
- **Overall registration state:** open if any visible child can accept registration, otherwise closed/upcoming/completed according to dates and child status.

Use Prisma aggregate/group queries and existing count includes. Do not load every registration into memory solely to calculate counters.

### Registration state

Centralize child CTA state in a reusable service/helper with these inputs:

- tournament status and publication;
- registration open/deadline times;
- registration override;
- active capacity and waitlist configuration;
- current-user registration status when authenticated.

The backend independently validates every registration submission. Frontend state is presentation only.

Existing serializable transactions, bounded retries, reservation expiry, payment rechecks, and slot allocation remain in force. A race for the final slot results in one accepted registration and either a waitlisted or slots-full response for the other.

## Public web experience

### Routes and discovery

Add `frontend/app/events/[slug]/page.tsx` using the existing route metadata, API fetch, 404, error, cache, and `PageTransition` conventions. Preserve `frontend/app/tournaments/series/[slug]/page.tsx` and have both routes render the shared event read model.

Update the existing tournaments catalogue so a published multi-tournament EventSeries is shown as one event card rather than four duplicate child cards. Standalone tournaments remain unchanged. Existing game filtering continues to include an event when one of its child tournaments matches.

Add event sitemap/metadata/canonical/OpenGraph support using the existing SEO helpers. The canonical Quest Ascension title is `Quest Ascension 2026 | Quest Esports`.

### Event page

Build focused components under `frontend/components/tournaments` or a dedicated event subfolder, reusing current UI primitives and design tokens:

1. Hero with event artwork, title, subtitle, status badge, countdown, and aggregate team count.
2. Event navigation showing only sections with content; Overview and Games are mandatory initially.
3. About section with visual on the left and event metadata on the right, stacking on mobile.
4. Aggregate statistics for games, teams, players, and slots.
5. Game filter controls for All Games and visible child categories.
6. Desktop tournament rows with game, format, status, teams, closing date, fee, and action.
7. Mobile tournament cards rather than a compressed desktop table.
8. Loading skeletons, empty states, image fallbacks, error messages, visible focus states, semantic headings, labels, and reduced-motion behavior.

Child actions link to the existing tournament detail and registration/payment routes. Existing registration-status behavior determines whether the action is Register, View, Payment, Slots Full, Waitlist, or Closed.

## Admin experience

Preserve the current AdminShell/AdminGuard/requireAdmin boundary and existing `/admin/event-series` page. Add event-oriented navigation/routes without removing the old route.

### Event management

The event editor reuses the current upload subsystem and supports:

- title/slug/short name/subtitle/descriptions;
- hero/banner media;
- dates and registration window;
- venue/location/country/organizer/links;
- publication, featured, ordering, and registration override.

Event deletion is replaced by archive/unpublish or a guarded refusal when children exist.

### Child tournaments

The event dashboard provides Overview, Tournaments, Registrations, and Settings views. “Add game” opens the existing Tournament editor with the event preselected. “Attach existing” updates only the nullable series relation after validating the target and preserving existing tournament settings.

The event overview shows aggregate games, registrations, confirmed/payment state where already modeled, pending, waitlisted, and player totals. Per-game rows show child-specific capacity and status, not event-wide limits.

### Event registrations

Reuse the existing admin registration service, details view, status/payment controls, exports, and responsive table/card patterns. Add event/game filters as query parameters or an event-scoped endpoint. Search is server-side and paginated. Existing admin authorization remains authoritative; no client-only admin checks are introduced.

## Registration and account integration

The current tournament registration route and form remain the only submission flow. Event context is added to breadcrumbs, review/confirmation summaries, registration detail cards, and existing account “my registrations” data where those views already render tournament identity.

The existing configurable registration-field JSON remains the lightweight field system. Extend validation/rendering only for supported new types (`checkbox`, `url`) and scopes required by Quest Ascension, while preserving existing `entry` and `member` fields and current validation/error contracts.

Existing team reuse, captain prefill, roster limits, substitutes, coach handling, invitations, agreements, email verification, payment, withdrawal/edit locks, and confirmation behavior remain the source of truth. No second authentication, payment, upload, or mail system is introduced.

## Privacy, security, and authorization

- Public event APIs expose aggregate counts and explicitly public tournament data only.
- Captain emails/phones, player contact details, payment evidence, admin notes, and private identifiers remain admin/owner scoped.
- Event and event-registration admin endpoints use `requireAdmin` and existing request validation/rate limits.
- Registration ownership checks remain based on the existing authenticated user/team/captain rules.
- Server-side validation enforces publication, dates, roster/custom fields, duplicate submissions, capacity, waitlist, payment state, and allowed status transitions.
- File uploads use the existing storage, size/type, ownership, cleanup, and public/private boundary.
- Existing cache tags are invalidated on event, child-tournament, and registration mutations so public counters do not remain stale beyond current cache policy.

## Testing and release verification

### Database and backend

- Prisma format/generate/migration deploy/security verification;
- migration test with existing standalone tournaments and registrations;
- event CRUD/public visibility/slug uniqueness/child ordering;
- aggregate counts and derived event status;
- event-scoped admin filters/search/pagination/export;
- child tournament creation/attachment and unchanged tournament CRUD;
- registration before open/after close/full/waitlist/duplicate/concurrency;
- roster/substitute/coach/custom-field validation;
- payment reservation/reconciliation and bracket seed regressions;
- admin authorization and public privacy tests;
- audit logging for status changes.

### Frontend

- event API/type/mapper tests;
- CTA/countdown/status/count aggregation tests;
- public event route metadata, canonical, sitemap, 404, loading, empty, and error tests;
- event card/listing filter regression tests;
- responsive desktop/tablet/mobile rendering checks at 360, 390, 768, 1024, and 1440 CSS widths;
- existing tournament detail, registration, payment, auth, homepage, navbar, and footer E2E checks;
- lint, typecheck, unit tests, E2E tests, and production build.

### Release safety

Run the repository’s actual checks without disabling them:

```text
backend: npm run lint, npm test, npm run test:coverage, npm run test:integration
frontend: npm run lint, npm run typecheck, npm test, npm run test:e2e:local, npm run build
mobile-admin: npm run typecheck, npm test, npm run doctor
```

Only an isolated test database may receive migrations. Production deployment continues to use committed additive migrations and existing backup/rollback procedures.

## Delivery order

1. Add and verify the additive EventSeries schema migration and shared event read model.
2. Add public/admin event API aliases, aggregates, authorization, caching, and backend tests.
3. Add the public event route, event card/list integration, SEO, responsive game presentation, and frontend tests.
4. Extend admin event editing, child tournament linking/creation handoff, overview, and event registration filters.
5. Extend registration CTA/context, add the configured checkbox/url fields, and implement the additive waitlist/reference-code behavior; preserve the existing submission/payment flow.
6. Update API/admin/operations documentation and run complete regression, security, responsive, migration, and build verification.

## Rollback

Rollback removes the new event routes/UI/API aliases and reverts the additive migration only when safe for the deployed database. Existing `EventSeries`, `Tournament`, and registration records remain usable because the tournament relation is already optional and no existing records are rewritten. If the migration has been applied, rollback should prefer leaving nullable additive columns in place over destructive column removal until a separately approved data-retention operation exists.
