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

const responseError = async (response, operation) => {
  let details = "";
  if (typeof response.json === "function") {
    try {
      details = asErrorText(await response.json());
    } catch {
      // The REST API may return an empty or non-JSON error body.
    }
  }
  if (!details && typeof response.text === "function") {
    try {
      details = await response.text();
    } catch {
      // Keep the HTTP status as the useful error when the body is unavailable.
    }
  }
  return new Error(
    `Upstash ${operation} failed with HTTP ${response.status}${details ? `: ${details}` : ""}`,
  );
};

const toIsoString = (value) => {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const createRealtimeTransport = ({
  fetchImpl = globalThis.fetch,
  logger = {},
  now = () => new Date(),
  random = Math.random,
} = {}) => {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required for realtime transport.");
  }

  const baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, "");
  const channel = env.REALTIME_PUBSUB_CHANNEL;
  const authorization = `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`;
  const required = env.API_PROCESS_COUNT > 1;

  let running = false;
  let connected = false;
  let lastErrorAt = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let activeController = null;
  let activeReader = null;
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
    if (frameType !== "message" || frameChannel !== channel) return;

    const payload = data.slice(secondComma + 1);
    if (Buffer.byteLength(payload, "utf8") > env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES) {
      return;
    }
    try {
      onEnvelope(JSON.parse(payload));
    } catch (error) {
      log("warn", "Ignoring malformed realtime Pub/Sub payload", error);
    }
  };

  const consumeStream = async (body) => {
    if (!body || typeof body.getReader !== "function") {
      throw new Error("Upstash subscribe response did not include a readable stream.");
    }
    const reader = body.getReader();
    activeReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (running) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        let separator;
        while ((separator = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const match = buffer.match(/\r?\n\r?\n/);
          parseRecord(buffer.slice(0, separator));
          buffer = buffer.slice(separator + match[0].length);
        }
      }
      buffer += decoder.decode();
    } finally {
      activeReader = null;
      if (typeof reader.releaseLock === "function") reader.releaseLock();
    }
  };

  const scheduleReconnect = (reason, error) => {
    if (!running || reconnectTimer) return;
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
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (running) subscribe();
    }, delay);
  };

  const subscribe = async () => {
    if (!running) return;
    activeController = new AbortController();
    try {
      const response = await fetchImpl(
        `${baseUrl}/subscribe/${encodeURIComponent(channel)}`,
        {
          method: "POST",
          headers: {
            Authorization: authorization,
            Accept: "text/event-stream",
          },
          signal: activeController.signal,
        },
      );
      if (!running) return;
      if (!response.ok) {
        throw await responseError(response, "subscribe");
      }
      reconnectAttempt = 0;
      reportStatus(true, "connected");
      await consumeStream(response.body);
      if (running) scheduleReconnect("eof");
    } catch (error) {
      if (running) scheduleReconnect("error", error);
    } finally {
      activeController = null;
    }
  };

  const publish = async (envelope) => {
    const serialized = JSON.stringify(envelope);
    const messageBytes = Buffer.byteLength(serialized, "utf8");
    if (messageBytes > env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES) {
      throw new Error(
        `Realtime envelope exceeds REALTIME_PUBSUB_MAX_MESSAGE_BYTES (${env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES}).`,
      );
    }

    const response = await fetchImpl(
      `${baseUrl}/publish/${encodeURIComponent(channel)}/${encodeURIComponent(serialized)}`,
      {
        method: "POST",
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(env.CACHE_CONNECTION_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw await responseError(response, "publish");
  };

  const start = async (envelopeHandler = noop, statusHandler = noop) => {
    if (running) return;
    onEnvelope = typeof envelopeHandler === "function" ? envelopeHandler : noop;
    onStatus = typeof statusHandler === "function" ? statusHandler : noop;
    running = true;
    subscribe();
  };

  const stop = async () => {
    if (!running && !reconnectTimer && !activeController) return;
    running = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (activeController) activeController.abort();
    if (activeReader && typeof activeReader.cancel === "function") {
      try {
        await activeReader.cancel();
      } catch (error) {
        log("debug", "Realtime reader cancellation failed", error);
      }
    }
    reportStatus(false, "stopped");
  };

  return {
    publish,
    start,
    stop,
    getStatus: () => ({ required, connected, lastErrorAt }),
  };
};

module.exports = { createRealtimeTransport };
