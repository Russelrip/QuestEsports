// Public surface; codemap.md lists the files the code lives in.
const { buildRegistrationCountInclude, parseOptionalDateValue } = require("./tournament-shared");
const {
  normalizeChallongeUrl,
  buildChallongeEmbedUrl,
  mapTournament,
  mapTournamentWithRegistrations,
  mapTournamentWithPublicTeams,
} = require("./tournament-mapping");
const { normalizeTournamentInput } = require("./tournament-input");
const {
  listPublicTournaments,
  getPublicTournamentBySlug,
  getTournamentRegistrationStatus,
} = require("./tournament-public.service");
const {
  listAdminTournaments,
  getAdminTournamentById,
  createAdminTournament,
  updateAdminTournament,
  attachTournamentToSeries,
  deleteAdminTournament,
} = require("./tournament-admin.service");

module.exports = {
  listPublicTournaments,
  getPublicTournamentBySlug,
  listAdminTournaments,
  getAdminTournamentById,
  createAdminTournament,
  attachTournamentToSeries,
  updateAdminTournament,
  deleteAdminTournament,
  getTournamentRegistrationStatus,
  parseOptionalDateValue,
  normalizeTournamentInput,
  mapTournament,
  mapTournamentWithRegistrations,
  mapTournamentWithPublicTeams,
  buildRegistrationCountInclude,
  normalizeChallongeUrl,
  buildChallongeEmbedUrl,
};
