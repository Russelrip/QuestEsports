const { env } = require("../config/env");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const READ_METHODS = new Set(["GET", "HEAD"]);
const CALLBACK_PATHS = new Set([
  "/api/auth/google/callback",
  "/api/auth/discord/callback",
  "/api/v1/auth/oauth/google/link/callback",
  "/api/v1/auth/oauth/discord/link/callback",
  "/api/v1/valorant/leaderboard/register/discord/callback",
  "/api/payments/payhere/notify",
]);
const WRITE_FREEZE_HEADER = "X-Write-Freeze";
const WRITE_FREEZE_MESSAGE =
  "Database writes are temporarily disabled for validation.";

const normalizeRequestPath = (requestPath) => {
  const normalized = String(requestPath || "")
    .split("?", 1)[0]
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
  return normalized || "/";
};

const isCallbackRequest = (req) => {
  const path = normalizeRequestPath(req.path || req.originalUrl || req.url);
  return CALLBACK_PATHS.has(path) || path.endsWith("/callback");
};

const isWriteCapableReadRequest = (req) => {
  if (!READ_METHODS.has(req.method)) {
    return false;
  }

  const path = normalizeRequestPath(req.path || req.originalUrl || req.url);
  return (
    path === "/api/email-verification/verify" ||
    path === "/api/email-change/confirm" ||
    /\/api\/(?:auth\/(?:google|discord)\/start|mobile\/auth\/oauth\/(?:google|discord)\/start)$/.test(
      path,
    ) ||
    /\/api\/auth\/oauth\/(?:google|discord)\/link$/.test(path)
  );
};

const isWriteFreezeRequest = (req) =>
  env.WRITE_FREEZE_MODE === "validation" &&
  (MUTATING_METHODS.has(req.method) ||
    isCallbackRequest(req) ||
    isWriteCapableReadRequest(req));

const sendWriteFreezeResponse = (req, res) => {
  res.locals.expectedWriteFreeze = true;
  res.setHeader("Retry-After", String(env.SITE_MAINTENANCE_RETRY_AFTER_SECONDS));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(WRITE_FREEZE_HEADER, env.WRITE_FREEZE_MODE);
  return res.status(503).json({
    success: false,
    code: "WRITE_FREEZE",
    message: WRITE_FREEZE_MESSAGE,
    retryAfterSeconds: env.SITE_MAINTENANCE_RETRY_AFTER_SECONDS,
    requestId: req.requestId,
  });
};

const requireWritesEnabled = (req, res, next) => {
  if (!isWriteFreezeRequest(req)) {
    return next();
  }

  // Consume a rejected request body so malformed or oversized client input
  // cannot reset the connection after the deterministic freeze response.
  req.resume?.();
  return sendWriteFreezeResponse(req, res);
};

module.exports = {
  CALLBACK_PATHS,
  MUTATING_METHODS,
  READ_METHODS,
  WRITE_FREEZE_HEADER,
  isCallbackRequest,
  isWriteFreezeRequest,
  isWriteCapableReadRequest,
  normalizeRequestPath,
  requireWritesEnabled,
  sendWriteFreezeResponse,
};
