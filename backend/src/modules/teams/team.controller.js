const { asyncHandler } = require("../../lib/async-handler");
const {
  listProfileTeams,
  getTeamInvitePreview,
  respondToTeamInvite,
} = require("./team.service");

const getProfileTeams = asyncHandler(async (req, res) => {
  const teams = await listProfileTeams({
    user: req.user,
  });

  res.status(200).json({
    success: true,
    teams,
  });
});

const previewTeamInvite = asyncHandler(async (req, res) => {
  const invite = await getTeamInvitePreview({
    token: req.query.token,
  });

  res.status(200).json({
    success: true,
    invite,
  });
});

const respondTeamInvite = asyncHandler(async (req, res) => {
  const invite = await respondToTeamInvite({
    token: req.body.token,
    decision: req.body.decision,
  });

  res.status(200).json({
    success: true,
    message:
      invite.inviteStatus === "accepted"
        ? "You have joined the team successfully."
        : "You declined the team invite.",
    invite,
  });
});

module.exports = {
  getProfileTeams,
  previewTeamInvite,
  respondTeamInvite,
};
