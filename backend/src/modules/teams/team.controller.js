const { asyncHandler } = require("../../lib/async-handler");
const {
  listProfileTeams,
  createSavedTeam,
  updateSavedTeam,
  deleteSavedTeam,
  resendSavedTeamInvite,
  getTeamInvitePreview,
  respondToTeamInvite,
} = require("./team.service");
const { listInvitationsForUser } = require("./invitation-inbox.service");

const getProfileTeams = asyncHandler(async (req, res) => {
  const teams = await listProfileTeams({
    user: req.user,
  });

  res.status(200).json({
    success: true,
    teams,
  });
});

const createProfileTeam = asyncHandler(async (req, res) => {
  const team = await createSavedTeam({
    user: req.user,
    body: req.body,
    file: req.file,
  });

  res.status(201).json({
    success: true,
    message: "Team created successfully. Invitations have been sent to your members.",
    team,
  });
});

const updateProfileTeam = asyncHandler(async (req, res) => {
  const team = await updateSavedTeam({
    teamId: req.params.teamId,
    user: req.user,
    body: req.body,
    file: req.file,
  });
  res.status(200).json({
    success: true,
    message: "Team updated successfully. New member invitations were sent when needed.",
    team,
  });
});

const deleteProfileTeam = asyncHandler(async (req, res) => {
  await deleteSavedTeam({ teamId: req.params.teamId, user: req.user });
  res.status(200).json({ success: true, message: "Team deleted successfully." });
});

const resendProfileTeamInvite = asyncHandler(async (req, res) => {
  const result = await resendSavedTeamInvite({
    teamId: req.params.teamId,
    memberId: req.params.memberId,
    user: req.user,
  });
  res.status(200).json({
    success: true,
    message: "A new team invitation has been sent.",
    ...result,
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
    user: req.user,
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

// An invitation must be findable inside Quest, not only at the end of whatever
// message happened to deliver it.
const getMyInvitations = asyncHandler(async (req, res) => {
  const { invitations } = await listInvitationsForUser({ user: req.user });
  res.status(200).json({ success: true, invitations });
});

module.exports = {
  getProfileTeams,
  getMyInvitations,
  createProfileTeam,
  updateProfileTeam,
  deleteProfileTeam,
  resendProfileTeamInvite,
  previewTeamInvite,
  respondTeamInvite,
};
