const { enqueueJob } = require("../jobs");
const { EMAIL_JOB_NAME, EMAIL_TEMPLATE_TYPES } = require("./mail-job-definitions");

const sendEmailChangeEmail = async ({ email, firstName, nextEmail, rawToken }) => {
  return enqueueJob(EMAIL_JOB_NAME, {
    type: EMAIL_TEMPLATE_TYPES.emailChange,
    email,
    firstName,
    nextEmail,
    rawToken,
  });
};

module.exports = {
  sendEmailChangeEmail,
};
