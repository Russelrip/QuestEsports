const cache = require("../lib/cache");

const cacheJson = ({ ttlSeconds, tags = [] }) => async (req, res, next) => {
  if (req.method !== "GET" || req.headers.authorization || req.headers.cookie) return next();
  const key = `response:${req.originalUrl}`;
  const cached = await cache.get(key, tags);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.status(cached.status).json(cached.body);
  }

  res.setHeader("X-Cache", "MISS");
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      void cache.set(key, { status: res.statusCode, body }, ttlSeconds, tags);
    }
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
