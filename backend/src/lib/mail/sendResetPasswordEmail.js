const { buildResetPasswordEmail } = require("./templates");
const { buildActionUrl, sendMail } = require("./sendMail");

const sendResetPasswordEmail = async ({ email, firstName, rawToken }) => {
  return sendMail({
    email,
    subject: "Reset your Quest Esports password",
    skippedLogMessage:
      "Password reset email skipped because SMTP is not configured.",
    templateBuilder: () =>
      buildResetPasswordEmail({
        firstName,
        resetUrl: buildActionUrl("/reset-password", rawToken),
      }),
  });
};

module.exports = {
  sendResetPasswordEmail,
};
