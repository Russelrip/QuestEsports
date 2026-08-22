const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const {
  subscribeToRealtimeEvents,
  openRealtimeConnection,
  closeRealtimeConnection,
  isRealtimeTransportReady,
} = require("./realtime.service");
const { accessRoom } = require("../match-rooms/match-room.service");

const activeSseConnections = new Set();

const parseTopics = (value) =>
  new Set(
    String(value || "matches,brackets")
      .split(",")
      .map((topic) => topic.trim().toLowerCase())
      .filter((topic) => /^[a-z0-9:_-]{1,80}$/.test(topic))
      .slice(0, 20)
  );

const authorizeTopics = async (requested, user) => {
  const authorized = new Set();
  for (const topic of requested) {
    if (topic.startsWith("user:")) {
      if (!user || topic !== `user:${user.id}`) throw new HttpError(403, "You cannot subscribe to this user stream.");
      authorized.add(topic);
      continue;
    }
    if (topic.startsWith("match-room:")) {
      if (!user) throw new HttpError(401, "Sign in to subscribe to a match room.");
      const code = topic.slice("match-room:".length);
      if (!code) throw new HttpError(400, "A match-room code is required.");
      await accessRoom({ code, user });
      authorized.add(topic);
      continue;
    }
    if (topic === "user" || topic === "match-room") throw new HttpError(403, "Broad private realtime topics are not allowed.");
    authorized.add(topic);
  }
  return authorized;
};

const getRealtimeEvents = async (req, res) => {
  if (!env.REALTIME_SSE_ENABLED) {
    // EventSource treats 204 as a terminal response and does not reconnect.
    // Clients continue using their bounded polling fallback while SSE is disabled.
    res.status(204).end();
    return;
  }

  if (typeof isRealtimeTransportReady === "function" && !isRealtimeTransportReady()) {
    if (typeof res.set === "function") res.set("Retry-After", "5");
    else res.setHeader?.("Retry-After", "5");
    res.status(503).json({
      success: false,
      error: {
        code: "realtime_unavailable",
        message: "Realtime updates are temporarily unavailable. Please retry.",
      },
    });
    return;
  }

  const topics = await authorizeTopics(parseTopics(req.query.topics), req.user);
  if (typeof isRealtimeTransportReady === "function" && !isRealtimeTransportReady()) {
    if (typeof res.set === "function") res.set("Retry-After", "5");
    else res.setHeader?.("Retry-After", "5");
    res.status(503).json({
      success: false,
      error: {
        code: "realtime_unavailable",
        message: "Realtime updates are temporarily unavailable. Please retry.",
      },
    });
    return;
  }
  // Reconciliation is a public, payload-only invalidation signal. Include it
  // in the same filter set so shared transport recovery reaches every stream
  // without broadening any private topic authorization.
  topics.add("reconciliation");
  const clientKey = String(req.ip || req.socket?.remoteAddress || "unknown");
  const opened = openRealtimeConnection(clientKey, {
    maxTotal: env.REALTIME_SSE_MAX_CONNECTIONS,
    maxPerClient: env.REALTIME_SSE_MAX_CONNECTIONS_PER_IP,
  });
  if (!opened) {
    res.status(429).json({
      success: false,
      error: { code: "realtime_limit", message: "Too many live-update connections." },
    });
    return;
  }
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  const safeWrite = (value) => {
    try {
      return res.write(value);
    } catch {
      return false;
    }
  };

  let closed = false;
  let heartbeat = null;
  let unsubscribe = () => {};
  let subscriptionReady = false;
  const removeSubscription = () => {
    if (!subscriptionReady) return;
    subscriptionReady = false;
    unsubscribe();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    activeSseConnections.delete(close);
    if (heartbeat) clearInterval(heartbeat);
    removeSubscription();
    closeRealtimeConnection(clientKey);
    if (!res.writableEnded) res.end();
  };
  activeSseConnections.add(close);
  const eventListener = (event) => {
    const rootTopic = event.topic.split(":")[0];
    if (topics.size && !topics.has(event.topic) && !topics.has(rootTopic)) return;
    if (!safeWrite(`id: ${event.id}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`)) close();
  };
  const registeredUnsubscribe = subscribeToRealtimeEvents(eventListener);
  unsubscribe = typeof registeredUnsubscribe === "function" ? registeredUnsubscribe : () => {};
  subscriptionReady = true;
  if (closed) removeSubscription();
  if (closed) return;
  heartbeat = setInterval(() => {
    if (!safeWrite(": heartbeat\n\n")) close();
  }, 25_000);

  req.on("close", close);
  req.on("aborted", close);
  safeWrite(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({
    serverNow: new Date().toISOString(),
    reconcile: true,
  })}\n\n`);
};

const drainRealtimeConnections = () => {
  const connections = [...activeSseConnections];
  for (const close of connections) close();
  return connections.length;
};

module.exports = { getRealtimeEvents, drainRealtimeConnections };
