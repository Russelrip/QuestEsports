const express = require("express");
const { cachePublicData } = require("../../middleware/cache-control");
const { cacheJson } = require("../../middleware/response-cache");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { env } = require("../../config/env");
const controller = require("./player.controller");

const router = express.Router();

// Public IDs are a predictable sequence (QPID-000001, QPID-000002, ...), so the
// profile route is enumerable by design. Rate limiting keeps that from becoming
// a cheap way to walk the whole player table; the projection is what keeps the
// walk worthless.
const profileLimiter = createRateLimiter({
  name: "public-player-profile",
  windowMs: 15 * 60 * 1000,
  maxRequests: 300,
  message: "Too many profile requests. Please try again in a few minutes.",
});

router.get(
  "/players/:publicId",
  profileLimiter,
  cachePublicData({ browserSeconds: 30, sharedSeconds: 60 }),
  cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["players"] }),
  controller.getPublicPlayerProfile,
);

module.exports = router;
