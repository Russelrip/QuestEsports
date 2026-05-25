const crypto = require("crypto");
const { logger } = require("../lib/logger");

const getRequestId = (req) => {
  const headerValue = String(req.headers["x-request-id"] || "").trim();
  return headerValue || crypto.randomUUID();
};

const attachRequestContext = (req, res, next) => {
  const requestId = getRequestId(req);

  req.requestId = requestId;
  req.startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);

  next();
};

const logRequestLifecycle = (req, res, next) => {
  res.on("finish", () => {
    const durationMs = Math.max(Date.now() - (req.startedAt || Date.now()), 0);
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger[level]("HTTP request completed", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
      userId: req.user?.id || null,
    });
  });

  next();
};

module.exports = {
  attachRequestContext,
  logRequestLifecycle,
};
