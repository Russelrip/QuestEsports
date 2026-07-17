const { enqueueJob, enqueueJobs } = require("../jobs");
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

const sendTeamInviteEmails = async (invites = []) =>
  enqueueJobs(invites.map((invite) => ({
    name: EMAIL_JOB_NAME,
    payload: {
      type: EMAIL_TEMPLATE_TYPES.teamInvite,
      email: invite.email,
      recipientName: invite.recipientName,
      teamName: invite.teamName,
      captainName: invite.captainName,
      tournamentTitle: invite.tournamentTitle,
      rawToken: invite.rawToken,
    },
  })));

module.exports = {
  sendTeamInviteEmail,
  sendTeamInviteEmails,
};
