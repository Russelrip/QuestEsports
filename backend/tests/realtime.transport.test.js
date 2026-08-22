const test = require("node:test");
const assert = require("node:assert/strict");

process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.REALTIME_PUBSUB_CHANNEL = "quest-realtime";
process.env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES = "1024";
process.env.REALTIME_PUBSUB_RECONNECT_BASE_MS = "5";
process.env.REALTIME_PUBSUB_RECONNECT_MAX_MS = "10";
process.env.CACHE_CONNECTION_TIMEOUT_MS = "25";

const { createRealtimeTransport } = require("../src/modules/realtime/realtime.transport");

const envelope = { version: 1, eventId: "e1", topic: "matches" };

const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  body: body.body,
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("publish uses the Upstash REST command array body and bearer token", async () => {
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
  assert.equal(calls[0].url, "https://redis.example.com");
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].body), [
    "PUBLISH",
    "quest-realtime",
    JSON.stringify(envelope),
  ]);
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

test("subscribe does not become ready for an invalid or missing acknowledgement", async () => {
  const pendingTimers = [];
  const setTimeoutImpl = (callback, delay) => {
    const timer = { callback, delay, cancelled: false };
    pendingTimers.push(timer);
    return timer;
  };
  const clearTimeoutImpl = (timer) => {
    timer.cancelled = true;
  };
  const statuses = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode("data: subscribe,quest-realtime,0\n\n"),
      );
      controller.close();
    },
  });
  const transport = createRealtimeTransport({
    fetchImpl: async () => response(200, { body: stream }),
    setTimeoutImpl,
    clearTimeoutImpl,
  });

  await transport.start(() => {}, (status) => statuses.push(status));
  await wait(0);

  assert.equal(statuses.some((status) => status.connected), false);
  assert.equal(transport.getStatus().connected, false);
  await transport.stop();
  assert.equal(pendingTimers.every((timer) => timer.cancelled), true);
});

test("subscribe reports ready only after the documented acknowledgement", async () => {
  const statuses = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode("data: subscribe,quest-realtime,1\n\n"),
      );
    },
  });
  const transport = createRealtimeTransport({
    fetchImpl: async () => response(200, { body: stream }),
  });

  await transport.start(() => {}, (status) => statuses.push(status));
  await wait(0);

  assert.deepEqual(statuses, [{ connected: true, reason: "connected" }]);
  assert.equal(transport.getStatus().connected, true);
  await transport.stop();
});

