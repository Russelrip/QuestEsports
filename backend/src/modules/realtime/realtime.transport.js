const { env } = require("../../config/env");

const noop = () => {};

const asErrorText = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const readResponseBody = async (response) => {
  if (typeof response.text === "function") {
    try {
      const raw = await response.text();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch {
      return null;
    }
  }
  if (typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
};

const responseError = (response, operation, body) => {
  const details = body == null ? "" : asErrorText(body);
  return new Error(
    `Upstash ${operation} failed with HTTP ${response.status}${details ? `: ${details}` : ""}`,
  );
};

const hasErrorPayload = (body) =>
  body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "error");

const toIsoString = (value) => {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const createRealtimeTransport = ({
  fetchImpl = globalThis.fetch,
  logger = {},
  now = () => new Date(),
  random = Math.random,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setConnectionTimeoutImpl = setTimeout,
  clearConnectionTimeoutImpl = clearTimeout,
} = {}) => {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required for realtime transport.");
  }

  const baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, "");
  const channel = env.REALTIME_CHANNEL;
  const authorization = `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`;
  const maxMessageBytes = env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES;
  // Upstash emits one `data: message,<channel>,<payload>` line per frame. The
  // record limit includes only this fixed framing overhead; payload validation
  // below remains the authoritative serialized-envelope limit.
  const maxSseRecordBytes =
    maxMessageBytes +
    Buffer.byteLength(`data: message,${channel},`, "utf8");
  const required = env.API_PROCESS_COUNT > 1;

  let running = false;
  let connected = false;
  let lastErrorAt = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let activeController = null;
  let activeReader = null;
  let activeResponse = null;
  let activeBody = null;
  let activeConnectionTimer = null;
  let activeCancellationTask = null;
  let activeCancellationReader = null;
  let activeCancellationBody = null;
  let subscriptionTask = null;
  let subscriptionBarrier = null;
  let stopTask = null;
  let startTask = null;
  let generation = 0;
  let onEnvelope = noop;
  let onStatus = noop;

  const log = (method, ...args) => {
    if (typeof logger[method] === "function") logger[method](...args);
  };

  const reportStatus = (nextConnected, reason) => {
    connected = nextConnected;
    try {
      onStatus({ connected: nextConnected, reason });
    } catch (error) {
      log("warn", "Realtime status callback failed", error);
    }
  };

  const reportFailure = (reason, error) => {
    lastErrorAt = toIsoString(now());
    reportStatus(false, reason);
    if (error) log("warn", `Realtime subscription ${reason}`, error);
  };

  const awaitBounded = async (task, timeoutMs) => {
    if (!task || !(timeoutMs > 0)) return false;
    let timeout;
    const timeoutMarker = {};
    try {
      const result = await Promise.race([
        Promise.resolve(task).then(() => true, () => true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(timeoutMarker), timeoutMs);
        }),
      ]);
      return result !== timeoutMarker;
    } catch (error) {
      log("debug", "Realtime bounded operation failed", error);
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const getActiveCancellationTask = () => {
    const reader = activeReader;
    const body = activeBody;
    if (!reader && !body) return null;
    if (
      activeCancellationTask &&
      activeCancellationReader === reader &&
      activeCancellationBody === body
    ) {
      return activeCancellationTask;
    }

    const task = (async () => {
      const cancellations = [];
      if (reader && typeof reader.cancel === "function") {
        cancellations.push(Promise.resolve().then(() => reader.cancel()));
      }
      if (body && typeof body.cancel === "function") {
        cancellations.push(Promise.resolve().then(() => body.cancel()));
      }
      return Promise.allSettled(cancellations);
    })();
    activeCancellationTask = task;
    activeCancellationReader = reader;
    activeCancellationBody = body;
    return task;
  };

  const awaitSubscriptionSettlement = async (
    task,
    timeoutMs = env.CACHE_CONNECTION_TIMEOUT_MS,
  ) => {
    if (!task) return;
    await awaitBounded(task, timeoutMs);
  };

  const parseRecord = (record) => {
    const data = record
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;

    const firstComma = data.indexOf(",");
    const secondComma = firstComma < 0 ? -1 : data.indexOf(",", firstComma + 1);
    if (firstComma < 0 || secondComma < 0) return;

    const frameType = data.slice(0, firstComma);
    const frameChannel = data.slice(firstComma + 1, secondComma);
    if (frameType === "subscribe") {
      const count = data.slice(secondComma + 1);
      if (frameChannel !== channel || count !== "1") return "invalid-ack";
      return "ack";
    }
    if (frameType !== "message" || frameChannel !== channel) return;

    const payload = data.slice(secondComma + 1);
    if (Buffer.byteLength(payload, "utf8") > maxMessageBytes) return false;
    try {
      const envelope = JSON.parse(payload);
      try {
        onEnvelope(envelope);
      } catch (error) {
        log("warn", "Realtime envelope callback failed", error);
      }
      return "message";
    } catch (error) {
      log("warn", "Ignoring malformed realtime Pub/Sub payload", error);
      return false;
    }
  };

  const consumeStream = async (
    body,
    runGeneration,
    connectionDeadline,
    onAcknowledged,
  ) => {
    if (!body || typeof body.getReader !== "function") {
      throw new Error("Upstash subscribe response did not include a readable stream.");
    }
    const reader = body.getReader();
    activeReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    let discardingOversizedRecord = false;
    let acknowledged = false;
    let pendingReadTask = null;

    const consumeText = (text) => {
      let remainder = text;
      while (remainder) {
        if (discardingOversizedRecord) {
          const separator = remainder.search(/\r?\n\r?\n/);
          if (separator < 0) return;
          const match = remainder.match(/\r?\n\r?\n/);
          remainder = remainder.slice(separator + match[0].length);
          discardingOversizedRecord = false;
          continue;
        }

        buffer += remainder;
        remainder = "";
        let separator;
        while ((separator = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const match = buffer.match(/\r?\n\r?\n/);
          const record = buffer.slice(0, separator);
          if (Buffer.byteLength(record, "utf8") <= maxSseRecordBytes) {
            const parsed = parseRecord(record);
            if (parsed === "ack" && !acknowledged) {
              acknowledged = true;
              onAcknowledged();
            } else if (parsed === "message" && acknowledged) {
              reconnectAttempt = 0;
            }
          }
          buffer = buffer.slice(separator + match[0].length);
        }

        if (Buffer.byteLength(buffer, "utf8") > maxSseRecordBytes) {
          buffer = "";
          discardingOversizedRecord = true;
        }
      }
    };

    try {
      while (running && runGeneration === generation) {
        const readTask = reader.read();
        pendingReadTask = readTask;
        const result = acknowledged
          ? await readTask
          : await Promise.race([readTask, connectionDeadline]);
        pendingReadTask = null;
        if (result.done) break;
        if (!running || runGeneration !== generation) break;
        consumeText(
          typeof result.value === "string"
            ? result.value
            : decoder.decode(result.value, { stream: true }),
        );
      }
      if (running && runGeneration === generation) consumeText(decoder.decode());
      if (!acknowledged) {
        throw new Error("Upstash subscribe stream did not provide a valid acknowledgement.");
      }
    } finally {
      // A cancelled reader can resolve its cancellation promise before the
      // read promise settles. Keep the physical subscription task pending for
      // both operations so reconnect cannot overlap the old upstream stream.
      const cancellationTask = pendingReadTask ? getActiveCancellationTask() : null;
      if (pendingReadTask) {
        await Promise.allSettled(
          [pendingReadTask, cancellationTask].filter(Boolean),
        );
      }
      if (activeReader === reader) activeReader = null;
      if (typeof reader.releaseLock === "function") {
        try {
          reader.releaseLock();
        } catch (error) {
          log("debug", "Realtime reader lock release failed", error);
        }
      }
    }
  };

  const scheduleReconnect = (runGeneration, reason, error) => {
    if (!running || runGeneration !== generation || reconnectTimer) return;
    reportFailure(reason, error);
    const baseDelay = Math.min(
      env.REALTIME_PUBSUB_RECONNECT_MAX_MS,
      env.REALTIME_PUBSUB_RECONNECT_BASE_MS * 2 ** reconnectAttempt,
    );
    const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
    const delay = Math.min(
      env.REALTIME_PUBSUB_RECONNECT_MAX_MS,
      Math.round(baseDelay * (0.5 + jitter * 0.5)),
    );
    reconnectAttempt += 1;
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      if (running && runGeneration === generation) beginSubscription(runGeneration);
    }, delay);
  };

  const subscribe = async (runGeneration) => {
    if (!running || runGeneration !== generation) return;
    const controller = new AbortController();
    let connectionDeadlineExceeded = false;
    let rejectConnectionDeadline;
    const connectionDeadline = new Promise((_, reject) => {
      rejectConnectionDeadline = reject;
    });
    connectionDeadline.catch(noop);
    let connectionTimer = setConnectionTimeoutImpl(() => {
      connectionDeadlineExceeded = true;
      controller.abort();
      const timeoutError = new Error(
        "Realtime subscription connection deadline exceeded.",
      );
      if (running && runGeneration === generation) {
        // A deadline means the transport cannot prove that the upstream
        // subscription stopped. Do not enter reconnect mode while that
        // physical task is still outstanding.
        running = false;
        generation += 1;
        reportFailure("connection-timeout", timeoutError);
      }
      rejectConnectionDeadline(timeoutError);
    }, env.CACHE_CONNECTION_TIMEOUT_MS);
    activeConnectionTimer = connectionTimer;
    activeController = controller;
    let response = null;
    let fetchTask = null;
    let responseBodyTask = null;
    const clearConnectionTimer = () => {
      if (!connectionTimer) return;
      if (activeConnectionTimer === connectionTimer) {
        clearConnectionTimeoutImpl(connectionTimer);
        activeConnectionTimer = null;
      }
      connectionTimer = null;
    };
    try {
      fetchTask = Promise.resolve().then(() =>
        fetchImpl(`${baseUrl}/subscribe/${encodeURIComponent(channel)}`, {
          method: "POST",
          headers: {
            Authorization: authorization,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        }),
      );
      fetchTask.catch(noop);
      response = await Promise.race([fetchTask, connectionDeadline]);
      if (connectionDeadlineExceeded || !running || runGeneration !== generation) {
        if (response) {
          activeResponse = response;
          activeBody = response.body;
          await getActiveCancellationTask();
        }
        if (connectionDeadlineExceeded && running && runGeneration === generation) {
          throw new Error("Realtime subscription connection deadline exceeded.");
        }
        return;
      }
      activeResponse = response;
      activeBody = response.body;
      if (!response.ok) {
        responseBodyTask = readResponseBody(response);
        responseBodyTask.catch(noop);
        const body = await Promise.race([responseBodyTask, connectionDeadline]);
        clearConnectionTimer();
        throw responseError(response, "subscribe", body);
      }
      await consumeStream(
        response.body,
        runGeneration,
        connectionDeadline,
        () => {
          clearConnectionTimer();
          if (running && runGeneration === generation) reportStatus(true, "connected");
        },
      );
      if (running && runGeneration === generation) scheduleReconnect(runGeneration, "eof");
    } catch (error) {
      if (connectionDeadlineExceeded && fetchTask && !response) {
        // AbortSignal is advisory for fetch implementations. Await the late
        // response and its body cancellation here; this task is the barrier
        // that prevents a replacement physical subscription from starting.
        response = await fetchTask;
        activeResponse = response;
        activeBody = response?.body;
        await getActiveCancellationTask();
      }
      if (response && activeResponse === response) {
        await getActiveCancellationTask();
      }
      if (responseBodyTask) {
        // A timed-out error-body read is also physical work. Cancellation can
        // unblock it, but the barrier must not clear before the read settles.
        await responseBodyTask;
      }
      if (running && runGeneration === generation) scheduleReconnect(runGeneration, "error", error);
    } finally {
      clearConnectionTimer();
      if (activeController === controller) activeController = null;
      const ownsResponse = activeResponse === response;
      const cleanupTask =
        ownsResponse && activeCancellationBody === activeBody ? activeCancellationTask : null;
      if (ownsResponse) {
        activeResponse = null;
        activeBody = null;
      }
      if (cleanupTask && activeCancellationTask === cleanupTask) {
        activeCancellationTask = null;
        activeCancellationReader = null;
        activeCancellationBody = null;
      }
      if (cleanupTask) await cleanupTask;
    }
  };

  const beginSubscription = (runGeneration) => {
    if (!running || runGeneration !== generation) return;
    const task = subscribe(runGeneration);
    subscriptionTask = task;
    const barrier = task.then(noop, noop);
    subscriptionBarrier = barrier;
    task.then(
      () => {
        if (subscriptionTask === task) subscriptionTask = null;
        if (subscriptionBarrier === barrier) subscriptionBarrier = null;
      },
      () => {
        if (subscriptionTask === task) subscriptionTask = null;
        if (subscriptionBarrier === barrier) subscriptionBarrier = null;
      },
    );
  };

  const publish = async (envelope) => {
    const serialized = JSON.stringify(envelope);
    const messageBytes = Buffer.byteLength(serialized, "utf8");
    if (messageBytes > maxMessageBytes) {
      throw new Error(
        `Realtime envelope exceeds REALTIME_PUBSUB_MAX_MESSAGE_BYTES (${env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES}).`,
      );
    }

    const response = await fetchImpl(
      baseUrl,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["PUBLISH", channel, serialized]),
        signal: AbortSignal.timeout(env.CACHE_CONNECTION_TIMEOUT_MS),
      },
    );
    const body = await readResponseBody(response);
    if (!response.ok) throw responseError(response, "publish", body);
    if (hasErrorPayload(body)) {
      throw new Error(`Upstash publish returned an error: ${asErrorText(body.error)}`);
    }
  };

  const start = async (envelopeHandler = noop, statusHandler = noop) => {
    if (running) return;
    if (startTask) return startTask;
    startTask = (async () => {
      if (stopTask) await stopTask;
      if (subscriptionBarrier) {
        const barrier = subscriptionBarrier;
        const settled = await awaitBounded(barrier, env.CACHE_CONNECTION_TIMEOUT_MS);
        if (!settled || subscriptionBarrier === barrier) {
          // The caller gets a bounded lifecycle API, while the unresolved
          // physical task remains the replacement barrier and keeps this
          // transport stopped/unready until it really settles.
          reportStatus(false, "stopped");
          return;
        }
      }
      if (running) return;
      onEnvelope = typeof envelopeHandler === "function" ? envelopeHandler : noop;
      onStatus = typeof statusHandler === "function" ? statusHandler : noop;
      running = true;
      generation += 1;
      beginSubscription(generation);
    })();
    try {
      await startTask;
    } finally {
      startTask = null;
    }
  };

  const stop = async () => {
    if (stopTask) return stopTask;
    if (!running && !reconnectTimer && !activeController && !subscriptionTask) return;
    stopTask = (async () => {
      const deadline = Date.now() + env.CACHE_CONNECTION_TIMEOUT_MS;
      const priorTask = subscriptionTask;
      const priorBarrier = subscriptionBarrier;
      running = false;
      generation += 1;
      if (subscriptionTask === priorTask) subscriptionTask = null;
      if (reconnectTimer) {
        clearTimeoutImpl(reconnectTimer);
        reconnectTimer = null;
      }
      if (activeConnectionTimer) {
        clearConnectionTimeoutImpl(activeConnectionTimer);
        activeConnectionTimer = null;
      }
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
      const remaining = () => Math.max(0, deadline - Date.now());
      await awaitBounded(getActiveCancellationTask(), remaining());
      await awaitSubscriptionSettlement(priorBarrier || priorTask, remaining());
      reportStatus(false, "stopped");
    })();
    try {
      await stopTask;
    } finally {
      stopTask = null;
    }
  };

  return {
    publish,
    start,
    stop,
    getStatus: () => ({ required, connected, lastErrorAt }),
  };
};

module.exports = { createRealtimeTransport };
