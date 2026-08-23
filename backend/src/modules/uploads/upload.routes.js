const express = require("express");
const { streamFileToResponse } = require("../../lib/stream-response");
const { asyncHandler } = require("../../lib/async-handler");
const { streamUpload } = require("./upload.service");

const router = express.Router();

const sendPublicUpload = (directoryKey) =>
  asyncHandler(async (req, res) => {
    const file = await streamUpload(directoryKey, req.params.filename);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.size);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200);
    await streamFileToResponse(file.path, res);
  });

router.get("/uploads/tournament-banners/:filename", sendPublicUpload("tournament-banners"));
router.get("/uploads/poster-images/:filename", sendPublicUpload("poster-images"));
router.get("/uploads/team-logos/:filename", sendPublicUpload("team-logos"));
router.get("/uploads/avatars/:filename", sendPublicUpload("avatars"));

router.get("/uploads/game-assets/:filename", sendPublicUpload("game-assets"));
router.get("/uploads/sponsor-logos/:filename", sendPublicUpload("sponsor-logos"));

module.exports = router;
