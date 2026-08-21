# Cluster-Safe Realtime Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quest SSE invalidation delivery cross-worker and reconnect-safe using Upstash REST Pub/Sub plus authoritative state reconciliation.

**Architecture:** Keep the existing synchronous local `EventEmitter` path and add one namespaced Upstash Pub/Sub channel per environment. Each worker publishes validated envelopes and runs one reconnecting subscriber; SSE clients refresh persisted state on both `ready` and `update`, so Pub/Sub remains an at-most-once invalidation transport rather than an event log.

**Tech Stack:** Node 24 CommonJS, native `fetch`, Express 5 SSE, Upstash Redis REST Pub/Sub, Next.js/React TypeScript, Node test runner, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-22-realtime-cluster-safe-design.md`

## Global Constraints

- Preserve `GET /api/v1/events`, topic filters, private-topic authorization, `retry: 5000`, 25-second heartbeats, connection caps, cleanup, and disabled `204` behavior.
- Keep `publishRealtimeEvent(topic, payload)` synchronous from all existing callers’ perspective.
- Use one server-side namespaced Upstash channel; browsers never receive Redis credentials or connect to Redis directly.
- Do not add Prisma models, migrations, Redis Streams, consumer groups, a database outbox, or PostgreSQL `LISTEN/NOTIFY`.
- Treat SSE and Pub/Sub events as invalidation hints; authoritative state remains in existing JSON APIs.
- Reject malformed, unsupported, oversized, and invalid-topic shared envelopes before local emission.
- Preserve single-process memory mode; require Upstash for multi-process SSE and fail clustered SSE closed with retriable `503` when the shared subscriber is unavailable.
- Do not change payment, identity, public code-based veto, or mobile-admin behavior.
- Leave the three existing untracked planning documents untouched and never stage them.

---

## File Map

- Create `backend/src/modules/realtime/realtime.transport.js` — Upstash publish/subscribe adapter, SSE frame parser, envelope-size and reconnect handling.
- Modify `backend/src/modules/realtime/realtime.service.js` — local event creation, shared transport lifecycle, reflection suppression, status.
- Modify `backend/src/modules/realtime/realtime.controller.js` — readiness gate, listener-before-ready ordering, reconciliation event, existing SSE behavior.
- Modify `backend/src/config/env.js` and `backend/.env.example` — realtime channel/worker/reconnect settings and clustered validation.
- Modify `backend/src/server.js` — start the worker subscriber after database initialization and stop it during graceful shutdown.
- Modify `backend/src/lib/openapi.js` — describe private topics, reconciliation behavior, and `503` shared-transport failure.
- Modify `backend/tests/realtime.service.test.js` — local/shared service behavior.
- Modify `backend/tests/realtime.controller.test.js` — SSE ordering, filtering, cleanup, readiness, and failures.
- Create `backend/tests/realtime.transport.test.js` — Upstash REST request and SSE parser tests.
- Modify `backend/tests/env.test.js` — clustered configuration validation.
- Modify `frontend/lib/realtime.ts` — refresh on `ready` as well as `update`.
- Modify `frontend/components/support/SupportInbox.tsx` — bounded polling fallback with cleanup.
- Modify `frontend/tests/unit/realtime.test.ts` and `frontend/tests/unit/support-inbox.test.tsx` — client reconciliation and polling.
- Modify `docs/environment-reference.md`, `backend/README.md`, and `docs/production-runbook.md` — deployment guidance and rollback.

---

### Task 1: Add the Upstash Pub/Sub transport adapter

**Files:**
- Create: `backend/src/modules/realtime/realtime.transport.js`
- Modify: `backend/src/config/env.js`
- Modify: `backend/.env.example`
- Test: `backend/tests/realtime.transport.test.js`
- Test: `backend/tests/env.test.js`

**Interfaces:**
- Produces `createRealtimeTransport({ fetchImpl, logger, now, random })`.
- The returned object exposes:
  - `publish(envelope): Promise<void>`;
  - `start(onEnvelope, onStatus): Promise<void>`;
  - `stop(): Promise<void>`;
  - `getStatus(): { required: boolean; connected: boolean; lastErrorAt: string|null }`.
- `start` parses only `message,<channel>,<payload>` Upstash frames and passes the decoded envelope to `onEnvelope`.
- `onStatus({ connected, reason })` is used by the service for readiness and reconciliation.

- [ ] **Step 1: Add failing publish request tests.**

Test that a valid envelope sends a `POST` to the URL shape
`{UPSTASH_REDIS_REST_URL}/publish/{encodedChannel}/{encodedMessage}` with
`Authorization: Bearer {UPSTASH_REDIS_REST_TOKEN}`, and that non-2xx or JSON
error responses reject the returned promise.

```js
const transport = createRealtimeTransport({ fetchImpl: fakeFetch });
await transport.publish(envelope);
assert.equal(calls[0].method, "POST");
assert.match(calls[0].url, /\/publish\/[^/]+\/[^/]+$/);
assert.equal(calls[0].headers.Authorization, "Bearer test-token");
```

- [ ] **Step 2: Run the transport tests and verify they fail.**

Run: `node --test tests/realtime.transport.test.js`

Expected: FAIL because the adapter and exported factory do not exist.

- [ ] **Step 3: Implement publish and envelope limits.**

Use native `fetch`, URL-encode both channel and serialized envelope, apply
`AbortSignal.timeout(env.CACHE_CONNECTION_TIMEOUT_MS)` to publish only, and
reject serialized messages larger than `env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES`.
Do not apply a short timeout to the long-lived subscribe request.

- [ ] **Step 4: Add failing SSE parser and reconnect tests.**

Feed a mocked `ReadableStream` containing:

```text
data: subscribe,quest-realtime,1

