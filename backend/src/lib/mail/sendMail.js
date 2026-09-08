const { env } = require("../../config/env");
const { logger } = require("../logger");
const { getMailTransporter, isMailConfigured } = require("./transporter");
const { normalizeSafeRedirectPath } = require("../validation");

// `redirectTo` is where the person was going before they were asked to prove
// they own the address. It is carried so that finishing here puts them back
// there rather than on a dashboard, several steps from what they were doing.
//
// Normalized rather than trusted: only a path on this site survives, by the
// same rule the login redirect uses. It is not a secret and is not treated as
// one — it decides where a page sends somebody, never what they may see.
const buildActionUrl = (pathname, token, redirectTo = null) => {
  const actionUrl = new URL(pathname, env.APP_URL);
  actionUrl.searchParams.set("token", token);
  const safeRedirect = normalizeSafeRedirectPath(redirectTo);
  if (safeRedirect) actionUrl.searchParams.set("redirect", safeRedirect);
  return actionUrl.toString();
};

const sendMail = async ({
  deliveryId,
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
    ...(deliveryId
      ? { messageId: `<quest-job-${String(deliveryId).replace(/[^a-zA-Z0-9-]/g, "")}@questesports.lk>` }
      : {}),
  });

  return true;
};

module.exports = {
  buildActionUrl,
  sendMail,
};
