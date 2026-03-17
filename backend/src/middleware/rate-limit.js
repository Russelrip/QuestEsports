const { HttpError } = require("../lib/http-error");

const stores = new Map();

const getClientIp = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
};

const getStore = (name) => {
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }

  return stores.get(name);
};

const createRateLimiter = ({
  name,
  windowMs,
  maxRequests,
  message,
  keyGenerator = getClientIp,
}) => {
  if (!name) {
    throw new Error("Rate limiter name is required.");
  }

  const store = getStore(name);

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    const existing =
      store.get(key) || { count: 0, resetAt: now + windowMs };

    if (existing.resetAt <= now) {
      existing.count = 0;
      existing.resetAt = now + windowMs;
    }

    existing.count += 1;
    store.set(key, existing);

    const remaining = Math.max(maxRequests - existing.count, 0);
    const retryAfterSeconds = Math.max(
      Math.ceil((existing.resetAt - now) / 1000),
      1
    );

    res.setHeader("RateLimit-Limit", String(maxRequests));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(retryAfterSeconds));

    if (existing.count > maxRequests) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      next(new HttpError(429, message));
      return;
    }

    next();
  };
};

module.exports = {
  createRateLimiter,
  getClientIp,
};
