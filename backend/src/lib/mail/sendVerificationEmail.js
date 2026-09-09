const { enqueueJob } = require("../jobs");
const { EMAIL_JOB_NAME, EMAIL_TEMPLATE_TYPES } = require("./mail-job-definitions");

const sendVerificationEmail = async ({ email, firstName, rawToken, redirectTo = null }) => {
  return enqueueJob(EMAIL_JOB_NAME, {
    type: EMAIL_TEMPLATE_TYPES.verification,
    email,
    firstName,
    rawToken,
    // Where they were going when they were asked to verify. Most often nowhere
    // in particular; sometimes a team invitation they cannot answer until this
    // is done. Sanitized at the point the URL is built.
    redirectTo,
  });
};

module.exports = {
  sendVerificationEmail,
};
