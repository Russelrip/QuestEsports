const crypto = require("crypto");
const { logger } = require("../lib/logger");

const getRequestId = (req) => {
  const headerValue = String(req.headers["x-request-id"] || "").trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(headerValue)
    ? headerValue
    : crypto.randomUUID();
};

const attachRequestContext = (req, res, next) => {
  const requestId = getRequestId(req);

  req.requestId = requestId;
  req.startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);

  next();
};

const logRequestLifecycle = (req, res, next) => {
  if (typeof res.writeHead === "function") {
    const writeHead = res.writeHead;
    res.writeHead = function writeHeadWithServerTiming(...args) {
      if (!res.headersSent && !res.hasHeader("Server-Timing")) {
        const durationMs = Math.max(Date.now() - (req.startedAt || Date.now()), 0);
        res.setHeader("Server-Timing", `app;dur=${durationMs}`);
      }
      return writeHead.apply(this, args);
    };
  }

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
