const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const backendRoot = path.join(__dirname, "..");
const servicePath = path.join(backendRoot, "src/modules/realtime/realtime.service.js");
const envPath = path.join(backendRoot, "src/config/env.js");
const transportPath = path.join(backendRoot, "src/modules/realtime/realtime.transport.js");
const loggerPath = path.join(backendRoot, "src/lib/logger.js");
const controllerPath = path.join(backendRoot, "src/modules/realtime/realtime.controller.js");
const matchRoomServicePath = path.join(backendRoot, "src/modules/match-rooms/match-room.service.js");
const smokeScriptPath = path.join(backendRoot, "scripts/realtime-cluster-smoke.js");

const createSharedTransports = () => {
  const states = new Map();
  const published = [];

  const createTransport = (workerId) => {
    const state = {
      workerId,
      envelopeHandler: null,
      statusHandler: null,
      started: false,
    };
    states.set(workerId, state);

    return {
      state,
      publish(envelope) {
        published.push({ workerId, envelope });
        for (const subscriber of states.values()) {
          if (subscriber.started && subscriber.envelopeHandler) {
            subscriber.envelopeHandler(envelope);
          }
        }
        return Promise.resolve();
      },
      async start(envelopeHandler, statusHandler) {
        state.envelopeHandler = envelopeHandler;
        state.statusHandler = statusHandler;
        state.started = true;
        statusHandler({ connected: true, reason: "connected" });
      },
      async stop() {
        state.started = false;
        state.statusHandler?.({ connected: false, reason: "stopped" });
      },
    };
  };

  return { createTransport, published };
};

const createIsolatedService = (workerId, transport) => {
  const isolated = loadModuleWithMocks(servicePath, {
    [envPath]: {
      env: {
        API_PROCESS_COUNT: 2,
        REALTIME_WORKER_ID: workerId,
        REALTIME_PUBSUB_MAX_MESSAGE_BYTES: 4096,
      },
    },
    [transportPath]: { createRealtimeTransport: () => transport },
    [loggerPath]: { logger: { warn() {}, debug() {} } },
  });
  isolated.module.setRealtimeTransportForTests(transport, { required: true });
  return isolated;
};

const createRequest = (query, user, ip) => {
  const handlers = new Map();
  return {
    query,
    user,
    ip,
    socket: { remoteAddress: ip },
    on(event, handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event) {
      handlers.get(event)?.();
    },
  };
};

const createResponse = () => ({
  statusCode: null,
  headers: {},
  writes: [],
  ended: false,
  status(value) {
    this.statusCode = value;
    return this;
  },
  set(nameOrHeaders, value) {
    if (typeof nameOrHeaders === "string") this.headers[nameOrHeaders] = value;
    else Object.assign(this.headers, nameOrHeaders);
    return this;
  },
  flushHeaders() {},
  write(value) {
    this.writes.push(value);
    return true;
  },
  end() {
    this.ended = true;
  },
});

test("cluster smoke uses server-to-server headers and checks a concrete foreign user topic", () => {
  const smokeSource = fs.readFileSync(smokeScriptPath, "utf8");

  assert.doesNotMatch(smokeSource, /\bOrigin\s*:/);
  assert.match(smokeSource, /user:__realtime_other_user__/);
  assert.match(smokeSource, /const assertTopicDenied = async \(workerUrl, cookie, topic\)/);
  assert.match(smokeSource, /\/api\/health\/live/);
  assert.match(smokeSource, /realtime\?\.workerId/);
});

