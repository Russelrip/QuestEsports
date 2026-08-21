# Cluster-Safe Realtime Delivery Design

**Date:** 2026-08-22  
**Plan task:** V2-P1-002  
**Status:** Approved for implementation planning

## Context

Quest currently exposes an SSE endpoint backed by a process-local
`EventEmitter`. Mutation code publishes invalidation hints synchronously, and
browser consumers refetch authoritative JSON state when they receive an
`update` event. This works with one API process, but workers have separate
emitters, event sequences, connection counters, and subscriptions. A mutation
handled by one worker therefore cannot notify clients connected to another.

The current event IDs are diagnostic identifiers only. They are not durable
cursors: they reset with a process and no event history is retained. The
existing clients also do not consume `Last-Event-ID`.

## Goals

1. Deliver realtime invalidation hints across API workers.
2. Make SSE reconnects converge on current persisted state without requiring
   durable replay of transient events.
3. Preserve the existing SSE route, topic filters, private-topic authorization,
   heartbeat, retry interval, connection caps, and disabled behavior.
4. Keep existing synchronous publication callers compatible.
5. Use the existing Upstash cache infrastructure for clustered deployments
   without adding a schema migration or a second event store.

## Non-goals

- Durable event history, ordered replay, or generic `Last-Event-ID` support.
- Redis Streams, consumer groups, a database outbox, or PostgreSQL
  `LISTEN/NOTIFY`.
- Globally exact connection limits across workers.
- Browser access to Redis or a new client-side event protocol.
- Moving authoritative state into SSE payloads.

## Architecture

### Shared fan-out

Add a thin realtime transport adapter over the existing Upstash REST command
helper. Each environment uses one namespaced Pub/Sub channel. Each API worker
owns one subscriber lifecycle and continues to fan out to its local
`EventEmitter`.

The mutation path remains:

```text
persist mutation
  -> publishRealtimeEvent (synchronous caller contract)
      -> local EventEmitter delivery
      -> best-effort Upstash publish
          -> each worker subscriber validates the envelope
              -> local EventEmitter delivery
```

The publishing worker includes an origin identifier in the envelope and
ignores its own reflected Pub/Sub message. This preserves one local delivery
per event while allowing every other worker to receive it.

Existing publishers continue to call `publishRealtimeEvent(topic, payload)`;
the transport layer owns serialization, envelope validation, publication
errors, and subscriber lifecycle. Publication is fire-and-forget after local
delivery and must never reject a request whose database mutation already
committed.

### Event envelope

The shared envelope is versioned and bounded. It contains:

- `version` — envelope format version;
- `eventId` — globally unique diagnostic identifier;
- `origin` — worker identifier used for reflection suppression;
- `topic` — the existing server-side topic string;
- `timestamp` — publication time;
- `payload` — the existing invalidation payload.

Workers reject malformed JSON, unsupported versions, missing required fields,
oversized messages, and invalid topics before local emission. The envelope’s
`eventId` is not a replay cursor and is not exposed as a promise of delivery.

## SSE lifecycle and reconciliation

The controller registers the local event listener before writing the `ready`
event. This removes the current ready/subscription race.

Every `ready` event causes the frontend subscriber to invoke its authoritative
refresh callback. Browser `update` events continue to trigger the same refresh.
Thus a reconnect refreshes state even when an event occurred while the client
was disconnected or between listener setup and `ready`.

When a worker’s shared subscriber reconnects after a transport interruption, it
emits a local reconciliation signal to its connected clients. Consumers refresh
their persisted state; no transient event replay is attempted.

SSE behavior remains:

- `204` when realtime SSE is intentionally disabled;
- existing `retry: 5000` and 25-second heartbeats;
- existing topic filtering and private-topic authorization;
- cleanup on close and abort;
- per-worker connection caps.

When clustered SSE requires Upstash and the worker cannot establish its shared
subscriber, the endpoint returns a retriable `503` instead of silently serving
split-brain process-local events. Existing single-process operation and
explicitly disabled SSE remain supported.

## Frontend behavior

