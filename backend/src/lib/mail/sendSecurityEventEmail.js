const { env } = require("../../config/env");
const { buildSecurityAlertEmail } = require("./templates");
const { sendMail } = require("./sendMail");

const buildProfileUrl = () => {
  if (!env.APP_URL) {
    return "";
  }

  return new URL("/profile", env.APP_URL).toString();
};

const sendSecurityEventEmail = async ({
  email,
  firstName,
  subject,
  title,
  message,
  actionLabel = "Review Account",
  actionUrl = buildProfileUrl(),
  outro,
}) => {
  return sendMail({
    email,
    subject,
    skippedLogMessage:
      "Security alert email skipped because SMTP is not configured.",
    templateBuilder: () =>
      buildSecurityAlertEmail({
        firstName,
        title,
        message,
        actionLabel,
        actionUrl,
        outro,
      }),
  });
};

module.exports = {
  sendSecurityEventEmail,
};
