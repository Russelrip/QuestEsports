const { HttpError } = require("../../lib/http-error");
const { asyncHandler } = require("../../lib/async-handler");
const { getSessionFromRequest } = require("./session.service");
const { logger } = require("../../lib/logger");

const attachSession = asyncHandler(async (req, res, next) => {
  if (Object.prototype.hasOwnProperty.call(req, "session")) {
    next();
    return;
  }

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

// Discord carries match communication, so an account that has not linked one is
// unreachable the moment it matters. The frontend routes such a session into a
// Connect Discord step at login, but a client-side step is a suggestion: this
// is the half that makes it real.
//
// Only state-changing requests are gated. Reads stay open because the connect
// screen itself has to load, and a user who cannot see the site cannot be
// talked through fixing their account.
//
// Admins are exempt on purpose. Staff reach each other through the server's own
// role structure rather than through a registration row, and gating the admin
// dashboard on a Discord link is how an operator locks themselves out of the
// tool they would use to investigate the lockout.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const requireDiscordLinked = (req, res, next) => {
  if (!req.user || SAFE_METHODS.has(req.method) || req.user.role === "admin") {
    next();
    return;
  }

  if (req.user.discordId) {
    next();
    return;
  }

  const error = new HttpError(
    403,
    "Connect your Discord account before continuing."
  );
  error.code = "DISCORD_LINK_REQUIRED";
  next(error);
};

module.exports = {
  attachSession,
  requireAuth,
  requireAdmin,
  requireVerifiedEmail,
  requireDiscordLinked,
};
