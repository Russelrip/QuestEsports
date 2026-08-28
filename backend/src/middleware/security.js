const { HttpError } = require("../lib/http-error");
const { env } = require("../config/env");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedOrigins = new Set(env.CORS_ORIGINS);
// OAuth callbacks arrive as top-level browser redirects from the provider, so
// the browser reports the provider's origin rather than ours. They carry their
// own CSRF defence through the signed state, single-use nonce, flow cookie, and
// PKCE verifier checked in the OAuth service.
const ORIGIN_CHECK_EXEMPT_PATHS = new Set([
  "/api/auth/google/callback",
  "/api/auth/discord/callback",
  "/api/v1/auth/oauth/google/link/callback",
  "/api/v1/auth/oauth/discord/link/callback",
  "/api/mobile/auth/login",
  "/api/mobile/auth/oauth/exchange",
  "/api/payments/payhere/notify",
]);
const SAFE_PUBLIC_API_PATHS = [
  /^\/api\/health(?:\/(?:live|ready))?$/,
  /^\/api\/health\/write-freeze$/,
  /^\/api\/openapi\.json$/,
  /^\/api\/auth\/(?:google|discord)\/start$/,
  /^\/api\/mobile\/auth\/oauth\/(?:google|discord)\/start$/,
  /^\/api\/tournaments(?:\/[^/]+)?$/,
  /^\/api\/posters(?:\/[^/]+(?:\/image)?)?$/,
  /^\/api\/event-albums(?:\/[^/]+(?:\/photos\/[^/]+\/image)?)?$/,
  /^\/api\/rulebooks(?:\/[^/]+)?$/,
  /^\/api\/event-series(?:\/[^/]+)?$/,
  /^\/api\/events(?:\/[^/]+)?$/,
  /^\/api\/game-categories(?:\/[^/]+)?$/,
  /^\/api\/products(?:\/[^/]+)?$/,
  /^\/api\/ticket-events(?:\/[^/]+)?$/,
  /^\/api\/commerce\/capabilities$/,
  /^\/api\/products\/[^/]+\/images\/[^/]+$/,
  /^\/api\/orders\/[^/]+$/,
  /^\/api\/uploads\/(?:tournament-banners|poster-images|team-logos|avatars|game-assets|sponsor-logos)\/[^/]+$/,
  /^\/api\/team-invite$/,
];

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

const hasNativeBearerCredential = (req) =>
  !hasSessionCookie(req) &&
  /^Bearer\s+[a-f0-9]{96}$/i.test(
    String(req.headers.authorization || "").trim(),
  );

const getRequestOrigin = (req) =>
  extractOrigin(req.headers.origin) || extractOrigin(req.headers.referer);

const isSafePublicApiRequest = (req) =>
  SAFE_METHODS.has(req.method) &&
  SAFE_PUBLIC_API_PATHS.some((pattern) => pattern.test(req.path));

const setSecurityHeaders = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
  }

  if (env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  next();
};

const requireAllowedApiOrigin = (req, res, next) => {
  if (
    !req.path.startsWith("/api") ||
    req.method === "OPTIONS" ||
    ORIGIN_CHECK_EXEMPT_PATHS.has(req.path) ||
    isSafePublicApiRequest(req) ||
    hasNativeBearerCredential(req)
  ) {
    next();
    return;
  }

  const requestOrigin = getRequestOrigin(req);

  if (requestOrigin) {
    if (!allowedOrigins.has(requestOrigin)) {
      next(new HttpError(403, "Requests from this origin are not allowed."));
      return;
    }

    next();
    return;
  }

  if (env.REQUIRE_API_ORIGIN) {
    next(new HttpError(403, "Requests must come from an allowed origin."));
    return;
  }

  next();
};

const protectAgainstCsrf = (req, res, next) => {
  if (
    SAFE_METHODS.has(req.method) ||
    ORIGIN_CHECK_EXEMPT_PATHS.has(req.path) ||
    hasNativeBearerCredential(req)
  ) {
    next();
    return;
  }

  const requestOrigin = getRequestOrigin(req);

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
  requireAllowedApiOrigin,
  setSecurityHeaders,
};
