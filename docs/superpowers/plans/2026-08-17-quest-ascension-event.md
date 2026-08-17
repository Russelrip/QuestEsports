# Quest Ascension Event Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `EventSeries → Tournament → TeamRegistration` platform into a production-safe Quest Ascension multi-game event experience without changing standalone tournament behavior.

**Architecture:** Extend `EventSeries` additively as the Event parent and keep `Tournament.seriesId` nullable. Reuse the existing tournament, registration, payment, upload, authentication, admin, and SEO services; add event read models, aliases, responsive event UI, guarded admin management, and tournament-scoped waitlist/reference behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Express 5, CommonJS Node.js 24, Prisma 6, PostgreSQL, Node test runner, Vitest, Playwright, ExcelJS.

**Spec:** `docs/superpowers/specs/2026-08-17-quest-ascension-event-design.md`

## Global Constraints

- Existing standalone tournaments keep `seriesId = NULL` and all existing tournament URLs/APIs remain valid.
- Event registration remains tournament-scoped; do not create a second registration aggregate, authentication system, payment system, uploader, mailer, or bracket system.
- Database changes are additive, nullable/defaulted where possible, and must not reset, rename, truncate, or cascade-delete existing production data.
- `EventSeries.isPublished` remains the compatible visibility control; event lifecycle status is derived from publication, dates, and visible child tournaments.
- Tournament capacity remains enforced by the existing serializable transaction, retry, reservation, and payment recheck logic.
- Public responses never expose captain contact data, player private contact data, payment evidence, admin notes, or unpublished records.
- Backend validation and authorization are authoritative; frontend checks are UX only.
- Use existing Quest Esports typography, colors, spacing, surfaces, buttons, cards, media fallbacks, loaders, errors, and responsive conventions.
- Do not add a dependency or infrastructure service when an installed/project-owned solution already exists.
- Run focused tests after every task and the complete backend/frontend/mobile verification suite before completion.

---

## File Map and Work Graph

### Backend persistence and event read model

- Modify: `backend/prisma/schema.prisma` — EventSeries metadata, Tournament waitlist configuration, TeamRegistration waitlist/reference fields, and enum values.
- Create: `backend/prisma/migrations/20260817120000_extend_event_series_quest_ascension/migration.sql` — one additive migration generated/verified from the schema change.
- Create: `backend/src/modules/series/event-aggregation.js` — database aggregate queries and derived event registration state.
- Modify: `backend/src/modules/series/series.service.js` — map/save event fields, child tournament summaries, aliases, and safe deletion/archive behavior.
- Modify: `backend/src/modules/series/series.controller.js` and `series.routes.js` — event-named public/admin routes and event-scoped tournament handoff.
- Modify: `backend/src/modules/tournaments/tournament.service.js` — normalize/map waitlist settings and expose event relation metadata without changing standalone behavior.

### Registration and admin operations

- Modify: `backend/src/modules/tournaments/registration-eligibility.js` — exclude waitlisted entries from active capacity and expose centralized CTA state.
- Modify: `backend/src/modules/tournaments/registration.service.js` — assign reference codes, preserve transaction safety, and join the waitlist when capacity is unavailable and enabled.
- Modify: `backend/src/modules/admin/admin.service.js` and `admin.controller.js` — event filtering, waitlist transitions, audit records, and existing export/detail mappings.
- Modify: `backend/src/modules/series/series.controller.js` and `series.routes.js` — event-scoped registration route using the existing admin registration query service.
- Modify: `backend/src/lib/openapi.js` — document new event aliases and waitlist/reference response fields.

### Public web

