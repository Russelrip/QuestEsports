// The Challonge integration's public surface. The code lives beside it:
// - challonge-api.js: OAuth token, rate limits and requests to the Challonge API,
//   and normalizing a tournament snapshot.
// - challonge-sync.service.js: syncing a snapshot onto Quest matches, and the
//   scheduled sync queue.
// - challonge-admin.service.js: the admin integration settings, participants,
//   state changes and match results.
// - challonge-public.service.js: the public bracket.
const {
  ChallongeRequestError,
  extractChallongeIdentifier,
  requestChallongeJson,
  normalizeSnapshot,
  fetchChallongeSnapshot,
} = require("./challonge-api");
const {
  buildSyncedTournamentUpdate,
  mapChallongeStatus,
  recordChallongeSkippedAttempt,
  syncChallongeIntegration,
  claimDueIntegrationsForQueue,
} = require("./challonge-sync.service");
const {
  getAdminIntegration,
  createChallongeParticipant,
  updateChallongeParticipant,
  deleteChallongeParticipant,
  changeChallongeTournamentState,
  updateChallongeMatchResult,
  saveAdminIntegration,
  listSyncLogs,
  updateParticipantMapping,
} = require("./challonge-admin.service");
const { getPublicBracket } = require("./challonge-public.service");

module.exports = {
  buildSyncedTournamentUpdate,
  ChallongeRequestError,
  extractChallongeIdentifier,
  normalizeSnapshot,
  mapChallongeStatus,
  requestChallongeJson,
  fetchChallongeSnapshot,
  syncChallongeIntegration,
  getAdminIntegration,
  saveAdminIntegration,
  createChallongeParticipant,
  updateChallongeParticipant,
  deleteChallongeParticipant,
  changeChallongeTournamentState,
  updateChallongeMatchResult,
  listSyncLogs,
  updateParticipantMapping,
  getPublicBracket,
  claimDueIntegrationsForQueue,
  recordChallongeSkippedAttempt,
};
