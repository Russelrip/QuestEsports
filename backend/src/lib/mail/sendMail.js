const { env } = require("../../config/env");
const { logger } = require("../logger");
const { getMailTransporter, isMailConfigured } = require("./transporter");

const buildActionUrl = (pathname, token) => {
  const actionUrl = new URL(pathname, env.APP_URL);
  actionUrl.searchParams.set("token", token);
  return actionUrl.toString();
};

const sendMail = async ({
  email,
  subject,
  skippedLogMessage,
  templateBuilder,
}) => {
  if (!isMailConfigured()) {
    logger.warn(skippedLogMessage, { email });
    return false;
  }

  const { html, text } = templateBuilder();

  await getMailTransporter().sendMail({
    from: env.MAIL_FROM,
    to: email,
    subject,
    html,
    text,
  });

  return true;
};

module.exports = {
  buildActionUrl,
  sendMail,
};