- Modify: `frontend/lib/tournaments.ts` — extended EventSeries/Tournament contracts, event fetch aliases, event CTA types, and event helpers.
- Create: `frontend/lib/event-utils.ts` — pure countdown, aggregate, and event-status helpers.
- Create: `frontend/app/events/[slug]/page.tsx` — canonical public event route and metadata.
- Create: `frontend/components/tournaments/event/EventHero.tsx` — hero, status, countdown, and aggregate team display.
- Create: `frontend/components/tournaments/event/EventOverview.tsx` — about/event metadata/statistics sections.
- Create: `frontend/components/tournaments/event/EventTournamentList.tsx` — filters, desktop rows, mobile cards, and child actions.
- Modify: `frontend/components/tournaments/TournamentsContent.tsx` and `frontend/app/tournaments/page.tsx` — one event card per published multi-game series while preserving standalone cards/filtering.
- Modify: `frontend/app/tournaments/series/[slug]/page.tsx` — share the event read model and point canonical metadata to `/events/[slug]` while preserving the route.
- Modify: `frontend/app/sitemap.ts` — publish canonical event URLs without removing legacy series URLs from runtime.
- Create: `frontend/tests/unit/event-utils.test.ts` and extend relevant tournament tests.

### Admin web

- Create: `frontend/app/admin/events/page.tsx` — event list/create entry point.
- Create: `frontend/app/admin/events/[id]/page.tsx` — event dashboard route.
- Create: `frontend/components/admin/AdminEventsManager.tsx` — list/create/edit/archive UI using AdminShell primitives.
- Create: `frontend/components/admin/AdminEventDashboard.tsx` — overview, tournaments, registrations, and settings tabs.
- Modify: `frontend/components/admin/AdminShell.tsx` — add Events navigation without removing Event Series.
- Modify: `frontend/lib/admin.ts` and `frontend/hooks/api/useAdmin.ts` — event/admin-registration types and query helpers.
- Modify: `frontend/components/admin/TournamentEditor.tsx` and `tournament-editor-model.ts` — optional preselected event/series handoff and waitlist settings.
- Modify: `frontend/components/admin/AdminRegistrationsManager.tsx` — reuse event/game/status filters and waitlist actions where the existing component owns the interaction.
- Create: `frontend/tests/unit/admin-events.test.ts` for pure admin serialization/label behavior.

### Documentation and verification

- Modify: `docs/api-documentation.md` — event aliases and public/private response contracts.
- Modify: `docs/admin-operations.md` and `docs/commerce-and-tournament-operations.md` — event creation, child tournament linking, aggregates, waitlist, and rollback.
- Create/modify: `backend/tests/event.service.test.js`, `backend/tests/event-aggregation.test.js`, `backend/tests/registration-waitlist.test.js`, and route/security coverage using existing test conventions.

### Dependencies

```text
Task 1 schema ─┬─> Task 2 event backend ─┬─> Task 4 public event UI ─> Task 5 SEO
               │                         └─> Task 6 admin event UI
               └─> Task 3 registration/waitlist ─> Task 7 admin registration integration

Task 5 + Task 6 + Task 7 ─> Task 8 docs/codemaps ─> Task 9 full verification
```

Tasks 2 and 3 may run in parallel after Task 1. Tasks 4 and 5 must wait for the finalized backend response contracts. Public and admin UI writers must not edit the same files concurrently.

---

### Task 1: Add the additive persistence model

**Files:**
- Modify: `backend/prisma/schema.prisma:72-113,370-384,540-629,842-892`
- Create: `backend/prisma/migrations/20260817120000_extend_event_series_quest_ascension/migration.sql`
- Test: `backend/tests/event-schema.test.js`

**Interfaces:**
- Produces nullable/defaulted EventSeries fields: `shortName`, `subtitle`, `shortDescription`, `bannerImageName`, `startDate`, `endDate`, `registrationOpenAt`, `registrationCloseAt`, `venue`, `location`, `country`, `organizer`, `websiteUrl`, `discordUrl`, `featured`, and `registrationStatusOverride`.
- Produces `Tournament.waitlistEnabled` defaulting to `false`.
- Produces `TeamRegistration.status = waitlisted`, nullable `waitlistPosition`, and nullable unique `publicReference`.
- Keeps `Tournament.seriesId` optional with `onDelete: SetNull` and leaves existing defaults/columns intact.

