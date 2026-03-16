const express = require("express");
const { signup, login } = require("../controllers/authController");

const router = express.Router();

// Auth endpoints are intentionally thin and delegate all logic to the controller layer.
router.post("/signup", signup);
router.post("/login", login);

module.exports = router;
