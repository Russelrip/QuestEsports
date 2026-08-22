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
const activeAuthorizationFinalizers = new Set();
let realtimeDraining = false;
const AUTHORIZATION_CANCELLED = Symbol("realtime-authorization-cancelled");

const isRequestClosed = (req) =>
  req.aborted === true || req.destroyed === true || req.socket?.destroyed === true;

const respondRealtimeUnavailable = (res) => {
  if (res.writableEnded) return;
  if (typeof res.set === "function") res.set("Retry-After", "5");
  else res.setHeader?.("Retry-After", "5");
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(503).json({
      success: false,
      error: {
        code: "realtime_unavailable",
        message: "Realtime updates are temporarily unavailable. Please retry.",
      },
    });
    return;
  }
  res.statusCode = 503;
  res.end?.();
};

const parseTopics = (value) =>
  new Set(
    String(value || "matches,brackets")
      .split(",")
      .map((topic) => topic.trim().toLowerCase())
      .filter((topic) => /^[a-z0-9:_-]{1,80}$/.test(topic))
      .slice(0, 20)
  );

const authorizeTopics = async (requested, user, cancellation = null) => {
  const throwIfCancelled = () => {
    if (cancellation?.cancelled) throw AUTHORIZATION_CANCELLED;
  };
  const awaitAuthorization = async (task) => {
    const authorizationTask = Promise.resolve().then(task);
    authorizationTask.catch(() => {});
    const result = await Promise.race([
      authorizationTask,
      cancellation?.promise,
    ].filter(Boolean));
    if (result === AUTHORIZATION_CANCELLED) throw AUTHORIZATION_CANCELLED;
    return result;
  };

  const authorized = new Set();
  for (const topic of requested) {
    throwIfCancelled();
    if (topic.startsWith("user:")) {
      if (!user || topic !== `user:${user.id}`) throw new HttpError(403, "You cannot subscribe to this user stream.");
      authorized.add(topic);
      continue;
    }
    if (topic.startsWith("match-room:")) {
      if (!user) throw new HttpError(401, "Sign in to subscribe to a match room.");
      const code = topic.slice("match-room:".length);
      if (!code) throw new HttpError(400, "A match-room code is required.");
      await awaitAuthorization(() => accessRoom({
        code,
        user,
        signal: cancellation?.signal,
      }));
      authorized.add(topic);
      continue;
    }
    if (topic === "user" || topic === "match-room" || topic === "veto") throw new HttpError(403, "Broad private realtime topics are not allowed.");
    authorized.add(topic);
  }
  return authorized;
};

const getRealtimeEvents = async (req, res) => {
  if (realtimeDraining) {
    respondRealtimeUnavailable(res);
    return;
  }

  if (!env.REALTIME_SSE_ENABLED) {
    // EventSource treats 204 as a terminal response and does not reconnect.
    // Clients continue using their bounded polling fallback while SSE is disabled.
    res.status(204).end();
    return;
  }

  if (typeof isRealtimeTransportReady === "function" && !isRealtimeTransportReady()) {
    respondRealtimeUnavailable(res);
    return;
  }

  if (isRequestClosed(req)) return;

  const authorizationController = new AbortController();
  let authorizationSettled = false;
  let authorizationCancelled = false;
  let resolveAuthorizationCancellation;
  const authorizationCancellation = new Promise((resolve) => {
    resolveAuthorizationCancellation = resolve;
  });
  const finalizeAuthorization = (reason = "aborted") => {
    if (authorizationSettled || authorizationCancelled) return;
    authorizationCancelled = true;
    activeAuthorizationFinalizers.delete(finalizeAuthorization);
    authorizationController.abort();
    resolveAuthorizationCancellation(AUTHORIZATION_CANCELLED);
    if (reason === "drain") respondRealtimeUnavailable(res);
    else if (!res.writableEnded) res.end?.();
  };
  activeAuthorizationFinalizers.add(finalizeAuthorization);
  req.on("close", () => finalizeAuthorization("aborted"));
  req.on("aborted", () => finalizeAuthorization("aborted"));

  let topics;
  try {
    topics = await authorizeTopics(
      parseTopics(req.query.topics),
      req.user,
      {
        signal: authorizationController.signal,
        promise: authorizationCancellation,
        get cancelled() {
          return authorizationCancelled;
        },
      },
    );
  } catch (error) {
    if (error === AUTHORIZATION_CANCELLED || authorizationCancelled) return;
    throw error;
  } finally {
    authorizationSettled = true;
    activeAuthorizationFinalizers.delete(finalizeAuthorization);
  }

  if (authorizationCancelled) return;
  if (realtimeDraining) {
    respondRealtimeUnavailable(res);
    return;
  }
  if (isRequestClosed(req)) return;
  if (typeof isRealtimeTransportReady === "function" && !isRealtimeTransportReady()) {
    respondRealtimeUnavailable(res);
    return;
  }
  if (realtimeDraining) {
    respondRealtimeUnavailable(res);
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

  try {
    activeSseConnections.add(close);
    req.on("close", close);
    req.on("aborted", close);
    if (isRequestClosed(req)) {
      close();
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
    if (closed) return;
    const safeWrite = (value) => {
      try {
        return res.write(value);
      } catch {
        return false;
      }
    };
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

    safeWrite(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({
      serverNow: new Date().toISOString(),
      reconcile: true,
    })}\n\n`);
  } catch (error) {
    close();
    throw error;
  }
};

const drainRealtimeConnections = () => {
  realtimeDraining = true;
  const authorizations = [...activeAuthorizationFinalizers];
  const connections = [...activeSseConnections];
  for (const finalize of authorizations) finalize("drain");
  for (const close of connections) close();
  return authorizations.length + connections.length;
};

module.exports = { getRealtimeEvents, drainRealtimeConnections };