- [ ] **Step 1: Write failing schema contract tests.** In `backend/tests/event-schema.test.js`, assert the generated Prisma model exposes the new fields, existing `EventSeries.tournaments` remains optional through `Tournament.seriesId`, and waitlisted/reference fields accept null/default values for legacy records.
- [ ] **Step 2: Run the focused test before implementation.**
  ```powershell
  Set-Location backend
  npm test -- --test-name-pattern="event schema|waitlisted|public reference"
  ```
  Expected: FAIL because the Prisma client/schema does not contain the new fields.
- [ ] **Step 3: Add the Prisma fields with compatibility defaults.** Use existing lower-case enum conventions, nullable text/date fields, `featured Boolean @default(false)`, `waitlistEnabled Boolean @default(false)`, nullable `waitlistPosition`, and nullable unique `publicReference`. Add only the needed indexes for event publication/order and tournament waitlist positions.
- [ ] **Step 4: Generate the migration without resetting a database.** Run `npx prisma migrate dev --create-only --name extend_event_series_quest_ascension`, compare the generated SQL to existing migrations, and ensure it uses `ALTER TABLE`/enum addition/index creation only. Rename the migration directory to the planned timestamped path if Prisma generated a different local timestamp; never edit an already-applied migration.
- [ ] **Step 5: Generate Prisma and run the focused test.**
  ```powershell
  npm run prisma:generate
  npm test -- --test-name-pattern="event schema|waitlisted|public reference"
  ```
  Expected: PASS with legacy-null/default behavior covered.
- [ ] **Step 6: Commit the persistence slice.**
  ```powershell
  git add backend/prisma/schema.prisma backend/prisma/migrations backend/tests/event-schema.test.js
  git commit -m "feat: add Quest Ascension event fields"
  ```

### Task 2: Implement the EventSeries event read model and APIs

**Files:**
- Create: `backend/src/modules/series/event-aggregation.js`
- Modify: `backend/src/modules/series/series.service.js:13-149`
- Modify: `backend/src/modules/series/series.controller.js`
- Modify: `backend/src/modules/series/series.routes.js:7-14`
- Modify: `backend/src/modules/tournaments/tournament.service.js:mapTournament, normalizeTournamentInput`
- Test: `backend/tests/event.service.test.js` and `backend/tests/event-aggregation.test.js`

**Interfaces:**
- `getEventAggregate({ seriesId, includeDrafts = false })` returns `{ games, teamsRegistered, playersRegistered, availableSlots, registrationState }`.
- `mapSeries(series, options)` returns the existing series fields plus safe event metadata, `eventStatus`, aggregate data, and published child summaries.
- Event routes produce the existing `{ success, ... }` response envelope:
  - `GET /api/events`
  - `GET /api/events/:slug`
  - `GET /api/admin/events`
  - `POST /api/admin/events`
  - `PATCH /api/admin/events/:eventId`
  - `POST /api/admin/events/:eventId/archive`
  - `POST /api/admin/events/:eventId/tournaments`

- [ ] **Step 1: Write failing service tests.** Cover public filtering of unpublished events/child tournaments, event field normalization, unique slug errors, safe archive behavior when children exist, old `/event-series` response compatibility, and event-named alias parity.
- [ ] **Step 2: Write failing aggregate tests.** Mock Prisma counts for visible children and assert games, active teams, non-coach players, available slots, and derived open/closed/upcoming/completed state. Include a waitlisted registration and verify it does not consume capacity.
- [ ] **Step 3: Run the focused backend tests.**
  ```powershell
  npm test -- --test-name-pattern="event service|event aggregate|event series"
  ```
  Expected: FAIL because event fields/aggregate/aliases do not exist.
