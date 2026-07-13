const express = require("express");
const { tournamentBannerUpload } = require("../../middleware/upload");
const { attachSession, requireAdmin } = require("../auth/auth.middleware");
const controller = require("./series.controller");

const router = express.Router();
router.use(attachSession);
router.get("/event-series", controller.getPublicSeries);
router.get("/event-series/:slug", controller.getPublicSeriesDetail);
router.get("/admin/event-series", requireAdmin, controller.getAdminSeries);
router.post("/admin/event-series", requireAdmin, tournamentBannerUpload.single("heroImage"), controller.createSeries);
router.patch("/admin/event-series/:seriesId", requireAdmin, tournamentBannerUpload.single("heroImage"), controller.updateSeries);
router.delete("/admin/event-series/:seriesId", requireAdmin, controller.deleteSeries);

module.exports = router;
