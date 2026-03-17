const { HttpError } = require("../lib/http-error");
const { env } = require("../config/env");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedOrigins = new Set(env.CORS_ORIGINS);

const extractOrigin = (value) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const hasSessionCookie = (req) => {
  const cookieHeader = String(req.headers.cookie || "");

  return cookieHeader.split(";").some((entry) => {
    const [name] = entry.trim().split("=");
    return name === env.SESSION_COOKIE_NAME;
  });
};

const setSecurityHeaders = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  if (req.path.startsWith("/api")) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
  }

  next();
};

const protectAgainstCsrf = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const requestOrigin =
    extractOrigin(req.headers.origin) || extractOrigin(req.headers.referer);

  if (!requestOrigin) {
    if (hasSessionCookie(req)) {
      next(new HttpError(403, "Cross-site request blocked."));
      return;
    }

    next();
    return;
  }

  if (!allowedOrigins.has(requestOrigin)) {
    next(new HttpError(403, "Cross-site request blocked."));
    return;
  }

  next();
};

module.exports = {
  protectAgainstCsrf,
  setSecurityHeaders,
};
