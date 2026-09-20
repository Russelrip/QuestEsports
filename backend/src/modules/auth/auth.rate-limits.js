const { createRateLimiter, getClientIp } = require("../../middleware/rate-limit");
const { normalizeEmail, normalizeUsername } = require("../../lib/validation");

// The password-login limiters live here rather than in auth.routes because the
// controller clears the identity bucket once credentials check out, and routes
// already require the controller.
const PASSWORD_LOGIN_IP_LIMIT = "auth-login-password-ip";
const PASSWORD_LOGIN_IDENTITY_LIMIT = "auth-login-password-identity";

// A coarse brake on credential stuffing from one network. Deliberately never
// cleared on success: an attacker holding one valid account could otherwise
// reset the budget at will.
const passwordLoginIpRateLimiter = createRateLimiter({
  name: PASSWORD_LOGIN_IP_LIMIT,
  windowMs: 15 * 60 * 1000,
  maxRequests: 50,
  message: "Too many login attempts from this network. Please try again in 15 minutes.",
});

// Keyed by IP *and* identity so guessing at one account cannot lock its owner
// out from anywhere else.
const passwordLoginIdentityRateLimiter = createRateLimiter({
  name: PASSWORD_LOGIN_IDENTITY_LIMIT,
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: "Too many login attempts. Please try again in 15 minutes.",
  keyGenerator: (req) => {
    const identity = normalizeEmail(req.body?.emailOrUsername) ||
      normalizeUsername(req.body?.emailOrUsername) ||
      "unknown";
    return `${getClientIp(req)}:${identity}`;
  },
});

module.exports = {
  PASSWORD_LOGIN_IP_LIMIT,
  PASSWORD_LOGIN_IDENTITY_LIMIT,
  passwordLoginIpRateLimiter,
  passwordLoginIdentityRateLimiter,
};
