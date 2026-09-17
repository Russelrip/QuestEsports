const express = require("express");
const { requireStaffPermission } = require("../permissions/permission.middleware");
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
router.post("/admin/rulebooks", requireStaffPermission("rulebooks"), createAdminRulebook);
router.patch("/admin/rulebooks/:rulebookId", requireStaffPermission("rulebooks"), updateAdminRulebook);
router.delete("/admin/rulebooks/:rulebookId", requireStaffPermission("rulebooks"), deleteAdminRulebook);

module.exports = router;