test("two isolated workers deliver local-first and remote events exactly once", async () => {
  const shared = createSharedTransports();
  const transportA = shared.createTransport("worker-a");
  const transportB = shared.createTransport("worker-b");
  const isolatedA = createIsolatedService("worker-a", transportA);
  const isolatedB = createIsolatedService("worker-b", transportB);
  const receivedA = [];
  const receivedB = [];
  const order = [];
  const unsubscribeA = isolatedA.module.subscribeToRealtimeEvents((event) => {
    receivedA.push(event);
    order.push(`a:${event.topic}`);
  });
  const unsubscribeB = isolatedB.module.subscribeToRealtimeEvents((event) => {
    receivedB.push(event);
    order.push(`b:${event.topic}`);
  });

  try {
    await isolatedA.module.startRealtimeTransport();
    await isolatedB.module.startRealtimeTransport();
    const statusA = isolatedA.module.getRealtimeStatus();
    const statusB = isolatedB.module.getRealtimeStatus();
    assert.match(statusA.workerId, /^worker-a:\d+:[0-9a-f-]{36}$/);
    assert.match(statusB.workerId, /^worker-b:\d+:[0-9a-f-]{36}$/);
    assert.notEqual(statusA.workerId, statusB.workerId);
    const localEvent = isolatedA.module.publishRealtimeEvent("matches", {
      matchId: "match-1",
    });

    assert.deepEqual(receivedA, [localEvent]);
    assert.deepEqual(receivedB, [localEvent]);
    assert.equal(shared.published.length, 1);
    assert.deepEqual(order, ["a:matches", "b:matches"]);
    assert.equal(receivedA.filter((event) => event.id === localEvent.id).length, 1);
    assert.equal(receivedB.filter((event) => event.id === localEvent.id).length, 1);

    transportB.state.statusHandler({ connected: false, reason: "error" });
    transportB.state.statusHandler({ connected: true, reason: "reconnected" });
    assert.equal(receivedB.filter((event) => event.topic === "reconciliation").length, 1);
    assert.deepEqual(receivedB.at(-1).payload, { reconcile: true });
  } finally {
    unsubscribeA();
    unsubscribeB();
    await isolatedA.module.stopRealtimeTransport();
    await isolatedB.module.stopRealtimeTransport();
    isolatedB.restore();
    isolatedA.restore();
  }
});

test("malformed envelopes are rejected and private topics stay isolated at the controller boundary", async () => {
  const shared = createSharedTransports();
  const transportA = shared.createTransport("worker-a");
  const transportB = shared.createTransport("worker-b");
  const isolatedA = createIsolatedService("worker-a", transportA);
  const isolatedB = createIsolatedService("worker-b", transportB);
  const receivedB = [];
  const unsubscribeB = isolatedB.module.subscribeToRealtimeEvents((event) => receivedB.push(event));
  let isolatedController;
  let restoreController;
  let request;

  try {
    await isolatedA.module.startRealtimeTransport();
    await isolatedB.module.startRealtimeTransport();
    for (const envelope of [
      null,
      { version: 2, eventId: "bad-version", origin: "worker-a", topic: "matches", timestamp: "2026-08-22T00:00:00.000Z", payload: {} },
      { version: 1, eventId: "bad-topic", origin: "worker-a", topic: "not valid", timestamp: "2026-08-22T00:00:00.000Z", payload: {} },
      { version: 1, eventId: "bad-time", origin: "worker-a", topic: "matches", timestamp: "not-a-date", payload: {} },
    ]) {
      transportB.state.envelopeHandler(envelope);
    }
    assert.deepEqual(receivedB, []);

    isolatedController = loadModuleWithMocks(controllerPath, {
      [envPath]: {
        env: {
          REALTIME_SSE_ENABLED: true,
          REALTIME_SSE_MAX_CONNECTIONS: 10,
          REALTIME_SSE_MAX_CONNECTIONS_PER_IP: 2,
        },
      },
      [servicePath]: {
        subscribeToRealtimeEvents: isolatedB.module.subscribeToRealtimeEvents,
        openRealtimeConnection: isolatedB.module.openRealtimeConnection,
        closeRealtimeConnection: isolatedB.module.closeRealtimeConnection,
        isRealtimeTransportReady: isolatedB.module.isRealtimeTransportReady,
      },
      [matchRoomServicePath]: { accessRoom: async () => {} },
    });
    restoreController = isolatedController.restore;
    const controller = isolatedController.module;
    request = createRequest(
      { topics: "user:user-b" },
      { id: "user-b" },
      "cluster-test-private",
    );
    const response = createResponse();

    await controller.getRealtimeEvents(request, response);
    const writesBeforePrivateEvent = response.writes.length;
    isolatedA.module.publishRealtimeEvent("user:user-a", { secret: "not-for-user-b" });
    assert.equal(response.writes.length, writesBeforePrivateEvent);
    isolatedA.module.publishRealtimeEvent("user:user-b", { notification: "allowed" });
    assert.equal(response.writes.length, writesBeforePrivateEvent + 1);
    assert.match(response.writes.at(-1), /"topic":"user:user-b"/);

    request.emit("close");
    await assert.rejects(
      controller.getRealtimeEvents(
        createRequest({ topics: "user:user-a" }, { id: "user-b" }, "cluster-test-denied"),
        createResponse(),
      ),
      (error) => error.statusCode === 403,
    );
  } finally {
    request?.emit("close");
    restoreController?.();
    unsubscribeB();
    await isolatedA.module.stopRealtimeTransport();
    await isolatedB.module.stopRealtimeTransport();
    isolatedB.restore();
    isolatedA.restore();
  }
});
