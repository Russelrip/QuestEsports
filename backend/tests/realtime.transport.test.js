const test = require("node:test");
const assert = require("node:assert/strict");

process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.REALTIME_PUBSUB_CHANNEL = "quest-realtime";
process.env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES = "1024";
process.env.REALTIME_PUBSUB_RECONNECT_BASE_MS = "5";
process.env.REALTIME_PUBSUB_RECONNECT_MAX_MS = "10";

const { createRealtimeTransport } = require("../src/modules/realtime/realtime.transport");

const envelope = { version: 1, eventId: "e1", topic: "matches" };

const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  body: body.body,
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("publish uses the Upstash REST publish endpoint and bearer token", async () => {
  const calls = [];
  const transport = createRealtimeTransport({
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return response(200);
    },
  });

  await transport.publish(envelope);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/publish\/[^/]+\/[^/]+$/);
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.match(calls[0].url, new RegExp(encodeURIComponent("quest-realtime")));
  assert.match(calls[0].url, new RegExp(encodeURIComponent(JSON.stringify(envelope))));
  assert.ok(calls[0].signal);
});

test("publish rejects HTTP and JSON error responses", async () => {
  const transport = createRealtimeTransport({
    fetchImpl: async () => response(429, { error: "rate limited" }),
  });

  await assert.rejects(() => transport.publish(envelope), /rate limited/);
});

test("publish rejects envelopes larger than the configured byte limit", async () => {
  const transport = createRealtimeTransport({
    fetchImpl: async () => response(200),
  });

  await assert.rejects(
    () => transport.publish({ payload: "x".repeat(2000) }),
    /REALTIME_PUBSUB_MAX_MESSAGE_BYTES/,
  );
});

test("subscribe parses only matching message frames and reconnects after EOF", async () => {
  const calls = [];
  let releaseSecondRequest;
  const secondRequest = new Promise((resolve) => {
    releaseSecondRequest = resolve;
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          "data: subscribe,quest-realtime,1\n\n" +
            "data: message,other-channel,{\"version\":1,\"eventId\":\"wrong\"}\n\n" +
            "data: message,quest-realtime,{\"version\":1,\"eventId\":\"e1\"}\n\n" +
            "data: message,quest-realtime,{bad-json}\n\n",
        ),
      );
      controller.close();
    },
  });
  const transport = createRealtimeTransport({
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (calls.length === 1) return response(200, { body: stream });
      await secondRequest;
      return response(200, { body: stream });
    },
    random: () => 0,
  });
  const received = [];

  await transport.start((value) => received.push(value));
  await wait(25);

  assert.deepEqual(received, [{ version: 1, eventId: "e1" }]);
  assert.ok(calls.length >= 2);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Accept, "text/event-stream");
  assert.match(calls[0].url, /\/subscribe\/quest-realtime$/);

  await transport.stop();
  releaseSecondRequest();
  const callCount = calls.length;
  await wait(20);
  assert.equal(calls.length, callCount);
  assert.equal(transport.getStatus().connected, false);
});

test("start and stop are idempotent and stop aborts an active subscription", async () => {
  let requestOptions;
  const transport = createRealtimeTransport({
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Promise(() => {});
    },
  });

  await transport.start(() => {});
  await transport.start(() => {});
  await transport.stop();
  await transport.stop();

  assert.equal(requestOptions.signal.aborted, true);
});
