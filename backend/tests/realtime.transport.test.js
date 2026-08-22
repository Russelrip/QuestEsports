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

test("publish rejects a successful JSON response that contains an error", async () => {
  const transport = createRealtimeTransport({
    fetchImpl: async () => response(200, { error: "command rejected" }),
  });

  await assert.rejects(() => transport.publish(envelope), /command rejected/);
});

test("publish reads a non-JSON error response once and preserves its message", async () => {
  let reads = 0;
  const transport = createRealtimeTransport({
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      text: async () => {
        reads += 1;
        return "upstream unavailable";
      },
    }),
  });

  await assert.rejects(() => transport.publish(envelope), /upstream unavailable/);
  assert.equal(reads, 1);
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

test("an envelope at the serialized byte limit round-trips through publish and subscribe", async () => {
  const emptyEnvelopeSize = Buffer.byteLength(JSON.stringify({ payload: "" }), "utf8");
  const exactEnvelope = {
    payload: "x".repeat(1024 - emptyEnvelopeSize),
  };
  const serialized = JSON.stringify(exactEnvelope);
  assert.equal(Buffer.byteLength(serialized, "utf8"), 1024);

  const publishTransport = createRealtimeTransport({
    fetchImpl: async (url) => {
      assert.match(url, new RegExp(encodeURIComponent(serialized)));
      return response(200, {});
    },
  });
  await publishTransport.publish(exactEnvelope);

  const received = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: message,quest-realtime,${serialized}\n\n`),
      );
      controller.close();
    },
  });
  const subscribeTransport = createRealtimeTransport({
    fetchImpl: async () => response(200, { body: stream }),
  });
  await subscribeTransport.start((value) => received.push(value));
  await wait(10);
  await subscribeTransport.stop();

  assert.deepEqual(received, [exactEnvelope]);
});

test("reconnect backoff increases after repeated EOFs and stays bounded", async () => {
  const requestedDelays = [];
  const pendingTimers = [];
  const calls = [];
  const setTimeoutImpl = (callback, delay) => {
    const timer = { callback, cancelled: false };
    requestedDelays.push(delay);
    pendingTimers.push(timer);
    return timer;
  };
  const clearTimeoutImpl = (timer) => {
    timer.cancelled = true;
  };
  const flushMicrotasks = async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  };
  const runNextTimer = async () => {
    const timer = pendingTimers.shift();
    assert.ok(timer);
    if (!timer.cancelled) timer.callback();
    await flushMicrotasks();
  };
  const emptyStream = () =>
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  const transport = createRealtimeTransport({
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return response(200, { body: emptyStream() });
    },
    random: () => 1,
    setTimeoutImpl,
    clearTimeoutImpl,
  });

  await transport.start(() => {});
  await flushMicrotasks();
  await runNextTimer();
  await runNextTimer();
  await runNextTimer();
  await transport.stop();

  assert.ok(calls.length >= 4);
  assert.deepEqual(requestedDelays.slice(0, 4), [5, 10, 10, 10]);
  assert.equal(Math.max(...requestedDelays), 10);
});

test("oversized unterminated SSE records are discarded incrementally", async () => {
  const received = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: message,quest-realtime,"));
      controller.enqueue(new TextEncoder().encode("x".repeat(2000)));
      controller.enqueue(
        new TextEncoder().encode(
          "\n\n" +
            "data: message,quest-realtime,{\"version\":1,\"eventId\":\"after-oversized\"}\n\n",
        ),
      );
      controller.close();
    },
  });
  const transport = createRealtimeTransport({
    fetchImpl: async () => response(200, { body: stream }),
  });

  await transport.start((value) => received.push(value));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await transport.stop();

  assert.deepEqual(received, [{ version: 1, eventId: "after-oversized" }]);
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
