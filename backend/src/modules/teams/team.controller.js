const { asyncHandler } = require("../../lib/async-handler");
const {
  listProfileTeams,
  createSavedTeam,
  updateSavedTeam,
  deleteSavedTeam,
  nudgeTeamInvite,
} = require("./team.service");
const { describeInviteDelivery } = require("./invite-delivery-message");
const {
  listInvitationsForUser,
  respondToInvitation,
  getInvitationReadiness,
} = require("./invitation.service");

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
    message: "Team created. Your members can accept from their Quest invitations.",
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
    message: "Team updated. New members can accept from their Quest invitations.",
    team,
  });
});

const deleteProfileTeam = asyncHandler(async (req, res) => {
  await deleteSavedTeam({ teamId: req.params.teamId, user: req.user });
  res.status(200).json({ success: true, message: "Team deleted successfully." });
});

const nudgeProfileTeamInvite = asyncHandler(async (req, res) => {
  const result = await nudgeTeamInvite({
    teamId: req.params.teamId,
    memberId: req.params.memberId,
    user: req.user,
  });
  res.status(200).json({
    success: true,
    message: describeInviteDelivery(result.delivery),
    ...result,
  });
});

// An invitation must be findable inside Quest, not only at the end of whatever
// message happened to deliver it.
//
// Everything here is selected by the signed-in identity. There is no reference
// to resolve and nothing a link can say about which invitation is meant, which
// is what makes this answer impossible to get wrong.
const getMyInvitations = asyncHandler(async (req, res) => {
  const [{ invitations }, readiness] = await Promise.all([
    listInvitationsForUser({ user: req.user }),
    getInvitationReadiness({ userId: req.user.id }),
  ]);
  res.status(200).json({
    success: true,
    invitations,
    readiness: {
      ...readiness,
      // An unverified account matches no invitation at all. Without this the
      // page would show an empty list to somebody who has one waiting, with no
      // hint that the address simply has not been proven yet.
      emailVerified: Boolean(req.user.emailVerified),
    },
  });
});

const respondToMyInvitation = asyncHandler(async (req, res) => {
  const result = await respondToInvitation({
    invitationId: req.params.invitationId,
    decision: req.body.decision,
    user: req.user,
  });

  res.status(200).json({
    success: true,
    message:
      result.inviteStatus === "accepted"
        ? "You have joined the team."
        : "You declined the invitation.",
    ...result,
  });
});

module.exports = {
  getProfileTeams,
  getMyInvitations,
  respondToMyInvitation,
  createProfileTeam,
  updateProfileTeam,
  deleteProfileTeam,
  nudgeProfileTeamInvite,
};
