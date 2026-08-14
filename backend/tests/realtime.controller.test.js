const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/realtime/realtime.controller.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const servicePath = path.join(__dirname, "../src/modules/realtime/realtime.service.js");
const matchRoomServicePath = path.join(__dirname, "../src/modules/match-rooms/match-room.service.js");

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
