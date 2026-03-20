const { buildVerificationEmail } = require("./templates");
const { buildActionUrl, sendMail } = require("./sendMail");

const sendVerificationEmail = async ({ email, firstName, rawToken }) => {
  return sendMail({
    email,
    subject: "Verify your Quest Esports account",
    skippedLogMessage: "Verification email skipped because SMTP is not configured.",
    templateBuilder: () =>
      buildVerificationEmail({
        firstName,
        verificationUrl: buildActionUrl("/verify-email", rawToken),
      }),
  });
};

module.exports = {
  sendVerificationEmail,
};