`frontend/lib/realtime.ts` remains an EventSource wrapper. It refreshes on
`ready` and `update`, closes on unsubscribe, and does not attempt to interpret
payloads as authoritative state.

The support inbox receives a bounded polling fallback because it currently has
no independent polling loop. Other existing consumers already refetch on a
bounded cadence or on their normal query lifecycle. This fallback is a safety
net, not a replacement for shared low-latency fan-out.

## Configuration and deployment

The existing `CACHE_DRIVER=upstash` and `API_PROCESS_COUNT` configuration is
the source of truth for clustered requirements. Documentation must state that:

- multi-process SSE requires Upstash;
- `API_PROCESS_COUNT` must match the actual PM2 worker count;
- single-process memory mode remains valid for local development;
- SSE can be disabled as a rollback or emergency fallback.

The implementation must not assume that setting `API_PROCESS_COUNT` itself
creates PM2 workers. Deployment/runbook documentation will call out the
required process topology and verify it operationally.

## Security and compatibility

- Redis credentials and channels remain server-side only.
- Topic authorization stays in the existing SSE controller.
- Remote envelopes are validated before they enter the local emitter.
- Private user, match-room, veto, and support topics retain their current
  authorization rules.
- Existing public consumers and code-based veto flows are unchanged.
- No database schema, migration, payment, or identity behavior changes.
- OpenAPI will describe the private topic capability and the clustered shared
  transport requirement without exposing internal credentials or topology
  details that are not needed by clients.

## Failure and recovery semantics

1. Local delivery happens immediately after the caller submits a valid event.
2. Upstash publication failure is logged and observed but does not reject the
   mutation request.
3. A subscriber may temporarily lose shared delivery; connected clients remain
   usable through their authoritative refresh/polling paths.
4. After subscriber recovery, the worker emits reconciliation so connected
   clients converge without replaying missed transient events.
5. Subscriber startup, shutdown, and reconnect are idempotent and bounded.
6. If clustered SSE has no usable shared subscriber at connection time, the
   endpoint fails closed with `503` rather than giving a false impression of
   cross-worker delivery.

## Verification strategy

### Unit and contract tests

- local publication remains synchronous for callers;
- shared publication occurs once per event;
- remote envelopes are delivered locally;
- origin reflections are suppressed;
- malformed, oversized, unsupported, and invalid-topic envelopes are ignored;
- subscriber startup, shutdown, retry, and recovery are idempotent;
- recovery emits reconciliation;
- controller listener registration precedes `ready`;
- topic filtering, private authorization, connection caps, close/abort cleanup,
  disabled `204`, and unavailable-shared-bus `503` remain correct;
- frontend `ready` and `update` both refresh state, EventSource cleanup works,
  and support polling recovers without SSE.

### Cross-worker integration

Against a real staging Upstash transport at least once:

1. Connect SSE clients to two API workers.
2. Mutate through worker A and verify both clients refresh.
3. Verify worker A does not process its own reflected message twice.
4. Disconnect and reconnect a client after a mutation; verify `ready`
   reconciliation observes current persisted state.
5. Interrupt and restore worker B’s subscriber; verify recovery reconciliation
   or polling converges.
6. Restart a worker while an EventSource client remains active.
7. Verify private topic isolation across users and rooms.

The normal backend lint, unit suite, coverage, and database integration suite
remain required. Deployment verification must also compare actual PM2 worker
count with `API_PROCESS_COUNT` and confirm heartbeat/proxy behavior.

## Rollback

Rollback requires no data reversal. Either disable `REALTIME_SSE_ENABLED` so
clients use their polling paths, or scale back to one API worker with
`API_PROCESS_COUNT=1`. The existing local event path remains available for
single-process operation.

## Expected implementation surface

Likely changes are limited to:

- `backend/src/modules/realtime/realtime.service.js`;
- `backend/src/modules/realtime/realtime.controller.js`;
- `backend/src/lib/cache.js` or a thin adjacent transport adapter;
- realtime environment/configuration and examples;
- backend realtime tests and integration harness;
- `frontend/lib/realtime.ts` and support inbox polling;
- OpenAPI and deployment/environment documentation.

No Prisma schema or migration is expected.
