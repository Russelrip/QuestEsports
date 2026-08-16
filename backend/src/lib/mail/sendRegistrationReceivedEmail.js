const { enqueueJob } = require("../jobs");
const { EMAIL_JOB_NAME, EMAIL_TEMPLATE_TYPES } = require("./mail-job-definitions");

const sendRegistrationReceivedEmail = async ({
  registrationId,
  email,
  recipientName,
  teamName,
  tournamentTitle,
  pendingMemberCount,
}) => enqueueJob(EMAIL_JOB_NAME, {
  type: EMAIL_TEMPLATE_TYPES.registrationReceived,
  registrationId,
  email,
  recipientName,
  teamName,
  tournamentTitle,
  pendingMemberCount,
});

module.exports = { sendRegistrationReceivedEmail };
