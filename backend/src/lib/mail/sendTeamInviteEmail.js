const { enqueueJob } = require("../jobs");
const { EMAIL_JOB_NAME, EMAIL_TEMPLATE_TYPES } = require("./mail-job-definitions");

const sendTeamInviteEmail = async ({
  email,
  recipientName,
  teamName,
  captainName,
  tournamentTitle,
  rawToken,
}) => {
  return enqueueJob(EMAIL_JOB_NAME, {
    type: EMAIL_TEMPLATE_TYPES.teamInvite,
    email,
    recipientName,
    teamName,
    captainName,
    tournamentTitle,
    rawToken,
  });
};

module.exports = {
  sendTeamInviteEmail,
};
