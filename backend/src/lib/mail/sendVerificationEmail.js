const { enqueueJob } = require("../jobs");
const { EMAIL_JOB_NAME, EMAIL_TEMPLATE_TYPES } = require("./mail-job-definitions");

const sendVerificationEmail = async ({ email, firstName, rawToken }) => {
  return enqueueJob(EMAIL_JOB_NAME, {
    type: EMAIL_TEMPLATE_TYPES.verification,
    email,
    firstName,
    rawToken,
  });
};

module.exports = {
  sendVerificationEmail,
};
