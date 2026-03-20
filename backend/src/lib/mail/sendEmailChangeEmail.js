const { buildEmailChangeEmail } = require("./templates");
const { buildActionUrl, sendMail } = require("./sendMail");

const sendEmailChangeEmail = async ({ email, firstName, nextEmail, rawToken }) => {
  return sendMail({
    email,
    subject: "Confirm your new Quest Esports email",
    skippedLogMessage:
      "Email change confirmation skipped because SMTP is not configured.",
    templateBuilder: () =>
      buildEmailChangeEmail({
        firstName,
        nextEmail,
        confirmUrl: buildActionUrl("/confirm-email-change", rawToken),
      }),
  });
};

module.exports = {
  sendEmailChangeEmail,
};
