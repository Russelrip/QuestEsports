const { env } = require("../config/env");

const PAYHERE_NOTIFY_PATH = "/api/payments/payhere/notify";

const isAllowedDuringMaintenance = (req) =>
  req.method === "POST" && req.path === PAYHERE_NOTIFY_PATH;

const sendMaintenanceResponse = (req, res, extra = {}) => {
  res.locals.expectedMaintenance = true;
  res.setHeader("Retry-After", String(env.SITE_MAINTENANCE_RETRY_AFTER_SECONDS));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Maintenance-Mode", "active");
  return res.status(503).json({
    success: false,
    code: "SITE_MAINTENANCE",
    message: env.SITE_MAINTENANCE_MESSAGE,
    retryAfterSeconds: env.SITE_MAINTENANCE_RETRY_AFTER_SECONDS,
    requestId: req.requestId,
    ...extra,
  });
};

const requireSiteAvailable = (req, res, next) => {
  if (!env.SITE_MAINTENANCE_MODE || isAllowedDuringMaintenance(req)) {
    return next();
  }
  return sendMaintenanceResponse(req, res);
};

module.exports = {
  PAYHERE_NOTIFY_PATH,
  isAllowedDuringMaintenance,
  requireSiteAvailable,
  sendMaintenanceResponse,
};
