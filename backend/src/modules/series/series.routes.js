const express = require("express");
const { tournamentBannerUpload } = require("../../middleware/upload");
const { cachePublicData } = require("../../middleware/cache-control");
const { cacheJson, invalidateCache } = require("../../middleware/response-cache");
const { env } = require("../../config/env");
const { requireAdmin } = require("../auth/auth.middleware");
const controller = require("./series.controller");

const router = express.Router();
const publicSeriesCache = cachePublicData({ browserSeconds: 30, sharedSeconds: 60 });
const publicEventResponseCache = cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["events", "tournaments"] });
const eventUpload = tournamentBannerUpload.fields([
  { name: "heroImage", maxCount: 1 },
  { name: "bannerImage", maxCount: 1 },
]);

router.get("/events", publicSeriesCache, publicEventResponseCache, controller.getPublicEvents);
router.get("/events/:slug", publicSeriesCache, publicEventResponseCache, controller.getPublicEventDetail);
router.get("/admin/events", requireAdmin, controller.getAdminEvents);
router.post(
  "/admin/events",
  requireAdmin,
  invalidateCache("events", "tournaments"),
  eventUpload,
  controller.createEvent
);
router.patch(
  "/admin/events/:eventId",
  requireAdmin,
  invalidateCache("events", "tournaments"),
  eventUpload,
  controller.updateEvent
);
router.post(
  "/admin/events/:eventId/archive",
  requireAdmin,
  invalidateCache("events", "tournaments"),
  controller.archiveEvent
);
router.post(
  "/admin/events/:eventId/tournaments",
  requireAdmin,
  invalidateCache("events", "tournaments"),
  eventUpload,
  controller.createEventTournament
);

router.get("/event-series", publicSeriesCache, controller.getPublicSeries);
router.get("/event-series/:slug", publicSeriesCache, controller.getPublicSeriesDetail);
router.get("/admin/event-series", requireAdmin, controller.getAdminSeries);
router.post("/admin/event-series", requireAdmin, tournamentBannerUpload.single("heroImage"), controller.createSeries);
router.patch("/admin/event-series/:seriesId", requireAdmin, tournamentBannerUpload.single("heroImage"), controller.updateSeries);
router.delete("/admin/event-series/:seriesId", requireAdmin, controller.deleteSeries);

module.exports = router;
