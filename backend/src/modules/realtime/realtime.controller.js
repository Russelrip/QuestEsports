const { env } = require("../../config/env");
const { subscribeToRealtimeEvents, openRealtimeConnection, closeRealtimeConnection } = require("./realtime.service");

const parseTopics = (value) =>
  new Set(
    String(value || "matches,brackets")
      .split(",")
      .map((topic) => topic.trim().toLowerCase())
      .filter((topic) => /^[a-z0-9:_-]{1,80}$/.test(topic))
      .slice(0, 20)
  );

const getRealtimeEvents = (req, res) => {
  if (!env.REALTIME_SSE_ENABLED) {
    res.status(503).json({
      success: false,
      error: { code: "realtime_disabled", message: "Live updates are temporarily unavailable." },
    });
    return;
  }

  const topics = parseTopics(req.query.topics);
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  openRealtimeConnection();
  res.write(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({ serverNow: new Date().toISOString() })}\n\n`);

  const unsubscribe = subscribeToRealtimeEvents((event) => {
    const rootTopic = event.topic.split(":")[0];
    if (topics.size && !topics.has(event.topic) && !topics.has(rootTopic)) return;
    res.write(`id: ${event.id}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    closeRealtimeConnection();
  };
  req.on("close", close);
  req.on("aborted", close);
};

module.exports = { getRealtimeEvents };