- [ ] **Step 4: Extract aggregate queries into `event-aggregation.js`.** Use Prisma `_count`/group queries and the existing `buildActiveRegistrationWhere` semantics; count `CAPTAIN`, `PLAYER`, and `SUBSTITUTE` members only for player totals. Do not select private registration fields for public mapping.
- [ ] **Step 5: Extend `series.service.js` without replacing old methods.** Normalize multipart/text/boolean/date values using existing validation helpers, retain `heroImageName` fallback behavior, persist new banner media through existing upload cleanup, map event metadata, and use `onDelete: SetNull` behavior for child relations.
- [ ] **Step 6: Add controller/route aliases.** Reuse `requireAdmin`, `cachePublicData`, `cacheJson`, `invalidateCache`, `tournamentBannerUpload`, and current async error handling. Delegate child creation/attachment to the tournament service with `seriesId` and `seriesOrder`; do not duplicate tournament validation.
- [ ] **Step 7: Run tests and inspect public payloads.**
  ```powershell
  npm test -- --test-name-pattern="event service|event aggregate|event series"
  npm run lint
  ```
  Expected: PASS with no private fields in public event responses.
- [ ] **Step 8: Commit the event API slice.**
  ```powershell
  git add backend/src/modules/series backend/src/modules/tournaments/tournament.service.js backend/tests/event*.test.js
  git commit -m "feat: add Quest Ascension event APIs"
  ```

### Task 3: Add centralized registration state, waitlist, and reference codes

**Files:**
- Create: `backend/src/modules/tournaments/registration-state.js`
- Modify: `backend/src/modules/tournaments/registration-eligibility.js:1-90`
- Modify: `backend/src/modules/tournaments/registration.service.js:62-148,197-227,330-341,825-845,992-1012`
- Modify: `backend/src/modules/admin/admin.service.js:730-890, updateTeamRegistrationStatus, recordAudit callers`
- Modify: `backend/src/modules/admin/admin.controller.js:142-194`
- Modify: `backend/src/modules/admin/admin.routes.js:52-61`
- Test: `backend/tests/registration-waitlist.test.js`, `backend/tests/registration-eligibility.test.js`, `backend/tests/registration.service.test.js`

**Interfaces:**
- `getTournamentRegistrationState({ tournament, capacityUsed, now, existingRegistration })` returns `{ state, action, label, canRegister, canWaitlist }` with `registration_open`, `registration_closed`, `slots_full`, `waitlist_open`, or `already_registered` presentation states.
- `buildActiveRegistrationWhere()` and `isRegistrationActive()` exclude `waitlisted` registrations.
- New registrations receive `TeamRegistration.publicReference`; legacy registrations use a deterministic fallback mapper.
- `updateTeamRegistrationStatus(registrationId, body, actorUserId)` accepts `waitlisted` only when the tournament enables waitlisting and records an `AuditLog` transition.

- [ ] **Step 1: Write failing state/eligibility tests.** Cover before-open, open, deadline-closed, status-closed, full/no-waitlist, full/waitlist, already-registered, waitlisted-not-active, and expired payment reservation behavior.
- [ ] **Step 2: Write failing transaction tests.** Cover two simultaneous final-slot submissions, duplicate browser retries, new reference generation, admin promotion from waitlist, and rejected invalid status transitions. Assert only one competitive slot is consumed.
- [ ] **Step 3: Run focused tests and confirm failure.**
  ```powershell
  Set-Location backend
  npm test -- --test-name-pattern="waitlist|registration state|capacity|reference"
  ```
- [ ] **Step 4: Implement `registration-state.js` as the single decision helper.** Keep date comparisons server-time based, honor explicit tournament registration override, include current-user status, and return the exact action/label contract consumed by public and admin clients.
- [ ] **Step 5: Update eligibility/capacity predicates.** Treat `waitlisted` as non-active; preserve current pending-reservation/paid rules, slot allocation, expiry release, and serializable retry behavior. When the transaction finds no slot and waitlist is enabled, insert a waitlisted registration with the next position instead of exceeding capacity.
- [ ] **Step 6: Add reference code generation.** Generate a collision-safe readable code for new records inside the registration transaction or retry on the unique constraint; map historical records with a stable fallback without mutating them.
- [ ] **Step 7: Add admin waitlist transitions and audit data.** Validate allowed transitions, promote the lowest-position waitlisted registration only when capacity is available, compact remaining positions transactionally, and write actor/from/to/reason into the existing audit log.
- [ ] **Step 8: Run focused tests and payment regressions.**
  ```powershell
  npm test -- --test-name-pattern="waitlist|registration state|capacity|reference|payment reservation"
  npm run lint
  ```
  Expected: PASS without changing existing paid/free registration behavior.
