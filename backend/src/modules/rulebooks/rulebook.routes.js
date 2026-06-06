const express = require("express");
const { attachSession, requireAdmin } = require("../auth/auth.middleware");
const {
  getRulebooks,
  getRulebook,
  createAdminRulebook,
  updateAdminRulebook,
  deleteAdminRulebook,
} = require("./rulebook.controller");

const router = express.Router();
router.use(attachSession);
router.get("/rulebooks", getRulebooks);
router.get("/rulebooks/:slug", getRulebook);
router.post("/admin/rulebooks", requireAdmin, createAdminRulebook);
router.patch("/admin/rulebooks/:rulebookId", requireAdmin, updateAdminRulebook);
router.delete("/admin/rulebooks/:rulebookId", requireAdmin, deleteAdminRulebook);

module.exports = router;