data: message,quest-realtime,{"version":1,"eventId":"e1"}

```

Assert that only the decoded `e1` envelope reaches `onEnvelope`, malformed
JSON is ignored, EOF schedules a reconnect, and `stop()` cancels the active
request and prevents another reconnect.

- [ ] **Step 5: Implement the long-lived subscribe loop.**

POST to `{UPSTASH_REDIS_REST_URL}/subscribe/{encodedChannel}` with the bearer
token and `Accept: text/event-stream`. Parse SSE records by blank-line
boundaries, accept only `message` records for the configured channel, and
reconnect after EOF, network errors, and non-success responses using bounded
exponential backoff with jitter. Make `start` and `stop` idempotent.

- [ ] **Step 6: Add configuration and validation tests.**

Add explicit settings for the namespaced channel, worker ID, maximum message
bytes, and bounded reconnect delays. Preserve single-process memory defaults;
when `API_PROCESS_COUNT > 1`, require `CACHE_DRIVER=upstash` and both Upstash
credentials. Reject a non-positive message limit or reconnect delay.

- [ ] **Step 7: Run the focused transport/config tests.**

Run: `node --test tests/realtime.transport.test.js tests/env.test.js`

Expected: all focused tests pass.

- [ ] **Step 8: Commit the transport slice.**

```bash
git add backend/src/modules/realtime/realtime.transport.js backend/src/config/env.js backend/.env.example backend/tests/realtime.transport.test.js backend/tests/env.test.js
git commit -m "feat: add Upstash realtime transport"
```

---

### Task 2: Integrate shared fan-out into the realtime service

**Files:**
- Modify: `backend/src/modules/realtime/realtime.service.js`
- Modify: `backend/src/server.js`
- Test: `backend/tests/realtime.service.test.js`

**Interfaces:**
- Preserve existing exports and add:
  - `startRealtimeTransport(): Promise<void>`;
  - `stopRealtimeTransport(): Promise<void>`;
  - `isRealtimeTransportReady(): boolean`;
  - `requestRealtimeReconciliation(): void`.
- Existing local event shape remains `{ id, topic, occurredAt, payload }`.
- Shared envelope shape is `{ version, eventId, origin, topic, timestamp, payload }`.

- [ ] **Step 1: Add failing service tests for local-first publication.**

Assert that `publishRealtimeEvent` emits synchronously to local subscribers,
returns the existing event shape, and invokes shared `publish` without making
the caller await or observe its rejection.

- [ ] **Step 2: Add failing tests for remote delivery and reflection suppression.**

Inject a fake transport, deliver an envelope whose `origin` differs from the
worker ID, and assert one local event. Deliver an envelope whose `origin`
matches the worker and assert no second local event.

- [ ] **Step 3: Implement worker identity and envelope validation.**

Generate one stable worker ID per process from configured worker ID plus a
process-local suffix. Validate version, event ID, origin, topic, timestamp,
payload size, and topic syntax before emitting remote events. Preserve the
existing local event sequence for diagnostics.

- [ ] **Step 4: Implement lifecycle and readiness.**

Start one transport subscriber per worker when shared transport is required;
do not create an Upstash subscriber for single-process memory mode. Track
connected state and last error. On subscriber recovery, emit a synthetic
reconciliation event that controllers can deliver without exposing private
topics across clients. Make repeated start/stop calls safe.

- [ ] **Step 5: Add failure and status tests.**

Cover publish rejection, malformed remote envelopes, recovery reconciliation,
idempotent lifecycle calls, and `getRealtimeStatus()` fields for local counts,
published events, required/connected shared transport, and last error.

- [ ] **Step 6: Run the service tests.**

Run: `node --test tests/realtime.service.test.js tests/realtime.transport.test.js`

Expected: all tests pass with no unhandled rejection output.

- [ ] **Step 7: Commit the service slice.**

```bash
git add backend/src/modules/realtime/realtime.service.js backend/src/server.js backend/tests/realtime.service.test.js
git commit -m "feat: fan out realtime events across workers"
```

---

### Task 3: Make SSE readiness and shared-bus failure explicit

**Files:**
- Modify: `backend/src/modules/realtime/realtime.controller.js`
- Modify: `backend/src/lib/openapi.js`
- Test: `backend/tests/realtime.controller.test.js`

**Interfaces:**
- Preserve `getRealtimeEvents(req, res)` and all existing topic authorization.
- `ready` remains an SSE event; it gains a stable `reconcile: true` marker.
- Shared transport recovery is delivered as a local reconciliation update with
  no private topic and must pass through the existing requested-topic filter.

- [ ] **Step 1: Add failing ordering tests.**

Use a fake response and event subscription to assert the listener is installed
before the first `ready` write. Emit an event during setup and assert the client
receives it rather than losing it in the setup gap.

- [ ] **Step 2: Add failing authorization and failure tests.**

Retain tests for exact/root topic filtering, private user and match-room access,
connection caps, close/abort cleanup, disabled `204`, and add a `503` response
when clustered shared transport is required but not connected.

- [ ] **Step 3: Implement listener-before-ready and close ordering.**

Define `close` before callbacks can invoke it, register the local listener and
heartbeat cleanup, then write `retry` and `ready`. Emit reconciliation on ready
and shared recovery without changing existing update payloads or private-topic
authorization.

- [ ] **Step 4: Add OpenAPI metadata.**

Document `/api/v1/events` as supporting public and authorized private topics,
retain the existing query parameter, add `403`, `429`, and clustered `503`
responses, and state that events trigger persisted-state refresh rather than
providing durable replay.

- [ ] **Step 5: Run controller/OpenAPI tests.**

Run: `node --test tests/realtime.controller.test.js tests/openapi.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit the SSE slice.**