- [ ] **Step 9: Commit the registration slice.**
  ```powershell
  git add backend/src/modules/tournaments backend/src/modules/admin backend/tests/registration*.test.js
  git commit -m "feat: add tournament waitlist state"
  ```

### Task 4: Implement the public event page and catalogue integration

**Owner:** UI/UX designer lane for visual and interaction implementation; orchestrator validates copy, contracts, and tests.

**Files:**
- Modify: `frontend/lib/tournaments.ts:115-125,193-272,274-348`
- Create: `frontend/lib/event-utils.ts`
- Create: `frontend/app/events/[slug]/page.tsx`
- Create: `frontend/components/tournaments/event/EventHero.tsx`
- Create: `frontend/components/tournaments/event/EventOverview.tsx`
- Create: `frontend/components/tournaments/event/EventTournamentList.tsx`
- Modify: `frontend/components/tournaments/TournamentsContent.tsx:117-227`
- Modify: `frontend/app/tournaments/series/[slug]/page.tsx:14-112`
- Test: `frontend/tests/unit/event-utils.test.ts` and existing tournament component tests

**Interfaces:**
- `EventSeries` includes event metadata, `eventStatus`, aggregate counters, and child tournament summaries while retaining `ticketEvent`.
- `fetchPublicEvents()` and `fetchPublicEventBySlug(slug)` use `/api/events` and `/api/events/:slug`; existing `fetchPublicEventSeries*` remains available for legacy routes.
- `event-utils.ts` exports pure functions `getEventStatus`, `getCountdownTarget`, `formatEventCountdown`, and `getEventRegistrationSummary`.
- Event child actions call the existing `/tournaments/:slug`, `/register`, `/payment`, and registration-status flows.

- [ ] **Step 1: Write failing helper tests.** Cover countdown target priority (registration opening, event start, hidden after start), date/status labels, aggregate formatting, open/closed event state, and zero-game/zero-registration empty states.
- [ ] **Step 2: Run the focused frontend test.**
  ```powershell
  Set-Location frontend
  npm test -- event-utils.test.ts
  ```
  Expected: FAIL because the helper module does not exist.
- [ ] **Step 3: Add event types/fetchers and pure helpers.** Keep API parsing in `frontend/lib/tournaments.ts`, use the existing `fetchApiJson`/15-second revalidation, and return typed data with no `any` values.
- [ ] **Step 4: Implement the server event route.** Follow `frontend/app/tournaments/[slug]/page.tsx` metadata/404/error conventions, use `buildPageMetadata`, set canonical `/events/${slug}`, add safe OpenGraph image/description, and render `PageLayout`/`PageTransition` with the shared event components.
- [ ] **Step 5: Implement the responsive event surface.** Use existing `Container`, `Section`, `Card`, `Button`, `Badge`, `EmptyState`, `Skeleton`, `TournamentBannerImage`, and design tokens. Render desktop rows and separate mobile cards; do not horizontally squeeze the tournament list. Include semantic headings, focus states, alt text, status text not expressed only by color, and reduced-motion classes.
- [ ] **Step 6: Integrate catalogue cards and filters.** Render one EventSeries card for published multi-game series, preserve standalone tournament cards, include event matches when a child game matches, and link to `/events/:slug`.
- [ ] **Step 7: Preserve legacy series route.** Reuse the event read model and visual components, retain ticket checkout, keep the old URL functional, and set its metadata canonical to the new event URL.
- [ ] **Step 8: Run focused frontend checks.**
  ```powershell
  npm test -- event-utils.test.ts
  npm run typecheck
  npm run lint
  ```
  Expected: PASS with existing tournament tests unchanged.
- [ ] **Step 9: Commit the public UI slice.**
  ```powershell
  git add frontend/app/events frontend/app/tournaments frontend/components/tournaments frontend/lib/tournaments.ts frontend/lib/event-utils.ts frontend/tests/unit/event-utils.test.ts
  git commit -m "feat: add public Quest Ascension event page"
  ```

