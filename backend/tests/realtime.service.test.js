const test = require("node:test");
const assert = require("node:assert/strict");

const realtime = require("../src/modules/realtime/realtime.service");

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
