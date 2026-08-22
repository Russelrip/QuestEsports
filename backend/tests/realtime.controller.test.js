const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/realtime/realtime.controller.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const servicePath = path.join(__dirname, "../src/modules/realtime/realtime.service.js");
const matchRoomServicePath = path.join(__dirname, "../src/modules/match-rooms/match-room.service.js");

const createRequest = ({ query = {}, user = null } = {}) => {
  const handlers = new Map();
  return {
    query,
    user,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    on(event, handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event) {
      handlers.get(event)?.();
    },
  };
};

const createResponse = () => {
  const response = {
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
    json(value) {
      this.body = value;
      return this;
    },
  };
  return response;
};

const createRealtimeController = ({
  env = { REALTIME_SSE_ENABLED: true },
  subscribeToRealtimeEvents = () => () => {},
  openRealtimeConnection = () => true,
  closeRealtimeConnection = () => {},
  isRealtimeTransportReady = () => true,
  accessRoom = async () => {},
} = {}) => loadModuleWithMocks(controllerPath, {
  [envPath]: { env },
  [servicePath]: {
    subscribeToRealtimeEvents,
    openRealtimeConnection,
    closeRealtimeConnection,
    isRealtimeTransportReady,
  },
  [matchRoomServicePath]: { accessRoom },
});

test("disabled realtime returns 204 so EventSource stops reconnecting", async () => {
  let statusCode;
  let ended = false;
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [envPath]: { env: { REALTIME_SSE_ENABLED: false } },
    [servicePath]: {
      subscribeToRealtimeEvents: () => () => {},
      openRealtimeConnection: () => true,
      closeRealtimeConnection: () => {},
    },
    [matchRoomServicePath]: { accessRoom: async () => {} },
  });

  const response = {
    status(value) {
      statusCode = value;
      return this;
    },
    end() {
      ended = true;
    },
  };

  try {
    await controller.getRealtimeEvents({ query: {} }, response);
    assert.equal(statusCode, 204);
    assert.equal(ended, true);
  } finally {
    restore();
  }
});

test("installs the listener before ready and does not lose setup events", async () => {
  const response = createResponse();
  let subscribed = false;
  let unsubscribed = false;
  const { module: controller, restore } = createRealtimeController({
    subscribeToRealtimeEvents(listener) {
      subscribed = true;
      listener({
        id: "setup-event",
        topic: "matches",
        occurredAt: "2026-08-22T00:00:00.000Z",
        payload: { matchId: "m-1" },
      });
      return () => {
        unsubscribed = true;
      };
    },
  });

  try {
    const request = createRequest({ query: { topics: "matches" } });
    await controller.getRealtimeEvents(request, response);
    assert.equal(subscribed, true);
    assert.match(response.writes[0], /^id: setup-event\nevent: update\n/);
    assert.match(response.writes[1], /^retry: 5000\nevent: ready\n/);
    const readyData = JSON.parse(response.writes[1].split("data: ")[1]);
    assert.equal(typeof readyData.serverNow, "string");
    assert.equal(readyData.reconcile, true);
    request.emit("close");
    assert.equal(unsubscribed, true);
    assert.equal(response.ended, true);
  } finally {
    restore();
  }
});

test("preserves exact and root topic filtering and cleanup", async () => {
  let listener;
  let unsubscribeCalls = 0;
  let closeCalls = 0;
  const { module: controller, restore } = createRealtimeController({
    subscribeToRealtimeEvents(callback) {
      listener = callback;
      return () => {
        unsubscribeCalls += 1;
      };
    },
    closeRealtimeConnection() {
      closeCalls += 1;
    },
  });

  try {
    const request = createRequest({ query: { topics: "matches:featured" } });
    const response = createResponse();
    await controller.getRealtimeEvents(request, response);
    const readyWrite = response.writes.length;
    listener({ id: "root", topic: "matches", payload: {} });
    listener({ id: "exact", topic: "matches:featured", payload: {} });
    listener({ id: "reconcile", topic: "reconciliation", payload: { reconcile: true } });
    listener({ id: "other", topic: "brackets", payload: {} });
    assert.equal(response.writes.length, readyWrite + 2);
    assert.match(response.writes.at(-2), /^id: exact\nevent: update\n/);
    assert.match(response.writes.at(-1), /^id: reconcile\nevent: update\n/);
    request.emit("aborted");
    request.emit("close");
    assert.equal(unsubscribeCalls, 1);
    assert.equal(closeCalls, 1);
  } finally {
    restore();
  }
});

test("drains active SSE clients so shutdown does not wait for heartbeats", async () => {
  let unsubscribeCalls = 0;
  const { module: controller, restore } = createRealtimeController({
    subscribeToRealtimeEvents() {
      return () => {
        unsubscribeCalls += 1;
      };
    },
  });
  const response = createResponse();

  try {
    await controller.getRealtimeEvents(createRequest(), response);
    assert.equal(response.ended, false);
    assert.equal(controller.drainRealtimeConnections(), 1);
    assert.equal(response.ended, true);
    assert.equal(unsubscribeCalls, 1);
  } finally {
    controller.drainRealtimeConnections();
    restore();
  }
});

test("authorizes user and match-room private topics", async () => {
  let accessCode;
  let opened = 0;
  const { module: controller, restore } = createRealtimeController({
    openRealtimeConnection() {
      opened += 1;
      return true;
    },
    accessRoom: async ({ code }) => {
      accessCode = code;
    },
  });

  try {
    await assert.rejects(
      controller.getRealtimeEvents(
        createRequest({ query: { topics: "user:other" }, user: { id: "user-1" } }),
        createResponse(),
      ),
      (error) => error.statusCode === 403,
    );
    await assert.rejects(
      controller.getRealtimeEvents(
        createRequest({ query: { topics: "match-room:room-1" } }),
        createResponse(),
      ),
      (error) => error.statusCode === 401,
    );
    const privateRequest = createRequest({
      query: { topics: "user:user-1,match-room:room-1" },
      user: { id: "user-1" },
    });
    await controller.getRealtimeEvents(privateRequest, createResponse());
    assert.equal(accessCode, "room-1");
    assert.equal(opened, 1);
    privateRequest.emit("close");
  } finally {
    restore();
  }
});

test("returns 429 when the realtime connection cap is reached", async () => {
  const response = createResponse();
  const { module: controller, restore } = createRealtimeController({
    openRealtimeConnection: () => false,
  });

  try {
    await controller.getRealtimeEvents(createRequest(), response);
    assert.equal(response.statusCode, 429);
    assert.equal(response.body.error.code, "realtime_limit");
  } finally {
    restore();
  }
});

test("returns retriable 503 when clustered shared transport is unavailable", async () => {
  const response = createResponse();
  let opened = false;
  const { module: controller, restore } = createRealtimeController({
    isRealtimeTransportReady: () => false,
    openRealtimeConnection: () => {
      opened = true;
      return true;
    },
  });

  try {
    await controller.getRealtimeEvents(createRequest(), response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers["Retry-After"], "5");
    assert.equal(response.body.error.code, "realtime_unavailable");
    assert.equal(opened, false);
  } finally {
    restore();
  }
});
