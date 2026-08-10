const cache = require("../lib/cache");

const inFlightResponses = new Map();

const cacheJson = ({ ttlSeconds, tags = [], allowCookies = false }) => async (req, res, next) => {
  if (req.method !== "GET" || req.headers.authorization || (!allowCookies && req.headers.cookie)) return next();
  const key = `response:${req.originalUrl}`;
  const snapshot = await cache.resolveKey(key, tags);
  const cached = await cache.getResolved(snapshot);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.status(cached.status).json(cached.body);
  }

  const inFlightKey = snapshot.key;
  const inFlight = inFlightResponses.get(inFlightKey);
  if (inFlight) {
    const sharedResponse = await inFlight;
    if (sharedResponse) {
      res.setHeader("X-Cache", "COALESCED");
      const body =
        sharedResponse.status >= 400 && req.requestId && sharedResponse.body &&
        typeof sharedResponse.body === "object" && !Array.isArray(sharedResponse.body)
          ? { ...sharedResponse.body, requestId: req.requestId }
          : sharedResponse.body;
      return res.status(sharedResponse.status).json(body);
    }
  }

  res.setHeader("X-Cache", "MISS");
  let settleInFlight;
  const responsePromise = new Promise((resolve) => {
    settleInFlight = resolve;
  });
  inFlightResponses.set(inFlightKey, responsePromise);
  let settled = false;
  const settle = (value) => {
    if (settled) return;
    settled = true;
    settleInFlight(value);
    if (inFlightResponses.get(inFlightKey) === responsePromise) inFlightResponses.delete(inFlightKey);
  };
  res.once("finish", () => settle(null));
  res.once("close", () => settle(null));
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      void cache.setResolved(snapshot, { status: res.statusCode, body }, ttlSeconds);
    }
    // Errors are never cached, but sharing the current failure prevents every
    // waiter from stampeding the database again before it can recover.
    settle({ status: res.statusCode, body });
    return sendJson(body);
  };
  return next();
};

const invalidateCache = (...tags) => (req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) void cache.invalidateTags(tags);
  });
  next();
};

module.exports = { cacheJson, invalidateCache };
