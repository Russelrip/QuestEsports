const { HttpError } = require("../../lib/http-error");
const { asyncHandler } = require("../../lib/async-handler");
const { getSessionFromRequest } = require("./session.service");
const { logger } = require("../../lib/logger");

const attachSession = asyncHandler(async (req, res, next) => {
  const session = await getSessionFromRequest(req);
  req.session = session;
  req.user = session ? session.user : null;
  next();
});

const requireAuth = (req, res, next) => {
  if (!req.user) {
    next(new HttpError(401, "You must be logged in to access this resource."));
    return;
  }

  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    logger.warn("Blocked admin route access", {
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id || null,
      ip: req.ip,
    });
    next(new HttpError(403, "Admin access is required."));
    return;
  }

  next();
};

const requireVerifiedEmail = (req, res, next) => {
  if (!req.user) {
    next(new HttpError(401, "You must be logged in to access this resource."));
    return;
  }

  if (req.user.emailVerified) {
    next();
    return;
  }

  next(
    new HttpError(
      403,
      "Please verify your email address before performing this action."
    )
  );
};

module.exports = {
  attachSession,
  requireAuth,
  requireAdmin,
  requireVerifiedEmail,
};
