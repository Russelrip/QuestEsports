const express = require("express");
const { imageUpload, tournamentBannerUpload } = require("../../middleware/upload");
const { cachePublicData } = require("../../middleware/cache-control");
const { cacheJson, invalidateCache } = require("../../middleware/response-cache");
const { env } = require("../../config/env");
const { requireStaffPermission } = require("../permissions/permission.middleware");
const controller = require("./series.controller");
const sponsorController = require("../tournaments/sponsor.controller");

const router = express.Router();
const publicSeriesCache = cachePublicData({ browserSeconds: 30, sharedSeconds: 60 });
const publicEventResponseCache = cacheJson({ ttlSeconds: env.CACHE_TTL_SECONDS, tags: ["events", "tournaments", "foundation"] });
const eventUpload = tournamentBannerUpload.fields([
  { name: "heroImage", maxCount: 1 },
  { name: "bannerImage", maxCount: 1 },
]);

router.get("/events", publicSeriesCache, publicEventResponseCache, controller.getPublicEvents);
router.get("/events/:slug", publicSeriesCache, publicEventResponseCache, controller.getPublicEventDetail);
router.get("/admin/events", requireStaffPermission("tournaments"), controller.getAdminEvents);
router.get("/admin/events/:eventId/registrations", requireStaffPermission("tournaments", "registrations"), controller.getEventRegistrations);
router.post(
  "/admin/events",
  requireStaffPermission("tournaments"),
  invalidateCache("events", "tournaments", "foundation"),
  eventUpload,
  controller.createEvent
);
router.patch(
  "/admin/events/:eventId",
  requireStaffPermission("tournaments"),
  invalidateCache("events", "tournaments", "foundation"),
  eventUpload,
  controller.updateEvent
);
router.post(
  "/admin/events/:eventId/archive",
  requireStaffPermission("tournaments"),
  invalidateCache("events", "tournaments", "foundation"),
  controller.archiveEvent
);
router.post(
  "/admin/events/:eventId/tournaments",
  requireStaffPermission("tournaments"),
  invalidateCache("events", "tournaments", "foundation"),
  eventUpload,
  controller.createEventTournament
);

router.get("/admin/events/:eventId/sponsors", requireStaffPermission("tournaments"), sponsorController.listEventSponsors);
router.post("/admin/events/:eventId/sponsors", requireStaffPermission("tournaments"), invalidateCache("events", "tournaments", "foundation"), imageUpload.single("logo"), sponsorController.createEventSponsor);
router.patch("/admin/events/:eventId/sponsors/:sponsorId", requireStaffPermission("tournaments"), invalidateCache("events", "tournaments", "foundation"), imageUpload.single("logo"), sponsorController.updateEventSponsor);
router.delete("/admin/events/:eventId/sponsors/:sponsorId", requireStaffPermission("tournaments"), invalidateCache("events", "tournaments", "foundation"), sponsorController.deleteEventSponsor);

router.get("/event-series", publicSeriesCache, controller.getPublicSeries);
router.get("/event-series/:slug", publicSeriesCache, controller.getPublicSeriesDetail);
router.get("/admin/event-series", requireStaffPermission("tournaments", "tickets"), controller.getAdminSeries);
router.post("/admin/event-series", requireStaffPermission("tournaments"), invalidateCache("events", "tournaments", "foundation"), tournamentBannerUpload.single("heroImage"), controller.createSeries);
router.patch("/admin/event-series/:seriesId", requireStaffPermission("tournaments"), invalidateCache("events", "tournaments", "foundation"), tournamentBannerUpload.single("heroImage"), controller.updateSeries);
router.delete("/admin/event-series/:seriesId", requireStaffPermission("tournaments"), invalidateCache("events", "tournaments", "foundation"), controller.deleteSeries);

module.exports = router;