test("an envelope at the serialized byte limit round-trips through publish and subscribe", async () => {
  const emptyEnvelopeSize = Buffer.byteLength(JSON.stringify({ payload: "" }), "utf8");
  const exactEnvelope = {
    payload: "x".repeat(1024 - emptyEnvelopeSize),
  };
  const serialized = JSON.stringify(exactEnvelope);
  assert.equal(Buffer.byteLength(serialized, "utf8"), 1024);

  const publishTransport = createRealtimeTransport({
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://redis.example.com");
      assert.deepEqual(JSON.parse(options.body), [
        "PUBLISH",
        "quest-realtime",
        serialized,
      ]);
      return response(200, {});
    },
  });
  await publishTransport.publish(exactEnvelope);

  const received = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: subscribe,quest-realtime,1\n\n` +
            `data: message,quest-realtime,${serialized}\n\n`,
        ),
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
        controller.enqueue(new TextEncoder().encode("data: subscribe,quest-realtime,1\n\n"));
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
      controller.enqueue(
        new TextEncoder().encode(
          "data: subscribe,quest-realtime,1\n\n" +
            "data: message,quest-realtime,",
        ),
      );
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

test("stop returns within its bound when fetch ignores abort", async () => {
  let requestOptions;
  const transport = createRealtimeTransport({
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Promise(() => {});
    },
  });

  await transport.start(() => {});
  const startedAt = Date.now();
  await transport.stop();

  assert.equal(requestOptions.signal.aborted, true);
  assert.ok(Date.now() - startedAt < 150);
});

test("stop returns within its bound when reader and body cancellation hang", async () => {
  const reader = {
    read: () => new Promise(() => {}),
    cancel: () => new Promise(() => {}),
    releaseLock() {},
  };
  const body = {
    getReader: () => reader,
    cancel: () => new Promise(() => {}),
  };
  const transport = createRealtimeTransport({
    fetchImpl: async () => response(200, { body }),
  });

  await transport.start(() => {});
  await wait(0);
  const startedAt = Date.now();
  await transport.stop();

  assert.ok(Date.now() - startedAt < 150);
});

test("subscribe aborts when the connection deadline expires and clears it after headers arrive", async () => {
  let timeoutCallback;
  let clearCalls = 0;
  let requestOptions;
  const transport = createRealtimeTransport({
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Promise(() => {});
    },
    setConnectionTimeoutImpl: (callback) => {
      timeoutCallback = callback;
      return { timeout: true };
    },
    clearConnectionTimeoutImpl: () => {
      clearCalls += 1;
    },
  });

  await transport.start(() => {});
  timeoutCallback();
  assert.equal(requestOptions.signal.aborted, true);
  await transport.stop();
  assert.equal(clearCalls, 1);

  let establishedClearCalls = 0;
  const establishedTransport = createRealtimeTransport({
    fetchImpl: async () => response(200, {
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
    setConnectionTimeoutImpl: (callback) => ({ callback }),
    clearConnectionTimeoutImpl: () => {
      establishedClearCalls += 1;
    },
  });
  await establishedTransport.start(() => {});
  await wait(10);
  await establishedTransport.stop();
  assert.ok(establishedClearCalls >= 1);
});

test("subscribe keeps the connection deadline active while reading an error body", async () => {
  let timeoutCallback;
  let clearCalls = 0;
  let releaseBody;
  const errorBody = new Promise((resolve) => {
    releaseBody = resolve;
  });
  const transport = createRealtimeTransport({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => errorBody,
    }),
    setConnectionTimeoutImpl: (callback) => {
      timeoutCallback = callback;
      return { timeout: true };
    },
    clearConnectionTimeoutImpl: () => {
      clearCalls += 1;
    },
  });

  await transport.start(() => {});
  await wait(5);
  assert.equal(clearCalls, 0);

  timeoutCallback();
  assert.equal(clearCalls, 0);
  releaseBody("upstream unavailable");
  await wait(0);
  assert.equal(clearCalls, 1);
  await transport.stop();
});

test("a stopped subscription cannot affect a later start", async () => {
  let resolveFirst;
  let secondRequestOptions;
  let calls = 0;
  const firstResponse = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const transport = createRealtimeTransport({
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) return firstResponse;
      secondRequestOptions = options;
      return new Promise(() => {});
    },
  });

  await transport.start(() => {});
  await transport.stop();
  const restarting = transport.start(() => {});
  await wait(0);
  assert.equal(calls, 1);
  resolveFirst(response(200, {
    body: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  }));
  await restarting;
  await wait(10);

  assert.equal(calls, 2);
  await transport.stop();
  assert.equal(secondRequestOptions.signal.aborted, true);
});

test("stop-to-start waits for a physically hanging subscription cancellation", async () => {
  let calls = 0;
  let activeSubscriptions = 0;
  let maximumActiveSubscriptions = 0;
  let releaseFirstCancellation;
  const firstCancellation = new Promise((resolve) => {
    releaseFirstCancellation = resolve;
  });
  let firstReadResolve;
  const firstRead = new Promise((resolve) => {
    firstReadResolve = resolve;
  });
  const createBody = ({ hanging }) => {
    const reader = {
      read: () => hanging ? firstRead : new Promise(() => {}),
      cancel: () => hanging
        ? firstCancellation.then(() => firstReadResolve({ done: true }))
        : Promise.resolve().then(() => firstReadResolve?.({ done: true })),
      releaseLock() {},
    };
    return {
      getReader: () => reader,
      cancel: () => hanging ? firstCancellation : Promise.resolve(),
    };
  };
  const transport = createRealtimeTransport({
    fetchImpl: async () => {
      calls += 1;
      activeSubscriptions += 1;
      maximumActiveSubscriptions = Math.max(maximumActiveSubscriptions, activeSubscriptions);
      const hanging = calls === 1;
      const body = createBody({ hanging });
      const originalCancel = body.cancel;
      body.cancel = () => Promise.resolve(originalCancel()).finally(() => {
        activeSubscriptions -= 1;
      });
      return response(200, { body });
    },
  });

  await transport.start(() => {});
  await wait(0);
  await transport.stop();

  let restarted = false;
  const restarting = transport.start(() => {}).then(() => {
    restarted = true;
  });
  await wait(35);
  assert.equal(calls, 1);
  assert.equal(restarted, false);

  releaseFirstCancellation();
  await restarting;
  assert.equal(calls, 2);
  assert.equal(maximumActiveSubscriptions, 1);
  await transport.stop();
});

test("stop cancels a never-ending response that resolves after the subscription is stale", async () => {
  let calls = 0;
  let cancellations = 0;
  const neverEndingBody = () =>
    new ReadableStream({
      cancel() {
        cancellations += 1;
      },
    });
  const transport = createRealtimeTransport({
    fetchImpl: async (_url, options) => {
      calls += 1;
      return new Promise((resolve) => {
        options.signal.addEventListener(
          "abort",
          () => resolve(response(200, { body: neverEndingBody() })),
          { once: true },
        );
      });
    },
  });

  await transport.start(() => {});
  await wait(5);
  await transport.stop();
  assert.equal(cancellations, 1);

  await transport.start(() => {});
  await wait(5);
  await transport.stop();
  assert.equal(calls, 2);
  assert.equal(cancellations, 2);
});
