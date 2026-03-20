const { buildTeamInviteEmail } = require("./templates");
const { buildActionUrl, sendMail } = require("./sendMail");

const sendTeamInviteEmail = async ({
  email,
  recipientName,
  teamName,
  captainName,
  tournamentTitle,
  rawToken,
}) => {
  return sendMail({
    email,
    subject: "Quest Esports team invitation",
    skippedLogMessage:
      "Team invitation email skipped because SMTP is not configured.",
    templateBuilder: () =>
      buildTeamInviteEmail({
        recipientName,
        teamName,
        captainName,
        tournamentTitle,
        inviteUrl: buildActionUrl("/team-invite", rawToken),
      }),
  });
};

module.exports = {
  sendTeamInviteEmail,
};
