const express = require("express");
const { asyncHandler } = require("../../lib/async-handler");
const { streamUpload } = require("./upload.service");

const router = express.Router();

router.get(
  "/uploads/tournament-banners/:filename",
  asyncHandler(async (req, res) => {
    const file = await streamUpload("tournament-banners", req.params.filename);

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.size);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(file.data);
  })
);

router.get(
  "/uploads/poster-images/:filename",
  asyncHandler(async (req, res) => {
    const file = await streamUpload("poster-images", req.params.filename);

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.size);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(file.data);
  })
);

router.get(
  "/uploads/team-logos/:filename",
  asyncHandler(async (req, res) => {
    const file = await streamUpload("team-logos", req.params.filename);

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.size);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(file.data);
  })
);

module.exports = router;
