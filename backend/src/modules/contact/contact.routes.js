const express = require("express");
const { submitContact } = require("./contact.controller");

const router = express.Router();

router.post("/contact", submitContact);

module.exports = router;