### Task 5: Add event SEO and public discovery verification

**Files:**
- Modify: `frontend/app/sitemap.ts:11-79`
- Test: `frontend/tests/unit/event-seo.test.ts`

**Interfaces:**
- Published events contribute canonical `/events/:slug` sitemap entries.
- Legacy `/tournaments/series/:slug` remains routable but is not the canonical event URL.
- Event metadata uses existing `buildPageMetadata` and `absoluteUrl`; no second metadata package is added.

- [ ] **Step 1: Write failing sitemap/metadata tests.** Assert published events produce `/events/:slug`, unpublished events do not, and the legacy series route metadata points to the event canonical URL.
- [ ] **Step 2: Run the focused test and confirm failure.**
  ```powershell
  Set-Location frontend
  npm test -- --test-name-pattern="event sitemap|event metadata|canonical"
  ```
- [ ] **Step 3: Update sitemap/metadata integration.** Keep each fetch source independently fault tolerant as the existing sitemap does and retain tournament/ticket/gallery entries.
- [ ] **Step 4: Run focused checks.**
  ```powershell
  npm test -- --test-name-pattern="event sitemap|event metadata|canonical"
  npm run typecheck
  ```
  Expected: PASS.
- [ ] **Step 5: Commit the SEO slice.**
  ```powershell
  git add frontend/app/sitemap.ts frontend/tests/unit/event-seo.test.ts
  git commit -m "feat: add Quest Ascension event SEO"
  ```

### Task 6: Implement admin event management and child tournament handoff

**Owner:** UI/UX designer lane for admin layout and interaction polish; backend admin API contract from Task 2 is authoritative.

**Files:**
- Create: `frontend/app/admin/events/page.tsx`
- Create: `frontend/app/admin/events/[id]/page.tsx`
- Create: `frontend/components/admin/AdminEventsManager.tsx`
- Create: `frontend/components/admin/AdminEventDashboard.tsx`
- Modify: `frontend/components/admin/AdminShell.tsx`
- Modify: `frontend/lib/admin.ts`
- Modify: `frontend/hooks/api/useAdmin.ts`
- Modify: `frontend/components/admin/TournamentEditor.tsx` and `tournament-editor-model.ts`
- Test: `frontend/tests/unit/admin-events.test.ts`

**Interfaces:**
- `AdminEvent` mirrors the event admin response, including child tournament summaries and aggregate counters.
- `createAdminEvent`, `updateAdminEvent`, `archiveAdminEvent`, and `fetchAdminEventRegistrations` use `adminRequest` and existing error envelopes.
- Tournament editor accepts optional `initialSeriesId`/`initialSeriesOrder` and serializes the existing multipart form fields unchanged for all other settings.

- [ ] **Step 1: Write failing serialization/label tests.** Cover event form defaults, dates/booleans, archive confirmation label, child action labels, waitlist settings, and event preselection in the tournament editor.
- [ ] **Step 2: Run the focused test.**
  ```powershell
  Set-Location frontend
  npm test -- admin-events.test.ts
  ```
- [ ] **Step 3: Add admin API types/hooks.** Follow `frontend/lib/admin.ts`, `adminRequest`, `useApiQuery`, pagination, and toast/error conventions. Do not make the browser responsible for authorization.
- [ ] **Step 4: Implement event list/editor.** Use AdminShell, Card, Button, FormField, Input, Textarea, Select, uploader, skeleton, and EmptyState primitives. Add draft/published/open/full/completed labels and guarded archive/unpublish behavior.
- [ ] **Step 5: Implement the dashboard.** Add Overview/Tournaments/Registrations/Settings tabs; show aggregate cards and per-game child rows; add “View Public Event,” “Add Tournament,” and “Attach Existing” actions. Keep the normal TournamentEditor responsible for tournament settings.
- [ ] **Step 6: Add event navigation without removing existing Event Series.** Preserve the current route and menu item until event records are migrated/verified.
- [ ] **Step 7: Run focused checks.**
  ```powershell
  npm test -- admin-events.test.ts
  npm run typecheck
  npm run lint
  ```
  Expected: PASS.
