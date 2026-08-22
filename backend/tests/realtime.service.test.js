const test = require("node:test");
const assert = require("node:assert/strict");

const realtime = require("../src/modules/realtime/realtime.service");

const waitForMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const createFakeTransport = () => {
  const state = {
    envelopeHandler: null,
    statusHandler: null,
    publishCalls: [],
    starts: 0,
    stops: 0,
  };
  return {
    state,
    publish: (envelope) => {
      state.publishCalls.push(envelope);
      return Promise.resolve();
    },
    start: async (envelopeHandler, statusHandler) => {
      state.starts += 1;
      state.envelopeHandler = envelopeHandler;
      state.statusHandler = statusHandler;
    },
    stop: async () => {
      state.stops += 1;
    },
    getStatus: () => ({ required: true, connected: false, lastErrorAt: null }),
  };
};

test.afterEach(async () => {
  await realtime.stopRealtimeTransport();
  realtime.setRealtimeTransportForTests(null);
});

test("realtime connections enforce total and per-client limits", () => {
  assert.equal(realtime.openRealtimeConnection("client-a", { maxTotal: 2, maxPerClient: 1 }), true);
  assert.equal(realtime.openRealtimeConnection("client-a", { maxTotal: 2, maxPerClient: 1 }), false);
  assert.equal(realtime.openRealtimeConnection("client-b", { maxTotal: 2, maxPerClient: 1 }), true);
  assert.equal(realtime.openRealtimeConnection("client-c", { maxTotal: 2, maxPerClient: 1 }), false);
  assert.equal(realtime.getRealtimeStatus().activeConnections, 2);
  realtime.closeRealtimeConnection("client-a");
  realtime.closeRealtimeConnection("client-b");
  assert.equal(realtime.getRealtimeStatus().activeConnections, 0);
});

test("publishes locally synchronously before best-effort shared publication", async () => {
  const transport = createFakeTransport();
  realtime.setRealtimeTransportForTests(transport, { required: true });
  const received = [];
  const unsubscribe = realtime.subscribeToRealtimeEvents((event) => received.push(event));

  const returned = realtime.publishRealtimeEvent("matches", { matchId: "m-1" });

  assert.equal(returned.topic, "matches");
  assert.deepEqual(received, [returned]);
  assert.equal(transport.state.publishCalls.length, 1);
  assert.equal(transport.state.publishCalls[0].eventId, returned.id);
  assert.equal(transport.state.publishCalls[0].origin.startsWith("worker-"), true);
  unsubscribe();
  await waitForMicrotasks();
});

test("shared publication rejection is contained after local delivery", async () => {
  const transport = createFakeTransport();
  transport.publish = () => Promise.reject(new Error("shared bus unavailable"));
  realtime.setRealtimeTransportForTests(transport, { required: true });
  const received = [];
  const unsubscribe = realtime.subscribeToRealtimeEvents((event) => received.push(event));

  const returned = realtime.publishRealtimeEvent("matches", { matchId: "m-2" });

  assert.deepEqual(received, [returned]);
  assert.equal(returned instanceof Promise, false);
  await waitForMicrotasks();
  unsubscribe();
});

test("delivers valid remote events and suppresses same-origin reflections", async () => {
  const transport = createFakeTransport();
  realtime.setRealtimeTransportForTests(transport, { required: true });
  await realtime.startRealtimeTransport();
  const received = [];
  const unsubscribe = realtime.subscribeToRealtimeEvents((event) => received.push(event));

  transport.state.envelopeHandler({
    version: 1,
    eventId: "remote-1",
    origin: "another-worker",
    topic: "matches",
    timestamp: "2026-08-22T00:00:00.000Z",
    payload: { matchId: "remote" },
  });
  const local = realtime.publishRealtimeEvent("matches", { matchId: "local" });
  transport.state.envelopeHandler(transport.state.publishCalls[0]);

  assert.deepEqual(received, [
    {
      id: "remote-1",
      topic: "matches",
      occurredAt: "2026-08-22T00:00:00.000Z",
      payload: { matchId: "remote" },
    },
    local,
  ]);
  unsubscribe();
});

test("ignores malformed remote envelopes and emits reconciliation on recovery", async () => {
  const transport = createFakeTransport();
  realtime.setRealtimeTransportForTests(transport, { required: true });
  await realtime.startRealtimeTransport();
  const received = [];
  const unsubscribe = realtime.subscribeToRealtimeEvents((event) => received.push(event));

  for (const envelope of [
    null,
    { version: 2, eventId: "bad", origin: "remote", topic: "matches", timestamp: "2026-08-22T00:00:00.000Z", payload: {} },
    { version: 1, eventId: "bad", origin: "remote", topic: "not valid", timestamp: "2026-08-22T00:00:00.000Z", payload: {} },
    { version: 1, eventId: "bad", origin: "remote", topic: "matches", timestamp: "not-a-date", payload: {} },
  ]) {
    transport.state.envelopeHandler(envelope);
  }

  transport.state.statusHandler({ connected: true, reason: "connected" });
  transport.state.statusHandler({ connected: false, reason: "error" });
  transport.state.statusHandler({ connected: true, reason: "connected" });

  assert.equal(received.length, 1);
  assert.equal(received[0].topic, "reconciliation");
  assert.deepEqual(received[0].payload, { reconcile: true });
  assert.equal(realtime.isRealtimeTransportReady(), true);
  assert.equal(realtime.getRealtimeStatus().sharedTransportRequired, true);
  assert.equal(realtime.getRealtimeStatus().sharedTransportConnected, true);
  assert.equal(realtime.getRealtimeStatus().lastErrorAt !== null, true);
  unsubscribe();
});

test("transport lifecycle is idempotent and absent in local memory mode", async () => {
  const transport = createFakeTransport();
  realtime.setRealtimeTransportForTests(transport, { required: true });

  await Promise.all([
    realtime.startRealtimeTransport(),
    realtime.startRealtimeTransport(),
  ]);
  await Promise.all([
    realtime.stopRealtimeTransport(),
    realtime.stopRealtimeTransport(),
  ]);

  assert.equal(transport.state.starts, 1);
  assert.equal(transport.state.stops, 1);

  realtime.setRealtimeTransportForTests(null, { required: false });
  await realtime.startRealtimeTransport();
  assert.equal(realtime.isRealtimeTransportReady(), true);
});
