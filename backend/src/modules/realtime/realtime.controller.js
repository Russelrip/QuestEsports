const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { subscribeToRealtimeEvents, openRealtimeConnection, closeRealtimeConnection } = require("./realtime.service");
const { accessRoom } = require("../match-rooms/match-room.service");

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
    res.status(503).json({
      success: false,
      error: { code: "realtime_disabled", message: "Live updates are temporarily unavailable." },
    });
    return;
  }

  const topics = await authorizeTopics(parseTopics(req.query.topics), req.user);
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
  safeWrite(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({ serverNow: new Date().toISOString() })}\n\n`);

  const unsubscribe = subscribeToRealtimeEvents((event) => {
    const rootTopic = event.topic.split(":")[0];
    if (topics.size && !topics.has(event.topic) && !topics.has(rootTopic)) return;
    if (!safeWrite(`id: ${event.id}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`)) close();
  });
  const heartbeat = setInterval(() => {
    if (!safeWrite(": heartbeat\n\n")) close();
  }, 25_000);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    closeRealtimeConnection(clientKey);
    if (!res.writableEnded) res.end();
  };
  req.on("close", close);
  req.on("aborted", close);
};

module.exports = { getRealtimeEvents };