- [ ] **Step 8: Commit the admin event slice.**
  ```powershell
  git add frontend/app/admin/events frontend/components/admin frontend/lib/admin.ts frontend/hooks/api/useAdmin.ts frontend/tests/unit/admin-events.test.ts
  git commit -m "feat: add admin Quest Ascension management"
  ```

### Task 7: Add event-scoped admin registrations and account context

**Files:**
- Modify: `backend/src/modules/admin/admin.service.js:buildRegistrationWhere,listTeamRegistrations,updateTeamRegistrationStatus`
- Modify: `backend/src/modules/admin/admin.controller.js:142-194`
- Modify: `backend/src/modules/series/series.controller.js` and `series.routes.js`
- Modify: `frontend/components/admin/AdminEventDashboard.tsx`
- Modify: `frontend/components/admin/AdminRegistrationsManager.tsx:53-340`
- Modify: `frontend/lib/admin.ts` and `frontend/hooks/api/useAdmin.ts`
- Modify: `backend/src/modules/account/account.service.js:mapRegistration` — include the nullable event summary from the registration’s tournament relation.
- Modify: `frontend/components/auth/ProfileView.tsx` — render event title/slug in existing registration cards while keeping each child registration separate.
- Test: `backend/tests/admin-event-registrations.test.js` and `frontend/tests/unit/admin-events.test.ts`

**Interfaces:**
- `listTeamRegistrations(query)` accepts optional `eventId`, `tournament`, `status`, `search`, `page`, and `pageSize` while preserving current responses for callers without `eventId`.
- `GET /api/admin/events/:eventId/registrations` returns the existing registration summary/detail envelope with event-scoped tournaments and pagination.
- Admin registration cards/table show event, game, team, captain, competing-player count, approval/payment/verification, reference, submitted date, and valid actions; mobile uses cards.

- [ ] **Step 1: Write failing backend filter/privacy tests.** Assert event filtering never includes registrations from another event, status/game/search/pagination combine correctly, and an invalid/non-admin request is rejected by existing middleware.
- [ ] **Step 2: Run the focused backend test.**
  ```powershell
  Set-Location backend
  npm test -- --test-name-pattern="event registration|event filter|admin registration"
  ```
- [ ] **Step 3: Extend `buildRegistrationWhere` with `eventId`.** Filter through `tournament.seriesId`; preserve current tournament slug/search/status semantics and query pagination in the database.
- [ ] **Step 4: Add the event-scoped route/controller alias to the EventSeries router.** Reuse `listTeamRegistrations`, existing `requireAdmin`, response mapping, and current export privacy rules. Keep existing registration status mutations in `admin.routes.js`; do not expose admin notes or private fields in public event APIs.
- [ ] **Step 5: Add dashboard registration filters.** Use All Games/game/status/search controls, server-side debounce/pagination, current loading/error/empty states, and existing `RegistrationDetail` actions. Add waitlist/promote actions only for valid backend transitions.
- [ ] **Step 6: Extend account registration cards with event title/slug.** Preserve separate child registration cards so one user/team can register in multiple games; do not make `eventId + userId` unique.
- [ ] **Step 7: Run focused backend/frontend checks.**
  ```powershell
  Set-Location backend
  npm test -- --test-name-pattern="event registration|event filter|admin registration"
  Set-Location ../frontend
  npm run typecheck
  npm test -- --test-name-pattern="event registration|admin event"
  ```
- [ ] **Step 8: Commit the registration-admin slice.**
  ```powershell
  git add backend/src/modules/admin frontend/components/admin frontend/lib/admin.ts frontend/hooks/api/useAdmin.ts frontend/app/profile backend/src/modules/account backend/tests frontend/tests/unit
  git commit -m "feat: add event registration administration"
  ```

### Task 8: Update API/operations documentation and codemaps