```bash
git add backend/src/modules/realtime/realtime.controller.js backend/src/lib/openapi.js backend/tests/realtime.controller.test.js backend/tests/openapi.test.js
git commit -m "feat: make SSE reconnects reconcile state"
```

---

### Task 4: Add frontend reconciliation and support polling

**Files:**
- Modify: `frontend/lib/realtime.ts`
- Modify: `frontend/components/support/SupportInbox.tsx`
- Test: `frontend/tests/unit/realtime.test.ts`
- Test: `frontend/tests/unit/support-inbox.test.tsx`

**Interfaces:**
- Preserve `subscribeToRealtimeUpdates(topic, onUpdate): () => void`.
- `onUpdate` remains a no-argument authoritative refetch callback.
- Support polling uses the existing `listSupportConversations` and
  `getSupportConversation` functions; it does not add a new API route.

- [ ] **Step 1: Add failing realtime client tests.**

Mock `EventSource`, dispatch `ready` and `update`, and assert `onUpdate` runs
for both. Assert unsubscribe closes the source even when called before the
health request resolves.

- [ ] **Step 2: Implement `ready` reconciliation.**

Register `ready` and `update` listeners immediately after constructing
EventSource. Keep the existing health gate, credentials, URL, and cleanup.

- [ ] **Step 3: Add failing support polling tests.**

Render an authenticated inbox with SSE unavailable, advance fake timers by the
bounded interval, and assert list refresh. With a selected conversation, assert
the thread refreshes and cleanup prevents calls after unmount.

- [ ] **Step 4: Implement bounded support polling.**

Add one interval while an authenticated user is present, use a 30-second
interval, call `loadList` and `loadThread` when applicable, and clear it on
logout, conversation change, and unmount. Keep realtime callbacks as the fast
path and prevent overlapping loads through the existing async state or a local
in-flight guard.

- [ ] **Step 5: Run frontend unit tests and type/lint checks.**

Run from `frontend/`:

```powershell
npm run test
npm run lint
npm run typecheck
```

Expected: existing tests plus the new reconciliation/polling tests pass.

- [ ] **Step 6: Commit the frontend slice.**

```bash
git add frontend/lib/realtime.ts frontend/components/support/SupportInbox.tsx frontend/tests/unit/realtime.test.ts frontend/tests/unit/SupportInbox.test.tsx
git commit -m "feat: reconcile realtime consumers on reconnect"
```

---

### Task 5: Document deployment and add cross-worker verification

**Files:**
- Modify: `docs/environment-reference.md`
- Modify: `backend/README.md`
- Modify: `docs/production-runbook.md`
- Create: `backend/scripts/realtime-cluster-smoke.js` — optional two-worker staging smoke test.
- Test: `backend/tests/realtime.cluster.integration.test.js` — deterministic two-worker contract test.

**Interfaces:**
- The integration harness starts two API workers with separate local emitters,
  one shared Upstash channel, and the same database.
- It uses existing SSE clients and persisted-state APIs; it does not assert
  transient replay ordering.

- [ ] **Step 1: Add a mocked two-worker contract test.**

Instantiate two service/transport pairs with different worker IDs, publish from
worker A, deliver the shared envelope to worker B, and assert one event at each
worker with no reflected duplicate on A. Assert a recovered subscriber emits
reconciliation.

- [ ] **Step 2: Add the staging smoke test path.**

Create `backend/scripts/realtime-cluster-smoke.js` using the explicit variables
`REALTIME_CLUSTER_WORKER_A_URL`, `REALTIME_CLUSTER_WORKER_B_URL`,
`REALTIME_CLUSTER_COOKIE`, `REALTIME_CLUSTER_TOPIC`,
`REALTIME_CLUSTER_MUTATION_URL`, `REALTIME_CLUSTER_MUTATION_METHOD`, and
`REALTIME_CLUSTER_MUTATION_BODY`. The script connects SSE clients to both
workers, performs the configured JSON mutation with the cookie, and reports
whether both streams observe a refresh, whether reconnect emits `ready`, and
whether the private topic is isolated. Exit non-zero when any assertion fails;
do not silently skip when the script is invoked.

- [ ] **Step 3: Update operational documentation.**

Document the exact `CACHE_DRIVER=upstash`, `API_PROCESS_COUNT`, channel prefix,
worker ID, and Upstash credential requirements; explain that the Upstash
subscription is `POST /subscribe/{channel}` SSE and publication is
`POST /publish/{channel}/{message}`. Add PM2 worker-count verification,
heartbeat/proxy timeout verification, and rollback by disabling SSE or scaling
to one worker.

- [ ] **Step 4: Run integration verification.**

Run the mocked cluster test unconditionally:

```powershell
node --test tests/realtime.cluster.integration.test.js
```

Run the staging smoke test only when its seven documented variables are set:

```powershell
node scripts/realtime-cluster-smoke.js
```

Expected: the mocked contract passes; the staging smoke test exits zero when
the real two-worker exercise is configured.

- [ ] **Step 5: Commit documentation and cluster verification.**

```bash
git add docs/environment-reference.md backend/README.md docs/production-runbook.md backend/scripts/realtime-cluster-smoke.js backend/tests/realtime.cluster.integration.test.js
git commit -m "docs: verify clustered realtime deployment"
```

---

### Task 6: Full verification, review, and push

**Files:**
- Review all tracked changes from Tasks 1–5.
- Do not stage the three existing untracked planning documents.

- [ ] **Step 1: Run backend verification.**

From `backend/`:

```powershell
npm run lint
npm test
npm run test:coverage
npm run test:integration
```

Expected: zero failures, coverage thresholds met, and integration tests pass.

- [ ] **Step 2: Run frontend verification.**

From `frontend/`:

```powershell
npm run test
npm run lint
npm run typecheck
```

Expected: zero failures.

- [ ] **Step 3: Inspect the final diff.**

Run:

```powershell
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Confirm no Prisma schema/migration, payment, identity, mobile-admin, or
untracked planning-doc changes are included.

- [ ] **Step 4: Request independent review.**

Have a read-only reviewer inspect cross-worker fan-out, SSE authorization,
failure semantics, event envelope validation, frontend cleanup, and deployment
documentation. Fix every Critical or Important finding before pushing.

- [ ] **Step 5: Push the task commits.**

```powershell
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: both revisions match and only the three pre-existing planning docs
remain untracked.
