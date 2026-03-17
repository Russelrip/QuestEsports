const { asyncHandler } = require("../../lib/async-handler");
const {
  listPublicTournaments,
  getPublicTournamentBySlug,
  listAdminTournaments,
  getAdminTournamentById,
  createAdminTournament,
  updateAdminTournament,
  deleteAdminTournament,
  getTournamentRegistrationStatus,
  createTournamentRegistration,
} = require("./tournament.service");

const getPublicTournaments = asyncHandler(async (req, res) => {
  const tournaments = await listPublicTournaments(req.query);

  res.status(200).json({
    success: true,
    tournaments,
  });
});

const getPublicTournament = asyncHandler(async (req, res) => {
  const tournament = await getPublicTournamentBySlug(req.params.slug);

  res.status(200).json({
    success: true,
    tournament,
  });
});

const getAdminTournaments = asyncHandler(async (req, res) => {
  const result = await listAdminTournaments(req.query);

  res.status(200).json({
    success: true,
    tournaments: result.items,
    pagination: result.pagination,
  });
});

const getAdminTournament = asyncHandler(async (req, res) => {
  const tournament = await getAdminTournamentById(req.params.tournamentId);

  res.status(200).json({
    success: true,
    tournament,
  });
});

const createTournament = asyncHandler(async (req, res) => {
  const tournament = await createAdminTournament({
    body: req.body,
    file: req.file,
  });

  res.status(201).json({
    success: true,
    message: "Tournament created successfully.",
    tournament,
  });
});

const updateTournament = asyncHandler(async (req, res) => {
  const tournament = await updateAdminTournament({
    tournamentId: req.params.tournamentId,
    body: req.body,
    file: req.file,
  });

  res.status(200).json({
    success: true,
    message: "Tournament updated successfully.",
    tournament,
  });
});

const deleteTournament = asyncHandler(async (req, res) => {
  await deleteAdminTournament(req.params.tournamentId);

  res.status(200).json({
    success: true,
    message: "Tournament deleted successfully.",
  });
});

const getTournamentRegistrationStatusController = asyncHandler(async (req, res) => {
  const result = await getTournamentRegistrationStatus({
    slug: req.params.slug,
    user: req.user,
  });

  res.status(200).json({
    success: true,
    isRegistered: result.isRegistered,
    tournament: result.tournament,
  });
});

const submitTournamentRegistration = asyncHandler(async (req, res) => {
  await createTournamentRegistration({
    body: req.body,
    file: req.file,
  });

  res.status(201).json({
    success: true,
    message: "Tournament registration submitted successfully.",
  });
});

module.exports = {
  getPublicTournaments,
  getPublicTournament,
  getAdminTournaments,
  getAdminTournament,
  createTournament,
  updateTournament,
  deleteTournament,
  getTournamentRegistrationStatus: getTournamentRegistrationStatusController,
  submitTournamentRegistration,
};