**Files:**
- Modify: `docs/api-documentation.md`
- Modify: `docs/admin-operations.md`
- Modify: `docs/commerce-and-tournament-operations.md`
- Modify: `backend/src/modules/series/codemap.md`
- Modify: `backend/src/modules/tournaments/codemap.md`
- Modify: `backend/prisma/codemap.md`
- Create: `frontend/app/events/codemap.md` and `frontend/components/tournaments/event/codemap.md`
- Modify: `frontend/components/admin/codemap.md` and `frontend/app/admin/codemap.md`
- Modify: `codemap.md` and `AGENTS.md` to link the new event routes and component maps.

**Interfaces:**
- Documentation explains EventSeries-as-Event, nullable series relation, child tournament creation, aggregation definitions, waitlist/capacity rules, admin filters, public privacy, migration deployment, and rollback.

- [ ] **Step 1: Write documentation checks as a manual checklist.** Verify every endpoint in the spec appears in API docs, every admin flow appears in operations docs, and no environment variable is documented because none is added.
- [ ] **Step 2: Update API examples.** Include safe public event JSON with child tournament summaries and omit captain/payment/admin-note fields. Document auth/admin requirements and error envelopes.
- [ ] **Step 3: Update operational steps.** Document Save Draft → Add Tournament → Configure → Publish, event-scoped registration review, waitlist promotion, aggregate definitions, archive behavior, isolated migration verification, and rollback.
- [ ] **Step 4: Update affected codemaps.** Describe the new event aggregation flow, event routes, public components, admin dashboard, and integration boundaries without documenting generated build files.
- [ ] **Step 5: Inspect documentation diff.**
  ```powershell
  git diff --check
  git status --short
  ```
- [ ] **Step 6: Commit documentation.**
  ```powershell
  git add docs/api-documentation.md docs/admin-operations.md docs/commerce-and-tournament-operations.md codemap.md AGENTS.md backend frontend
  git commit -m "docs: document Quest Ascension event operations"
  ```

### Task 9: Full migration, regression, security, responsive, and release verification

**Files:**
- Modify only files required by failing checks; do not perform unrelated refactors.
- Test: all backend/frontend/mobile suites and isolated database migration.

**Interfaces:**
- A completed verification report records commands, pass/fail results, migration target, responsive widths, and any remaining optional work.

- [ ] **Step 1: Inspect final tracked/untracked files and secrets.** Confirm no `.env`, uploads, build output, `.slim` state, or unrelated generated files are staged.
- [ ] **Step 2: Generate and validate Prisma.**
  ```powershell
  Set-Location backend
  npm run prisma:generate
  npm run prisma:migrate:status
  npm run prisma:security:verify
  ```
- [ ] **Step 3: Deploy the migration to a dedicated test database.** Run `npm run prisma:migrate:deploy` only against the isolated test database from `backend/.env`; verify existing standalone tournament rows, registration rows, nullable series relations, and indexes remain intact.
- [ ] **Step 4: Run backend verification.**
  ```powershell
  npm run lint
  npm test
  npm run test:coverage
  npm run test:integration
  ```
- [ ] **Step 5: Run frontend verification.**
  ```powershell
  Set-Location ../frontend
  npm run lint
  npm run typecheck
  npm test
  npm run test:e2e:local
  npm run build
  ```
- [ ] **Step 6: Run mobile-admin verification.**
  ```powershell
  Set-Location ../mobile-admin
  npm run typecheck
  npm test
  npm run doctor
  ```
- [ ] **Step 7: Exercise acceptance scenarios.** Verify 360px, 390px, 768px, 1024px, and 1440px layouts; event not-found/draft/empty/error states; four child games; independent child registration state; existing tournament detail/registration/payment/auth/admin routes; waitlist/full/concurrency; admin filters/status actions; public privacy; homepage/navbar/footer.
- [ ] **Step 8: Review the final diff and history.** Run `git status --short`, `git diff main...HEAD --stat`, `git diff --check`, and `git log --oneline -10`. Stage only intended files and never commit secrets.
- [ ] **Step 9: Record verification evidence.** Add the actual command results to the final response and list only genuinely optional follow-up work.
