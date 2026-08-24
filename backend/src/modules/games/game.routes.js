const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const { cachePublicData } = require("../../middleware/cache-control");
const { cacheJson } = require("../../middleware/response-cache");
const { env } = require("../../config/env");
const controller = require("./game.controller");

const router = express.Router();

// Titles change about once a year, so this caches like the category list.
router.get(
  "/games",
  cachePublicData({ browserSeconds: 30, sharedSeconds: 60 }),
  cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["games"] }),
  controller.getPublicGames,
);
router.get("/admin/games", requireAdmin, controller.getAdminGames);

module.exports = router;
