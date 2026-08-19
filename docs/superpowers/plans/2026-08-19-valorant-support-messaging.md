# Valorant Support Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authenticated website support inbox where users and SI/admin staff exchange persisted, notified, realtime-assisted conversations.

**Architecture:** Add a dedicated support module and Prisma models instead of extending match-room chat. User routes scope by authenticated owner; admin routes use existing authorization. Messages persist first, then notifications and realtime events are emitted.

**Tech Stack:** Express, Prisma/PostgreSQL, Node `node:test`, Next.js App Router, React, React Hook Form/Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-valorant-support-contact-design.md`

## Global Constraints

- Only authenticated users may access inbox conversations; guests keep the public contact form.
- Staff access uses existing authorization middleware; UI hiding is not security.
- Persist messages before realtime or push delivery.
- Use an additive Prisma migration; do not alter contact, match-room, or OAuth tables.
- Store nullable `senderUserId` with `onDelete: SetNull`, matching match-room messages.
- Keep general support separate from match-room chat and match-room support requests.
- Use `/support/:conversationId` as the user notification action URL.

---

### Task 1: Add support schema and codemaps

**Files:** Create `backend/src/modules/support/codemap.md`, create `backend/prisma/migrations/20260819120000_add_support_conversations/migration.sql`, modify `backend/prisma/schema.prisma`, `backend/prisma/codemap.md`, and `codemap.md`.

**Interfaces:** Produces Prisma models `SupportConversation`, `SupportMessage`, and enum `SupportConversationStatus` for every later task.

- [ ] **Step 1: Write the failing schema check** — Create `backend/tests/support-schema.test.js` using the repository test runner and assert the generated client exposes `supportConversation` and `supportMessage`.
- [ ] **Step 2: Run it and verify failure** — From `backend`, run `npm run prisma:generate; node tests/support-schema.test.js`; it must fail before the schema change.
- [ ] **Step 3: Implement the schema and migration** — Add statuses `OPEN`, `PENDING_USER`, `PENDING_STAFF`, `RESOLVED`; conversation owner, subject, status, nullable assigned staff, timestamps, and nullable `resolvedAt`; message conversation, nullable sender, body, and timestamp; and `SupportConversationRead` with conversation, user, `lastReadAt`, and a unique conversation/user pair. Add owner/status/updated-time, assignment/status, and read-cursor indexes. Use `onDelete: SetNull` for nullable sender and assignee relations. Write additive SQL only. Document deployment status in `backend/prisma/codemap.md`, create the support module codemap, and link the new backend responsibility from `codemap.md`.
- [ ] **Step 4: Verify the schema** — Run `npm run prisma:generate; npm run prisma:validate; node tests/support-schema.test.js` from `backend`; expect PASS.
- [ ] **Step 5: Commit** — Run `git add backend/src/modules/support/codemap.md backend/prisma/schema.prisma backend/prisma/codemap.md backend/prisma/migrations codemap.md backend/tests/support-schema.test.js; git commit -m "feat: add support conversation schema"`.

### Task 2: Implement the support service with tests

**Files:** Create `backend/src/modules/support/support.service.js` and `backend/tests/support.service.test.js`; modify `backend/src/modules/notifications/notification.service.js` to expose an optional `publishRealtime` flag that defaults to `true` for existing callers.

**Interfaces:** Consume Prisma support models, `createNotification`, `publishRealtimeEvent`, and validation/error helpers. Export `listUserConversations({ userId, limit, cursor })`, `createConversation({ ownerUserId, subject, body })`, `getConversation({ conversationId, userId, isStaff })`, `sendMessage({ conversationId, senderUserId, body, isStaff })`, `markConversationRead({ conversationId, userId, isStaff })`, `changeConversationStatus({ conversationId, actorUserId, status, isStaff })`, `assignConversation({ conversationId, assignedStaffUserId, actorUserId })`, and `listStaffConversations({ status, assigned, search, limit, cursor })`. `markConversationRead` upserts `SupportConversationRead.lastReadAt`; unread counts compare message timestamps to the requesting user’s cursor and exclude messages sent by that user.

- [ ] **Step 1: Write failing service tests** — With `node:test` and mocked Prisma, cover transactional initial-message creation, owner scoping, required/length-limited subject/body, user reopening, staff-only assignment, read state, notification creation, and realtime ordering. Include this ownership assertion:

```js
test("user cannot read another user's conversation", async () => {
  await assert.rejects(
    service.getConversation({ conversationId: "c1", userId: "u2", isStaff: false }),
    (error) => [403, 404].includes(error.statusCode),
  );
});
```
- [ ] **Step 2: Run `node --test tests/support.service.test.js` and verify failure** — It must fail because the service module and exports do not exist.
- [ ] **Step 3: Implement the service** — Normalize input with existing helpers; scope user queries by `ownerUserId`; use Prisma `$transaction` for creation, status transitions, and reads. User replies transition to `PENDING_STAFF`; staff replies transition to `PENDING_USER`; resolve sets `resolvedAt`; reopen clears it. Persist before notification/realtime. Use event key `support-message:${messageId}`, type `support_message`, action URL `/support/${conversationId}`, and realtime payload `{ kind: "support", conversationId, messageId, status, unreadCount }` on `user:${userId}` topics. Add `publishRealtime: false` to the support notification call so notification-record persistence errors are distinguishable from the support service's own best-effort realtime publication; keep the notification service default `true` for existing callers. Push failures must not reject saved messages.
- [ ] **Step 4: Run `node --test tests/support.service.test.js` and verify PASS**.
- [ ] **Step 5: Commit** — Run `git add backend/src/modules/support/support.service.js backend/tests/support.service.test.js; git commit -m "feat: add support conversation service"`.

### Task 3: Expose user and admin APIs

**Files:** Create `backend/src/modules/support/support.controller.js`, `backend/src/modules/support/support.routes.js`, and `backend/tests/support.controller.test.js`; modify `backend/src/routes/v1.js`.

**Interfaces:** Add these exact routes under the existing `/api/v1` mount: `GET /support/conversations`; `POST /support/conversations` with `{ subject, body }`; `GET /support/conversations/:conversationId`; `POST /support/conversations/:conversationId/messages` with `{ body }`; `PATCH /support/conversations/:conversationId/read`; `POST /support/conversations/:conversationId/resolve`; `POST /support/conversations/:conversationId/reopen`; `GET /admin/support/conversations` with `status`, `assigned`, and `search` filters; `GET /admin/support/conversations/:conversationId`; `PATCH /admin/support/conversations/:conversationId/assignment` with `{ assignedStaffUserId: string|null }`; `POST /admin/support/conversations/:conversationId/messages` with `{ body }`; and `PATCH /admin/support/conversations/:conversationId/status` with `{ status }`.

- [ ] **Step 1: Write failing controller tests** — Assert controllers pass `req.user.id`, ignore client owner IDs, return `{ success: true, data }`, and reject non-admin queue access.
- [ ] **Step 2: Run `node --test tests/support.controller.test.js` and verify failure**.
- [ ] **Step 3: Implement controllers and route registration** — Use `asyncHandler`, existing API errors, `requireAuth`, and `requireAdmin`; normalize queue filters; never accept owner ID from body or query.
- [ ] **Step 4: Run focused and complete backend tests** — Run `node --test tests/support.service.test.js tests/support.controller.test.js; npm test` from `backend`; expect PASS.
- [ ] **Step 5: Commit** — Run `git add backend/src/modules/support backend/src/routes/v1.js backend/tests/support.controller.test.js; git commit -m "feat: expose support conversation api"`.

### Task 4: Build the authenticated user inbox

**Files:** Create `frontend/app/support/page.tsx`, `frontend/app/support/[conversationId]/page.tsx`, `frontend/components/support/SupportInbox.tsx`, `SupportConversationList.tsx`, `SupportThread.tsx`, `SupportComposer.tsx`, `frontend/components/support/codemap.md`, `frontend/app/support/codemap.md`, `frontend/lib/support.ts`, and `frontend/tests/unit/support-inbox.test.tsx`; modify `frontend/app/contact/page.tsx`, `frontend/components/notifications/NotificationBell.tsx`, `frontend/package.json`, `frontend/package-lock.json`, and `frontend/vitest.config.ts`.

**Interfaces:** `frontend/lib/support.ts` exports `SupportStatus = "OPEN" | "PENDING_USER" | "PENDING_STAFF" | "RESOLVED"`, typed `SupportConversationSummary`, typed `SupportMessage`, and request helpers for Task 3.

- [ ] **Step 1: Write failing Vitest tests** — Add the repository's missing DOM test dependencies (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, and `jsdom`) as frontend dev dependencies and configure the focused suite for jsdom. Render and interact with the inbox, covering empty state, unread/status rendering, required subject/body validation, pending/retry send states, resolved reopen, notification navigation, and the empty-composer Send click asserting `subject is required`.
- [ ] **Step 2: Run `npm test -- support-inbox.test.tsx` and verify failure**.
- [ ] **Step 3: Implement inbox/thread/composer** — Use existing `apiFetch`/`apiFetchJson`, auth hooks, toasts, React Hook Form/Zod, and UI primitives. Realtime events trigger refetch/reconciliation. Add an authenticated `/support` CTA to the public contact page without removing the guest form. Route support notification actions to `/support/:conversationId`.
- [ ] **Step 4: Run `npm test -- support-inbox.test.tsx; npm run typecheck` and verify PASS**.
- [ ] **Step 5: Commit** — Run `git add frontend/app/support frontend/components/support frontend/lib/support.ts frontend/tests/unit/support-inbox.test.tsx frontend/app/contact/page.tsx frontend/components/notifications/NotificationBell.tsx; git commit -m "feat: add user support inbox"`.

### Task 5: Build the admin queue

**Files:** Create `frontend/app/admin/support/page.tsx`, `frontend/components/admin/AdminSupportManager.tsx`, `frontend/components/admin/support/SupportQueueFilters.tsx`, `AdminSupportThread.tsx`, `SupportAssignmentControl.tsx`, and `frontend/tests/unit/admin-support.test.tsx`; modify `backend/src/modules/support/support.controller.js`, `backend/src/modules/support/support.routes.js`, `backend/tests/support.controller.test.js`, `frontend/lib/support.ts`, `frontend/app/admin/codemap.md`, and `frontend/components/admin/codemap.md`.

**Interfaces:** Queue filters are `{ status?: SupportStatus; assigned?: "all" | "unassigned" | "mine"; search?: string }`; UI produces assignment, staff reply, status, resolve, reopen, and staff-read mutations through Task 3. Add `PATCH /admin/support/conversations/:conversationId/read`, requiring admin auth and calling `markConversationRead` with `req.user.id` and `isStaff: true`.

- [ ] **Step 1: Write failing admin UI tests** — Cover assigned/unassigned lists, status filters, assignment, staff reply, resolve/reopen, empty/retry states, and unauthorized errors.
- [ ] **Step 2: Run `npm test -- admin-support.test.tsx` and verify failure**.
- [ ] **Step 3: Implement `/admin/support` and staff read marking** — Follow the existing admin page-to-manager pattern; preserve a selected conversation ID for retry; guard queue/detail results with request generations or cancellation so stale responses cannot replace current filters or the selected thread; refetch after mutations; call the authenticated admin read endpoint when a thread opens; use the same thread semantics without user-only controls; add the existing admin navigation entry.
- [ ] **Step 4: Run `npm test -- admin-support.test.tsx; npm run typecheck` and verify PASS**.
- [ ] **Step 5: Update codemaps and commit** — Document route and manager responsibility, then run `git add frontend/app/admin/support frontend/components/admin/AdminSupportManager.tsx frontend/components/admin/support frontend/tests/unit/admin-support.test.tsx frontend/app/admin/codemap.md frontend/components/admin/codemap.md; git commit -m "feat: add admin support queue"`.

### Task 6: Verify the complete support flow

**Files:** Create `frontend/tests/e2e/support-contact.spec.ts`; modify `backend/src/modules/support/support.service.js`, `backend/tests/support.service.test.js`, `frontend/components/admin/AdminSupportManager.tsx`, and `docs/api-documentation.md` with the real-flow and role-specific notification contracts.

**Interfaces:** Consume Tasks 1–5 and produce evidence for two real authenticated session contexts, persisted creation/reply/read/resolve/reopen behavior, role-specific notification action URLs (`/admin/support?conversationId=:id` for staff recipients and `/support/:id` for user recipients), and migration safety.

- [ ] **Step 1: Write the Playwright flow** — Use existing session fixtures and a configured test backend/database with two genuine authenticated contexts: user creates a conversation, admin opens `/admin/support?conversationId=:id`, admin reads/replies/resolves, and user sees the persisted reply and reopens. Do not intercept support API routes or implement an in-memory support server; mock only external OAuth/push boundaries.
- [ ] **Step 2: Run `npm run test:e2e -- tests/e2e/support-contact.spec.ts` and verify the pre-implementation failure**.
- [ ] **Step 3: Run complete verification** — With the repository’s configured Node 24 and test database environment, backend: `npm run prisma:generate; npm run prisma:migrate:status; npm test; npm run lint`. Frontend: `npm test; npm run typecheck; npm run lint; npm run test:e2e -- tests/e2e/support-contact.spec.ts`. Confirm existing contact and match-room tests remain green and that notification action URLs target the correct role-specific route.
- [ ] **Step 4: Commit** — Run `git add frontend/tests/e2e/support-contact.spec.ts docs/api-documentation.md; git commit -m "test: verify support contact flow"`.
