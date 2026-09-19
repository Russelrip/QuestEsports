// Teams' public surface; codemap.md lists the files the code lives in.
const { refreshRegistrationVerificationStatus } = require("./registration-verification");
const {
  nudgeTeamInvite,
  adminResendTeamInvite,
  adminResendRegistrationInvite,
  sendTeamInvites,
} = require("./team-invites.service");
const {
  listProfileTeams,
  createSavedTeam,
  updateSavedTeam,
  deleteSavedTeam,
} = require("./team-profile.service");
const {
  syncSavedTeamFromRegistration,
  ensureTeamRegistrationSaved,
  activatePaidTeamRegistration,
} = require("./team-registration-sync.service");

module.exports = {
  listProfileTeams,
  createSavedTeam,
  updateSavedTeam,
  deleteSavedTeam,
  nudgeTeamInvite,
  adminResendTeamInvite,
  adminResendRegistrationInvite,
  syncSavedTeamFromRegistration,
  sendTeamInvites,
  ensureTeamRegistrationSaved,
  activatePaidTeamRegistration,
  refreshRegistrationVerificationStatus,
};
