const { asyncHandler } = require("../../lib/async-handler");
const { createContactSubmission } = require("./contact.service");

const submitContact = asyncHandler(async (req, res) => {
  await createContactSubmission({
    body: req.body,
  });

  res.status(201).json({
    success: true,
    message: "Message received successfully.",
  });
});

module.exports = { submitContact };
