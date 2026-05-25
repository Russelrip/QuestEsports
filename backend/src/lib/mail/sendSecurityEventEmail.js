const { env } = require("../../config/env");
const { enqueueJob } = require("../jobs");
const { EMAIL_JOB_NAME, EMAIL_TEMPLATE_TYPES } = require("./mail-job-definitions");

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
  return enqueueJob(EMAIL_JOB_NAME, {
    type: EMAIL_TEMPLATE_TYPES.securityAlert,
    email,
    firstName,
    subject,
    title,
    message,
    actionLabel,
    actionUrl,
    outro,
  });
};

module.exports = {
  sendSecurityEventEmail,
};
