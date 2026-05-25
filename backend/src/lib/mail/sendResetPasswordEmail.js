const { enqueueJob } = require("../jobs");
const { EMAIL_JOB_NAME, EMAIL_TEMPLATE_TYPES } = require("./mail-job-definitions");

const sendResetPasswordEmail = async ({ email, firstName, rawToken }) => {
  return enqueueJob(EMAIL_JOB_NAME, {
    type: EMAIL_TEMPLATE_TYPES.resetPassword,
    email,
    firstName,
    rawToken,
  });
};

module.exports = {
  sendResetPasswordEmail,
};
