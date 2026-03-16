const express = require("express");
const { submitContact } = require("../controllers/contactController");

const router = express.Router();

// Single endpoint for the public contact form submission flow.
router.post("/contact", submitContact);

module.exports = router;
