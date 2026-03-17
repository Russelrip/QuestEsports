const express = require("express");
const {
  signup,
  login,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
} = require("./auth.controller");
const { attachSession, requireAuth } = require("./auth.middleware");

const router = express.Router();

router.use(attachSession);
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", getCurrentSession);
router.get("/users/:userId", requireAuth, getProfile);
router.patch("/users/:userId", requireAuth, updateProfile);

module.exports = router;
