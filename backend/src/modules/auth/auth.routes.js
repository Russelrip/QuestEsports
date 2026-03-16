const express = require("express");
const {
  signup,
  login,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
  getAdminDashboard,
} = require("./auth.controller");
const { attachSession, requireAuth, requireAdmin } = require("./auth.middleware");

const router = express.Router();

router.use(attachSession);
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", getCurrentSession);
router.get("/users/:userId", requireAuth, getProfile);
router.patch("/users/:userId", requireAuth, updateProfile);
router.get("/admin/dashboard", requireAdmin, getAdminDashboard);

module.exports = router;
