const { HttpError } = require("../../lib/http-error");
const { asyncHandler } = require("../../lib/async-handler");
const { getSessionFromRequest } = require("./session.service");

const attachSession = asyncHandler(async (req, res, next) => {
  const session = getSessionFromRequest(req);
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
    next(new HttpError(403, "Admin access is required."));
    return;
  }

  next();
};

module.exports = {
  attachSession,
  requireAuth,
  requireAdmin,
};
