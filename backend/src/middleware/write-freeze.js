const { env } = require("../config/env");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
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

const isCallbackRequest = (req) => CALLBACK_PATHS.has(req.path);

const isWriteFreezeRequest = (req) =>
  env.WRITE_FREEZE_MODE === "validation" &&
  (MUTATING_METHODS.has(req.method) || isCallbackRequest(req));

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

  return sendWriteFreezeResponse(req, res);
};

module.exports = {
  CALLBACK_PATHS,
  MUTATING_METHODS,
  WRITE_FREEZE_HEADER,
  isCallbackRequest,
  isWriteFreezeRequest,
  requireWritesEnabled,
  sendWriteFreezeResponse,
};
