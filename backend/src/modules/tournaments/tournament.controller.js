const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  listPublicTournaments,
  getPublicTournamentBySlug,
  listAdminTournaments,
  getAdminTournamentById,
  createAdminTournament,
  updateAdminTournament,
  deleteAdminTournament,
  getTournamentRegistrationStatus,
} = require("./tournament.service");
const {
  generateTournamentBracket,
  getAdminTournamentBracket,
  updateTournamentBracketMatch,
  publishTournamentBracket,
} = require("./bracket.service");
const {
  createConfiguredRegistration,
  cancelUnpaidRegistration,
} = require("./registration.service");

const getPublicTournaments = asyncHandler(async (req, res) => {
  const tournaments = await listPublicTournaments(req.query);

  res.status(200).json({
    success: true,
    tournaments,
  });
});

const getPublicTournament = asyncHandler(async (req, res) => {
  const tournament = await getPublicTournamentBySlug(req.params.slug, req.query);

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
    files: req.files,
  });
  await recordAudit({ ...requestAuditContext(req), action: "tournament.created", targetType: "Tournament", targetId: tournament.id, afterData: { slug: tournament.slug, status: tournament.status } });

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
    files: req.files,
  });
  await recordAudit({ ...requestAuditContext(req), action: "tournament.updated", targetType: "Tournament", targetId: tournament.id, afterData: { slug: tournament.slug, status: tournament.status, isPublished: tournament.isPublished } });

  res.status(200).json({
    success: true,
    message: "Tournament updated successfully.",
    tournament,
  });
});

const deleteTournament = asyncHandler(async (req, res) => {
  await deleteAdminTournament(req.params.tournamentId);
  await recordAudit({ ...requestAuditContext(req), action: "tournament.deleted", targetType: "Tournament", targetId: req.params.tournamentId });

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
    registration: result.registration,
  });
});

const submitConfiguredTournamentRegistration = asyncHandler(async (req, res) => {
  const result = await createConfiguredRegistration({
    slug: req.params.slug,
    body: req.body,
    file: req.file,
    user: req.user,
  });
  res.status(201).json({
    success: true,
    message: result.awaitingTeamVerification
      ? "Team saved. Every invited player must accept before payment is unlocked."
      : result.readyForPayment
        ? "Your roster is verified and ready for payment."
        : result.checkout || result.bankTransfer
          ? "Registration reserved. Complete payment to confirm your entry."
          : "Tournament registration submitted successfully.",
    ...result,
  });
});

const cancelTournamentRegistration = asyncHandler(async (req, res) => {
  await cancelUnpaidRegistration({ slug: req.params.slug, user: req.user });
  res.status(200).json({
    success: true,
    message: "Registration cancelled. You can correct your team and register again.",
  });
});

const getTournamentBracket = asyncHandler(async (req, res) => {
  const bracket = await getAdminTournamentBracket(req.params.tournamentId);

  res.status(200).json({
    success: true,
    bracket,
  });
});

const generateBracket = asyncHandler(async (req, res) => {
  const bracket = await generateTournamentBracket(req.params.tournamentId);
  await recordAudit({ ...requestAuditContext(req), action: "tournament.bracket.generated", targetType: "Tournament", targetId: req.params.tournamentId, afterData: { status: bracket.status || null } });

  res.status(201).json({
    success: true,
    message: "Bracket generated from approved teams.",
    bracket,
  });
});

const updateBracketMatch = asyncHandler(async (req, res) => {
  const bracket = await updateTournamentBracketMatch(
    req.params.tournamentId,
    req.params.matchId,
    req.body
  );
  await recordAudit({ ...requestAuditContext(req), action: "tournament.bracket.match_updated", targetType: "TournamentBracketMatch", targetId: req.params.matchId, afterData: { status: bracket.status || null } });

  res.status(200).json({
    success: true,
    message: "Bracket match updated.",
    bracket,
  });
});

const publishBracket = asyncHandler(async (req, res) => {
  const bracket = await publishTournamentBracket(req.params.tournamentId, req.body);
  await recordAudit({ ...requestAuditContext(req), action: "tournament.bracket.visibility_changed", targetType: "Tournament", targetId: req.params.tournamentId, afterData: { status: bracket.status || null } });

  res.status(200).json({
    success: true,
    message: bracket.status === "published" ? "Bracket published." : "Bracket unpublished.",
    bracket,
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
  submitConfiguredTournamentRegistration,
  cancelTournamentRegistration,
  getTournamentBracket,
  generateBracket,
  updateBracketMatch,
  publishBracket,
};
