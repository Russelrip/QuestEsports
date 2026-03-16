const crypto = require("crypto");
const { db } = require("../../config/database");
const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const {
  normalizeEmail,
  normalizeText,
  isValidEmail,
} = require("../../lib/validation");

const submitContact = asyncHandler(async (req, res) => {
  const name = normalizeText(req.body.name);
  const email = normalizeEmail(req.body.email);
  const subject = normalizeText(req.body.subject);
  const message = normalizeText(req.body.message);

  if (!name || !subject || !message || !isValidEmail(email)) {
    throw new HttpError(400, "All contact fields are required.");
  }

  db.prepare(
    `
      INSERT INTO contact_submissions (id, name, email, subject, message)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(crypto.randomUUID(), name, email, subject, message);

  res.status(201).json({
    success: true,
    message: "Message received successfully.",
  });
});

module.exports = { submitContact };
