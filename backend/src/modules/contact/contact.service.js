const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  normalizeEmail,
  normalizeText,
  isValidEmail,
} = require("../../lib/validation");

const createContactSubmission = async ({ body }) => {
  const name = normalizeText(body.name);
  const email = normalizeEmail(body.email);
  const subject = normalizeText(body.subject);
  const message = normalizeText(body.message);

  if (!name || !subject || !message || !isValidEmail(email)) {
    throw new HttpError(400, "All contact fields are required.");
  }

  await prisma.contactSubmission.create({
    data: {
      id: crypto.randomUUID(),
      name,
      email,
      subject,
      message,
    },
  });
};

module.exports = { createContactSubmission };
