const express = require("express");
const { avatarUpload } = require("../../middleware/upload");
const { requireAuth } = require("../auth/auth.middleware");
const { getDashboard, uploadAvatar, deleteAvatar } = require("./account.controller");

const router = express.Router();
router.get("/me/dashboard", requireAuth, getDashboard);
router.post("/me/avatar", requireAuth, avatarUpload.single("avatar"), uploadAvatar);
router.delete("/me/avatar", requireAuth, deleteAvatar);

module.exports = router;
