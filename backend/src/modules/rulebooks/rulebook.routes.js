const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const {
  getRulebooks,
  getRulebook,
  createAdminRulebook,
  updateAdminRulebook,
  deleteAdminRulebook,
} = require("./rulebook.controller");

const router = express.Router();
router.get("/rulebooks", getRulebooks);
router.get("/rulebooks/:slug", getRulebook);
router.post("/admin/rulebooks", requireAdmin, createAdminRulebook);
router.patch("/admin/rulebooks/:rulebookId", requireAdmin, updateAdminRulebook);
router.delete("/admin/rulebooks/:rulebookId", requireAdmin, deleteAdminRulebook);

module.exports = router;
